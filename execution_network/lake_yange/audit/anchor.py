"""External ledger anchoring.

An anchor is a signed statement `[anchor_id, timestamp, head_hash, block_height, previous_anchor_hash, signature]`
about the Red Sink chain head. Anchors form their own hash chain (previous_anchor_hash) and are signed with a
witness key. `verify_anchor_chain` checks an archive/ledger file against an anchor file and reports divergence,
including the case where someone with root recomputed the whole local chain after editing history.

What this does and does not give you (be honest about it):
- Protection only exists if the anchor file and the witness PUBLIC key live somewhere a local root user cannot
  rewrite (another machine, removable media, a printed copy, a git remote, a public log). The witness private key
  must be held off-host, or the signer callable must delegate to hardware.
- Exports below are formats for third parties. This module never contacts a timestamp authority, runs no network
  code, and `git tag -s` needs a GPG key you hold. Nothing is "witnessed" until the exported material is actually
  submitted and its response kept.
"""
from __future__ import annotations

import base64
import hashlib
import json
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from cryptography.exceptions import InvalidSignature as _CryptoInvalid
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from lake_yange.audit.ledger import GENESIS_HASH, RedSinkLedger, _digest

ANCHOR_DOMAIN = "LAKE-YANGE-ANCHOR/1"
ANCHOR_FIELDS = ("anchor_id", "timestamp", "head_hash", "block_height", "previous_anchor_hash")
Signer = Callable[[bytes], bytes]


class AnchorError(Exception):
    pass


def _canon(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def _signing_bytes(fields: Dict[str, Any]) -> bytes:
    return _canon({"domain": ANCHOR_DOMAIN, **{k: fields[k] for k in ANCHOR_FIELDS}})


def anchor_hash(anchor: Dict[str, Any]) -> str:
    return hashlib.sha256(_canon(anchor)).hexdigest()


class LedgerAnchorManager:
    def __init__(self, anchor_file: Path, signer: Signer,
                 clock: Optional[Callable[[], datetime]] = None) -> None:
        self._file = Path(anchor_file)
        self._signer = signer
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def anchors(self) -> List[Dict[str, Any]]:
        if not self._file.exists():
            return []
        return [json.loads(x) for x in self._file.read_text(encoding="utf-8").splitlines() if x.strip()]

    def snapshot(self, ledger: RedSinkLedger) -> Dict[str, Any]:
        """Anchor the current head. Refuses if the ledger itself no longer verifies or has shrunk."""
        ledger.verify()
        entries = ledger.entries
        previous = self.anchors()
        height = len(entries)
        if previous and height < previous[-1]["block_height"]:
            raise AnchorError("Ledger is shorter than the last anchor: history was truncated.")
        fields = {
            "anchor_id": uuid.uuid4().hex,
            "timestamp": self._clock().astimezone(timezone.utc).isoformat(),
            "head_hash": entries[-1].hash if entries else GENESIS_HASH,
            "block_height": height,
            "previous_anchor_hash": anchor_hash(previous[-1]) if previous else GENESIS_HASH,
        }
        anchor = {**fields, "signature": base64.b64encode(self._signer(_signing_bytes(fields))).decode()}
        self._file.parent.mkdir(parents=True, exist_ok=True)
        with self._file.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(anchor, sort_keys=True, separators=(",", ":")) + "\n")
        return anchor

    # ---- export formats for independent witnesses -------------------------------------------------------
    @staticmethod
    def export_rfc3161_request(anchor: Dict[str, Any]) -> bytes:
        """DER-encoded RFC 3161 TimeStampReq over SHA-256(anchor). Submit it to a TSA yourself (e.g. with
        `curl --data-binary @req.tsq -H 'Content-Type: application/timestamp-query'`) and keep the reply."""
        digest = hashlib.sha256(_canon(anchor)).digest()
        nonce = int(uuid.uuid4().int & ((1 << 63) - 1))

        def tlv(tag: int, body: bytes) -> bytes:
            n = len(body)
            length = bytes([n]) if n < 128 else (b"\x81" + bytes([n]) if n < 256 else b"\x82" + n.to_bytes(2, "big"))
            return bytes([tag]) + length + body

        sha256_oid = bytes.fromhex("0609608648016503040201")
        imprint = tlv(0x30, tlv(0x30, sha256_oid + b"\x05\x00") + tlv(0x04, digest))
        nonce_bytes = nonce.to_bytes((nonce.bit_length() + 8) // 8, "big")
        return tlv(0x30, b"\x02\x01\x01" + imprint + tlv(0x02, nonce_bytes) + b"\x01\x01\xff")

    @staticmethod
    def git_tag_argv(anchor: Dict[str, Any], signed: bool = True) -> List[str]:
        name = f"lake-yange-anchor-{anchor['block_height']}-{anchor['head_hash'][:12]}"
        msg = json.dumps(anchor, sort_keys=True, separators=(",", ":"))
        return ["git", "tag", "-s" if signed else "-a", name, "-m", msg]

    def create_git_tag(self, repo_dir: Path, anchor: Dict[str, Any], signed: bool = True) -> str:
        """Runs `git tag -s` in repo_dir (needs your GPG key; unsigned `-a` only for rehearsal)."""
        argv = self.git_tag_argv(anchor, signed)
        proc = subprocess.run(argv, cwd=str(repo_dir), capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AnchorError(f"git tag failed: {proc.stderr.strip()}")
        return argv[3]

    @staticmethod
    def export_witness_line(anchor: Dict[str, Any]) -> str:
        """One plain-text line suitable for appending to a public, multi-party witness log."""
        return (f"lake-yange-anchor/1 {anchor['anchor_id']} height={anchor['block_height']} "
                f"head={anchor['head_hash']} prev={anchor['previous_anchor_hash']} "
                f"ts={anchor['timestamp']} sig={anchor['signature']}")


class AnchorReport:
    def __init__(self) -> None:
        self.anchors_checked = 0
        self.problems: List[str] = []

    @property
    def valid(self) -> bool:
        return not self.problems

    def to_dict(self) -> Dict[str, Any]:
        return {"valid": self.valid, "anchors_checked": self.anchors_checked, "problems": list(self.problems)}


def _read_chain(archive_file: Path, report: AnchorReport) -> List[Dict[str, Any]]:
    """Accepts an exported evidence archive (ENTRY lines) or a raw ledger.jsonl; re-verifies the local chain."""
    entries: List[Dict[str, Any]] = []
    for n, line in enumerate(Path(archive_file).read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            report.problems.append(f"Unparseable line {n} in archive.")
            continue
        if "type" in obj:
            if obj["type"] != "ENTRY":
                continue
            obj = {k: v for k, v in obj.items() if k != "type"}
        entries.append(obj)
    prev = GENESIS_HASH
    for pos, e in enumerate(entries):
        try:
            body = {k: v for k, v in e.items() if k != "hash"}
            ok = e.get("index") == pos and e.get("prev_hash") == prev and _digest(body) == e.get("hash")
        except Exception:
            ok = False
        if not ok:
            report.problems.append(f"Block {pos} is modified or the local chain is broken at this block.")
            break
        prev = e["hash"]
    return entries


def verify_anchor_chain(archive_file: Path, anchor_file: Path, witness_public_key: bytes) -> AnchorReport:
    report = AnchorReport()
    entries = _read_chain(archive_file, report)
    try:
        anchors = [json.loads(x) for x in Path(anchor_file).read_text(encoding="utf-8").splitlines() if x.strip()]
    except (OSError, ValueError) as exc:
        report.problems.append(f"Anchor file unreadable: {exc}")
        return report
    key = Ed25519PublicKey.from_public_bytes(witness_public_key)
    prev_hash, prev_height, seen = GENESIS_HASH, 0, set()
    for i, a in enumerate(anchors):
        report.anchors_checked += 1
        try:
            key.verify(base64.b64decode(a["signature"], validate=True), _signing_bytes(a))
        except (_CryptoInvalid, ValueError, KeyError):
            report.problems.append(f"Anchor {i} has an invalid witness signature.")
            continue
        if a["anchor_id"] in seen:
            report.problems.append(f"Anchor {i} duplicates an anchor id.")
        seen.add(a["anchor_id"])
        if a["previous_anchor_hash"] != prev_hash:
            report.problems.append(f"Anchor {i} does not link to the previous anchor.")
        if a["block_height"] < prev_height:
            report.problems.append(f"Anchor {i} height goes backwards.")
        prev_hash, prev_height = anchor_hash(a), a["block_height"]
        h = a["block_height"]
        if h > len(entries):
            report.problems.append(f"Archive has {len(entries)} blocks but anchor {i} witnessed {h}: truncated.")
        elif h == 0:
            if a["head_hash"] != GENESIS_HASH:
                report.problems.append(f"Anchor {i} claims a non-genesis head at height 0.")
        elif entries[h - 1]["hash"] != a["head_hash"]:
            report.problems.append(f"Archive diverges from anchor {i}: block {h - 1} hash differs from witnessed "
                                   f"head (history rewritten at or before block {h - 1}).")
    return report
