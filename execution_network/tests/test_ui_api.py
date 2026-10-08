import base64
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from lake_yange.audit.ledger import RedSinkLedger
from lake_yange.middleware.auth_gate import OVERRIDE_DECISION, approval_message
from lake_yange.ui_api import create_app
from tests.conftest import Clock


def sig(app, c, sid, pid, decision="APPROVE"):
    import json
    seeds = json.loads((app.state.ui.dir / "demo_stewards.json").read_text())["seeds_hex"]
    key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seeds[sid]))
    m = c.get(f"/api/proposals/{pid}/signing-message", params={"decision": decision}).json()
    s = key.sign(base64.b64decode(m["message_b64"]))
    return {"steward_id": sid, "signature_b64": base64.b64encode(s).decode()}


@pytest.fixture
def env(tmp_path):
    clock = Clock()
    app = create_app(tmp_path / "st", demo=True, clock=clock)
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    tok = re.search(r'name="ly-session" content="([^"]+)"', c.get("/").text).group(1)
    c.headers["X-LY-Session"] = tok
    props = {p["action_type"]: p for p in c.get("/api/proposals").json()}
    return app, c, props, clock


def test_page_is_offline_and_embeds_session(env):
    app, c, *_ = env
    html = c.get("/").text
    assert not re.search(r'(src|href)=["\']https?://', html) and "__SESSION_TOKEN__" not in html
    assert "default-src 'self'" in c.get("/").headers["content-security-policy"]


def test_reads_reflect_state(env):
    app, c, props, _ = env
    assert c.get("/api/status").json()["chain_valid"] is True
    assert len(props) == 3 and props["vendor-payment"]["status"] == "BLOCKED_BY_VERA"
    assert props["deploy-service"]["tier"] == 2 and props["deploy-service"]["time_lock_active"] is True
    assert props["write-report"]["awaiting_human"] and props["write-report"]["stage"] == "HUMAN_AUTHORIZATION"
    t = c.get("/api/treasury").json()
    assert t["tier1"] == "1200000.00" and Decimal(t["tier1_runway_months"]) == 24
    ci = c.get("/api/cii").json()
    assert ci["mean"] is not None and [a["subject"] for a in ci["alerts"]] == ["subject-03"]
    assert len(c.get("/api/stewards").json()) == 3
    audit = c.get("/api/audit").json()
    assert audit["total"] >= 3 and c.get("/api/audit/verify").json()["valid"]
    assert c.get("/api/proposals/nope/signing-message").status_code == 404


def test_authorize_issues_60s_token_and_ledger_updates(env):
    app, c, props, _ = env
    pid = props["write-report"]["id"]
    r = c.post(f"/api/proposals/{pid}/authorize", json={"signatures": [sig(app, c, "steward-1", pid)]})
    assert r.status_code == 200 and r.json()["seconds_left"] == 60
    tok = r.json()["token"]
    assert c.post(f"/api/proposals/{pid}/token/verify", json={"token": tok}).json()["valid"]
    assert c.get("/api/proposals").json()[0]["stage"] in ("HUMAN_AUTHORIZATION", "EXECUTE")
    assert any(e["decision"] == "APPROVED" for e in c.get("/api/audit").json()["entries"])
    # token verification never spends the token; spending it makes verify fail closed
    gw = app.state.ui.gateway
    gw.gate.redeem(tok, pid, gw.records[pid].p_hash)
    assert c.post(f"/api/proposals/{pid}/token/verify", json={"token": tok}).status_code == 403


def test_fail_closed_on_bad_input(env):
    app, c, props, clock = env
    pid, other = props["write-report"]["id"], props["deploy-service"]["id"]
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": []}).status_code == 403
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": [{"steward_id": "steward-1", "signature_b64": "AAAA"}]}).status_code == 403
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": [sig(app, c, "steward-1", other)]}).status_code == 403  # replay across proposals
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": [], "evil": 1}).status_code == 422
    assert c.post(f"/api/proposals/ghost/authorize", json={}).status_code == 404
    assert c.post(f"/api/proposals/{pid}/token/verify", json={"token": "a.b.c"}).status_code == 403
    # tier 2 time-lock
    two = [sig(app, c, "steward-1", other), sig(app, c, "steward-2", other)]
    assert c.post(f"/api/proposals/{other}/authorize", json={"signatures": two}).status_code == 423
    clock.advance(hours=7)
    assert c.post(f"/api/proposals/{other}/authorize", json={"signatures": two}).status_code == 200
    assert all(e["decision"] != "EXECUTED" for e in c.get("/api/audit").json()["entries"])


def test_expired_token_fails_verify(env):
    app, c, props, clock = env
    pid = props["write-report"]["id"]
    tok = c.post(f"/api/proposals/{pid}/authorize", json={"signatures": [sig(app, c, "steward-1", pid)]}).json()["token"]
    clock.advance(seconds=61)
    assert c.post(f"/api/proposals/{pid}/token/verify", json={"token": tok}).status_code == 403


def test_veto_override_flow(env):
    app, c, props, clock = env
    pid = props["vendor-payment"]["id"]
    normal = [sig(app, c, "steward-1", pid)]
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": normal}).status_code == 403
    two = [sig(app, c, s, pid, OVERRIDE_DECISION) for s in ("steward-1", "steward-2")]
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": normal, "emergency_override": two}).status_code == 403
    three = [sig(app, c, s, pid, OVERRIDE_DECISION) for s in ("steward-1", "steward-2", "steward-3")]
    # three signatures only start the mandatory 24h cooling period
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": normal, "emergency_override": three}).status_code == 423
    clock.advance(hours=23)
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": normal}).status_code == 423
    clock.advance(hours=1)
    r = c.post(f"/api/proposals/{pid}/authorize", json={"signatures": normal})
    assert r.status_code == 200 and r.json()["proposal"]["status"] == "VERA_OVERRIDDEN"
    assert any(e["decision"] == "EMERGENCY_OVERRIDE" and "CRITICAL" in e["reason"] for e in c.get("/api/audit").json()["entries"])


def test_reject_with_key_revocation(env):
    app, c, props, _ = env
    pid = props["write-report"]["id"]
    r = c.post(f"/api/proposals/{pid}/reject", json={"signature": sig(app, c, "steward-1", pid, "REJECT"),
                                                      "reason": "no", "revoke_agent_key": True})
    assert r.status_code == 200 and r.json()["rejected"]
    assert app.state.ui.breaker.is_revoked("prime")
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": [sig(app, c, "steward-1", pid)]}).status_code == 409


def test_scenario_c_is_simulation_only(env):
    app, c, *_ = env
    before = c.get("/api/treasury").json()
    r = c.post("/api/treasury/scenario-c", json={}).json()
    assert r["mutated_real_state"] is False and r["result"]["passed"] and r["after"]["tier1"] == before["tier1"]
    assert r["after"]["projects"]["growth-pilot"] is True
    assert c.get("/api/treasury").json() == before


def test_write_guards(env):
    app, c, props, _ = env
    pid = props["write-report"]["id"]
    body = {"signatures": []}
    no_hdr = TestClient(app, base_url="http://127.0.0.1:8000")
    assert no_hdr.post(f"/api/proposals/{pid}/authorize", json=body).status_code == 403
    assert c.post(f"/api/proposals/{pid}/authorize", json=body, headers={"Origin": "http://evil.example"}).status_code == 403
    assert TestClient(app, base_url="http://evil.example").get("/api/status").status_code == 403


def test_tampered_ledger_reported_not_repaired(env):
    app, c, *_ = env
    path = app.state.ui.dir / "ledger.jsonl"
    app.state.ui.ledger._entries[1] = app.state.ui.ledger._entries[1].model_copy(update={"reason": "forged"})
    v = c.get("/api/audit/verify").json()
    assert v["valid"] is False and c.get("/api/status").json()["system"] == "DEGRADED"
    assert "forged" not in path.read_text()  # file untouched


def test_state_survives_app_restart(tmp_path):
    clock = Clock()
    app = create_app(tmp_path / "st", demo=True, clock=clock)
    n = len(TestClient(app, base_url="http://127.0.0.1:8000").get("/api/proposals").json())
    app.state.ui.store.close()
    app2 = create_app(tmp_path / "st", demo=True, clock=clock)
    c2 = TestClient(app2, base_url="http://127.0.0.1:8000")
    assert len(c2.get("/api/proposals").json()) == n and c2.get("/api/treasury").json()["configured"]


def test_hardware_report_and_anchor_status(env):
    app, c, *_ = env
    hw = c.get("/api/hardware").json()
    assert hw["mode"] in ("LIVE_HARDWARE", "SOFTWARE_SIMULATION") and "pkcs11" in hw and "container_engine" in hw
    assert c.get("/api/anchor/verify").json()["configured"] is False


def test_anchor_verify_detects_divergence_via_api(env):
    from cryptography.hazmat.primitives import serialization
    from lake_yange.audit.anchor import LedgerAnchorManager
    app, c, *_ = env
    st = app.state.ui
    witness = Ed25519PrivateKey.generate()
    LedgerAnchorManager(st.dir / "anchors.jsonl", witness.sign, clock=st.clock).snapshot(st.ledger)
    (st.dir / "anchor_witness.pub").write_text(witness.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex())
    assert c.get("/api/anchor/verify").json()["valid"] is True
    st.ledger._path.write_text(st.ledger._path.read_text().replace("Draft quarterly note", "Edited note", 1))
    assert c.get("/api/anchor/verify").json()["valid"] is False


def test_override_cancel_endpoint(env):
    app, c, props, clock = env
    pid = props["vendor-payment"]["id"]
    three = [sig(app, c, s, pid, OVERRIDE_DECISION) for s in ("steward-1", "steward-2", "steward-3")]
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": [sig(app, c, "steward-1", pid)],
                                                           "emergency_override": three}).status_code == 423
    view = [p for p in c.get("/api/proposals").json() if p["id"] == pid][0]
    assert view["override_timelock"]["state"] == "PENDING_TIME_LOCK"
    one = [sig(app, c, "steward-1", pid, "CANCEL_OVERRIDE")]
    assert c.post(f"/api/proposals/{pid}/override/cancel", json={"signatures": one}).status_code == 403
    two = [sig(app, c, s, pid, "CANCEL_OVERRIDE") for s in ("steward-1", "steward-2")]
    assert c.post(f"/api/proposals/{pid}/override/cancel", json={"signatures": two}).status_code == 200
    clock.advance(hours=25)
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": [sig(app, c, "steward-1", pid)]}).status_code == 403
