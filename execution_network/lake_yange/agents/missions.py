"""0 -> 100% mission pipeline: SCOPING 0, AUDIT & PROPOSAL 25, HUMAN GATE 50, SANDBOX RUN 75, SEALED 100.

A mission wraps ONE gateway proposal and adds measurable milestones and artifacts. It grants no authority: the
percent complete is derived from the gateway's own lifecycle, and every authority-bearing step (token minting,
redemption, veto, review) is still enforced by `BoundedAgentGateway` / `AuthGate`. The engine only refuses to even
ask for a step that is out of order, so a skip-ahead attempt fails here AND, independently, at the gateway.

Limits: Prime/Vera/Forge session keys live in this process (they hold no spending or execution authority without a
human token). The authorization token is held in memory only: a restart or expiry rolls the mission back to the
human gate. Vera's audit is a set of static checks, not a proof of safety.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import threading
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from lake_yange.agents.forge import Forge
from lake_yange.agents.prime import Prime
from lake_yange.agents.vera import Vera
from lake_yange.middleware.auth_gate import (SIGNATURES_REQUIRED, StewardSignature, TokenError,
                                            required_tier)
from lake_yange.middleware.gateway import BoundedAgentGateway
from lake_yange.middleware.lifecycle import Stage
from lake_yange.research.deep_research import DeepResearch
from lake_yange.research.vector_store import VectorStore
from lake_yange.tools.adapters import ArmedExecutor
from lake_yange.tools.container_runner import ContainerToolRunner
from lake_yange.tools.runner import PathViolation, ToolRunner, resolve_in_workspace, workspace_state_hash
from lake_yange.tools.schemas import (DatabaseQueryTool, FileSystemTool, PythonSandboxTool, parse_tool_call,
                                      to_proposal_args)

PERCENT = {"SCOPING": 0, "AUDIT": 25, "GATE": 50, "SANDBOX": 75, "REVIEW": 90, "SEALED": 100}
# state -> states a legal step may start from. Anything else raises MissionStateError (no skip-ahead, no replay).
TRANSITIONS = {"scope": ("SCOPING",), "audit": ("AUDIT",), "authorize": ("GATE",), "run": ("SANDBOX",),
               "seal": ("REVIEW",)}
MAX_TEXT = 4000


class MissionStateError(Exception):
    pass


def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _snapshot(root: Path) -> Dict[str, str]:
    base = root.resolve()
    out: Dict[str, str] = {}
    for p in sorted(base.rglob("*")):
        if p.is_file() and not p.is_symlink() and p.stat().st_size <= 100_000:
            try:
                out[str(p.relative_to(base))] = p.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                out[str(p.relative_to(base))] = "<binary>"
    return out


def _diff(before: Dict[str, str], after: Dict[str, str]) -> str:
    chunks: List[str] = []
    for name in sorted(set(before) | set(after)):
        if before.get(name) != after.get(name):
            chunks.extend(difflib.unified_diff((before.get(name) or "").splitlines(), (after.get(name) or "").splitlines(),
                                               f"a/{name}", f"b/{name}", lineterm=""))
    return "\n".join(chunks)[:MAX_TEXT]


class MissionExecutor:
    """Wraps the armed runner so Forge's single gateway call also yields pre/post file hashes, a diff and the
    sandbox's stdout/stderr. Reachable only through `gateway.execute`, i.e. only with a redeemed token."""

    def __init__(self, runner: ToolRunner) -> None:
        self._armed = ArmedExecutor(runner)
        self._runner = runner
        self.capture: Dict[str, Any] = {}

    def __call__(self, proposal: Any) -> str:
        ws = self._runner.workspace
        before = _snapshot(ws)
        self._runner.last_io = {}
        try:
            return self._armed(proposal)
        finally:
            after = _snapshot(ws)
            self.capture = {"diff": _diff(before, after), "io": dict(self._runner.last_io),
                            "files_before": len(before), "files_after": len(after),
                            "isolation": getattr(self._runner, "last_isolation", "process")}


class MissionEngine:
    def __init__(self, gateway: BoundedAgentGateway, store: Any, rag: VectorStore, workspace: Path,
                 clock: Callable[[], Any], runner: Optional[ToolRunner] = None) -> None:
        self.gateway, self.store, self.rag, self.clock = gateway, store, rag, clock
        self.workspace = Path(workspace)
        self.runner = runner or ContainerToolRunner(self.workspace, allow_fallback=True)
        br = gateway.breaker
        self.prime = Prime(gateway, br.issue_session_key("prime"))
        self.vera = Vera(gateway, br.issue_session_key("vera"))
        self._forge_key = br.issue_session_key("forge")
        self._tokens: Dict[str, str] = {}  # memory only: the 60s bearer token is never persisted
        self._lock = threading.RLock()

    # ---- persistence -------------------------------------------------------------------------------------------
    def _save(self, m: Dict[str, Any]) -> None:
        if m["state"] in PERCENT:  # BLOCKED_BY_VERA / REJECTED / FAILED keep the last milestone reached
            m["percent"] = PERCENT[m["state"]]
        self.store.put("mission", m["id"], m)

    def _phase(self, m: Dict[str, Any], phase: str, note: str, evidence_hash: str = "",
               artifact: Optional[Dict[str, Any]] = None) -> None:
        m["phases"].append({"phase": phase, "percent": m["percent"], "at": self.clock().isoformat(),
                            "evidence_hash": evidence_hash, "note": note, "artifact": artifact or {}})

    def get(self, mid: str) -> Dict[str, Any]:
        m = self.store.get("mission", mid)
        if m is None:
            raise MissionStateError(f"Unknown mission {mid}.")
        return m

    def _require(self, m: Dict[str, Any], step: str) -> None:
        if m["state"] not in TRANSITIONS[step]:
            raise MissionStateError(f"Cannot {step} a mission in state {m['state']} ({m['percent']}%); "
                                    f"requires {TRANSITIONS[step][0]}. Milestones cannot be skipped.")

    # ---- 0 -> 25: scoping (Prime) ------------------------------------------------------------------------------
    def create(self, objective: str, tool: Dict[str, Any], amount_usd: str = "0") -> Dict[str, Any]:
        parse_tool_call(tool)  # strict schema check up front
        mid = _h(f"{objective}\0{json.dumps(tool, sort_keys=True)}\0{self.clock().isoformat()}\0"
                 f"{len(self.store.all('mission'))}")[:16]
        m = {"id": mid, "objective": objective, "tool": tool, "amount_usd": str(Decimal(amount_usd)),
             "state": "SCOPING", "percent": 0, "proposal_id": None, "p_hash": None, "phases": [],
             "created_at": self.clock().isoformat(), "scope_report": None, "audit_matrix": None,
             "gate": None, "execution": None, "seal": None, "veto_reason": ""}
        self._phase(m, "SCOPING", "Mission created; awaiting scoping.")
        self._save(m)
        return m

    def scope(self, mid: str) -> Dict[str, Any]:
        with self._lock:
            m = self.get(mid)
            self._require(m, "scope")
            report = DeepResearch(self.rag).run(m["objective"])
            seen: List[Dict[str, Any]] = []
            for sq, ps in report.passages.items():
                for p in ps:
                    if all(s["chunk_hash"] != p.chunk_hash for s in seen):
                        seen.append({"sub_question": sq, "source_id": p.source_id, "chunk_hash": p.chunk_hash,
                                     "doc_hash": p.doc_hash, "score": round(p.score, 4)})
            evidence = [s["chunk_hash"] for s in seen[:5]]
            call_d = dict(m["tool"], evidence_chunk_hashes=evidence)
            call = parse_tool_call(call_d)
            scope = {"sub_questions": report.sub_questions, "sources": seen[:10], "ungrounded": report.ungrounded,
                     "research_report_hash": report.report_hash, "cited_chunk_hashes": evidence,
                     "proposed_call": call.model_dump(mode="json"),
                     "diff_preview": self._preview(call)}
            action, target, payload = to_proposal_args(call)
            pid = self.prime.propose(action, target, payload, f"Mission: {m['objective']}"[:480],
                                     Decimal(m["amount_usd"]))
            rec = self.gateway.records[pid]
            m.update(proposal_id=pid, p_hash=rec.p_hash, tier=rec.tier, state="AUDIT", scope_report=scope)
            self._save(m)
            self._phase(m, "SCOPING->AUDIT", f"Scoped with {len(seen)} grounded source(s); proposal submitted.",
                        _h(json.dumps(scope, sort_keys=True)), {"kind": "MissionScopeReport"})
            self._save(m)
            return m

    def _preview(self, call: Any) -> str:
        if isinstance(call, FileSystemTool) and call.op == "write":
            try:
                cur = resolve_in_workspace(self.workspace, call.path)
                old = cur.read_text(encoding="utf-8").splitlines() if cur.is_file() else []
            except (PathViolation, UnicodeDecodeError):
                old = []
            return "\n".join(difflib.unified_diff(old, (call.content or "").splitlines(), f"a/{call.path}",
                                                  f"b/{call.path}", lineterm=""))[:MAX_TEXT]
        if isinstance(call, PythonSandboxTool):
            return call.code[:MAX_TEXT]
        return json.dumps(call.model_dump(mode="json"))[:MAX_TEXT]

    # ---- 25 -> 50: audit (Vera) --------------------------------------------------------------------------------
    def audit(self, mid: str) -> Dict[str, Any]:
        with self._lock:
            m = self.get(mid)
            self._require(m, "audit")
            rec = self.gateway.records[m["proposal_id"]]
            call = parse_tool_call(rec.proposal.payload)
            checks: List[Dict[str, Any]] = []

            def chk(name: str, ok: bool, detail: str) -> None:
                checks.append({"check": name, "ok": bool(ok), "detail": detail})

            chk("article_10_1.human_gate", not rec.proposal.target_system.startswith("sandbox:"),
                "tool call is never auto-approved; a steward signature is required")
            chk("action_matches_payload", rec.proposal.action_type == f"tool:{call.tool}", rec.proposal.action_type)
            try:
                if isinstance(call, (FileSystemTool, DatabaseQueryTool)):
                    resolve_in_workspace(self.workspace, call.path if isinstance(call, FileSystemTool) else call.db_path)
                chk("workspace_boundary", True, "paths resolve inside the workspace")
            except (PathViolation, ValueError) as exc:
                chk("workspace_boundary", False, str(exc))
            bad = [h[:12] for h in call.evidence_chunk_hashes
                   if self.rag.get(h) is None or not self.rag.verify(self.rag.get(h))]  # type: ignore[arg-type]
            chk("evidence_verified", bool(call.evidence_chunk_hashes) and not bad,
                "no grounded evidence cited" if not call.evidence_chunk_hashes else
                (f"unverifiable: {bad}" if bad else f"{len(call.evidence_chunk_hashes)} chunk(s) verify against source"))
            need = max(1, SIGNATURES_REQUIRED[rec.tier])
            chk("spending_tier", rec.tier >= required_tier(Decimal(m["amount_usd"])),
                f"tier {rec.tier}; {need} steward signature(s) required")
            cii = [v for v in self.store.all("cii").values()]
            ratios = [100 * d["mode_a"] / d["mode_b"] for d in cii if d.get("mode_b")]
            cii_info = {"subjects": len(ratios), "mean_cii_pct": round(sum(ratios) / len(ratios), 1) if ratios else None,
                        "below_60": sum(1 for r in ratios if r < 60), "note": "informational; does not gate"}
            veto = [c for c in checks if not c["ok"]]
            matrix = {"status": "VERA_VETO" if veto else "CLEARED", "checks": checks, "cii_impact": cii_info,
                      "tier": rec.tier}
            m["audit_matrix"] = matrix
            if veto:
                reason = "; ".join(f"{c['check']}: {c['detail']}" for c in veto)[:480]
                self.vera.veto(m["proposal_id"], reason)
                self.gateway.red_sink.record(agent_id="vera", decision="DENIED", reason=f"Mission audit veto: {reason}",
                                             evidence_hash=rec.p_hash, result="not presented for signature")
                m.update(state="BLOCKED_BY_VERA", veto_reason=reason)
                self._phase(m, "AUDIT", "VERA_VETO", _h(json.dumps(matrix, sort_keys=True)),
                            {"kind": "VeraAuditMatrix"})
            else:
                m["state"] = "GATE"
                self._save(m)
                self._phase(m, "AUDIT->GATE", "CLEARED; paused at the human gate awaiting steward signatures.",
                            _h(json.dumps(matrix, sort_keys=True)), {"kind": "VeraAuditMatrix"})
            self._save(m)
            return m

    def plan(self, mid: str) -> Dict[str, Any]:
        """Convenience: run scoping then audit. Stops at 50% (or at a veto); never crosses the human gate."""
        self.scope(mid)
        return self.audit(mid)

    # ---- 50 -> 75: human gate -----------------------------------------------------------------------------------
    def authorize(self, mid: str, signatures: List[StewardSignature]) -> Dict[str, Any]:
        with self._lock:
            m = self.get(mid)
            self._require(m, "authorize")
            token = self.gateway.authorize(m["proposal_id"], signatures)  # raises (fail closed) on bad quorum
            self._tokens[mid] = token
            m["state"] = "SANDBOX"
            m["gate"] = {"signatures": [{"steward_id": s.steward_id, "signature_b64": s.signature_b64}
                                        for s in signatures], "p_hash": m["p_hash"], "token_ttl_s": 60,
                         "authorized_at": self.clock().isoformat()}
            self._save(m)
            self._phase(m, "GATE->SANDBOX", "Steward signatures verified; single-use 60s token minted.",
                        _h(json.dumps(m["gate"]["signatures"], sort_keys=True)), {"kind": "SignatureProof"})
            self._save(m)
            return m

    def _rollback(self, m: Dict[str, Any], why: str) -> None:
        self.gateway.reopen_gate(m["proposal_id"], f"Mission {m['id']}: {why}")
        self._tokens.pop(m["id"], None)
        m["state"] = "GATE"
        self._save(m)
        self._phase(m, "ROLLBACK 75->50", why, "", {"kind": "rollback"})
        self._save(m)

    def sync(self) -> List[str]:
        """Roll back missions whose token expired or was lost (restart). Called on reads and before a run."""
        out: List[str] = []
        with self._lock:
            for mid, m in self.store.all("mission").items():
                if m["state"] != "SANDBOX":
                    continue
                tok = self._tokens.get(mid)
                try:
                    if not tok:
                        raise TokenError("token not held (process restarted or already consumed)")
                    self.gateway.gate.inspect_token(tok, m["proposal_id"], m["p_hash"])
                except TokenError as exc:
                    self._rollback(m, f"authorization token invalid ({exc}); returned to the human gate")
                    out.append(mid)
        return out

    # ---- 75 -> 90 -> 100: sandbox run (Forge), review + seal (Vera / Red Sink) ----------------------------------------
    def run(self, mid: str) -> Dict[str, Any]:
        with self._lock:
            m = self.get(mid)
            self._require(m, "run")
            self.sync()
            m = self.get(mid)
            if m["state"] != "SANDBOX":  # rolled back; never present a dead token to the gateway
                raise MissionStateError("Token expired before execution; mission returned to the 50% human gate.")
            token = self._tokens.pop(mid)
            ex = MissionExecutor(self.runner)
            result = Forge(self.gateway, self._forge_key, ex).execute(m["proposal_id"], token)  # type: ignore[arg-type]
            failed = result.startswith("error:")
            cap = ex.capture
            m["execution"] = {"result": result[:MAX_TEXT], "failed": failed, "stdout": (cap["io"].get("stdout") or
                              ("" if failed else self._output(result)))[:MAX_TEXT],
                              "stderr": (cap["io"].get("stderr") or "")[:MAX_TEXT], "diff": cap["diff"],
                              "isolation": cap["isolation"], "ran_at": self.clock().isoformat()}
            m["state"] = "REVIEW"
            self._save(m)
            self._phase(m, "SANDBOX->REVIEW", "Tool call FAILED." if failed else "Tool call executed in sandbox.",
                        _h(result), {"kind": "ExecutionReceipt"})
            self._save(m)
            return self.seal(mid)

    @staticmethod
    def _output(result: str) -> str:
        try:
            return str(json.loads(result).get("output", ""))
        except ValueError:
            return ""

    def seal(self, mid: str) -> Dict[str, Any]:
        with self._lock:
            m = self.get(mid)
            self._require(m, "seal")
            rec = self.gateway.records[m["proposal_id"]]
            ex = m["execution"]
            problems: List[str] = []
            if rec.p_hash != m["p_hash"]:
                problems.append("proposal hash changed")
            if ex["failed"]:
                problems.append("execution failed")
            else:
                try:
                    r = json.loads(ex["result"])
                    if r.get("tool") != rec.proposal.payload.get("tool"):
                        problems.append("receipt tool mismatch")
                    if r.get("post_state_hash") != workspace_state_hash(self.workspace):
                        problems.append("workspace changed after the receipt was issued")
                except ValueError:
                    problems.append("receipt is not valid JSON")
            executed = [e for e in self.gateway.red_sink._ledger.entries
                        if e.decision == "EXECUTED" and e.evidence_hash == rec.p_hash]
            if not ex["failed"] and not executed:
                problems.append("no EXECUTED record in Red Sink for this proposal hash")
            verdict = "receipt matches proposal hash and workspace state" if not problems else \
                "NOT VERIFIED: " + "; ".join(problems)
            self.vera.review(m["proposal_id"], verdict)
            if problems:
                m.update(state="FAILED")
                self._save(m)
                self._phase(m, "REVIEW", verdict, "", {"kind": "VeraReview"})
            else:
                entry = self.gateway.red_sink.record(
                    agent_id="red_sink", decision="MISSION_SEALED", reason=f"mission {m['id']}: {m['objective'][:200]}",
                    evidence_hash=rec.p_hash, result="100% verified and sealed")
                m["state"] = "SEALED"
                m["seal"] = {"block_index": entry.index, "block_hash": entry.hash, "sealed_at": entry.timestamp}
                self._save(m)
                self._phase(m, "REVIEW->SEALED", verdict, entry.hash, {"kind": "RedSinkSeal"})
            self._save(m)
            return m

    def abandon_if_rejected(self) -> None:
        for m in self.store.all("mission").values():
            if m.get("proposal_id") in self.gateway.records and m["state"] in ("GATE", "SANDBOX"):
                if self.gateway.records[m["proposal_id"]].lifecycle.rejected:
                    m["state"] = "REJECTED"
                    self._phase(m, "GATE", "Rejected by a steward (terminal).")
                    self._save(m)

    def list(self) -> List[Dict[str, Any]]:
        self.sync()
        self.abandon_if_rejected()
        return sorted(self.store.all("mission").values(), key=lambda x: x["created_at"])
