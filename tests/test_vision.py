"""Vision scene-understanding: contract, confidence gate, fallback, cache, cross-check, human-only ground truth.
The model is stubbed, so no API key or network is needed."""

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.vision import agent, cache, manifest
from backend.vision.confidence import GATE, score
from backend.vision.schema import VisionDraft


@pytest.fixture()
def isolated(tmp_path, monkeypatch):
    """Point the cache and annotations at a temp dir so tests never touch committed files."""
    monkeypatch.setattr(cache, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(manifest, "ANNOTATIONS", tmp_path / "annotations.json")
    return tmp_path


@pytest.fixture()
def client(isolated):
    with TestClient(app) as c:
        yield c


def draft(state="closed", conf=0.9, visibility="clear", **kw):
    return VisionDraft(object_seen="ball valve with lever", kind="manual_valve", state=state,
                       state_cues=["lever perpendicular to pipe"], visibility=visibility, model_confidence=conf, **kw)


def test_manifest_regions_are_inside_frames():
    for f in manifest.merged_frames():
        for r in f["regions"]:
            x1, y1, x2, y2 = r["bbox_px"]
            assert 0 <= x1 < x2 <= f["width"] and 0 <= y1 < y2 <= f["height"], r["region_id"]
            assert r["gt"] is None or not str(r["gt"].get("labelled_by", "")).startswith("claude")


def test_confidence_gate_turns_weak_states_into_unknown():
    conf, factors, state, note = score(draft(conf=0.9), [0, 0, 200, 200], 1500.0)
    assert state == "closed" and conf >= GATE and {f.name for f in factors} >= {"model", "box_size", "sharpness"}
    conf, _, state, note = score(draft(conf=0.6, visibility="poor"), [0, 0, 30, 30], 200.0)
    assert state == "unknown" and conf < GATE and "unknown" in note
    _, _, state, note = score(draft(conf=0.95), [0, 0, 200, 200], 1500.0, other_states=["open"])
    assert state == "unknown" and "disagree" in note


def test_fallback_without_model_is_explicit_unknown(client, monkeypatch):
    monkeypatch.setattr(agent, "configured_model", lambda: None)
    f = client.post("/api/vision/inspect", json={"region_id": "FRM-007-R01"}).json()
    assert f["mode"] == "fallback" and f["state"] == "unknown" and f["confidence"] == 0.0
    assert f["evidence_ids"][:2] == ["FRM-007", "FRM-007-R01"] and "DOC-FIELD-SAFETY" in f["safety_note"]


def test_llm_path_is_cached_and_cited(client, monkeypatch):
    calls = []
    monkeypatch.setattr(agent, "configured_model", lambda: "stub:model")
    monkeypatch.setattr(agent, "run_model", lambda *a, **k: calls.append(1) or draft(conf=0.95))
    a = client.post("/api/vision/inspect", json={"region_id": "FRM-016-R02"}).json()
    b = client.post("/api/vision/inspect", json={"region_id": "FRM-016-R02"}).json()
    assert a["mode"] == "llm" and b["mode"] == "cache" and len(calls) == 1
    assert "OBJ-0183" in a["evidence_ids"] and a["finding_id"] == b["finding_id"]
    obj = client.get("/api/vision/object/OBJ-0183").json()
    assert any(f["finding_id"] == a["finding_id"] for f in obj["findings"])


def test_crosscheck_needs_a_confirmed_link(client, monkeypatch):
    cc = client.get("/api/vision/crosscheck/ASSET-003").json()
    assert cc["verdict"] == "unverifiable" and cc["telemetry_flag"] and "procedural" in " ".join(cc["rationale"])
    # technician links an actuator photo to CV-003 and the model says 'closed' -> telemetry says ~68 % open
    client.post("/api/vision/regions/FRM-011-R03/link", json={"asset_id": "ASSET-003", "by": "test"})
    monkeypatch.setattr(agent, "configured_model", lambda: "stub:model")
    monkeypatch.setattr(agent, "run_model", lambda *a, **k: draft(state="closed", conf=0.95))
    f = client.post("/api/vision/inspect", json={"region_id": "FRM-011-R03"}).json()
    assert f["asset_id"] == "ASSET-003" and f["link_method"] == "technician_confirmed"
    cc = client.get("/api/vision/crosscheck/ASSET-003").json()
    assert cc["verdict"] == "mismatch" and f["finding_id"] in cc["evidence_ids"]


def test_ground_truth_is_human_only_and_feeds_eval(client, monkeypatch):
    assert client.post("/api/vision/regions/FRM-007-R03/label",
                       json={"state": "open", "labelled_by": "claude-draft"}).status_code == 422
    assert client.post("/api/vision/regions/FRM-007-R03/label",
                       json={"state": "open", "labelled_by": "Jishnu"}).status_code == 200
    monkeypatch.setattr(agent, "configured_model", lambda: "stub:model")
    monkeypatch.setattr(agent, "run_model", lambda *a, **k: draft(state="open", conf=0.95))
    client.post("/api/vision/inspect", json={"region_id": "FRM-007-R03"})
    ev = client.get("/api/vision/eval").json()
    assert ev["labelled_regions"] == 1 and ev["evaluated"] == 1


def test_user_region_and_bad_requests(client):
    r = client.post("/api/vision/regions", json={"frame_id": "FRM-010", "bbox_px": [10, 10, 90, 90],
                                                 "kind": "gauge"}).json()
    assert r["region_id"] == "FRM-010-U01"
    assert any(x["region_id"] == "FRM-010-U01" for x in manifest.frame("FRM-010")["regions"])
    assert client.post("/api/vision/inspect", json={}).status_code == 422
    assert client.post("/api/vision/inspect", json={"region_id": "NOPE"}).status_code == 404
