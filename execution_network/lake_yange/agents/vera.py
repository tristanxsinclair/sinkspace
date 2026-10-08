"""Vera: evidence auditor. Verifies hashes and reviews outcomes; cannot approve or execute."""
from __future__ import annotations

from lake_yange.audit.ledger import sha256_hex
from lake_yange.middleware.gateway import BoundedAgentGateway


class Vera:
    agent_id = "vera"

    def __init__(self, gateway: BoundedAgentGateway, session_key: str) -> None:
        self._gateway, self._key = gateway, session_key

    @staticmethod
    def evidence_matches(evidence: bytes, claimed_hash: str) -> bool:
        return sha256_hex(evidence) == claimed_hash

    def review(self, proposal_id: str, verdict: str) -> None:
        self._gateway.review(self.agent_id, self._key, proposal_id, verdict)

    def veto(self, proposal_id: str, reason: str) -> None:
        """Enforced by the gateway (BLOCKED_BY_VERA), not by convention."""
        self._gateway.vera_veto(self.agent_id, self._key, proposal_id, reason)
