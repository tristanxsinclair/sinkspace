import json
import sqlite3
from decimal import Decimal

import pytest

from lake_yange.agents.orchestrator import Orchestrator, VeraVeto
from lake_yange.agents.forge import Forge
from lake_yange.agents.red_sink import RedSinkAgent
from lake_yange.middleware.auth_gate import sign_approval
from lake_yange.middleware.gateway import UnauthorizedExecution
from lake_yange.research.deep_research import Claim, DeepResearch
from lake_yange.research.vector_store import IntegrityError, VectorStore
from lake_yange.tools.adapters import GatedToolAdapter
from lake_yange.tools.runner import PathViolation, ToolRefused, ToolRunner, resolve_in_workspace
from lake_yange.tools.schemas import DatabaseQueryTool, FileSystemTool, PythonSandboxTool, parse_tool_call, to_proposal_args


@pytest.fixture
def tw(w, tmp_path):
    w.ws = tmp_path / "workspace"
    w.runner = ToolRunner(w.ws)
    w.adapter = GatedToolAdapter(w.gateway, w.runner)
    w.forge = Forge(w.gateway, w.session["forge"], w.adapter.executor)
    w.store = VectorStore()
    w.orch = Orchestrator(w.gateway, RedSinkAgent(w.ledger), w.prime, w.vera, w.forge, w.runner, w.store)
    return w


def human(w):
    def cb(pid, p_hash, tier):
        return [sign_approval(w.keys["s1"], "s1", pid, p_hash, tier, "APPROVE")]
    return cb


def propose(w, call):
    return w.orch.draft(call, "test")


def approve(w, pid):
    r = w.gateway.records[pid]
    return w.gateway.authorize(pid, human(w)(pid, r.p_hash, r.tier))


def test_runner_refuses_without_token_and_directly(tw):
    pid = propose(tw, PythonSandboxTool(code="print(1)"))
    with pytest.raises(UnauthorizedExecution):
        tw.adapter.call("forge", tw.session["forge"], pid, None)
    assert tw.breaker.is_revoked("forge")
    with pytest.raises(ToolRefused):
        tw.runner(tw.gateway.records[pid].proposal)  # direct call bypassing the gate


def test_tampered_and_expired_token_fail(tw):
    pid = propose(tw, PythonSandboxTool(code="print(1)"))
    token = approve(tw, pid)
    with pytest.raises(UnauthorizedExecution):
        tw.adapter.call("forge", tw.session["forge"], pid, token[:-2] + "xx")
    assert tw.breaker.is_revoked("forge")
    k = tw.session["forge"]
    tw.breaker._revoked.discard("forge")
    tw.breaker._key_hashes["forge"] = __import__("hashlib").sha256(k.encode()).hexdigest()  # test-only reinstatement
    tw.clock.advance(seconds=61)
    with pytest.raises(UnauthorizedExecution):
        tw.adapter.call("forge", k, pid, token)


def test_token_cannot_authorize_other_tool_call(tw):
    a = propose(tw, PythonSandboxTool(code="print('a')"))
    b = propose(tw, PythonSandboxTool(code="print('b')"))
    token = approve(tw, a)
    with pytest.raises(UnauthorizedExecution):
        tw.adapter.call("forge", tw.session["forge"], b, token)


def test_spent_token_reuse_fails(tw):
    pid = propose(tw, PythonSandboxTool(code="print('hi')"))
    token = approve(tw, pid)
    out = json.loads(tw.adapter.call("forge", tw.session["forge"], pid, token))
    assert out["output"] == "hi\n"
    tw.breaker._revoked.clear()
    with pytest.raises(UnauthorizedExecution):
        tw.adapter.call("forge", tw.session["forge"], pid, token)


def test_python_sandbox_failure_timeout_and_no_network(tw):
    for code, kw in (("raise SystemExit(3)", {}), ("while True: pass", {"timeout_s": 0.5}),
                     ("import socket; socket.socket()", {})):
        pid = propose(tw, PythonSandboxTool(code=code, **kw))
        tw.adapter.call("forge", tw.session["forge"], pid, approve(tw, pid))
        assert tw.gateway.records[pid].result.startswith("error:")


def test_path_traversal_blocked(tw, tmp_path):
    tw.ws.mkdir(exist_ok=True)
    (tmp_path / "secret.txt").write_text("s")
    (tw.ws / "link").symlink_to(tmp_path)
    for bad in ("../secret.txt", "/etc/passwd", "/workspace/../secret.txt", "link/secret.txt", "a\x00b"):
        with pytest.raises(PathViolation):
            resolve_in_workspace(tw.ws, bad)
    assert resolve_in_workspace(tw.ws, "/workspace/ok.txt") == tw.ws.resolve() / "ok.txt"


def test_filesystem_and_state_hashes_in_ledger(tw):
    pid = propose(tw, FileSystemTool(op="write", path="/workspace/n.txt", content="hello"))
    tw.adapter.call("forge", tw.session["forge"], pid, approve(tw, pid))
    assert (tw.ws / "n.txt").read_text() == "hello"
    res = json.loads(tw.gateway.records[pid].result)
    assert res["pre_state_hash"] != res["post_state_hash"]
    last = [e for e in tw.ledger.entries if e.decision == "EXECUTED"][-1]
    assert res["post_state_hash"] in last.result
    tw.ledger.verify()


def test_database_read_only_enforced(tw):
    tw.ws.mkdir(exist_ok=True)
    db = sqlite3.connect(tw.ws / "l.db"); db.execute("create table t(x)"); db.execute("insert into t values (1)"); db.commit(); db.close()
    ok = propose(tw, DatabaseQueryTool(db_path="l.db", sql="select x from t"))
    assert json.loads(json.loads(tw.adapter.call("forge", tw.session["forge"], ok, approve(tw, ok)))["output"])["rows"] == [[1]]
    for sql in ("insert into t values (2)", "attach database '/tmp/x.db' as y", "pragma query_only=off"):
        pid = propose(tw, DatabaseQueryTool(db_path="l.db", sql=sql))
        tw.adapter.call("forge", tw.session["forge"], pid, approve(tw, pid))
        assert tw.gateway.records[pid].result.startswith("error:")
    w = propose(tw, DatabaseQueryTool(db_path="l.db", sql="insert into t values (2)", mode="write"))
    tw.adapter.call("forge", tw.session["forge"], w, approve(tw, w))
    assert sqlite3.connect(tw.ws / "l.db").execute("select count(*) from t").fetchone()[0] == 2


def test_tool_calls_never_tier0_auto_approved(tw):
    pid = propose(tw, PythonSandboxTool(code="print(1)"))
    from lake_yange.middleware.auth_gate import GateError
    with pytest.raises(GateError):
        tw.gateway.authorize(pid, [])
    assert to_proposal_args(PythonSandboxTool(code="x"))[1].startswith("workspace:")


def test_schema_strict():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        parse_tool_call({"tool": "shell", "cmd": "rm -rf /"})
    with pytest.raises(ValidationError):
        parse_tool_call({"tool": "python_sandbox", "code": "1", "extra": 1})


DOCS = {
    "treasury": "Tier 1 holds cash for twenty four months of essential operations. Tier 3 volatile assets are capped at twenty percent of the total treasury.",
    "gate": "The authorization gate requires a human Ed25519 signature before any execution. Tier 2 spending needs two stewards and a six hour time lock.",
    "gate2": "A human steward signature is mandatory; agents hold no execution authority. Execution tokens live sixty seconds.",
}


def test_research_returns_grounded_passages_and_hashes():
    s = VeraStore = VectorStore()
    for k, v in DOCS.items():
        s.ingest(k, v)
    rep = DeepResearch(s).run("How long is the Tier 1 runway? and what signature does execution require?")
    assert len(rep.sub_questions) == 2
    assert all(r.status != "UNGROUNDED" for r in rep.matrix)
    gate_row = rep.matrix[1]
    assert gate_row.status == "GROUNDED" and set(gate_row.sources) >= {"gate", "gate2"}
    for st in rep.statements:
        p = s.get(st.chunk_hash)
        assert s.verify(p) and st.text in p.text
    assert rep.report_hash == DeepResearch(s).run("How long is the Tier 1 runway? and what signature does execution require?").report_hash
    unk = DeepResearch(s).run("quantum chromodynamics lattice")
    assert unk.ungrounded and unk.statements == []


def test_vera_flags_ungrounded_claims_and_refuses_rewrite():
    s = VectorStore()
    s.ingest("treasury", DOCS["treasury"])
    h = s.search("Tier 1 cash")[0].chunk_hash
    audits = DeepResearch(s).auditor.audit_claims([
        Claim(text="Tier 1 holds cash for twenty four months", cited_chunk_hashes=[h]),
        Claim(text="Profits are guaranteed"),
        Claim(text="Tier 1 holds cash", cited_chunk_hashes=["0" * 64]),
        Claim(text="The moon is cheese made of dairy", cited_chunk_hashes=[h])])
    assert [a.status for a in audits] == ["GROUNDED", "MISSING_CITATION", "UNKNOWN_CITATION", "UNSUPPORTED_BY_CITED_PASSAGE"]
    with pytest.raises(ValueError):
        s.ingest("treasury", "different")
    s._db.execute("UPDATE docs SET text='tampered text'"); s._db.commit()
    with pytest.raises(IntegrityError):
        s.verify_all()


def test_end_to_end_orchestration(tw):
    tw.store.ingest("treasury", DOCS["treasury"])
    h = tw.store.search("Tier 1 cash")[0].chunk_hash
    call = FileSystemTool(op="write", path="report.txt", content="runway 24 months", evidence_chunk_hashes=[h])
    out = json.loads(tw.orch.run(call, "write research note", human(tw)))
    assert out["output"].startswith("wrote")
    assert (tw.ws / "report.txt").read_text() == "runway 24 months"
    decisions = [e.decision for e in tw.ledger.entries]
    assert decisions[-4:] == ["PROPOSED", "APPROVED", "EXECUTED", "REVIEWED"]
    assert any("s1:" in e.reason for e in tw.ledger.entries if e.decision == "APPROVED")
    tw.ledger.verify()
    assert not tw.breaker.is_revoked("forge")


def test_vera_vetoes_bad_evidence_and_paths(tw):
    for call in (FileSystemTool(op="read", path="../x"),
                 PythonSandboxTool(code="1", evidence_chunk_hashes=["f" * 64])):
        pid = tw.orch.draft(call, "x")
        with pytest.raises(VeraVeto):
            tw.orch.vet(pid)
        assert pid in tw.orch.vetoed
    with pytest.raises(VeraVeto):
        tw.orch.run(FileSystemTool(op="read", path="../x"), "x", human(tw))
