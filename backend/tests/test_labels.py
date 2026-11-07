from __future__ import annotations

import base64
import json
import struct
import zlib
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config, labels

from .conftest import TARGET

REVIEWER = "Test Reviewer"


@pytest.fixture(autouse=True)
def overrides_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Every test writes to its own override file and crop dir, never to data/derived/."""
    path = tmp_path / "labels_override.json"
    path.write_text(json.dumps({"schema_version": "1.0", "overrides": {}}), encoding="utf-8")
    monkeypatch.setattr(config, "LABELS_OVERRIDE", path)
    monkeypatch.setattr(config, "CROPS_DIR", tmp_path / "crops")
    monkeypatch.setattr(config, "VLM_LABELS", tmp_path / "vlm_labels.json")
    return path


def _objects(client: TestClient) -> dict[str, dict]:
    return {o["object_id"]: o for o in client.get("/api/scene/objects").json()["objects"]}


def _target_object(client: TestClient) -> str:
    return client.get(f"/api/assets/{TARGET}").json()["scene"]["object_id"]


def _unbound(client: TestClient, cls: str | None = None) -> list[str]:
    return [oid for oid, o in _objects(client).items()
            if not o.get("asset_id") and o["source"] != "structure_plane" and (cls is None or o["class"] == cls)]


def _patch(client: TestClient, object_id: str, **body):
    return client.patch(f"/api/labels/overrides/{object_id}", json={"reviewer": REVIEWER, **body})


def test_relabel_round_trip(client: TestClient, overrides_file: Path) -> None:
    oid = _target_object(client)
    method_before = client.get(f"/api/assets/{TARGET}").json()["scene"]["mapping_method"]
    r = _patch(client, oid, action="relabel", **{"class": "valve"}, notes="Handwheel visible.")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["previous"] == {oid: None}
    entry = body["changed"][oid]
    assert entry["class"] == "valve"
    assert entry["label_source"] == "human"
    assert entry["review_status"] == "relabelled"
    assert entry["reviewer"] == REVIEWER
    assert entry["reviewed_at"].endswith("Z")
    assert entry["review_notes"] == "Handwheel visible."
    stored = json.loads(overrides_file.read_text())["overrides"][oid]
    assert stored == entry
    assert client.get("/api/labels/overrides").json()["overrides"][oid] == entry

    scene = client.get(f"/api/assets/{TARGET}").json()["scene"]
    assert scene["class"] == "valve"
    assert scene["label_source"] == "human"
    # The binding itself is untouched by a relabel.
    assert scene["mapping_method"] == method_before


def test_confirm_keeps_class(client: TestClient) -> None:
    oid = _unbound(client)[0]
    before = _objects(client)[oid]["class"]
    entry = _patch(client, oid, action="confirm").json()["changed"][oid]
    assert entry["class"] == before
    assert entry["review_status"] == "confirmed"
    assert entry["class_confidence"] == labels.DEFAULT_CLASS_CONFIDENCE


def test_bad_class_rejected(client: TestClient) -> None:
    oid = _unbound(client)[0]
    r = _patch(client, oid, action="relabel", **{"class": "spaceship"})
    assert r.status_code == 422
    assert "vocabulary" in r.json()["detail"]


@pytest.mark.parametrize("reviewer", ["", "   "])
def test_reviewer_required(client: TestClient, overrides_file: Path, reviewer: str) -> None:
    oid = _unbound(client)[0]
    r = client.patch(f"/api/labels/overrides/{oid}", json={"reviewer": reviewer, "action": "confirm"})
    assert r.status_code == 422
    assert json.loads(overrides_file.read_text())["overrides"] == {}


def test_missing_reviewer_field(client: TestClient) -> None:
    r = client.patch(f"/api/labels/overrides/{_unbound(client)[0]}", json={"action": "confirm"})
    assert r.status_code == 422


def test_unknown_object_404(client: TestClient) -> None:
    assert _patch(client, "OBJ-9999", action="confirm").status_code == 404


def test_rebind_unbinds_old_object(client: TestClient) -> None:
    old = _target_object(client)
    new = _unbound(client)[0]
    r = _patch(client, new, action="bind", asset_id=TARGET)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["changed"]) == {old, new}
    assert body["changed"][old]["asset_id"] is None
    assert body["changed"][old]["mapping_method"] is None
    assert body["changed"][new]["mapping_method"] == "human_assigned"
    assert any("rerun" in n for n in body["notes"])

    scene = client.get(f"/api/assets/{TARGET}").json()["scene"]
    assert scene["object_id"] == new
    assert scene["mapping_method"] == "human_assigned"
    bound_to_target = [a for a in client.get("/api/scene/anchors").json()["anchors"] if a["asset_id"] == TARGET]
    assert bound_to_target[0]["scene"]["object_id"] == new

    # Copilot confidence keeps the 0.5 cap and explains the reviewer binding.
    answer = client.post("/api/copilot/query", json={"asset_id": TARGET}).json()
    assert answer["validation"]["ok"] is True
    assert answer["confidence"]["score"] <= 0.5
    assert any("chosen by a reviewer" in reason for reason in answer["confidence"]["reasons"])


def test_undo_restores_previous(client: TestClient, overrides_file: Path) -> None:
    old = _target_object(client)
    new = _unbound(client)[0]
    previous = _patch(client, new, action="bind", asset_id=TARGET).json()["previous"]
    r = client.post("/api/labels/restore", json={"reviewer": REVIEWER, "entries": previous})
    assert r.status_code == 200
    assert json.loads(overrides_file.read_text())["overrides"] == {}
    assert client.get(f"/api/assets/{TARGET}").json()["scene"]["object_id"] == old


def test_merge_union_contains_both(client: TestClient) -> None:
    objects = _objects(client)
    parent_id, child_id = _unbound(client, "pipe")[:2]
    r = _patch(client, child_id, action="merge", merge_into=parent_id)
    assert r.status_code == 200, r.text
    changed = r.json()["changed"]
    assert changed[child_id]["review_status"] == "merged"
    assert changed[child_id]["merged_into"] == parent_id
    parent = {**objects[parent_id], **changed[parent_id]}
    assert parent["merged_from"] == [child_id]

    obb = parent["obb"]
    rotation = np.asarray(obb["rotation"])
    for source in (objects[parent_id], objects[child_id]):
        local = (labels.obb_corners(source["obb"]) - np.asarray(obb["center"])) @ rotation
        assert np.all(np.abs(local) <= np.asarray(obb["extent"]) / 2 + 1e-4)
    assert np.all(np.asarray(parent["aabb_min"]) <= np.asarray(objects[child_id]["aabb_min"]) + 1e-9)
    assert np.all(np.asarray(parent["aabb_max"]) >= np.asarray(objects[child_id]["aabb_max"]) - 1e-9)

    summary = client.get("/api/labels/summary").json()
    assert summary["by_review_status"]["merged"] == 1
    assert summary["visible"] == summary["objects"] - 1


def test_merge_conflicts(client: TestClient) -> None:
    a, b = _unbound(client)[:2]
    assert _patch(client, a, action="merge", merge_into=a).status_code == 409
    assert _patch(client, _target_object(client), action="merge", merge_into=a).status_code == 409
    assert _patch(client, a, action="merge").status_code == 422
    assert _patch(client, a, action="reject").status_code == 200
    assert _patch(client, b, action="merge", merge_into=a).status_code == 409


def test_reject_bound_object_unbinds(client: TestClient) -> None:
    oid = _target_object(client)
    body = _patch(client, oid, action="reject").json()
    assert body["changed"][oid]["review_status"] == "rejected"
    assert body["changed"][oid]["asset_id"] is None
    assert client.get(f"/api/assets/{TARGET}").json()["scene"] is None


def test_mapping_evidence_reflects_review(client: TestClient) -> None:
    oid = _target_object(client)
    _patch(client, oid, action="relabel", **{"class": "valve"})
    answer = client.post("/api/copilot/query", json={"asset_id": TARGET}).json()
    mapping = next(e for e in answer["evidence"] if e["id"] == f"MAP:{TARGET}")
    assert "class valve" in mapping["text"]
    assert "label source human" in mapping["text"]
    assert REVIEWER in mapping["text"]
    assert answer["validation"]["ok"] is True


def test_summary_counts(client: TestClient) -> None:
    before = client.get("/api/labels/summary").json()
    assert before["human_reviewed"] == 0
    assert before["by_label_source"].get("human") is None
    oid = _target_object(client)
    _patch(client, oid, action="confirm")
    after = client.get("/api/labels/summary").json()
    assert after["human_reviewed"] == 1
    assert after["by_label_source"]["human"] == 1
    assert after["reviewers"] == [REVIEWER]
    assert after["bound_reviewed"] == 1


def _png(width: int = 4, height: int = 3) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\x00\x00\x00" * width for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return labels.PNG_MAGIC + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def test_crop_upload_and_serve(client: TestClient) -> None:
    oid = _target_object(client)
    image = "data:image/png;base64," + base64.b64encode(_png()).decode()
    r = client.post(f"/api/labels/crops/{oid}", json={"image": image, "bbox_px": [1, 2, 4, 3], "viewport_px": [760, 768]})
    assert r.status_code == 200, r.text
    assert (r.json()["width"], r.json()["height"]) == (4, 3)
    assert oid in client.get("/api/labels/crops").json()["crops"]
    served = client.get(f"/api/labels/crops/{oid}.png")
    assert served.status_code == 200
    assert served.content.startswith(labels.PNG_MAGIC)
    assert client.post(f"/api/labels/crops/{oid}", json={"image": "data:image/png;base64,AAAA"}).status_code == 422
    assert client.get("/api/labels/crops/OBJ-9999.png").status_code == 404


def test_vlm_absent(client: TestClient) -> None:
    assert client.get("/api/labels/vlm").status_code == 404
