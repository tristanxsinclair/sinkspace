"""Iterative offline research: Prime plans, the store retrieves, Vera cross-examines.

Decomposition and synthesis are extractive heuristics by default; an optional local `llm` callable
(str -> str, e.g. a wrapper over a local Ollama endpoint) may replace decomposition. No network code here.
Research is read-only (Observe/Analyze); it grants no execution authority and never calls a tool.
"""
from __future__ import annotations

import json
import re
from typing import Callable, Dict, List, Optional

from pydantic import BaseModel

from lake_yange.research.vector_store import Passage, VectorStore, sha256_text, tokenize

_SPLIT = re.compile(r"\?|;|\band\b|\bas well as\b", re.I)


class PrimePlanner:
    def __init__(self, llm: Optional[Callable[[str], str]] = None) -> None:
        self._llm = llm

    def decompose(self, question: str) -> List[str]:
        if self._llm:
            lines = [l.strip(" -*\t") for l in self._llm("Split into sub-questions, one per line:\n" + question).splitlines()]
            parts = [l for l in lines if l]
        else:
            parts = [p.strip() for p in _SPLIT.split(question)]
            parts = [p for p in parts if len(tokenize(p)) >= 2]
        return parts or [question.strip()]


class Claim(BaseModel):
    text: str
    cited_chunk_hashes: List[str] = []


class ClaimAudit(BaseModel):
    claim: str
    status: str  # GROUNDED | MISSING_CITATION | UNKNOWN_CITATION | UNSUPPORTED_BY_CITED_PASSAGE
    detail: str = ""


class EvidenceRow(BaseModel):
    sub_question: str
    status: str  # GROUNDED | SINGLE_SOURCE | UNGROUNDED
    sources: List[str]
    chunk_hashes: List[str]
    flags: List[str]


class Statement(BaseModel):
    sub_question: str
    text: str
    chunk_hash: str
    source_id: str


class ResearchReport(BaseModel):
    question: str
    sub_questions: List[str]
    passages: Dict[str, List[Passage]]
    matrix: List[EvidenceRow]
    statements: List[Statement]
    ungrounded: List[str]
    report_hash: str = ""


class VeraEvidenceAuditor:
    def __init__(self, store: VectorStore) -> None:
        self._store = store

    def audit(self, sub_question: str, passages: List[Passage]) -> EvidenceRow:
        good = [p for p in passages if self._store.verify(p)]
        flags = [] if len(good) == len(passages) else ["FAILED_SOURCE_VERIFICATION"]
        sources = sorted({p.source_id for p in good})
        status = "UNGROUNDED" if not good else ("SINGLE_SOURCE" if len(sources) == 1 else "GROUNDED")
        if status == "SINGLE_SOURCE":
            flags.append("NO_CORROBORATION")
        if status == "UNGROUNDED":
            flags.append("NO_SUPPORTING_PASSAGE")
        return EvidenceRow(sub_question=sub_question, status=status, sources=sources,
                           chunk_hashes=[p.chunk_hash for p in good], flags=flags)

    def audit_claims(self, claims: List[Claim], min_overlap: float = 0.5) -> List[ClaimAudit]:
        out = []
        for c in claims:
            if not c.cited_chunk_hashes:
                out.append(ClaimAudit(claim=c.text, status="MISSING_CITATION"))
                continue
            cited = [self._store.get(h) for h in c.cited_chunk_hashes]
            if any(p is None or not self._store.verify(p) for p in cited):
                out.append(ClaimAudit(claim=c.text, status="UNKNOWN_CITATION"))
                continue
            terms = set(tokenize(c.text))
            have = set().union(*(set(tokenize(p.text)) for p in cited if p))
            ratio = len(terms & have) / len(terms) if terms else 0.0
            out.append(ClaimAudit(claim=c.text, status="GROUNDED" if ratio >= min_overlap else "UNSUPPORTED_BY_CITED_PASSAGE",
                                  detail=f"term overlap {ratio:.2f}"))
        return out


def _best_sentence(passage: Passage, question: str) -> str:
    q = set(tokenize(question))
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", passage.text) if s.strip()]
    return max(sents, key=lambda s: len(q & set(tokenize(s))), default=passage.text)


class DeepResearch:
    def __init__(self, store: VectorStore, planner: Optional[PrimePlanner] = None, max_rounds: int = 2,
                 k: int = 3, min_score: float = 0.05) -> None:
        self.store, self.planner = store, planner or PrimePlanner()
        self.auditor = VeraEvidenceAuditor(store)
        self.max_rounds, self.k, self.min_score = max_rounds, k, min_score

    def run(self, question: str) -> ResearchReport:
        subs = self.planner.decompose(question)
        passages: Dict[str, List[Passage]] = {}
        for sq in subs:
            found = self.store.search(sq, self.k, self.min_score)
            if len(found) < 2 and self.max_rounds > 1:  # round 2: widen with the parent question's terms
                seen = {p.chunk_hash for p in found}
                found += [p for p in self.store.search(sq + " " + question, self.k, self.min_score) if p.chunk_hash not in seen]
                found.sort(key=lambda p: (-p.score, p.chunk_hash))
                found = found[:self.k]
            passages[sq] = found
        matrix = [self.auditor.audit(sq, passages[sq]) for sq in subs]
        statements = []
        for row in matrix:
            if row.chunk_hashes:
                top = next(p for p in passages[row.sub_question] if p.chunk_hash == row.chunk_hashes[0])
                statements.append(Statement(sub_question=row.sub_question, text=_best_sentence(top, row.sub_question),
                                            chunk_hash=top.chunk_hash, source_id=top.source_id))
        report = ResearchReport(question=question, sub_questions=subs, passages=passages, matrix=matrix,
                                statements=statements,
                                ungrounded=[r.sub_question for r in matrix if r.status == "UNGROUNDED"])
        report.report_hash = sha256_text(json.dumps(report.model_dump(exclude={"report_hash"}), sort_keys=True))
        return report
