from decimal import Decimal

import pytest

from lake_yange.audit.ledger import LedgerIntegrityError, RedSinkLedger
from lake_yange.middleware import rbac
from lake_yange.middleware.auth_gate import (
    AgentActionProposal, InsufficientSignatures, InvalidSignature, TimeLockActive, TokenError, required_tier,
    sign_approval,
)
from lake_yange.middleware.circuit_breaker import KillSwitchEngaged, SessionKeyError
from lake_yange.middleware.gateway import TierBypassAttempt, UnauthorizedExecution
from lake_yange.middleware.lifecycle import Lifecycle, LifecycleViolation, Stage


def sigs(w, pid, ids, decision="APPROVE"):
    r = w.gateway.records[pid]
    return [sign_approval(w.keys[i], i, pid, r.p_hash, r.tier, decision) for i in ids]


def test_execute_without_human_signature_fails_and_revokes(w):
    pid = w.prime.propose("noop", "prod:site", {}, "deploy", Decimal("500"))
    with pytest.raises(UnauthorizedExecution):
        w.forge.execute(pid, "")
    assert w.breaker.is_revoked("forge")
    with pytest.raises(SessionKeyError):
        w.forge.execute(pid, "x")
    assert w.gateway.records[pid].result is None


def test_forged_token_and_skipped_gate_fail(w):
    pid = w.prime.propose("noop", "prod:site", {}, "deploy", Decimal("500"))
    with pytest.raises(UnauthorizedExecution):
        w.forge.execute(pid, "a.b.c")
    assert w.gateway.records[pid].result is None


def test_tier_bypass_fails_and_revokes_keys(w):
    cheap = AgentActionProposal(agent_id="prime", action_type="noop", target_system="prod:x", payload={},
                                requested_tier=0, justification="sneaky", amount_usd=Decimal("5000"))
    with pytest.raises(TierBypassAttempt):
        w.gateway.submit("prime", w.session["prime"], cheap)
    assert w.breaker.is_revoked("prime")
    assert any("RED SINK ALERT" in a for a in w.breaker.alerts)
    assert any(e.decision == "REVOKED" for e in w.ledger.entries)
    with pytest.raises(SessionKeyError):
        w.prime.propose("noop", "prod:x", {}, "again")


def test_impersonation_revokes(w):
    p = AgentActionProposal(agent_id="vera", action_type="noop", target_system="sandbox:x", payload={},
                            requested_tier=0, justification="j")
    with pytest.raises(TierBypassAttempt):
        w.gateway.submit("prime", w.session["prime"], p)
    assert w.breaker.is_revoked("prime")


@pytest.mark.parametrize("amount,tier", [("99.99", 0), ("100", 1), ("1000", 1), ("1000.01", 2), ("10000", 2), ("10000.01", 3)])
def test_tier_boundaries(amount, tier):
    assert required_tier(Decimal(amount)) == tier


def test_full_lifecycle_tier1_single_use_token(w):
    pid = w.prime.propose("noop", "prod:site", {"a": 1}, "deploy", Decimal("500"))
    token = w.gateway.authorize(pid, sigs(w, pid, ["s1"]))
    assert w.forge.execute(pid, token) == "done"
    with pytest.raises(UnauthorizedExecution):  # replay: lifecycle already past EXECUTE
        w.forge.execute(pid, token)
    w.vera.review(pid, "ok")
    assert w.gateway.records[pid].lifecycle.done
    w.ledger.verify()
    decisions = [e.decision for e in w.ledger.entries]
    assert decisions[:3] == ["PROPOSED", "APPROVED", "EXECUTED"] and "REVOKED" in decisions


def test_token_expires_after_60s_and_is_bound_to_proposal(w):
    a = w.prime.propose("noop", "prod:a", {}, "a", Decimal("500"))
    b = w.prime.propose("noop", "prod:b", {}, "b", Decimal("500"))
    ta = w.gateway.authorize(a, sigs(w, a, ["s1"]))
    with pytest.raises(TokenError):
        w.gate.redeem(ta, b, w.gateway.records[b].p_hash)
    tb = w.gateway.authorize(b, sigs(w, b, ["s1"]))
    w.clock.advance(seconds=61)
    with pytest.raises(UnauthorizedExecution):
        w.forge.execute(b, tb)


def test_signature_for_other_proposal_or_modified_hash_fails(w):
    a = w.prime.propose("noop", "prod:a", {}, "a", Decimal("500"))
    b = w.prime.propose("noop", "prod:b", {}, "b", Decimal("500"))
    with pytest.raises(InvalidSignature):
        w.gateway.authorize(b, sigs(w, a, ["s1"]))
    assert w.gateway.records[b].lifecycle.current is Stage.HUMAN_AUTHORIZATION


def test_tier1_needs_one_valid_signature(w):
    pid = w.prime.propose("noop", "prod:a", {}, "a", Decimal("500"))
    with pytest.raises(InsufficientSignatures):
        w.gateway.authorize(pid, [])


def test_tier2_multisig_and_timelock(w):
    pid = w.prime.propose("noop", "prod:a", {}, "a", Decimal("5000"))
    with pytest.raises(InsufficientSignatures):
        w.gateway.authorize(pid, sigs(w, pid, ["s1"]))
    with pytest.raises(InvalidSignature):  # same steward twice does not count twice
        w.gateway.authorize(pid, sigs(w, pid, ["s1", "s1"]))
    with pytest.raises(TimeLockActive):
        w.gateway.authorize(pid, sigs(w, pid, ["s1", "s2"]))
    w.clock.advance(hours=6)
    assert w.gateway.authorize(pid, sigs(w, pid, ["s1", "s2"]))


def test_tier3_needs_three_and_24h(w):
    pid = w.prime.propose("noop", "prod:a", {}, "a", Decimal("50000"))
    w.clock.advance(hours=24)
    with pytest.raises(InsufficientSignatures):
        w.gateway.authorize(pid, sigs(w, pid, ["s1", "s2"]))
    assert w.gateway.authorize(pid, sigs(w, pid, ["s1", "s2", "s3"]))


def test_tier0_sandbox_auto_approved_but_prod_is_not(w):
    s = w.prime.propose("noop", "sandbox:x", {}, "t", Decimal("50"))
    assert w.forge.execute(s, w.gateway.authorize(s, [])) == "done"
    p = w.prime.propose("noop", "prod:x", {}, "t", Decimal("50"))
    with pytest.raises(InsufficientSignatures):
        w.gateway.authorize(p, [])


def test_rejection_is_terminal_and_signed(w):
    pid = w.prime.propose("noop", "prod:a", {}, "a", Decimal("500"))
    w.gateway.reject(pid, sigs(w, pid, ["s1"], "REJECT")[0], "no")
    with pytest.raises(Exception):
        w.gateway.authorize(pid, sigs(w, pid, ["s1"]))
    assert w.ledger.entries[-1].decision == "REJECTED"


def test_rbac_agents_have_no_authority(w):
    for agent in ("prime", "vera", "forge", "red_sink"):
        for action in rbac.Action:
            if agent == "prime" and action in (rbac.Action.OBSERVE, rbac.Action.ANALYZE, rbac.Action.PROPOSE):
                continue
            if (agent, action) in {("vera", rbac.Action.OBSERVE), ("vera", rbac.Action.ANALYZE), ("vera", rbac.Action.REVIEW),
                                   ("forge", rbac.Action.OBSERVE), ("forge", rbac.Action.EXECUTE), ("red_sink", rbac.Action.RECORD)}:
                continue
            with pytest.raises(rbac.PermissionDenied):
                rbac.check(agent, action)
    for a in (w.prime, w.vera, w.forge):
        assert not hasattr(a, "authorize") and not hasattr(a, "approve")
    with pytest.raises(rbac.PermissionDenied):
        w.gateway.execute("prime", w.session["prime"], "x", "t", lambda p: "")


def test_lifecycle_cannot_skip_stages():
    lc = Lifecycle()
    with pytest.raises(LifecycleViolation):
        lc.complete(Stage.EXECUTE)
    for s in Stage:
        lc.complete(s)
    assert lc.done


def test_sandbox_failure_is_recorded_not_hidden(w):
    pid = w.prime.propose("boom", "sandbox:x", {}, "t", Decimal("1"))
    out = w.forge.execute(pid, w.gateway.authorize(pid, []))
    assert out.startswith("error:")
    assert any(e.decision == "FAILED" for e in w.ledger.entries)


def test_kill_switch_halts_everything(w):
    w.breaker.engage_kill_switch("drill")
    with pytest.raises(KillSwitchEngaged):
        w.prime.propose("noop", "sandbox:x", {}, "t")


def test_ledger_tamper_gap_and_reload_fail_closed(w):
    pid = w.prime.propose("noop", "prod:a", {}, "a", Decimal("500"))
    w.gateway.authorize(pid, sigs(w, pid, ["s1"]))
    text = w.path.read_text()
    reloaded = RedSinkLedger(w.path)
    assert len(reloaded.entries) == 2
    w.path.write_text(text.replace("steward quorum verified", "forged"))
    with pytest.raises(LedgerIntegrityError):
        RedSinkLedger(w.path)
    lines = text.splitlines()
    w.path.write_text(lines[1] + "\n")
    with pytest.raises(LedgerIntegrityError):
        RedSinkLedger(w.path)
    w.path.write_text(text + "garbage\n")
    with pytest.raises(LedgerIntegrityError):
        RedSinkLedger(w.path)


def test_ledger_record_shape(w):
    w.prime.propose("noop", "prod:a", {}, "why", Decimal("500"))
    e = w.ledger.entries[0].model_dump()
    for k in ("timestamp", "date", "agent_id", "decision", "reason", "evidence_hash", "alternatives", "result"):
        assert k in e
