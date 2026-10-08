import re
from pathlib import Path

import pytest

from lake_yange.ui_api import create_app, node_status
from tests.conftest import Clock
from tests.test_unified_ui import make

HTML = (Path(__file__).resolve().parents[1] / "lake_yange" / "ui" / "index.html").read_text()


@pytest.fixture
def env(tmp_path):
    app = create_app(tmp_path / "st", demo=True, clock=Clock())
    return app, make(app)


def world(c):
    return c.get("/api/system/map").json()


def test_html_has_engine_and_no_external_assets():
    for needle in ("<canvas", "getContext('2d')", "requestAnimationFrame", "'wheel'", "pointerdown", "const WE=", "function drawB(",
                   "function drawCaravans(", "function drawAgents(", "function fx(", "function ground(", "function roads(", "T=64"):
        assert needle in HTML, needle
    assert not re.search(r"https?://|//cdn|@import|<link[^>]+href|<script[^>]+src=|<img[^>]+src=\"[^\"#]", HTML, re.I)
    assert not re.search(r"\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(\s*['\"`]https?", HTML)


def test_every_backend_building_is_drawn_and_wired(env):
    _, c = env
    for b in world(c)["world"]["buildings"]:
        assert re.search(r"\b%s:\[" % b["id"], HTML), "no tile palette for " + b["id"]
    for bid in ("citadel", "keep", "mill", "crystal", "redsink", "vera", "spire", "library", "arena", "breaker", "anchor", "forge"):
        assert "case '%s'" % bid in HTML
    for hosted in ("'#queue'", "'#treasury'", "'#log'", "'#cii'"):  # drawers re-use the live signing/treasury/audit/CII panels
        assert hosted in HTML


def test_world_layout_matches_backend_state(env):
    _, c = env
    m = world(c)
    w, nodes = m["world"], {n["id"]: n for n in m["nodes"]}
    assert w["tile_px"] == 64
    seen = set()
    for b in w["buildings"]:
        t = b["tile"]
        assert b["node"] in nodes
        assert 0 <= t["x"] and t["x"] + t["w"] <= w["cols"] and 0 <= t["y"] and t["y"] + t["h"] <= w["rows"]
        cells = {(x, y) for x in range(t["x"], t["x"] + t["w"]) for y in range(t["y"], t["y"] + t["h"])}
        assert not cells & seen, "overlapping buildings: " + b["id"]
        seen |= cells
        if "tier" not in b:
            assert b["status"] == node_status(nodes[b["node"]])
    assert sorted(b["tier"] for b in w["buildings"] if "tier" in b) == [1, 2, 3]
    ids = {b["id"] for b in w["buildings"]}
    assert set(w["stage_building"]) == set(m["stages"]) and set(w["stage_building"].values()) <= ids
    assert all(r["from"] in ids and r["to"] in ids for r in w["roads"])
    for a in w["agents"]:
        assert all(0 <= p["x"] <= w["cols"] and 0 <= p["y"] <= w["rows"] for p in a["patrol"])
    assert {a["id"] for a in w["agents"]} == {"prime", "vera", "forge"}


def test_building_status_tracks_real_events(env):
    app, c = env
    b = {x["id"]: x for x in world(c)["world"]["buildings"]}
    assert b["citadel"]["status"] == "warn" and b["vera"]["status"] == "warn"  # demo: proposals awaiting + a Vera veto
    assert b["redsink"]["status"] == "ok" and b["crystal"]["status"] == "ok"
    led = app.state.ui.ledger  # tampering with the audit chain turns the Fortress rose
    led._entries[1] = led._entries[1].model_copy(update={"reason": "forged"})
    after = {x["id"]: x for x in world(c)["world"]["buildings"]}
    assert after["redsink"]["status"] == "bad"
    red = next(n for n in world(c)["nodes"] if n["id"] == "red_sink")
    assert red["state"]["chain_valid"] is False


def test_scenario_c_is_simulation_only_and_world_is_unchanged(env):
    _, c = env
    before = world(c)["world"]["buildings"]
    r = c.post("/api/treasury/scenario-c", json={})
    assert r.status_code == 200
    after = world(c)["world"]["buildings"]
    assert before == after  # the storm is purely visual; no real state moved
