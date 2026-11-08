from __future__ import annotations

from fastapi.testclient import TestClient

from app.evidence import evidence_bundle
from app.scene_index import fingerprint_current


def test_stale_fingerprint_does_not_match() -> None:
    box = {"obb": {"center": [0.0, 0.0, 0.0], "extent": [1.0, 1.0, 1.0]}}
    current = {"asset_id": "ASSET-014", "obb_fingerprint": {"center": [0.0, 0.0, 0.0], "extent": [1.0, 1.0, 1.0]}}
    moved = {"asset_id": "ASSET-014", "obb_fingerprint": {"center": [5.0, 0.0, 0.0], "extent": [1.0, 1.0, 1.0]}}
    assert fingerprint_current(box, current)
    assert fingerprint_current(box, {"asset_id": "ASSET-014"})
    assert not fingerprint_current(box, moved)


def test_unmapped_and_parent_linkage(client: TestClient) -> None:
    rows = {row["asset_id"]: row for row in client.get("/api/assets").json()}
    revision = rows["ASSET-014"]["scene_revision"]
    assert revision
    assert rows["ASSET-024"]["scene_object_id"] is None
    assert rows["ASSET-024"]["mapping_status"] == "unmapped"
    assert rows["ASSET-017"]["scene_object_id"] is None
    assert rows["ASSET-017"]["mapping_status"] == "unmapped"
    assert rows["ASSET-001"]["scene_object_id"] is None
    assert rows["ASSET-001"]["mapping_status"] == "class_only_candidate"
    assert all(row["scene_revision"] == revision for row in rows.values())

    detail = client.get("/api/assets/ASSET-030").json()
    assert detail["master"]["asset_id"] == "ASSET-030"
    assert detail["scene"]["object_id"] == "OBJ-0185"
    assert detail["scene"]["location_kind"] == "parent_assembly"
    assert detail["scene"]["mapping_status"] == "procedural_assignment"
    assert detail["review"]["asset_id"] == "ASSET-030"
    assert detail["review"]["region_object_ids"] == ["OBJ-0185"]
    assert detail["review"]["reviewer"] is None

    mapped = evidence_bundle("ASSET-030")
    assert mapped["asset"]["asset_id"] == "ASSET-030"
    text = next(item["text"] for item in mapped["evidence"] if item["id"] == "MAP:ASSET-030")
    assert text.startswith("VS-003")
    assert "parent_assembly" in text
    assert "OBJ-0185" in text

    missing = evidence_bundle("ASSET-024")
    missing_text = next(item["text"] for item in missing["evidence"] if item["id"] == "MAP:ASSET-024")
    assert "ASSET-024" in missing_text
    assert "unknown" in missing_text
    assert "OBJ-0185" not in missing_text
