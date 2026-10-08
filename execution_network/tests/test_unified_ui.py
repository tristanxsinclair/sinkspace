import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lake_yange.middleware.auth_gate import OVERRIDE_DECISION
from lake_yange.ui_api import create_app
from tests.conftest import Clock
from tests.test_ui_api import sig

ROOT = Path(__file__).resolve().parents[1]


def make(app):
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    tok = re.search(r'name="ly-session" content="([^"]+)"', c.get("/").text).group(1)
    c.headers["X-LY-Session"] = tok
    return c


@pytest.fixture
def env(tmp_path):
    clock = Clock()
    app = create_app(tmp_path / "st", demo=True, clock=clock)
    return app, make(app), make(app), clock  # two "tabs" sharing one backend


def test_system_map_payload_integrity(env):
    app, c, *_ = env
    m = c.get("/api/system/map").json()
    ids = {n["id"] for n in m["nodes"]}
    assert {"reality", "integrity", "governance", "human_agency"} == set(m["pillars"])
    assert len(m["stages"]) == 7 and m["stages"][3] == "HUMAN_AUTHORIZATION"
    assert {"authgate", "vera", "red_sink", "timelock"} <= ids and len(ids) == len(m["nodes"])
    for e in m["edges"]:  # every edge endpoint is a node or a lifecycle stage
        assert e["from"] in ids | set(m["stages"]) and e["to"] in ids | set(m["stages"])
    for n in m["nodes"]:  # source citations point at real files
        assert (ROOT / n["source"].split(":")[0]).exists(), n["source"]
        assert isinstance(n["state"], dict) and n["summary"]
    node = {n["id"]: n for n in m["nodes"]}
    assert node["vera"]["state"]["blocked_proposals"] == 1
    assert node["authgate"]["state"]["stewards"] == 3 and node["red_sink"]["state"]["chain_valid"] is True
    assert node["hardware"]["state"]["mode"] in ("LIVE_HARDWARE", "SOFTWARE_SIMULATION")


def test_full_state_is_one_consistent_payload(env):
    app, c, *_ = env
    d = c.get("/api/state/full").json()
    assert set(d) >= {"status", "proposals", "stewards", "treasury", "cii", "audit", "audit_verify", "hardware",
                      "anchor", "map", "version"}
    assert d["proposals"] == c.get("/api/proposals").json() and d["treasury"] == c.get("/api/treasury").json()
    assert d["audit_verify"]["entries"] == d["audit"]["total"]


def test_signing_in_one_tab_updates_every_view_in_the_other(env):
    app, tab1, tab2, _ = env
    before = tab2.get("/api/state/full").json()
    pid = next(p["id"] for p in before["proposals"] if p["action_type"] == "write-report")
    r = tab1.post(f"/api/proposals/{pid}/authorize", json={"signatures": [sig(app, tab1, "steward-1", pid)]})
    assert r.status_code == 200
    after = tab2.get("/api/state/full").json()
    assert after["version"] != before["version"]
    p = next(x for x in after["proposals"] if x["id"] == pid)
    assert p["stage"] == "EXECUTE" and len(p["active_tokens"]) == 1          # command view
    assert after["audit"]["total"] == before["audit"]["total"] + 1            # audit stream
    node = {n["id"]: n for n in after["map"]["nodes"]}
    assert node["authgate"]["state"]["active_tokens"] == 1                    # map view
    assert node["red_sink"]["state"]["blocks"] == after["audit"]["total"]
    assert node["governance"]["state"]["awaiting_human"] == 2


def test_scenario_c_in_one_tab_does_not_change_other_tab_treasury(env):
    app, tab1, tab2, _ = env
    before = tab2.get("/api/state/full").json()["treasury"]
    assert tab1.post("/api/treasury/scenario-c", json={}).json()["mutated_real_state"] is False
    assert tab2.get("/api/state/full").json()["treasury"] == before            # dashboard unchanged


def test_override_pending_visible_across_tabs(env):
    app, tab1, tab2, _ = env
    pid = next(p["id"] for p in tab1.get("/api/proposals").json() if p["action_type"] == "vendor-payment")
    three = [sig(app, tab1, s, pid, OVERRIDE_DECISION) for s in ("steward-1", "steward-2", "steward-3")]
    assert tab1.post(f"/api/proposals/{pid}/authorize", json={"signatures": [], "emergency_override": three}).status_code == 423
    node = {n["id"]: n for n in tab2.get("/api/state/full").json()["map"]["nodes"]}
    assert node["timelock"]["state"]["pending_overrides"] == 1


def test_hub_fails_closed_on_writes_and_origin(env):
    app, c, *_ = env
    pid = c.get("/api/proposals").json()[0]["id"]
    anon = TestClient(app, base_url="http://127.0.0.1:8000")
    assert anon.post(f"/api/proposals/{pid}/authorize", json={"signatures": []}).status_code == 403
    assert c.post(f"/api/proposals/{pid}/authorize", json={"signatures": []},
                  headers={"Origin": "http://evil.example"}).status_code == 403
    assert anon.get("/api/state/full", headers={"Host": "evil.example"}).status_code == 403
    assert c.post("/api/state/full", json={}).status_code == 405  # read-only endpoint


def test_page_has_no_external_requests_and_all_four_views(env):
    app, c, *_ = env
    html = c.get("/").text
    assert not re.findall(r'(?:src|href|action)\s*=\s*["\'](?:https?:)?//', html)
    assert not re.search(r'(?:@import|url\()\s*["\']?(?:https?:)?//', html)
    assert not re.search(r'fetch\(\s*["\'`]https?:', html) and "__SESSION_TOKEN__" not in html
    for v in ("map", "command", "dash", "bento"):
        assert f'id="v-{v}"' in html and f'data-v="{v}"' in html
    for text in ("AIR-GAPPED (100% Offline)", "LIVE_HARDWARE", "ANCHOR SEALED", "DIVERGENT"):
        assert text in html or text.split()[0] in html
    # only same-origin API paths are fetched
    paths = re.findall(r"api\(\s*[`'](/[^`'$?]*)", html)
    assert paths and all(p.startswith("/api/") for p in paths)
    assert "default-src 'self'" in c.get("/").headers["content-security-policy"]
