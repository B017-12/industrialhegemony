"""API_Contract routes + copilot grounding."""

import pytest
from fastapi.testclient import TestClient

from backend.app import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_contract_routes(client):
    assets = client.get("/api/assets").json()
    assert len(assets) == 30
    one = client.get("/api/assets/ASSET-017").json()
    assert one["state"]["issue_code"] == "FOULING"
    assert len(client.get("/api/assets/ASSET-017/telemetry?last_n=10").json()) == 10
    assert client.get("/api/assets/ASSET-017/events?limit=5").json()[0]["event_id"].startswith("EVT-")
    docs = client.get("/api/assets/ASSET-017/documents").json()
    assert any(d["doc_id"] == "DOC-PROCESS_PUMP-CORE" for d in docs["documents"])
    anchors = client.get("/api/scene/anchors").json()
    assert len(anchors) == 30 and all(a["object_id"] for a in anchors)
    assert client.get("/api/assets/NOPE").status_code == 404


def test_telemetry_append_roundtrip(client):
    before = len(client.get("/api/assets/ASSET-017/telemetry").json())
    row = client.post("/api/assets/ASSET-017/telemetry", json={"values": {"process_flow_pct": 65.5}}).json()
    assert row["process_flow_pct"] == 65.5 and row["source_profile"] == "runtime_append"
    assert len(client.get("/api/assets/ASSET-017/telemetry").json()) == before + 1
    bad = client.post("/api/assets/ASSET-017/telemetry", json={"values": {"made_up": 1}})
    assert bad.status_code == 422


def test_work_order_is_draft_only(client):
    wo = client.post("/api/work-orders/draft", json={"asset_id": "ASSET-017", "action": "inspect hydraulic path",
                                                     "evidence_ids": ["EVT-00037", "EVT-99999"]}).json()
    assert wo["status"] == "DRAFT" and wo["rejected_evidence_ids"] == ["EVT-99999"]


def _all_ids(ans):
    return {i for c in ans["observations"] + ans["hypotheses"] for i in c["evidence_ids"]}


def test_fallback_copilot_is_grounded(client, monkeypatch):
    monkeypatch.delenv("LLM_MODEL", raising=False)
    ans = client.post("/api/copilot/query", json={"asset_id": "ASSET-017"}).json()
    assert ans["mode"] == "fallback"
    ids = _all_ids(ans)
    from backend.app import store

    valid = store().evidence_ids()
    assert all(i in valid or i.startswith("TELEMETRY:") for i in ids)
    assert any(i.startswith("EVT-") for i in ids) and any(i.startswith("DQ-") for i in ids)
    assert ans["confidence"] < 0.91  # reduced for data-quality issues (Q-06)
    assert "DOC-FIELD-SAFETY" in ans["safety_note"]


def test_llm_citations_are_validated(client, monkeypatch):
    # pydantic-ai TestModel returns schema-valid but made-up content (including fake evidence IDs)
    from pydantic_ai.models.test import TestModel

    import backend.ai.agent as agent_mod

    make = agent_mod._make_agent
    monkeypatch.setenv("LLM_MODEL", "test")
    monkeypatch.setattr(agent_mod, "_make_agent", lambda _model: make(TestModel(call_tools=[])))
    ans = client.post("/api/copilot/query", json={"asset_id": "ASSET-017", "question": "why?"}).json()
    from backend.app import store

    valid = store().evidence_ids()
    assert ans["mode"] == "llm"
    assert all(i in valid or i.startswith("TELEMETRY:") for i in _all_ids(ans))
    assert ans["confidence"] == client.post("/api/copilot/query", json={"asset_id": "ASSET-017"}).json()["confidence"]


def test_citation_validator_strips_unknown_ids():
    from backend.ai.agent import _validate_citations
    from backend.ai.schema import Claim, CopilotDraft

    draft = CopilotDraft(headline="h", observations=[Claim(text="x", evidence_ids=["EVT-00037", "EVT-000619"])],
                         hypotheses=[Claim(text="y", evidence_ids=["WO-000189", "CASE-025"])], safe_next_checks=[])
    clean, removed = _validate_citations(draft, {"EVT-00037", "CASE-025"})
    assert clean.observations[0].evidence_ids == ["EVT-00037"]
    assert clean.hypotheses[0].evidence_ids == ["CASE-025"]
    assert removed == ["EVT-000619", "WO-000189"]  # the prototype's invented ID formats
