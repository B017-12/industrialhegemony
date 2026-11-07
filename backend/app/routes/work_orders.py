from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import copilot
from ..models import CopilotQuery, WorkOrderDraftResponse

router = APIRouter(prefix="/api/work-orders", tags=["work orders"])


@router.post("/draft", response_model=WorkOrderDraftResponse)
def work_order_draft(query: CopilotQuery) -> dict[str, Any]:
    return copilot.work_order_draft(query)
