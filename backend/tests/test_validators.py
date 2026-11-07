from __future__ import annotations

import pytest

from app.copilot import deterministic_response
from app.db import connect
from app.evidence import evidence_bundle
from app.models import CopilotQuery
from app.validators import extract_numbers, validate

from .conftest import TARGET

QUESTIONS = [
    "What events are open?",
    "Why is vibration high?",
    "When was it last serviced?",
    "Can I trust the data?",
    "Where is it in the 3D scene?",
    "Is it safe to open the casing?",
    "Hello there",
]


@pytest.fixture(scope="module")
def evidence() -> list[dict]:
    return evidence_bundle(TARGET)["evidence"]


def _answer(text: str, ids: list[str]) -> dict:
    return {
        "summary": "P-002 needs attention.",
        "observations": [{"text": text, "evidence_ids": ids}],
        "hypotheses": [],
        "next_safe_checks": ["Inspect process conditions (DOC-FIELD-SAFETY)."],
        "caveats": [],
    }


def test_accepts_grounded_answer(evidence: list[dict]) -> None:
    result = validate(_answer("Vibration rose from 2.42 to 4.57 mm/s (+88.8%).", ["TEL:ASSET-014:vibration_mm_s"]), evidence)
    assert result == {"ok": True, "errors": []}


def test_rejects_fake_evidence_id(evidence: list[dict]) -> None:
    result = validate(_answer("Vibration is rising.", ["EVT-99999"]), evidence)
    assert not result["ok"]
    assert any("EVT-99999" in e for e in result["errors"])


def test_rejects_fake_id_in_text(evidence: list[dict]) -> None:
    result = validate(_answer("See EVT-99999 for details.", ["EVT-00136"]), evidence)
    assert not result["ok"]
    assert any("EVT-99999" in e for e in result["errors"])


def test_rejects_claim_without_citation(evidence: list[dict]) -> None:
    assert not validate(_answer("Vibration is rising.", []), evidence)["ok"]


def test_rejects_fake_number(evidence: list[dict]) -> None:
    result = validate(_answer("Vibration reached 9.99 mm/s.", ["TEL:ASSET-014:vibration_mm_s"]), evidence)
    assert not result["ok"]
    assert any("9.99" in e for e in result["errors"])


def test_rounding_tolerance(evidence: list[dict]) -> None:
    assert validate(_answer("Vibration reached 4.6 mm/s.", ["TEL:ASSET-014:vibration_mm_s"]), evidence)["ok"]
    assert not validate(_answer("Vibration reached 4.8 mm/s.", ["TEL:ASSET-014:vibration_mm_s"]), evidence)["ok"]


def test_identifiers_and_dates_are_not_numbers() -> None:
    text = "P-002 (ASSET-014) at TEL:ASSET-014:vibration_mm_s on 2026-10-05T07:30:00 in 3D cites DOC-FIELD-SAFETY, 4.57."
    assert extract_numbers(text) == ["4.57"]


def _asset_ids() -> list[str]:
    with connect() as conn:
        return [r[0] for r in conn.execute("SELECT asset_id FROM Asset_Master ORDER BY asset_id")]


@pytest.mark.parametrize("asset_id", _asset_ids())
def test_deterministic_templates_pass_validator(asset_id: str) -> None:
    bundle = evidence_bundle(asset_id)
    queries = [CopilotQuery(asset_id=asset_id), CopilotQuery(asset_id=asset_id, mode="status_line")]
    queries += [CopilotQuery(asset_id=asset_id, mode="question", question=q) for q in QUESTIONS]
    for query in queries:
        response = deterministic_response(query, bundle)
        assert response["validation"]["ok"], (query.mode, query.question, response["validation"]["errors"])
