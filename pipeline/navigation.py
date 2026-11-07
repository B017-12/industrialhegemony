"""Floor navigation: occupancy grid, ESDF clearance cost, Theta*, smoothing and a timed motion profile.

Owned by Tab 3. All positions are raw PLY frame (y-down). Grid rows index z and columns index x;
cell (j, i) covers [x0 + i*cell, x0 + (i+1)*cell) x [z0 + j*cell, z0 + (j+1)*cell) and its centre is
at +0.5 cell. Distances in metres use the calibrated metres_per_unit from the structure step.
"""

from __future__ import annotations

import heapq
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import config  # noqa: F401  (sets MPLCONFIGDIR before matplotlib loads)

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from .config import SCHEMA_VERSION, TARGET_ASSET_ID

NAV_VERSION = "tab3-navigation-1"

PARAMS: dict[str, Any] = {
    "cell_units": 0.05,
    "obstacle_band_m": [0.12, 1.8],
    "floor_band_units": 0.05,
    "min_obstacle_splats": 3,
    "min_support_splats": 2,
    "robot_radius_m": 0.30,
    "inflation_margin_cells": 0.5,
    "cost_w": 4.0,
    "cost_sigma_m": 0.15,
    "start_band_units": 0.15,
    "standoff_m": 0.5,
    "standoff_tol_m": 0.15,
    "max_reach_m": 1.0,
    "approach_lead_m": 0.25,
    "v_max_mps": 0.35,
    "a_max_mps2": 0.25,
    "a_lat_mps2": 0.3,
    "turn_rate_dps": 60.0,
    "turn_acc_dps2": 120.0,
    "sample_dt_s": 0.1,
    "spline_step_units": 0.01,
    "path_step_units": 0.05,
}

NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

Cell = tuple[int, int]


# --------------------------------------------------------------------------- grid


@dataclass
class NavGrid:
    cell: float
    x0: float
    z0: float
    floor_y: float
    mpu: float
    blocked: np.ndarray
    support: np.ndarray
    free: np.ndarray
    walkable: np.ndarray
    esdf_m: np.ndarray
    cost: np.ndarray
    params: dict[str, Any]
    stats: dict[str, Any] = field(default_factory=dict)
    _tree: cKDTree | None = None

    @property
    def shape(self) -> tuple[int, int]:
        return self.blocked.shape  # type: ignore[return-value]

    def centre(self, j: Any, i: Any) -> tuple[Any, Any]:
        return self.x0 + (np.asarray(i) + 0.5) * self.cell, self.z0 + (np.asarray(j) + 0.5) * self.cell

    def cell_of(self, x: Any, z: Any) -> tuple[np.ndarray, np.ndarray]:
        j = np.floor((np.asarray(z) - self.z0) / self.cell).astype(int)
        i = np.floor((np.asarray(x) - self.x0) / self.cell).astype(int)
        return j, i

    def inside(self, j: int, i: int) -> bool:
        return 0 <= j < self.shape[0] and 0 <= i < self.shape[1]

    def walkable_at(self, xz: np.ndarray) -> np.ndarray:
        j, i = self.cell_of(xz[:, 0], xz[:, 1])
        ok = (j >= 0) & (j < self.shape[0]) & (i >= 0) & (i < self.shape[1])
        out = np.zeros(len(xz), dtype=bool)
        out[ok] = self.walkable[j[ok], i[ok]]
        return out

    def clearance_m(self, xz: np.ndarray) -> np.ndarray:
        """Exact distance in metres from each point to the nearest obstacle cell square."""
        if self._tree is None:
            bj, bi = np.nonzero(self.blocked)
            self._tree = cKDTree(np.column_stack(self.centre(bj, bi)))
        k = min(8, self._tree.n)
        _, idx = self._tree.query(xz, k=k)
        idx = np.asarray(idx).reshape(len(xz), k)
        centres = self._tree.data[idx]
        half = self.cell / 2
        dx = np.maximum(np.abs(xz[:, None, 0] - centres[..., 0]) - half, 0)
        dz = np.maximum(np.abs(xz[:, None, 1] - centres[..., 1]) - half, 0)
        return np.hypot(dx, dz).min(axis=1) * self.mpu


def build_grid(points: np.ndarray, floor_y: float, mpu: float, params: dict[str, Any] = PARAMS) -> NavGrid:
    cell = params["cell_units"]
    x0, z0 = float(points[:, 0].min()), float(points[:, 2].min())
    width = int((float(points[:, 0].max()) - x0) / cell) + 1
    height = int((float(points[:, 2].max()) - z0) / cell) + 1
    above = floor_y - points[:, 1]
    gi = np.clip(((points[:, 0] - x0) / cell).astype(int), 0, width - 1)
    gj = np.clip(((points[:, 2] - z0) / cell).astype(int), 0, height - 1)

    lo, hi = (v / mpu for v in params["obstacle_band_m"])
    obstacle = (above > lo) & (above < hi)
    occ = np.zeros((height, width), dtype=int)
    np.add.at(occ, (gj[obstacle], gi[obstacle]), 1)
    floor_pts = np.abs(above) < params["floor_band_units"]
    sup = np.zeros((height, width), dtype=int)
    np.add.at(sup, (gj[floor_pts], gi[floor_pts]), 1)

    blocked = occ >= params["min_obstacle_splats"]
    support = ndimage.binary_closing(sup >= params["min_support_splats"], iterations=2)
    esdf_m = ndimage.distance_transform_edt(~blocked, sampling=cell) * mpu
    inflate_m = params["robot_radius_m"] + params["inflation_margin_cells"] * cell * mpu
    free = support & ~blocked & (esdf_m > inflate_m)
    labels, count = ndimage.label(free)  # 4-connected: the planner forbids diagonal corner cutting
    if count < 1:
        raise ValueError("No connected walkable floor component found")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    walkable = labels == int(sizes.argmax())
    cost = 1.0 + params["cost_w"] * np.exp(-esdf_m / params["cost_sigma_m"])

    stats = {
        "grid_shape": [height, width],
        "blocked_cells": int(blocked.sum()),
        "support_cells": int(support.sum()),
        "free_cells": int(free.sum()),
        "components": int(count),
        "component_sizes": sorted((int(s) for s in sizes[1:]), reverse=True)[:5],
        "walkable_cells": int(walkable.sum()),
        "walkable_area_units2": round(float(walkable.sum()) * cell * cell, 4),
        "walkable_area_m2": round(float(walkable.sum()) * (cell * mpu) ** 2, 3),
        "inflation_radius_m": round(inflate_m, 4),
    }
    return NavGrid(cell, x0, z0, float(floor_y), float(mpu), blocked, support, free, walkable, esdf_m, cost, params, stats)


# --------------------------------------------------------------------------- line of sight


def line_cells(a: Cell, b: Cell) -> list[Cell]:
    """Supercover traversal (Amanatides-Woo) between cell centres; corner crossings add both side cells."""
    (j, i), (j1, i1) = a, b
    dj, di = j1 - j, i1 - i
    sj, si = (1 if dj > 0 else -1), (1 if di > 0 else -1)
    tdj = abs(1.0 / dj) if dj else math.inf
    tdi = abs(1.0 / di) if di else math.inf
    tmj = 0.5 * tdj
    tmi = 0.5 * tdi
    cells = [(j, i)]
    for _ in range(abs(dj) + abs(di) + 2):
        if (j, i) == (j1, i1):
            break
        if abs(tmj - tmi) < 1e-9:
            cells.append((j + sj, i))
            cells.append((j, i + si))
            j += sj
            i += si
            tmj += tdj
            tmi += tdi
        elif tmj < tmi:
            j += sj
            tmj += tdj
        else:
            i += si
            tmi += tdi
        cells.append((j, i))
    return cells


class Planner:
    def __init__(self, grid: NavGrid):
        self.grid = grid
        self.cell_m = grid.cell * grid.mpu
        self.expansions = 0

    def los(self, a: Cell, b: Cell) -> bool:
        walk = self.grid.walkable
        h, w = walk.shape
        for j, i in line_cells(a, b):
            if not (0 <= j < h and 0 <= i < w) or not walk[j, i]:
                return False
        return True

    def seg_cost(self, a: Cell, b: Cell) -> float:
        cells = line_cells(a, b)
        mean = sum(self.grid.cost[c] for c in cells) / len(cells)
        return math.hypot(b[0] - a[0], b[1] - a[1]) * self.cell_m * mean

    def path_cost(self, cells: list[Cell]) -> float:
        return sum(self.seg_cost(cells[k], cells[k + 1]) for k in range(len(cells) - 1))

    def heuristic(self, a: Cell, b: Cell) -> float:
        dj, di = abs(a[0] - b[0]), abs(a[1] - b[1])
        return (max(dj, di) + (math.sqrt(2) - 1) * min(dj, di)) * self.cell_m

    def search(self, start: Cell, goal: Cell, any_angle: bool = True) -> list[Cell]:
        """Basic Theta* (any_angle) or A* over the 8-connected walkable grid with octile heuristic."""
        walk = self.grid.walkable
        g = {start: 0.0}
        parent = {start: start}
        heap = [(self.heuristic(start, goal), start)]
        closed: set[Cell] = set()
        while heap:
            _, s = heapq.heappop(heap)
            if s in closed:
                continue
            if s == goal:
                break
            closed.add(s)
            self.expansions += 1
            for dj, di in NEIGHBOURS:
                n = (s[0] + dj, s[1] + di)
                if n in closed or not self.grid.inside(*n) or not walk[n]:
                    continue
                if dj and di and not (walk[s[0] + dj, s[1]] and walk[s[0], s[1] + di]):
                    continue
                best, best_parent = g[s] + self.seg_cost(s, n), s
                p = parent[s]
                if any_angle and p != s and self.los(p, n):
                    alt = g[p] + self.seg_cost(p, n)
                    if alt <= best:
                        best, best_parent = alt, p
                if best < g.get(n, math.inf):
                    g[n] = best
                    parent[n] = best_parent
                    heapq.heappush(heap, (best + self.heuristic(n, goal), n))
        if goal not in parent:
            raise ValueError(f"No path from {start} to {goal}")
        path = [goal]
        while path[-1] != start:
            path.append(parent[path[-1]])
        return path[::-1]

    def shortcut(self, cells: list[Cell]) -> list[Cell]:
        """Greedy farthest-visible shortcut, accepted only if it doesn't raise clearance cost."""
        out = [cells[0]]
        i = 0
        while i < len(cells) - 1:
            k = len(cells) - 1
            while k > i + 1:
                if self.los(cells[i], cells[k]) and self.seg_cost(cells[i], cells[k]) <= self.path_cost(cells[i : k + 1]) + 1e-9:
                    break
                k -= 1
            out.append(cells[k])
            i = k
        return out


# --------------------------------------------------------------------------- smoothing


def catmull_rom(points: np.ndarray, step: float, alpha: float = 0.5) -> np.ndarray:
    """Centripetal Catmull-Rom (Barry-Goldman evaluation) through all points, sampled about every `step`."""
    if len(points) < 3:
        return densify(points, step)
    ext = np.vstack([2 * points[0] - points[1], points, 2 * points[-1] - points[-2]])
    out = []
    for k in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[k - 1], ext[k], ext[k + 1], ext[k + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0) ** alpha, 1e-9)
        t2 = t1 + max(np.linalg.norm(p2 - p1) ** alpha, 1e-9)
        t3 = t2 + max(np.linalg.norm(p3 - p2) ** alpha, 1e-9)
        m = max(int(math.ceil(np.linalg.norm(p2 - p1) / step)), 1)
        t = np.linspace(t1, t2, m, endpoint=False)[:, None]
        a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
        a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
        a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
        b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
        b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
        out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(points[-1:])
    return np.vstack(out)


def densify(points: np.ndarray, step: float) -> np.ndarray:
    out = []
    for a, b in zip(points[:-1], points[1:]):
        m = max(int(math.ceil(np.linalg.norm(b - a) / step)), 1)
        out.append(a + (b - a) * np.linspace(0, 1, m, endpoint=False)[:, None])
    out.append(points[-1:])
    return np.vstack(out)


def resample(points: np.ndarray, step: float) -> np.ndarray:
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    n = max(int(math.ceil(s[-1] / step)) + 1, 2)
    su = np.linspace(0, s[-1], n)
    return np.column_stack([np.interp(su, s, points[:, 0]), np.interp(su, s, points[:, 1])])


def polyline_length(points: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum()) if len(points) > 1 else 0.0


# --------------------------------------------------------------------------- motion profile


def wrap_angle(a: float) -> float:
    return (a + math.pi) % (2 * math.pi) - math.pi


def heading(dx: Any, dz: Any) -> Any:
    """Yaw about the raw +y axis, measured from +z towards +x: yaw = atan2(dx, dz)."""
    return np.arctan2(dx, dz)


def motion_profile(xz: np.ndarray, grid: NavGrid, final_yaw: float, params: dict[str, Any] = PARAMS) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Arc-length parameterise the route, apply a curvature-limited trapezoidal speed profile, then turn in place."""
    mpu, dt = grid.mpu, params["sample_dt_s"]
    dense = resample(xz, 0.01)
    s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))]) * mpu
    length = float(s[-1])
    if length < 1e-6:
        dense, s = np.vstack([xz[:1], xz[:1]]), np.array([0.0, 1e-6])
    dx, dz = np.gradient(dense[:, 0], s), np.gradient(dense[:, 1], s)
    yaw = np.unwrap(heading(dx, dz))
    kappa = ndimage.uniform_filter1d(np.abs(np.gradient(yaw, s)), size=9, mode="nearest")
    v_lim = np.minimum(params["v_max_mps"], np.sqrt(params["a_lat_mps2"] / np.maximum(kappa, 1e-9)))
    v = v_lim.copy()
    v[0] = v[-1] = 0.0
    ds = np.diff(s)
    a = params["a_max_mps2"]
    for k in range(1, len(v)):
        v[k] = min(v[k], math.sqrt(v[k - 1] ** 2 + 2 * a * ds[k - 1]))
    for k in range(len(v) - 2, -1, -1):
        v[k] = min(v[k], math.sqrt(v[k + 1] ** 2 + 2 * a * ds[k]))
    t = np.concatenate([[0.0], np.cumsum(2 * ds / np.maximum(v[:-1] + v[1:], 1e-9))])
    drive_t = float(t[-1])

    tt = np.append(np.arange(0.0, drive_t, dt), drive_t)
    samples = []
    for ti in tt:
        si = float(np.interp(ti, t, s))
        samples.append(
            {
                "t": round(float(ti), 3),
                "s": round(si, 4),
                "pos": [round(float(np.interp(si, s, dense[:, 0])), 5), round(grid.floor_y, 5), round(float(np.interp(si, s, dense[:, 1])), 5)],
                "yaw": round(float(wrap_angle(float(np.interp(si, s, yaw)))), 5),
                "speed": round(float(np.interp(ti, t, v)), 4),
                "phase": "drive",
            }
        )

    yaw_end = float(yaw[-1])
    turn = wrap_angle(final_yaw - yaw_end)
    w_max, w_acc = math.radians(params["turn_rate_dps"]), math.radians(params["turn_acc_dps2"])
    if abs(turn) > math.radians(1.0):
        th = abs(turn)
        t_acc = min(w_max / w_acc, math.sqrt(th / w_acc))
        w_peak = w_acc * t_acc
        t_cruise = max(th - w_peak * t_acc, 0.0) / w_peak
        turn_t = 2 * t_acc + t_cruise

        def angle(u: float) -> float:
            if u < t_acc:
                return 0.5 * w_acc * u * u
            if u < t_acc + t_cruise:
                return 0.5 * w_peak * t_acc + w_peak * (u - t_acc)
            r = turn_t - u
            return th - 0.5 * w_acc * r * r

        end = samples[-1]
        for u in np.append(np.arange(dt, turn_t, dt), turn_t):
            samples.append({**end, "t": round(drive_t + float(u), 3), "yaw": round(wrap_angle(yaw_end + math.copysign(angle(float(u)), turn)), 5), "speed": 0.0, "phase": "turn"})
    else:
        turn_t = 0.0
    samples[-1]["phase"] = "arrived"
    samples[-1]["yaw"] = round(wrap_angle(final_yaw), 5)
    stats = {
        "drive_duration_s": round(drive_t, 2),
        "turn_duration_s": round(turn_t, 2),
        "duration_s": round(drive_t + turn_t, 2),
        "turn_in_place_deg": round(math.degrees(turn), 1),
        "peak_speed_mps": round(float(v.max()), 3),
        "max_curvature_per_m": round(float(kappa.max()), 3),
    }
    return samples, stats


# --------------------------------------------------------------------------- start and approach poses


def front_entry(grid: NavGrid) -> Cell:
    """Walkable cell with most clearance in the band nearest the front (max z) edge of the walkable floor."""
    js, is_ = np.nonzero(grid.walkable)
    _, zc = grid.centre(js, is_)
    band = zc >= zc.max() - grid.params["start_band_units"]
    k = int(np.argmax(np.where(band, grid.esdf_m[js, is_], -1.0)))
    return int(js[k]), int(is_[k])


def footprint(obj: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """OBB footprint in x-z: centre, x axis, z axis (unit, world) and half extents."""
    obb = obj["obb"]
    r = np.asarray(obb["rotation"], dtype=float)
    centre = np.array([obb["center"][0], obb["center"][2]])
    ax = np.array([r[0][0], r[2][0]])
    az = np.array([r[0][2], r[2][2]])
    half = np.array([obb["extent"][0], obb["extent"][2]]) / 2
    return centre, ax / np.linalg.norm(ax), az / np.linalg.norm(az), half


def footprint_distance(obj: dict[str, Any], xz: np.ndarray) -> np.ndarray:
    centre, ax, az, half = footprint(obj)
    d = xz - centre
    u = np.maximum(np.abs(d @ ax) - half[0], 0)
    w = np.maximum(np.abs(d @ az) - half[1], 0)
    return np.hypot(u, w)


def footprint_corners(obj: dict[str, Any]) -> np.ndarray:
    centre, ax, az, half = footprint(obj)
    return np.array([centre + sx * half[0] * ax + sz * half[1] * az for sx, sz in [(-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1)]])


def approach_pose(grid: NavGrid, obj: dict[str, Any], room_centre: np.ndarray) -> dict[str, Any]:
    """Reachable cell at the standoff distance from the object's footprint, facing the object from the room side."""
    p = grid.params
    js, is_ = np.nonzero(grid.walkable)
    xz = np.column_stack(grid.centre(js, is_))
    dist_m = footprint_distance(obj, xz) * grid.mpu
    nearest = float(dist_m.min())
    result: dict[str, Any] = {"distance_to_walkable_m": round(nearest, 3)}
    if nearest > p["max_reach_m"]:
        return {**result, "reachable": False}

    cand = np.abs(dist_m - p["standoff_m"]) <= p["standoff_tol_m"]
    standoff_ok = bool(cand.any())
    if not standoff_ok:
        cand = dist_m <= nearest + 0.05
    centre = footprint(obj)[0]
    to_room = room_centre - centre
    to_room /= max(np.linalg.norm(to_room), 1e-9)
    target_cell = tuple(int(v) for v in grid.cell_of(centre[0], centre[1]))
    planner = Planner(grid)
    idx = np.nonzero(cand)[0]
    drive_in = np.array([pre_approach(grid, planner, (-1, -1), (int(js[k]), int(is_[k])), float(heading(*(centre - xz[k])))) is not None for k in idx])
    if drive_in.any():
        idx = idx[drive_in]
    best, best_score = -1, -math.inf
    for k in idx:
        rel = xz[k] - centre
        facing = float(rel @ to_room / max(np.linalg.norm(rel), 1e-9))
        sight = line_cells((int(js[k]), int(is_[k])), target_cell)  # type: ignore[arg-type]
        near = footprint_distance(obj, np.column_stack(grid.centre(*np.array(sight).T))) > 0.05
        hits = [grid.blocked[c] for c, n in zip(sight, near) if n and grid.inside(*c)]
        occluded = sum(hits) / max(len(hits), 1)
        score = min(float(grid.esdf_m[js[k], is_[k]]), 0.6) + 0.3 * facing - 0.5 * occluded - abs(float(dist_m[k]) - p["standoff_m"])
        if score > best_score:
            best, best_score = int(k), score
    cell = (int(js[best]), int(is_[best]))
    pos = xz[best]
    yaw = float(heading(centre[0] - pos[0], centre[1] - pos[1]))
    return {
        **result,
        "reachable": True,
        "cell": cell,
        "position": [round(float(pos[0]), 5), round(grid.floor_y, 5), round(float(pos[1]), 5)],
        "yaw": round(yaw, 5),
        "yaw_deg": round(math.degrees(yaw), 1),
        "standoff_m": round(float(dist_m[best]), 3),
        "standoff_ok": standoff_ok,
        "drive_in": bool(drive_in.any()),
        "clearance_m": round(float(grid.clearance_m(pos[None])[0]), 3),
    }


# --------------------------------------------------------------------------- mission


def pre_approach(grid: NavGrid, planner: Planner, start: Cell, goal: Cell, final_yaw: float) -> Cell | None:
    """Cell `approach_lead_m` behind the goal along its heading, so the robot drives straight in facing the asset."""
    lead = grid.params["approach_lead_m"] / grid.mpu
    gx, gz = grid.centre(*goal)
    j, i = grid.cell_of(gx - lead * math.sin(final_yaw), gz - lead * math.cos(final_yaw))
    cell = (int(j), int(i))
    if cell in (start, goal) or not grid.inside(*cell) or not grid.walkable[cell] or not planner.los(cell, goal):
        return None
    return cell


def plan_route(grid: NavGrid, start: Cell, goal: Cell, final_yaw: float) -> dict[str, Any]:
    t0 = time.perf_counter()
    planner = Planner(grid)
    lead = pre_approach(grid, planner, start, goal, final_yaw)
    raw = planner.search(start, lead or goal, any_angle=True)
    expansions = planner.expansions
    short = planner.shortcut(raw)
    if lead is not None:
        raw, short = raw + [goal], short + [goal]
    raw_xz = np.column_stack(grid.centre(*np.array(raw).T))
    short_xz = np.column_stack(grid.centre(*np.array(short).T))
    params = grid.params
    smooth = catmull_rom(short_xz, params["spline_step_units"])
    radius = params["robot_radius_m"]

    def collision_free(xz: np.ndarray) -> bool:
        return bool(grid.walkable_at(xz).all() and (grid.clearance_m(xz) > radius).all())

    smoothing = "centripetal_catmull_rom"
    if not collision_free(smooth):
        smoothing = "polyline_fallback"
        smooth = densify(short_xz, params["spline_step_units"])
        if not collision_free(smooth):
            smoothing = "raw_polyline_fallback"
            smooth = densify(raw_xz, params["spline_step_units"])
    clearance = grid.clearance_m(smooth)
    samples, profile = motion_profile(smooth, grid, final_yaw, params)
    path_xz = resample(smooth, params["path_step_units"])
    y = round(grid.floor_y, 5)
    length_u = polyline_length(smooth)
    return {
        "path": [[round(float(x), 5), y, round(float(z), 5)] for x, z in path_xz],
        "path_raw": [[round(float(x), 5), y, round(float(z), 5)] for x, z in raw_xz],
        "path_shortcut": [[round(float(x), 5), y, round(float(z), 5)] for x, z in short_xz],
        "samples": samples,
        "stats": {
            "planner": "theta_star",
            "smoothing": smoothing,
            "smoothing_fallback": smoothing != "centripetal_catmull_rom",
            "pre_approach_waypoint": lead is not None,
            "path_length_units": round(length_u, 5),
            "path_length_m": round(length_u * grid.mpu, 4),
            "raw_length_m": round(polyline_length(raw_xz) * grid.mpu, 4),
            "raw_vertices": len(raw),
            "shortcut_vertices": len(short),
            "min_clearance_m": round(float(clearance.min()), 4),
            "min_margin_m": round(float(clearance.min()) - radius, 4),
            "mean_clearance_m": round(float(clearance.mean()), 4),
            "expansions": expansions,
            "plan_ms": round((time.perf_counter() - t0) * 1000, 1),
            **profile,
        },
        "_xz": {"raw": raw_xz, "short": short_xz, "smooth": smooth},
    }


def plan_mission(points: np.ndarray, structure: dict[str, Any], objects: list[dict[str, Any]], mpu: float, out_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build the grid, plan the default mission to TARGET_ASSET_ID and approach poses for every bound asset."""
    t0 = time.perf_counter()
    params = PARAMS
    grid = build_grid(points, structure["floor_y"], mpu, params)
    start = front_entry(grid)
    sx, sz = grid.centre(*start)
    js, is_ = np.nonzero(grid.walkable)
    room_centre = np.array([float(np.mean(grid.centre(js, is_)[0])), float(np.mean(grid.centre(js, is_)[1]))])

    bound = [o for o in objects if o.get("asset_id")]
    target_obj = next(o for o in bound if o["asset_id"] == TARGET_ASSET_ID)
    targets = []
    default = None
    for obj in sorted(bound, key=lambda o: o["asset_id"]):
        pose = approach_pose(grid, obj, room_centre)
        entry: dict[str, Any] = {
            "asset_id": obj["asset_id"],
            "object_id": obj["object_id"],
            "display_label": obj.get("display_label"),
            "class": obj["class"],
            "mapping_method": obj.get("mapping_method"),
            "reachable": pose["reachable"],
            "distance_to_walkable_m": pose["distance_to_walkable_m"],
            "approach": None,
            "mission": None,
        }
        if pose["reachable"]:
            cell = pose.pop("cell")
            entry["approach"] = {k: pose[k] for k in ("position", "yaw", "yaw_deg", "standoff_m", "standoff_ok", "drive_in", "clearance_m")}
            route = plan_route(grid, start, cell, pose["yaw"])
            xz = route.pop("_xz")
            entry["mission"] = route
            if obj is target_obj:
                default = (entry, xz)
        targets.append(entry)
    if default is None:
        raise ValueError(f"{TARGET_ASSET_ID} ({target_obj['object_id']}) has no reachable approach pose")
    entry, xz = default
    mission = entry["mission"]
    start_yaw = mission["samples"][0]["yaw"]
    start_pose = {"position": [round(float(sx), 5), round(grid.floor_y, 5), round(float(sz), 5)], "yaw": start_yaw, "name": "front_entry"}

    out_png = out_dir / "floor_occ.png"
    diag_png = out_dir / "diagnostics" / "nav_esdf.png"
    nav = {
        "schema_version": SCHEMA_VERSION,
        "nav_version": NAV_VERSION,
        "frame": "ply_raw",
        "target_asset_id": TARGET_ASSET_ID,
        "target_object_id": target_obj["object_id"],
        "cell_size": grid.cell,
        "grid_origin": [round(grid.x0, 5), round(grid.floor_y, 5), round(grid.z0, 5)],
        "grid_shape": list(grid.shape),
        "start": mission["path"][0],
        "goal": mission["path"][-1],
        "path": mission["path"],
        "path_length_units": mission["stats"]["path_length_units"],
        "path_length_m": mission["stats"]["path_length_m"],
        "metres_per_unit": mpu,
        "occupancy_png": str(out_png),
        "diagnostics_png": str(diag_png),
        "targets_file": str(out_dir / "nav_targets.json"),
        "start_name": "front_entry",
        "start_pose": start_pose,
        "approach": {**entry["approach"], "object_id": target_obj["object_id"], "asset_id": TARGET_ASSET_ID},
        "yaw_convention": "yaw = atan2(dx, dz) in raw PLY frame, radians, rotation about the raw +y axis from +z towards +x",
        "robot": {k: params[k] for k in ("robot_radius_m", "v_max_mps", "a_max_mps2", "a_lat_mps2", "turn_rate_dps", "turn_acc_dps2")},
        "cost_params": {
            "formula": "c = 1 + w * exp(-d / sigma), d = ESDF distance to nearest obstacle cell in metres",
            "w": params["cost_w"],
            "sigma_m": params["cost_sigma_m"],
            "obstacle_band_m": params["obstacle_band_m"],
            "min_obstacle_splats": params["min_obstacle_splats"],
            "inflation_radius_m": grid.stats["inflation_radius_m"],
        },
        "grid_stats": grid.stats,
        "path_raw": mission["path_raw"],
        "path_shortcut": mission["path_shortcut"],
        "samples": mission["samples"],
        "stats": mission["stats"],
    }

    astar = Planner(grid)
    goal_cell = tuple(int(v) for v in grid.cell_of(entry["approach"]["position"][0], entry["approach"]["position"][2]))
    astar_cells = astar.search(start, goal_cell, any_angle=False)  # type: ignore[arg-type]
    astar_xz = np.column_stack(grid.centre(*np.array(astar_cells).T))
    nav["stats"]["astar_length_m"] = round(polyline_length(astar_xz) * mpu, 4)
    nav["stats"]["astar_expansions"] = astar.expansions

    reachable = [t for t in targets if t["reachable"]]
    nav_targets = {
        "schema_version": SCHEMA_VERSION,
        "nav_version": NAV_VERSION,
        "frame": "ply_raw",
        "metres_per_unit": mpu,
        "default_target_asset_id": TARGET_ASSET_ID,
        "start_pose": start_pose,
        "yaw_convention": nav["yaw_convention"],
        "summary": {"bound_assets": len(targets), "reachable": len(reachable), "unreachable": len(targets) - len(reachable)},
        "targets": targets,
    }

    write_occupancy_png(grid, xz["smooth"], out_png)
    write_nav_diagnostics(grid, xz, astar_xz, nav, target_obj, targets, diag_png)
    write_ros_map(grid, out_dir / "nav_map.pgm")
    nav["stats"]["total_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return nav, nav_targets


# --------------------------------------------------------------------------- outputs


def _extent(grid: NavGrid) -> list[float]:
    h, w = grid.shape
    return [grid.x0, grid.x0 + w * grid.cell, grid.z0, grid.z0 + h * grid.cell]


def write_occupancy_png(grid: NavGrid, smooth: np.ndarray, out_png: Path) -> None:
    out_png.parent.mkdir(parents=True, exist_ok=True)
    img = np.where(grid.blocked, 3, np.where(grid.walkable, 2, np.where(grid.support, 1, 0)))
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.imshow(img, origin="lower", cmap=matplotlib.colors.ListedColormap(["white", "#d9d9d9", "#8fb3d9", "black"]), extent=_extent(grid), interpolation="nearest", vmin=0, vmax=3)
    ax.plot(smooth[:, 0], smooth[:, 1], "r-", linewidth=2)
    ax.plot(*smooth[0], "go", ms=7)
    ax.plot(*smooth[-1], "bs", ms=7)
    ax.set_title("Occupancy: black obstacle, blue walkable (robot radius inflated), grey supported floor")
    ax.set_xlabel("x (units)")
    ax.set_ylabel("z (units)")
    ax.set_aspect("equal")
    fig.tight_layout()
    fig.savefig(out_png, dpi=120)
    plt.close(fig)


def write_nav_diagnostics(grid: NavGrid, xz: dict[str, np.ndarray], astar_xz: np.ndarray, nav: dict[str, Any], target_obj: dict[str, Any], targets: list[dict[str, Any]], out_png: Path) -> None:
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig = plt.figure(figsize=(15, 9))
    ax = fig.add_subplot(2, 1, 1)
    esdf = np.ma.masked_where(~grid.support, np.minimum(grid.esdf_m, 1.0))
    im = ax.imshow(esdf, origin="lower", cmap="viridis", extent=_extent(grid), interpolation="nearest")
    ax.imshow(np.ma.masked_where(~grid.blocked, grid.blocked), origin="lower", cmap="gray_r", extent=_extent(grid), interpolation="nearest", vmin=0, vmax=1)
    xs, zs = grid.centre(*np.meshgrid(np.arange(grid.shape[0]), np.arange(grid.shape[1]), indexing="ij"))
    ax.contour(xs, zs, grid.walkable.astype(float), levels=[0.5], colors="white", linewidths=0.8)
    fig.colorbar(im, ax=ax, fraction=0.02, label="ESDF clearance (m, capped at 1)")
    ax.plot(astar_xz[:, 0], astar_xz[:, 1], color="#bbbbbb", lw=1, ls=":", label=f"A* ({nav['stats']['astar_length_m']:.2f} m)")
    ax.plot(xz["raw"][:, 0], xz["raw"][:, 1], "o--", color="orange", lw=1.2, ms=3, label=f"Theta* raw ({nav['stats']['raw_length_m']:.2f} m)")
    ax.plot(xz["smooth"][:, 0], xz["smooth"][:, 1], "r-", lw=2, label=f"smoothed ({nav['stats']['path_length_m']:.2f} m, min clearance {nav['stats']['min_clearance_m']:.2f} m)")
    corners = footprint_corners(target_obj)
    ax.plot(corners[:, 0], corners[:, 1], "m-", lw=1.5, label=f"{target_obj['object_id']} footprint")
    for t in targets:
        if t["reachable"] and t["asset_id"] != nav["target_asset_id"]:
            p, yaw = t["approach"]["position"], t["approach"]["yaw"]
            ax.arrow(p[0], p[2], 0.12 * math.sin(yaw), 0.12 * math.cos(yaw), head_width=0.04, color="#ffffff", alpha=0.6)
    s = nav["start_pose"]
    ax.plot(s["position"][0], s["position"][2], "g^", ms=10, label="start (front entry)")
    a = nav["approach"]
    ax.arrow(a["position"][0], a["position"][2], 0.2 * math.sin(a["yaw"]), 0.2 * math.cos(a["yaw"]), head_width=0.06, color="cyan", label="approach pose")
    xmin, xmax = np.nonzero(grid.support.any(axis=0))[0][[0, -1]]
    zmin, zmax = np.nonzero(grid.support.any(axis=1))[0][[0, -1]]
    ax.set_xlim(grid.x0 + (xmin - 2) * grid.cell, grid.x0 + (xmax + 3) * grid.cell)
    ax.set_ylim(grid.z0 + (zmin - 2) * grid.cell, grid.z0 + (zmax + 3) * grid.cell)
    ax.set_aspect("equal")
    ax.set_xlabel("x (units)")
    ax.set_ylabel("z (units)")
    ax.legend(loc="lower left", fontsize=7, framealpha=0.9)
    ax.set_title("ESDF clearance, obstacles (black), walkable boundary (white), routes and approach poses")

    ax2 = fig.add_subplot(2, 1, 2)
    t = [p["t"] for p in nav["samples"]]
    ax2.plot(t, [p["speed"] for p in nav["samples"]], "r-", label="speed (m/s)")
    ax2.set_xlabel("time (s)")
    ax2.set_ylabel("speed (m/s)")
    ax3 = ax2.twinx()
    ax3.plot(t, np.degrees(np.unwrap([p["yaw"] for p in nav["samples"]])), "b-", lw=1, label="yaw (deg)")
    ax3.set_ylabel("yaw (deg)")
    st = nav["stats"]
    ax2.set_title(f"Motion profile: {st['path_length_m']:.2f} m in {st['drive_duration_s']:.1f} s drive + {st['turn_duration_s']:.1f} s turn, peak {st['peak_speed_mps']:.2f} m/s")
    ax2.legend(loc="upper left")
    ax3.legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(out_png, dpi=110)
    plt.close(fig)


def write_ros_map(grid: NavGrid, out_pgm: Path) -> None:
    """ROS map_server PGM + YAML. Map x = PLY x, map y = PLY z, both in metres."""
    img = np.full(grid.shape, 205, dtype=np.uint8)
    img[grid.support] = 254
    img[grid.blocked] = 0
    img = np.flipud(img)
    h, w = img.shape
    out_pgm.write_bytes(f"P5\n{w} {h}\n255\n".encode() + img.tobytes())
    out_pgm.with_suffix(".yaml").write_text(
        "\n".join(
            [
                f"image: {out_pgm.name}",
                f"resolution: {grid.cell * grid.mpu:.5f}",
                f"origin: [{grid.x0 * grid.mpu:.5f}, {grid.z0 * grid.mpu:.5f}, 0.0]",
                "negate: 0",
                "occupied_thresh: 0.65",
                "free_thresh: 0.196",
                "# map x = PLY x * metres_per_unit, map y = PLY z * metres_per_unit (PLY frame is y-down)",
                "",
            ]
        ),
        encoding="utf-8",
    )


# --------------------------------------------------------------------------- self test


def _synthetic_grid(walkable: np.ndarray, mpu: float = 1.0) -> NavGrid:
    blocked = ~walkable
    esdf = ndimage.distance_transform_edt(walkable, sampling=0.05) * mpu
    params = {**PARAMS, "robot_radius_m": 0.0, "inflation_margin_cells": 0.0}
    cost = np.ones_like(esdf)
    return NavGrid(0.05, 0.0, 0.0, 0.0, mpu, blocked, walkable.copy(), walkable.copy(), walkable.copy(), esdf, cost, params)


def selftest() -> None:
    open_grid = _synthetic_grid(np.ones((40, 60), dtype=bool))
    planner = Planner(open_grid)
    cells = planner.search((5, 3), (32, 51), any_angle=True)
    length = polyline_length(np.column_stack(open_grid.centre(*np.array(cells).T)))
    straight = math.hypot(27, 48) * 0.05
    assert abs(length - straight) < 1e-9, (length, straight)
    astar = planner.search((5, 3), (32, 51), any_angle=False)
    astar_len = polyline_length(np.column_stack(open_grid.centre(*np.array(astar).T)))
    print(f"empty grid: theta* {length:.4f} == straight {straight:.4f}; A* {astar_len:.4f}")

    wall = np.ones((40, 60), dtype=bool)
    wall[0:30, 30] = False
    wall_grid = _synthetic_grid(wall)
    wp = Planner(wall_grid)
    assert not wp.los((5, 10), (5, 50)), "line of sight must reject a wall"
    assert wp.los((35, 10), (35, 50))
    corner = np.ones((10, 10), dtype=bool)
    corner[5, 6] = False
    assert not Planner(_synthetic_grid(corner)).los((4, 5), (6, 7)), "corner crossing must check both side cells"
    route = wp.search((5, 10), (5, 50))
    assert all(wall_grid.walkable[c] for c in route)
    print(f"wall: LOS rejected, detour has {len(route)} vertices")

    pts = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [2.0, 1.5]])
    spline = catmull_rom(pts, 0.01)
    for p in pts:
        assert np.min(np.linalg.norm(spline - p, axis=1)) < 1e-9, "spline must interpolate control points"
    print(f"catmull-rom: interpolates {len(pts)} control points with {len(spline)} samples")

    line = np.column_stack([np.zeros(50), np.linspace(0, 2.0, 50)])
    samples, prof = motion_profile(line, open_grid, final_yaw=math.pi / 2)
    drive = [s for s in samples if s["phase"] == "drive"]
    t = np.array([s["t"] for s in drive])
    v = np.array([s["speed"] for s in drive])
    area = float(np.sum(np.diff(t) * (v[1:] + v[:-1]) / 2))
    expected_t = 2.0 / PARAMS["v_max_mps"] + PARAMS["v_max_mps"] / PARAMS["a_max_mps2"]
    assert abs(area - 2.0) < 0.02, area
    assert abs(prof["drive_duration_s"] - expected_t) < 0.05, (prof["drive_duration_s"], expected_t)
    assert abs(samples[-1]["yaw"] - math.pi / 2) < 1e-4 and abs(prof["turn_in_place_deg"]) > 89
    print(f"trapezoid: area {area:.4f} m == 2.0 m; duration {prof['drive_duration_s']:.2f} s == analytic {expected_t:.2f} s; final turn {prof['turn_in_place_deg']} deg")
    print("navigation selftest passed")


if __name__ == "__main__":
    selftest()
