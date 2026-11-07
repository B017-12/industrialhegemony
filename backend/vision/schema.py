"""JSON contract for vision findings and vision-vs-telemetry cross-checks."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Kind = Literal["manual_valve", "control_valve", "gauge", "pump", "motor", "other"]
State = Literal["open", "closed", "partially_open", "unknown", "not_applicable"]
STATEFUL = {"open", "closed", "partially_open"}


class GaugeReading(BaseModel):
    readable: bool = Field(description="True only if needle AND scale numbers are clearly legible")
    value: float | None = Field(None, description="Reading in the dial's unit; null if not readable")
    unit: str | None = Field(None, description="Unit printed on the dial, e.g. 'bar' or '°C'")
    scale_min: float | None = None
    scale_max: float | None = None


class VisionDraft(BaseModel):
    """What the vision model returns (validated by Pydantic AI)."""

    object_seen: str = Field(description="Short name of the object inside the box, e.g. 'ball valve with lever'")
    kind: Kind = Field(description="Best matching kind for the object inside the box")
    text_read: str | None = Field(None, description="Brand, model or tag text legible in the image, verbatim")
    state: State = Field(description="Valve state; 'not_applicable' for pumps/gauges; 'unknown' unless clearly visible")
    state_cues: list[str] = Field(default_factory=list,
                                  description="Visual facts that support the state, e.g. 'lever parallel to pipe axis'")
    gauge: GaugeReading | None = None
    running_indicator: Literal["on", "off", "not_visible", "not_applicable"] = "not_applicable"
    visible_issues: list[str] = Field(default_factory=list,
                                      description="Visible leaks, corrosion, damage or missing parts; empty if none")
    visibility: Literal["clear", "partial", "poor"] = Field(
        description="clear = whole object sharp and unobstructed; partial = occluded/cut off; poor = blurry or dark")
    model_confidence: float = Field(ge=0, le=1, description="Your own confidence in the state/reading, 0..1")
    answer: str | None = Field(None, description="Answer to the user's question, if one was asked; cite what you see")


class ConfidenceFactor(BaseModel):
    name: str
    value: float
    note: str


class VisionFinding(BaseModel):
    finding_id: str
    frame_id: str
    region_id: str | None
    bbox_px: list[int]
    object_id: str | None
    asset_id: str | None
    link_method: str | None = None
    link_confidence: float | None = None
    kind_expected: str | None = None
    draft: VisionDraft
    state: State = Field(description="Final state after the confidence gate (may be 'unknown' when the model was not)")
    confidence: float
    confidence_factors: list[ConfidenceFactor]
    gate_note: str | None = None
    evidence_ids: list[str]
    safety_note: str
    question: str | None = None
    mode: Literal["llm", "cache", "fallback"]
    model_id: str | None
    prompt_version: str
    created_at: str


class TelemetryPoint(BaseModel):
    signal: str
    value: float | None
    timestamp: str | None
    evidence_id: str


class CrossCheck(BaseModel):
    asset_id: str
    tag: str | None
    asset_class: str | None
    object_id: str | None
    binding: dict | None
    telemetry: list[TelemetryPoint]
    telemetry_flag: str | None
    finding_id: str | None
    vision_state: str | None
    verdict: Literal["consistent", "mismatch", "unverifiable"]
    rationale: list[str]
    advice: str
    evidence_ids: list[str]
