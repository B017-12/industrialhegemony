from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..db import connect, row_to_dict
from ..models import BuilderQuestionsResponse

router = APIRouter(prefix="/api/workbook", tags=["workbook"])


@router.get("/builder-questions", response_model=BuilderQuestionsResponse)
def builder_questions() -> dict[str, Any]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT question_id, builder_question, capability_focus, priority FROM Builder_Questions ORDER BY question_id"
        ).fetchall()
    return {"questions": [row_to_dict(r) for r in rows]}
