from __future__ import annotations

from app.evidence import evidence_bundle

from .conftest import TARGET


def test_target_evidence_selection() -> None:
    ids = [item["id"] for item in evidence_bundle(TARGET)["evidence"]]
    for required in ("EVT-00136", "EVT-00893", "CASE-022", "CASE-026", "CASE-049", "DQ-0098", "DQ-0064"):
        assert required in ids
    assert ids.index("EVT-00893") < ids.index("EVT-00136")
    assert len(ids) == len(set(ids))


def test_target_stable_ids_and_values() -> None:
    evidence = {item["id"]: item for item in evidence_bundle(TARGET)["evidence"]}
    vib = evidence["TEL:ASSET-014:vibration_mm_s"]["values"]
    assert (vib["first_day_mean"], vib["last_day_mean"]) == (2.42, 4.57)
    assert evidence["BASELINE:PROCESS_PUMP:vibration_mm_s"]["values"]["mean"] == 2.08
    assert evidence["MAP:ASSET-014"]["values"]["mapping_confidence"] <= 0.5
    assert "DOC-FIELD-SAFETY" in evidence


def test_diagnosis_cites_required_ids(client) -> None:
    body = client.post("/api/copilot/query", json={"asset_id": TARGET}).json()
    cited = {eid for section in ("observations", "hypotheses") for item in body[section] for eid in item["evidence_ids"]}
    assert {"EVT-00136", "EVT-00893", "CASE-022", "CASE-026", "CASE-049", "DQ-0098"} <= cited
