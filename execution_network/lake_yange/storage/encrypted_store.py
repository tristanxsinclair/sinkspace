"""Persistent state in SQLite with per-record AES-256-GCM encryption (stdlib sqlite3 + `cryptography`).

What this is: each record body is encrypted and authenticated; the (kind, id) pair is bound as AAD, so a
record cannot be swapped to another row or kind. Tampering or a wrong key raises StoreIntegrityError.
What this is NOT: whole-database encryption. Table names, `kind`, `id` and row counts are visible on disk.
SQLCipher / SQLAlchemy are not available offline here, so they are not used.

Key handling: pass a 32-byte key, or use `load_or_create_key(path)` which writes a 0600 key file
(development grade; production should wrap this key with an OS keychain / HSM).
"""
from __future__ import annotations

import json
import os
import secrets
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class StoreIntegrityError(Exception):
    pass


def load_or_create_key(path: Path) -> bytes:
    path = Path(path)
    if path.exists():
        key = bytes.fromhex(path.read_text().strip())
        if len(key) != 32:
            raise StoreIntegrityError("Store key file is not 32 bytes.")
        return key
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(key.hex())
    return key


class EncryptedStore:
    def __init__(self, db_path: Path, key: bytes) -> None:
        if len(key) != 32:
            raise ValueError("Key must be 32 bytes.")
        self._aead = AESGCM(key)
        self._lock = threading.RLock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(db_path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, blob BLOB NOT NULL, "
            "PRIMARY KEY (kind, id))")

    def close(self) -> None:
        self._db.close()

    def _seal(self, kind: str, rid: str, obj: Dict[str, Any]) -> bytes:
        nonce = secrets.token_bytes(12)
        body = json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()
        return nonce + self._aead.encrypt(nonce, body, f"{kind}:{rid}".encode())

    def _open(self, kind: str, rid: str, blob: bytes) -> Dict[str, Any]:
        try:
            return json.loads(self._aead.decrypt(blob[:12], blob[12:], f"{kind}:{rid}".encode()))
        except (InvalidTag, ValueError) as exc:
            raise StoreIntegrityError(f"Record {kind}:{rid} failed authentication (tampered or wrong key).") from exc

    def put(self, kind: str, rid: str, obj: Dict[str, Any]) -> None:
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO records (kind, id, blob) VALUES (?,?,?)",
                             (kind, rid, self._seal(kind, rid, obj)))

    def insert_new(self, kind: str, rid: str, obj: Dict[str, Any]) -> bool:
        """Atomic create-if-absent; returns False if it already existed (used for single-use tokens)."""
        with self._lock:
            cur = self._db.execute("INSERT OR IGNORE INTO records (kind, id, blob) VALUES (?,?,?)",
                                   (kind, rid, self._seal(kind, rid, obj)))
            return cur.rowcount == 1

    def get(self, kind: str, rid: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._db.execute("SELECT blob FROM records WHERE kind=? AND id=?", (kind, rid)).fetchone()
        return self._open(kind, rid, row[0]) if row else None

    def all(self, kind: str) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT id, blob FROM records WHERE kind=? ORDER BY id", (kind,)).fetchall()
        return {rid: self._open(kind, rid, blob) for rid, blob in rows}

    def delete(self, kind: str, rid: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM records WHERE kind=? AND id=?", (kind, rid))
