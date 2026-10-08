"""Local REST bridge + static Command Center for the Lake Yange backend.

Binds to 127.0.0.1 only. The server NEVER holds steward private keys: it publishes the exact bytes to sign, and the
human signs in their own browser (WebCrypto Ed25519) or with an external signer and pastes the signature. Agents'
session keys are also not exposed; agents act through the gateway elsewhere. Writes require a per-process session
header embedded in the served page, a loopback Host and (if present) a same-origin Origin (CSRF/DNS-rebinding guard).

LIMITS: single-process, no user accounts; anyone with access to the local loopback page of a running server can
submit signatures (but can only authorize with valid steward signatures). The authorization token is returned to the
browser because Forge runs elsewhere; treat it as a 60-second bearer secret. Demo mode generates demo steward keys
into the state dir for rehearsal only.
"""
from __future__ import annotations

import base64
import hashlib
import copy
import json
import secrets
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from lake_yange.agents.missions import MissionEngine, MissionStateError
from lake_yange.agents.prime import Prime
from lake_yange.agents.red_sink import RedSinkAgent
from lake_yange.agents.vera import Vera
from lake_yange.audit.ledger import LedgerIntegrityError, RedSinkLedger
from lake_yange.experiments.cognitive_index import CII_ALERT_THRESHOLD, compute_cii
from lake_yange.middleware.auth_gate import (OVERRIDE_DECISION, OVERRIDE_SIGNATURES_REQUIRED, TIME_LOCKS, AuthGate,
                                             GateError, InsufficientSignatures, InvalidSignature, StewardSignature,
                                             TimeLockActive, TokenError, approval_message)
from lake_yange.audit.anchor import verify_anchor_chain
from lake_yange.hardware.diagnostics import HardwareDiagnosticHarness
from lake_yange.middleware.circuit_breaker import CircuitBreaker, SessionKeyError
from lake_yange.research.vector_store import VectorStore
from lake_yange.research.deep_research import DeepResearch, ResearchReport, Passage, Claim, ClaimAudit, EvidenceRow, Statement
import logging
from lake_yange.middleware.time_lock import CANCEL_DECISION, TimeLockEngine
from lake_yange.middleware.gateway import BoundedAgentGateway
from lake_yange.middleware.lifecycle import ORDER, Stage
from lake_yange.storage.encrypted_store import EncryptedStore, load_or_create_key
from lake_yange.treasury.simulator import Simulator
from lake_yange.treasury.three_tier_ledger import ThreeTierLedger

UI_DIR = Path(__file__).parent / "ui"
HOST, PORT = "127.0.0.1", 8000
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "testserver"}
TIER_LABEL = {0: "Tier 0 (Micro)", 1: "Tier 1 (1 Signer)", 2: "Tier 2 (2 Multi-Sig + 6h Lock)",
              3: "Tier 3 (3 Multi-Sig + 24h Lock)"}


class Sig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    steward_id: str = Field(min_length=1, max_length=64)
    signature_b64: str = Field(min_length=1, max_length=256)

    def to_gate(self) -> StewardSignature:
        return StewardSignature(steward_id=self.steward_id, signature_b64=self.signature_b64)


class AuthorizeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signatures: List[Sig] = []
    emergency_override: List[Sig] = []


class RejectBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signature: Sig
    reason: str = Field(min_length=1, max_length=500)
    revoke_agent_key: bool = False


class CancelBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signatures: List[Sig]


class TokenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=1, max_length=4096)


class MissionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    objective: str = Field(min_length=3, max_length=500)
    tool: Dict[str, Any]
    amount_usd: str = Field(default="0", max_length=20)
    auto_plan: bool = True


class MissionAuthBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signatures: List[Sig] = []


class IngestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=200_000)


class RevokeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=300)
    signature: Sig


class PendingSignature(BaseModel):
    model_config = ConfigDict(extra="forbid")
    steward_id: str = Field(min_length=1, max_length=64)
    signature_b64: str = Field(min_length=1, max_length=256)
    decision: str = Field(min_length=1, max_length=64)


# Research API Models
class ResearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=10, max_length=2000)
    depth: str = Field(default="standard", pattern="^(quick|standard|deep|investigation)$")


class SourceMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str
    title: Optional[str] = None
    publisher: Optional[str] = None
    publication_date: Optional[str] = None
    source_type: str = "unknown"  # primary, secondary, context
    jurisdiction: Optional[str] = None
    quality: str = "medium"  # high, medium, low
    relevance: Optional[str] = None
    doc_hash: str
    chunk_hash: str


class EvidenceItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str
    source: SourceMetadata
    confidence: str = "medium"  # high, medium, low, unknown
    evidence_type: str = "fact"  # fact, interpretation, claim, opinion, unknown


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str
    evidence_type: str = "fact"  # fact, interpretation, claim, opinion, unknown
    confidence: str = "medium"  # high, medium, low, unknown
    supporting_evidence: List[EvidenceItem] = []
    contradicting_evidence: List[EvidenceItem] = []


class ResearchDisagreement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_a: str
    source_b: str
    why: str
    assessment: str


class ResearchUncertainty(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str
    reason: str


class ResearchCompetingInterpretation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: str
    sources: str
    analysis: str


class ResearchProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    research_session_id: str
    question_hash: str
    timestamp: str
    agent_actions: List[str] = []
    source_hashes: List[str] = []
    claim_evidence_graph: Optional[Dict[str, Any]] = None
    ver_audit_results: List[str] = []
    ledger_entry_hash: Optional[str] = None


class ResearchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    question: str
    status: str = "understanding"  # understanding, sources, crosscheck, analysis, review, complete, failed
    progress: int = 0  # 0-100
    stage: str = "understanding"
    short_answer: Optional[str] = None
    findings: List[Finding] = []
    evidence_supported: List[EvidenceItem] = []
    uncertainties: List[ResearchUncertainty] = []
    competing_interpretations: List[ResearchCompetingInterpretation] = []
    disagreements: List[ResearchDisagreement] = []
    sources: List[SourceMetadata] = []
    metadata: Dict[str, Any] = {}
    provenance: Optional[ResearchProvenance] = None
    error: Optional[str] = None
    timestamps: Dict[str, str] = {}  # stage timestamps


def revoke_message_parts(steward_id: str, reason: str) -> Any:
    """(proposal_id, p_hash, tier, decision) that a steward signs to flag a key as compromised."""
    return f"steward:{steward_id}", hashlib.sha256(reason.encode()).hexdigest(), 3, "REVOKE_KEY"


def _dec(x: Any) -> str:
    return str(Decimal(x).quantize(Decimal("0.01")))


class UiState:
    def __init__(self, state_dir: Path, clock: Callable[[], datetime], treasury: Optional[ThreeTierLedger],
                 override_time_lock: bool = True) -> None:
        self.dir = Path(state_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self.store = EncryptedStore(self.dir / "state.db", load_or_create_key(self.dir / "state.key"))
        self.ledger = RedSinkLedger(self.dir / "ledger.jsonl", clock=clock)
        self.red_sink = RedSinkAgent(self.ledger)
        self.breaker = CircuitBreaker(self.ledger, store=self.store)
        self.gate = AuthGate(clock=clock, store=self.store)
        self.time_lock = TimeLockEngine(self.gate, self.red_sink, self.store, clock) if override_time_lock else None
        self.gateway = BoundedAgentGateway(self.gate, self.breaker, self.red_sink, clock=clock, store=self.store,
                                           time_lock=self.time_lock)
        self.rag = VectorStore(str(self.dir / "rag.db"))
        self.missions: Optional[MissionEngine]
        try:
            self.missions = MissionEngine(self.gateway, self.store, self.rag, self.dir / "workspace", clock)
        except SessionKeyError:
            self.missions = None  # an agent key was revoked: missions stay disabled (fail closed)
        if treasury is not None:
            self.save_treasury(treasury)
        # Load pending signatures for hybrid sync
        self._pending_signatures: Dict[str, Dict[str, Dict[str, Any]]] = self._load_pending_signatures()
        
        # Research session management
        self._research_sessions: Dict[str, Dict[str, Any]] = self._load_research_sessions()
        self._research_counter: int = 0

    def treasury(self) -> Optional[ThreeTierLedger]:
        d = self.store.get("ui", "treasury")
        if d is None:
            return None
        t = ThreeTierLedger(Decimal(d["tier1"]), Decimal(d["tier2"]), Decimal(d["tier3"]), Decimal(d["burn"]))
        for name in d.get("projects", []):
            t.tier3_projects[name] = False
        return t

    def save_treasury(self, t: ThreeTierLedger, demo: bool = False) -> None:
        self.store.put("ui", "treasury", {"tier1": str(t.tier1), "tier2": str(t.tier2), "tier3": str(t.tier3),
                                          "burn": str(t.monthly_essential_burn),
                                          "projects": list(t.tier3_projects), "demo": demo})

    def _load_pending_signatures(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        saved = self.store.get("ui", "pending_signatures")
        return saved if saved is not None else {}

    def _save_pending_signatures(self) -> None:
        self.store.put("ui", "pending_signatures", self._pending_signatures)

    def add_pending_signature(self, proposal_id: str, steward_id: str, signature_b64: str, decision: str) -> None:
        if proposal_id not in self._pending_signatures:
            self._pending_signatures[proposal_id] = {}
        self._pending_signatures[proposal_id][steward_id] = {
            "signature_b64": signature_b64,
            "decision": decision,
            "timestamp": self.clock().timestamp()
        }
        self._save_pending_signatures()

    def get_pending_signatures(self, proposal_id: str) -> Dict[str, Dict[str, Any]]:
        return self._pending_signatures.get(proposal_id, {})

    def clear_pending_signatures(self, proposal_id: str) -> None:
        if proposal_id in self._pending_signatures:
            del self._pending_signatures[proposal_id]
            self._save_pending_signatures()

    def _load_research_sessions(self) -> Dict[str, Dict[str, Any]]:
        saved = self.store.get("ui", "research_sessions")
        return saved if saved is not None else {}

    def _save_research_sessions(self) -> None:
        self.store.put("ui", "research_sessions", self._research_sessions)

    def create_research_session(self, question: str, depth: str = "standard") -> str:
        self._research_counter += 1
        session_id = f"ly-research-{self._research_counter}-{int(self.clock().timestamp())}"
        self._research_sessions[session_id] = {
            "question": question,
            "depth": depth,
            "status": "understanding",
            "progress": 0,
            "stage": "understanding",
            "created_at": self.clock().isoformat(),
            "updated_at": self.clock().isoformat(),
            "timestamps": {},
            "error": None
        }
        self._save_research_sessions()
        return session_id

    def update_research_session(self, session_id: str, updates: Dict[str, Any]) -> None:
        if session_id in self._research_sessions:
            self._research_sessions[session_id].update(updates)
            self._research_sessions[session_id]["updated_at"] = self.clock().isoformat()
            if "stage" in updates:
                self._research_sessions[session_id]["timestamps"][updates["stage"]] = self.clock().isoformat()
            self._save_research_sessions()

    def get_research_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        return self._research_sessions.get(session_id)

    def list_research_sessions(self) -> List[Dict[str, Any]]:
        return [
            {"session_id": sid, **data}
            for sid, data in self._research_sessions.items()
        ]

    def delete_research_session(self, session_id: str) -> bool:
        if session_id in self._research_sessions:
            del self._research_sessions[session_id]
            self._save_research_sessions()
            return True
        return False


# Tile layout for the "Realm" canvas view. Coordinates are in 64px tiles; every building points at a real system_map node
# so the picture can only show state the backend actually reports.
WORLD_COLS, WORLD_ROWS = 24, 13
_BUILDINGS = [
    ("library", "reality", "RAG Library", 1, 1, 4, 3, None),
    ("prime", "prime", "Prime Architect", 7, 1, 4, 3, None),
    ("citadel", "authgate", "Citadel of AuthGate", 13, 1, 4, 3, None),
    ("spire", "timelock", "Time-Lock Spire", 19, 1, 3, 3, None),
    ("arena", "cii", "Module 10 Arena", 1, 5, 4, 3, None),
    ("vera", "vera", "Vera Tower", 7, 5, 4, 3, None),
    ("breaker", "breaker", "Circuit Breaker", 13, 5, 3, 3, None),
    ("anchor", "anchor", "Anchor Obelisk", 19, 5, 3, 3, None),
    ("redsink", "red_sink", "Fortress of Red Sink", 1, 9, 4, 3, None),
    ("forge", "forge", "Forge Workshop", 7, 9, 4, 3, None),
    ("keep", "treasury", "Gold Keep (Tier 1)", 13, 9, 3, 3, 1),
    ("mill", "treasury", "Industrial Mill (Tier 2)", 16, 9, 3, 3, 2),
    ("crystal", "treasury", "Crystal Tower (Tier 3)", 19, 9, 3, 3, 3),
]
_STAGE_BUILDING = {"OBSERVE": "library", "ANALYZE": "prime", "PROPOSE": "prime", "HUMAN_AUTHORIZATION": "citadel",
                   "EXECUTE": "forge", "RECORD": "redsink", "REVIEW": "vera"}


def node_status(node: Dict[str, Any]) -> str:
    x = node.get("state") or {}
    if x.get("chain_valid") is False or x.get("valid") is False or x.get("key_revoked") or x.get("kill_switch"):
        return "bad"
    if (x.get("awaiting_human") or 0) > 0 or (x.get("blocked_proposals") or 0) > 0 or (x.get("vetoes_in_force") or 0) > 0 \
            or (x.get("pending_overrides") or 0) > 0 or (x.get("alerts") or 0) > 0 \
            or x.get("mode") == "SOFTWARE_SIMULATION" or x.get("configured") is False:
        return "warn"
    return "ok"


def world_layout(nodes: List[Dict[str, Any]], stages: List[str], treasury: Any) -> Dict[str, Any]:
    by_id = {n["id"]: n for n in nodes}
    buildings = []
    for bid, nid, label, x, y, w, h, tier in _BUILDINGS:
        status = node_status(by_id[nid])
        extra: Dict[str, Any] = {}
        if tier:
            if treasury is None:
                status = "warn"
            elif tier == 3:
                over = bool(treasury.tier3_over_cap)
                extra["frozen"] = any(treasury.tier3_projects.values())
                status = "bad" if over else ("warn" if extra["frozen"] else "ok")
            else:
                status = "ok"
            extra["tier"] = tier
        buildings.append({"id": bid, "node": nid, "label": label, "tile": {"x": x, "y": y, "w": w, "h": h},
                          "status": status, **extra})
    pos = {b["id"]: (b["tile"]["x"] + b["tile"]["w"] / 2, b["tile"]["y"] + b["tile"]["h"] / 2) for b in buildings}
    path = ["library", "prime", "citadel", "forge", "redsink", "vera"]
    roads = [{"from": a, "to": b} for a, b in zip(path, path[1:])] + [{"from": "vera", "to": "citadel"}, {"from": "citadel", "to": "spire"}]
    c = lambda b: {"x": pos[b][0], "y": pos[b][1]}
    agents = [{"id": "prime", "color": "#60a5fa", "patrol": [c("library"), c("prime"), c("citadel")]},
              {"id": "vera", "color": "#fbbf24", "patrol": [c("vera"), {"x": 12.0, "y": 4.2}, c("citadel")]},
              {"id": "forge", "color": "#34d399", "patrol": [{"x": 8.0, "y": 10.5}, {"x": 9.0, "y": 11.0}, {"x": 10.0, "y": 10.5}]}]
    return {"tile_px": 64, "cols": WORLD_COLS, "rows": WORLD_ROWS, "buildings": buildings, "roads": roads, "agents": agents,
            "stage_building": {s: _STAGE_BUILDING[s] for s in stages}}



def create_app(state_dir: Path, *, demo: bool = False, treasury: Optional[ThreeTierLedger] = None,
               clock: Optional[Callable[[], datetime]] = None, override_time_lock: bool = True,
               hardware: Optional[HardwareDiagnosticHarness] = None,
               demo_missions: bool = False) -> FastAPI:
    st = UiState(state_dir, clock or (lambda: datetime.now(timezone.utc)), treasury, override_time_lock)
    harness = hardware or HardwareDiagnosticHarness()
    hw_cache: Dict[str, Any] = {}
    session_secret = secrets.token_urlsafe(24)
    app = FastAPI(title="Lake Yange Command Center", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.ui = st
    app.state.session_secret = session_secret

    @app.middleware("http")
    async def guard(request: Request, call_next: Any) -> Any:
        host = (request.headers.get("host") or "").split(":")[0]
        if host not in ALLOWED_HOSTS:
            return JSONResponse({"detail": "Host not allowed (loopback only)."}, status_code=403)
        if request.method not in ("GET", "HEAD"):
            origin = request.headers.get("origin")
            if origin and origin.split("://")[-1].split(":")[0] not in ALLOWED_HOSTS:
                return JSONResponse({"detail": "Cross-origin write refused."}, status_code=403)
            if not secrets.compare_digest(request.headers.get("x-ly-session", ""), session_secret):
                return JSONResponse({"detail": "Missing or invalid session header."}, status_code=403)
        resp = await call_next(request)
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["Content-Security-Policy"] = ("default-src 'self'; style-src 'self' 'unsafe-inline'; "
                                                   "script-src 'self' 'unsafe-inline'; connect-src 'self'")
        return resp

    def record_or_404(pid: str) -> Any:
        r = st.gateway.records.get(pid)
        if r is None:
            raise HTTPException(404, f"Unknown proposal {pid}.")
        return r

    def fail(exc: Exception) -> HTTPException:
        code = 423 if isinstance(exc, TimeLockActive) else 403 if isinstance(exc, (InvalidSignature, TokenError)) else \
            403 if isinstance(exc, InsufficientSignatures) or str(exc).startswith("Blocked by Vera") else 409
        return HTTPException(code, str(exc))

    def view(pid: str, r: Any) -> Dict[str, Any]:
        lc = r.lifecycle
        unlock = r.submitted_at + TIME_LOCKS[r.tier]
        now = st.clock()
        awaiting = lc.current is Stage.HUMAN_AUTHORIZATION and not lc.rejected
        tokens = [{"expires_at": t["exp"], "seconds_left": max(0, t["exp"] - int(now.timestamp()))}
                  for t in st.gate.active_tokens().values() if t["proposal_id"] == pid]
        return {
            "id": pid, "agent_id": r.proposal.agent_id, "action_type": r.proposal.action_type,
            "target_system": r.proposal.target_system, "justification": r.proposal.justification,
            "amount_usd": _dec(r.proposal.amount_usd), "tier": r.tier, "tier_label": TIER_LABEL[r.tier],
            "signatures_required": {0: 0, 1: 1, 2: 2, 3: 3}[r.tier],
            "time_lock_until": unlock.isoformat() if TIME_LOCKS[r.tier].total_seconds() else None,
            "time_lock_active": now < unlock, "proposal_hash": r.p_hash, "status": r.status,
            "veto_reason": r.veto_reason, "stage": lc.current.value, "completed": [s.value for s in lc.completed],
            "rejected": lc.rejected, "awaiting_human": awaiting, "result": r.result, "active_tokens": tokens,
            "override_required": OVERRIDE_SIGNATURES_REQUIRED if r.status == "BLOCKED_BY_VERA" else 0,
            "override_timelock": st.time_lock.status(pid) if st.time_lock else None,
        }

    def mission_for(pid: str) -> Optional[Dict[str, Any]]:
        if st.missions is None:
            return None
        return next((m for m in st.store.all("mission").values() if m.get("proposal_id") == pid), None)

    def need_missions() -> MissionEngine:
        if st.missions is None:
            raise HTTPException(503, "Mission engine disabled (an agent session key is revoked).")
        return st.missions

    def mission_view(m: Dict[str, Any]) -> Dict[str, Any]:
        out = dict(m)
        out["signatures_required"] = max(1, {0: 0, 1: 1, 2: 2, 3: 3}[m["tier"]]) if m.get("tier") is not None else None
        out["token_seconds_left"] = None
        tok = st.missions._tokens.get(m["id"]) if st.missions else None
        if tok and m["state"] == "SANDBOX":
            try:
                info = st.gate.inspect_token(tok, m["proposal_id"], m["p_hash"])
                out["token_seconds_left"] = int(info["seconds_left"])
            except TokenError:
                pass
        return out

    # ---- reads ----
    @app.get("/", response_class=HTMLResponse)
    def index() -> HTMLResponse:
        html = (UI_DIR / "index.html").read_text(encoding="utf-8").replace("__SESSION_TOKEN__", session_secret)
        return HTMLResponse(html)

    @app.get("/api/status")
    def status() -> Dict[str, Any]:
        try:
            st.ledger.verify()
            chain = True
        except LedgerIntegrityError:
            chain = False
        return {"air_gapped": True, "system": "NOMINAL" if chain and not st.breaker.killed else "DEGRADED",
                "kill_switch": st.breaker.killed, "chain_valid": chain, "demo": bool((st.store.get("ui", "treasury") or {}).get("demo")),
                "alerts": st.breaker.alerts[-10:], "stages": [s.value for s in ORDER], "now": st.clock().isoformat()}

    @app.get("/api/proposals")
    def proposals() -> List[Dict[str, Any]]:
        return [view(pid, r) for pid, r in st.gateway.records.items()]

    @app.get("/api/proposals/grouped")
    def proposals_grouped() -> Dict[str, Any]:
        """
        Returns proposals grouped by tier, then separated by Vera veto status.
        Structure: {"0": {normal: [proposal, ...], vera_veto: [proposal, ...]}, ...}
        """
        grouped: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
        for pid, r in st.gateway.records.items():
            tier = str(r.tier)
            if tier not in grouped:
                grouped[tier] = {"normal": [], "vera_veto": []}
            v = view(pid, r)
            if r.status == "BLOCKED_BY_VERA":
                grouped[tier]["vera_veto"].append(v)
            else:
                grouped[tier]["normal"].append(v)
        return grouped

    @app.get("/api/proposals/{pid}/signing-message")
    def signing_message(pid: str, decision: str = "APPROVE") -> Dict[str, Any]:
        r = record_or_404(pid)
        if decision not in ("APPROVE", "REJECT", OVERRIDE_DECISION, CANCEL_DECISION):
            raise HTTPException(422, "Unknown decision.")
        tier = 3 if decision in (OVERRIDE_DECISION, CANCEL_DECISION) else r.tier
        msg = approval_message(pid, r.p_hash, tier, decision)
        return {"proposal_id": pid, "decision": decision, "tier": tier,
                "message_utf8": msg.decode(), "message_b64": base64.b64encode(msg).decode()}

    @app.get("/api/stewards")
    def stewards() -> List[Dict[str, Any]]:
        return [{"steward_id": sid, "origin": rec["origin"], "revoked": bool(rec.get("revoked")),
                 "public_hex": rec["public_hex"]} for sid, rec in sorted(st.store.all("steward").items())]

    @app.get("/api/stewards/{sid}/revoke-message")
    def revoke_message(sid: str, reason: str) -> Dict[str, Any]:
        if st.store.get("steward", sid) is None:
            raise HTTPException(404, "Unknown steward.")
        msg = approval_message(*revoke_message_parts(sid, reason))
        return {"steward_id": sid, "message_utf8": msg.decode(), "message_b64": base64.b64encode(msg).decode()}

    @app.get("/api/agents/{agent_id}/revoked")
    def agent_revoked(agent_id: str) -> Dict[str, Any]:
        """
        Check if an agent's session key has been revoked.
        Used for displaying revocation status in the UI.
        """
        return {
            "agent_id": agent_id,
            "revoked": st.breaker.is_revoked(agent_id)
        }

    @app.get("/api/missions")
    def missions_list() -> List[Dict[str, Any]]:
        return [mission_view(m) for m in need_missions().list()]

    @app.get("/api/missions/{mid}")
    def mission_get(mid: str) -> Dict[str, Any]:
        eng = need_missions()
        eng.list()
        try:
            return mission_view(eng.get(mid))
        except MissionStateError as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.get("/api/treasury")
    def treasury_view() -> Dict[str, Any]:
        t = st.treasury()
        if t is None:
            return {"configured": False}
        return {"configured": True, "demo": bool((st.store.get("ui", "treasury") or {}).get("demo")),
                "tier1": _dec(t.tier1), "tier2": _dec(t.tier2), "tier3": _dec(t.tier3),
                "total": _dec(t.total), "monthly_burn": _dec(t.monthly_essential_burn),
                "tier1_required": _dec(t.tier1_required), "tier1_runway_months": _dec(t.tier1_runway_months),
                "tier1_funded_pct": _dec(t.tier1_funded_pct),
                "tier3_pct": _dec(t.tier3 / t.total * 100) if t.total else "0.00", "tier3_cap_pct": _dec(t.tier3_cap_fraction * 100),
                "tier3_over_cap": t.tier3_over_cap, "projects": t.tier3_projects}

    @app.get("/api/cii")
    def cii() -> Dict[str, Any]:
        rows, vals = [], []
        for sid, d in sorted(st.store.all("cii").items()):
            r = compute_cii(d["mode_a"], d["mode_b"])
            rows.append({"subject": sid, "cii": round(r.cii, 1), "alert": r.alert, "recommendation": r.recommendation})
            vals.append(r.cii)
        return {"mean": round(sum(vals) / len(vals), 1) if vals else None, "threshold": CII_ALERT_THRESHOLD,
                "subjects": rows, "alerts": [x for x in rows if x["alert"]],
                "note": "Module 10 enrolment is a recommendation; no enrolment is performed automatically."}

    @app.get("/api/audit")
    def audit(limit: int = 50) -> Dict[str, Any]:
        limit = max(1, min(limit, 500))
        entries = st.ledger.entries
        return {"total": len(entries), "entries": [e.model_dump() for e in entries[-limit:]]}

    @app.get("/api/hardware")
    def hardware_view() -> Dict[str, Any]:
        now = st.clock().timestamp()
        if not hw_cache or now - hw_cache["at"] > 30:
            hw_cache.update(at=now, report=harness.report())
        return hw_cache["report"]

    @app.get("/api/anchor/verify")
    def anchor_verify() -> Dict[str, Any]:
        anchors, pub = st.dir / "anchors.jsonl", st.dir / "anchor_witness.pub"
        if not anchors.exists() or not pub.exists():
            return {"configured": False, "note": "No external anchor file / witness public key in the state dir."}
        try:
            rep = verify_anchor_chain(st.dir / "ledger.jsonl", anchors, bytes.fromhex(pub.read_text().strip()))
        except Exception as exc:
            return {"configured": True, "valid": False, "problems": [f"anchor check failed closed: {exc}"]}
        return {"configured": True, **rep.to_dict()}

    @app.get("/api/audit/verify")
    def audit_verify() -> Dict[str, Any]:
        try:
            st.ledger.verify()
        except LedgerIntegrityError as exc:
            return {"valid": False, "reason": str(exc)}
        es = st.ledger.entries
        return {"valid": True, "entries": len(es), "head": es[-1].hash if es else None}

    # ---- writes (all go through the governed gateway) ----
    @app.post("/api/proposals/{pid}/authorize")
    def authorize(pid: str, body: AuthorizeBody) -> Dict[str, Any]:
        record_or_404(pid)
        try:
            m = mission_for(pid)
            if m is not None and st.missions is not None and not body.emergency_override:
                st.missions.authorize(m["id"], [s.to_gate() for s in body.signatures])  # keeps the mission in step
                token = st.missions._tokens[m["id"]]
            else:
                token = st.gateway.authorize(pid, [s.to_gate() for s in body.signatures],
                                             [s.to_gate() for s in body.emergency_override] or None)
            # Clear pending signatures after successful authorization
            st.clear_pending_signatures(pid)
        except MissionStateError as exc:
            raise HTTPException(409, str(exc)) from exc
        except GateError as exc:
            raise fail(exc) from exc
        info = st.gate.inspect_token(token, pid, st.gateway.records[pid].p_hash)
        return {"token": token, **info, "proposal": view(pid, st.gateway.records[pid])}

    @app.post("/api/rag/ingest")
    def rag_ingest(body: IngestBody) -> Dict[str, Any]:
        try:
            return {"source_id": body.source_id, "doc_hash": st.rag.ingest(body.source_id, body.text)}
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/api/missions")
    def mission_create(body: MissionBody) -> Dict[str, Any]:
        eng = need_missions()
        try:
            m = eng.create(body.objective, body.tool, body.amount_usd)
            if body.auto_plan:
                m = eng.plan(m["id"])  # stops at the 50% human gate or at a Vera veto
        except MissionStateError as exc:
            raise HTTPException(409, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(422, f"{type(exc).__name__}: {exc}"[:400]) from exc
        return mission_view(m)

    @app.post("/api/missions/{mid}/authorize")
    def mission_authorize(mid: str, body: MissionAuthBody) -> Dict[str, Any]:
        eng = need_missions()
        try:
            return mission_view(eng.authorize(mid, [s.to_gate() for s in body.signatures]))
        except MissionStateError as exc:
            raise HTTPException(409, str(exc)) from exc
        except GateError as exc:
            raise fail(exc) from exc

    @app.post("/api/missions/{mid}/run")
    def mission_run(mid: str) -> Dict[str, Any]:
        eng = need_missions()
        try:
            return mission_view(eng.run(mid))
        except MissionStateError as exc:
            raise HTTPException(409, str(exc)) from exc
        except GateError as exc:
            raise fail(exc) from exc

    @app.post("/api/stewards/{sid}/revoke")
    def steward_revoke(sid: str, body: RevokeBody) -> Dict[str, Any]:
        """Any ACTIVE steward may flag any key (including their own) as compromised by signing the revoke message.
        Revocation only ever removes authority, so a single signature suffices; it is irreversible via the API."""
        if st.store.get("steward", sid) is None:
            raise HTTPException(404, "Unknown steward.")
        if st.gate.is_steward_revoked(sid):
            raise HTTPException(409, "Steward key already revoked.")
        pid, ph, tier, dec = revoke_message_parts(sid, body.reason)
        try:
            st.gate.verify_signatures(pid, ph, tier, dec, [body.signature.to_gate()])
        except GateError as exc:
            raise fail(exc) from exc
        st.gate.revoke_steward(sid)
        entry = st.red_sink.record(agent_id=body.signature.steward_id, decision="REVOCATION_EVENT",
                                   reason=f"Steward key {sid} revoked as compromised: {body.reason}",
                                   evidence_hash=ph, result="steward key revoked")
        return {"steward_id": sid, "revoked": True, "ledger_index": entry.index, "ledger_hash": entry.hash}

    @app.post("/api/proposals/{pid}/reject")
    def reject(pid: str, body: RejectBody) -> Dict[str, Any]:
        r = record_or_404(pid)
        try:
            st.gateway.reject(pid, body.signature.to_gate(), body.reason)
        except GateError as exc:
            raise fail(exc) from exc
        except Exception as exc:  # lifecycle violation: not awaiting the gate
            raise HTTPException(409, str(exc)) from exc
        if body.revoke_agent_key:
            st.breaker.revoke(r.proposal.agent_id, f"Revoked by steward {body.signature.steward_id} on rejection",
                              r.p_hash)
        # Clear pending signatures after rejection
        st.clear_pending_signatures(pid)
        return view(pid, r)

    @app.post("/api/proposals/{pid}/override/cancel")
    def cancel_override(pid: str, body: CancelBody) -> Dict[str, Any]:
        r = record_or_404(pid)
        try:
            st.gateway.cancel_override(pid, [s.to_gate() for s in body.signatures])
        except GateError as exc:
            raise fail(exc) from exc
        # Clear pending signatures after override cancellation
        st.clear_pending_signatures(pid)
        return view(pid, r)

    @app.post("/api/proposals/{pid}/token/verify")
    def token_verify(pid: str, body: TokenBody) -> Dict[str, Any]:
        r = record_or_404(pid)
        try:
            return {"valid": True, **st.gate.inspect_token(body.token, pid, r.p_hash)}
        except TokenError as exc:
            raise HTTPException(403, str(exc)) from exc

    # ---- Pending Signatures for Hybrid Sync ----
    @app.get("/api/proposals/{pid}/signatures")
    def get_pending_signatures(pid: str) -> Dict[str, Any]:
        """
        Retrieve pending signatures collected from other stewards for this proposal.
        Used for hybrid sync: local session + server state.
        """
        r = record_or_404(pid)
        pending = st.get_pending_signatures(pid)
        return {
            "proposal_id": pid,
            "signatures": [
                {"steward_id": sid, **data}
                for sid, data in pending.items()
            ],
            "total": len(pending),
            "proposal_hash": r.p_hash,
            "tier": r.tier
        }

    @app.post("/api/proposals/{pid}/signatures")
    def add_pending_signature(pid: str, body: PendingSignature) -> Dict[str, Any]:
        """
        Store a pending signature for hybrid sync.
        Does NOT authorize the proposal; only stores for later retrieval by other stewards.
        """
        record_or_404(pid)
        try:
            tier = st.gateway.records[pid].tier
            if body.decision in (OVERRIDE_DECISION, CANCEL_DECISION):
                tier = 3
            if len(body.signature_b64) > 256:
                raise HTTPException(400, "Signature too long")
            st.add_pending_signature(pid, body.steward_id, body.signature_b64, body.decision)
            return {
                "status": "stored",
                "proposal_id": pid,
                "steward_id": body.steward_id,
                "decision": body.decision
            }
        except Exception as exc:
            raise HTTPException(400, str(exc))

    @app.delete("/api/proposals/{pid}/signatures")
    def clear_pending_signatures_endpoint(pid: str) -> Dict[str, Any]:
        """
        Clear all pending signatures for a proposal.
        Typically called after successful authorization or rejection.
        """
        record_or_404(pid)
        st.clear_pending_signatures(pid)
        return {"status": "cleared", "proposal_id": pid}

    @app.delete("/api/proposals/{pid}/signatures/{steward_id}")
    def remove_pending_signature(pid: str, steward_id: str) -> Dict[str, Any]:
        """
        Remove a specific pending signature.
        """
        record_or_404(pid)
        if pid in st._pending_signatures and steward_id in st._pending_signatures[pid]:
            del st._pending_signatures[pid][steward_id]
            st._save_pending_signatures()
        return {"status": "removed", "proposal_id": pid, "steward_id": steward_id}

    @app.post("/api/treasury/scenario-c")
    def scenario_c() -> Dict[str, Any]:
        t = st.treasury()
        if t is None:
            raise HTTPException(409, "Treasury is not configured.")
        result = Simulator(t).run_scenario_c_major_loss()
        after = copy.deepcopy(t)
        after.apply_market_move(Decimal("0.50"), Decimal("0.50"))
        return {"simulated": True, "mutated_real_state": False, "result": json.loads(result.model_dump_json()),
                "after": {"tier1": _dec(after.tier1), "tier2": _dec(after.tier2), "tier3": _dec(after.tier3),
                          "tier1_funded_pct": _dec(after.tier1_funded_pct), "projects": after.tier3_projects}}

    # ---- unified hub ----
    def system_map() -> Dict[str, Any]:
        props = list(st.gateway.records.values())
        blocked = [r for r in props if r.status == "BLOCKED_BY_VERA"]
        pending = [x for x in (st.time_lock.status(pid) for pid in st.gateway.records) if x and x["state"] == "PENDING_TIME_LOCK"] if st.time_lock else []
        stew = st.store.all("steward")
        es = st.ledger.entries
        hw = hardware_view()
        t = st.treasury()
        crii = cii()
        awaiting = sum(1 for r in props if r.lifecycle.current is Stage.HUMAN_AUTHORIZATION and not r.lifecycle.rejected)
        nodes = [
            {"id": "reality", "kind": "pillar", "label": "Reality", "summary": "Claims must trace to verifiable evidence.",
             "source": "lake_yange/agents/vera.py", "state": {"vetoes_in_force": len(blocked)}},
            {"id": "integrity", "kind": "pillar", "label": "Integrity", "summary": "History cannot be silently rewritten.",
             "source": "lake_yange/audit/ledger.py", "state": {"ledger_blocks": len(es)}},
            {"id": "governance", "kind": "pillar", "label": "Governance", "summary": "Intelligence is not authority (Art. 10.1).",
             "source": "lake_yange/middleware/gateway.py", "state": {"awaiting_human": awaiting}},
            {"id": "human_agency", "kind": "pillar", "label": "Human Agency", "summary": "Only humans authorize; right of exit.",
             "source": "lake_yange/middleware/auth_gate.py", "state": {"stewards": len(stew)}},
            {"id": "prime", "kind": "agent", "label": "Prime", "summary": "Plans and PROPOSES only.",
             "source": "lake_yange/agents/prime.py", "state": {"key_revoked": st.breaker.is_revoked("prime")}},
            {"id": "vera", "kind": "agent", "label": "Vera Veto", "summary": "Audits evidence; veto enforced in the gateway.",
             "source": "lake_yange/middleware/gateway.py:vera_veto", "state": {"blocked_proposals": len(blocked)}},
            {"id": "authgate", "kind": "control", "label": "AuthGate", "summary": "Ed25519 quorum, tier time-locks, 60s single-use JWT.",
             "source": "lake_yange/middleware/auth_gate.py", "state": {
                 "stewards": len(stew), "revoked_stewards": sum(1 for v in stew.values() if v.get("revoked")),
                 "active_tokens": len(st.gate.active_tokens()), "awaiting_human": awaiting}},
            {"id": "timelock", "kind": "control", "label": "TimeLockEngine", "summary": "24h cooling for emergency overrides; 2-steward cancel.",
             "source": "lake_yange/middleware/time_lock.py", "state": {"enabled": st.time_lock is not None, "pending_overrides": len(pending)}},
            {"id": "forge", "kind": "agent", "label": "Forge", "summary": "Executes only with a valid token, in a sandbox.",
             "source": "lake_yange/agents/forge.py", "state": {"key_revoked": st.breaker.is_revoked("forge")}},
            {"id": "red_sink", "kind": "control", "label": "Red Sink", "summary": "SHA-256 chained, anchored audit ledger.",
             "source": "lake_yange/audit/ledger.py", "state": {"blocks": len(es), "head": es[-1].hash[:16] if es else None,
                                                              "chain_valid": audit_verify()["valid"]}},
            {"id": "anchor", "kind": "control", "label": "External Anchor", "summary": "Signed head hashes held off-host.",
             "source": "lake_yange/audit/anchor.py", "state": anchor_verify()},
            {"id": "breaker", "kind": "control", "label": "Circuit Breaker", "summary": "Non-retroactivity: bypass revokes keys.",
             "source": "lake_yange/middleware/circuit_breaker.py", "state": {"kill_switch": st.breaker.killed, "alerts": len(st.breaker.alerts)}},
            {"id": "treasury", "kind": "domain", "label": "Three-Tier Treasury", "summary": "Tier 1 runway protected; Tier 3 capped at 20%.",
             "source": "lake_yange/treasury/three_tier_ledger.py", "state": {"configured": t is not None,
                 "tier1_funded_pct": _dec(t.tier1_funded_pct) if t else None}},
            {"id": "cii", "kind": "domain", "label": "CII (Phase III)", "summary": "Cognitive Independence Index; alert below 60%.",
             "source": "lake_yange/experiments/cognitive_index.py", "state": {"mean": crii["mean"], "alerts": len(crii["alerts"])}},
            {"id": "hardware", "kind": "control", "label": "Hardware / Containers", "summary": "Detection only; fails closed to simulation.",
             "source": "lake_yange/hardware/diagnostics.py", "state": {"mode": hw["mode"]}},
        ]
        stages = [s.value for s in ORDER]
        edges = [{"from": a, "to": b, "kind": "flow"} for a, b in zip(stages, stages[1:])]
        edges += [{"from": a, "to": b, "kind": "uses"} for a, b in [
            ("reality", "vera"), ("integrity", "red_sink"), ("integrity", "anchor"), ("governance", "authgate"),
            ("governance", "timelock"), ("governance", "breaker"), ("human_agency", "authgate"), ("human_agency", "timelock"),
            ("prime", "PROPOSE"), ("vera", "ANALYZE"), ("authgate", "HUMAN_AUTHORIZATION"), ("timelock", "HUMAN_AUTHORIZATION"),
            ("forge", "EXECUTE"), ("red_sink", "RECORD"), ("vera", "REVIEW"), ("treasury", "governance"), ("cii", "reality")]]
        return {"pillars": [n["id"] for n in nodes if n["kind"] == "pillar"], "stages": stages, "nodes": nodes, "edges": edges,
                "world": world_layout(nodes, stages, t)}

    @app.get("/api/system/map")
    def system_map_route() -> Dict[str, Any]:
        return system_map()

    @app.get("/api/state/full")
    def state_full() -> Dict[str, Any]:
        es = st.ledger.entries
        out = {"status": status(), "proposals": proposals(), "stewards": stewards(), "treasury": treasury_view(),
               "cii": cii(), "audit": audit(60), "audit_verify": audit_verify(), "hardware": hardware_view(),
               "anchor": anchor_verify(), "map": system_map(),
               "missions": missions_list() if st.missions else [], "rag": {"documents": len(st.rag._db.execute(
                   "SELECT 1 FROM docs").fetchall())}}
        # changes whenever any proposal, ledger block or treasury/CII value changes; lets tabs detect drift cheaply
        out["version"] = hashlib.sha256(json.dumps({k: out[k] for k in ("proposals", "treasury", "cii")},
                                                    sort_keys=True, default=str).encode()).hexdigest()[:16] + f":{len(es)}"
        return out

    # ---- Research Helper Functions ----
    def extract_question_metadata(question: str) -> Dict[str, Any]:
        """Extract metadata from research question"""
        metadata: Dict[str, Any] = {
            "political": False,
            "economic": False,
            "jurisdictions": [],
            "topics": [],
            "entities": []
        }
        
        question_lower = question.lower()
        
        # Political keywords
        political_keywords = ['policy', 'government', 'legislation', 'law', 'parliament', 'congress', 'senate', 'constitution', 'vote', 'election', 'governance']
        if any(kw in question_lower for kw in political_keywords):
            metadata["political"] = True
        
        # Economic keywords
        economic_keywords = ['economic', 'economy', 'cost', 'budget', 'investment', 'growth', 'job', 'employment', 'infrastructure', 'tax', 'revenue']
        if any(kw in question_lower for kw in economic_keywords):
            metadata["economic"] = True
        
        # Jurisdiction detection
        jurisdiction_map = {
            'Commonwealth': ['commonwealth', 'federal', 'national', 'australia'],
            'Western Australia': ['western australia', 'wa', 'perth'],
            'State': ['state', 'states'],
            'Local Government': ['local government', 'council', 'municipal']
        }
        
        for jurisdiction, keywords in jurisdiction_map.items():
            if any(kw in question_lower for kw in keywords):
                metadata["jurisdictions"].append(jurisdiction)
        
        # Topic detection
        topic_map = {
            'AI': ['ai', 'artificial intelligence', 'machine learning'],
            'Technology': ['technology', 'tech', 'digital', 'innovation'],
            'Energy': ['energy', 'power', 'electricity', 'renewable'],
            'Transport': ['transport', 'infrastructure', 'road', 'rail', 'port'],
            'Health': ['health', 'medical', 'hospital'],
            'Education': ['education', 'school', 'university']
        }
        
        for topic, keywords in topic_map.items():
            if any(kw in question_lower for kw in keywords):
                metadata["topics"].append(topic)
        
        return metadata

    def sources_dict_to_metadata(passage: Passage, row: EvidenceRow) -> SourceMetadata:
        """Convert passage and evidence row to SourceMetadata"""
        quality = "high" if row.status == "GROUNDED" else "medium" if row.status == "SINGLE_SOURCE" else "low"
        return SourceMetadata(
            source_id=passage.source_id,
            title=passage.source_id,
            publisher="Unknown",
            publication_date=None,
            source_type="primary" if quality == "high" else "secondary",
            jurisdiction=None,
            quality=quality,
            relevance=f"Evidence for: {row.sub_question}",
            doc_hash=passage.doc_hash,
            chunk_hash=passage.chunk_hash
        )

    def classify_evidence_type(text: str) -> str:
        """Classify text as fact, interpretation, claim, opinion, or unknown"""
        text_lower = text.lower()
        
        if any(indicator in text_lower for indicator in ['states', 'reports', 'shows', 'demonstrates', 'indicates', 'according to']):
            return "fact"
        if any(indicator in text_lower for indicator in ['suggests', 'implies', 'likely', 'probably', 'may', 'could']):
            return "interpretation"
        if any(indicator in text_lower for indicator in ['claims', 'asserts', 'argues', 'alleges']):
            return "claim"
        if any(indicator in text_lower for indicator in ['believes', 'thinks', 'opinion', 'perspective']):
            return "opinion"
        return "unknown"

    def classify_confidence(report: ResearchReport, statement: Statement) -> str:
        """Classify confidence level based on evidence"""
        for row in report.matrix:
            if row.sub_question == statement.sub_question:
                if row.status == "GROUNDED":
                    return "high"
                elif row.status == "SINGLE_SOURCE":
                    return "medium"
                else:
                    return "low"
        return "unknown"

    def generate_short_answer(report: ResearchReport) -> str:
        """Generate a short answer from the research results"""
        if not report.statements:
            return "No sufficient evidence found to provide a comprehensive answer."
        
        statements_text = " ".join(s.text for s in report.statements[:3])
        return f"Based on the evidence retrieved: {statements_text}"

    def run_deep_research(st: UiState, question: str, session_id: str) -> ResearchReport:
        """Run actual deep research using existing infrastructure"""
        depth_configs = {
            "quick": {"max_rounds": 1, "k": 2, "min_score": 0.1},
            "standard": {"max_rounds": 2, "k": 3, "min_score": 0.05},
            "deep": {"max_rounds": 3, "k": 4, "min_score": 0.03},
            "investigation": {"max_rounds": 4, "k": 5, "min_score": 0.01}
        }
        
        session = st.get_research_session(session_id)
        depth = session.get("depth", "standard") if session else "standard"
        config = depth_configs.get(depth, depth_configs["standard"])
        
        research = DeepResearch(
            st.rag, 
            max_rounds=config["max_rounds"],
            k=config["k"], 
            min_score=config["min_score"]
        )
        
        try:
            st.update_research_session(session_id, {
                "status": "crosscheck",
                "stage": "crosscheck",
                "progress": 50
            })
            
            report = research.run(question)
            
            st.update_research_session(session_id, {
                "status": "analysis", 
                "stage": "analysis",
                "progress": 75
            })
            
            ver_audit_results = run_vera_audit(st, report)
            
            st.update_research_session(session_id, {
                "status": "review",
                "stage": "review", 
                "progress": 90
            })
            
            ledger_entry = record_research_provenance(st, question, report, ver_audit_results, session_id)
            
            st.update_research_session(session_id, {
                "provenance": {
                    "research_session_id": session_id,
                    "question_hash": report.report_hash,
                    "timestamp": st.clock().isoformat(),
                    "ver_audit_results": ver_audit_results,
                    "ledger_entry_hash": ledger_entry.hash if ledger_entry else None
                }
            })
            
            return report
            
        except Exception as e:
            st.update_research_session(session_id, {
                "status": "failed",
                "stage": "failed",
                "error": f"Research failed: {str(e)}",
                "progress": 0
            })
            raise

    def run_vera_audit(st: UiState, report: ResearchReport) -> List[str]:
        """Run Vera audit on research results"""
        audit_results: List[str] = []
        
        for row in report.matrix:
            if row.status == "UNGROUNDED":
                audit_results.append(f"UNGROUNDED: {row.sub_question} has no supporting evidence")
            elif row.status == "SINGLE_SOURCE":
                audit_results.append(f"SINGLE_SOURCE: {row.sub_question} has only one source (no corroboration)")
            elif row.flags:
                for flag in row.flags:
                    audit_results.append(f"FLAG: {row.sub_question} - {flag}")
        
        for ungrounded in report.ungrounded:
            audit_results.append(f"UNGROUNDED_STATEMENT: {ungrounded}")
        
        return audit_results

    def record_research_provenance(st: UiState, question: str, report: ResearchReport, ver_audit_results: List[str], session_id: str) -> Optional[Any]:
        """Record research provenance in Red Sink ledger"""
        try:
            provenance_data = {
                "research_session_id": session_id,
                "question": question,
                "question_hash": report.report_hash,
                "sub_questions": report.sub_questions,
                "sources_retrieved": len(report.passages),
                "evidence_matrix": [row.model_dump() for row in report.matrix],
                "vera_audit_results": ver_audit_results,
                "timestamp": st.clock().isoformat()
            }
            
            entry = st.red_sink.record(
                agent_id="research_engine",
                decision="RESEARCH_COMPLETED",
                reason=f"Research session {session_id}: {question[:100]}...",
                evidence_hash=report.report_hash,
                result=json.dumps(provenance_data, default=str)
            )
            return entry
            
        except Exception as e:
            logger.warning(f"Failed to record research provenance: {e}")
            return None

    def convert_to_research_response(st: UiState, session_id: str, report: ResearchReport) -> ResearchResponse:
        """Convert DeepResearch report to frontend ResearchResponse format"""
        sources_dict: Dict[str, SourceMetadata] = {}
        for sub_q, passages in report.passages.items():
            for passage in passages:
                if passage.source_id not in sources_dict:
                    sources_dict[passage.source_id] = SourceMetadata(
                        source_id=passage.source_id,
                        title=passage.source_id,
                        publisher="Unknown",
                        publication_date=None,
                        source_type="unknown",
                        jurisdiction=None,
                        quality="medium",
                        relevance=f"Relevant to: {sub_q}",
                        doc_hash=passage.doc_hash,
                        chunk_hash=passage.chunk_hash
                    )
        
        sources = list(sources_dict.values())
        
        findings: List[Finding] = []
        for statement in report.statements:
            evidence_type = classify_evidence_type(statement.text)
            confidence = classify_confidence(report, statement)
            
            findings.append(Finding(
                text=statement.text,
                evidence_type=evidence_type,
                confidence=confidence,
                supporting_evidence=[],
                contradicting_evidence=[]
            ))
        
        evidence_supported: List[EvidenceItem] = []
        for row in report.matrix:
            if row.status == "GROUNDED":
                passages = report.passages.get(row.sub_question, [])
                if passages:
                    top_passage = passages[0]
                    evidence_supported.append(EvidenceItem(
                        text=top_passage.text,
                        source=sources_dict_to_metadata(top_passage, row),
                        confidence="high",
                        evidence_type="fact"
                    ))
        
        uncertainties: List[ResearchUncertainty] = []
        for ungrounded in report.ungrounded:
            uncertainties.append(ResearchUncertainty(
                text=ungrounded,
                reason="No supporting evidence found"
            ))
        
        for row in report.matrix:
            if row.status == "SINGLE_SOURCE":
                uncertainties.append(ResearchUncertainty(
                    text=f"{row.sub_question} has only single source",
                    reason="Lacks corroboration from multiple sources"
                ))
        
        return ResearchResponse(
            session_id=session_id,
            question=report.question,
            status="complete",
            progress=100,
            stage="review",
            short_answer=generate_short_answer(report),
            findings=findings,
            evidence_supported=evidence_supported,
            uncertainties=uncertainties,
            competing_interpretations=[],
            disagreements=[],
            sources=sources,
            metadata={"sub_questions": report.sub_questions, "sources_found": len(sources)},
            provenance=None,
            error=None,
            timestamps={
                "understanding": st.clock().isoformat(),
                "sources": st.clock().isoformat(), 
                "crosscheck": st.clock().isoformat(),
                "analysis": st.clock().isoformat(),
                "review": st.clock().isoformat()
            }
        )

    # ---- Research API ----
    @app.get("/api/research/ping")
    def research_ping() -> Dict[str, str]:
        return {"status": "research_api_working"}

    @app.post("/api/research")
    def create_research(body: ResearchRequest) -> ResearchResponse:
        # Create research session
        session_id = st.create_research_session(body.question, body.depth)
        
        # Update session status
        st.update_research_session(session_id, {
            "status": "understanding",
            "stage": "understanding",
            "progress": 10
        })
        
        # Start async research process in background
        # For now, we'll do it synchronously but return immediately with understanding status
        try:
            # Parse question for metadata
            metadata = extract_question_metadata(body.question)
            st.update_research_session(session_id, {
                "metadata": metadata,
                "timestamps": {"understanding": st.clock().isoformat()}
            })
            
            # Update to sources stage
            st.update_research_session(session_id, {
                "status": "sources",
                "stage": "sources", 
                "progress": 30
            })
            
            # Perform actual research using DeepResearch
            research_result = run_deep_research(st, body.question, session_id)
            
            # Convert to frontend format
            response = convert_to_research_response(st, session_id, research_result)
            
            # Update session with complete data
            st.update_research_session(session_id, {
                "status": "complete",
                "stage": "review",
                "progress": 100,
                **response.model_dump(exclude={"session_id", "status", "stage", "progress"})
            })
            
            return response
            
        except Exception as e:
            st.update_research_session(session_id, {
                "status": "failed", 
                "stage": "failed",
                "error": str(e),
                "progress": 0
            })
            return ResearchResponse(
                session_id=session_id,
                question=body.question,
                status="failed",
                stage="failed",
                error=str(e)
            )

    @app.get("/api/research/{session_id}")
    def get_research_session(session_id: str) -> ResearchResponse:
        session = st.get_research_session(session_id)
        if session is None:
            raise HTTPException(404, f"Research session {session_id} not found")
        
        # Convert stored session to ResearchResponse format
        return ResearchResponse(
            session_id=session_id,
            question=session.get("question", ""),
            status=session.get("status", "unknown"),
            progress=session.get("progress", 0),
            stage=session.get("stage", "unknown"),
            short_answer=session.get("short_answer"),
            findings=session.get("findings", []),
            evidence_supported=session.get("evidence_supported", []),
            uncertainties=session.get("uncertainties", []),
            competing_interpretations=session.get("competing_interpretations", []),
            disagreements=session.get("disagreements", []),
            sources=session.get("sources", []),
            metadata=session.get("metadata", {}),
            provenance=session.get("provenance"),
            error=session.get("error"),
            timestamps=session.get("timestamps", {})
        )

    @app.get("/api/research")
    def list_research_sessions() -> List[Dict[str, Any]]:
        return st.list_research_sessions()

    @app.delete("/api/research/{session_id}")
    def delete_research_session(session_id: str) -> Dict[str, bool]:
        success = st.delete_research_session(session_id)
        return {"success": success}

    if demo:
        if any(kw in question_lower for kw in political_keywords):
            metadata["political"] = True
        
        # Economic keywords
        economic_keywords = ['economic', 'economy', 'cost', 'budget', 'investment', 'growth', 'job', 'employment', 'infrastructure', 'tax', 'revenue']
        if any(kw in question_lower for kw in economic_keywords):
            metadata["economic"] = True
        
        # Jurisdiction detection
        jurisdiction_map = {
            'Commonwealth': ['commonwealth', 'federal', 'national', 'australia'],
            'Western Australia': ['western australia', 'wa', 'perth'],
            'State': ['state', 'states'],
            'Local Government': ['local government', 'council', 'municipal']
        }
        
        for jurisdiction, keywords in jurisdiction_map.items():
            if any(kw in question_lower for kw in keywords):
                metadata["jurisdictions"].append(jurisdiction)
        
        # Topic detection
        topic_map = {
            'AI': ['ai', 'artificial intelligence', 'machine learning'],
            'Technology': ['technology', 'tech', 'digital', 'innovation'],
            'Energy': ['energy', 'power', 'electricity', 'renewable'],
            'Transport': ['transport', 'infrastructure', 'road', 'rail', 'port'],
            'Health': ['health', 'medical', 'hospital'],
            'Education': ['education', 'school', 'university']
        }
        
        for topic, keywords in topic_map.items():
            if any(kw in question_lower for kw in keywords):
                metadata["topics"].append(topic)
        
        return metadata

    def run_deep_research(st: UiState, question: str, session_id: str) -> ResearchReport:
        """Run actual deep research using existing infrastructure"""
        # Configure depth parameters based on research depth
        depth_configs = {
            "quick": {"max_rounds": 1, "k": 2, "min_score": 0.1},
            "standard": {"max_rounds": 2, "k": 3, "min_score": 0.05},
            "deep": {"max_rounds": 3, "k": 4, "min_score": 0.03},
            "investigation": {"max_rounds": 4, "k": 5, "min_score": 0.01}
        }
        
        session = st.get_research_session(session_id)
        depth = session.get("depth", "standard") if session else "standard"
        config = depth_configs.get(depth, depth_configs["standard"])
        
        # Run DeepResearch
        research = DeepResearch(
            st.rag, 
            max_rounds=config["max_rounds"],
            k=config["k"], 
            min_score=config["min_score"]
        )
        
        try:
            # Update to crosscheck stage
            st.update_research_session(session_id, {
                "status": "crosscheck",
                "stage": "crosscheck",
                "progress": 50
            })
            
            report = research.run(question)
            
            # Update to analysis stage
            st.update_research_session(session_id, {
                "status": "analysis", 
                "stage": "analysis",
                "progress": 75
            })
            
            # Perform Vera audit on the research results
            ver_audit_results = run_vera_audit(st, report)
            
            # Update to review stage
            st.update_research_session(session_id, {
                "status": "review",
                "stage": "review", 
                "progress": 90
            })
            
            # Record in Red Sink
            ledger_entry = record_research_provenance(st, question, report, ver_audit_results, session_id)
            
            # Update with provenance
            st.update_research_session(session_id, {
                "provenance": {
                    "research_session_id": session_id,
                    "question_hash": report.report_hash,
                    "timestamp": st.clock().isoformat(),
                    "ver_audit_results": ver_audit_results,
                    "ledger_entry_hash": ledger_entry.hash if ledger_entry else None
                }
            })
            
            return report
            
        except Exception as e:
            st.update_research_session(session_id, {
                "status": "failed",
                "stage": "failed",
                "error": f"Research failed: {str(e)}",
                "progress": 0
            })
            raise

    def run_vera_audit(st: UiState, report: ResearchReport) -> List[str]:
        """Run Vera audit on research results"""
        audit_results = []
        
        # Check each evidence row in the matrix
        for row in report.matrix:
            if row.status == "UNGROUNDED":
                audit_results.append(f"UNGROUNDED: {row.sub_question} has no supporting evidence")
            elif row.status == "SINGLE_SOURCE":
                audit_results.append(f"SINGLE_SOURCE: {row.sub_question} has only one source (no corroboration)")
            elif row.flags:
                for flag in row.flags:
                    audit_results.append(f"FLAG: {row.sub_question} - {flag}")
        
        # Check for ungrounded statements
        for ungrounded in report.ungrounded:
            audit_results.append(f"UNGROUNDED_STATEMENT: {ungrounded}")
        
        return audit_results

    def record_research_provenance(st: UiState, question: str, report: ResearchReport, ver_audit_results: List[str], session_id: str) -> Optional[Any]:
        """Record research provenance in Red Sink ledger"""
        try:
            # Create provenance record
            provenance_data = {
                "research_session_id": session_id,
                "question": question,
                "question_hash": report.report_hash,
                "sub_questions": report.sub_questions,
                "sources_retrieved": len(report.passages),
                "evidence_matrix": [row.model_dump() for row in report.matrix],
                "vera_audit_results": ver_audit_results,
                "timestamp": st.clock().isoformat()
            }
            
            # Record in ledger via Red Sink
            entry = st.red_sink.record(
                agent_id="research_engine",
                decision="RESEARCH_COMPLETED",
                reason=f"Research session {session_id}: {question[:100]}...",
                evidence_hash=report.report_hash,
                result=json.dumps(provenance_data, default=str)
            )
            return entry
            
        except Exception as e:
            # Don't fail the research if ledger recording fails
            logger.warning(f"Failed to record research provenance: {e}")
            return None

    def sources_dict_to_metadata(passage: Passage, row: EvidenceRow) -> SourceMetadata:
        """Convert passage and evidence row to SourceMetadata"""
        quality = "high" if row.status == "GROUNDED" else "medium" if row.status == "SINGLE_SOURCE" else "low"
        return SourceMetadata(
            source_id=passage.source_id,
            title=passage.source_id,
            publisher="Unknown",
            publication_date=None,
            source_type="primary" if quality == "high" else "secondary",
            jurisdiction=None,
            quality=quality,
            relevance=f"Evidence for: {row.sub_question}",
            doc_hash=passage.doc_hash,
            chunk_hash=passage.chunk_hash
        )

    def classify_evidence_type(text: str) -> str:
        """Classify text as fact, interpretation, claim, opinion, or unknown"""
        text_lower = text.lower()
        
        # Check for factual indicators
        if any(indicator in text_lower for indicator in ['states', 'reports', 'shows', 'demonstrates', 'indicates', 'according to']):
            return "fact"
        
        # Check for interpretation indicators  
        if any(indicator in text_lower for indicator in ['suggests', 'implies', 'likely', 'probably', 'may', 'could']):
            return "interpretation"
        
        # Check for claim indicators
        if any(indicator in text_lower for indicator in ['claims', 'asserts', 'argues', 'alleges']):
            return "claim"
        
        # Check for opinion indicators
        if any(indicator in text_lower for indicator in ['believes', 'thinks', 'opinion', 'perspective']):
            return "opinion"
        
        return "unknown"

    def classify_confidence(report: ResearchReport, statement: Statement) -> str:
        """Classify confidence level based on evidence"""
        # Check if this statement's sub_question has grounded evidence
        for row in report.matrix:
            if row.sub_question == statement.sub_question:
                if row.status == "GROUNDED":
                    return "high"
                elif row.status == "SINGLE_SOURCE":
                    return "medium"
                else:
                    return "low"
        return "unknown"

    def generate_short_answer(report: ResearchReport) -> str:
        """Generate a short answer from the research results"""
        if not report.statements:
            return "No sufficient evidence found to provide a comprehensive answer."
        
        # Combine the best statements
        statements_text = " ".join(s.text for s in report.statements[:3])  # Top 3 statements
        return f"Based on the evidence retrieved: {statements_text}"

    def convert_to_research_response(st: UiState, session_id: str, report: ResearchReport) -> ResearchResponse:
        """Convert DeepResearch report to frontend ResearchResponse format"""
        # Build source metadata from passages
        sources_dict = {}
        for sub_q, passages in report.passages.items():
            for passage in passages:
                if passage.source_id not in sources_dict:
                    sources_dict[passage.source_id] = {
                        "source_id": passage.source_id,
                        "title": passage.source_id,  # Use source_id as title for now
                        "publisher": "Unknown",
                        "publication_date": None,
                        "source_type": "unknown",
                        "jurisdiction": None,
                        "quality": "medium",
                        "relevance": f"Relevant to: {sub_q}",
                        "doc_hash": passage.doc_hash,
                        "chunk_hash": passage.chunk_hash
                    }
        
        sources = list(sources_dict.values())
        
        # Build findings from statements
        findings = []
        for statement in report.statements:
            # Determine evidence type based on content
            evidence_type = classify_evidence_type(statement.text)
            confidence = classify_confidence(report, statement)
            
            findings.append(Finding(
                text=statement.text,
                evidence_type=evidence_type,
                confidence=confidence,
                supporting_evidence=[],
                contradicting_evidence=[]
            ))
        
        # Build evidence supported items
        evidence_supported = []
        for row in report.matrix:
            if row.status == "GROUNDED":
                # Get the best passage for this sub_question
                passages = report.passages.get(row.sub_question, [])
                if passages:
                    top_passage = passages[0]
                    evidence_supported.append(EvidenceItem(
                        text=top_passage.text,
                        source=sources_dict_to_metadata(top_passage, row),
                        confidence="high",
                        evidence_type="fact"
                    ))
        
        # Build uncertainties
        uncertainties = []
        for ungrounded in report.ungrounded:
            uncertainties.append(ResearchUncertainty(
                text=ungrounded,
                reason="No supporting evidence found"
            ))
        
        # Add matrix-based uncertainties
        for row in report.matrix:
            if row.status == "SINGLE_SOURCE":
                uncertainties.append(ResearchUncertainty(
                    text=f"{row.sub_question} has only single source",
                    reason="Lacks corroboration from multiple sources"
                ))
        
        # Build competing interpretations from conflicting sources
        competing_interpretations = []
        # This would require more sophisticated analysis
        
        # Build disagreements
        disagreements = []
        # This would require identifying conflicting passages
        
        return ResearchResponse(
            session_id=session_id,
            question=report.question,
            status="complete",
            progress=100,
            stage="review",
            short_answer=generate_short_answer(report),
            findings=findings,
            evidence_supported=evidence_supported,
            uncertainties=uncertainties,
            competing_interpretations=competing_interpretations,
            disagreements=disagreements,
            sources=sources,
            metadata={"sub_questions": report.sub_questions, "sources_found": len(sources)},
            provenance=None,  # Will be added separately
            error=None,
            timestamps={
                "understanding": st.clock().isoformat(),
                "sources": st.clock().isoformat(), 
                "crosscheck": st.clock().isoformat(),
                "analysis": st.clock().isoformat(),
                "review": st.clock().isoformat()
            }
        )
    if demo:
        _seed_demo(st)
        if demo_missions:
            _seed_demo_missions(st)
    return app


def _seed_demo(st: UiState) -> None:
    """Rehearsal data only. Demo steward PRIVATE keys go to <state>/demo_stewards.json (0600) for the human to load
    in the browser; the server never signs with them."""
    if st.store.get("ui", "demo_seeded") or st.gateway.records:
        return
    keys: Dict[str, str] = {}
    for sid in ("steward-1", "steward-2", "steward-3"):
        k = Ed25519PrivateKey.generate()
        st.gate.register_steward(sid, k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
        keys[sid] = k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                    serialization.NoEncryption()).hex()
    path = st.dir / "demo_stewards.json"
    path.write_text(json.dumps({"WARNING": "DEMO KEYS - rehearsal only", "seeds_hex": keys}, indent=2))
    path.chmod(0o600)
    prime, vera = st.missions.prime, st.missions.vera  # type: ignore[union-attr]
    prime.propose("write-report", "workspace:filesystem", {"path": "report.txt"}, "Draft quarterly note", Decimal("250"))
    prime.propose("deploy-service", "prod:site", {}, "Ship the static site", Decimal("2500"))
    pid = prime.propose("vendor-payment", "prod:payments-sim", {}, "Pay vendor invoice (simulated)", Decimal("800"))
    vera.veto(pid, "Invoice evidence hash does not verify")
    t = ThreeTierLedger(Decimal("1200000"), Decimal("850000"), Decimal("320000"), Decimal("50000"))
    t.start_growth_project("growth-pilot")
    st.save_treasury(t, demo=True)
    for i, (a, b) in enumerate([(88, 90), (76, 92), (45, 90), (71, 85)], 1):
        st.store.put("cii", f"subject-{i:02d}", {"mode_a": a, "mode_b": b})
    st.store.put("ui", "demo_seeded", {"v": 1})


DEMO_DOCS = {
    "runway-policy": "Tier 1 runway reserves hold twenty four months of essential human burn in zero volatility "
                     "assets. Tier 3 growth and crypto allocations are hard capped at twenty percent and freeze when "
                     "volatility shocks occur. Runway coverage is reported monthly to the stewards.",
    "agent-charter": "Agents propose; humans authorize. Article 10.1: no agent may spend, deploy or execute without a "
                     "steward signature. Vera audits every proposal and may veto. Every action is recorded in Red Sink.",
}


def _seed_demo_missions(st: UiState) -> None:
    """Rehearsal missions: one sealed 0->100 (server-side signing with the demo seeds, demo ONLY) and one paused at
    the 50% human gate for the visitor to sign in the browser."""
    eng = st.missions
    if eng is None or st.store.get("ui", "demo_missions"):
        return
    for sid, text in DEMO_DOCS.items():
        st.rag.ingest(sid, text)
    seeds = json.loads((st.dir / "demo_stewards.json").read_text())["seeds_hex"]
    from lake_yange.middleware.auth_gate import sign_approval
    a = eng.create("Summarize the runway policy and Tier 3 cap into notes/runway.txt",
                   {"tool": "filesystem", "op": "write", "path": "notes/runway.txt",
                    "content": "Runway: 24 months Tier 1 reserve. Tier 3 cap: 20%, frozen on shock.\n"})
    eng.plan(a["id"])
    pid = eng.get(a["id"])["proposal_id"]
    rec = st.gateway.records[pid]
    sigs = [sign_approval(Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seeds["steward-1"])), "steward-1",
                          pid, rec.p_hash, rec.tier)]
    eng.authorize(a["id"], sigs)
    eng.run(a["id"])
    b = eng.create("Draft the agent charter summary into notes/charter.txt",
                   {"tool": "filesystem", "op": "write", "path": "notes/charter.txt",
                    "content": "Agents propose; humans authorize. Vera audits; Red Sink records.\n"})
    eng.plan(b["id"])
    st.store.put("ui", "demo_missions", {"v": 1})


def main() -> None:  # pragma: no cover
    import argparse
    import uvicorn
    ap = argparse.ArgumentParser()
    ap.add_argument("--state-dir", default=".lake_yange_state")
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    uvicorn.run(create_app(Path(a.state_dir), demo=a.demo, demo_missions=a.demo), host=HOST, port=PORT)


if __name__ == "__main__":  # pragma: no cover
    main()
