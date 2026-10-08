"""Offline document store with TF-IDF cosine retrieval (stdlib only; sqlite3 for persistence).

Every chunk keeps its source id, character offsets and SHA-256, so any returned passage can be re-verified
against the stored source text. Re-ingesting a source_id with different content is refused (no silent rewrite).
"""
from __future__ import annotations

import hashlib
import math
import re
import sqlite3
from collections import Counter
from typing import Dict, List, Optional, Tuple

from pydantic import BaseModel

_TOKEN = re.compile(r"[a-z0-9]+")
STOP = frozenset("a an and are as at be by for from has have in is it its of on or that the this to was were will with".split())


def tokenize(text: str) -> List[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in STOP]


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class Passage(BaseModel):
    chunk_hash: str
    doc_hash: str
    source_id: str
    start: int
    end: int
    text: str
    score: float = 0.0


class IntegrityError(Exception):
    pass


class VectorStore:
    def __init__(self, path: str = ":memory:", chunk_chars: int = 600, overlap: int = 100) -> None:
        if overlap >= chunk_chars:
            raise ValueError("overlap must be smaller than chunk_chars")
        self.chunk_chars, self.overlap = chunk_chars, overlap
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.executescript(
            "CREATE TABLE IF NOT EXISTS docs(source_id TEXT PRIMARY KEY, doc_hash TEXT, text TEXT);"
            "CREATE TABLE IF NOT EXISTS chunks(chunk_hash TEXT PRIMARY KEY, source_id TEXT, doc_hash TEXT,"
            " start INTEGER, end INTEGER);")
        self._index: Optional[Tuple[List[Passage], List[Counter], Dict[str, float]]] = None

    def ingest(self, source_id: str, text: str) -> str:
        doc_hash = sha256_text(text)
        row = self._db.execute("SELECT doc_hash FROM docs WHERE source_id=?", (source_id,)).fetchone()
        if row:
            if row[0] == doc_hash:
                return doc_hash
            raise ValueError(f"Source {source_id!r} already ingested with different content; refusing to rewrite.")
        self._db.execute("INSERT INTO docs VALUES (?,?,?)", (source_id, doc_hash, text))
        step = self.chunk_chars - self.overlap
        for start in range(0, max(len(text), 1), step):
            end = min(start + self.chunk_chars, len(text))
            piece = text[start:end]
            if piece.strip():
                self._db.execute("INSERT OR IGNORE INTO chunks VALUES (?,?,?,?,?)",
                                 (sha256_text(f"{source_id}\0{start}\0{piece}"), source_id, doc_hash, start, end))
            if end >= len(text):
                break
        self._db.commit()
        self._index = None
        return doc_hash

    def _passages(self) -> List[Passage]:
        out = []
        for ch, sid, dh, s, e in self._db.execute("SELECT * FROM chunks ORDER BY source_id, start"):
            text = self._db.execute("SELECT substr(text,?,?) FROM docs WHERE source_id=?", (s + 1, e - s, sid)).fetchone()[0]
            out.append(Passage(chunk_hash=ch, doc_hash=dh, source_id=sid, start=s, end=e, text=text))
        return out

    def _build(self) -> Tuple[List[Passage], List[Counter], Dict[str, float]]:
        if self._index is None:
            ps = self._passages()
            tfs = [Counter(tokenize(p.text)) for p in ps]
            df: Counter = Counter()
            for tf in tfs:
                df.update(tf.keys())
            n = max(len(ps), 1)
            idf = {t: math.log((1 + n) / (1 + d)) + 1.0 for t, d in df.items()}
            self._index = (ps, tfs, idf)
        return self._index

    def search(self, query: str, k: int = 3, min_score: float = 0.05) -> List[Passage]:
        ps, tfs, idf = self._build()
        q = Counter(t for t in tokenize(query) if t in idf)
        if not q:
            return []
        qv = {t: c * idf[t] for t, c in q.items()}
        qn = math.sqrt(sum(v * v for v in qv.values()))
        scored = []
        for p, tf in zip(ps, tfs):
            dv = {t: c * idf[t] for t, c in tf.items()}
            dn = math.sqrt(sum(v * v for v in dv.values())) or 1.0
            s = sum(v * dv.get(t, 0.0) for t, v in qv.items()) / (qn * dn)
            if s >= min_score:
                scored.append(p.model_copy(update={"score": round(s, 6)}))
        scored.sort(key=lambda p: (-p.score, p.chunk_hash))
        return scored[:k]

    def get(self, chunk_hash: str) -> Optional[Passage]:
        return next((p for p in self._passages() if p.chunk_hash == chunk_hash), None)

    def verify(self, passage: Passage) -> bool:
        """True only if the passage text matches the stored source slice and its chunk hash."""
        row = self._db.execute("SELECT text, doc_hash FROM docs WHERE source_id=?", (passage.source_id,)).fetchone()
        if not row or row[1] != passage.doc_hash or sha256_text(row[0]) != passage.doc_hash:
            return False
        piece = row[0][passage.start:passage.end]
        return piece == passage.text and sha256_text(f"{passage.source_id}\0{passage.start}\0{piece}") == passage.chunk_hash

    def verify_all(self) -> None:
        for p in self._passages():
            if not self.verify(p):
                raise IntegrityError(f"Chunk {p.chunk_hash} no longer matches its source.")

    def close(self) -> None:
        self._db.close()
