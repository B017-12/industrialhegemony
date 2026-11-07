from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from .conftest import TARGET, parse_sse

GET_ROUTES = [
    "/api/health",
    "/api/assets",
    f"/api/assets/{TARGET}",
    f"/api/assets/{TARGET}/telemetry",
    f"/api/assets/{TARGET}/telemetry?metric=vibration_mm_s",
    f"/api/assets/{TARGET}/events",
    f"/api/assets/{TARGET}/events?order=recent&status=open&limit=3",
    f"/api/assets/{TARGET}/documents",
    "/api/scene/objects",
    "/api/scene/nav",
    "/api/scene/nav?target=ASSET-001",
    "/api/scene/anchors",
    "/api/search?q=pumps%20needing%20attention",
    "/api/workbook/builder-questions",
]


@pytest.mark.parametrize("path", GET_ROUTES)
def test_get_routes_ok(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 200


@pytest.mark.parametrize("mode,question", [
    ("arrival_diagnosis", None),
    ("status_line", None),
    ("question", "Why is vibration high?"),
])
def test_copilot_query_modes(client: TestClient, mode: str, question: str | None) -> None:
    r = client.post("/api/copilot/query", json={"asset_id": TARGET, "mode": mode, "question": question})
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == mode
    assert body["generation"] == "deterministic"
    assert body["cached"] is False
    assert body["validation"]["ok"] is True


def test_work_order_draft(client: TestClient) -> None:
    r = client.post("/api/work-orders/draft", json={"asset_id": TARGET})
    assert r.status_code == 200
    draft = r.json()["draft"]
    assert draft["status"] == "draft"
    assert draft["maintenance_type"] == "predictive"
    assert draft["priority"] == "high"
    assert draft["tag"] == "P-002"
    assert draft["knowledge_doc_id"] == "DOC-PROCESS_PUMP-CORE"
    assert "no control action" in draft["note"]
    assert "EVT-00136" in draft["evidence_ids"]


def test_builder_questions(client: TestClient) -> None:
    questions = client.get("/api/workbook/builder-questions").json()["questions"]
    assert [q["question_id"] for q in questions] == [f"Q-{i:02d}" for i in range(1, 11)]
    q03 = next(q for q in questions if q["question_id"] == "Q-03")
    assert q03["capability_focus"] == "explainability + RAG"
    assert q03["priority"] == "P0"


def test_nav_unreachable_target(client: TestClient) -> None:
    body = client.get("/api/scene/nav?target=ASSET-001").json()
    assert body["reachable"] is False
    assert body["path"] is None


@pytest.mark.parametrize("method,path,payload", [
    ("get", "/api/assets/NOPE", None),
    ("get", "/api/assets/NOPE/telemetry", None),
    ("get", "/api/assets/NOPE/events", None),
    ("get", "/api/assets/NOPE/documents", None),
    ("get", "/api/scene/nav?target=NOPE", None),
    ("post", "/api/copilot/query", {"asset_id": "NOPE"}),
    ("post", "/api/copilot/stream", {"asset_id": "NOPE"}),
    ("post", "/api/work-orders/draft", {"asset_id": "NOPE"}),
])
def test_unknown_returns_404(client: TestClient, method: str, path: str, payload: dict | None) -> None:
    r = client.post(path, json=payload) if method == "post" else client.get(path)
    assert r.status_code == 404


@pytest.mark.parametrize("method,path,payload", [
    ("post", "/api/copilot/query", {"asset_id": TARGET, "mode": "bogus"}),
    ("post", "/api/copilot/query", {"asset_id": TARGET, "mode": "question"}),
    ("post", "/api/copilot/query", {"asset_id": TARGET, "mode": "question", "question": "   "}),
    ("post", "/api/copilot/query", {"mode": "arrival_diagnosis"}),
    ("post", "/api/copilot/stream", {"asset_id": TARGET, "mode": "question"}),
    ("get", f"/api/assets/{TARGET}/telemetry?metric=nope", None),
    ("get", f"/api/assets/{TARGET}/events?limit=0", None),
    ("get", "/api/search?q=", None),
])
def test_invalid_returns_422(client: TestClient, method: str, path: str, payload: dict | None) -> None:
    r = client.post(path, json=payload) if method == "post" else client.get(path)
    assert r.status_code == 422


def test_stream_event_order(client: TestClient) -> None:
    r = client.post("/api/copilot/stream", json={"asset_id": TARGET, "mode": "arrival_diagnosis"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(r.text)
    names = [name for name, _ in events]
    assert names[0] == "meta"
    assert names[-2:] == ["answer", "done"]
    assert set(names[1:-2]) == {"delta"} and len(names) > 3

    meta = events[0][1]
    answer = events[-2][1]
    assert meta["generation"] == answer["generation"] == "deterministic"
    assert meta["evidence_count"] == len(answer["evidence"])
    assert "".join(data["text"] for name, data in events if name == "delta") == answer["summary"]
    assert answer["validation"]["ok"] is True
    assert events[-1][1] == {"ok": True}
