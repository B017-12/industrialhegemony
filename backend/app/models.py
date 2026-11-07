from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Open(BaseModel):
    """A record whose extra columns (workbook rows, pipeline JSON) pass through unchanged."""

    model_config = ConfigDict(extra="allow")


# Requests

CopilotMode = Literal["arrival_diagnosis", "status_line", "question"]


class CopilotQuery(BaseModel):
    asset_id: str
    mode: CopilotMode = "arrival_diagnosis"
    question: str | None = None

    @model_validator(mode="after")
    def question_required(self) -> "CopilotQuery":
        if self.mode == "question" and not (self.question and self.question.strip()):
            raise ValueError("mode 'question' requires a non-empty 'question'")
        return self


# Health

class HealthResponse(BaseModel):
    ok: bool
    database: str
    scene_objects: bool
    nav: bool
    nav_targets: bool


# Workbook

class BuilderQuestion(BaseModel):
    question_id: str
    builder_question: str
    capability_focus: str | None = None
    priority: str | None = None


class BuilderQuestionsResponse(BaseModel):
    questions: list[BuilderQuestion]


# Label review

ReviewActionName = Literal["confirm", "relabel", "reject", "merge", "bind", "unbind"]


class ReviewAction(BaseModel):
    reviewer: str = Field(min_length=1)
    action: ReviewActionName
    class_: str | None = Field(None, alias="class")
    display_label: str | None = None
    class_confidence: float | None = Field(None, ge=0.0, le=1.0)
    merge_into: str | None = None
    asset_id: str | None = None
    notes: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class RestoreRequest(BaseModel):
    reviewer: str = Field(min_length=1)
    entries: dict[str, dict[str, Any] | None]


class OverridesFile(Open):
    schema_version: str = "1.0"
    overrides: dict[str, dict[str, Any]]


class ReviewResponse(BaseModel):
    overrides: OverridesFile
    changed: dict[str, dict[str, Any] | None]
    previous: dict[str, dict[str, Any] | None]
    notes: list[str]


class LabelSummary(BaseModel):
    objects: int
    visible: int
    by_label_source: dict[str, int]
    by_review_status: dict[str, int]
    human_reviewed: int
    reviewers: list[str]
    bound_assets: int
    bound_reviewed: int
    crops: int
    vlm: bool


class CropUpload(BaseModel):
    image: str
    camera: dict[str, Any] | None = None
    bbox_px: list[float] | None = None
    viewport_px: list[float] | None = None


class CropEntry(Open):
    file: str
    captured_at: str
    width: int
    height: int


class CropIndex(BaseModel):
    crops: dict[str, CropEntry]


# Assets

class SceneBinding(Open):
    object_id: str
    mapping_method: str | None = None
    mapping_confidence: float | None = None


class AssetSummary(Open):
    asset_id: str
    tag: str | None = None
    asset_class: str | None = None
    health_score: float | None = None
    condition_state: str | None = None
    issue_code: str | None = None
    issue_summary: str | None = None
    urgency: str | None = None
    scene_object_id: str | None = None
    mapping_method: str | None = None
    mapping_confidence: float | None = None


class DocumentRef(BaseModel):
    doc_id: str
    title: str | None = None
    scope: str | None = None
    document_role: str | None = None
    file_name: str | None = None
    mime_type: str | None = None
    content: str | None = None
    content_available: bool


class AssetDetail(BaseModel):
    master: Open
    current: Open | None
    events: list[Open]
    work_orders: list[Open]
    documents: list[DocumentRef] = []
    scene: SceneBinding | None = None


class MetricInfo(BaseModel):
    metric: str
    label: str
    unit: str


class TelemetryResponse(BaseModel):
    asset_id: str
    tag: str | None
    asset_class: str | None
    from_: str | None = Field(None, alias="from")
    to: str | None
    metrics: list[MetricInfo]
    timestamps: list[str]
    series: dict[str, list[float | None]]
    trends: dict[str, Open]
    baselines: dict[str, Open]

    model_config = ConfigDict(populate_by_name=True)


class EventsResponse(BaseModel):
    asset_id: str
    order: Literal["priority", "recent"]
    total: int
    events: list[Open]


class DocumentsResponse(BaseModel):
    asset_id: str
    documents: list[DocumentRef]


# Scene

class SceneAnchor(BaseModel):
    scene_anchor_id: str | None
    asset_id: str
    tag: str | None
    remapped: bool
    mapping_status: str
    scene: SceneBinding | None
    reachable: bool | None
    distance_to_walkable_m: float | None
    excel_placeholder: Open


class AnchorsResponse(BaseModel):
    frame: str
    metres_per_unit: float | None
    summary: dict[str, int]
    anchors: list[SceneAnchor]


class NavResponse(Open):
    target_asset_id: str | None = None
    target_object_id: str | None = None
    reachable: bool


# Search

class SearchHit(BaseModel):
    type: Literal["asset", "issue", "event", "document"]
    id: str
    title: str
    subtitle: str | None = None
    asset_id: str | None = None
    score: float


class SearchResponse(BaseModel):
    query: str
    tokens: list[str]
    total: int
    asset_ids: list[str]
    results: list[SearchHit]


# Copilot

class EvidenceItem(BaseModel):
    id: str
    source: str
    kind: str
    text: str
    record: dict[str, Any] | None = None
    values: dict[str, Any] | None = None


class Claim(BaseModel):
    text: str
    evidence_ids: list[str]


class Confidence(BaseModel):
    score: float
    reasons: list[str]


class Validation(BaseModel):
    ok: bool
    errors: list[str]
    attempts: int


class CopilotResponse(Open):
    asset_id: str
    mode: CopilotMode
    question: str | None = None
    summary: str
    observations: list[Claim]
    hypotheses: list[Claim]
    next_safe_checks: list[str]
    caveats: list[str]
    confidence: Confidence
    generation: Literal["llm", "deterministic", "deterministic_fallback", "cached"]
    cached: bool
    model: str | None = None
    validation: Validation
    evidence: list[EvidenceItem]


class WorkOrderDraft(BaseModel):
    asset_id: str
    tag: str
    area_name: str | None
    action: str
    maintenance_type: Literal["predictive"]
    priority: Literal["high", "medium", "low"]
    role: str
    knowledge_doc_id: str | None
    status: Literal["draft"]
    note: str
    title: str
    summary: str
    safe_checks: list[str]
    evidence_ids: list[str]


class WorkOrderDraftResponse(BaseModel):
    asset_id: str
    draft: WorkOrderDraft
    generation: Literal["llm", "deterministic", "deterministic_fallback", "cached"]
    confidence: Confidence
