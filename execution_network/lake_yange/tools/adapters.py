"""Token-bound adapter between Forge and the ToolRunner.

The token check itself lives in `BoundedAgentGateway.execute` -> `AuthGate.redeem` (60s TTL, single use, bound to
the proposal hash, ledger-logged DENIED + session-key revocation on any failure). This adapter makes the runner
reachable ONLY through that path: it hands the gateway an executor that arms the runner for exactly one proposal.
"""
from __future__ import annotations

from typing import Optional

from lake_yange.middleware.auth_gate import AgentActionProposal, proposal_hash
from lake_yange.middleware.gateway import BoundedAgentGateway
from lake_yange.tools.runner import ToolRunner


class ArmedExecutor:
    def __init__(self, runner: ToolRunner) -> None:
        self._runner = runner

    def __call__(self, proposal: AgentActionProposal) -> str:
        with self._runner._arm(proposal_hash(proposal)):
            return self._runner(proposal)


class GatedToolAdapter:
    """Pass `adapter.executor` to `Forge` as its sandbox; there is no unauthenticated entry point."""

    def __init__(self, gateway: BoundedAgentGateway, runner: ToolRunner) -> None:
        self.gateway = gateway
        self.runner = runner
        self.executor = ArmedExecutor(runner)

    def call(self, agent_id: str, session_key: str, proposal_id: str, token: Optional[str]) -> str:
        return self.gateway.execute(agent_id, session_key, proposal_id, token, self.executor)
