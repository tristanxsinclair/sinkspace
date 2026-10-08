"""Phase IX evidence archive: serialises the Red Sink ledger plus commitments for experiments and simulations.

File format (JSON-L, one object per line, written once with O_EXCL then made read-only):
  HEADER  -> version, created_at, ledger_head, entry_count
  ENTRY*  -> every ledger entry (with its own chain hash)
  PROOF*  -> kind, label, payload, ledger_head, proof = sha256(canonical(payload) + ledger_head)
  FOOTER  -> sha256 over every preceding line (including newlines)

A "state proof" here is a hash COMMITMENT binding the results to the ledger head at export time. It is not a
zero-knowledge or third-party-attested proof, and nobody outside this process witnesses the head hash: anchor
the FOOTER hash somewhere independent (print it, notarise it) for real immutability.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from lake_yange.audit.ledger import GENESIS_HASH, LedgerEntry, LedgerIntegrityError, RedSinkLedger
from lake_yange.experiments.mode_a_b_harness import ModeABHarness
from lake_yange.treasury.simulator import ScenarioResult

ARCHIVE_VERSION = 1


class ArchiveError(Exception):
    pass


def _canon(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def state_proof(payload: Dict[str, Any], ledger_head: str) -> str:
    return hashlib.sha256((_canon(payload) + ledger_head).encode()).hexdigest()


class EvidenceArchiveExporter:
    def __init__(self, clock: Optional[Callable[[], datetime]] = None) -> None:
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def export(self, ledger: RedSinkLedger, dest: Path, experiments: Optional[List[ModeABHarness]] = None,
               scenarios: Optional[List[ScenarioResult]] = None) -> str:
        ledger.verify()
        entries = ledger.entries
        head = entries[-1].hash if entries else GENESIS_HASH
        lines: List[str] = [_canon({"type": "HEADER", "version": ARCHIVE_VERSION,
                                    "created_at": self._clock().astimezone(timezone.utc).isoformat(),
                                    "ledger_head": head, "entry_count": len(entries)})]
        lines += [_canon({"type": "ENTRY", **e.model_dump()}) for e in entries]
        for n, harness in enumerate(experiments or []):
            payload = {"participants": harness.export_results()}
            lines.append(_canon({"type": "PROOF", "kind": "MODE_A_B_EXPERIMENT", "label": f"run-{n}",
                                 "payload": payload, "ledger_head": head, "proof": state_proof(payload, head)}))
        for r in scenarios or []:
            payload = json.loads(r.model_dump_json())
            lines.append(_canon({"type": "PROOF", "kind": "TREASURY_SCENARIO", "label": f"scenario-{r.scenario}",
                                 "payload": payload, "ledger_head": head, "proof": state_proof(payload, head)}))
        body = "".join(line + "\n" for line in lines)
        footer_hash = hashlib.sha256(body.encode()).hexdigest()
        body += _canon({"type": "FOOTER", "sha256": footer_hash}) + "\n"
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)  # refuses to overwrite an archive
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(body)
        os.chmod(dest, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        return footer_hash


def verify_archive(path: Path) -> Dict[str, Any]:
    """Re-derives everything from the file alone. Raises ArchiveError on any inconsistency."""
    raw = Path(path).read_text(encoding="utf-8")
    lines = raw.splitlines(keepends=True)
    try:
        objs = [json.loads(line) for line in lines]
    except ValueError as exc:
        raise ArchiveError("Unparseable archive line.") from exc
    if len(objs) < 2 or objs[0].get("type") != "HEADER" or objs[-1].get("type") != "FOOTER":
        raise ArchiveError("Missing header or footer.")
    if hashlib.sha256("".join(lines[:-1]).encode()).hexdigest() != objs[-1]["sha256"]:
        raise ArchiveError("Archive footer hash mismatch (file was modified).")
    header, entries, proofs = objs[0], [o for o in objs if o["type"] == "ENTRY"], [o for o in objs if o["type"] == "PROOF"]
    if len(entries) != header["entry_count"]:
        raise ArchiveError("Entry count does not match header.")
    try:
        probe = RedSinkLedger()
        probe._entries = [LedgerEntry.model_validate({k: v for k, v in e.items() if k != "type"}) for e in entries]
        probe.verify()
    except LedgerIntegrityError as exc:
        raise ArchiveError(f"Ledger chain invalid: {exc}") from exc
    head = entries[-1]["hash"] if entries else GENESIS_HASH
    if head != header["ledger_head"]:
        raise ArchiveError("Header ledger head does not match the chain.")
    for p in proofs:
        if p["ledger_head"] != head or state_proof(p["payload"], head) != p["proof"]:
            raise ArchiveError(f"Proof {p['label']} does not verify.")
    return {"entries": len(entries), "proofs": len(proofs), "ledger_head": head, "footer_sha256": objs[-1]["sha256"]}
