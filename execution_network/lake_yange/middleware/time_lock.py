"""Emergency-override cooling period.

A TIER_3_EMERGENCY_OVERRIDE (3 distinct steward signatures) does not unblock a Vera veto immediately: it is filed
as PENDING_TIME_LOCK for TIME_LOCK_COOLING_PERIOD (24h). Any 2 stewards may file a signed CANCEL_OVERRIDE inside
that window. Only after the window has elapsed is the override RELEASED and the gateway allowed to continue.

Limits: the countdown is measured with the engine's clock (system time by default); someone who controls the
host clock controls the countdown. State lives in the encrypted store when one is supplied, otherwise in memory.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from lake_yange.middleware.auth_gate import (
    OVERRIDE_DECISION, OVERRIDE_SIGNATURES_REQUIRED, AuthGate, GateError, InsufficientSignatures, StewardSignature,
    TimeLockActive,
)

TIME_LOCK_COOLING_PERIOD = 86400  # seconds
CANCEL_DECISION = "CANCEL_OVERRIDE"
CANCEL_SIGNATURES_REQUIRED = 2
PENDING, CANCELLED, RELEASED = "PENDING_TIME_LOCK", "CANCELLED", "RELEASED"


class OverridePending(TimeLockActive):
    pass


class CancelWindowClosed(GateError):
    pass


class TimeLockEngine:
    def __init__(self, gate: AuthGate, red_sink: Any, store: Any = None,
                 clock: Optional[Callable[[], datetime]] = None,
                 cooling_period: int = TIME_LOCK_COOLING_PERIOD) -> None:
        if cooling_period < TIME_LOCK_COOLING_PERIOD:
            raise ValueError("Cooling period may not be shorter than 86400s.")
        self._gate, self._red_sink, self._store = gate, red_sink, store
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._period = cooling_period
        self._mem: Dict[str, Dict[str, Any]] = {}

    def _get(self, pid: str) -> Optional[Dict[str, Any]]:
        return self._store.get("timelock", pid) if self._store is not None else self._mem.get(pid)

    def _put(self, pid: str, rec: Dict[str, Any]) -> None:
        if self._store is not None:
            self._store.put("timelock", pid, rec)
        else:
            self._mem[pid] = dict(rec)

    def status(self, pid: str) -> Optional[Dict[str, Any]]:
        rec = self._get(pid)
        if rec is None:
            return None
        left = (datetime.fromisoformat(rec["unlock_at"]) - self._clock()).total_seconds()
        return {**rec, "seconds_left": max(0, int(left)) if rec["state"] == PENDING else 0}

    def file(self, pid: str, p_hash: str, signatures: List[StewardSignature]) -> Dict[str, Any]:
        existing = self._get(pid)
        if existing and existing["state"] in (PENDING, RELEASED):
            raise GateError(f"An override for {pid} is already {existing['state']}.")
        valid = self._gate.verify_signatures(pid, p_hash, 3, OVERRIDE_DECISION, signatures)
        if len(valid) < OVERRIDE_SIGNATURES_REQUIRED:
            raise InsufficientSignatures(f"Emergency override needs {OVERRIDE_SIGNATURES_REQUIRED} distinct "
                                         f"steward signatures, got {len(valid)}.")
        now = self._clock()
        rec = {"state": PENDING, "p_hash": p_hash, "filed_at": now.isoformat(),
               "unlock_at": (now + timedelta(seconds=self._period)).isoformat(),
               "signers": sorted(valid), "cancelled_by": []}
        self._put(pid, rec)
        self._red_sink.record(agent_id="human_gate", decision="OVERRIDE_PENDING",
                              reason=f"CRITICAL: TIER_3_EMERGENCY_OVERRIDE filed by {','.join(sorted(valid))}; "
                                     f"time-locked until {rec['unlock_at']}", evidence_hash=p_hash,
                              result="PENDING_TIME_LOCK")
        return rec

    def cancel(self, pid: str, p_hash: str, signatures: List[StewardSignature]) -> Dict[str, Any]:
        rec = self._get(pid)
        if rec is None or rec["state"] != PENDING:
            raise GateError("No pending override to cancel.")
        if rec["p_hash"] != p_hash:
            raise GateError("Override does not match this proposal.")
        if self._clock() >= datetime.fromisoformat(rec["unlock_at"]):
            raise CancelWindowClosed("Cooling window has elapsed; override can no longer be cancelled.")
        valid = self._gate.verify_signatures(pid, p_hash, 3, CANCEL_DECISION, signatures)
        if len(valid) < CANCEL_SIGNATURES_REQUIRED:
            raise InsufficientSignatures(f"Cancelling needs {CANCEL_SIGNATURES_REQUIRED} steward signatures, "
                                         f"got {len(valid)}.")
        rec = {**rec, "state": CANCELLED, "cancelled_by": sorted(valid)}
        self._put(pid, rec)
        self._red_sink.record(agent_id="human_gate", decision="OVERRIDE_CANCELLED",
                              reason="Emergency override cancelled by " + ",".join(sorted(valid)),
                              evidence_hash=p_hash, result="CANCELLED; Vera veto stands")
        return rec

    def release(self, pid: str, p_hash: str) -> List[str]:
        """Returns the original override signers once, and only once, the full window has elapsed."""
        rec = self._get(pid)
        if rec is None or rec["p_hash"] != p_hash or rec["state"] not in (PENDING, RELEASED):
            raise GateError("No releasable emergency override for this proposal.")
        if rec["state"] == PENDING:
            unlock = datetime.fromisoformat(rec["unlock_at"])
            if self._clock() < unlock:
                raise OverridePending(f"Emergency override is time-locked until {unlock.isoformat()}.")
            rec = {**rec, "state": RELEASED}
            self._put(pid, rec)
        return list(rec["signers"])
