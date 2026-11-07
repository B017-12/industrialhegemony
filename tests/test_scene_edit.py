"""Manipulable scene: feasibility preview (gaps, overlap, reachability), commit/undo/reset, replan in the
nav_targets shape the main app consumes, and the equal-clearance metrics on the replanned route."""

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.scene_edit import engine, store

CHAIR = "OBJ-0164"  # segmentation box of the office chair -> movable MOV-01
DETOUR = [0.62, 0.0, -1.1]  # found by search: allowed, route to P-002 gets ~2 m longer
BLOCKING = [-3.78, 0.0, -0.55]  # cuts off ASSET-024 / ASSET-027


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "EDITS", tmp_path / "scene_edits.json")
    with TestClient(app) as c:
        yield c


def test_baseline_replan_shape(client):
    d = client.get("/api/scene/edits?target_asset_id=ASSET-017").json()
    assert d["edits"] == [] and d["replan"]["frame"] == "ply_raw"
    t = {x["asset_id"]: x for x in d["replan"]["targets"]}
    assert len(t) == 30 and t["ASSET-017"]["reachable"]
    m = t["ASSET-017"]["mission"]
    assert len(m["path"][0]) == 3 and m["length_m"] > 0 and "lr_imbalance_m" in m


def test_only_whole_freestanding_objects_move(client):
    for fixed in ("OBJ-0185", "OBJ-0163", "OBJ-0428", "STRUCT-001"):  # pump, shelf clutter, pole, floor
        pv = client.post("/api/scene/edits/preview", json={"object_id": fixed, "translate_world": [0.1, 0, 0]}).json()
        assert pv["verdict"] == "blocked" and pv.get("fixed"), fixed
    # the pallet-truck handle box selects the whole truck
    pv = client.post("/api/scene/edits/preview", json={"object_id": "OBJ-0238", "translate_world": [0.05, 0, 0]}).json()
    assert pv["movable_id"] == "MOV-03" and pv["object_points"] > 1000
    mv = client.get("/api/scene/movables").json()["movables"]
    assert {m["object_id"] for m in mv} == {f"MOV-{i:02d}" for i in range(1, 11)}
    # the washing machine moves whole: clicking its door (the VS-003 box) selects it, and it can be pulled forward
    pv = client.post("/api/scene/edits/preview", json={"object_id": "OBJ-0265", "translate_world": [0, 0, 0.4]}).json()
    assert pv["movable_id"] == "MOV-10" and pv["verdict"] == "allowed" and pv["object_points"] > 5000
    # touching objects never share splats (vacuum is L-shaped around the green chair)
    xyz, fy, _ = engine.base()
    owners = sum(engine.object_mask(xyz, m, fy).astype(int) for m in engine.movables().values())
    assert owners.max() == 1


def test_blocking_the_aisle_is_refused(client):
    body = {"object_id": CHAIR, "translate_world": BLOCKING, "target_asset_id": "ASSET-014"}
    pv = client.post("/api/scene/edits/preview", json=body).json()
    assert pv["verdict"] == "blocked" and pv["unreachable_assets"]
    r = client.post("/api/scene/edits", json=body)
    assert r.status_code == 409 and r.json()["preview"]["verdict"] == "blocked"
    assert client.get("/api/scene/edits").json()["edits"] == []


def test_move_into_wall_is_blocked_with_reason(client):
    pv = client.post("/api/scene/edits/preview", json={"object_id": CHAIR, "translate_world": [6.5, 0, 0]}).json()
    assert pv["verdict"] == "blocked" and any("outside the scanned floor" in r for r in pv["reasons"])


def test_cramped_spot_reports_gaps(client):
    pv = client.post("/api/scene/edits/preview", json={"object_id": CHAIR, "translate_world": [0.05, 0, 0]}).json()
    assert set(pv["gaps_m"]) == {"+x", "-x", "+z", "-z", "min"}
    assert pv["gaps_m"]["min"] is not None and pv["gaps_m"]["min"] < 0.2


def test_commit_reroutes_persists_and_resets(client):
    before = client.get("/api/scene/edits?target_asset_id=ASSET-014").json()["replan"]
    body = {"object_id": CHAIR, "translate_world": DETOUR, "target_asset_id": "ASSET-014", "by": "test"}
    r = client.post("/api/scene/edits", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["preview"]["verdict"] in ("allowed", "warning") and len(d["edits"]) == 1
    assert CHAIR in d["replan"]["overrides"] and d["edits"][0]["object_id"] == "MOV-01"
    len0 = next(t for t in before["targets"] if t["asset_id"] == "ASSET-014")["mission"]["length_m"]
    len1 = next(t for t in d["replan"]["targets"] if t["asset_id"] == "ASSET-014")["mission"]["length_m"]
    assert len1 > len0 + 0.5
    assert store.load()[0]["object_id"] == "MOV-01"  # persisted
    edit_id = d["edits"][0]["edit_id"]
    assert client.delete(f"/api/scene/edits/{edit_id}").json()["edits"] == []
    client.post("/api/scene/edits", json=body)
    assert client.delete("/api/scene/edits").json()["replan"]["n_edits"] == 0


