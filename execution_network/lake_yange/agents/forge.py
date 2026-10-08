"""Forge: sandboxed engineering execution. Runs only registered, offline, in-process handlers."""
from __future__ import annotations

from typing import Callable, Dict

from lake_yange.middleware.auth_gate import AgentActionProposal
from lake_yange.middleware.gateway import BoundedAgentGateway

Handler = Callable[[AgentActionProposal], str]


class SandboxExecutor:
    """No subprocess, network or filesystem access is provided; unknown action types are refused."""

    def __init__(self, handlers: Dict[str, Handler]) -> None:
        self._handlers = dict(handlers)

    def __call__(self, proposal: AgentActionProposal) -> str:
        handler = self._handlers.get(proposal.action_type)
        if handler is None:
            raise ValueError(f"No sandbox handler for {proposal.action_type!r}.")
        return handler(proposal)


class Forge:
    agent_id = "forge"

    def __init__(self, gateway: BoundedAgentGateway, session_key: str, sandbox: SandboxExecutor) -> None:
        self._gateway, self._key, self._sandbox = gateway, session_key, sandbox

    def execute(self, proposal_id: str, token: str) -> str:
        return self._gateway.execute(self.agent_id, self._key, proposal_id, token, self._sandbox)
