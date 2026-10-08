import json
import shutil
import subprocess
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from lake_yange.audit.anchor import AnchorError, LedgerAnchorManager, verify_anchor_chain
from lake_yange.audit.archive import EvidenceArchiveExporter
from lake_yange.audit.ledger import _digest
from lake_yange.hardware.diagnostics import LIVE, SIMULATION, HardwareDiagnosticHarness
from lake_yange.middleware.auth_gate import OVERRIDE_DECISION, GateError
from lake_yange.middleware.gateway import UnauthorizedExecution
from lake_yange.middleware.time_lock import CANCEL_DECISION, CancelWindowClosed, OverridePending, TimeLockEngine
from tests.test_os_sandbox_and_veto import sign, vetoed


# ---- anchoring ---------------------------------------------------------------------------------------------

@pytest.fixture
def anchored(w, tmp_path):
    witness = Ed25519PrivateKey.generate()
    pub = witness.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    mgr = LedgerAnchorManager(tmp_path / "anchors.jsonl", witness.sign, clock=w.clock)
    for i in range(3):
        w.prime.propose("noop", "sandbox:x", {"i": i}, "j")
    mgr.snapshot(w.ledger)
    w.prime.propose("noop", "sandbox:x", {"i": 9}, "j")
    mgr.snapshot(w.ledger)
    w.mgr, w.pub = mgr, pub
    return w


def lines(path):
    return path.read_text().splitlines()


def test_anchor_payload_fields_and_clean_chain_verifies(anchored):
    a = anchored.mgr.anchors()
    assert len(a) == 2
    assert set(a[0]) == {"anchor_id", "timestamp", "head_hash", "block_height", "previous_anchor_hash", "signature"}
    assert a[0]["previous_anchor_hash"] == "0" * 64 and a[1]["previous_anchor_hash"] != "0" * 64
    rep = verify_anchor_chain(anchored.path, anchored.mgr._file, anchored.pub)
    assert rep.valid and rep.anchors_checked == 2


def test_single_modified_block_is_detected_even_with_chain_recomputed(anchored, tmp_path):
    ls = lines(anchored.path)
    # naive tamper: edit one block, leave hashes alone
    e = json.loads(ls[1])
    e["reason"] = "rewritten"
    naive = tmp_path / "naive.jsonl"
    naive.write_text("\n".join(ls[:1] + [json.dumps(e)] + ls[2:]) + "\n")
    rep = verify_anchor_chain(naive, anchored.mgr._file, anchored.pub)
    assert not rep.valid and any("Block 1" in p for p in rep.problems)

    # root-level tamper: attacker edits block 1 and recomputes every later hash
    entries, prev = [json.loads(x) for x in ls], "0" * 64
    entries[1]["reason"] = "rewritten"
    for en in entries:
        en["prev_hash"] = prev
        en["hash"] = _digest({k: v for k, v in en.items() if k != "hash"})
        prev = en["hash"]
    forged = tmp_path / "forged.jsonl"
    forged.write_text("\n".join(json.dumps(x) for x in entries) + "\n")
    rep = verify_anchor_chain(forged, anchored.mgr._file, anchored.pub)
    assert not rep.valid and any("diverges from anchor 0" in p for p in rep.problems)


def test_truncation_forged_anchor_and_wrong_witness_are_detected(anchored, tmp_path):
    short = tmp_path / "short.jsonl"
    short.write_text("\n".join(lines(anchored.path)[:2]) + "\n")
    assert any("truncated" in p for p in verify_anchor_chain(short, anchored.mgr._file, anchored.pub).problems)
    other = Ed25519PrivateKey.generate().public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    assert not verify_anchor_chain(anchored.path, anchored.mgr._file, other).valid
    af = anchored.mgr._file
    a = [json.loads(x) for x in lines(af)]
    a[0]["head_hash"] = "f" * 64
    af.write_text("\n".join(json.dumps(x) for x in a) + "\n")
    assert not verify_anchor_chain(anchored.path, af, anchored.pub).valid


def test_works_on_exported_archive_and_manager_refuses_shrunk_ledger(anchored, tmp_path):
    arc = tmp_path / "arc.jsonl"
    EvidenceArchiveExporter(clock=anchored.clock).export(anchored.ledger, arc)
    assert verify_anchor_chain(arc, anchored.mgr._file, anchored.pub).valid
    anchored.ledger._entries.pop()
    with pytest.raises(AnchorError, match="truncated"):
        anchored.mgr.snapshot(anchored.ledger)


def test_export_formats(anchored, tmp_path):
    a = anchored.mgr.anchors()[-1]
    tsq = LedgerAnchorManager.export_rfc3161_request(a)
    assert tsq[0] == 0x30 and bytes.fromhex("608648016503040201") in tsq
    import hashlib
    from lake_yange.audit.anchor import _canon
    assert hashlib.sha256(_canon(a)).digest() in tsq
    assert a["head_hash"] in LedgerAnchorManager.export_witness_line(a)
    assert LedgerAnchorManager.git_tag_argv(a)[:3] == ["git", "tag", "-s"]
    if shutil.which("openssl"):
        f = tmp_path / "r.tsq"
        f.write_bytes(tsq)
        out = subprocess.run(["openssl", "ts", "-query", "-in", str(f), "-text"], capture_output=True, text=True)
        assert out.returncode == 0 and "SHA-256" in out.stdout.upper().replace("SHA256", "SHA-256")
    if shutil.which("git"):
        repo = tmp_path / "repo"
        repo.mkdir()
        env = ["-c", "user.name=t", "-c", "user.email=t@t"]
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        subprocess.run(["git", *env, "commit", "-q", "--allow-empty", "-m", "x"], cwd=repo, check=True)
        import os
        os.environ.update(GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        name = anchored.mgr.create_git_tag(repo, a, signed=False)
        assert name in subprocess.run(["git", "tag"], cwd=repo, capture_output=True, text=True).stdout


# ---- emergency override time-lock --------------------------------------------------------------------------

@pytest.fixture
def tl(w):
    w.gateway.time_lock = TimeLockEngine(w.gate, w.gateway.red_sink, None, w.clock)
    return w


def file_override(w, pid):
    with pytest.raises(OverridePending):
        w.gateway.authorize(pid, sign(w, pid, ["s1"]), sign(w, pid, ["s1", "s2", "s3"], OVERRIDE_DECISION, 3))


def test_override_cannot_execute_before_24h_and_runs_cleanly_after(tl):
    w, pid = tl, vetoed(tl)
    file_override(w, pid)
    st = w.gateway.time_lock.status(pid)
    assert st["state"] == "PENDING_TIME_LOCK" and st["seconds_left"] == 86400
    assert any(e.decision == "OVERRIDE_PENDING" and "CRITICAL" in e.reason for e in w.ledger.entries)
    assert w.gateway.records[pid].status == "BLOCKED_BY_VERA"
    w.clock.advance(seconds=86399)
    with pytest.raises(OverridePending):
        w.gateway.authorize(pid, sign(w, pid, ["s1"]))
    assert w.gateway.records[pid].status == "BLOCKED_BY_VERA"
    with pytest.raises(UnauthorizedExecution):
        w.forge.execute(pid, "not-a-token")
    w.clock.advance(seconds=1)
    token = w.gateway.authorize(pid, sign(w, pid, ["s1"]))
    assert w.gateway.records[pid].status == "VERA_OVERRIDDEN"
    assert w.forge.execute(pid, token) == "done"
    assert any(e.decision == "EMERGENCY_OVERRIDE" for e in w.ledger.entries)
    w.ledger.verify()


def test_cancel_override_with_two_stewards_aborts_it(tl):
    w, pid = tl, vetoed(tl)
    file_override(w, pid)
    w.clock.advance(hours=3)
    with pytest.raises(GateError):  # one steward is not enough
        w.gateway.cancel_override(pid, sign(w, pid, ["s1"], CANCEL_DECISION, 3))
    with pytest.raises(GateError):  # an override signature cannot masquerade as a cancel
        w.gateway.cancel_override(pid, sign(w, pid, ["s1", "s2"], OVERRIDE_DECISION, 3))
    w.gateway.cancel_override(pid, sign(w, pid, ["s2", "s3"], CANCEL_DECISION, 3))
    assert w.gateway.time_lock.status(pid)["state"] == "CANCELLED"
    assert any(e.decision == "OVERRIDE_CANCELLED" for e in w.ledger.entries)
    w.clock.advance(hours=48)
    with pytest.raises(GateError):
        w.gateway.authorize(pid, sign(w, pid, ["s1"]))
    assert w.gateway.records[pid].status == "BLOCKED_BY_VERA"


def test_cancel_window_closes_after_24h_and_cooling_cannot_be_shortened(tl):
    w, pid = tl, vetoed(tl)
    file_override(w, pid)
    w.clock.advance(hours=24)
    with pytest.raises(CancelWindowClosed):
        w.gateway.cancel_override(pid, sign(w, pid, ["s1", "s2"], CANCEL_DECISION, 3))
    with pytest.raises(ValueError):
        TimeLockEngine(w.gate, w.gateway.red_sink, cooling_period=60)


def test_pending_override_survives_restart(tmp_path):
    from tests.conftest import Clock
    from tests.test_persistence_hsm import build
    from decimal import Decimal
    from lake_yange.agents.prime import Prime
    from lake_yange.agents.vera import Vera
    clock = Clock()
    store, ledger, breaker, gate, gw = build(tmp_path, clock)
    eng = TimeLockEngine(gate, gw.red_sink, store, clock)
    pid = Prime(gw, breaker.issue_session_key("prime")).propose("noop", "prod:x", {}, "j", Decimal("500"))
    Vera(gw, breaker.issue_session_key("vera")).veto(pid, "bad")
    keys = {}
    for sid in ("a", "b", "c"):
        k = Ed25519PrivateKey.generate()
        keys[sid] = k
        gate.register_steward(sid, k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    from lake_yange.middleware.auth_gate import sign_approval
    r = gw.records[pid]
    eng.file(pid, r.p_hash, [sign_approval(keys[s], s, pid, r.p_hash, 3, OVERRIDE_DECISION) for s in keys])
    store.close()
    store2, _, _, _, gw2 = build(tmp_path, clock)
    eng2 = TimeLockEngine(gw2.gate, gw2.red_sink, store2, clock)
    assert eng2.status(pid)["state"] == "PENDING_TIME_LOCK"
    with pytest.raises(OverridePending):
        eng2.release(pid, r.p_hash)
    clock.advance(hours=24)
    assert eng2.release(pid, r.p_hash) == ["a", "b", "c"]


# ---- hardware diagnostics ----------------------------------------------------------------------------------

class FakeInfo:
    def __init__(self, label="YubiKey", maker="Yubico"):
        self.label, self.manufacturerID, self.model, self.serialNumber = label, maker, "YK5", "123"


class FakePk:
    def __init__(self, tokens=(FakeInfo(),), boom=False):
        self._t, self._boom = tokens, boom

    def PyKCS11Lib(self):
        return self

    def load(self, path):
        if self._boom:
            raise RuntimeError("bad module")

    def getSlotList(self, tokenPresent=True):
        return list(range(len(self._t)))

    def getTokenInfo(self, slot):
        return self._t[slot]


def harness(tmp_path, pk=None, attest=None, ping=None, sock=None):
    lib = tmp_path / "libykcs11.so"
    lib.write_text("x")
    def imp(name):
        if pk is None:
            raise ImportError(name)
        return pk
    return HardwareDiagnosticHarness([str(lib)], [str(sock)] if sock else [], imp, ping or (lambda p: ""),
                                     lambda n: None, attest)


def test_hardware_defaults_to_simulation_when_nothing_present(tmp_path):
    h = HardwareDiagnosticHarness([], [str(tmp_path / "nope.sock")], lambda n: (_ for _ in ()).throw(ImportError(n)))
    rep = json.loads(h.report_json())
    assert rep["mode"] == SIMULATION and rep["pkcs11"]["pykcs11_installed"] is False
    assert rep["container_engine"]["mode"] == SIMULATION


def test_pkcs11_live_only_when_present_and_attested(tmp_path):
    assert harness(tmp_path, FakePk(), attest=lambda t: True).check_pkcs11_device()["mode"] == LIVE
    no_att = harness(tmp_path, FakePk()).check_pkcs11_device()
    assert no_att["mode"] == SIMULATION and "attestation" in no_att["reason"]
    failed = harness(tmp_path, FakePk(), attest=lambda t: False).check_pkcs11_device()
    assert failed["mode"] == SIMULATION and "FAILED CLOSED" in failed["reason"]
    boom = harness(tmp_path, FakePk(boom=True), attest=lambda t: True).check_pkcs11_device()
    assert boom["mode"] == SIMULATION and "FAILED CLOSED" in boom["reason"]
    malformed = harness(tmp_path, FakePk((FakeInfo("", ""),)), attest=lambda t: True).check_pkcs11_device()
    assert malformed["mode"] == SIMULATION and "FAILED CLOSED" in malformed["reason"]
    raising = harness(tmp_path, FakePk(), attest=lambda t: 1 / 0).check_pkcs11_device()
    assert raising["mode"] == SIMULATION


def test_container_socket_detection_fails_closed_on_bad_reply(tmp_path):
    import socket as so
    path = "/tmp/lyt_%d.sock" % id(tmp_path)
    srv = so.socket(so.AF_UNIX, so.SOCK_STREAM)
    srv.bind(path)
    srv.listen(1)
    try:
        ok = HardwareDiagnosticHarness([], [path], ping=lambda p: "HTTP/1.0 200 OK\r\n\r\nOK").check_container_engine()
        assert ok["mode"] == LIVE and ok["sockets"][0]["responsive"]
        bad = HardwareDiagnosticHarness([], [path], ping=lambda p: "garbage").check_container_engine()
        assert bad["mode"] == SIMULATION and "FAILED CLOSED" in bad["reason"]
        err = HardwareDiagnosticHarness([], [path], ping=lambda p: 1 / 0).check_container_engine()
        assert err["mode"] == SIMULATION
    finally:
        srv.close()
        Path(path).unlink()
