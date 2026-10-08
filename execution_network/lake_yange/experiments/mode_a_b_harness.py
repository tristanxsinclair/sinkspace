"""Phase III harness: Mode A (AI OFF) vs Mode B (AI ASSISTED). Scores are supplied by human assessors; this
code only assigns modes, stores scores and computes CII. It does not judge quality itself."""
from __future__ import annotations

import random
from typing import Dict, List, Optional

from pydantic import BaseModel

from lake_yange.experiments.cognitive_index import CIIResult, compute_cii


class ParticipantScores(BaseModel):
    participant_id: str
    mode_b_initial_execution: Optional[float] = None
    mode_a_cold_defense: Optional[float] = None


class ModeABHarness:
    def __init__(self, seed: int = 0) -> None:
        self._rng = random.Random(seed)
        self._scores: Dict[str, ParticipantScores] = {}

    def assign_order(self, participant_ids: List[str]) -> Dict[str, str]:
        """Counterbalanced: half start in Mode A, half in Mode B (deterministic for a given seed)."""
        ids = list(participant_ids)
        self._rng.shuffle(ids)
        return {pid: ("A_FIRST" if i % 2 == 0 else "B_FIRST") for i, pid in enumerate(ids)}

    def _entry(self, pid: str) -> ParticipantScores:
        return self._scores.setdefault(pid, ParticipantScores(participant_id=pid))

    @staticmethod
    def _check(score: float) -> float:
        if not (0 <= score <= 100) or score != score:
            raise ValueError("Scores must be within 0..100")
        return score

    def record_mode_b(self, pid: str, score: float) -> None:
        self._entry(pid).mode_b_initial_execution = self._check(score)

    def record_mode_a_cold_defense(self, pid: str, score: float) -> None:
        self._entry(pid).mode_a_cold_defense = self._check(score)

    def participant_cii(self, pid: str) -> CIIResult:
        s = self._scores.get(pid)
        if s is None or s.mode_a_cold_defense is None or s.mode_b_initial_execution is None:
            raise ValueError("Both Mode A cold defense and Mode B execution scores are required")
        return compute_cii(s.mode_a_cold_defense, s.mode_b_initial_execution)

    def cohort_cii(self) -> CIIResult:
        done = [s for s in self._scores.values() if s.mode_a_cold_defense is not None and s.mode_b_initial_execution is not None]
        if not done:
            raise ValueError("No complete participants")
        return compute_cii(sum(s.mode_a_cold_defense for s in done) / len(done),
                           sum(s.mode_b_initial_execution for s in done) / len(done))

    def export_results(self) -> List[Dict[str, object]]:
        """Complete participants only, sorted for a deterministic proof."""
        return [s.model_dump() for _, s in sorted(self._scores.items())
                if s.mode_a_cold_defense is not None and s.mode_b_initial_execution is not None]
