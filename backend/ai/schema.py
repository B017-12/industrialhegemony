"""Response contract for the copilot (follows DOC-RAG-GUIDE: name the asset, cite evidence IDs,
state confidence, separate observation from hypothesis, propose the next safe verification step)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Claim(BaseModel):
    text: str
    evidence_ids: list[str] = Field(default_factory=list, description="IDs from the evidence pack backing this claim")


class CopilotDraft(BaseModel):
    """What the LLM is allowed to write. Confidence is NOT part of it: it is computed deterministically."""

    headline: str = Field(description="One sentence: asset tag, condition and the main concern")
    observations: list[Claim] = Field(description="Facts read directly from telemetry, events, state or work orders")
    hypotheses: list[Claim] = Field(description="Possible explanations; evidence, not proof")
    safe_next_checks: list[str] = Field(description="Inspection/verification steps only; no control actions")


class CopilotAnswer(CopilotDraft):
    asset_id: str
    tag: str
    confidence: float
    confidence_rationale: list[str]
    safety_note: str
    citations: list[str]
    removed_citations: list[str] = Field(default_factory=list, description="IDs the model cited that do not exist")
    mode: Literal["llm", "fallback"]
    model: str | None = None
