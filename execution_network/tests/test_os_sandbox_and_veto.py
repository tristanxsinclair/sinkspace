import json

import pytest

from lake_yange.agents.forge import Forge
from lake_yange.middleware.auth_gate import (GateError, OVERRIDE_DECISION, sign_approval)
from lake_yange.middleware.gateway import UnauthorizedExecution
from lake_yange.tools.adapters import GatedToolAdapter
from lake_yange.tools.container_runner import (ContainerToolRunner, ContainerUnavailable, MockEngine, detect_engine)
from lake_yange.tools.runner import ToolRefused
from lake_yange.tools.schemas import FileSystemTool, PythonSandboxTool
from tests.conftest import Clock  # noqa: F401


def setup_runner(w, tmp_path, runner):
    w.ws = tmp_path / "ws"
    w.runner = runner
    w.adapter = GatedToolAdapter(w.gateway, runner)
    w.forge = Forge(w.gateway, w.session["forge"], w.adapter.executor)


def sign(w, pid, ids, decision="APPROVE", tier=None):
    r = w.gateway.records[pid]
    return [sign_approval(w.keys[i], i, pid, r.p_hash, tier if tier is not None else r.tier, decision) for i in ids]


def propose(w, call):
    from lake_yange.tools.schemas import to_proposal_args
    a, t, p = to_proposal_args(call)
    return w.prime.propose(a, t, p, "t")


def run(w, pid, token):
    return w.adapter.call("forge", w.session["forge"], pid, token)


# ---- container sandbox -------------------------------------------------------------------------------------

def test_container_command_line_enforces_hard_boundaries(w, tmp_path):
    eng = MockEngine(stdout="ok")
    setup_runner(w, tmp_path, ContainerToolRunner(tmp_path / "ws", engine_binary="podman", engine=eng))
    pid = propose(w, PythonSandboxTool(code="print(1)"))
    run(w, pid, w.gateway.authorize(pid, sign(w, pid, ["s1"])))
    argv = eng.calls[0]["argv"]
    for flag in ("--read-only", "--network=none", "--cap-drop=ALL", "--security-opt=no-new-privileges",
                 "--pids-limit=64", "--memory=128m", "--cpus=1", "--user=65534:65534"):
        assert flag in argv
    assert argv[:2] == ["podman", "run"] and any(a.endswith(":/workspace:rw") for a in argv)
    assert not any(a in ("--privileged", "--network=host") for a in argv)


def test_network_payload_fails_and_is_isolated(w, tmp_path):
    # container reports the network failure; execution is recorded FAILED and the workspace is untouched
    eng = MockEngine(returncode=1, stderr="OSError: network disabled")
    setup_runner(w, tmp_path, ContainerToolRunner(tmp_path / "ws", engine_binary="podman", engine=eng))
    pid = propose(w, PythonSandboxTool(code="import socket; socket.create_connection(('1.1.1.1', 80))"))
    run(w, pid, w.gateway.authorize(pid, sign(w, pid, ["s1"])))
    assert w.gateway.records[pid].result.startswith("error:")
    assert "--network=none" in eng.calls[0]["argv"]
    assert [e.decision for e in w.ledger.entries][-1] == "FAILED"
    # the injected guard also blocks sockets inside the interpreter (defence in depth)
    assert "socket.create_connection = _b" in eng.calls[0]["stdin"]


def test_fallback_process_isolation_blocks_network(w, tmp_path):
    setup_runner(w, tmp_path, ContainerToolRunner(tmp_path / "ws", engine_binary="", allow_fallback=True))
    pid = propose(w, PythonSandboxTool(code="import socket; socket.create_connection(('127.0.0.1', 9))"))
    run(w, pid, w.gateway.authorize(pid, sign(w, pid, ["s1"])))
    assert w.gateway.records[pid].result.startswith("error:") and "network disabled" in w.gateway.records[pid].result


def test_no_engine_fails_closed_by_default(w, tmp_path):
    setup_runner(w, tmp_path, ContainerToolRunner(tmp_path / "ws", engine_binary=""))
    pid = propose(w, PythonSandboxTool(code="print('x')"))
    run(w, pid, w.gateway.authorize(pid, sign(w, pid, ["s1"])))
    assert "fail closed" in w.gateway.records[pid].result


def test_filesystem_in_container_mounts_ro_for_read_and_checks_traversal(w, tmp_path):
    eng = MockEngine(stdout="hello")
    setup_runner(w, tmp_path, ContainerToolRunner(tmp_path / "ws", engine_binary="docker", engine=eng))
    pid = propose(w, FileSystemTool(op="read", path="a.txt"))
    run(w, pid, w.gateway.authorize(pid, sign(w, pid, ["s1"])))
    assert any(a.endswith(":/workspace:ro") for a in eng.calls[0]["argv"])
    bad = propose(w, FileSystemTool(op="read", path="../etc/passwd"))
    run(w, bad, w.gateway.authorize(bad, sign(w, bad, ["s1"])))
    assert len(eng.calls) == 1  # no container started for the traversal attempt
    assert w.gateway.records[bad].result.startswith("error:")


@pytest.mark.skipif(not detect_engine(), reason="no podman/docker in this environment")
def test_real_container_network_blocked(w, tmp_path):  # pragma: no cover
    setup_runner(w, tmp_path, ContainerToolRunner(tmp_path / "ws"))
    pid = propose(w, PythonSandboxTool(code="import urllib.request; urllib.request.urlopen('http://1.1.1.1', timeout=3)"))
    run(w, pid, w.gateway.authorize(pid, sign(w, pid, ["s1"])))
    assert w.gateway.records[pid].result.startswith("error:")


# ---- Vera veto in the gateway -------------------------------------------------------------------------------

def vetoed(w):
    pid = w.prime.propose("noop", "prod:x", {}, "j", __import__("decimal").Decimal("500"))
    w.vera.veto(pid, "evidence fails verification")
    return pid


def test_vetoed_proposal_cannot_be_authorized_or_executed_with_single_signature(w):
    pid = vetoed(w)
    assert w.gateway.records[pid].status == "BLOCKED_BY_VERA"
    with pytest.raises(GateError, match="Blocked by Vera"):
        w.gateway.authorize(pid, sign(w, pid, ["s1"]))
    # a stolen/forged token path is also closed
    with pytest.raises(UnauthorizedExecution):
        w.forge.execute(pid, "a.b.c")
    assert w.gateway.records[pid].result is None
    # one or two override signatures are not enough
    for ids in (["s1"], ["s1", "s2"]):
        with pytest.raises(GateError):
            w.gateway.authorize(pid, sign(w, pid, ["s1"]), sign(w, pid, ids, OVERRIDE_DECISION, 3))
    # ordinary APPROVE signatures cannot masquerade as an override
    with pytest.raises(Exception):
        w.gateway.authorize(pid, sign(w, pid, ["s1"]), sign(w, pid, ["s1", "s2", "s3"], "APPROVE", 3))
    assert [e for e in w.ledger.entries if e.decision == "EMERGENCY_OVERRIDE"] == []


def test_late_veto_after_token_issued_blocks_execution(w):
    pid = w.prime.propose("noop", "prod:x", {}, "j", __import__("decimal").Decimal("500"))
    token = w.gateway.authorize(pid, sign(w, pid, ["s1"]))
    w.vera.veto(pid, "new evidence")
    with pytest.raises(UnauthorizedExecution, match="BLOCKED_BY_VERA"):
        w.forge.execute(pid, token)
    assert w.gateway.records[pid].result is None


def test_only_vera_can_veto(w):
    pid = w.prime.propose("noop", "prod:x", {}, "j")
    with pytest.raises(GateError):
        w.gateway.vera_veto("prime", w.session["prime"], pid, "self-veto")


def test_tier3_emergency_override_unblocks_and_logs_critical_event(w):
    pid = vetoed(w)
    token = w.gateway.authorize(pid, sign(w, pid, ["s1"]), sign(w, pid, ["s1", "s2", "s3"], OVERRIDE_DECISION, 3))
    assert w.gateway.records[pid].status == "VERA_OVERRIDDEN"
    ev = [e for e in w.ledger.entries if e.decision == "EMERGENCY_OVERRIDE"]
    assert len(ev) == 1 and "CRITICAL" in ev[0].reason and "s1,s2,s3" in ev[0].reason
    assert any("veto overridden" in a for a in w.breaker.alerts)
    assert w.forge.execute(pid, token) == "done"
    w.ledger.verify()


def test_override_is_bound_to_the_proposal(w):
    a, b = vetoed(w), vetoed(w)
    with pytest.raises(Exception):
        w.gateway.authorize(b, sign(w, b, ["s1"]), sign(w, a, ["s1", "s2", "s3"], OVERRIDE_DECISION, 3))


def test_veto_persists_across_restart(tmp_path):
    from decimal import Decimal
    from tests.test_persistence_hsm import build
    clock = Clock()
    store, ledger, breaker, gate, gw = build(tmp_path, clock)
    from lake_yange.agents.prime import Prime
    from lake_yange.agents.vera import Vera
    pid = Prime(gw, breaker.issue_session_key("prime")).propose("noop", "prod:x", {}, "j", Decimal("500"))
    Vera(gw, breaker.issue_session_key("vera")).veto(pid, "bad")
    store.close()
    _, _, _, _, gw2 = build(tmp_path, clock)
    assert gw2.records[pid].status == "BLOCKED_BY_VERA" and gw2.records[pid].veto_reason == "bad"
