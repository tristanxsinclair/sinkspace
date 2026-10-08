"""Prime: coordination and planning. Can PROPOSE only; it has no execute or approve method."""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict

from lake_yange.middleware.auth_gate import AgentActionProposal, required_tier
from lake_yange.middleware.gateway import BoundedAgentGateway


class Prime:
    agent_id = "prime"

    def __init__(self, gateway: BoundedAgentGateway, session_key: str) -> None:
        self._gateway, self._key = gateway, session_key

    def propose(self, action_type: str, target_system: str, payload: Dict[str, Any], justification: str,
                amount_usd: Decimal = Decimal("0")) -> str:
        proposal = AgentActionProposal(
            agent_id=self.agent_id, action_type=action_type, target_system=target_system, payload=payload,
            requested_tier=required_tier(amount_usd), justification=justification, amount_usd=amount_usd)
        return self._gateway.submit(self.agent_id, self._key, proposal)
