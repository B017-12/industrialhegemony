"""Project scene objects (ply_raw OBBs) into the video frames that see them best.

Uses the COLMAP poses of _analysis/sfm_full/undist and the similarity in data/derived/splat_alignment.json,
so the boxes land on the real photos the splat was trained from.

    python3 _analysis/project_objects.py OBJ-0012 OBJ-0040 --out data/derived/diagnostics/evidence
    python3 _analysis/project_objects.py --classes motor pump --out ...   # contact sheet per class
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from colmap_io import read_cameras, read_images  # noqa: E402

UNDIST = Path("_analysis/sfm_full/undist")
EDGES = [(0, 1), (1, 3), (3, 2), (2, 0), (4, 5), (5, 7), (7, 6), (6, 4), (0, 4), (1, 5), (2, 6), (3, 7)]


def corners(obj: dict) -> np.ndarray:
    obb = obj["obb"]
    c, e, r = np.array(obb["center"]), np.array(obb["extent"]) / 2, np.array(obb["rotation"])
    signs = np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
    return c + (signs * e) @ r.T


class Views:
    def __init__(self, alignment: Path):
        al = json.loads(alignment.read_text())
        self.s, self.R, self.t = al["scale"], np.array(al["rotation"]), np.array(al["translation"])
        self.cams = read_cameras(UNDIST / "sparse/0/cameras.bin")
        self.images = sorted(read_images(UNDIST / "sparse/0/images.bin").values(), key=lambda im: im["name"])

    def project(self, im: dict, X_raw: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Pixels and depth (ply_raw units) of ply_raw points in image `im`."""
        X_colmap = (X_raw - self.t) @ self.R / self.s
        xc = X_colmap @ im["R"].T + im["t"]
        fx, fy, cx, cy = self.cams[im["camera_id"]]["params"]
        z = xc[:, 2]
        uv = np.column_stack([fx * xc[:, 0] / z + cx, fy * xc[:, 1] / z + cy])
        return uv, z * self.s

    def best(self, obj: dict, k: int = 2) -> list[tuple[float, dict, np.ndarray]]:
        pts = corners(obj)
        centre = np.array(obj["obb"]["center"])[None]
        scored = []
        for im in self.images:
            cam = self.cams[im["camera_id"]]
            uv, z = self.project(im, np.vstack([centre, pts]))
            if (z <= 0.05).any():
                continue
            w, h = cam["width"], cam["height"]
            c = uv[0]
            if not (0.1 * w < c[0] < 0.9 * w and 0.1 * h < c[1] < 0.9 * h):
                continue
            box = uv[1:]
            size = np.ptp(box, 0)
            if size.max() > 0.9 * max(w, h):
                continue
            centred = 1 - np.linalg.norm((c - [w / 2, h / 2]) / [w / 2, h / 2]) / 1.42
            score = centred + min(size.max() / (0.35 * w), 1.0) - 0.1 * z[0]
            scored.append((score, im, uv))
        scored.sort(key=lambda s: -s[0])
        picked = []
        for s in scored:  # spread the picks over the video
            if all(abs(self.images.index(s[1]) - self.images.index(p[1])) > 15 for p in picked):
                picked.append(s)
            if len(picked) == k:
                break
        return picked


def draw(view: Views, obj: dict, picks: list, colour=(0, 255, 255)) -> list[np.ndarray]:
    tiles = []
    for score, im, uv in picks:
        img = cv2.imread(str(UNDIST / "images" / im["name"]))
        box = uv[1:].astype(int)
        for a, b in EDGES:
            cv2.line(img, tuple(box[a]), tuple(box[b]), colour, 3, cv2.LINE_AA)
        label = f"{obj['object_id']} {obj['class']} {obj.get('display_label') or ''}"[:70]
        cv2.rectangle(img, (0, 0), (img.shape[1], 44), (0, 0, 0), -1)
        cv2.putText(img, f"{label} | {im['name']}", (10, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
        tiles.append(img)
    return tiles


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("objects", nargs="*")
    ap.add_argument("--classes", nargs="*", default=None)
    ap.add_argument("--scene", default="data/derived/scene_objects.json")
    ap.add_argument("--alignment", default="data/derived/splat_alignment.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--k", type=int, default=2)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    scene = json.loads(Path(args.scene).read_text())
    objs = [o for o in scene["objects"] if o.get("obb") and (o["object_id"] in args.objects or (args.classes and o["class"] in args.classes))]
    view = Views(Path(args.alignment))
    index = {}
    for obj in objs:
        picks = view.best(obj, args.k)
        index[obj["object_id"]] = [p[1]["name"] for p in picks]
        tiles = draw(view, obj, picks)
        if tiles:
            sheet = np.hstack([cv2.resize(t, (800, 450)) for t in tiles])
            cv2.imwrite(str(out / f"{obj['object_id']}.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 85])
        print(obj["object_id"], obj["class"], obj.get("asset_id"), index[obj["object_id"]])
    (out / "index.json").write_text(json.dumps(index, indent=1))


if __name__ == "__main__":
    main()
