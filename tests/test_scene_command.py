"""Typed scene commands: the AI (stubbed here) or the rule parser reads intent, deterministic code picks and checks
the pose, nothing is committed, fixed equipment is refused with a reason."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

import backend.ai.agent as ai_agent
from backend.app import app
from backend.scene_edit import command, engine, store
from backend.scene_edit.geometry import MPU, world_box
from backend.scene_edit.intent import MoveIntent, rule_parse

FACING_MINUS_Z = {"forward": [0.0, -0.5, -1.0]}
DETOUR = {"object_id": "MOV-01", "translate_world": [0.62, 0.0, -1.1], "yaw_deg": 0}  # chair in the P-002 aisle


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "EDITS", tmp_path / "scene_edits.json")
    monkeypatch.setattr(ai_agent, "configured_model", lambda: None)  # rule parser
    with TestClient(app) as c:
        yield c


def cmd(client, text, **kw):
    r = client.post("/api/scene/command", json={"text": text, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_rule_parser_reads_the_examples():
    it = rule_parse("rotate the step ladder 90° clockwise")
    assert (it.action, it.movable_id, it.yaw_deg) == ("rotate", "MOV-08", -90)
    it = rule_parse("put the vacuum 1 m to the left")
    assert (it.action, it.movable_id, it.distance_m, it.direction) == ("translate", "MOV-04", 1.0, "left")
    it = rule_parse("move the office chair next to the door")
    assert (it.action, it.movable_id, it.landmark.kind) == ("place_near", "MOV-01", "entrance")
    it = rule_parse("clear the walkway to P-002")
    assert (it.action, it.asset_ref, it.movable_id) == ("clear_route", "P-002", None)
    it = rule_parse("move the pallet truck out of the technician's route")
    assert (it.action, it.movable_id) == ("clear_route", "MOV-03")
    assert rule_parse("move the pump").fixed_subject == "pump"
    assert rule_parse("move the chair 20 cm forward").movable_options == ["MOV-01", "MOV-02"]
    assert rule_parse("pull the washing machine 30 cm forward").movable_id == "MOV-10"
    it = rule_parse("move the washing machine 30 cm forward")
    assert (it.action, it.movable_id) == ("translate", "MOV-10")
    assert rule_parse("rotate MOV-10 90 degrees").movable_id == "MOV-10"


def test_rotate_proposes_and_never_commits(client):
    r = cmd(client, "rotate the step ladder 90°", camera=FACING_MINUS_Z)
    assert r["status"] == "proposal" and r["movable_id"] == "MOV-08"
    assert r["intent"]["yaw_deg"] == 90 and r["edit"]["yaw_deg"] == 90
    assert r["preview"]["verdict"] in ("allowed", "warning")
    assert not r["auto_apply"]  # 0.00 m gaps: needs a human
    assert store.load() == []  # the command never commits


def test_left_is_camera_relative(client):
    r = cmd(client, "put the vacuum 1 m to the left", camera=FACING_MINUS_Z)
    assert r["exact"] and np.allclose(r["edit"]["translate_world"], [-1 / MPU, 0, 0], atol=1e-3)
    r = cmd(client, "put the vacuum 1 m to the left", camera={"forward": [1.0, 0.0, 0.0]})  # facing +x: left = -z
    assert np.allclose(r["edit"]["translate_world"], [0, 0, -1 / MPU], atol=1e-3)


def test_fixed_equipment_is_refused_with_reason(client):
    for text in ("move the pump", "move P-002 1 m left", "push the valve against the wall"):
        r = cmd(client, text)
        assert r["status"] == "refused" and "cannot be moved" in r["explanation"], text
        assert "Office chair" in r["explanation"]  # says what can move
    assert cmd(client, "what is the pressure of P-002?")["status"] == "noop"
    r = cmd(client, "move this 1 m left", selected_object_id="OBJ-0185")  # P-002 selected in the viewport
    assert r["status"] == "refused" and "OBJ-0185" in r["explanation"]
    r = cmd(client, "move this 30 cm left", selected_object_id="OBJ-0164", camera=FACING_MINUS_Z)  # chair box
    assert r["status"] == "proposal" and r["movable_id"] == "MOV-01"


def test_next_to_the_door(client):
    r = cmd(client, "move the office chair next to the door")
    assert r["status"] == "proposal" and r["preview"]["verdict"] != "blocked"
    c = world_box(engine.state([]).movs["MOV-01"])[0][[0, 2]]
    t = c + np.array(r["edit"]["translate_world"])[[0, 2]]
    assert np.linalg.norm(t - engine.FRONT_ENTRY_W) < 1.5
    assert "Check:" in r["explanation"] and r["preview"]["verdict"] in r["explanation"]


def test_clear_the_walkway_restores_the_route(client):
    assert client.post("/api/scene/edits", json={**DETOUR, "target_asset_id": "ASSET-014"}).status_code == 200
    r = cmd(client, "clear the walkway to P-002")
    assert r["status"] == "proposal" and r["movable_id"] == "MOV-01"
    assert r["preview"]["route_delta_m"] < 0 and r["target_asset_id"] == "ASSET-014"
    assert len(store.load()) == 1  # still only the detour


def test_blocked_request_falls_back_to_a_feasible_pose(client):
    r = cmd(client, "move the office chair 6 m right", camera=FACING_MINUS_Z)
    assert r["status"] == "proposal" and not r["exact"] and not r["auto_apply"]
    assert r["preview"]["verdict"] != "blocked" and "exact move was blocked" in r["explanation"]


def test_ambiguous_chair_asks_then_moves(client):
    r = cmd(client, "move the chair 20 cm forward", camera=FACING_MINUS_Z)
    assert r["status"] == "clarify" and {o["movable_id"] for o in r["options"]} == {"MOV-01", "MOV-02"}
    r = cmd(client, "move the chair 20 cm forward", camera=FACING_MINUS_Z, movable_id="MOV-02")
    assert r["status"] == "proposal" and r["movable_id"] == "MOV-02"


def test_llm_intent_is_used_but_cannot_move_fixed_things(client, monkeypatch):
    monkeypatch.setattr(ai_agent, "configured_model", lambda: "stub:model")
    monkeypatch.setattr(command, "llm_intent",
                        lambda *a, **k: MoveIntent(action="rotate", movable_id="MOV-05", yaw_deg=30, object_ref="stool"))
    r = cmd(client, "give the little wooden seat a slight twist")
    assert r["mode"] == "llm" and r["status"] == "proposal" and r["edit"]["yaw_deg"] == 30
    # the model maps 'the pump' to a movable: the words name fixed equipment, so it is refused
    monkeypatch.setattr(command, "llm_intent",
                        lambda *a, **k: MoveIntent(action="translate", movable_id="MOV-01", distance_m=1,
                                                   direction="left", object_ref="the pump"))
    r = cmd(client, "move the pump 1 m left")
    assert r["status"] == "refused" and store.load() == []
    # any LLM failure falls back to the rule parser
    monkeypatch.setattr(command, "llm_intent", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("quota")))
    r = cmd(client, "rotate the stool 45°")
    assert r["mode"] == "fallback" and r["edit"]["yaw_deg"] == 45


def test_remove_from_scene_needs_confirm_and_undo_restores(client):
    r = cmd(client, "move the vacuum from the scene")
    assert r["status"] == "proposal" and r["edit"]["remove"] and r["movable_id"] == "MOV-04"
    assert not r["auto_apply"] and store.load() == []
    n_before = len(engine.state([]).xyz)
    d = client.post("/api/scene/edits", json=r["edit"]).json()  # the user confirms
    assert d["edits"][0]["remove"] and d["replan"]["summary"]["reachable"] == 24
    assert any(m["object_id"] == "MOV-04" and m.get("removed") for m in d["replan"]["movables"])
    assert all(v["removed"] for v in d["replan"]["overrides"].values())  # its boxes disappear
    assert len(engine.state(store.load()).xyz) < n_before  # and its splats leave the obstacle cloud
    # a removed object cannot be moved or removed again
    assert cmd(client, "put the vacuum 1 m to the left")["status"] == "refused"
    assert client.post("/api/scene/edits", json=r["edit"]).status_code == 409
    assert cmd(client, "delete the pump")["status"] == "refused"
    client.delete(f"/api/scene/edits/{d['edits'][0]['edit_id']}")  # undo brings it back
    assert cmd(client, "put the vacuum 1 m to the left", camera=FACING_MINUS_Z)["status"] == "proposal"


def test_parser_reads_remove_phrasings():
    for text in ("move the cardboard box from the scene", "delete the box", "get rid of the stool",
                 "take the hand truck out of the room", "remove the green chair"):
        assert rule_parse(text).action == "remove", text
    assert rule_parse("move the pallet truck out of the technician's route").action == "clear_route"


def test_tag_on_a_movable_moves_the_whole_object(client):
    r = cmd(client, "move VS-003 30 cm forward", camera=FACING_MINUS_Z)  # VS-003's box is the washing machine door
    assert r["status"] == "proposal" and r["movable_id"] == "MOV-10"
