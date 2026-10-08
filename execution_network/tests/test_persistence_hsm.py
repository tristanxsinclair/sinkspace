from datetime import datetime, timezone
from decimal import Decimal

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from lake_yange.agents.forge import Forge, SandboxExecutor
from lake_yange.agents.prime import Prime
from lake_yange.agents.red_sink import RedSinkAgent
from lake_yange.audit.ledger import RedSinkLedger
from lake_yange.middleware.auth_gate import AuthGate, GateError, InvalidSignature, StewardSignature, TokenError
from lake_yange.middleware.circuit_breaker import CircuitBreaker, SessionKeyError
from lake_yange.middleware.gateway import BoundedAgentGateway
from lake_yange.middleware.hsm import HsmUnavailable, Pkcs11Ed25519Signer, SignatureAggregator, SoftwareSigner
from lake_yange.storage.encrypted_store import EncryptedStore, StoreIntegrityError
from tests.conftest import Clock

KEY = bytes(range(32))


class FakeHsm(SoftwareSigner):
    """Test double that claims HSM origin; no real hardware is exercised by this suite."""
    key_origin = "HSM"



def build(tmp_path, clock, key=KEY, hsm=frozenset()):
    store = EncryptedStore(tmp_path / "state.db", key)
    ledger = RedSinkLedger(tmp_path / "l.jsonl", clock=clock)
    breaker = CircuitBreaker(ledger, store=store)
    gate = AuthGate(clock=clock, store=store, hsm_required_tiers=hsm)
    gw = BoundedAgentGateway(gate, breaker, RedSinkAgent(ledger), clock=clock, store=store)
    return store, ledger, breaker, gate, gw


def test_state_survives_restart_and_token_single_use(tmp_path):
    clock = Clock()
    store, ledger, breaker, gate, gw = build(tmp_path, clock)
    signer = SoftwareSigner("s1")
    gate.register_steward("s1", signer.public_key_raw())
    pk = breaker.issue_session_key("prime")
    fk = breaker.issue_session_key("forge")
    pid = Prime(gw, pk).propose("noop", "prod:x", {}, "j", Decimal("500"))
    r = gw.records[pid]
    agg = SignatureAggregator(pid, r.p_hash, r.tier, "APPROVE")
    agg.collect(signer)
    token = gw.authorize(pid, agg.bundle())
    store.close()

    store, ledger, breaker, gate, gw = build(tmp_path, clock)  # restart
    assert pid in gw.records and gw.records[pid].p_hash == r.p_hash
    assert len(gate.active_tokens()) == 1
    forge = Forge(gw, fk, SandboxExecutor({"noop": lambda p: "done"}))
    assert forge.execute(pid, token) == "done"
    store.close()

    store, ledger, breaker, gate, gw = build(tmp_path, clock)
    assert gw.records[pid].result == "done"
    with pytest.raises(TokenError):
        gate.redeem(token, pid, r.p_hash)


def test_revocation_and_kill_switch_survive_restart(tmp_path):
    clock = Clock()
    store, ledger, breaker, gate, gw = build(tmp_path, clock)
    k = breaker.issue_session_key("forge")
    breaker.revoke("forge", "test")
    breaker.engage_kill_switch("test")
    store.close()
    store, ledger, breaker, gate, gw = build(tmp_path, clock)
    assert breaker.is_revoked("forge") and breaker.killed
    with pytest.raises(Exception):
        breaker.validate("forge", k)


def test_wrong_key_and_tamper_fail_closed(tmp_path):
    clock = Clock()
    store, *_ = build(tmp_path, clock)
    store.put("x", "1", {"a": 1})
    store.close()
    with pytest.raises(StoreIntegrityError):
        build(tmp_path, clock, key=bytes(32))
    import sqlite3
    db = sqlite3.connect(tmp_path / "state.db")
    db.execute("UPDATE records SET id='2' WHERE kind='x'")  # move ciphertext to another id: AAD mismatch
    db.commit(); db.close()
    s = EncryptedStore(tmp_path / "state.db", KEY)
    with pytest.raises(StoreIntegrityError):
        s.get("x", "2")


def test_tampered_stored_proposal_refused(tmp_path):
    clock = Clock()
    store, ledger, breaker, gate, gw = build(tmp_path, clock)
    pk = breaker.issue_session_key("prime")
    pid = Prime(gw, pk).propose("noop", "prod:x", {}, "j", Decimal("500"))
    d = store.get("proposal", pid)
    d["proposal"]["amount_usd"] = "5"
    store.put("proposal", pid, d)
    with pytest.raises(GateError):
        build(tmp_path, clock)


def test_hsm_required_for_tier2_and_multisig(tmp_path):
    clock = Clock()
    store, ledger, breaker, gate, gw = build(tmp_path, clock, hsm=frozenset({2, 3}))
    hw = [FakeHsm(f"h{i}") for i in range(2)]
    sw = SoftwareSigner("soft")
    for s in hw + [sw]:
        gate.register_steward(s.steward_id, s.public_key_raw(), s.key_origin)
    pid = Prime(gw, breaker.issue_session_key("prime")).propose("noop", "prod:x", {}, "j", Decimal("5000"))
    r = gw.records[pid]
    clock.advance(hours=7)
    bad = SignatureAggregator(pid, r.p_hash, r.tier, "APPROVE")
    bad.collect(hw[0]); bad.collect(sw)
    with pytest.raises(InvalidSignature):
        gw.authorize(pid, bad.bundle())
    assert not gate.is_steward_revoked("soft")  # software key refused, not revoked
    good = SignatureAggregator(pid, r.p_hash, r.tier, "APPROVE")
    for s in hw:
        good.collect(s)
    assert gw.authorize(pid, good.bundle())


def test_invalid_hardware_signature_revokes_steward_persistently(tmp_path):
    clock = Clock()
    store, ledger, breaker, gate, gw = build(tmp_path, clock, hsm=frozenset({2, 3}))
    hw = FakeHsm("h0")
    gate.register_steward("h0", hw.public_key_raw(), "HSM")
    pid = Prime(gw, breaker.issue_session_key("prime")).propose("noop", "prod:x", {}, "j", Decimal("5000"))
    r = gw.records[pid]
    agg = SignatureAggregator(pid, r.p_hash, r.tier, "APPROVE")
    agg.collect(hw)
    other = SignatureAggregator(pid, r.p_hash, 3, "APPROVE")  # signature over a different tier
    other.collect(hw)
    with pytest.raises(InvalidSignature):
        gw.authorize(pid, other.bundle())
    assert gate.is_steward_revoked("h0")
    assert any(e.decision == "REVOKED" and e.agent_id == "h0" for e in ledger.entries)
    store.close()
    store, ledger, breaker, gate, gw = build(tmp_path, clock, hsm=frozenset({2, 3}))
    assert gate.is_steward_revoked("h0")
    with pytest.raises(InvalidSignature):
        gw.authorize(pid, agg.bundle())


def test_duplicate_signature_rejected_and_pkcs11_unavailable():
    s = SoftwareSigner("a")
    agg = SignatureAggregator("p", "h", 1, "APPROVE")
    agg.collect(s)
    with pytest.raises(Exception):
        agg.collect(s)
    with pytest.raises(HsmUnavailable):
        Pkcs11Ed25519Signer("a", "/nonexistent.so", "label", lambda: "0000")
