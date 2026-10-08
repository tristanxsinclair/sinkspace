"""Red Sink immutable audit ledger: append-only JSONL with a SHA-256 hash chain.

Guarantee: any edit, deletion or reordering of a stored entry is detected by `verify()`.
Non-guarantee: someone with write access who recomputes the whole chain is not detected
(there is no external anchor). Verification failures raise; nothing is auto-repaired.
"""
from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, List, Optional

from pydantic import BaseModel, ConfigDict

GENESIS_HASH = "0" * 64
DECISIONS = frozenset({
    "PROPOSED", "APPROVED", "REJECTED", "EXECUTED", "FAILED",
    "REVIEWED", "REVOKED", "KILL_SWITCH", "DENIED", "VETOED", "EMERGENCY_OVERRIDE",
    "OVERRIDE_PENDING", "OVERRIDE_CANCELLED", "GATE_REOPENED", "REVOCATION_EVENT", "MISSION_SEALED",
})


class LedgerIntegrityError(Exception):
    pass


class LedgerEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    index: int
    timestamp: str
    date: str
    agent_id: str
    decision: str
    reason: str
    evidence_hash: str
    alternatives: List[str]
    result: str
    prev_hash: str
    hash: str


def _digest(fields: dict) -> str:
    body = json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class RedSinkLedger:
    def __init__(self, path: Optional[Path] = None, clock: Optional[Callable[[], datetime]] = None) -> None:
        self._path = Path(path) if path else None
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._entries: List[LedgerEntry] = []
        self._lock = threading.Lock()
        if self._path and self._path.exists():
            for line in self._path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    self._entries.append(LedgerEntry.model_validate_json(line))
                except Exception as exc:
                    raise LedgerIntegrityError(f"Unparseable ledger line: {exc}") from exc
            self.verify()

    @property
    def entries(self) -> List[LedgerEntry]:
        return list(self._entries)

    def append(self, *, agent_id: str, decision: str, reason: str, evidence_hash: str = "",
               alternatives: Optional[List[str]] = None, result: str = "") -> LedgerEntry:
        if decision not in DECISIONS:
            raise ValueError(f"Unknown ledger decision {decision!r}")
        with self._lock:
            self.verify()
            now = self._clock().astimezone(timezone.utc)
            fields = {
                "index": len(self._entries),
                "timestamp": now.isoformat(),
                "date": now.date().isoformat(),
                "agent_id": agent_id,
                "decision": decision,
                "reason": reason,
                "evidence_hash": evidence_hash,
                "alternatives": list(alternatives or []),
                "result": result,
                "prev_hash": self._entries[-1].hash if self._entries else GENESIS_HASH,
            }
            entry = LedgerEntry(**fields, hash=_digest(fields))
            if self._path:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                with self._path.open("a", encoding="utf-8") as handle:
                    handle.write(entry.model_dump_json() + "\n")
            self._entries.append(entry)
            return entry

    def verify(self) -> None:
        prev = GENESIS_HASH
        for position, entry in enumerate(self._entries):
            fields = entry.model_dump(exclude={"hash"})
            if entry.index != position:
                raise LedgerIntegrityError(f"Sequence gap at position {position}.")
            if entry.prev_hash != prev:
                raise LedgerIntegrityError(f"Broken chain at entry {position}.")
            if _digest(fields) != entry.hash:
                raise LedgerIntegrityError(f"Entry {position} was modified.")
            prev = entry.hash
