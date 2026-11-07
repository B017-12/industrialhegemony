from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Query

from ..db import connect, row_to_dict
from ..models import SearchResponse

router = APIRouter(prefix="/api", tags=["search"])

STOPWORDS = {
    "a", "an", "and", "are", "all", "any", "for", "in", "is", "of", "on", "or", "the", "to", "with",
    "show", "find", "list", "which", "what", "that", "need", "needs", "needing", "me", "my",
}
TYPE_WEIGHT = {"asset": 1.0, "issue": 0.9, "document": 0.8, "event": 0.7}


def tokenise(text: str) -> list[str]:
    tokens = []
    for raw in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", text.lower()):
        if raw in STOPWORDS:
            continue
        if len(raw) > 3 and raw.endswith("s") and not raw.endswith("ss"):
            raw = raw[:-1]
        tokens.append(raw)
    return list(dict.fromkeys(tokens))


def _haystack(*parts: Any) -> str:
    return " ".join(str(p) for p in parts if p is not None).lower().replace("_", " ")


def _score(tokens: list[str], haystack: str) -> float:
    if not tokens:
        return 0.0
    matched = sum(1 for t in tokens if t in haystack)
    return matched / len(tokens)


def _candidates() -> list[dict[str, Any]]:
    with connect() as conn:
        assets = [row_to_dict(r) for r in conn.execute(
            "SELECT a.*, c.condition_state, c.issue_code, c.issue_summary, c.urgency, c.health_score "
            "FROM Asset_Master a LEFT JOIN Current_State c USING(asset_id)"
        )]
        dq = [row_to_dict(r) for r in conn.execute("SELECT * FROM Data_Quality")]
        events = [row_to_dict(r) for r in conn.execute("SELECT * FROM Alarms_Events WHERE status = 'open'")]
        docs = [row_to_dict(r) for r in conn.execute(
            "SELECT r.doc_id, r.asset_id, r.tag, r.scope, r.document_role, k.title, k.content "
            "FROM RAG_Corpus_Index r LEFT JOIN Knowledge_Docs k USING(doc_id)"
        )]
    items = []
    for a in assets:
        items.append({
            "type": "asset", "id": a["asset_id"], "asset_id": a["asset_id"],
            "title": f"{a.get('tag')} {a.get('asset_class')}",
            "subtitle": f"{a.get('condition_state')} / {a.get('issue_code')} / {a.get('area_name')}",
            "haystack": _haystack(a["asset_id"], a.get("tag"), a.get("asset_class"), a.get("area_name"), a.get("process_context"),
                                  a.get("criticality"), a.get("condition_state"), a.get("issue_code"), a.get("issue_summary"),
                                  a.get("urgency")),
        })
        if a.get("issue_code") and a["issue_code"] != "NORMAL":
            items.append({
                "type": "issue", "id": f"STATE:{a['asset_id']}", "asset_id": a["asset_id"],
                "title": f"{a.get('tag')} {a.get('issue_code')}",
                "subtitle": a.get("issue_summary"),
                "haystack": _haystack(a.get("tag"), a.get("asset_class"), a.get("issue_code"), a.get("issue_summary"),
                                      a.get("condition_state"), a.get("urgency"), "issue"),
            })
    for d in dq:
        items.append({
            "type": "issue", "id": d["issue_id"], "asset_id": d.get("asset_id"),
            "title": f"{d.get('tag')} {d.get('issue_type')}",
            "subtitle": f"{d.get('severity')} data quality: {d.get('recommended_handling')}",
            "haystack": _haystack(d["issue_id"], d.get("tag"), d.get("issue_type"), d.get("severity"), d.get("source_sheet"),
                                  "data quality issue"),
        })
    for e in events:
        items.append({
            "type": "event", "id": e["event_id"], "asset_id": e.get("asset_id"),
            "title": f"{e.get('tag')} {e.get('event_code')}",
            "subtitle": f"{e.get('timestamp')} {e.get('severity')} {e.get('event_type')}",
            "haystack": _haystack(e["event_id"], e.get("tag"), e.get("event_code"), e.get("event_type"), e.get("severity"),
                                  e.get("description"), "open event alarm"),
        })
    for d in docs:
        items.append({
            "type": "document", "id": d["doc_id"], "asset_id": d.get("asset_id"),
            "title": d.get("title") or d["doc_id"],
            "subtitle": f"{d.get('document_role')} ({d.get('scope')})",
            "haystack": _haystack(d["doc_id"], d.get("tag"), d.get("scope"), d.get("document_role"), d.get("title"),
                                  d.get("content"), "document doc"),
        })
    return items


@router.get("/search", response_model=SearchResponse)
def search(q: str = Query(..., min_length=1), limit: int = Query(25, ge=1, le=200)) -> dict[str, Any]:
    tokens = tokenise(q)
    hits = []
    for item in _candidates():
        score = _score(tokens, item["haystack"])
        if score > 0:
            hits.append({k: v for k, v in item.items() if k != "haystack"} | {"score": round(score * TYPE_WEIGHT[item["type"]], 3)})
    hits.sort(key=lambda h: (-h["score"], h["type"] != "asset", h["id"]))
    asset_hits = [h for h in hits if h["type"] == "asset"]
    best = asset_hits[0]["score"] if asset_hits else 0
    asset_ids = [h["asset_id"] for h in asset_hits if h["score"] == best]
    return {"query": q, "tokens": tokens, "total": len(hits), "asset_ids": asset_ids, "results": hits[:limit]}
