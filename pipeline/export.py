from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from . import config  # noqa: F401  (sets MPLCONFIGDIR before matplotlib loads)

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .geometry import obb_corners_xz, oriented_box

CLASS_COLOURS = {
    "pump": "#ef4444",
    "motor": "#f97316",
    "valve": "#eab308",
    "tank": "#a855f7",
    "cabinet": "#3b82f6",
    "pipe": "#14b8a6",
    "ladder": "#84cc16",
    "crate": "#a16207",
    "trolley": "#ec4899",
    "sign": "#22d3ee",
    "door": "#64748b",
    "other": "#9ca3af",
}


def _r(values: Any, digits: int = 5) -> list[float]:
    return [round(float(v), digits) for v in np.asarray(values).ravel()]


def obb_json(obb: dict[str, Any]) -> dict[str, Any]:
    return {
        "center": _r(obb["center"]),
        "extent": _r(obb["extent"]),
        "rotation": [_r(row, 6) for row in np.asarray(obb["rotation"])],
        "yaw_deg": round(float(np.degrees(obb.get("yaw", 0.0))), 2),
    }


def structure_object(object_id: str, plane: dict[str, Any], pts: np.ndarray, splat_count: int) -> dict[str, Any]:
    obb = oriented_box(pts, 2, 98)
    lo, hi = np.percentile(pts, [2, 98], axis=0)
    return {
        "object_id": object_id,
        "class": plane["label"].rstrip("0123456789") if plane["label"].startswith("wall") else plane["label"],
        "display_label": plane["label"].replace("wall", "Wall ").title(),
        "class_confidence": 0.95,
        "label_source": "structure",
        "center": _r(obb["center"]),
        "aabb_min": _r(lo),
        "aabb_max": _r(hi),
        "obb": obb_json(obb),
        "splat_count": int(splat_count),
        "voxel_count": int(len(pts)),
        "source": "structure_plane",
        "asset_id": None,
        "mapping_method": None,
        "mapping_confidence": None,
        "relations": [],
        "plane": {"normal": _r(plane["normal"], 6), "offset": round(float(plane["offset"]), 6), "rms": round(float(plane["rms"]), 5)},
    }


def instance_object(seg: Any, desc: dict[str, Any], label: tuple[str, float, str]) -> dict[str, Any]:
    cls, confidence, display = label
    lo, hi = desc["aabb"]
    obj: dict[str, Any] = {
        "object_id": None,
        "class": cls,
        "display_label": display,
        "class_confidence": round(float(confidence), 3),
        "label_source": "heuristic",
        "center": _r(desc["obb"]["center"]),
        "aabb_min": _r(lo),
        "aabb_max": _r(hi),
        "obb": obb_json(desc["obb"]),
        "splat_count": desc["splats"],
        "voxel_count": desc["voxels"],
        "source": seg.kind,
        "asset_id": None,
        "mapping_method": None,
        "mapping_confidence": None,
        "relations": [],
        "features": {
            "linearity": round(desc["eigen"]["linearity"], 3),
            "planarity": round(desc["eigen"]["planarity"], 3),
            "scattering": round(desc["eigen"]["scattering"], 3),
            "fill_ratio": round(desc["fill"], 3),
            "tubular_fraction": round(desc["tubular_fraction"], 3),
            "red_fraction": round(desc["red_fraction"], 3),
            "mean_lab": _r(desc["lab"], 1),
            "chroma": round(desc["chroma"], 1),
            "dims_m": {"width": round(desc["w_m"], 3), "depth": round(desc["d_m"], 3), "height": round(desc["h_m"], 3)},
        },
        "height_above_floor_m": {"bottom": round(desc["bottom_m"], 3), "top": round(desc["top_m"], 3)},
        "segmentation_notes": list(seg.notes),
    }
    if seg.cylinder is not None:
        cyl = seg.cylinder
        obj["cylinder"] = {"centre": _r(cyl["centre"]), "direction": _r(cyl["direction"], 4), "radius": round(cyl["radius"], 4), "length": round(cyl["length"], 4), "rms": round(cyl["rms"], 4)}
    return obj


def _draw_boxes(ax_front: Any, ax_top: Any, objects: list[dict[str, Any]], coloured: bool) -> None:
    for obj in objects:
        if obj.get("source") == "structure_plane":
            continue
        colour = CLASS_COLOURS.get(obj["class"], "#9ca3af") if coloured else "#374151"
        lo, hi = obj["aabb_min"], obj["aabb_max"]
        ax_front.add_patch(plt.Rectangle((lo[0], -hi[1]), hi[0] - lo[0], hi[1] - lo[1], fill=coloured, alpha=0.25 if coloured else 1, lw=0.7, ec=colour, fc=colour))
        obb = {"center": obj["obb"]["center"], "extent": obj["obb"]["extent"], "rotation": obj["obb"]["rotation"]}
        corners = obb_corners_xz(obb)
        ax_top.add_patch(plt.Polygon(corners, closed=True, fill=coloured, alpha=0.3 if coloured else 1, lw=0.7, ec=colour, fc=colour))


def write_before_after(before: list[dict[str, Any]], after: list[dict[str, Any]], points: np.ndarray, out_path: Path, title_after: str) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(2, 2, figsize=(20, 9), gridspec_kw={"height_ratios": [1.1, 1]})
    sample = points[np.random.default_rng(0).choice(len(points), min(len(points), 40000), replace=False)]
    n_before = sum(1 for o in before if o.get("source") != "structure_plane")
    n_after = sum(1 for o in after if o.get("source") != "structure_plane")
    for col, (objs, coloured, title) in enumerate(((before, False, f"Before: {n_before} DBSCAN clusters, axis-aligned"), (after, True, title_after.format(n=n_after)))):
        front, top = axes[0, col], axes[1, col]
        front.scatter(sample[:, 0], -sample[:, 1], s=0.05, c="#d1d5db")
        top.scatter(sample[:, 0], sample[:, 2], s=0.05, c="#d1d5db")
        _draw_boxes(front, top, objs, coloured)
        front.set_title(title + " - front (x, -y)")
        top.set_title("top (x, z), oriented boxes")
        for ax in (front, top):
            ax.set_aspect("equal")
            ax.set_xlim(-5.2, 4.2)
        front.set_ylim(-1.2, 1.0)
        top.set_ylim(-3.7, -0.6)
    handles = [plt.Rectangle((0, 0), 1, 1, fc=c, alpha=0.6) for c in CLASS_COLOURS.values()]
    axes[0, 1].legend(handles, CLASS_COLOURS.keys(), loc="upper right", fontsize=7, ncol=4)
    fig.tight_layout()
    fig.savefig(out_path, dpi=110)
    plt.close(fig)


def write_diagnostics(objects: list[dict[str, Any]], nav: dict[str, Any], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(14, 6))
    for obj in objects:
        if obj["source"] == "structure_plane":
            continue
        lo, hi = obj["aabb_min"], obj["aabb_max"]
        colour = CLASS_COLOURS.get(obj["class"], "#9ca3af")
        ax.add_patch(plt.Rectangle((lo[0], -hi[1]), hi[0] - lo[0], hi[1] - lo[1], fill=False, linewidth=0.8, ec=colour))
        ax.text(obj["center"][0], -obj["center"][1], obj["object_id"].replace("OBJ-", ""), fontsize=4)
    path = np.asarray(nav["path"], dtype=float)
    if len(path):
        ax.plot(path[:, 0], -path[:, 1], "r-", linewidth=1.5)
    ax.set_aspect("equal", adjustable="box")
    ax.set_title("Framed objects by class and route, front view")
    ax.set_xlabel("x")
    ax.set_ylabel("-y")
    fig.tight_layout()
    fig.savefig(out_path, dpi=130)
    plt.close(fig)


def object_metrics(objects: list[dict[str, Any]]) -> dict[str, Any]:
    equipment = [o for o in objects if o["source"] != "structure_plane"]
    splats = [o["splat_count"] for o in equipment]
    return {
        "objects_total": len(objects),
        "structure": len(objects) - len(equipment),
        "equipment_and_pipes": len(equipment),
        "per_class": dict(Counter(o["class"] for o in objects).most_common()),
        "median_splats_per_object": float(np.median(splats)) if splats else 0.0,
        "bound_assets": sum(1 for o in objects if o.get("asset_id")),
    }
