"""Frame manifest (public/assets/vision/frames.json) plus human annotations (annotations.json): region lookup,
crops, sharpness, and which frames were captured near a 3D object."""

from __future__ import annotations

import io
import json
import threading
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from pipeline.common import WEB_ASSETS

VISION = WEB_ASSETS / "vision"
MANIFEST = VISION / "frames.json"
ANNOTATIONS = VISION / "annotations.json"
SCENE_OBJECTS = WEB_ASSETS / "derived" / "scene_objects.json"
_LOCK = threading.Lock()


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text())


def load_annotations() -> dict:
    if ANNOTATIONS.exists():
        return json.loads(ANNOTATIONS.read_text())
    return {"schema_version": 1, "regions": {}, "user_regions": []}


def save_annotations(doc: dict) -> None:
    with _LOCK:
        tmp = ANNOTATIONS.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, indent=1))
        tmp.replace(ANNOTATIONS)


def merged_frames() -> list[dict]:
    """Manifest frames with human links/labels and user-drawn regions applied."""
    man, ann = load_manifest(), load_annotations()
    frames = []
    for f in man["frames"]:
        regs = []
        for r in f["regions"] + [u for u in ann["user_regions"] if u["frame_id"] == f["frame_id"]]:
            r = {k: v for k, v in r.items() if k != "frame_id"}
            a = ann["regions"].get(r["region_id"], {})
            if a.get("link"):
                r.update(object_id=a["link"].get("object_id"), asset_id=a["link"].get("asset_id"),
                         link_method="technician_confirmed", link_confidence=0.9)
            if a.get("gt"):
                r["gt"] = a["gt"]
            regs.append(r)
        frames.append({**f, "regions": regs})
    return frames


def frame(frame_id: str) -> dict | None:
    return next((f for f in merged_frames() if f["frame_id"] == frame_id), None)


def region(region_id: str) -> tuple[dict, dict] | None:
    for f in merged_frames():
        for r in f["regions"]:
            if r["region_id"] == region_id:
                return f, r
    return None


def image_path(f: dict) -> Path:
    return WEB_ASSETS.parent / f["file"].lstrip("/")


def crop(f: dict, bbox: list[int], pad_frac: float = 0.35, min_side: int = 448) -> Image.Image:
    img = Image.open(image_path(f)).convert("RGB")
    x1, y1, x2, y2 = bbox
    pad = pad_frac * max(x2 - x1, y2 - y1)
    box = (max(0, int(x1 - pad)), max(0, int(y1 - pad)), min(img.width, int(x2 + pad)), min(img.height, int(y2 + pad)))
    c = img.crop(box)
    s = min_side / min(c.size)
    if s > 1:
        c = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
    d = ImageDraw.Draw(c)
    k = c.width / (box[2] - box[0])
    d.rectangle([(x1 - box[0]) * k, (y1 - box[1]) * k, (x2 - box[0]) * k, (y2 - box[1]) * k],
                outline=(255, 220, 0), width=3)
    return c


def context(f: dict, bbox: list[int], width: int = 896) -> Image.Image:
    img = Image.open(image_path(f)).convert("RGB")
    d = ImageDraw.Draw(img)
    d.rectangle(bbox, outline=(255, 220, 0), width=4)
    return img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)


def jpeg(img: Image.Image, quality: int = 90) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def sharpness(f: dict, bbox: list[int]) -> float:
    """Variance of the 4-neighbour Laplacian over the (unpadded) box, at native frame resolution."""
    img = Image.open(image_path(f)).convert("L").crop(tuple(bbox))
    g = np.asarray(img, dtype=np.float32)
    if min(g.shape) < 3:
        return 0.0
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())


@lru_cache(maxsize=1)
def scene_objects() -> dict[str, dict]:
    return {o["object_id"]: o for o in json.loads(SCENE_OBJECTS.read_text())["objects"]}


def frames_near_object(object_id: str, radius_m: float = 2.5) -> list[dict]:
    """Frames whose camera centre is within radius of the object's OBB centre (orientation unknown)."""
    objs = scene_objects()
    o = objs.get(object_id)
    if not o:
        return []
    mpu = 1.2374
    c = np.array(o["obb"]["center"])
    out = []
    for f in merged_frames():
        cam = (f.get("camera") or {}).get("centre_raw")
        if not cam:
            continue
        d = float(np.linalg.norm(np.array(cam) - c) * mpu)
        if d <= radius_m:
            out.append({"frame_id": f["frame_id"], "distance_m": round(d, 2)})
    return sorted(out, key=lambda r: r["distance_m"])
