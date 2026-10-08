"""Treasury stress scenarios.

Only scenario C (50% asset drawdown) comes from the brief. Scenarios A, B, D, E, F, G are PLACEHOLDER
definitions chosen here, not taken from the Lake Yange Codex; replace them with the Codex definitions.
"""
from __future__ import annotations

import copy
from decimal import Decimal
from typing import Callable, Dict, List

from pydantic import BaseModel

from lake_yange.treasury.three_tier_ledger import ThreeTierLedger

D = Decimal


class ScenarioResult(BaseModel):
    scenario: str
    description: str
    tier1_funded_pct_before: Decimal
    tier1_funded_pct_after: Decimal
    tier1_runway_months_after: Decimal
    tier1_balance_unchanged: bool
    tier3_projects_paused: bool
    passed: bool


class Simulator:
    """Runs on deep copies: the real ledger is never mutated."""

    def __init__(self, ledger: ThreeTierLedger) -> None:
        self._ledger = ledger

    def _run(self, name: str, description: str, shock: Callable[[ThreeTierLedger], None]) -> ScenarioResult:
        sim = copy.deepcopy(self._ledger)
        before_pct, before_t1 = sim.tier1_funded_pct, sim.tier1
        shock(sim)
        paused = all(sim.tier3_projects.values()) if sim.tier3_projects else True
        unchanged = sim.tier1 == before_t1
        return ScenarioResult(
            scenario=name, description=description, tier1_funded_pct_before=before_pct,
            tier1_funded_pct_after=sim.tier1_funded_pct, tier1_runway_months_after=sim.tier1_runway_months,
            tier1_balance_unchanged=unchanged, tier3_projects_paused=paused,
            passed=unchanged and (sim.tier1_funded_pct >= 100 or paused))

    def run_scenario_a(self) -> ScenarioResult:
        return self._run("A", "[placeholder] 10% loss on Tier 2 and Tier 3", lambda s: s.apply_market_move(D("0.10"), D("0.10")))

    def run_scenario_b(self) -> ScenarioResult:
        return self._run("B", "[placeholder] 25% Tier 3 drawdown", lambda s: s.apply_market_move(D(0), D("0.25")))

    def run_scenario_c_major_loss(self) -> ScenarioResult:
        return self._run("C", "50% asset drawdown across Tier 2 and Tier 3", lambda s: s.apply_market_move(D("0.50"), D("0.50")))

    def run_scenario_d(self) -> ScenarioResult:
        return self._run("D", "[placeholder] essential burn +50%", lambda s: s.apply_burn_shock(D("1.5")))

    def run_scenario_e(self) -> ScenarioResult:
        return self._run("E", "[placeholder] total Tier 3 loss", lambda s: s.apply_market_move(D(0), D(1)))

    def run_scenario_f(self) -> ScenarioResult:
        return self._run("F", "[placeholder] 40% Tier 2 impairment", lambda s: s.apply_market_move(D("0.40"), D(0)))

    def run_scenario_g(self) -> ScenarioResult:
        def combined(s: ThreeTierLedger) -> None:
            s.apply_market_move(D("0.50"), D("0.50"))
            s.apply_burn_shock(D("1.25"))
        return self._run("G", "[placeholder] 50% drawdown plus burn +25%", combined)

    def run_all(self) -> List[ScenarioResult]:
        return [getattr(self, n)() for n in (
            "run_scenario_a", "run_scenario_b", "run_scenario_c_major_loss", "run_scenario_d",
            "run_scenario_e", "run_scenario_f", "run_scenario_g")]
