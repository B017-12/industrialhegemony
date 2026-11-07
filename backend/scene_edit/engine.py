"""Scene state after an edit log: moved splats, moved boxes, rails grid, Nav. Feasibility preview and replan.

All grid maths in the pipeline world frame (PLY units); distances reported to the UI are converted to metres
with MPU. Rails follow the team rule (left = right obstacle distance at every body band) via pipeline.rails."""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize

from backend.scene_edit.geometry import (FLOOR_SKIP, MPU, box_from_world_aabb, footprint_distance, inside,
                                         moved_obj, transform_points, world_box)
from pipeline.common import DERIVED, WEB_ASSETS, read_json
from pipeline.navigate import STAND_MAX, STAND_OFF, Nav, clearance_profile, route
from pipeline.rails import BODY_BANDS, CELL, build_grids, skeleton_polylines

FRONT_ENTRY_W = np.array([2.90541, -2.09514])  # nav.json start_pose 'front_entry' (raw x, raw z) -> world xz
BAND_LO, BAND_HI = 0.06, 1.8  # body envelope above the floor
VOXEL = 0.05
OVERLAP_BLOCK, OVERLAP_WARN = 0.12, 0.03
OUTSIDE_BLOCK = 0.25
NARROW_WARN_M = 0.08
DETOUR_WARN = 0.25
MAX_GAP_STEPS = 40
GAP_CLUTTER = 0.12  # PLY units (~15 cm): lower stuff is floor clutter, not an obstacle for gap labels
_LOCK = threading.Lock()


@lru_cache(maxsize=1)
def base() -> tuple[np.ndarray, float, dict]:
    xyz = np.load(DERIVED / "splats_clean.npz")["xyz"].astype(np.float32)
    floor_y = float(read_json(DERIVED / "transform.json")["floor_y"])
    objs = {o["object_id"]: o for o in read_json(WEB_ASSETS / "derived" / "scene_objects.json")["objects"]}
    return xyz, floor_y, objs


@lru_cache(maxsize=1)
def movables() -> dict[str, dict]:
    """Hand-verified whole, freestanding objects (public/assets/derived/movables.json) as synthetic boxes."""
    doc = read_json(WEB_ASSETS / "derived" / "movables.json")
    out = {}
    for m in doc["items"]:
        parts = [(p["min"], p["max"]) for p in m.get("parts_world", [])] or None
        if parts:
            lo = np.min([p[0] for p in parts], axis=0).tolist()
            hi = np.max([p[1] for p in parts], axis=0).tolist()
        else:
            lo, hi = m["volume_world"]["min"], m["volume_world"]["max"]
        out[m["movable_id"]] = box_from_world_aabb(m["movable_id"], lo, hi, parts, label=m["label"], kind=m["kind"],
                                                   seed_object_ids=m["seed_object_ids"], note=m.get("note"))
    return out


def resolve(object_id: str) -> str | None:
    """Movable id for a movable id or for any segmentation box that belongs to a movable; None = fixed."""
    mv = movables()
    if object_id in mv:
        return object_id
    return next((k for k, m in mv.items() if object_id in m["seed_object_ids"]), None)


FIXED_REASON = ("fixed: not a whole freestanding object (part of a wall, pipework, plumbed equipment, or clutter "
                "that cannot be separated in the scan). Only the verified movables can be moved.")


@dataclass
class State:
    xyz: np.ndarray
    objs: dict
    grids: dict
    skeleton: np.ndarray
    nav: Nav
    movs: dict = field(default_factory=dict)  # movable_id -> current box
    stands: dict = field(default_factory=dict)  # asset_id -> stand xz or None


def _key(edits: list[dict]) -> str:
    core = [(e["object_id"], e["translate_world"], e["yaw_deg"]) for e in edits]
    return hashlib.sha1(json.dumps(core).encode()).hexdigest()


_STATES: OrderedDict[str, State] = OrderedDict()


def stand_point(nav: Nav, obj: dict) -> np.ndarray | None:
    idx, xz = nav.cells_xz()
    d = footprint_distance(xz, obj)
    ok = d <= STAND_MAX
    if not ok.any():
        return None
    score = (d[ok] - STAND_OFF) ** 2 - 0.05 * np.minimum(nav.effective[tuple(idx[ok].T)], 0.3)
    return xz[ok][np.argmin(score)]


def object_mask(xyz: np.ndarray, obj: dict, floor_y: float) -> np.ndarray:
    return inside(xyz, obj, margin=0.0) & (xyz[:, 1] - floor_y > FLOOR_SKIP)  # each splat -> one movable


def state(edits: list[dict]) -> State:
    k = _key(edits)
    with _LOCK:
        if k in _STATES:
            _STATES.move_to_end(k)
            return _STATES[k]
    xyz0, floor_y, objs0 = base()
    xyz, objs, movs = xyz0.copy(), dict(objs0), dict(movables())
    for e in edits:
        mid = e["object_id"]
        mv = movs[mid]
        t = np.array(e["translate_world"], dtype=float)
        yaw = np.deg2rad(e["yaw_deg"])
        pivot = world_box(mv)[0]
        m = object_mask(xyz, mv, floor_y)
        xyz[m] = transform_points(xyz[m], mv, t, yaw)
        movs[mid] = moved_obj(mv, t, yaw)
        for sid in mv["seed_object_ids"]:  # the segmentation boxes that belong to it follow
            objs[sid] = moved_obj(objs[sid], t, yaw, pivot)
    g = build_grids(xyz, floor_y)
    skel = skeletonize(g["walkable"])
    nav = Nav.from_grids(g, skel, floor_y, CELL)
    st = State(xyz, objs, g, skel, nav, movs)
    for o in objs.values():
        if o.get("asset_id"):
            st.stands[o["asset_id"]] = stand_point(nav, o)
    with _LOCK:
        _STATES[k] = st
        while len(_STATES) > 6:
            _STATES.popitem(last=False)
    return st


def start_xz(nav: Nav) -> np.ndarray:
    idx, xz = nav.cells_xz()
    return xz[np.argmin(np.linalg.norm(xz - FRONT_ENTRY_W, axis=1))]


def _voxels(p: np.ndarray) -> np.ndarray:
    v = np.floor(p / VOXEL).astype(np.int64) + 4096
    return (v[:, 0] << 26) | (v[:, 1] << 13) | v[:, 2]


def _band(p: np.ndarray, floor_y: float) -> np.ndarray:
    h = p[:, 1] - floor_y
    return (h >= BAND_LO) & (h < BAND_HI)


def _gaps(st: State, others: np.ndarray, moved: np.ndarray, floor_y: float) -> tuple[dict, float, np.ndarray]:
    """Clear distance (m) from the moved object's footprint to the nearest obstacle along +x, -x, +z, -z,
    using only obstacles at the heights the object occupies. Also the share of footprint outside the floor."""
    g = st.grids
    origin, shape, inside_floor = g["origin"], g["shape"], g["inside"]
    h_obj = moved[:, 1] - floor_y
    # obstacles: things at the heights the object occupies, ignoring flat floor clutter (cables, cloth)
    lo, hi = max(GAP_CLUTTER, float(h_obj.min())), min(BAND_HI, float(h_obj.max()) + 0.05)
    h_oth = others[:, 1] - floor_y
    sel = (h_oth >= lo) & (h_oth < max(hi, lo + 0.05))
    occ = np.zeros(shape, dtype=np.int32)
    ij = np.floor((others[sel][:, [0, 2]] - origin) / CELL).astype(int)
    ok = (ij >= 0).all(axis=1) & (ij[:, 0] < shape[0]) & (ij[:, 1] < shape[1])
    np.add.at(occ, tuple(ij[ok].T), 1)
    occ = (occ >= 3) | ~inside_floor
    fij = np.floor((moved[:, [0, 2]] - origin) / CELL).astype(int)
    fij = np.unique(np.clip(fij, 0, np.array(shape) - 1), axis=0)
    fp = np.zeros(shape, dtype=bool)
    fp[tuple(fij.T)] = True
    # a chair is legs + seat: fill the gaps between its parts so the footprint is one solid outline
    fp = ndimage.binary_fill_holes(ndimage.binary_closing(fp, structure=np.ones((3, 3)), iterations=3) | fp)
    fij = np.argwhere(fp)
    outside = float((~inside_floor[tuple(fij.T)]).mean())
    gaps = {}
    for name, d in {"+x": (1, 0), "-x": (-1, 0), "+z": (0, 1), "-z": (0, -1)}.items():
        best = MAX_GAP_STEPS
        for k in range(1, MAX_GAP_STEPS + 1):
            q = fij + np.array(d) * k
            valid = (q >= 0).all(axis=1) & (q[:, 0] < shape[0]) & (q[:, 1] < shape[1])
            if not valid.any():
                break
            qv = q[valid]
            hit = occ[tuple(qv.T)] & ~fp[tuple(qv.T)]
            if hit.any():
                best = k
                break
        gaps[name] = None if best == MAX_GAP_STEPS else round(max(0.0, (best - 1) * CELL) * MPU, 3)
    return gaps, outside, fp


def preview(edits: list[dict], cand: dict, target_asset_id: str | None = None) -> dict:
    xyz0, floor_y, _ = base()
    st0 = state(edits)
    mid = resolve(cand["object_id"])
    if mid is None:
        return {"verdict": "blocked", "fixed": True, "reasons": [FIXED_REASON]}
    obj = st0.movs[mid]
    t = np.array(cand["translate_world"], dtype=float)
    yaw = np.deg2rad(cand["yaw_deg"])
    m = object_mask(st0.xyz, obj, floor_y)
    reasons, warn, block = [], [], []
    if m.sum() < 10:
        return {"verdict": "blocked", "reasons": ["the object has (almost) no splats in the cleaned scan"],
                "object_points": int(m.sum())}
    own, others = st0.xyz[m], st0.xyz[~m]
    moved = transform_points(own, obj, t, yaw)

    # interpenetration: share of the object's occupied voxels already occupied by other splats (body heights)
    mv = moved[_band(moved, floor_y)]
    ov = others[_band(others, floor_y)]
    overlap = 0.0
    if len(mv):
        ok, oc = np.unique(_voxels(mv), return_counts=True)
        ok = ok[oc >= 2]
        tk, tc = np.unique(_voxels(ov), return_counts=True)
        tk = tk[tc >= 3]
        overlap = float(np.isin(ok, tk, assume_unique=True).mean()) if len(ok) else 0.0
    gaps, outside, _ = _gaps(st0, others, moved, floor_y)
    finite = [v for v in gaps.values() if v is not None]
    gaps["min"] = min(finite) if finite else None

    if overlap > OVERLAP_BLOCK:
        block.append(f"{overlap:.0%} of the object would sit inside other equipment")
    elif overlap > OVERLAP_WARN:
        warn.append(f"touches neighbouring equipment ({overlap:.0%} overlap)")
    if outside > OUTSIDE_BLOCK:
        block.append(f"{outside:.0%} of its footprint is outside the scanned floor (wall or unscanned area)")

    # navigation after the move
    st1 = state(edits + [{"object_id": mid, "translate_world": list(t), "yaw_deg": cand["yaw_deg"]}])
    before = {a for a, s in st0.stands.items() if s is not None}
    after = {a for a, s in st1.stands.items() if s is not None}
    lost = sorted(before - after)
    if lost:
        block.append(f"{len(lost)} asset(s) would become unreachable: {', '.join(lost)}")
    s0, s1 = start_xz(st0.nav), start_xz(st1.nav)
    if np.linalg.norm(s1 - s0) > 0.3:
        block.append("the entrance would be cut off from the rest of the room")
    fpx = moved[:, [0, 2]][:: max(1, len(moved) // 300)]
    aisle = _aisle(st1, fpx)
    aisle0 = _aisle(st0, fpx)
    if aisle is not None and aisle < NARROW_WARN_M and (aisle0 is None or aisle < aisle0 - 0.02):
        warn.append(f"walkway next to it narrows to {aisle:.2f} m spare clearance")
    route_delta = None
    if np.linalg.norm(s1 - s0) <= 0.3 and target_asset_id and st0.stands.get(target_asset_id) is not None and st1.stands.get(target_asset_id) is not None:
        l0 = _route_len(st0, target_asset_id)
        l1 = _route_len(st1, target_asset_id)
        if l0 and l1:
            route_delta = round((l1 - l0) * MPU, 2)
            if l1 > l0 * (1 + DETOUR_WARN):
                warn.append(f"route to {target_asset_id} gets {route_delta:+.2f} m longer")
    verdict = "blocked" if block else "warning" if warn else "allowed"
    reasons = block + warn or ["free space, all assets still reachable"]
    if route_delta is not None and abs(route_delta) > 0.2 and not any(target_asset_id in r for r in warn):
        reasons.append(f"route to {target_asset_id} changes by {route_delta:+.2f} m")
    return {"verdict": verdict, "reasons": reasons, "gaps_m": gaps,
            "gaps_band_m": [round(max(BAND_LO, float((moved[:, 1] - floor_y).min())) * MPU, 2),
                            round(min(BAND_HI, float((moved[:, 1] - floor_y).max())) * MPU, 2)],
            "overlap_frac": round(overlap, 3), "outside_floor_frac": round(outside, 3),
            "object_points": int(m.sum()), "movable_id": mid, "label": obj["label"],
            "aisle_spare_clearance_m": round(aisle, 3) if aisle is not None else None,
            "route_delta_m": route_delta, "unreachable_assets": lost,
            "moved_obb": st1.movs[mid]["obb"]}


def _aisle(st: State, fpx: np.ndarray) -> float | None:
    """Smallest spare body clearance (m) on rail cells within 0.8 units of the footprint."""
    sk = np.argwhere(st.skeleton)
    if not len(sk):
        return None
    near = np.min(np.linalg.norm(st.nav.to_xz(sk)[:, None, :] - fpx[None], axis=2), axis=1) < 0.8
    return float(st.nav.effective[tuple(sk[near].T)].min()) * MPU if near.any() else None


def _route_len(st: State, asset_id: str) -> float | None:
    xz = route(st.nav, start_xz(st.nav), st.stands[asset_id])
    return float(np.linalg.norm(np.diff(xz, axis=0), axis=1).sum()) if xz is not None else None


def replan(edits: list[dict], detail_asset_id: str | None = None) -> dict:
    """Routes from the front entry to every bound asset on the rebuilt rails, in nav_targets.json shape
    (ply_raw frame) so src/utils/pathfinding.js can use them unchanged."""
    xyz0, floor_y, _ = base()
    st = state(edits)
    s = start_xz(st.nav)
    raw = lambda x, z: [round(float(x), 4), round(-floor_y, 4), round(float(-z), 4)]  # noqa: E731
    targets = []
    for o in st.objs.values():
        a = o.get("asset_id")
        if not a:
            continue
        goal = st.stands.get(a)
        entry = {"asset_id": a, "object_id": o["object_id"], "display_label": o.get("display_label"),
                 "class": o.get("class"), "mapping_method": o.get("mapping_method"), "reachable": False,
                 "approach": None, "mission": None}
        xz = route(st.nav, s, goal) if goal is not None else None
        if xz is not None:
            length = float(np.linalg.norm(np.diff(xz, axis=0), axis=1).sum())
            eff = st.nav.effective[tuple(np.array([st.nav.to_cell(p) for p in xz]).T)]
            entry.update(reachable=True,
                         approach={"position": raw(*goal), "clearance_m": round(float(eff[-1]) * MPU, 3)},
                         mission={"path": [raw(x, z) for x, z in xz], "length_m": round(length * MPU, 2),
                                  "min_body_clearance_m": round(float(eff.min()) * MPU, 3)})
            if a == detail_asset_id:
                prof = clearance_profile(st.nav, xz)
                bind = np.array([abs(min(r[b]["left"] for b in BODY_BANDS) - min(r[b]["right"] for b in BODY_BANDS))
                                 for r in prof])
                entry["mission"]["lr_imbalance_m"] = {"median": round(float(np.median(bind)) * MPU, 3),
                                                      "p90": round(float(np.percentile(bind, 90)) * MPU, 3)}
        targets.append(entry)
    lines = skeleton_polylines(st.skeleton)
    rails = [[raw(*st.nav.to_xz(c)) for c in ln[:: max(1, len(ln) // 30)] + [ln[-1]]] for ln in lines if len(ln) >= 3]
    moved = {sid: st.objs[sid] for e in edits for sid in st.movs[e["object_id"]]["seed_object_ids"]}
    return {"schema_version": "1.0", "nav_version": "scene-edit-rails-1", "frame": "ply_raw",
            "planner": "equal-clearance rails (pipeline.rails + pipeline.navigate)", "metres_per_unit": MPU,
            "start_pose": {"position": raw(*s), "name": "front_entry"}, "n_edits": len(edits),
            "targets": targets, "rails": rails,
            "movables": list(st.movs.values()),
            "overrides": {k: {"obb": v["obb"], "center": v["center"], "aabb_min": v["aabb_min"],
                              "aabb_max": v["aabb_max"]} for k, v in moved.items()},
            "summary": {"reachable": sum(t["reachable"] for t in targets), "assets": len(targets),
                        "walkable_area_m2": round(float(st.grids["walkable"].sum()) * (CELL * MPU) ** 2, 2)}}
