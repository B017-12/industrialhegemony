"""Stage 4 — label: give every segmented object a class + explicit label confidence.

v0 is a transparent geometric/colour heuristic (size, height above floor, elongation, colour),
deliberately reported with modest confidence. It also renders a thumbnail per object
(data/derived/thumbs/OBJ-xxx.png) for the optional VLM pass (Gemini picks from VOCAB).

Per DOC-3D-MAPPING, identity is never silently guessed: every label carries `label_source`
and `label_confidence`.
"""

from __future__ import annotations

import argparse

import numpy as np

from pipeline.common import DERIVED, read_json, write_json
from pipeline import render

VOCAB = [
    "pipe_run", "ceiling_pipe", "vertical_pipe", "pressure_vessel", "storage_tank", "pump",
    "motor", "valve_assembly", "instrument", "electrical_cabinet", "control_panel", "shelving_rack",
    "wire_trolley", "hand_truck", "ladder", "chair", "crate", "cardboard_box", "bucket_or_bin",
    "cable_reel", "sink", "door", "clutter",
]


def _hsv(rgb: np.ndarray) -> tuple[float, float, float]:
    r, g, b = rgb
    mx, mn = max(rgb), min(rgb)
    v = mx
    s = 0.0 if mx == 0 else (mx - mn) / mx
    if mx == mn:
        h = 0.0
    elif mx == r:
        h = (60 * (g - b) / (mx - mn)) % 360
    elif mx == g:
        h = 60 * (b - r) / (mx - mn) + 120
    else:
        h = 60 * (r - g) / (mx - mn) + 240
    return h, s, v


def heuristic_label(o: dict, room_height: float) -> tuple[str, float, str]:
    """Return (class, confidence, reason)."""
    w, h, d = o["extents"]
    footprint_max, footprint_min = max(w, d), min(w, d)
    bottom, top = o["height_above_floor"]
    hue, sat, val = _hsv(o["mean_rgb"])
    red = sat > 0.35 and (hue < 20 or hue > 340)
    blue = sat > 0.3 and 190 < hue < 250
    near_ceiling = top > room_height - 0.35
    long_thin = footprint_max > 0.8 and footprint_min < 0.25 and h < 0.4

    if near_ceiling and bottom > room_height * 0.55 and (long_thin or h < 0.45):
        return "ceiling_pipe", 0.55, "elongated, hangs just below the ceiling"
    if h > 0.9 and footprint_max < 0.3:
        return "vertical_pipe", 0.45, "tall and slender"
    if long_thin:
        return "pipe_run", 0.45, "long horizontal and thin"
    if red and h > 0.6 and o["touches_floor"] and footprint_max > 0.35:
        return "pressure_vessel", 0.6, "large red body standing on the floor (expansion vessel colour)"
    if blue and h > 0.6 and footprint_max > 0.3:
        return "storage_tank", 0.55, "large blue body"
    if h > 1.2 and footprint_max > 0.8 and footprint_min < 0.6:
        return "shelving_rack", 0.4, "tall, wide and shallow"
    if h > 0.9 and footprint_min < 0.35 and not o["touches_floor"]:
        return "electrical_cabinet", 0.35, "tall flat box off the floor (wall-mounted)"
    if o["touches_floor"] and 0.5 < h < 1.3 and footprint_max > 0.5:
        return "wire_trolley", 0.3, "medium floor-standing open frame"
    if o["touches_floor"] and h < 0.6 and footprint_max < 0.8:
        if red:
            return "crate", 0.45, "small red box on the floor"
        return "pump", 0.3, "compact floor-mounted body"
    if not o["touches_floor"] and footprint_max < 0.45 and h < 0.5:
        return "valve_assembly" if bottom < room_height * 0.6 else "instrument", 0.3, "small item mounted off the floor"
    return "clutter", 0.2, "no rule matched"


def label(thumbs: bool = True) -> dict:
    tf = read_json(DERIVED / "transform.json")
    seg = read_json(DERIVED / "objects.json")
    room_height = tf["room_height"]
    data = np.load(DERIVED / "splats_clean.npz") if thumbs else None
    counts: dict[str, int] = {}
    for o in seg["objects"]:
        cls, conf, reason = heuristic_label(o, room_height)
        o.update({"class": cls, "label_confidence": conf, "label_source": "heuristic_v0", "label_reason": reason})
        counts[cls] = counts.get(cls, 0) + 1
        if thumbs:
            _thumbnail(o, data["xyz"], data["rgb"])
    seg["label_counts"] = dict(sorted(counts.items(), key=lambda kv: -kv[1]))
    write_json(DERIVED / "objects.json", seg)
    return seg


def _thumbnail(o: dict, xyz: np.ndarray, rgb: np.ndarray, size: int = 320) -> None:
    """Object points in full colour, 0.5 m of context dimmed; viewed from the object's open side."""
    c = np.array(o["center"])
    half = np.array(o["extents"]) / 2
    ca, sa = np.cos(o["yaw"]), np.sin(o["yaw"])
    rel = xyz - c
    local = np.column_stack([rel[:, 0] * ca + rel[:, 2] * sa, rel[:, 1], -rel[:, 0] * sa + rel[:, 2] * ca])
    inside = np.all(np.abs(local) <= half + 0.04, axis=1)
    context = np.all(np.abs(local) <= half + 0.5, axis=1) & ~inside
    pts = np.vstack([xyz[context], xyz[inside]])
    cols = np.vstack([rgb[context] * 0.35, rgb[inside]])
    r = float(np.linalg.norm(half)) + 0.2
    best = None
    for k in range(4):  # pick the side with the fewest occluding context points
        ang = o["yaw"] + k * np.pi / 2
        eye = c + np.array([np.cos(ang), 0.45, np.sin(ang)]) * (r * 2.0 + 0.3)
        to_c = c - eye
        occl = int((np.linalg.norm(np.cross(xyz[context] - eye, to_c / np.linalg.norm(to_c)), axis=1) < r).sum())
        if best is None or occl < best[0]:
            best = (occl, eye)
    img = render.render_perspective(pts, cols, eye=best[1], target=c, width=size, height=size, fov_deg=45, point_px=3)
    render.save(img, DERIVED / "thumbs" / f"{o['object_id']}.png")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--no-thumbs", action="store_true")
    args = ap.parse_args()
    seg = label(thumbs=not args.no_thumbs)
    print(f"label: {len(seg['objects'])} objects -> {seg['label_counts']}")


if __name__ == "__main__":
    main()
