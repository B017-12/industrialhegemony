from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.sse import EventSourceResponse, ServerSentEvent

from .. import copilot
from ..db import connect
from ..errors import UnknownAssetError
from ..models import CopilotQuery, CopilotResponse

router = APIRouter(prefix="/api/copilot", tags=["copilot"])


def known_asset(query: CopilotQuery) -> CopilotQuery:
    """Resolve unknown assets to 404 before a stream starts, since a started stream cannot change its status."""
    with connect() as conn:
        if conn.execute("SELECT 1 FROM Asset_Master WHERE asset_id = ?", (query.asset_id,)).fetchone() is None:
            raise UnknownAssetError(query.asset_id)
    return query


@router.post("/query", response_model=CopilotResponse)
def copilot_query(query: CopilotQuery) -> dict[str, Any]:
    return copilot.answer(query)


@router.post("/stream", response_class=EventSourceResponse)
def copilot_stream(query: CopilotQuery = Depends(known_asset)) -> Iterator[ServerSentEvent]:
    """Events: meta, delta (word chunks of the validated summary), answer (full response), done."""
    response = CopilotResponse.model_validate(copilot.answer(query))
    yield ServerSentEvent(event="meta", data={
        "asset_id": response.asset_id,
        "mode": response.mode,
        "generation": response.generation,
        "cached": response.cached,
        "model": response.model,
        "evidence_count": len(response.evidence),
    })
    for chunk in re.findall(r"\S+\s*", response.summary):
        yield ServerSentEvent(event="delta", data={"text": chunk})
    yield ServerSentEvent(event="answer", data=response)
    yield ServerSentEvent(event="done", data={"ok": response.validation.ok})
