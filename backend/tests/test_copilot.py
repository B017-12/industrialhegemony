from __future__ import annotations

import json
from pathlib import Path

import pytest

from app import cache, copilot, llm
from app.confidence import compute
from app.evidence import evidence_bundle
from app.models import CopilotQuery
from app.validators import validate

from .conftest import TARGET

VALID = llm.LlmAnswer(
    summary="P-002 shows a cavitation-like signature; vibration rose from 2.42 to 4.57 mm/s.",
    observations=[llm.LlmClaim(text="Vibration rose from 2.42 to 4.57 mm/s.", evidence_ids=["TEL:ASSET-014:vibration_mm_s"])],
    hypotheses=[llm.LlmClaim(text="Cavitation is a possible cause.", evidence_ids=["CASE-026", "EVT-00136"])],
    next_safe_checks=["Inspect process conditions; follow DOC-FIELD-SAFETY."],
    caveats=["The 3D binding is procedural."],
)
INVALID = VALID.model_copy(update={
    "observations": [llm.LlmClaim(text="Vibration reached 9.99 mm/s.", evidence_ids=["EVT-99999"])],
})


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch):
    """Pretend a key is set and script llm.generate's answers; records the errors passed to each call."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    calls: list[list[str] | None] = []

    def script(*answers):
        queue = list(answers)

        def generate(bundle, mode, question=None, errors=None):
            calls.append(errors)
            return queue.pop(0) if queue else None

        monkeypatch.setattr(llm, "generate", generate)
        return calls

    return script


def test_no_key_is_deterministic_and_valid() -> None:
    r = copilot.answer(CopilotQuery(asset_id=TARGET))
    assert r["generation"] == "deterministic"
    assert r["cached"] is False
    assert r["model"] is None
    assert r["validation"] == {"ok": True, "errors": [], "attempts": 0}
    assert r["confidence"]["score"] == 0.5


def test_confidence_reasons_for_target() -> None:
    b = evidence_bundle(TARGET)
    conf = compute(b["current"], b["data_quality"], b["binding"])
    assert conf["score"] == 0.5
    assert len(conf["reasons"]) == 4
    assert "DQ-0098" in conf["reasons"][1] and "DQ-0064" in conf["reasons"][2]
    assert "video frames" in conf["reasons"][3]


@pytest.mark.parametrize("method,dq,expected", [
    ("procedural_fallback", [], 0.25),
    ("procedural_class_match", [], 0.5),
    (None, [], 0.2),
    ("visual_confirmed", [{"issue_id": "DQ-1", "severity": "high"}] * 3, 0.52),
])
def test_confidence_caps_and_penalties(method: str | None, dq: list[dict], expected: float) -> None:
    binding = None if method is None else {"mapping_method": method}
    assert compute({"model_confidence": 0.68}, dq, binding)["score"] == expected


def test_valid_llm_answer_is_used_and_cached(fake_llm, offline: Path) -> None:
    calls = fake_llm(VALID)
    r = copilot.answer(CopilotQuery(asset_id=TARGET))
    assert r["generation"] == "llm"
    assert r["model"] == llm.model_name()
    assert r["validation"] == {"ok": True, "errors": [], "attempts": 1}
    assert r["confidence"]["score"] == 0.5
    assert calls == [None]
    assert cache.load(TARGET, "arrival_diagnosis")["source_generation"] == "llm"


def test_retry_then_valid(fake_llm) -> None:
    calls = fake_llm(INVALID, VALID)
    r = copilot.answer(CopilotQuery(asset_id=TARGET))
    assert r["generation"] == "llm"
    assert r["validation"]["attempts"] == 2
    assert calls[0] is None and any("EVT-99999" in e for e in calls[1])


def test_invalid_twice_falls_back_to_deterministic(fake_llm) -> None:
    calls = fake_llm(INVALID, INVALID)
    r = copilot.answer(CopilotQuery(asset_id=TARGET))
    assert r["generation"] == "deterministic_fallback"
    assert r["cached"] is False
    assert r["validation"]["ok"] is True
    assert r["validation"]["attempts"] == 2
    assert any("9.99" in e for e in r["validation"]["errors"])
    assert len(calls) == 2
    assert r["summary"] == copilot.deterministic_response(CopilotQuery(asset_id=TARGET))["summary"]


def test_llm_unavailable_serves_cache(fake_llm) -> None:
    cache.warm([TARGET])
    fake_llm()
    r = copilot.answer(CopilotQuery(asset_id=TARGET))
    assert r["generation"] == "cached"
    assert r["cached"] is True
    assert r["validation"]["attempts"] == 1


def test_invalid_twice_serves_cache(fake_llm) -> None:
    cache.warm([TARGET])
    fake_llm(INVALID, INVALID)
    r = copilot.answer(CopilotQuery(asset_id=TARGET))
    assert r["generation"] == "cached"
    assert r["cached"] is True
    assert r["validation"]["attempts"] == 2


def test_status_line_is_not_cached(fake_llm) -> None:
    cache.warm([TARGET])
    fake_llm()
    r = copilot.answer(CopilotQuery(asset_id=TARGET, mode="status_line"))
    assert r["generation"] == "deterministic_fallback"


def test_status_line_text() -> None:
    r = copilot.answer(CopilotQuery(asset_id=TARGET, mode="status_line"))
    assert r["summary"] == "P-002 attention: vibration 4.57 mm/s vs 2.08 healthy, cavitation risk."


def test_question_routes_by_keyword() -> None:
    r = copilot.answer(CopilotQuery(asset_id=TARGET, mode="question", question="Which events are open?"))
    cited = {eid for item in r["observations"] for eid in item["evidence_ids"]}
    assert "EVENTS:ASSET-014:summary" in cited and "EVT-00893" in cited


def test_committed_cache_file_is_valid() -> None:
    path = Path(__file__).resolve().parents[1] / "cache" / f"{TARGET}_arrival_diagnosis.json"
    entry = json.loads(path.read_text())
    assert validate(entry["answer"], evidence_bundle(TARGET)["evidence"])["ok"]


def test_generate_without_key_returns_none() -> None:
    assert llm.generate(evidence_bundle(TARGET), "arrival_diagnosis") is None
