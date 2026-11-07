"""Optional vision-language labelling of crop-tour images (Tab 8).

Geometry proposes, a 2D model names: each crop from data/derived/crops/ is classified against the fixed class
list with structured output. The result goes to vlm_labels.json as a suggestion only; it never writes
labels_override.json and never marks anything 'human'. Without OPENAI_API_KEY it exits cleanly.

    python3 -m pipeline.label_vlm               # classify every crop in crops/index.json
    python3 -m pipeline.label_vlm --selftest    # stub client, no network
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import tempfile
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

CLASSES = ("pump", "motor", "valve", "tank", "cabinet", "pipe", "ladder", "crate", "trolley", "sign", "door", "other")
THRESHOLD = 0.6
DEFAULT_MODEL = "gpt-6.1-terra"

PROMPT = (
    "This is a crop from a Gaussian-splat scan of an industrial boiler room. The highlighted box frames one "
    "segmented object. Classify only the object inside the box, using exactly one class from the list. "
    "Prefer 'other' when the crop is blurry, mostly wall, or the object is not recognisable; do not guess an exact "
    "equipment identity. Give a short visual description (under 15 words) and your confidence from 0 to 1."
)

# (png bytes, context text) -> {"class", "confidence", "short_description"}
Classifier = Callable[[bytes, str], dict[str, Any]]


def _model() -> str:
    return os.environ.get("VALMET_VLM_MODEL") or os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL


def openai_classifier() -> Classifier | None:
    if not os.environ.get("OPENAI_API_KEY"):
        return None
    from openai import OpenAI
    from pydantic import BaseModel, ConfigDict, Field

    class CropLabel(BaseModel):
        model_config = ConfigDict(extra="forbid")

        class_: Literal[CLASSES] = Field(alias="class")  # type: ignore[valid-type]
        confidence: float
        short_description: str

    client = OpenAI(timeout=float(os.environ.get("OPENAI_TIMEOUT_S", "60")), max_retries=1)

    def classify(png: bytes, context: str) -> dict[str, Any]:
        image = "data:image/png;base64," + base64.b64encode(png).decode()
        response = client.responses.parse(
            model=_model(),
            input=[{"role": "user", "content": [
                {"type": "input_text", "text": f"{PROMPT}\n\nClasses: {', '.join(CLASSES)}\nGeometry hints: {context}"},
                {"type": "input_image", "image_url": image},
            ]}],
            text_format=CropLabel,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("no parsed output (refusal or truncation)")
        return parsed.model_dump(by_alias=True)

    return classify


def context_for(obj: dict[str, Any] | None) -> str:
    """Size and height hints from the pipeline, so the model can tell a valve from a tank at the same pixel size."""
    if not obj:
        return "none"
    dims = (obj.get("features") or {}).get("dims_m") or {}
    height = obj.get("height_above_floor_m") or {}
    parts = []
    if dims:
        parts.append("size {width:.2f} x {depth:.2f} x {height:.2f} m (w x d x h)".format(**{k: float(dims.get(k, 0)) for k in ("width", "depth", "height")}))
    if height:
        parts.append(f"bottom {float(height.get('bottom', 0)):.2f} m above floor")
    parts.append(f"heuristic guess '{obj.get('class')}'")
    return "; ".join(parts)


def normalise(raw: dict[str, Any]) -> dict[str, Any]:
    cls = raw.get("class")
    confidence = max(0.0, min(1.0, float(raw.get("confidence") or 0.0)))
    if cls not in CLASSES:
        cls, confidence = "other", 0.0
    return {
        "class": cls,
        "confidence": round(confidence, 3),
        "short_description": str(raw.get("short_description") or "")[:160],
        "needs_review": confidence < THRESHOLD,
    }


def run(derived: Path, classify: Classifier, model: str, limit: int | None = None) -> dict[str, Any]:
    crops_dir = derived / "crops"
    index = json.loads((crops_dir / "index.json").read_text(encoding="utf-8")).get("crops", {})
    scene = json.loads((derived / "scene_objects.json").read_text(encoding="utf-8"))
    objects = {o["object_id"]: o for o in scene["objects"]}
    out_path = derived / "vlm_labels.json"
    previous = json.loads(out_path.read_text(encoding="utf-8")).get("labels", {}) if out_path.exists() else {}

    labels: dict[str, Any] = dict(previous)
    errors: dict[str, str] = {}
    for n, (oid, entry) in enumerate(sorted(index.items())):
        if limit is not None and n >= limit:
            break
        try:
            png = (crops_dir / entry["file"]).read_bytes()
            labels[oid] = {**normalise(classify(png, context_for(objects.get(oid)))), "crop_captured_at": entry.get("captured_at")}
        except Exception as exc:  # noqa: BLE001 - one bad crop must not stop the batch
            errors[oid] = str(exc)
    result = {
        "schema_version": "1.0",
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "threshold": THRESHOLD,
        "note": "Suggestions only. Self-reported VLM confidence is poorly calibrated; it orders the review queue and is never a human label.",
        "labels": labels,
        "errors": errors,
    }
    tmp = out_path.with_name(f".{out_path.name}.tmp")
    tmp.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    tmp.replace(out_path)
    return result


def selftest() -> None:
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    with tempfile.TemporaryDirectory() as tmp:
        derived = Path(tmp)
        (derived / "crops").mkdir()
        for oid in ("OBJ-0001", "OBJ-0002", "OBJ-0003"):
            (derived / "crops" / f"{oid}.png").write_bytes(png)
        (derived / "crops" / "index.json").write_text(json.dumps({"crops": {
            oid: {"file": f"{oid}.png", "captured_at": "2026-11-07T00:00:00Z"} for oid in ("OBJ-0001", "OBJ-0002", "OBJ-0003")}}))
        (derived / "scene_objects.json").write_text(json.dumps({"objects": [
            {"object_id": "OBJ-0001", "class": "pump", "features": {"dims_m": {"width": 0.4, "depth": 0.3, "height": 0.5}},
             "height_above_floor_m": {"bottom": 0.2, "top": 0.7}},
            {"object_id": "OBJ-0002", "class": "other"}, {"object_id": "OBJ-0003", "class": "other"}]}))
        seen: list[str] = []

        def stub(image: bytes, context: str) -> dict[str, Any]:
            seen.append(context)
            if "pump" in context:
                return {"class": "valve", "confidence": 0.82, "short_description": "Handwheel valve"}
            if len(seen) == 2:
                return {"class": "spaceship", "confidence": 0.99, "short_description": "?"}
            raise RuntimeError("timeout")

        result = run(derived, stub, "stub")
        labels = result["labels"]
        assert labels["OBJ-0001"] == {**labels["OBJ-0001"], "class": "valve", "confidence": 0.82, "needs_review": False}
        assert labels["OBJ-0002"]["class"] == "other" and labels["OBJ-0002"]["needs_review"], "off-list class must fall back"
        assert "OBJ-0003" in result["errors"] and "OBJ-0003" not in labels
        assert "size 0.40 x 0.30 x 0.50 m" in seen[0] and "bottom 0.20 m" in seen[0]
        assert json.loads((derived / "vlm_labels.json").read_text())["threshold"] == THRESHOLD
        assert not (derived / "labels_override.json").exists(), "the VLM must never write overrides"
    print("label_vlm selftest ok: enum fallback, threshold, per-crop errors, no override writes")


def main() -> None:
    parser = argparse.ArgumentParser(description="Optional VLM suggestions for crop-tour images (never human labels).")
    parser.add_argument("--derived", default="data/derived")
    parser.add_argument("--limit", type=int, default=None, help="classify at most N crops")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    derived = Path(args.derived)
    if not (derived / "crops" / "index.json").exists():
        print("No crops yet: run the crop tour in the viewer's review mode first (data/derived/crops/index.json).")
        return
    classify = openai_classifier()
    if classify is None:
        print("OPENAI_API_KEY is not set; skipping VLM labelling. The review queue uses the heuristic labels instead.")
        return
    result = run(derived, classify, _model(), args.limit)
    flagged = sum(v["needs_review"] for v in result["labels"].values())
    print(f"wrote {len(result['labels'])} suggestions ({flagged} below {THRESHOLD}) and {len(result['errors'])} errors to {derived / 'vlm_labels.json'}")
    if result["errors"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
