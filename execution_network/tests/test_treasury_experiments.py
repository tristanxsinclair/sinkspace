from decimal import Decimal as D

import pytest

from lake_yange.experiments.cognitive_index import compute_cii
from lake_yange.experiments.mode_a_b_harness import ModeABHarness
from lake_yange.treasury.simulator import Simulator
from lake_yange.treasury.three_tier_ledger import ThreeTierLedger, TreasuryRuleViolation


def funded():
    t = ThreeTierLedger(D("240000"), D("500000"), D("100000"), D("10000"))
    t.start_growth_project("alpha")
    t.start_growth_project("beta")
    return t


def test_runway_math():
    t = funded()
    assert t.tier1_runway_months == 24 and t.tier1_funded_pct == 100


def test_scenario_c_protects_tier1_and_pauses_tier3():
    t = funded()
    r = Simulator(t).run_scenario_c_major_loss()
    assert r.tier1_funded_pct_after == 100
    assert r.tier1_runway_months_after == 24
    assert r.tier1_balance_unchanged and r.tier3_projects_paused and r.passed
    assert t.tier2 == D("500000") and not any(t.tier3_projects.values()), "simulator must not mutate the real ledger"


def test_all_seven_scenarios_run_and_keep_tier1_balance():
    results = Simulator(funded()).run_all()
    assert [r.scenario for r in results] == list("ABCDEFG")
    assert all(r.tier1_balance_unchanged and r.passed for r in results)


def test_burn_shock_underfunds_and_pauses_growth():
    r = Simulator(funded()).run_scenario_d()
    assert r.tier1_funded_pct_after < 100 and r.tier3_projects_paused


def test_cannot_dip_into_tier1_runway_or_exceed_cap():
    t = funded()
    with pytest.raises(TreasuryRuleViolation):
        t.transfer_from_tier1(3, D("1"))
    rich = ThreeTierLedger(D("1000000"), D("500000"), D("0"), D("10000"))
    rich.transfer_from_tier1(2, D("100000"))
    with pytest.raises(TreasuryRuleViolation):
        rich.transfer_from_tier1(3, D("700000"))
    with pytest.raises(ValueError):
        ThreeTierLedger(D("-1"), D(0), D(0), D(1))


def test_growth_blocked_when_underfunded():
    t = ThreeTierLedger(D("1000"), D("0"), D("0"), D("10000"))
    with pytest.raises(TreasuryRuleViolation):
        t.start_growth_project("x")


def test_cii_formula_and_alert():
    ok = compute_cii(80, 90)
    assert round(ok.cii, 2) == 88.89 and not ok.alert and ok.recommendation is None
    low = compute_cii(40, 90)
    assert low.alert and "Module 10" in low.recommendation
    assert compute_cii(60, 100).alert is False
    for bad in ((10, 0), (-1, 5), (float("nan"), 5)):
        with pytest.raises(ValueError):
            compute_cii(*bad)


def test_harness():
    h = ModeABHarness(seed=1)
    order = h.assign_order(["p1", "p2", "p3", "p4"])
    assert sorted(order.values()) == ["A_FIRST", "A_FIRST", "B_FIRST", "B_FIRST"]
    assert order == ModeABHarness(seed=1).assign_order(["p1", "p2", "p3", "p4"])
    h.record_mode_b("p1", 90)
    with pytest.raises(ValueError):
        h.participant_cii("p1")
    h.record_mode_a_cold_defense("p1", 45)
    assert h.participant_cii("p1").alert and h.cohort_cii().cii == 50
    with pytest.raises(ValueError):
        h.record_mode_b("p1", 101)
