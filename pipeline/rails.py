"""Stage 5 — rails: equal-clearance centreline graph shared by robots and people.

Rule (team requirement): at every body height band, the nearest obstacle on the left and on the
right must be equally far from that part of the body. Construction:

  1. per height band: 2D occupancy (CELL m) from all splats in the band; outside the scanned
     floor counts as occupied
  2. body clearance per band = distance to nearest occupied cell − body half-width at that band
  3. effective clearance = min over bands; walkable = effective clearance > MIN_CLEARANCE
  4. rails = skeleton (medial axis) of the walkable area: by construction every rail cell is
     equidistant from the nearest obstacles on both sides

Outputs: data/derived/nav_grid.npz (grids for navigate), public/assets/rails.json (polylines),
renders/rails_top.png
"""

from __future__ import annotations

import argparse

import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize

from pipeline.common import DERIVED, WEB_ASSETS, read_json, write_json
from pipeline.segment import floor_footprint
from pipeline import render

CELL = 0.05
OCC_MIN_POINTS = 3
MIN_CLEARANCE = 0.03
# (band_bottom, band_top, body_half_width) above the floor; union envelope of a person and the AMR robot
BODY_BANDS = {
    "feet": (0.06, 0.45, 0.22),
    "hips": (0.45, 1.00, 0.26),
    "torso": (1.00, 1.45, 0.27),
    "head": (1.45, 1.80, 0.20),
}


def build_grids(xyz: np.ndarray, floor_y: float) -> dict:
    fp, fp_origin = floor_footprint(xyz, floor_y)
    # navigation grid covers the footprint bounding box at CELL resolution
    fp_idx = np.argwhere(fp)
    lo = fp_origin + fp_idx.min(axis=0) * 0.05 - 0.2
    hi = fp_origin + (fp_idx.max(axis=0) + 1) * 0.05 + 0.2
    shape = np.ceil((hi - lo) / CELL).astype(int)

    centres = lo + (np.indices(shape).reshape(2, -1).T + 0.5) * CELL
    fp_ij = np.floor((centres - fp_origin) / 0.05).astype(int)
    ok = (fp_ij >= 0).all(axis=1) & (fp_ij[:, 0] < fp.shape[0]) & (fp_ij[:, 1] < fp.shape[1])
    inside = np.zeros(len(centres), dtype=bool)
    inside[ok] = fp[fp_ij[ok, 0], fp_ij[ok, 1]]
    inside = inside.reshape(shape)

    ij = np.floor((xyz[:, [0, 2]] - lo) / CELL).astype(int)
    valid = (ij >= 0).all(axis=1) & (ij[:, 0] < shape[0]) & (ij[:, 1] < shape[1])
    h = xyz[:, 1] - floor_y
    occ, clear = {}, {}
    for name, (b0, b1, half_w) in BODY_BANDS.items():
        sel = valid & (h >= b0) & (h < b1)
        counts = np.zeros(shape, dtype=np.int32)
        np.add.at(counts, tuple(ij[sel].T), 1)
        o = (counts >= OCC_MIN_POINTS) | ~inside
        occ[name] = o
        clear[name] = ndimage.distance_transform_edt(~o) * CELL - half_w
    effective = np.min(np.stack(list(clear.values())), axis=0)
    walkable = (effective > MIN_CLEARANCE) & inside
    lab, n = ndimage.label(walkable, structure=np.ones((3, 3)))
    if n > 1:
        walkable = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
    return {"origin": lo, "shape": shape, "inside": inside, "occ": occ, "clear": clear,
            "effective": effective, "walkable": walkable}


def skeleton_polylines(skel: np.ndarray) -> list[list[tuple[int, int]]]:
    """Break a skeleton into polylines between junctions/endpoints (8-connectivity)."""
    nbr = ndimage.convolve(skel.astype(np.uint8), np.ones((3, 3), dtype=np.uint8), mode="constant") - skel
    nbr = nbr * skel
    nodes = skel & (nbr != 2)
    visited = np.zeros_like(skel)
    offsets = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    lines = []

    def neighbours(p):
        for di, dj in offsets:
            q = (p[0] + di, p[1] + dj)
            if 0 <= q[0] < skel.shape[0] and 0 <= q[1] < skel.shape[1] and skel[q]:
                yield q

    for start in map(tuple, np.argwhere(nodes)):
        for q in neighbours(start):
            if visited[q] and not nodes[q]:
                continue
            line, prev, cur = [start], start, q
            while True:
                line.append(cur)
                if nodes[cur]:
                    break
                visited[cur] = True
                nxt = [r for r in neighbours(cur) if r != prev and r not in line[-3:]]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
            if len(line) >= 2 and (line[0], line[-1]) not in {(l[-1], l[0]) for l in lines}:
                lines.append(line)
    return lines


def rails() -> dict:
    tf = read_json(DERIVED / "transform.json")
    data = np.load(DERIVED / "splats_clean.npz")
    g = build_grids(data["xyz"], tf["floor_y"])
    skel = skeletonize(g["walkable"])
    lines = skeleton_polylines(skel)
    origin = g["origin"]

    def to_world(cell):
        x, z = origin + (np.array(cell) + 0.5) * CELL
        return [round(float(x), 3), round(tf["floor_y"], 3), round(float(z), 3)]

    polylines = []
    for k, line in enumerate(lines):
        if len(line) < 3:
            continue
        clearance = [float(g["effective"][c]) for c in line]
        polylines.append({
            "rail_id": f"RAIL-{k + 1:03d}",
            "points": [to_world(c) for c in line[:: max(1, len(line) // 40)]] + [to_world(line[-1])],
            "length_m": round(len(line) * CELL, 2),
            "min_body_clearance_m": round(min(clearance), 3),
        })

    np.savez_compressed(
        DERIVED / "nav_grid.npz",
        origin=origin, cell=CELL, floor_y=tf["floor_y"], inside=g["inside"], walkable=g["walkable"],
        effective=g["effective"], skeleton=skel,
        **{f"occ_{k}": v for k, v in g["occ"].items()}, **{f"clear_{k}": v for k, v in g["clear"].items()},
    )
    out = {
        "frame": "world, y up; points on the floor plane",
        "cell_m": CELL,
        "body_bands": {k: {"from_m": v[0], "to_m": v[1], "half_width_m": v[2]} for k, v in BODY_BANDS.items()},
        "walkable_area_m2": round(float(g["walkable"].sum() * CELL**2), 2),
        "rail_length_m": round(float(skel.sum() * CELL), 2),
        "rails": polylines,
    }
    write_json(WEB_ASSETS / "rails.json", out)
    _render(g, skel, tf, data)
    return out


def _render(g, skel, tf, data) -> None:
    from PIL import Image

    walk = g["walkable"]
    img = np.zeros(walk.shape + (3,), dtype=np.uint8)
    img[g["inside"]] = (60, 30, 30)
    img[g["occ"]["hips"] & g["inside"]] = (150, 60, 60)
    img[walk] = (40, 90, 50)
    img[skel] = (250, 230, 60)
    # image: rows = z, cols = x, same orientation as render_top (right = +x, down = +z)
    Image.fromarray(img.transpose(1, 0, 2)).resize((walk.shape[0] * 3, walk.shape[1] * 3), Image.NEAREST).save(
        DERIVED / "renders" / "rails_top.png")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.parse_args()
    r = rails()
    print(f"rails: walkable={r['walkable_area_m2']} m², rail length={r['rail_length_m']} m, polylines={len(r['rails'])}")


if __name__ == "__main__":
    main()
