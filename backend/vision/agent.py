"""Vision agent: Gemini (any Pydantic AI model id) looks at a padded crop plus the whole frame and returns a
VisionDraft. Model id from env VISION_MODEL (falls back to LLM_MODEL), e.g. 'google:<model id from AI Studio>'.
Without a model/key, or on any error, a deterministic fallback returns 'unknown' with the reason."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from pydantic_ai import Agent, BinaryContent

from backend.vision import cache, manifest
from backend.vision.confidence import score
from backend.vision.schema import VisionDraft, VisionFinding

log = logging.getLogger(__name__)
PROMPT_VERSION = "v1"
SAFETY = ("Inspection/verification advice only. Confirm on site before acting; never operate a valve based on this "
          "finding. Follow LOTO, permits and OEM instructions (DOC-FIELD-SAFETY).")

INSTRUCTIONS = """You inspect photos from a video walk-through of an industrial boiler/pump room.
You get (1) a close crop with a yellow box around ONE object and (2) the whole frame with the same box for context.
Describe only the object inside the yellow box.

Rules for valve state (manual valves):
- Quarter-turn ball/butterfly valves with a lever: lever parallel to the pipe axis = open; perpendicular = closed;
  in between = partially_open. Decide only if BOTH the lever and the pipe axis are clearly visible.
- Handwheel (gate/globe) valves, valves with no visible lever, and check valves/strainers: state = unknown
  (the position cannot be seen from outside); say why in state_cues.
- Control valves with an actuator: state = unknown unless a position indicator/scale is clearly legible.
- Pumps, motors and gauges: state = not_applicable.
Gauges: read the needle only if the needle and the scale numbers are legible; otherwise readable=false.
Pumps: running_indicator 'on' only if a lit LED/display is visible.
Never guess. 'unknown' with a reason is a good answer. Report visible leaks/corrosion/damage only if clearly seen.
model_confidence: your honest probability that the state/reading is correct.
If the user asks a question, answer it in 'answer' from what is visible, and say when it cannot be seen.
This is inspection advice only; never recommend operating equipment."""


def configured_model() -> str | None:
    model = (os.getenv("VISION_MODEL") or os.getenv("LLM_MODEL") or "").strip()
    if not model:
        return None
    if model.startswith("google"):
        if not (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")):
            return None
        os.environ.setdefault("GOOGLE_API_KEY", os.environ.get("GEMINI_API_KEY", ""))
    return model


def _fallback(reason: str, kind: str | None) -> VisionDraft:
    na = kind in ("pump", "motor", "gauge")
    return VisionDraft(object_seen=f"{kind or 'object'} (not analysed)", kind=kind or "other",
                       state="not_applicable" if na else "unknown", state_cues=[reason],
                       visibility="poor", model_confidence=0.0,
                       answer=f"No vision model available: {reason}" if reason else None)


def run_model(model: str, crop_jpg: bytes, ctx_jpg: bytes, hint: str, question: str | None) -> VisionDraft:
    agent = Agent(model, output_type=VisionDraft, instructions=INSTRUCTIONS, retries=2)
    text = f"Expected object (from a human annotator, may be wrong): {hint}."
    if question:
        text += f"\nUser question: {question}"
    result = agent.run_sync([
        text,
        "Close crop:", BinaryContent(data=crop_jpg, media_type="image/jpeg"),
        "Whole frame for context:", BinaryContent(data=ctx_jpg, media_type="image/jpeg"),
    ])
    return result.output


def inspect(frame_id: str, bbox: list[int], region: dict | None = None, question: str | None = None,
            force: bool = False) -> VisionFinding:
    f = manifest.frame(frame_id)
    if f is None:
        raise KeyError(frame_id)
    region = region or {}
    kind = region.get("kind")
    hint = f"{kind or 'unspecified'}: {region.get('description') or 'object in the box'}"
    crop_jpg = manifest.jpeg(manifest.crop(f, bbox))
    ctx_jpg = manifest.jpeg(manifest.context(f, bbox), quality=80)
    model = configured_model()
    k = cache.key(crop_jpg, question, model, PROMPT_VERSION, hint)
    hit = None if force else cache.get(k)
    if hit:
        draft, mode = VisionDraft.model_validate(hit["draft"]), "cache"
        model = hit.get("model_id")
    elif model:
        try:
            draft, mode = run_model(model, crop_jpg, ctx_jpg, hint, question), "llm"
        except Exception as exc:  # noqa: BLE001 — any model failure becomes an explicit 'unknown'
            log.warning("vision model failed: %s", exc)
            draft, mode = _fallback(f"model error: {type(exc).__name__}: {str(exc)[:160]}", kind), "fallback"
    else:
        draft, mode = _fallback("no VISION_MODEL/LLM_MODEL with an API key configured in .env", kind), "fallback"

    others = [c["state"] for c in cache.all_findings()
              if region.get("object_id") and c.get("object_id") == region.get("object_id")
              and c.get("region_id") != region.get("region_id") and c.get("question") is None]
    conf, factors, state, gate = score(draft, bbox, manifest.sharpness(f, bbox), others)
    if mode == "fallback":
        conf, gate = 0.0, draft.state_cues[0] if draft.state_cues else None
    evidence = [frame_id] + ([region["region_id"]] if region.get("region_id") else [])
    evidence += [i for i in (region.get("object_id"), region.get("asset_id")) if i]
    finding = VisionFinding(
        finding_id=f"VIS-{k[:10]}", frame_id=frame_id, region_id=region.get("region_id"), bbox_px=list(bbox),
        object_id=region.get("object_id"), asset_id=region.get("asset_id"),
        link_method=region.get("link_method"), link_confidence=region.get("link_confidence"),
        kind_expected=kind, draft=draft, state=state, confidence=conf, confidence_factors=factors, gate_note=gate,
        evidence_ids=evidence, safety_note=SAFETY, question=question, mode=mode,
        model_id=model if mode != "fallback" else None, prompt_version=PROMPT_VERSION,
        created_at=hit["created_at"] if hit else datetime.now(timezone.utc).isoformat(),
    )
    if mode == "llm":
        cache.put(k, {**finding.model_dump(mode="json"), "mode": "llm"})
    return finding
