"""Stage 6 — map: bind Excel assets to extracted objects; pin the faulty target.

Procedural, class-compatible mapping (the brief allows random/procedural mapping):
  * the faulty target (ASSET-017 / P-005, FOULING, health 44 — lowest health, criticality A)
    is pinned to a reachable pump-like object at a long walk from the entrance
  * healthy/watch assets are placed preferentially on objects along the route, degraded ones
    away from it (brief: "normal statuses to surrounding assets along the path")
  * every binding carries mapping_method + mapping_confidence (DOC-3D-MAPPING: never silently
    guess identity); objects without an Excel asset stay labelled scene objects

Outputs: public/assets/registry.json, public/assets/objects.json (objects + their binding)
"""

from __future__ import annotations

import argparse

import numpy as np
from skimage.graph import MCP_Geometric

from pipeline.common import DERIVED, ROOT, WEB_ASSETS, read_json, write_json
from pipeline.excel import PackStore
from pipeline.navigate import PROXIMITY_RADIUS, Nav, box_footprint_distance, route, stand_point

TARGET_ASSET = "ASSET-017"
POOLS = {
    "PROCESS_PUMP": ["pump", "motor", "clutter"],
    "ELECTRIC_MOTOR": ["motor", "pump", "clutter"],
    "CONTROL_VALVE": ["valve_assembly", "vertical_pipe", "pipe_run", "instrument"],
    "PRESSURE_TRANSMITTER": ["instrument", "valve_assembly", "vertical_pipe", "clutter"],
    "VIBRATION_SENSOR": ["instrument", "valve_assembly", "pump", "clutter"],
}
RANK_CONFIDENCE = [0.6, 0.45, 0.3, 0.25]
TARGET_MAX_GAP = 0.45  # m between the stand-point and the target box


def _eligible(o: dict, asset_class: str) -> bool:
    if asset_class in ("PROCESS_PUMP", "ELECTRIC_MOTOR"):
        return o["touches_floor"] and max(o["extents"]) < 1.2
    return o["class"] not in ("ceiling_pipe",)


def entrance(nav: Nav) -> np.ndarray:
    """Rail endpoint closest to the south doorway (the footprint protrusion at max z)."""
    skel = nav.skeleton
    from scipy import ndimage

    nbr = ndimage.convolve(skel.astype(np.uint8), np.ones((3, 3), dtype=np.uint8), mode="constant") * skel
    ends = np.argwhere(skel & (nbr == 2))
    return nav.to_xz(ends[np.argmax(ends[:, 1])])


def map_assets(seed: int = 7, target_object: str | None = None) -> dict:
    rng = np.random.default_rng(seed)
    nav = Nav()
    seg = read_json(DERIVED / "objects.json")
    objects = seg["objects"]
    store = PackStore.load()
    config_path = ROOT / "pipeline" / "scene_config.json"
    config = read_json(config_path) if config_path.exists() else {}
    start = np.array(config["start_xz"]) if config.get("start_xz") else entrance(nav)
    if not target_object and config.get("target_point_xyz"):
        tp = np.array(config["target_point_xyz"])
        target_object = min(objects, key=lambda o: np.linalg.norm(np.array(o["center"]) - tp))["object_id"]

    mcp = MCP_Geometric(nav.cost, fully_connected=True)
    walk_cost, _ = mcp.find_costs([nav.to_cell(start)])

    # --- faulty target -------------------------------------------------------------------
    t_state = store.asset(TARGET_ASSET)["state"]
    candidates = []
    for o in objects:
        if target_object and o["object_id"] != target_object:
            continue
        if not target_object and (not _eligible(o, "PROCESS_PUMP") or o["class"] not in POOLS["PROCESS_PUMP"]):
            continue
        sp = stand_point(nav, o)
        if sp is None:
            continue
        c = walk_cost[nav.to_cell(sp)]
        if np.isfinite(c):
            pref = POOLS["PROCESS_PUMP"].index(o["class"])
            gap = float(box_footprint_distance(sp[None], o)[0])
            candidates.append((gap > TARGET_MAX_GAP, pref, -c, o, sp))
    if not candidates:
        raise RuntimeError("no reachable pump-like object for the target")
    candidates.sort(key=lambda t: t[:3])  # walk-up-able first, then most pump-like, then longest walk
    *_, t_obj, t_sp = candidates[0]
    path = route(nav, start, t_sp)
    near_route = {
        o["object_id"] for o in objects
        if box_footprint_distance(path, o).min() <= PROXIMITY_RADIUS and o["object_id"] != t_obj["object_id"]
    }

    entries = [{
        "object_id": t_obj["object_id"], "asset_id": TARGET_ASSET, "tag": t_state["tag"],
        "asset_class": t_state["asset_class"], "mapping_method": "pinned_faulty_target",
        "mapping_confidence": 0.8 if target_object else 0.5,
        "reason": "pre-determined faulty target (lowest health, criticality A) pinned to "
        + ("a team-confirmed object" if target_object else "the most pump-like reachable object (heuristic)"),
    }]
    used = {t_obj["object_id"]}

    # --- remaining assets: healthy along the route, degraded away from it ---------------------
    order = [a for a in store.asset_ids() if a != TARGET_ASSET]
    rng.shuffle(order)
    healthy_first = sorted(order, key=lambda a: store.asset(a)["state"]["condition_state"] not in ("healthy", "watch"))
    for asset_id in healthy_first:
        st = store.asset(asset_id)["state"]
        healthy = st["condition_state"] in ("healthy", "watch")
        pool = POOLS[st["asset_class"]]
        best = None
        for rank, cls in enumerate(pool):
            opts = [o for o in objects if o["class"] == cls and o["object_id"] not in used and _eligible(o, st["asset_class"])]
            if not opts:
                continue
            on_route = [o for o in opts if o["object_id"] in near_route]
            off_route = [o for o in opts if o["object_id"] not in near_route]
            prefer = (on_route or off_route) if healthy else (off_route or on_route)
            best = (rank, prefer[int(rng.integers(len(prefer)))])
            break
        if best is None:
            continue
        rank, o = best
        used.add(o["object_id"])
        entries.append({
            "object_id": o["object_id"], "asset_id": asset_id, "tag": st["tag"], "asset_class": st["asset_class"],
            "mapping_method": "procedural_class_compatible",
            "mapping_confidence": round(min(RANK_CONFIDENCE[rank], 0.4 + 0.5 * o["label_confidence"]), 2),
            "reason": f"{st['asset_class']} placed on a '{o['class']}' object"
                      f"{' near the route' if o['object_id'] in near_route else ''}",
        })

    by_obj = {e["object_id"]: e for e in entries}
    cards = {c["asset_id"]: c for c in store.asset_cards()}
    web_objects = []
    for o in objects:
        e = by_obj.get(o["object_id"])
        rec = {k: o[k] for k in ("object_id", "center", "extents", "yaw", "n_points", "mean_rgb", "class",
                                 "label_confidence", "label_source", "height_above_floor", "touches_floor")}
        if e:
            card = cards[e["asset_id"]]
            rec["asset"] = {**e, "health_score": card["health_score"], "condition_state": card["condition_state"],
                            "issue_code": card["issue_code"], "criticality": card["criticality"]}
        web_objects.append(rec)

    registry = {
        "mapping_note": "Procedural mapping (allowed by the brief). Excel Scene_Anchors coordinates are placeholders "
                        "and are replaced by these bindings.",
        "start_xz": start.round(3).tolist(),
        "start_label": "south doorway (rail endpoint at max z)",
        "target": {"asset_id": TARGET_ASSET, "tag": t_state["tag"], "object_id": t_obj["object_id"],
                   "stand_point_xz": t_sp.round(3).tolist(), "issue_code": t_state["issue_code"],
                   "health_score": t_state["health_score"]},
        "entries": entries,
        "objects_total": len(objects),
        "objects_mapped": len(entries),
        "objects_near_route": len(near_route),
    }
    write_json(WEB_ASSETS / "registry.json", registry)
    write_json(WEB_ASSETS / "objects.json", {"frame": "world, y up", "objects": web_objects})
    return registry


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--target-object", help="pin the faulty target to this OBJ-xxx (e.g. a visually confirmed pump)")
    args = ap.parse_args()
    r = map_assets(args.seed, args.target_object)
    print(f"map: {r['objects_mapped']}/{r['objects_total']} objects bound to Excel assets; "
          f"target {r['target']['tag']} -> {r['target']['object_id']}; {r['objects_near_route']} objects near route")


if __name__ == "__main__":
    main()
