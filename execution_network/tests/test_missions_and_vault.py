import base64
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from lake_yange.ui_api import create_app
from tests.conftest import Clock
from tests.test_ui_api import sig
from tests.test_unified_ui import make

WRITE = {"tool": "filesystem", "op": "write", "path": "notes/a.txt", "content": "hello\n"}
OBJ = "Summarize the runway policy and Tier 3 cap"


@pytest.fixture
def env(tmp_path):
    clock = Clock()
    app = create_app(tmp_path / "st", demo=True, clock=clock)
    c = make(app)
    st = app.state.ui
    st.rag.ingest("runway-policy", "Tier 1 runway reserves hold twenty four months of essential burn. "
                                   "Tier 3 growth allocations are capped at twenty percent.")
    return app, c, st, clock


def new(c, tool=WRITE, **kw):
    r = c.post("/api/missions", json={"objective": OBJ, "tool": tool, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def auth(app, c, m, who=("steward-1",)):
    return c.post(f"/api/missions/{m['id']}/authorize",
                  json={"signatures": [sig(app, c, s, m["proposal_id"]) for s in who]})


def test_plan_stops_at_50_and_artifacts_are_grounded(env):
    app, c, st, _ = env
    m = new(c)
    assert (m["state"], m["percent"]) == ("GATE", 50)
    assert m["scope_report"]["cited_chunk_hashes"] and m["scope_report"]["sources"][0]["source_id"] == "runway-policy"
    assert "+hello" in m["scope_report"]["diff_preview"]
    assert m["audit_matrix"]["status"] == "CLEARED"
    assert not (st.dir / "workspace" / "notes" / "a.txt").exists()  # nothing executed before the human gate


def test_no_evidence_means_vera_veto(env):
    _, c, st, _ = env
    r = c.post("/api/missions", json={"objective": "quantum zebra harpsichord", "tool": WRITE}).json()
    assert r["state"] == "BLOCKED_BY_VERA" and r["audit_matrix"]["status"] == "VERA_VETO"
    assert st.gateway.records[r["proposal_id"]].status == "BLOCKED_BY_VERA"


def test_skip_ahead_rejected_at_every_milestone(env):
    app, c, st, _ = env
    eng = st.missions
    m = c.post("/api/missions", json={"objective": OBJ, "tool": WRITE, "auto_plan": False}).json()
    assert m["percent"] == 0
    from lake_yange.agents.missions import MissionStateError
    for step in (eng.audit, eng.run, eng.seal):
        with pytest.raises(MissionStateError):
            step(m["id"])
    with pytest.raises(MissionStateError):
        eng.authorize(m["id"], [])
    assert c.post(f"/api/missions/{m['id']}/run").status_code == 409
    eng.scope(m["id"])
    assert c.post(f"/api/missions/{m['id']}/run").status_code == 409  # 25% -> 75% refused
    eng.audit(m["id"])
    r = c.post(f"/api/missions/{m['id']}/run")  # 50% -> run without a signature
    assert r.status_code == 409 and eng.get(m["id"])["percent"] == 50
    assert not (st.dir / "workspace" / "notes" / "a.txt").exists()


def test_bad_signature_does_not_advance(env):
    app, c, _, _ = env
    m = new(c)
    bad = sig(app, c, "steward-1", m["proposal_id"])
    bad["steward_id"] = "steward-2"  # signature by someone else
    r = c.post(f"/api/missions/{m['id']}/authorize", json={"signatures": [bad]})
    assert r.status_code in (403, 409)
    assert c.get(f"/api/missions/{m['id']}").json()["percent"] == 50
    assert c.post(f"/api/missions/{m['id']}/authorize", json={"signatures": []}).status_code == 403


def test_full_run_0_to_100(env):
    app, c, st, _ = env
    m = new(c)
    a = auth(app, c, m)
    assert a.status_code == 200 and a.json()["percent"] == 75 and a.json()["token_seconds_left"] == 60
    assert a.json()["gate"]["signatures"][0]["steward_id"] == "steward-1"
    r = c.post(f"/api/missions/{m['id']}/run").json()
    assert (r["state"], r["percent"]) == ("SEALED", 100)
    assert (st.dir / "workspace" / "notes" / "a.txt").read_text() == "hello\n"
    assert "+hello" in r["execution"]["diff"] and r["execution"]["isolation"]
    e = st.ledger.entries[r["seal"]["block_index"]]
    assert e.decision == "MISSION_SEALED" and e.hash == r["seal"]["block_hash"]
    st.ledger.verify()
    assert c.post(f"/api/missions/{m['id']}/run").status_code == 409  # replay refused


def test_python_mission_captures_stdout(env):
    app, c, _, _ = env
    m = new(c, {"tool": "python_sandbox", "code": "print('forge-says-hi')"})
    auth(app, c, m)
    r = c.post(f"/api/missions/{m['id']}/run").json()
    assert r["state"] == "SEALED" and "forge-says-hi" in r["execution"]["stdout"]


def test_failed_execution_is_not_sealed(env):
    app, c, _, _ = env
    m = new(c, {"tool": "python_sandbox", "code": "import sys; sys.exit(3)"})
    auth(app, c, m)
    r = c.post(f"/api/missions/{m['id']}/run").json()
    assert r["state"] == "FAILED" and r["percent"] == 90 and r["seal"] is None


def test_expired_token_rolls_back_to_gate_without_revoking_forge(env):
    app, c, st, clock = env
    m = new(c)
    auth(app, c, m)
    clock.advance(seconds=61)
    r = c.post(f"/api/missions/{m['id']}/run")
    assert r.status_code == 409 and "50%" in r.json()["detail"]
    cur = c.get(f"/api/missions/{m['id']}").json()
    assert (cur["state"], cur["percent"]) == ("GATE", 50)
    assert any(p["phase"] == "ROLLBACK 75->50" for p in cur["phases"])
    assert any(e.decision == "GATE_REOPENED" for e in st.ledger.entries)
    assert not (st.dir / "workspace" / "notes" / "a.txt").exists()
    # the human can re-authorize and the mission completes; Forge was never penalized
    assert auth(app, c, cur).status_code == 200
    assert c.post(f"/api/missions/{m['id']}/run").json()["percent"] == 100


def test_expiry_seen_on_plain_read(env):
    app, c, _, clock = env
    m = new(c)
    auth(app, c, m)
    clock.advance(seconds=90)
    assert c.get("/api/missions").json()[0]["percent"] == 50


def test_multisig_aggregation_tier2(env):
    app, c, st, clock = env
    m = new(c, amount_usd="5000")
    assert m["tier"] == 2 and m["signatures_required"] == 2
    clock.advance(hours=7)  # past the Tier 2 time-lock
    one = auth(app, c, m, ("steward-1",))
    assert one.status_code == 403 and c.get(f"/api/missions/{m['id']}").json()["percent"] == 50
    dup = c.post(f"/api/missions/{m['id']}/authorize",
                 json={"signatures": [sig(app, c, "steward-1", m["proposal_id"])] * 2})
    assert dup.status_code == 403
    two = auth(app, c, m, ("steward-1", "steward-2"))
    assert two.status_code == 200 and len(two.json()["gate"]["signatures"]) == 2


def test_queue_authorize_route_keeps_mission_in_step(env):
    app, c, _, _ = env
    m = new(c)
    r = c.post(f"/api/proposals/{m['proposal_id']}/authorize", json={"signatures": [sig(app, c, "steward-1", m["proposal_id"])]})
    assert r.status_code == 200 and r.json()["token"]
    assert c.get(f"/api/missions/{m['id']}").json()["percent"] == 75
    assert c.post(f"/api/missions/{m['id']}/run").json()["percent"] == 100


def test_state_full_includes_missions(env):
    _, c, _, _ = env
    m = new(c)
    f = c.get("/api/state/full").json()
    assert [x["id"] for x in f["missions"]] == [m["id"]] and f["rag"]["documents"] >= 1


def _revoke_sig(app, c, signer, target, reason):
    seeds = json.loads((app.state.ui.dir / "demo_stewards.json").read_text())["seeds_hex"]
    msg = c.get(f"/api/stewards/{target}/revoke-message", params={"reason": reason}).json()
    s = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seeds[signer])).sign(base64.b64decode(msg["message_b64"]))
    return {"steward_id": signer, "signature_b64": base64.b64encode(s).decode()}


def test_key_revocation_logs_event_and_blocks_signing(env):
    app, c, st, _ = env
    reason = "laptop stolen"
    r = c.post("/api/stewards/steward-3/revoke", json={"reason": reason, "signature": _revoke_sig(app, c, "steward-2", "steward-3", reason)})
    assert r.status_code == 200
    e = st.ledger.entries[r.json()["ledger_index"]]
    assert e.decision == "REVOCATION_EVENT" and "steward-3" in e.reason and e.agent_id == "steward-2"
    assert next(s for s in c.get("/api/stewards").json() if s["steward_id"] == "steward-3")["revoked"]
    m = new(c)
    assert auth(app, c, m, ("steward-3",)).status_code == 403
    assert c.post("/api/stewards/steward-3/revoke", json={"reason": reason, "signature": _revoke_sig(app, c, "steward-1", "steward-3", reason)}).status_code == 409


def test_revocation_rejects_forged_or_replayed_signature(env):
    app, c, _, _ = env
    good = _revoke_sig(app, c, "steward-1", "steward-2", "reason one")
    # signature for a different reason / different target must not verify
    assert c.post("/api/stewards/steward-2/revoke", json={"reason": "another", "signature": good}).status_code == 403
    assert c.post("/api/stewards/steward-3/revoke", json={"reason": "reason one", "signature": good}).status_code == 403
    assert c.post("/api/stewards/nobody/revoke", json={"reason": "reason one", "signature": good}).status_code == 404
    assert not any(s["revoked"] for s in c.get("/api/stewards").json())


def test_mission_writes_need_session_header(env):
    app, _, _, _ = env
    from fastapi.testclient import TestClient
    raw = TestClient(app, base_url="http://127.0.0.1:8000")
    assert raw.post("/api/missions", json={"objective": OBJ, "tool": WRITE}).status_code == 403
    assert raw.post("/api/stewards/steward-1/revoke", json={}).status_code == 403


def test_path_escape_vetoed(env):
    _, c, _, _ = env
    r = c.post("/api/missions", json={"objective": OBJ, "tool": dict(WRITE, path="../../etc/x")}).json()
    assert r["state"] == "BLOCKED_BY_VERA" and "workspace_boundary" in r["veto_reason"]


def test_lifecycle_reopen_only_before_execute():
    from lake_yange.middleware.lifecycle import Lifecycle, LifecycleViolation, Stage
    lc = Lifecycle()
    for s in (Stage.OBSERVE, Stage.ANALYZE, Stage.PROPOSE):
        lc.complete(s)
    with pytest.raises(LifecycleViolation):
        lc.reopen_gate()
    lc.complete(Stage.HUMAN_AUTHORIZATION)
    lc.reopen_gate()
    assert lc.current is Stage.HUMAN_AUTHORIZATION
    lc.complete(Stage.HUMAN_AUTHORIZATION)
    lc.complete(Stage.EXECUTE)
    with pytest.raises(LifecycleViolation):
        lc.reopen_gate()
