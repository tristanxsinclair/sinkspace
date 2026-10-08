"""Session keys, non-retroactivity revocation (Art. 10.6) and the emergency kill switch."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any, Dict, List, Set

from lake_yange.audit.ledger import RedSinkLedger


class SessionKeyError(Exception):
    pass


class KillSwitchEngaged(Exception):
    pass


class CircuitBreaker:
    """Revocation is permanent for the lifetime of this object; re-issuing needs a new breaker (a human act)."""

    def __init__(self, ledger: RedSinkLedger, store: Any = None) -> None:
        self._ledger = ledger
        self._store = store
        self._key_hashes: Dict[str, str] = {}
        self._revoked: Set[str] = set()
        self.killed = False
        self.alerts: List[str] = []
        if store is not None:
            for aid, rec in store.all("session").items():
                self._key_hashes[aid] = rec["key_hash"]
                if rec["revoked"]:
                    self._revoked.add(aid)
            self.killed = bool((store.get("breaker", "state") or {}).get("killed", False))

    def _persist(self, agent_id: str) -> None:
        if self._store is not None:
            self._store.put("session", agent_id, {"key_hash": self._key_hashes.get(agent_id, ""),
                                                  "revoked": agent_id in self._revoked})

    def issue_session_key(self, agent_id: str) -> str:
        if agent_id in self._revoked:
            raise SessionKeyError(f"{agent_id} is revoked.")
        key = secrets.token_urlsafe(32)
        self._key_hashes[agent_id] = hashlib.sha256(key.encode()).hexdigest()
        self._persist(agent_id)
        return key

    def validate(self, agent_id: str, key: str) -> None:
        if self.killed:
            raise KillSwitchEngaged("Kill switch is engaged; all agent actions are halted.")
        if agent_id in self._revoked:
            raise SessionKeyError(f"Session key for {agent_id} is revoked.")
        expected = self._key_hashes.get(agent_id)
        if expected is None or not hmac.compare_digest(expected, hashlib.sha256(key.encode()).hexdigest()):
            raise SessionKeyError(f"Invalid session key for {agent_id}.")

    def is_revoked(self, agent_id: str) -> bool:
        return agent_id in self._revoked

    def revoke(self, agent_id: str, reason: str, evidence_hash: str = "") -> None:
        self._revoked.add(agent_id)
        self._key_hashes.pop(agent_id, None)
        self._persist(agent_id)
        self.alerts.append(f"RED SINK ALERT: {agent_id} revoked: {reason}")
        self._ledger.append(agent_id=agent_id, decision="REVOKED", reason=reason,
                            evidence_hash=evidence_hash, result="session key revoked")

    def engage_kill_switch(self, reason: str) -> None:
        self.killed = True
        if self._store is not None:
            self._store.put("breaker", "state", {"killed": True})
        self.alerts.append(f"RED SINK ALERT: kill switch: {reason}")
        self._ledger.append(agent_id="circuit_breaker", decision="KILL_SWITCH", reason=reason,
                            result="all agent actions halted")
