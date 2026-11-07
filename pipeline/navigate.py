"""Stage 7 — navigate: route along the rails to a target object, verify it, build the proximity timeline.

Routing is a minimum-cost path on the walkable grid (skimage MCP, 8-connected, geometric) with
cost = 1 + RAIL_PULL * distance_to_rail + CLEARANCE_PULL / clearance. The rail pull keeps the avatar
on the equal-clearance centreline; it only leaves it on the short spur to the stand-point in front of
the target. Every output sample is checked against the walkable grid and every object box.

Library functions (used by map.py): load_nav(), stand_point(), route().
Main: reads registry.json, routes to the faulty target, writes public/assets/path.json + timeline.json.
"""

from __future__ import annotations

import argparse

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.graph import route_through_array

from pipeline.common import DERIVED, WEB_ASSETS, read_json, write_json
from pipeline.rails import BODY_BANDS

RAIL_PULL = 6.0
CLEARANCE_PULL = 0.05
STAND_OFF = 0.35  # preferred distance from the object's box to the avatar's centre
STAND_MAX = 1.1
WALK_SPEED = 0.6  # m/s
PROXIMITY_RADIUS = 1.5
SAMPLE_STEP = 0.1


class Nav:
    def __init__(self, path=DERIVED / "nav_grid.npz"):
        g = np.load(path)
        self.origin, self.cell, self.floor_y = g["origin"], float(g["cell"]), float(g["floor_y"])
        self.walkable, self.effective, self.skeleton = g["walkable"], g["effective"], g["skeleton"]
        self.occ = {k: g[f"occ_{k}"] for k in BODY_BANDS}
        d_rail = ndimage.distance_transform_edt(~self.skeleton) * self.cell
        cost = 1.0 + RAIL_PULL * d_rail + CLEARANCE_PULL / np.maximum(self.effective, 0.03)
        cost[~self.walkable] = np.inf
        self.cost = cost

    def to_cell(self, xz) -> tuple[int, int]:
        ij = np.floor((np.asarray(xz) - self.origin) / self.cell).astype(int)
        return int(ij[0]), int(ij[1])

    def to_xz(self, ij) -> np.ndarray:
        return self.origin + (np.asarray(ij, dtype=float) + 0.5) * self.cell

    def cells_xz(self) -> tuple[np.ndarray, np.ndarray]:
        idx = np.argwhere(self.walkable)
        return idx, self.to_xz(idx)


def box_footprint_distance(xz: np.ndarray, obj: dict) -> np.ndarray:
    """Distance from points (n,2) to the object's oriented footprint rectangle (0 inside)."""
    c = np.array([obj["center"][0], obj["center"][2]])
    ca, sa = np.cos(obj["yaw"]), np.sin(obj["yaw"])
    local = (xz - c) @ np.array([[ca, -sa], [sa, ca]])
    half = np.array([obj["extents"][0], obj["extents"][2]]) / 2
    q = np.abs(local) - half
    return np.linalg.norm(np.maximum(q, 0), axis=1)


def stand_point(nav: Nav, obj: dict) -> np.ndarray | None:
    idx, xz = nav.cells_xz()
    d = box_footprint_distance(xz, obj)
    ok = d <= STAND_MAX
    if not ok.any():
        return None
    score = (d[ok] - STAND_OFF) ** 2 - 0.05 * np.minimum(nav.effective[tuple(idx[ok].T)], 0.3)
    return xz[ok][np.argmin(score)]


def route(nav: Nav, start_xz, goal_xz) -> np.ndarray | None:
    s, g = nav.to_cell(start_xz), nav.to_cell(goal_xz)
    if not (nav.walkable[s] and nav.walkable[g]):
        return None
    cells, _ = route_through_array(nav.cost, s, g, fully_connected=True, geometric=True)
    xz = nav.to_xz(np.array(cells))
    return _smooth(nav, xz)


def _smooth(nav: Nav, xz: np.ndarray, iters: int = 3) -> np.ndarray:
    """Chaikin corner cutting, kept only where it stays on walkable cells; then resample."""
    pts = xz
    for _ in range(iters):
        q = 0.75 * pts[:-1] + 0.25 * pts[1:]
        r = 0.25 * pts[:-1] + 0.75 * pts[1:]
        cand = np.vstack([pts[:1], np.column_stack([q, r]).reshape(-1, 2), pts[-1:]])
        if all(nav.walkable[nav.to_cell(p)] for p in cand):
            pts = cand
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.arange(0, s[-1], SAMPLE_STEP)
    return np.column_stack([np.interp(np.append(t, s[-1]), s, pts[:, k]) for k in range(2)])


def clearance_profile(nav: Nav, xz: np.ndarray, radius: float = 2.5) -> list[dict]:
    """Per sample and band: nearest obstacle in the left and in the right half-plane (relative to the
    heading), minus the body half-width at that band. On the medial-axis rail these are equal."""
    tangent = np.gradient(xz, axis=0)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
    normal = np.column_stack([-tangent[:, 1], tangent[:, 0]])  # points to the left of the heading
    trees = {b: cKDTree(nav.to_xz(np.argwhere(nav.occ[b]))) for b in BODY_BANDS}
    out = []
    for p, n in zip(xz, normal):
        rec = {}
        for band, (_, _, half_w) in BODY_BANDS.items():
            tree = trees[band]
            idx = tree.query_ball_point(p, radius)
            pts = tree.data[idx] - p if idx else np.empty((0, 2))
            side = pts @ n
            dist = np.linalg.norm(pts, axis=1)
            left = dist[side > 0].min() if (side > 0).any() else radius
            right = dist[side < 0].min() if (side < 0).any() else radius
            rec[band] = {"left": round(float(left - half_w), 3), "right": round(float(right - half_w), 3)}
        out.append(rec)
    return out


def verify(nav: Nav, xz: np.ndarray, objects: list[dict], target_id: str | None) -> dict:
    """Collision proof at grid resolution: the body envelope never touches an occupied cell in any band.
    Box-footprint overlaps are reported for information only (boxes are loose bounds; sparse or
    L-shaped objects leave walkable gaps inside their box)."""
    on_walkable = all(nav.walkable[nav.to_cell(p)] for p in xz)
    band_hits = {}
    for band, (_, _, half_w) in BODY_BANDS.items():
        free = ndimage.distance_transform_edt(~nav.occ[band]) * nav.cell
        band_hits[band] = int(sum(free[nav.to_cell(p)] <= half_w for p in xz))
    inside_boxes = []
    for o in objects:
        if o["object_id"] == target_id or o["height_above_floor"][0] > 1.8:
            continue  # ceiling items are above the body envelope
        if (box_footprint_distance(xz, o) == 0).any():
            inside_boxes.append(o["object_id"])
    return {"all_samples_walkable": bool(on_walkable), "body_collisions_per_band": band_hits,
            "collision_free": bool(on_walkable and not any(band_hits.values())),
            "info_box_footprint_overlaps": inside_boxes}


def timeline(xz: np.ndarray, objects: list[dict], registry: dict) -> list[dict]:
    frames, active = [], set()
    by_obj = {e["object_id"]: e for e in registry.get("entries", [])}
    for i, p in enumerate(xz):
        near = []
        for o in objects:
            d = float(box_footprint_distance(p[None], o)[0])
            if d <= PROXIMITY_RADIUS:
                near.append((round(d, 2), o["object_id"]))
        ids = {oid for _, oid in near}
        frames.append({
            "i": i,
            "t": round(i * SAMPLE_STEP / WALK_SPEED, 2),
            "nearby": [{"object_id": oid, "distance_m": d, "asset_id": by_obj.get(oid, {}).get("asset_id")}
                       for d, oid in sorted(near)],
            "entered": sorted(ids - active),
            "left": sorted(active - ids),
        })
        active = ids
    return frames


def default_start(nav: Nav, goal_xz) -> np.ndarray:
    """Rail cell farthest (by walking cost) from the goal — a long, informative walk."""
    from skimage.graph import MCP_Geometric

    mcp = MCP_Geometric(nav.cost, fully_connected=True)
    costs, _ = mcp.find_costs([nav.to_cell(goal_xz)])
    rail = nav.skeleton & np.isfinite(costs)
    idx = np.argwhere(rail)
    return nav.to_xz(idx[np.argmax(costs[tuple(idx.T)])])


def navigate(start_xz=None) -> dict:
    nav = Nav()
    objects = read_json(DERIVED / "objects.json")["objects"]
    registry = read_json(WEB_ASSETS / "registry.json")
    target = registry["target"]
    obj = next(o for o in objects if o["object_id"] == target["object_id"])
    goal = np.array(target["stand_point_xz"])
    start = np.array(start_xz) if start_xz is not None else np.array(registry.get("start_xz") or default_start(nav, goal))
    xz = route(nav, start, goal)
    if xz is None:
        raise RuntimeError("no route to target")
    prof = clearance_profile(nav, xz)
    imbalance = np.array([[abs(r[b]["left"] - r[b]["right"]) for b in BODY_BANDS] for r in prof])
    binding = np.array([abs(min(r[b]["left"] for b in BODY_BANDS) - min(r[b]["right"] for b in BODY_BANDS)) for r in prof])
    min_clear = np.array([[min(r[b]["left"], r[b]["right"]) for b in BODY_BANDS] for r in prof])
    checks = verify(nav, xz, objects, obj["object_id"])
    y = nav.floor_y
    face = np.array([obj["center"][0], obj["center"][2]]) - xz[-1]
    path = {
        "target": target,
        "start_xz": start.round(3).tolist(),
        "length_m": round(float(len(xz) * SAMPLE_STEP), 2),
        "walk_speed_mps": WALK_SPEED,
        "points": [[round(float(p[0]), 3), round(y, 3), round(float(p[1]), 3)] for p in xz],
        "final_heading_rad": float(np.arctan2(face[1], face[0])),
        "clearance": prof,
        "metrics": {
            "binding_lr_imbalance_m": {"median": round(float(np.median(binding)), 3),
                                       "p90": round(float(np.percentile(binding, 90)), 3)},
            "median_lr_imbalance_m_per_band": dict(zip(BODY_BANDS, np.median(imbalance, axis=0).round(3).tolist())),
            "min_body_clearance_m_per_band": dict(zip(BODY_BANDS, min_clear.min(axis=0).round(3).tolist())),
        },
        "checks": checks,
    }
    write_json(WEB_ASSETS / "path.json", path)
    write_json(WEB_ASSETS / "timeline.json", {"radius_m": PROXIMITY_RADIUS, "sample_step_m": SAMPLE_STEP,
                                             "frames": timeline(xz, objects, registry)})
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--start", help="x,z world start (default: registry start or farthest rail point)")
    args = ap.parse_args()
    start = [float(v) for v in args.start.split(",")] if args.start else None
    p = navigate(start)
    print(f"navigate: {p['length_m']} m to {p['target']['tag']} ({p['target']['object_id']}), "
          f"checks={p['checks']}")
    print(f"  median |L-R| per band: {p['metrics']['median_lr_imbalance_m_per_band']}")
    print(f"  min body clearance per band: {p['metrics']['min_body_clearance_m_per_band']}")


if __name__ == "__main__":
    main()
