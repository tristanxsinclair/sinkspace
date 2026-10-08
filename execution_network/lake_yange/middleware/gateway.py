"""Bounded Agent API Gateway: the only path from an agent proposal to an execution."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from lake_yange.agents.red_sink import RedSinkAgent
from lake_yange.middleware import rbac
from lake_yange.middleware.auth_gate import (
    OVERRIDE_DECISION, OVERRIDE_SIGNATURES_REQUIRED, AgentActionProposal, AuthGate, BadSignature, GateError, StewardSignature, TokenError, proposal_hash,
    required_tier,
)
from lake_yange.middleware.circuit_breaker import CircuitBreaker
from lake_yange.middleware.lifecycle import Lifecycle, Stage
from lake_yange.middleware.time_lock import OverridePending

Executor = Callable[[AgentActionProposal], str]


class TierBypassAttempt(Exception):
    pass


class UnauthorizedExecution(Exception):
    pass


@dataclass
class ProposalRecord:
    proposal_id: str
    proposal: AgentActionProposal
    p_hash: str
    tier: int
    submitted_at: datetime
    lifecycle: Lifecycle = field(default_factory=Lifecycle)
    result: Optional[str] = None
    status: str = "ACTIVE"  # ACTIVE | BLOCKED_BY_VERA | VERA_OVERRIDDEN
    veto_reason: str = ""


class BoundedAgentGateway:
    def __init__(self, gate: AuthGate, breaker: CircuitBreaker, red_sink: RedSinkAgent,
                 clock: Optional[Callable[[], datetime]] = None, store: Any = None,
                 time_lock: Any = None) -> None:
        # time_lock: a TimeLockEngine. Without one, an override unblocks immediately (legacy v0.1 behaviour).
        self.time_lock = time_lock
        self.gate, self.breaker, self.red_sink = gate, breaker, red_sink
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._store = store
        self.records: Dict[str, ProposalRecord] = {}
        if store is not None:
            for pid, d in store.all("proposal").items():
                proposal = AgentActionProposal.model_validate(d["proposal"])
                if proposal_hash(proposal) != d["p_hash"]:
                    raise GateError(f"Stored proposal {pid} no longer matches its hash; refusing to load.")
                self.records[pid] = ProposalRecord(
                    pid, proposal, d["p_hash"], d["tier"], datetime.fromisoformat(d["submitted_at"]),
                    Lifecycle.from_dict(d["lifecycle"]), d["result"],
                    d.get("status", "ACTIVE"), d.get("veto_reason", ""))

    def _save(self, r: "ProposalRecord") -> None:
        if self._store is not None:
            self._store.put("proposal", r.proposal_id, {
                "proposal": r.proposal.model_dump(mode="json"), "p_hash": r.p_hash, "tier": r.tier,
                "submitted_at": r.submitted_at.isoformat(), "lifecycle": r.lifecycle.to_dict(), "result": r.result,
                "status": r.status, "veto_reason": r.veto_reason})

    def _violation(self, agent_id: str, reason: str, p_hash: str = "") -> None:
        self.red_sink.record(agent_id=agent_id, decision="DENIED", reason=reason, evidence_hash=p_hash,
                             result="blocked")
        self.breaker.revoke(agent_id, reason, p_hash)

    def submit(self, agent_id: str, session_key: str, proposal: AgentActionProposal) -> str:
        self.breaker.validate(agent_id, session_key)
        rbac.check(agent_id, rbac.Action.PROPOSE)
        p_hash = proposal_hash(proposal)
        if proposal.agent_id != agent_id:
            self._violation(agent_id, "Proposal impersonates another agent.", p_hash)
            raise TierBypassAttempt("Impersonation.")
        needed = required_tier(proposal.amount_usd)
        if proposal.requested_tier < needed:
            self._violation(agent_id, f"Spending tier bypass: amount needs tier {needed}, requested "
                                       f"{proposal.requested_tier}.", p_hash)
            raise TierBypassAttempt(f"Amount requires tier {needed}.")
        pid = str(uuid.uuid4())
        record = ProposalRecord(pid, proposal, p_hash, max(needed, proposal.requested_tier), self._clock())
        for stage in (Stage.OBSERVE, Stage.ANALYZE, Stage.PROPOSE):
            record.lifecycle.complete(stage)
        self.records[pid] = record
        self._save(record)
        self.red_sink.record(agent_id=agent_id, decision="PROPOSED", reason=proposal.justification,
                             evidence_hash=p_hash, result=f"tier {record.tier} awaiting human authorization")
        return pid

    def _record(self, proposal_id: str) -> ProposalRecord:
        if proposal_id not in self.records:
            raise GateError(f"Unknown proposal {proposal_id}.")
        return self.records[proposal_id]

    def vera_veto(self, agent_id: str, session_key: str, proposal_id: str, reason: str) -> None:
        """Vera's veto, enforced here rather than in any agent. Only Vera may set it; it cannot be set once the
        proposal has executed, and it is persisted so it survives restarts."""
        self.breaker.validate(agent_id, session_key)
        if agent_id != "vera":
            self._violation(agent_id, "Non-Vera agent attempted to issue a Vera veto.")
            raise GateError("Only Vera may veto.")
        rbac.check(agent_id, rbac.Action.REVIEW)
        r = self._record(proposal_id)
        if r.lifecycle.current not in (Stage.HUMAN_AUTHORIZATION, Stage.EXECUTE) or r.lifecycle.rejected:
            raise GateError("Proposal can no longer be vetoed.")
        if r.status == "VERA_OVERRIDDEN":
            raise GateError("Veto already overridden by emergency multi-sig.")
        r.status, r.veto_reason = "BLOCKED_BY_VERA", reason
        self._save(r)
        self.red_sink.record(agent_id=agent_id, decision="VETOED", reason=reason, evidence_hash=r.p_hash,
                             result="BLOCKED_BY_VERA")

    def authorize(self, proposal_id: str, signatures: List[StewardSignature],
                  emergency_override: Optional[List[StewardSignature]] = None) -> str:
        """Human-facing. Returns a single-use 60s token or raises (fail closed, history preserved)."""
        r = self._record(proposal_id)
        if r.lifecycle.current is not Stage.HUMAN_AUTHORIZATION or r.lifecycle.rejected:
            raise GateError("Proposal is not awaiting human authorization.")
        auto = r.tier == 0 and r.proposal.target_system.startswith("sandbox:")
        try:
            if r.status == "BLOCKED_BY_VERA":
                # Ordinary signatures, however valid, cannot unblock a veto: only a 3-steward Tier 3 override.
                if self.time_lock is not None:
                    st = self.time_lock.status(proposal_id)
                    if st and st["state"] in ("PENDING_TIME_LOCK", "RELEASED"):
                        overridden_by = self.time_lock.release(proposal_id, r.p_hash)
                    elif emergency_override:
                        self.time_lock.file(proposal_id, r.p_hash, emergency_override)
                        raise OverridePending("Emergency override filed; 24h cooling period started.")
                    else:
                        raise GateError(f"Blocked by Vera ({r.veto_reason}); emergency override needs "
                                        f"{OVERRIDE_SIGNATURES_REQUIRED} steward signatures.")
                else:
                    valid = self.gate.verify_signatures(proposal_id, r.p_hash, 3, OVERRIDE_DECISION,
                                                        emergency_override or [])
                    if len(valid) < OVERRIDE_SIGNATURES_REQUIRED:
                        raise GateError(f"Blocked by Vera ({r.veto_reason}); emergency override needs "
                                        f"{OVERRIDE_SIGNATURES_REQUIRED} steward signatures, got {len(valid)}.")
                    overridden_by = sorted(valid)
            else:
                overridden_by = []
            token = self.gate.authorize(proposal_id, r.p_hash, r.tier, r.submitted_at, signatures, auto)
        except OverridePending:
            raise  # the time-lock engine has already recorded the pending state
        except GateError as exc:
            self.red_sink.record(agent_id="human_gate", decision="DENIED", reason=str(exc),
                                 evidence_hash=r.p_hash, result="authorization refused")
            if isinstance(exc, BadSignature) and exc.key_origin == "HSM" and exc.steward_id:
                # An invalid signature from a hardware-enrolled key is treated as compromise: quarantine the key.
                self.gate.revoke_steward(exc.steward_id)
                self.red_sink.record(agent_id=exc.steward_id, decision="REVOKED",
                                     reason="Invalid hardware signature; steward key revoked pending human review.",
                                     evidence_hash=r.p_hash, result="steward key revoked")
            raise
        r.lifecycle.complete(Stage.HUMAN_AUTHORIZATION)
        if overridden_by:
            r.status = "VERA_OVERRIDDEN"
            self.red_sink.record(agent_id="human_gate", decision="EMERGENCY_OVERRIDE",
                                 reason=f"CRITICAL: TIER_3_EMERGENCY_OVERRIDE of Vera veto ({r.veto_reason}) by "
                                        + ",".join(overridden_by), evidence_hash=r.p_hash,
                                 result="veto overridden; token issued")
            self.breaker.alerts.append(f"RED SINK ALERT: Vera veto overridden on {proposal_id}")
        self._save(r)
        self.red_sink.record(agent_id="human_gate", decision="APPROVED",
                             reason=("auto-approved sandbox tier 0" if auto and not signatures else
                                    "steward quorum verified: " + ",".join(f"{x.steward_id}:{x.signature_b64[:16]}"
                                                                           for x in signatures)),
                             evidence_hash=r.p_hash, result=f"tier {r.tier}")
        return token

    def reopen_gate(self, proposal_id: str, reason: str) -> None:
        """Roll an unexecuted authorization back to the human gate (token expired or lost). Logged to Red Sink."""
        r = self._record(proposal_id)
        r.lifecycle.reopen_gate()
        self._save(r)
        self.red_sink.record(agent_id="human_gate", decision="GATE_REOPENED", reason=reason,
                             evidence_hash=r.p_hash, result="re-authorization required")

    def cancel_override(self, proposal_id: str, signatures: List[StewardSignature]) -> None:
        """Any 2 stewards may abort a pending emergency override inside its cooling window."""
        if self.time_lock is None:
            raise GateError("No time-lock engine configured.")
        self.time_lock.cancel(proposal_id, self._record(proposal_id).p_hash, signatures)

    def reject(self, proposal_id: str, signature: StewardSignature, reason: str) -> None:
        r = self._record(proposal_id)
        self.gate.verify_signatures(proposal_id, r.p_hash, r.tier, "REJECT", [signature])
        r.lifecycle.reject()
        self._save(r)
        self.red_sink.record(agent_id=signature.steward_id, decision="REJECTED", reason=reason,
                             evidence_hash=r.p_hash, result="terminal")

    def execute(self, agent_id: str, session_key: str, proposal_id: str, token: Optional[str],
                executor: Executor) -> str:
        self.breaker.validate(agent_id, session_key)
        rbac.check(agent_id, rbac.Action.EXECUTE)
        r = self.records.get(proposal_id)
        if r is None or not token:
            self._violation(agent_id, "Execution attempted without a human authorization token.",
                            r.p_hash if r else "")
            raise UnauthorizedExecution("No human authorization.")
        if r.status == "BLOCKED_BY_VERA":
            self.red_sink.record(agent_id=agent_id, decision="DENIED", reason=f"Execution blocked by Vera veto: "
                                 f"{r.veto_reason}", evidence_hash=r.p_hash, result="BLOCKED_BY_VERA")
            raise UnauthorizedExecution("BLOCKED_BY_VERA")
        if r.lifecycle.current is not Stage.EXECUTE or r.lifecycle.rejected:
            self._violation(agent_id, "Execution attempted before the human gate was passed.", r.p_hash)
            raise UnauthorizedExecution("Human gate not passed.")
        try:
            self.gate.redeem(token, proposal_id, r.p_hash)
        except TokenError as exc:
            self._violation(agent_id, f"Execution with invalid token: {exc}", r.p_hash)
            raise UnauthorizedExecution(str(exc)) from exc
        r.lifecycle.complete(Stage.EXECUTE)
        self._save(r)
        decision = "EXECUTED"
        try:
            r.result = executor(r.proposal)
        except Exception as exc:  # sandboxed handler failure is recorded, never hidden
            decision, r.result = "FAILED", f"error: {exc}"
        r.lifecycle.complete(Stage.RECORD)
        self._save(r)
        self.red_sink.record(agent_id=agent_id, decision=decision, reason=r.proposal.action_type,
                             evidence_hash=r.p_hash, result=r.result or "")
        return r.result or ""

    def review(self, agent_id: str, session_key: str, proposal_id: str, verdict: str) -> None:
        self.breaker.validate(agent_id, session_key)
        rbac.check(agent_id, rbac.Action.REVIEW)
        r = self._record(proposal_id)
        r.lifecycle.complete(Stage.REVIEW)
        self._save(r)
        self.red_sink.record(agent_id=agent_id, decision="REVIEWED", reason=verdict,
                             evidence_hash=r.p_hash, result=r.result or "")
