from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from .classify import classify, describe, pipe_neighbours, quality_filter
from .config import SCHEMA_VERSION
from .export import instance_object, object_metrics, structure_object, write_before_after, write_diagnostics
from .filtering import clean_splats, splat_cloud, voxel_aggregate
from .instances import extract_instances
from .io_ply import load_splats
from .mapping import assign_stable_ids, bind_assets, load_assets, load_overrides, load_previous_objects, reachable_floor
from .navigation import plan_mission
from .structure import fit_structure

PIPELINE_VERSION = "tab2-segmentation-1"


def run(args: argparse.Namespace) -> None:
    t0 = time.time()
    ply = Path(args.ply)
    workbook = Path(args.workbook) if args.workbook else None
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    previous, previous_path = load_previous_objects([Path(args.previous)] if args.previous else [out_dir / "scene_objects.json", out_dir / "baseline" / "scene_objects.json"])

    frame = json.loads(Path(args.frame_calibration).read_text(encoding="utf-8"))["frame_calibration"] if args.frame_calibration else None

    data, _, col = load_splats(ply, args.max_rows)
    cloud, filter_stats = clean_splats(splat_cloud(data, col))
    voxels = voxel_aggregate(cloud, voxel=0.02)
    structure = fit_structure(voxels.xyz, voxels.weight, frame)
    scale = structure["scale"]
    mpu = scale["metres_per_unit"]

    inst = extract_instances(voxels.xyz, voxels.lab, structure, mpu)
    segments = inst["segments"]
    descs = [describe(seg, voxels, structure, mpu) for seg in segments]
    keep, dropped = quality_filter(segments, descs, voxels.xyz)
    segments = [segments[i] for i in keep]
    descs = [descs[i] for i in keep]
    labels = classify(segments, descs, voxels.xyz)
    neighbours = pipe_neighbours(segments, descs, labels, voxels.xyz)

    objects: list[dict[str, Any]] = []
    for k, plane in enumerate(structure["planes"]):
        mask = plane["mask"]
        objects.append(structure_object(f"STRUCT-{k + 1:03d}", plane, voxels.xyz[mask], int(voxels.count[mask].sum())))
    instance_objects = [instance_object(seg, desc, label) for seg, desc, label in zip(segments, descs, labels)]
    id_report = assign_stable_ids(instance_objects, previous)
    for obj, hits in zip(instance_objects, neighbours):
        obj["relations"] = [{"type": "connected_pipe", "object_id": instance_objects[j]["object_id"]} for j in hits]
    instance_objects.sort(key=lambda o: o["object_id"])
    objects.extend(instance_objects)

    floor_mask = next(p["mask"] for p in structure["planes"] if p["label"] == "floor")
    height = structure["floor_y"] - voxels.xyz[:, 1]
    obstacles = (height > 0.15 / mpu) & (height < 1.8 / mpu) & ~structure["structure"]
    floor = reachable_floor(voxels.xyz, floor_mask, obstacles)
    mapping_report = bind_assets(objects, load_assets(workbook), floor, mpu, load_overrides(out_dir / "labels_override.json"))

    nav, nav_targets = plan_mission(cloud.xyz, structure, objects, mpu, out_dir)

    metrics = object_metrics(objects)
    pipeline_stats = {
        "version": PIPELINE_VERSION,
        "filter": filter_stats,
        "voxels": voxels.stats,
        "structure_planes": [p["label"] for p in structure["planes"]],
        "rejected_wall_candidates": len(structure["rejected_walls"]),
        "instances": inst["stats"],
        "quality_filter_dropped": dict(dropped),
        "stable_ids": {**id_report, "matched_against": previous_path},
        "mapping": mapping_report,
        "metrics": metrics,
        "runtime_s": None,
    }
    scene = {
        "schema_version": SCHEMA_VERSION,
        "frame": "ply_raw",
        "metres_per_unit": mpu,
        "scale_calibration": scale,
        "source_ply": str(ply),
        "pipeline": {"version": PIPELINE_VERSION, "voxel_size": voxels.voxel, "floor_y": round(structure["floor_y"], 5), "ceiling_y": round(structure["ceiling_y"], 5)},
        "objects": objects,
    }
    (out_dir / "scene_objects.json").write_text(json.dumps(scene, indent=2), encoding="utf-8")
    (out_dir / "nav.json").write_text(json.dumps(nav, indent=2), encoding="utf-8")
    (out_dir / "nav_targets.json").write_text(json.dumps(nav_targets, indent=2), encoding="utf-8")
    diagnostics = out_dir / "diagnostics"
    write_diagnostics(objects, nav, diagnostics / "boxes_front.png")
    write_before_after(previous, objects, voxels.xyz, diagnostics / "before_after.png", "After: {n} objects (pipes + HDBSCAN + merge/split), yaw OBBs by class")
    pipeline_stats["runtime_s"] = round(time.time() - t0, 1)
    (diagnostics / "segmentation_metrics.json").write_text(json.dumps(pipeline_stats, indent=2, default=str), encoding="utf-8")

    print(f"wrote {len(objects)} objects ({metrics['bound_assets']} bound assets) to {out_dir / 'scene_objects.json'}")
    print(f"classes: {metrics['per_class']}")
    print(f"stable ids: {id_report}; target: {mapping_report.get('target')}")
    st = nav["stats"]
    print(
        f"wrote path with {len(nav['path'])} points, {nav['path_length_m']:.2f} m, min clearance {st['min_clearance_m']:.2f} m, "
        f"{st['duration_s']:.1f} s to {out_dir / 'nav.json'}; approach poses for {nav_targets['summary']['reachable']}/{nav_targets['summary']['bound_assets']} assets in nav_targets.json"
    )
    print(f"runtime {pipeline_stats['runtime_s']} s; metrics in {diagnostics / 'segmentation_metrics.json'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Valmet derived scene artifacts.")
    parser.add_argument("--ply", default="Equipment Room.ply")
    parser.add_argument("--workbook", default="Valmet_SinceAI_2026_Synthetic_Industrial_Metaverse_Builder_Pack (1) (2) (1).xlsx")
    parser.add_argument("--out-dir", default="data/derived")
    parser.add_argument("--previous", default=None, help="scene_objects.json to keep object ids stable against (default: current output, then baseline)")
    parser.add_argument("--max-rows", type=int, default=None)
    parser.add_argument(
        "--frame-calibration",
        default=None,
        help="JSON with a 'frame_calibration' block (data/derived/splat_alignment.json) for a splat registered into ply_raw: keeps its metres_per_unit and ceiling height",
    )
    run(parser.parse_args())


if __name__ == "__main__":
    main()
