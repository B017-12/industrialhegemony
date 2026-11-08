"""Open-vocabulary 2D detection over the COLMAP-posed video frames (step 1 of the vision labelling).

Grounding DINO tiny proposes boxes for a fixed equipment vocabulary; CLIP re-scores each box on multi-scale
crops (tight, +10 %, +20 %, as in OpenMask3D). Results go to data/derived/vision/detections.json, written after
every frame so an interrupted run resumes where it stopped. pipeline/semantic.py lifts them onto the 3D objects.

Runs in .venv-vision (torch 2.2.2 is the last Intel-Mac build and needs numpy<2):

    .venv-vision/bin/python -m pipeline.detect2d                 # all frames, resumable
    .venv-vision/bin/python -m pipeline.detect2d --limit 20      # first 20 frames of the coverage order
    .venv-vision/bin/python -m pipeline.detect2d --detector owlv2
    python3 -m pipeline.detect2d --selftest                      # stub models, no torch needed
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

FRAMES = Path("_analysis/sfm_full/undist/images")
OUT = Path("data/derived/vision/detections.json")
SCHEMA_VERSION = "1.0"

# Prompt phrase -> app class. "other" phrases still name the object (display label) and give the voting a
# competing hypothesis, so a chair is not voted a pump just because nothing else fits.
VOCAB: dict[str, str] = {
    "circulator pump": "pump",
    "water pump": "pump",
    "electric motor": "motor",
    "valve": "valve",
    "valve handwheel": "valve",
    "pressure gauge": "gauge",
    "expansion tank": "tank",
    "pressure vessel": "tank",
    "electrical cabinet": "cabinet",
    "control panel": "cabinet",
    "ladder": "ladder",
    "hand truck": "trolley",
    "cart": "trolley",
    "cardboard box": "crate",
    "plastic crate": "crate",
    "pipe": "pipe",
    "chair": "other",
    "washing machine": "other",
    "sink": "other",
    "bucket": "other",
    "vacuum cleaner": "other",
    "table": "other",
}
BOX_THRESHOLD = 0.22
NMS_IOU = 0.5
MAX_AREA_FRACTION = 0.6

# (PIL image) -> [{"box": [x0, y0, x1, y1] px, "phrase": str, "score": float}]
Detector = Callable[[Any], list[dict[str, Any]]]
# (PIL image, [boxes]) -> [{phrase: prob}] per box
Verifier = Callable[[Any, list[list[float]]], list[dict[str, float]]]


def coverage_order(names: list[str], stride: int = 4) -> list[str]:
    """Every stride-th frame first, then the gaps, so a partial run already covers the whole video."""
    order: list[str] = []
    for offset in range(stride):
        order.extend(names[offset::stride])
    return order


def iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    x0, y0 = np.maximum(a[0], b[:, 0]), np.maximum(a[1], b[:, 1])
    x1, y1 = np.minimum(a[2], b[:, 2]), np.minimum(a[3], b[:, 3])
    inter = np.clip(x1 - x0, 0, None) * np.clip(y1 - y0, 0, None)
    area = lambda r: (r[..., 2] - r[..., 0]) * (r[..., 3] - r[..., 1])  # noqa: E731
    return inter / np.maximum(area(a) + area(b) - inter, 1e-9)


def class_nms(dets: list[dict[str, Any]], thr: float = NMS_IOU) -> list[dict[str, Any]]:
    keep: list[dict[str, Any]] = []
    for d in sorted(dets, key=lambda d: -d["score"]):
        same = [k for k in keep if k["class"] == d["class"]]
        if same and iou(np.array(d["box"]), np.array([k["box"] for k in same])).max() > thr:
            continue
        keep.append(d)
    return keep


def phrase_spans(tokenizer: Any, phrases: list[str]) -> tuple[str, list[tuple[int, int]]]:
    """Caption 'a. b. c.' and the token span of each phrase in its input_ids (CLS offset included)."""
    text = ". ".join(phrases) + "."
    spans, pos = [], 1
    for p in phrases:
        n = len(tokenizer(p, add_special_tokens=False).input_ids)
        spans.append((pos, pos + n))
        pos += n + 1  # the "." after each phrase
    return text, spans


def grounding_dino(model_id: str = "IDEA-Research/grounding-dino-tiny", short_side: int = 600) -> Detector:
    import torch
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    proc = AutoProcessor.from_pretrained(model_id)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id, use_safetensors=True).eval()
    phrases = list(VOCAB)
    text, spans = phrase_spans(proc.tokenizer, phrases)

    def detect(img: Any) -> list[dict[str, Any]]:
        inputs = proc(images=img, text=text, return_tensors="pt", size={"shortest_edge": short_side, "longest_edge": 1333})
        with torch.no_grad():
            out = model(**inputs)
        # Per-phrase score = best token of the phrase; the stock post-processing concatenates every token over
        # threshold into one label ("circulator pump electric motor"), which loses the class.
        probs = out.logits[0].sigmoid().numpy()
        scores = np.stack([probs[:, a:b].max(axis=1) for a, b in spans], axis=1)
        best = scores.argmax(axis=1)
        top = scores[np.arange(len(best)), best]
        w, h = img.size
        cxcywh = out.pred_boxes[0].numpy()
        dets = []
        for q in np.nonzero(top >= BOX_THRESHOLD)[0]:
            cx, cy, bw, bh = cxcywh[q]
            box = [float(np.clip((cx - bw / 2) * w, 0, w)), float(np.clip((cy - bh / 2) * h, 0, h)),
                   float(np.clip((cx + bw / 2) * w, 0, w)), float(np.clip((cy + bh / 2) * h, 0, h))]
            dets.append({"box": box, "phrase": phrases[int(best[q])], "score": float(top[q])})
        return dets

    return detect


def owlv2(model_id: str = "google/owlv2-base-patch16-ensemble") -> Detector:
    import torch
    from transformers import Owlv2ForObjectDetection, Owlv2Processor

    proc = Owlv2Processor.from_pretrained(model_id)
    model = Owlv2ForObjectDetection.from_pretrained(model_id, use_safetensors=True).eval()
    phrases = list(VOCAB)

    def detect(img: Any) -> list[dict[str, Any]]:
        inputs = proc(text=[[f"a photo of a {p}" for p in phrases]], images=img, return_tensors="pt")
        with torch.no_grad():
            out = model(**inputs)
        side = max(img.size)  # OWLv2 pads to a square
        res = proc.post_process_object_detection(out, threshold=0.15, target_sizes=torch.tensor([[side, side]]))[0]
        w, h = img.size
        return [{"box": [float(np.clip(v, 0, lim)) for v, lim in zip(b.tolist(), (w, h, w, h))], "phrase": phrases[int(l)], "score": float(s)}
                for b, s, l in zip(res["boxes"], res["scores"], res["labels"])]

    return detect


def clip_verifier(model_id: str = "laion/CLIP-ViT-B-32-laion2B-s34B-b79K") -> Verifier:
    import torch
    from transformers import CLIPModel, CLIPProcessor

    proc = CLIPProcessor.from_pretrained(model_id)
    model = CLIPModel.from_pretrained(model_id, use_safetensors=True).eval()
    phrases = list(VOCAB)
    with torch.no_grad():
        t = model.get_text_features(**proc(text=[f"a photo of a {p} in a boiler room" for p in phrases], return_tensors="pt", padding=True))
    text = t / t.norm(dim=-1, keepdim=True)

    def verify(img: Any, boxes: list[list[float]]) -> list[dict[str, float]]:
        if not boxes:
            return []
        w, h = img.size
        crops = []
        for x0, y0, x1, y1 in boxes:
            for grow in (0.0, 0.1, 0.2):
                dx, dy = (x1 - x0) * grow, (y1 - y0) * grow
                crops.append(img.crop((max(0, x0 - dx), max(0, y0 - dy), min(w, x1 + dx), min(h, y1 + dy))))
        with torch.no_grad():
            f = model.get_image_features(**proc(images=crops, return_tensors="pt"))
        f = f / f.norm(dim=-1, keepdim=True)
        f = f.reshape(len(boxes), 3, -1).mean(dim=1)
        f = f / f.norm(dim=-1, keepdim=True)
        p = (100.0 * f @ text.T).softmax(dim=-1).numpy()
        return [{ph: round(float(v), 4) for ph, v in zip(phrases, row) if v >= 0.01} for row in p]

    return verify


def clip_class_probs(clip: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for phrase, p in clip.items():
        cls = VOCAB.get(phrase)
        if cls:
            out[cls] = round(out.get(cls, 0.0) + p, 4)
    return out


def process_frame(img: Any, detect: Detector, verify: Verifier | None) -> list[dict[str, Any]]:
    w, h = img.size
    dets = []
    for d in detect(img):
        x0, y0, x1, y1 = d["box"]
        if (x1 - x0) * (y1 - y0) > MAX_AREA_FRACTION * w * h or x1 - x0 < 6 or y1 - y0 < 6:
            continue
        dets.append({**d, "class": VOCAB.get(d["phrase"], "other")})
    dets = class_nms(dets)
    if verify is not None:
        for d, clip in zip(dets, verify(img, [d["box"] for d in dets])):
            d["clip"] = clip_class_probs(clip)
    for d in dets:
        d["box"] = [round(v, 1) for v in d["box"]]
        d["score"] = round(d["score"], 4)
    return dets


def run(frames: Path, out_path: Path, detect: Detector, verify: Verifier | None, model: str, limit: int | None = None,
        log: Callable[[str], None] = print) -> dict[str, Any]:
    from PIL import Image

    names = sorted(p.name for p in frames.glob("*.jpg"))
    result: dict[str, Any] = {"frames": {}}
    if out_path.exists():
        result = json.loads(out_path.read_text(encoding="utf-8"))
        if result.get("model") != model or result.get("vocab") != VOCAB:
            log(f"{out_path} was made with another model or vocabulary; starting over")
            result = {"frames": {}}
    result.update({"schema_version": SCHEMA_VERSION, "model": model, "vocab": VOCAB, "frames_dir": str(frames),
                   "box_threshold": BOX_THRESHOLD})
    todo = [n for n in coverage_order(names) if n not in result["frames"]]
    if limit is not None:
        todo = todo[:limit]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    for k, name in enumerate(todo, 1):
        img = Image.open(frames / name).convert("RGB")
        result["frames"][name] = {"size": list(img.size), "detections": process_frame(img, detect, verify)}
        result["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        tmp = out_path.with_name(f".{out_path.name}.tmp")
        tmp.write_text(json.dumps(result) + "\n", encoding="utf-8")
        tmp.replace(out_path)
        rate = (time.perf_counter() - t0) / k
        log(f"[{len(result['frames'])}/{len(names)}] {name}: {len(result['frames'][name]['detections'])} boxes, "
            f"{rate:.1f} s/frame, ~{rate * (len(todo) - k) / 60:.0f} min left")
    return result


def selftest() -> None:
    import tempfile

    from PIL import Image

    with tempfile.TemporaryDirectory() as tmp:
        frames = Path(tmp) / "frames"
        frames.mkdir()
        for i in range(6):
            Image.new("RGB", (200, 100), (i * 20, 0, 0)).save(frames / f"frame_{i:05d}.jpg")
        calls: list[int] = []

        def stub_detect(img: Any) -> list[dict[str, Any]]:
            calls.append(1)
            return [
                {"box": [10, 10, 60, 60], "phrase": "circulator pump", "score": 0.5},
                {"box": [12, 12, 61, 61], "phrase": "water pump", "score": 0.4},  # same class, overlapping: suppressed
                {"box": [12, 12, 61, 61], "phrase": "electric motor", "score": 0.3},  # other class survives NMS
                {"box": [0, 0, 200, 100], "phrase": "cart", "score": 0.6},  # whole frame: dropped
            ]

        def stub_verify(img: Any, boxes: list[list[float]]) -> list[dict[str, float]]:
            return [{"circulator pump": 0.6, "water pump": 0.2, "valve": 0.2} for _ in boxes]

        out = Path(tmp) / "det.json"
        run(frames, out, stub_detect, stub_verify, "stub", limit=3, log=lambda s: None)
        assert len(json.loads(out.read_text())["frames"]) == 3
        res = run(frames, out, stub_detect, stub_verify, "stub", log=lambda s: None)
        assert len(calls) == 6, "a rerun must resume, not redo finished frames"
        dets = res["frames"]["frame_00000.jpg"]["detections"]
        assert [d["class"] for d in dets] == ["pump", "motor"], dets
        assert dets[0]["clip"] == {"pump": 0.8, "valve": 0.2}
        assert coverage_order([str(i) for i in range(8)], 4) == ["0", "4", "1", "5", "2", "6", "3", "7"]
    print("detect2d selftest ok: per-class NMS, area filter, CLIP class merge, resume, coverage order")


def main() -> None:
    ap = argparse.ArgumentParser(description="Open-vocabulary detection over the posed video frames.")
    ap.add_argument("--frames", default=str(FRAMES))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--detector", choices=["grounding-dino", "owlv2"], default="grounding-dino")
    ap.add_argument("--no-clip", action="store_true")
    ap.add_argument("--short-side", type=int, default=600)
    ap.add_argument("--threads", type=int, default=6)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return
    import torch

    torch.set_num_threads(args.threads)
    if args.detector == "owlv2":
        detect, model = owlv2(), "google/owlv2-base-patch16-ensemble"
    else:
        detect, model = grounding_dino(short_side=args.short_side), f"IDEA-Research/grounding-dino-tiny@{args.short_side}"
    verify = None if args.no_clip else clip_verifier()
    if verify is not None:
        model += "+clip-vit-b-32-laion2b"
    frames = Path(args.frames)
    if not frames.exists():
        sys.exit(f"{frames} not found (COLMAP undistorted frames from _analysis/sfm_full)")
    result = run(frames, Path(args.out), detect, verify, model, args.limit)
    print(f"{len(result['frames'])} frames in {args.out}")


if __name__ == "__main__":
    main()
