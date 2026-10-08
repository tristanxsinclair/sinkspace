"""Prime -> Vera -> human gate -> Forge -> Red Sink loop for local tool calls.

The orchestrator never signs and never mints tokens: the human supplies signatures through a callback, the
gateway/AuthGate verify them, and Forge executes only with the resulting single-use token.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Callable, Dict, List, Optional

from lake_yange.agents.forge import Forge
from lake_yange.agents.prime import Prime
from lake_yange.agents.red_sink import RedSinkAgent
from lake_yange.agents.vera import Vera
from lake_yange.middleware.auth_gate import GateError, StewardSignature
from lake_yange.middleware.gateway import BoundedAgentGateway
from lake_yange.research.vector_store import VectorStore
from lake_yange.tools.adapters import GatedToolAdapter
from lake_yange.tools.runner import PathViolation, ToolRunner, resolve_in_workspace
from lake_yange.tools.schemas import DatabaseQueryTool, FileSystemTool, ToolCall, parse_tool_call, to_proposal_args

HumanSigner = Callable[[str, str, int], List[StewardSignature]]  # (proposal_id, p_hash, tier) -> signatures


class VeraVeto(Exception):
    pass


class Orchestrator:
    def __init__(self, gateway: BoundedAgentGateway, red_sink: RedSinkAgent, prime: Prime, vera: Vera,
                 forge: Forge, runner: ToolRunner, store: Optional[VectorStore] = None) -> None:
        self.gateway, self.red_sink, self.prime, self.vera, self.forge = gateway, red_sink, prime, vera, forge
        self.runner, self.store = runner, store
        self.vetoed: Dict[str, str] = {}

    def draft(self, call: ToolCall, justification: str, amount_usd: Decimal = Decimal("0")) -> str:
        action, target, payload = to_proposal_args(call)
        return self.prime.propose(action, target, payload, justification, amount_usd)

    def vet(self, proposal_id: str) -> None:
        """Vera's constraint check. A veto is logged and blocks this orchestrator from requesting signatures."""
        rec = self.gateway.records[proposal_id]
        try:
            call = parse_tool_call(rec.proposal.payload)
            if rec.proposal.action_type != f"tool:{call.tool}":
                raise VeraVeto("action_type does not match payload.")
            if isinstance(call, (FileSystemTool, DatabaseQueryTool)):
                resolve_in_workspace(self.runner.workspace, call.path if isinstance(call, FileSystemTool) else call.db_path)
            for h in call.evidence_chunk_hashes:
                p = self.store.get(h) if self.store else None
                if p is None or not self.store.verify(p):  # type: ignore[union-attr]
                    raise VeraVeto(f"Cited evidence {h[:12]} is unknown or fails source verification.")
        except (VeraVeto, PathViolation, ValueError) as exc:
            self.vetoed[proposal_id] = str(exc)
            self.vera.veto(proposal_id, str(exc))
            self.red_sink.record(agent_id="vera", decision="DENIED", reason=f"Vera veto: {exc}",
                                 evidence_hash=rec.p_hash, result="not presented for signature")
            raise VeraVeto(str(exc)) from exc

    def run(self, call: ToolCall, justification: str, human: HumanSigner) -> str:
        pid = self.draft(call, justification)
        self.vet(pid)
        rec = self.gateway.records[pid]
        token = self.gateway.authorize(pid, human(pid, rec.p_hash, rec.tier))
        result = self.forge.execute(pid, token)
        self.vera.review(pid, "executed; result and pre/post state hashes recorded")
        return result
