"""Typed scene command -> proposed move of one verified movable. Never commits.

The intent (which object, what kind of move) comes from the LLM or the rule parser (intent.py). Everything
geometric is deterministic: candidate poses are generated here, ranked with engine.quick_check (overlap, floor,
gaps; ~5 ms each) and confirmed with engine.preview (also rails, reachability, entrance, aisle, route change).
The explanation is a template filled from preview numbers, so it cannot contain invented values.
Frames: world/display (x, -y_ply, -z_ply), PLY units; edits are deltas from the object's current pose."""

from __future__ import annotations

import logging
import re
from functools import lru_cache

import numpy as np
from scipy import ndimage

from backend.scene_edit import engine, store
from backend.scene_edit.geometry import MPU, world_box
from backend.scene_edit.intent import MoveIntent, llm_intent, match_fixed, match_movable, rule_parse
from pipeline.rails import CELL

log = logging.getLogger(__name__)
MOVE_VERB = re.compile(r"\b(move|put|push|pull|shift|slide|place|rotate|turn|drag|bring|relocate|carry|lift|take"
                       r"|clear|get|set|park|spin|remove|delete|erase|discard|throw|dispose)\b")

MIN_GAP_M = 0.10  # auto-apply and "good spot" need at least this clear gap on every side
ROUTE_NEAR_U = 0.45  # an object closer than this to a route (PLY units, ~0.55 m) is in the walker's way
FULL_CHECKS = 5  # full previews (rails rebuild, ~0.3 s each) per command
CLUTTER_MAX = 0.15  # max share of the footprint already holding something at the object's heights


@lru_cache(maxsize=1)
def asset_tags() -> dict[str, dict]:
    """'P-002' -> {asset_id, object_id} for the 30 assets bound to a 3D object."""
    out = {}
    for o in engine.base()[2].values():
        if o.get("asset_id") and o.get("display_label"):
            out[o["display_label"].split()[0].upper()] = {"asset_id": o["asset_id"], "object_id": o["object_id"]}
    return out


def tag_of(asset_id: str | None) -> str | None:
    return next((t for t, a in asset_tags().items() if a["asset_id"] == asset_id), None)


def _xz(v) -> np.ndarray:
    return np.array([float(v[0]), float(v[2])])


def _half_xz(obj: dict) -> float:
    _, R, e = world_box(obj)
    corners = np.array([[sx, 0, sz] for sx in (-.5, .5) for sz in (-.5, .5)]) * e
    return float(np.abs((corners @ R.T)[:, [0, 2]]).max(axis=0).max())


def _camera_axes(camera: dict | None) -> tuple[dict[str, np.ndarray], bool]:
    """Floor-plane unit vectors for left/right/forward/back. Camera-relative when a camera pose is given."""
    f = None
    if camera and camera.get("forward"):
        f = _xz(camera["forward"])
        f = f / np.linalg.norm(f) if np.linalg.norm(f) > 1e-3 else None
    rel = f is not None
    if f is None:
        f = np.array([0.0, -1.0])
    right = np.array([-f[1], f[0]])  # forward x up, projected on the floor
    ax = {"forward": f, "back": -f, "right": right, "left": -right,
          "+x": np.array([1.0, 0]), "-x": np.array([-1.0, 0]), "+z": np.array([0, 1.0]), "-z": np.array([0, -1.0])}
    return ax, rel


def _ring(centre: np.ndarray, radii, n: int = 16) -> list[np.ndarray]:
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return [centre + r * np.array([np.cos(t), np.sin(t)]) for r in radii for t in a]


def _edit(mid: str, d_xz: np.ndarray, yaw: float) -> dict:
    return {"object_id": mid, "translate_world": [round(float(d_xz[0]), 4), 0.0, round(float(d_xz[1]), 4)],
            "yaw_deg": round(float(yaw), 2)}


def _gap_min(g: dict | None) -> float:
    if not g:
        return 0.0
    v = g.get("min")
    return 9.9 if v is None else float(v)  # None = nothing within 2.4 m on any side


def _route_points(st, asset_id: str) -> np.ndarray | None:
    goal = st.stands.get(asset_id)
    if goal is None:
        return None
    return engine.route(st.nav, engine.start_xz(st.nav), goal)


def _points_to_path(xyz: np.ndarray, path: np.ndarray) -> float:
    """Closest distance (PLY units) from an object's splats (floor projection) to a route polyline's samples."""
    if not len(xyz):
        return 9.9
    pts = xyz[:: max(1, len(xyz) // 300)][:, [0, 2]]
    return float(np.min(np.linalg.norm(pts[:, None, :] - path[None], axis=2)))


def _route_distance(st, mid: str, path: np.ndarray, floor_y: float) -> float:
    return _points_to_path(st.xyz[engine.object_mask(st.xyz, st.movs[mid], floor_y)], path)


# ---------------------------------------------------------------- search
def search(edits: list[dict], mid: str, cands: list[tuple[np.ndarray, float]], score, target_asset_id: str | None,
           full: int = FULL_CHECKS, accept=None) -> list[dict]:
    """Rank candidate (delta_xz, yaw) poses: quick local check first (overlap, floor, gaps, footprint clutter),
    full preview on the best few. score(d, yaw, quick) -> number or tuple, lower is better.
    Returns full-checked options, best first."""
    seen, quick = set(), []
    for d, yaw in cands:
        key = (round(float(d[0]), 2), round(float(d[1]), 2), round(yaw))
        if key in seen:
            continue
        seen.add(key)
        e = _edit(mid, d, yaw)
        q = engine.quick_check(edits, e)
        if q["blocked"]:
            continue
        s = score(d, yaw, q)
        quick.append(((q["footprint_occupied"] > CLUTTER_MAX, _gap_min(q["gaps"]) < MIN_GAP_M, bool(q["warn"]),
                       s if isinstance(s, tuple) else (s,), q["footprint_occupied"]), e, q))
    quick.sort(key=lambda r: r[0])
    out = []
    for _, e, q in quick[:full]:
        pv = engine.preview(edits, e, target_asset_id)
        out.append({"edit": e, "preview": pv, "footprint_occupied": round(q["footprint_occupied"], 3)})
        if _good(out[-1]) and (accept is None or accept(out[-1])):
            break
    rank = {"allowed": 0, "warning": 1, "blocked": 2}
    out.sort(key=lambda o: (rank[o["preview"]["verdict"]], not _good(o), 0 if accept is None or accept(o) else 1))
    return out


def _good(o: dict) -> bool:
    """Allowed by the preview AND a real gap AND on clear floor (the bar for auto-apply)."""
    return (o["preview"]["verdict"] == "allowed" and _gap_min(o["preview"].get("gaps_m")) >= MIN_GAP_M
            and o.get("footprint_occupied", 1.0) <= CLUTTER_MAX)


def _with_clutter(edits: list[dict], o: dict) -> dict:
    if "footprint_occupied" not in o:
        o["footprint_occupied"] = round(engine.quick_check(edits, o["edit"])["footprint_occupied"], 3)
    return o


# ---------------------------------------------------------------- main entry
def interpret(text: str) -> tuple[MoveIntent, str, str | None]:
    from backend.ai.agent import configured_model

    model = configured_model()
    if model:
        try:
            mv = [{"object_id": k, "label": v["label"]} for k, v in engine.movables().items()]
            it = llm_intent(model, text, mv, sorted(asset_tags()))
            return it, "llm", model
        except Exception as exc:  # noqa: BLE001 - any LLM failure falls back to the rule parser
            log.warning("LLM intent failed, using rule parser: %s", exc)
    return rule_parse(text), "fallback", None


def run(text: str, selected_object_id: str | None = None, target_asset_id: str | None = None,
        camera: dict | None = None, movable_id: str | None = None, _parsed: tuple | None = None) -> dict:
    intent, mode, model = _parsed or interpret(text)
    base = {"text": text, "intent": intent.model_dump(), "mode": mode, "model": model}
    edits = store.load()
    mv = engine.movables()

    # ---- which object (only verified movables; the LLM's choice must agree with the words)
    words_ids = match_movable(text)
    words_fixed = match_fixed(intent.object_ref or "") if not words_ids else None
    mid = movable_id if movable_id in mv else None
    if mid is None and intent.movable_id in mv and not (words_fixed and not words_ids):
        mid = intent.movable_id
    if intent.action == "not_a_move" and not MOVE_VERB.search(text.lower()):
        return {**base, "status": "noop", "explanation": "That is not a request to move an object. "
                + (intent.note or "")}
    if mid is None and intent.action == "not_a_move" and not intent.fixed_subject:
        return {**base, "status": "noop", "explanation": intent.note or "That is not a request to move an object."}
    if mid is None and (intent.fixed_subject or words_fixed):  # a tag whose box belongs to a movable moves it
        a = asset_tags().get((intent.fixed_subject or words_fixed or "").upper())
        mid = engine.resolve(a["object_id"]) if a else None
    if mid is None and (intent.fixed_subject or words_fixed):
        name = intent.fixed_subject or words_fixed
        return {**base, "status": "refused", "explanation":
                f"'{name}' cannot be {'removed' if intent.action == 'remove' else 'moved'}: {engine.FIXED_REASON} "
                "Movable objects: "
                + ", ".join(m["label"] for m in mv.values()) + "."}
    options = [i for i in (intent.movable_options or words_ids) if i in mv]
    if mid is None and len(options) == 1:
        mid = options[0]
    if mid is None and selected_object_id and engine.resolve(selected_object_id) and intent.action != "clear_route":
        sel = engine.resolve(selected_object_id)
        if not options or sel in options:
            mid = sel
    if mid is None and not options and selected_object_id and intent.action != "clear_route" \
            and engine.resolve(selected_object_id) is None:
        return {**base, "status": "refused", "explanation":
                f"The selected object ({selected_object_id}) cannot be moved: {engine.FIXED_REASON}"}
    if mid is None and len(options) > 1:
        return {**base, "status": "clarify", "explanation": "Which one do you mean?",
                "options": [{"movable_id": i, "label": mv[i]["label"]} for i in options]}
    if intent.action == "not_a_move":
        return {**base, "status": "noop", "explanation": intent.note or "Say how to move it."}

    st = engine.state(edits)
    floor_y = engine.base()[1]
    if mid is not None and st.movs[mid].get("removed"):
        return {**base, "status": "refused", "movable_id": mid, "label": mv[mid]["label"], "explanation":
                f"{mv[mid]['label']} was removed from the scene. Undo its removal in the edit log to bring it back."}
    if intent.action == "remove" and mid is not None:
        e = {"object_id": mid, "translate_world": [0.0, 0.0, 0.0], "yaw_deg": 0.0, "remove": True}
        pv = engine.preview(edits, e, target_asset_id)
        if pv["verdict"] == "blocked":
            return {**base, "status": "refused", "movable_id": mid, "label": mv[mid]["label"],
                    "explanation": f"Cannot remove {mv[mid]['label']}: {'; '.join(pv['reasons'])}."}
        return {**base, "status": "proposal", "movable_id": mid, "label": mv[mid]["label"], "action": "remove",
                "edit": e, "exact": True, "preview": pv, "auto_apply": False, "alternatives": [],
                "target_asset_id": target_asset_id,
                "explanation": f"{mv[mid]['label']}: remove from the scene. Check: {pv['verdict']}: "
                               f"{'; '.join(pv['reasons'])}. Its splats and boxes are hidden and the rails and routes "
                               f"are rebuilt without it; undo in the edit log restores it. Needs your confirmation."}
    asset = None
    if intent.action == "clear_route":
        tag = (intent.asset_ref or "").upper()
        asset = asset_tags().get(tag, {}).get("asset_id") or target_asset_id
        if not asset:
            return {**base, "status": "noop", "explanation": "Which route? Name an asset tag (e.g. P-002) or select an asset."}
        path = _route_points(st, asset)
        if path is None:
            return {**base, "status": "noop", "explanation": f"{tag_of(asset) or asset} has no reachable stand point now."}
        if mid is None:  # try the movables next to the route, closest first
            dists = {k: _route_distance(st, k, path, floor_y) for k in mv}
            near = sorted((k for k in dists if dists[k] <= ROUTE_NEAR_U), key=dists.get)[:3]
            last = None
            for k in near:
                last = run(text, selected_object_id, target_asset_id, camera, k, (intent, mode, model))
                if last["status"] == "proposal":
                    return last
            if last is not None:
                length = float(np.linalg.norm(np.diff(path, axis=0), axis=1).sum()) * MPU
                names = ", ".join(mv[k]["label"] for k in near)
                return {**last, "status": "noop", "explanation":
                        f"The route to {tag_of(asset) or asset} is open ({length:.2f} m). Objects alongside it "
                        f"({names}) cannot be moved further from it safely: {last['explanation']}"}
            mid = min(dists, key=dists.get)
        dist = _route_distance(st, mid, path, floor_y)
        if dist > ROUTE_NEAR_U:
            return {**base, "status": "noop", "movable_id": mid, "label": mv[mid]["label"],
                    "explanation": f"The walkway to {tag_of(asset) or asset} is already clear: the nearest movable, "
                                   f"{mv[mid]['label']}, is {dist * MPU:.2f} m from the route."}
    if mid is None:
        return {**base, "status": "clarify", "explanation": "Which object? Select one or name it.",
                "options": [{"movable_id": k, "label": v["label"]} for k, v in mv.items()]}

    obj = st.movs[mid]
    c = _xz(world_box(obj)[0])
    r_obj = _half_xz(obj)
    target = asset if intent.action == "clear_route" else target_asset_id
    ax, cam_rel = _camera_axes(camera)
    what, exact_edit, cands = "", None, []
    score = lambda d, yaw, q: float(np.linalg.norm(d))  # noqa: E731 - default: move as little as possible
    accept = None

    if intent.action == "translate":
        u = ax[intent.direction or "right"]
        dist_u = (intent.distance_m or 0.3) / MPU
        want = u * dist_u
        exact_edit = _edit(mid, want, 0.0)
        side = np.array([-u[1], u[0]])
        cands = [(u * dist_u * s + side * l, 0.0) for s in (1.0, 0.75, 1.25, 0.5, 1.5) for l in (0, -0.1, 0.1, -0.2, 0.2, -0.35, 0.35)]
        score = lambda d, yaw, q: float(np.linalg.norm(d - want))  # noqa: E731
        what = (f"move {intent.distance_m or 0.3:g} m {intent.direction}"
                + ("" if cam_rel or intent.direction in ("+x", "-x", "+z", "-z") else " (world axes: no camera pose sent)"))
    elif intent.action == "rotate":
        yaw = float(intent.yaw_deg if intent.yaw_deg is not None else 90.0)
        exact_edit = _edit(mid, np.zeros(2), yaw)
        cands = [(p - c, yaw) for p in [c] + _ring(c, (0.08, 0.16, 0.25, 0.35, 0.5), 12)]
        what = f"rotate {yaw:+g}° ({'counter-clockwise' if yaw > 0 else 'clockwise'} seen from above)"
    elif intent.action == "place_near":
        lm = intent.landmark
        if lm and lm.kind == "asset":
            a = asset_tags().get((lm.ref or "").upper())
            if not a:
                return {**base, "status": "noop", "explanation": f"Unknown asset tag {lm.ref}. Known: {', '.join(sorted(asset_tags()))}."}
            aobj = st.objs[a["object_id"]]
            anchor, r_anchor, name = _xz(world_box(aobj)[0]), _half_xz(aobj), lm.ref.upper()
        else:
            anchor, r_anchor, name = engine.FRONT_ENTRY_W, 0.0, "the entrance (door)"
        radii = [r_anchor + r_obj + s for s in (0.1, 0.25, 0.4, 0.6, 0.85, 1.1)]
        cands = [(p - c, 0.0) for p in _ring(anchor, radii, 24)]
        score = lambda d, yaw, q: float(np.linalg.norm(c + d - anchor))  # noqa: E731
        what = f"place next to {name}"
    elif intent.action == "against_wall":
        inside = st.grids["inside"]
        dwall = ndimage.distance_transform_edt(inside) * CELL
        origin = st.grids["origin"]

        def wall_d(p):
            ij = np.clip(np.floor((p - origin) / CELL).astype(int), 0, np.array(inside.shape) - 1)
            return float(dwall[tuple(ij)])

        cands = [(p - c, 0.0) for p in _ring(c, (0.15, 0.3, 0.5, 0.75, 1.0, 1.3), 16)]
        score = lambda d, yaw, q: wall_d(c + d) + 0.3 * float(np.linalg.norm(d))  # noqa: E731
        what = "push against the nearest wall"
    elif intent.action == "clear_route":
        path = _route_points(st, asset)
        i = int(np.argmin(np.linalg.norm(path - c, axis=1)))
        away = c - path[i]
        away = away / np.linalg.norm(away) if np.linalg.norm(away) > 1e-6 else np.array([1.0, 0])
        tang = np.array([-away[1], away[0]])
        cands = [(away * s + tang * l, 0.0) for s in (0.2, 0.35, 0.5, 0.7, 0.9, 1.2) for l in (0, -0.2, 0.2, -0.4, 0.4)]
        cands += [(p - c, 0.0) for p in _ring(c, (0.3, 0.5, 0.8), 16)]

        def score(d, yaw, q):  # off the route, then moved as little as possible
            return (0 if _points_to_path(q["moved"], path) > ROUTE_NEAR_U else 1, float(np.linalg.norm(d)))

        def accept(o):  # really off the old route, and the route did not get longer
            off = _points_to_path(engine.quick_check(edits, o["edit"])["moved"], path)
            return off > ROUTE_NEAR_U and (o["preview"].get("route_delta_m") or 0) <= 0.05
        what = f"clear the route to {tag_of(asset) or asset}"

    # ---- exact request first (translate / rotate), then search
    chosen, exact, opts = None, False, []
    if exact_edit:
        ex = _with_clutter(edits, {"edit": exact_edit, "preview": engine.preview(edits, exact_edit, target)})
        opts.append(ex)
        if ex["preview"]["verdict"] != "blocked":
            chosen, exact = ex, True
    if chosen is None or not _good(chosen):
        found = search(edits, mid, cands, score, target, accept=accept)
        opts += [o for o in found if o["edit"] != exact_edit]
        if chosen is None and found:
            chosen = found[0]
    ok = lambda o: o["preview"]["verdict"] != "blocked" and (accept is None or accept(o))  # noqa: E731
    if chosen is None or not ok(chosen):
        why = (chosen or (opts[0] if opts else None) or {}).get("preview", {}).get("reasons") or \
            ["no candidate pose passed the local checks"]
        if chosen is not None and chosen["preview"]["verdict"] != "blocked" and accept is not None:
            why = ["no reachable spot nearby takes it off the route without making the route longer"]
        return {**base, "status": "refused", "movable_id": mid, "label": mv[mid]["label"],
                "explanation": f"No safe pose found to {what} ({mv[mid]['label']}): {'; '.join(why)}.",
                "alternatives": [_alt(o) for o in opts[:3]]}

    pv, e = chosen["preview"], chosen["edit"]
    alts = [_alt(o) for o in opts if o is not chosen and o["preview"]["verdict"] != "blocked"][:3]
    auto = _good(chosen) and (exact or exact_edit is None)
    return {**base, "status": "proposal", "movable_id": mid, "label": mv[mid]["label"], "action": intent.action,
            "edit": e, "exact": exact or exact_edit is None, "preview": pv, "auto_apply": auto,
            "footprint_occupied_frac": chosen.get("footprint_occupied"),
            "target_center_world": [round(float(c[0] + e["translate_world"][0]), 4), None,
                                    round(float(c[1] + e["translate_world"][2]), 4)],
            "target_asset_id": target, "alternatives": alts,
            "explanation": _explain(mv[mid]["label"], what, chosen, opts[0] if exact_edit else None, auto, target)}


def _alt(o: dict) -> dict:
    pv = o["preview"]
    return {"edit": o["edit"], "verdict": pv["verdict"], "gaps_min_m": (pv.get("gaps_m") or {}).get("min"),
            "route_delta_m": pv.get("route_delta_m"), "reasons": pv.get("reasons", [])[:2],
            "footprint_occupied_frac": o.get("footprint_occupied"),
            "moved_m": round(float(np.hypot(o["edit"]["translate_world"][0], o["edit"]["translate_world"][2])) * MPU, 2)}


def _explain(label: str, what: str, chosen: dict, exact_opt: dict | None, auto: bool, target: str | None) -> str:
    pv, e = chosen["preview"], chosen["edit"]
    moved = float(np.hypot(e["translate_world"][0], e["translate_world"][2])) * MPU
    parts = [f"{label}: {what}."]
    if exact_opt is not None and chosen is not exact_opt:
        parts.append(f"The exact move was {exact_opt['preview']['verdict']} "
                     f"({'; '.join(exact_opt['preview']['reasons'][:2])}), so I picked the nearest workable pose.")
    parts.append(f"Proposed: shift {moved:.2f} m" + (f", turn {e['yaw_deg']:+g}°" if e["yaw_deg"] else "") + ".")
    parts.append(f"Check: {pv['verdict']}: {'; '.join(pv['reasons'])}.")
    g = pv.get("gaps_m") or {}
    if g:
        gm = g.get("min")
        parts.append("Closest gap " + (f"{gm:.2f} m" if gm is not None else "> 2.4 m") +
                     (f" at {pv['gaps_band_m'][0]}–{pv['gaps_band_m'][1]} m height." if pv.get("gaps_band_m") else "."))
    if pv.get("route_delta_m") is not None and target:
        parts.append(f"Route to {tag_of(target) or target}: {pv['route_delta_m']:+.2f} m.")
    occ = chosen.get("footprint_occupied")
    if occ is not None and occ > CLUTTER_MAX:
        parts.append(f"{occ:.0%} of the new footprint already holds scanned clutter at the object's height.")
    if not auto:
        why = []
        if pv["verdict"] != "allowed":
            why.append(pv["verdict"])
        if _gap_min(g) < MIN_GAP_M:
            why.append(f"gap below {MIN_GAP_M:.2f} m")
        if occ is not None and occ > CLUTTER_MAX:
            why.append("cluttered spot")
        if exact_opt is not None and chosen is not exact_opt:
            why.append("not the exact pose you asked for")
        parts.append("Needs your confirmation" + (f" ({', '.join(why)})." if why else "."))
    return " ".join(parts)
