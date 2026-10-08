"""Red Sink: the sole writer of the immutable audit ledger."""
from __future__ import annotations

from typing import List, Optional

from lake_yange.audit.ledger import LedgerEntry, RedSinkLedger


class RedSinkAgent:
    agent_id = "red_sink"

    def __init__(self, ledger: RedSinkLedger) -> None:
        self._ledger = ledger

    def record(self, *, agent_id: str, decision: str, reason: str, evidence_hash: str = "",
               alternatives: Optional[List[str]] = None, result: str = "") -> LedgerEntry:
        return self._ledger.append(agent_id=agent_id, decision=decision, reason=reason,
                                   evidence_hash=evidence_hash, alternatives=alternatives, result=result)

    def verify(self) -> None:
        self._ledger.verify()
