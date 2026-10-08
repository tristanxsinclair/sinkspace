"""Cognitive Independence Index: CII = (Mode A cold defense / Mode B initial execution) * 100."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

CII_ALERT_THRESHOLD = 60.0


class CIIResult(BaseModel):
    cii: float
    alert: bool
    recommendation: Optional[str]


def compute_cii(mode_a_cold_defense: float, mode_b_initial_execution: float) -> CIIResult:
    for name, v in (("mode_a_cold_defense", mode_a_cold_defense), ("mode_b_initial_execution", mode_b_initial_execution)):
        if v != v or v in (float("inf"), float("-inf")) or v < 0:
            raise ValueError(f"{name} must be a finite non-negative score")
    if mode_b_initial_execution == 0:
        raise ValueError("Mode B initial execution score must be greater than zero")
    cii = mode_a_cold_defense / mode_b_initial_execution * 100
    alert = cii < CII_ALERT_THRESHOLD
    rec = ("CII below 60%: schedule Module 10 (AI-Off Competence) intervention before further AI-assisted work."
           if alert else None)
    return CIIResult(cii=cii, alert=alert, recommendation=rec)
