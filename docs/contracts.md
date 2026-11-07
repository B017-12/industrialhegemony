# Artifact And API Contracts

All scene coordinates are written in raw PLY frame. Viewers may transform a parent group for display, but generated files must not pre-flip coordinates.

## `data/derived/scene_objects.json`

Top-level shape:

```json
{
  "schema_version": "1.0",
  "frame": "ply_raw",
  "metres_per_unit": 1.2865,
  "scale_calibration": {
    "metres_per_unit": 1.2865,
    "metres_per_unit_range": [1.235, 1.3379],
    "floor_to_ceiling_units": 1.9433,
    "room_height_prior_m": [2.4, 2.6],
    "floor_ceiling_tilt_deg": 0.9,
    "method": "floor_to_ceiling_prior",
    "reasoning": "Human-readable explanation of the assumption."
  },
  "source_ply": "Equipment Room.ply",
  "pipeline": {"version": "tab2-segmentation-1", "voxel_size": 0.02, "floor_y": 1.07191, "ceiling_y": -0.8714},
  "objects": []
}
```

Read `metres_per_unit` from this file; don't hard-code 1.25. It's an assumption from a room-height prior, not a measurement.

Each object:

```json
{
  "object_id": "OBJ-0001",
  "class": "pump",
  "display_label": "P-002 (PROCESS_PUMP) - procedural",
  "class_confidence": 0.4,
  "label_source": "heuristic",
  "center": [0.0, 0.0, 0.0],
  "aabb_min": [0.0, 0.0, 0.0],
  "aabb_max": [0.0, 0.0, 0.0],
  "obb": {
    "center": [0.0, 0.0, 0.0],
    "extent": [0.0, 0.0, 0.0],
    "rotation": [[0.99, 0, -0.1], [0, 1, 0], [0.1, 0, 0.99]],
    "yaw_deg": 5.7
  },
  "splat_count": 0,
  "voxel_count": 0,
  "source": "auto_hdbscan",
  "asset_id": "ASSET-014",
  "mapping_method": "procedural_demo_target",
  "mapping_confidence": 0.5,
  "mapping_notes": "Why this object was chosen.",
  "relations": [{"type": "connected_pipe", "object_id": "OBJ-0042"}],
  "stable_id_iou": 0.43,
  "features": {
    "linearity": 0.19, "planarity": 0.3, "scattering": 0.5,
    "fill_ratio": 0.33, "tubular_fraction": 0.15, "red_fraction": 0.06,
    "mean_lab": [33.6, 5.0, 9.0], "chroma": 10.3,
    "dims_m": {"width": 0.43, "depth": 0.2, "height": 0.51}
  },
  "height_above_floor_m": {"bottom": 0.46, "top": 0.93},
  "segmentation_notes": ["merged"],
  "cylinder": {"centre": [0, 0, 0], "direction": [0, 1, 0], "radius": 0.02, "length": 0.8, "rms": 0.005}
}
```

Field notes:

- `obb` is gravity-aligned: rotation about the y axis only. `rotation` is a row-major 3x3 matrix R whose columns are the box axes in world space. A box point is `world = center + R @ (local * extent)` with `local` in [-0.5, 0.5]^3, so `extent` holds full side lengths (x, y, z in the box frame; y is height). `yaw_deg` is informational.
- `aabb_min` / `aabb_max` are the 2nd-98th percentile bounds, kept for cheap culling and old consumers.
- `splat_count` is the number of cleaned source splats in the object. `voxel_count` is the number of 2 cm voxels; before Tab 2, `splat_count` held the voxel count.
- `features`, `height_above_floor_m`, `segmentation_notes`, `mapping_notes` and `stable_id_iou` are optional and only on instance objects. `cylinder` appears only when `source` is `pipe_fit`. Structure objects carry `plane` (`normal`, `offset`, `rms`) instead.
- `relations[].type` is currently only `connected_pipe` (the object is within about 6 cm of that pipe object).
- `stable_id_iou` is the 3D IoU with the previous run's object of the same id, or `null` for a new id.

Allowed `class` values: `pump`, `motor`, `valve`, `tank`, `cabinet`, `pipe`, `ladder`, `crate`, `trolley`, `sign`, `door`, `other` for instances; `floor`, `ceiling`, `wall` for structure. Old values (`scene_object`, `valve_or_sensor`, `cabinet_or_tank`, `door_or_wall_fixture`) are no longer produced.

Allowed `label_source` values: `heuristic`, `vlm`, `human`, `structure`.

Allowed `source` values: `auto_hdbscan` (HDBSCAN cluster after merge/split), `pipe_fit` (linear seed with cylinder fit), `structure_plane`, `manual`. `auto_dbscan` is legacy.

Asset bindings must be explicit. If a binding is procedural, set `mapping_method` to `procedural_demo_target` (ASSET-014 only, confidence 0.5), `procedural_class_match` (scene class matches the asset class, confidence at most 0.45) or `procedural_fallback` (no compatible class left, confidence at most 0.25). A person who binds an asset in the review mode writes `human_assigned` (confidence 0.45): the reviewer chose the object, but the Excel coordinates are placeholders, so the identity is still not verified against a nameplate. An override that matched the object to equipment in the posed video frames writes `video_evidence` (confidence 0.45, unverified). Cap `mapping_confidence` at or below `0.5`.

Object ids are kept stable across pipeline reruns by Hungarian matching on 3D OBB IoU (threshold 0.2) against the previous `scene_objects.json`. `labels_override.json` keys therefore stay attached to the same physical object, unless the segmentation of that object changes substantially.

## `data/derived/nav.json`

This is the default mission (Tab 3, `nav_version` `tab3-navigation-1`): the robot drives from the front entry of the walkable floor to an approach pose facing `ASSET-014` / P-002. Every position is raw PLY frame, on the floor plane (`y = floor_y`).

Top-level shape (arrays shortened):

```json
{
  "schema_version": "1.0",
  "nav_version": "tab3-navigation-1",
  "frame": "ply_raw",
  "target_asset_id": "ASSET-014",
  "target_object_id": "OBJ-0015",
  "cell_size": 0.05,
  "grid_origin": [-4.91809, 1.07191, -4.91882],
  "grid_shape": [84, 178],
  "start": [-0.24309, 1.07191, -0.99382],
  "goal": [-1.44309, 1.07191, -2.44382],
  "path": [[-0.24309, 1.07191, -0.99382]],
  "path_length_units": 1.88985,
  "path_length_m": 2.4313,
  "metres_per_unit": 1.2865,
  "occupancy_png": "data/derived/floor_occ.png",
  "diagnostics_png": "data/derived/diagnostics/nav_esdf.png",
  "targets_file": "data/derived/nav_targets.json",
  "start_name": "front_entry",
  "start_pose": {"position": [-0.24309, 1.07191, -0.99382], "yaw": -2.41953, "name": "front_entry"},
  "approach": {
    "position": [-1.44309, 1.07191, -2.44382], "yaw": -2.70331, "yaw_deg": -154.9,
    "standoff_m": 0.643, "standoff_ok": true, "drive_in": true, "clearance_m": 0.555,
    "object_id": "OBJ-0015", "asset_id": "ASSET-014"
  },
  "yaw_convention": "yaw = atan2(dx, dz) in raw PLY frame, radians, rotation about the raw +y axis from +z towards +x",
  "robot": {"robot_radius_m": 0.3, "v_max_mps": 0.35, "a_max_mps2": 0.25, "a_lat_mps2": 0.3, "turn_rate_dps": 60.0, "turn_acc_dps2": 120.0},
  "cost_params": {"formula": "c = 1 + w * exp(-d / sigma), ...", "w": 4.0, "sigma_m": 0.15, "obstacle_band_m": [0.12, 1.8], "min_obstacle_splats": 3, "inflation_radius_m": 0.3322},
  "grid_stats": {"walkable_cells": 1626, "walkable_area_m2": 6.728, "components": 8},
  "path_raw": [[0.0, 0.0, 0.0]],
  "path_shortcut": [[0.0, 0.0, 0.0]],
  "samples": [
    {"t": 0.0, "s": 0.0, "pos": [-0.24309, 1.07191, -0.99382], "yaw": -2.41953, "speed": 0.0, "phase": "drive"},
    {"t": 8.347, "s": 2.4313, "pos": [-1.44309, 1.07191, -2.44382], "yaw": -2.70331, "speed": 0.0, "phase": "arrived"}
  ],
  "stats": {
    "planner": "theta_star", "smoothing": "centripetal_catmull_rom", "smoothing_fallback": false, "pre_approach_waypoint": true,
    "path_length_m": 2.4313, "raw_length_m": 2.4298, "astar_length_m": 2.5049,
    "min_clearance_m": 0.5552, "min_margin_m": 0.2552, "mean_clearance_m": 1.2304,
    "drive_duration_s": 8.35, "turn_duration_s": 0.0, "duration_s": 8.35, "peak_speed_mps": 0.35, "max_curvature_per_m": 1.19
  }
}
```

Field notes:

- `path` is the smoothed route, resampled about every 0.05 units. Old consumers that only read `path`, `start`, `goal` and `path_length_*` keep working. `path_raw` holds the Theta* vertices and `path_shortcut` the vertices after the cost-aware shortcut, which are the spline's control points.
- `samples` is the timed motion profile, taken every 0.1 s (`sample_dt_s`), plus a final sample at the exact end time. Animate the robot by interpolating `pos` and `yaw` between samples using `t`; don't recompute any motion.
  - `s` is arc length in metres.
  - `speed` is in m/s.
  - `phase` is `drive`, then `turn` (turning in place at the goal, with `speed` 0), and the last sample is `arrived`.
  - `yaw` is wrapped to (-pi, pi], so unwrap it before interpolating.
- **Yaw** is `atan2(dx, dz)` in the raw PLY frame: radians, measured about the raw +y axis, from +z towards +x.
  - **Inside the `display-frame` group** (rotated 180 degrees about X), set `rotation.y = yaw` on a child whose forward axis is local +z. Because raw +y points down, that child's model must be flipped so its up is -y.
  - **Outside the group**, in display coordinates `(x, -y, -z)`, the heading is `rotation.y = atan2(dx, -dz) = pi - yaw`.
- `grid_origin` is the corner of cell (0, 0). The centre of cell (row j, col i) is `x = origin_x + (i + 0.5) * cell_size`, `z = origin_z + (j + 0.5) * cell_size`. Rows index z, columns index x.
- `stats.min_clearance_m` is the exact distance in metres from the robot centre to the nearest obstacle cell, checked on every spline sample. `min_margin_m` is that distance minus `robot.robot_radius_m`, and must be positive.
- `path_length_m` uses the calibrated `metres_per_unit` from `scene_objects.json`, which is also copied into `nav.json`.

## `data/derived/nav_targets.json`

This file holds an approach pose and a full precomputed mission for every bound asset, all starting from the same `start_pose`. It's for "Dispatch to [asset]" and for `GET /api/scene/nav?target=`.

```json
{
  "schema_version": "1.0",
  "nav_version": "tab3-navigation-1",
  "frame": "ply_raw",
  "metres_per_unit": 1.2865,
  "default_target_asset_id": "ASSET-014",
  "start_pose": {"position": [0, 0, 0], "yaw": 0.0, "name": "front_entry"},
  "yaw_convention": "...",
  "summary": {"bound_assets": 30, "reachable": 13, "unreachable": 17},
  "targets": [
    {
      "asset_id": "ASSET-001", "object_id": "OBJ-0139", "display_label": "CV-001 (CONTROL_VALVE) - procedural",
      "class": "valve", "mapping_method": "procedural_class_match",
      "reachable": true, "distance_to_walkable_m": 0.0,
      "approach": {"position": [0, 0, 0], "yaw": 0.0, "yaw_deg": 0.0, "standoff_m": 0.516, "standoff_ok": true, "drive_in": true, "clearance_m": 0.6},
      "mission": {"path": [], "path_raw": [], "path_shortcut": [], "samples": [], "stats": {}}
    },
    {"asset_id": "ASSET-003", "object_id": "OBJ-0035", "reachable": false, "distance_to_walkable_m": 1.98, "approach": null, "mission": null}
  ]
}
```

- `mission` has the same fields as the matching keys in `nav.json` (`path`, `path_raw`, `path_shortcut`, `samples`, `stats`). A `nav.json`-shaped answer for any target is therefore `{...nav.json top level, target_asset_id, target_object_id, approach, ...mission}`.
- `reachable` is false when the nearest walkable cell is more than 1.0 m (`max_reach_m`) from the object's footprint. Those assets lie outside the valid floor slice, and the viewer should say so rather than invent a path.
- `standoff_ok` is false when no walkable cell lies within 0.5 m ± 0.15 m of the footprint. In that case the closest reachable cell is used.
- `drive_in` is true when a walkable cell 0.25 m behind the pose (along -heading) exists. The robot then arrives already facing the asset, and the turn-in-place is small.

## `data/derived/nav_map.pgm` + `nav_map.yaml` (bonus)

This is a ROS `map_server` occupancy map:

- Pixel values: 254 = supported free floor, 0 = obstacle, 205 = unknown.
- `resolution` and `origin` are in metres.
- Map x is PLY x × `metres_per_unit`, and map y is PLY z × `metres_per_unit`.
- The obstacle mask is not inflated.

Nothing in the demo reads it.

## `data/derived/labels_override.json`

Human review and final display labels live here so regenerated pipeline output does not delete edits. The viewer merges each entry over the object with the same `object_id`. Only add entries a person has confirmed. The file was reset to `"overrides": {}` on 2026-11-06 because its 40 script-generated entries referenced the old segmentation; they are archived in `labels_override.legacy.json`.

```json
{
  "schema_version": "1.0",
  "overrides": {
    "OBJ-0001": {
      "class": "pump",
      "display_label": "Process pump candidate",
      "label_source": "human",
      "class_confidence": 0.8,
      "asset_id": "ASSET-014",
      "mapping_method": "procedural_demo_target",
      "mapping_confidence": 0.5,
      "review_notes": "Chosen as P-002 target for demo.",
      "review_status": "relabelled",
      "reviewer": "Jane Doe",
      "reviewed_at": "2026-11-07T03:40:12Z"
    }
  }
}
```

Tab 8 adds these optional fields. The earlier fields are unchanged, and every consumer still merges an entry field by field over the object with the same id:

| Field | Meaning |
|---|---|
| `review_status` | `confirmed` (class kept), `relabelled` (class or label changed), `rejected` (noise or not an object), `merged` (folded into `merged_into`) |
| `reviewer`, `reviewed_at` | Who wrote the entry, and when (ISO 8601, UTC). Required whenever `label_source` is `human`; the PATCH route stamps `reviewed_at` |
| `merged_into` | On a merged child: the parent's `object_id` |
| `merged_from` | On a merge parent: the child ids folded into it. The parent entry also carries the union `obb` (in the parent's yaw frame), `center`, `aabb_min` and `aabb_max` |
| `asset_id: null` with `mapping_method: null` | The asset was moved to another object, or unbound, by a reviewer. A side-effect entry like this has `reviewer` but keeps the object's own `label_source` |

Consumers hide objects whose `review_status` is `rejected` or `merged`: they are not drawn, not labelled and not bound. A rejected or merged object never holds an asset; the PATCH route unbinds it in the same write.

`pipeline/mapping.py` reads this file on every run. Objects with an `asset_id` key in their override are pinned to that value (an asset or null). Assets that a person bound are taken out of the procedural pool, and rejected or merged objects are not candidates. A rerun after a rebind therefore recomputes `nav.json` and `nav_targets.json` for the new object. The pipeline never copies labels into `scene_objects.json`; a pinned binding is written with `mapping_method: "human_assigned"`, or with `"video_evidence"` when the override entry says so (`PINNED_METHODS` in `pipeline/mapping.py`).

## `data/derived/crops/` (Tab 8)

The crop tour writes one PNG per object, `OBJ-xxxx.png`, plus `index.json`:

```json
{"crops": {"OBJ-0015": {"file": "OBJ-0015.png", "captured_at": "2026-11-07T03:20:00Z", "camera": {"position": [0, 0, 0], "target": [0, 0, 0]},
                        "bbox_px": [412, 188, 240, 260], "viewport_px": [760, 768], "width": 240, "height": 260}}}
```

`camera` is in display frame (the three.js scene after the 180-degree X flip), `bbox_px` is `[x, y, w, h]` of the crop inside the viewport. The crop shows the splat with the object's selected (accent) box.

## `data/derived/vlm_labels.json` (Tab 8, optional)

Written by `python3 -m pipeline.label_vlm` only when `OPENAI_API_KEY` is set. The viewer shows it as a suggestion; it never writes `human`.

```json
{"schema_version": "1.0", "model": "gpt-6.1-terra", "generated_at": "...", "threshold": 0.6,
 "labels": {"OBJ-0015": {"class": "valve", "confidence": 0.72, "short_description": "Handwheel valve on an insulated vertical pipe", "needs_review": false}}}
```

`confidence` is the model's self-reported value, which is poorly calibrated, so it only orders the queue. `needs_review` is `confidence < threshold`.

## Backend API

FastAPI on port 8000 (Tab 4). Every route has a Pydantic response model, and the OpenAPI spec is at `/openapi.json` with interactive docs at `/docs`.

- An unknown asset or target returns `404 {"detail": ...}`.
- A missing pipeline output returns `404` with a "run the pipeline first" message.
- Workbook rows are returned with all their columns; the fields listed below are guaranteed, and other fields pass through.

| Route | Purpose | Backing data |
|---|---|---|
| `GET /api/health` | `{ok, database, scene_objects, nav, nav_targets}` | files on disk |
| `GET /api/assets` | Asset list for the asset tree | Asset_Master + Current_State + scene binding |
| `GET /api/assets/{id}` | Identity, current state, recent events and work orders, documents, scene binding | Asset_Master, Current_State, Alarms_Events, Maintenance_History, RAG_Corpus_Index |
| `GET /api/assets/{id}/telemetry?metric=&from=&to=` | Time series for sparklines and charts, with the healthy-class band | Telemetry_Sample_3d |
| `GET /api/assets/{id}/events?status=&order=&limit=` | Events in priority order (default) or newest first | Alarms_Events |
| `GET /api/assets/{id}/documents` | Asset card, class guidance and plant-wide docs | RAG_Corpus_Index + Knowledge_Docs |
| `GET /api/scene/objects` | `scene_objects.json` unchanged (the viewer merges `labels_override.json`) | pipeline |
| `GET /api/scene/nav?target=` | Default mission, or the precomputed mission to `target` | `nav.json` + `nav_targets.json` |
| `GET /api/scene/anchors` | Scene_Anchors remapped onto real scene objects | Scene_Anchors + `scene_objects.json` + `nav_targets.json` |
| `GET /api/search?q=&limit=` | Keyword search over assets, issues, open events and documents | all sheets |
| `POST /api/copilot/query` | Evidence-backed answer with citations, confidence and safe next checks | all |
| `POST /api/copilot/stream` | The same answer as Server-Sent Events: `meta`, `delta`..., `answer`, `done` | all |
| `POST /api/work-orders/draft` | Draft only; no real control actions | Maintenance_History schema |
| `GET /api/workbook/builder-questions` | Builder_Questions rows, for the copilot's suggested questions (Tab 7) | Builder_Questions |
| `GET /api/labels/overrides` | `labels_override.json` as stored (Tab 8) | `labels_override.json` |
| `PATCH /api/labels/overrides/{object_id}` | One review action by a named reviewer (Tab 8) | writes `labels_override.json` |
| `POST /api/labels/restore` | Write entries back verbatim, for undo (Tab 8) | writes `labels_override.json` |
| `DELETE /api/labels/overrides/{object_id}` | Remove one entry (Tab 8) | writes `labels_override.json` |
| `GET /api/labels/summary` | Label-source and review counts (Tab 8) | `scene_objects.json` + overrides + crops |
| `POST /api/labels/crops/{object_id}`, `GET /api/labels/crops`, `GET /api/labels/crops/{object_id}.png` | Crop-tour images (Tab 8) | `data/derived/crops/` |
| `GET /api/labels/vlm` | `vlm_labels.json`, or 404 when the VLM was never run (Tab 8) | `data/derived/vlm_labels.json` |

### Scene binding (used by assets, asset detail and anchors)

The binding is the object in `scene_objects.json` whose `asset_id` matches, with `labels_override.json` entries merged in first. A person-confirmed override that rebinds an asset therefore takes effect without rerunning the pipeline.

- `GET /api/assets` items add `scene_object_id`, `mapping_method` and `mapping_confidence`. These are `null` when the asset is not bound.
- `GET /api/assets/{id}` adds two keys:
  - `scene`: `object_id`, `class`, `display_label`, `class_confidence`, `label_source`, `center`, `obb`, `aabb_min`, `aabb_max`, `mapping_method`, `mapping_confidence` and `mapping_notes`, or `null`;
  - `documents`: the same list as the documents route.

### `GET /api/assets/{id}/telemetry`

- `metric` is comma-separated. Unknown names return 422; names with no data for this asset are dropped. The default is every metric that has data (7 for pumps).
- `from` and `to` are inclusive ISO timestamps, for example `2026-10-07T00:00:00`.

```json
{
  "asset_id": "ASSET-014", "tag": "P-002", "asset_class": "PROCESS_PUMP", "from": null, "to": null,
  "metrics": [{"metric": "vibration_mm_s", "label": "Vibration", "unit": "mm/s"}],
  "timestamps": ["2026-10-05T00:00:00", "..."],
  "series": {"vibration_mm_s": [1.859, "..."]},
  "trends": {"vibration_mm_s": {"metric": "vibration_mm_s", "unit": "mm/s", "first_day": "2026-10-05", "last_day": "2026-10-07",
             "first_day_mean": 2.42, "last_day_mean": 4.57, "delta": 2.15, "delta_pct": 88.8, "min": 1.75, "max": 5.21, "samples": 144}},
  "baselines": {"vibration_mm_s": {"metric": "vibration_mm_s", "unit": "mm/s", "asset_class": "PROCESS_PUMP",
                "peer_asset_ids": ["ASSET-015", "ASSET-018"], "mean": 2.08, "p10": 1.83, "p90": 2.34, "samples": 288}}
}
```

- `series[m][i]` belongs to `timestamps[i]`. A missing reading is `null`.
- `trends` compares the daily mean on the first day of the window with the last day.
- `baselines` covers all samples from healthy peers of the same class. A peer is healthy when its `condition_state` is `healthy` or its `health_score` is at least 80; the asset itself is excluded. Draw `p10` to `p90` as the band.

### `GET /api/assets/{id}/events`

The response is `{asset_id, order, total, events[]}`.

- With `order=priority` (the default), events sort by status (open, then acknowledged, then closed), then events whose `event_code` matches the asset's current `issue_code`, then newest first. For ASSET-014 this starts with `EVT-00893` and `EVT-00136`.
- With `order=recent`, events are newest first.
- `status` filters by status, and `limit` is 1 to 500, default 50.

### `GET /api/assets/{id}/documents`

The response is `{asset_id, documents[]}`. Each document has `{doc_id, title, scope, document_role, file_name, mime_type, content, content_available}`.

- Order: the asset card (`DOC-ASSET-014`), then class guidance (`DOC-PROCESS_PUMP-CORE`), then plant-wide docs (`DOC-3D-MAPPING`, `DOC-FIELD-SAFETY`, `DOC-RAG-GUIDE`).
- The workbook has no content for the asset cards, so for them `content` is `null` and `content_available` is `false`.

### `GET /api/scene/nav?target=`

- **No target, or `target` equal to `nav.json`'s `target_asset_id`:** returns `nav.json` unchanged plus `reachable: true`.
- **Any other bound asset:** builds the response from `nav_targets.json`. It starts from the `nav.json` top level, then sets `target_asset_id`, `target_object_id`, `target_display_label`, `reachable`, `distance_to_walkable_m` and `approach`, plus the mission keys `path`, `path_raw`, `path_shortcut`, `samples` and `stats`. `goal` is `approach.position`, and `path_length_m` / `path_length_units` come from `mission.stats`.
- **Unreachable target:** returns 200 with `reachable: false`. `goal`, `path`, `samples`, `stats` and the path lengths are `null`; there is never a fabricated path. Show "outside scanned floor (`distance_to_walkable_m` m away)".
- **Asset with no binding or mission:** returns 404.

### `GET /api/scene/anchors`

```json
{
  "frame": "ply_raw", "metres_per_unit": 1.2865,
  "summary": {"anchors": 30, "remapped": 30, "unmapped": 0, "reachable": 13},
  "anchors": [{
    "scene_anchor_id": "ANCHOR-014", "asset_id": "ASSET-014", "tag": "P-002",
    "remapped": true, "mapping_status": "procedural_demo_target",
    "scene": {"object_id": "OBJ-0015", "center": [-1.733, 0.532, -3.063], "obb": {}, "mapping_confidence": 0.5},
    "reachable": true, "distance_to_walkable_m": 0.0,
    "excel_placeholder": {"x_local_m": 25.98, "y_local_m": 4.74, "z_local_m": 0.75, "scene_path": "/SyntheticPlant/AREA-04/P-002",
                          "mapping_status": "placeholder_until_valmet_scene_received", "mapping_confidence": 0.65}
  }]
}
```

- `scene` has the same fields as the scene binding, in raw PLY frame.
- `mapping_status` is the binding's `mapping_method`, or `unmapped`.
- `excel_placeholder` keeps the workbook's original synthetic coordinates and confidence, unchanged and clearly separated. Never use them as scene positions.

### `GET /api/search?q=`

```json
{"query": "pumps needing attention", "tokens": ["pump", "attention"], "total": 19, "asset_ids": ["ASSET-014", "ASSET-017"],
 "results": [{"type": "asset", "id": "ASSET-014", "title": "P-002 PROCESS_PUMP", "subtitle": "attention_required / CAVITATION_RISK / Chemical Preparation", "asset_id": "ASSET-014", "score": 1.0}]}
```

- **Tokens.** The query is lower-cased, stop words such as "needing", "show" and "the" are dropped, and a trailing plural "s" is removed.
- **Score.** The score is the fraction of tokens found in the record's text, weighted by type: asset 1.0, issue 0.9, document 0.8, event 0.7.
- **Types.** `asset`; `issue` (current issues as `STATE:<asset>`, plus `DQ-*`); `event` (open events only); `document`.
- **`asset_ids`.** These are the assets with the best asset score. Use them to highlight matches in 3D.

### Evidence IDs (copilot)

Every copilot claim cites IDs from the response's `evidence` array. The IDs are stable, so the UI can link them:

| ID | Source | Content |
|---|---|---|
| `ASSET:<asset_id>` | Asset_Master | identity, class, area, criticality |
| `STATE:<asset_id>` | Current_State | health, condition, issue, urgency, model confidence, recommended check |
| `MAP:<asset_id>` | scene_objects.json | scene binding, mapping method and confidence |
| `TEL:<asset_id>:<metric>` | computed | first-day vs last-day daily mean, delta, range (`values` has the numbers) |
| `BASELINE:<asset_class>:<metric>` | computed | healthy-class mean and 10th-90th percentile band |
| `EVENTS:<asset_id>:summary` | computed | event counts by status and current issue code |
| `EVT-*` | Alarms_Events | the top 8 events in priority order |
| `WO-*` | Maintenance_History | the 5 newest work orders |
| `CASE-*` | Historical_Service_Cases | same class and same issue code (up to 5) |
| `DQ-*` | Data_Quality | all issues for the asset, high severity first |
| `DOC-*` | Knowledge_Docs | the class core doc plus DOC-FIELD-SAFETY, DOC-RAG-GUIDE and DOC-3D-MAPPING |

Each evidence item is `{id, source, kind, text, record?, values?}`.
- `kind` is one of `asset`, `state`, `mapping`, `telemetry`, `baseline`, `event_summary`, `event`, `work_order`, `case`, `data_quality` or `document`.
- `record` is the source row.
- `values` holds the computed numbers.

### `POST /api/copilot/query`

Request:

```json
{
  "asset_id": "ASSET-014",
  "mode": "arrival_diagnosis",
  "question": null
}
```

- `mode` is one of the following; any other value returns 422.
  - `arrival_diagnosis` (default): the full report.
  - `status_line`: one sentence for HUD cards, in `summary` and in the single observation, for example "P-002 attention: vibration 4.57 mm/s vs 2.08 healthy, cavitation risk."
  - `question`: a free-text answer about the asset. It requires a non-empty `question`, otherwise 422.
- Without a key, `question` routes by keyword over events, telemetry, cases, work orders, data quality, mapping and safety. A question that matches no topic returns the arrival diagnosis with a note.

Response (the same shape for every mode):

```json
{
  "asset_id": "ASSET-014",
  "mode": "arrival_diagnosis",
  "question": null,
  "summary": "P-002 is flagged attention_required with CAVITATION_RISK: ...",
  "observations": [{"text": "Vibration daily mean rose from 2.42 to 4.57 mm/s, ...", "evidence_ids": ["TEL:ASSET-014:vibration_mm_s", "BASELINE:PROCESS_PUMP:vibration_mm_s"]}],
  "hypotheses": [{"text": "The combined trend matches historical PROCESS_PUMP cases ...", "evidence_ids": ["TEL:ASSET-014:vibration_mm_s", "CASE-026"]}],
  "next_safe_checks": ["Inspect process conditions before any physical intervention.", "Follow site procedures, lockout/tagout and permits; ... (DOC-FIELD-SAFETY)."],
  "caveats": ["The 3D binding to scene object OBJ-0015 is procedural_demo_target and must be verified on site; ..."],
  "confidence": {"score": 0.5, "reasons": [
    "Starting from workbook model confidence 0.68 (Current_State).",
    "-0.08 for high-severity data-quality issue DQ-0098 (stale_document_link).",
    "-0.03 for medium-severity data-quality issue DQ-0064 (timestamp_jitter).",
    "Capped at 0.5 because the 3D binding is procedural_demo_target and not visually verified."]},
  "generation": "deterministic",
  "cached": false,
  "model": null,
  "validation": {"ok": true, "errors": [], "attempts": 0},
  "evidence": [{"id": "TEL:ASSET-014:vibration_mm_s", "source": "computed", "kind": "telemetry", "text": "P-002 vibration daily mean rose from 2.42 mm/s ...", "values": {"first_day_mean": 2.42, "last_day_mean": 4.57}}]
}
```

**`generation`** says where the text came from:

| Value | Meaning |
|---|---|
| `llm` | The model answer passed validation (`model` names the model). |
| `deterministic` | No `OPENAI_API_KEY` is set, so the template was used. This is the normal offline mode. |
| `cached` | An LLM is configured but failed. This is the last validated `arrival_diagnosis` from `backend/cache/`, and `cached` is `true`. |
| `deterministic_fallback` | An LLM is configured but failed and no valid cache exists, so the template was used. Show a badge. |

**`validation`** is `{ok, errors[], attempts}`.

- `ok` refers to the answer that was returned.
- `errors` lists what was rejected along the way, for example "attempt 1: observations[0] uses numbers not found in the evidence: ['9.99']".
- `attempts` is the number of LLM calls: 0 without a key, at most 2.

The validator rejects an answer when any of the following is true:
- a claim cites no IDs, or cites an ID that is not in `evidence`;
- the prose mentions an evidence-like ID (`EVT-`, `CASE-`, `DQ-` and so on) that is not in the bundle;
- a number in the prose doesn't match a number in the evidence `text` or `values`. The match must be within half a unit of the number's last decimal place, or within 1%. Dates, IDs and tags (for example `P-002`) are ignored.

On failure the LLM is retried once with the errors appended. If it fails again, the cache is used, then the template. The template itself always passes.

**`confidence`** is computed in code, never by the model:
- start from `Current_State.model_confidence`;
- subtract 0.08 for each high-severity data-quality issue (at most 2) and 0.03 for each medium one;
- cap at 0.5 for `procedural_demo_target`, `procedural_class_match`, `human_assigned` or `video_evidence`, 0.25 for `procedural_fallback`, and 0.2 when the asset is unbound;
- the floor is 0.05.

There is one reason per step.

### `POST /api/copilot/stream`

This takes the same request as `/query`. The response is `text/event-stream`, with named events in this order:

| Event | `data` |
|---|---|
| `meta` | `{asset_id, mode, generation, cached, model, evidence_count}` |
| `delta` (repeated) | `{text}`: word chunks of the validated `summary`; joined, they equal `summary` |
| `answer` | the full `/query` response |
| `done` | `{ok}` (`validation.ok`) |

- Validation finishes before the first `delta`, so no unvalidated text is ever streamed, in LLM or no-key mode.
- An unknown asset returns 404 and a bad request returns 422 before the stream starts.
- The browser's `EventSource` is GET-only, so read the POST with `fetch()` and a stream reader. Blocks are separated by a blank line and each has an `event:` and a `data:` line.

### `POST /api/work-orders/draft`

This takes the same request; `mode` is ignored and the arrival diagnosis is always used. The draft maps onto Maintenance_History columns:

```json
{
  "asset_id": "ASSET-014",
  "draft": {
    "asset_id": "ASSET-014", "tag": "P-002", "area_name": "Chemical Preparation",
    "action": "Inspect process conditions before any physical intervention.",
    "maintenance_type": "predictive", "priority": "high", "role": "field_technician",
    "knowledge_doc_id": "DOC-PROCESS_PUMP-CORE",
    "status": "draft", "note": "Draft only, no control action. ...",
    "title": "Inspect P-002 (ASSET-014) for CAVITATION_RISK",
    "summary": "...", "safe_checks": ["..."], "evidence_ids": ["TEL:ASSET-014:vibration_mm_s", "EVT-00893", "CASE-026", "DQ-0098"]
  },
  "generation": "deterministic",
  "confidence": {"score": 0.5, "reasons": ["..."]}
}
```

- `priority` comes from `Current_State.urgency`: high to `high`, medium to `medium`, routine to `low`.
- `role` is the most common role in the asset's recent work orders, defaulting to `field_technician`.
- `evidence_ids` are the IDs the diagnosis cites.
- Nothing is written to the database.

### `GET /api/workbook/builder-questions`

Added in Tab 7. Returns the sheet verbatim, ordered by `question_id`:

```json
{"questions": [{"question_id": "Q-03", "builder_question": "Explain every diagnosis with exact evidence IDs and confidence.", "capability_focus": "explainability + RAG", "priority": "P0"}]}
```

The rows are capability statements, not user questions. `web/src/ui/copilot/questions.js` maps the relevant Q-IDs to concrete questions that the `question` keyword router answers, and the UI shows the Q-ID as provenance.

### Label review (`/api/labels`, Tab 8)

`PATCH /api/labels/overrides/{object_id}` request:

```json
{"reviewer": "Jane Doe", "action": "relabel", "class": "valve", "display_label": "Handwheel valve", "class_confidence": 0.9,
 "merge_into": null, "asset_id": null, "notes": "Handwheel visible on the insulated pipe."}
```

| `action` | Effect on the entry for `object_id` | Side effects |
|---|---|---|
| `confirm` | `label_source: human`, `review_status: confirmed`, `class_confidence` (default 0.9) | none |
| `relabel` | as confirm, plus the new `class` (required) and `display_label`; `review_status: relabelled` | none |
| `reject` | `review_status: rejected` | the object's asset, if any, is unbound |
| `merge` | `review_status: merged`, `merged_into` (required) | the parent gets the union box and `merged_from` |
| `bind` | `asset_id` (required), `mapping_method: human_assigned`, `mapping_confidence: 0.45`, `display_label` "TAG (CLASS) - reviewer-assigned" | the asset's previous object is unbound |
| `unbind` | `asset_id: null`, mapping fields null | none |

- `reviewer` must be non-empty and `class` must be in the class vocabulary, otherwise 422. An unknown object or asset returns 404.
- 409 when the action can't apply: merging into itself or into a hidden object, merging a bound object (unbind it first), or binding a hidden or structure object.
- Every written entry gets `reviewer` and `reviewed_at`, and `notes` becomes `review_notes`. The file is written atomically.
- Response: `{overrides, changed: {<id>: entry or null}, previous: {<id>: entry or null}, notes: []}`. `previous` is what each touched entry was before, so the client can undo by posting it to `/api/labels/restore` as `{reviewer, entries: previous}` (null removes an entry). `notes` says when a pipeline rerun is needed (a binding moved, so `nav_targets.json` is stale).

`GET /api/labels/summary`:

```json
{"objects": 101, "visible": 99, "by_label_source": {"structure": 4, "heuristic": 57, "human": 40},
 "by_review_status": {"confirmed": 31, "relabelled": 7, "rejected": 1, "merged": 1}, "human_reviewed": 40,
 "reviewers": ["Jane Doe"], "bound_assets": 30, "bound_reviewed": 30, "crops": 101, "vlm": false}
```

`by_label_source` counts the effective label (override merged in) of every object, including hidden ones. `human_reviewed` counts entries with `label_source: human`.

`POST /api/labels/crops/{object_id}` takes `{image: "data:image/png;base64,...", camera, bbox_px, viewport_px}` and returns the index entry. `GET /api/labels/crops` returns `index.json` (`{"crops": {}}` when empty).

## Frontend static snapshot (`web/public/data/api/`)

This is the web app's offline fallback (Tab 5). `web/scripts/snapshot-api.mjs` (`npm run snapshot`, with the backend on port 8000) saves the backend responses verbatim. No values are computed or invented. The viewer reads these files only when `GET /api/health` fails.

| File | Route it copies |
|---|---|
| `manifest.json` | `{generated_at, api, assets, open_events, copilot_generation, note}`; its presence enables static mode |
| `assets.json` | `GET /api/assets` |
| `anchors.json` | `GET /api/scene/anchors` |
| `assets/<asset_id>.json` | `GET /api/assets/{id}` |
| `telemetry/<asset_id>.json` | `GET /api/assets/{id}/telemetry` (all metrics, full window) |
| `events/<asset_id>.json` | `GET /api/assets/{id}/events?limit=500` (priority order) |
| `open_events.json` | `{by_asset: {<asset_id>: total}, total}` from `GET /api/assets/{id}/events?status=open&limit=1` |
| `copilot/<asset_id>.<mode>.json` | `POST /api/copilot/query` for `status_line` and `arrival_diagnosis` |
| `builder_questions.json` | `GET /api/workbook/builder-questions` (Tab 7) |
| `copilot/<asset_id>.question.<id>.json` | `POST /api/copilot/query` with `mode: "question"` for each suggestion in `questions.js` (`id` is `Q-01`...`Q-06` or `safety`), only for `SNAPSHOT_CHAT_ASSETS` (ASSET-014) (Tab 7) |
| `work_orders/<asset_id>.draft.json` | `POST /api/work-orders/draft`, ASSET-014 only (Tab 7) |

- The UI adds `snapshot: true` to copilot answers and drafts it read from these files and shows a "Snapshot · offline" badge.
- Search (`/api/search`) and free-text chat are not snapshotted. In static mode the command palette searches assets locally (same stop words and plural rule as the backend), and chat answers only the suggested questions for ASSET-014.
- Regenerate the snapshot after the workbook, pipeline output or copilot templates change. It is about 2.4 MB.

## Frontend public derived files (`web/public/data/derived/`)

`web/scripts/sync-public.mjs` runs before `dev` and `build`. It copies the pipeline outputs verbatim, skipping any file that is unchanged. The viewer always reads these static copies, so mission dispatch and the minimap work without the backend.

| File | Copied from | Read by |
|---|---|---|
| `scene_objects.json` | `data/derived/` | the `loadSceneData` fallback when `/api/scene/objects` fails |
| `labels_override.json` | `data/derived/` | the `loadSceneData` fallback when `/api/labels/overrides` fails (merged over the objects) |
| `nav.json` | `data/derived/` | the `loadSceneData` fallback for `/api/scene/nav?target=ASSET-014` |
| `nav_targets.json` | `data/derived/` | `loadNavTargets()` (Tab 6): the Dispatch target menu and `navForTarget()`, which merges `targets[].mission` over `nav.json` exactly like the backend's `?target=` |
| `nav_map.pgm` + `nav_map.yaml` | `data/derived/` | `loadNavMap()` (Tab 6): the minimap, a P5 PGM parsed in the browser using `resolution` and `origin` from the yaml |
| `floor_occ.png` | `data/derived/` | not currently read; kept for slides |

## Frontend store (`web/src/store.js`)

This is the zustand store shared by the UI panels and the 3D layer. The fields below were added by Tab 6 for the mission. Tab 5's fields (`selectedAssetId`, `backend`, `dataEpoch`, `ui`, `mission.state/t/speed/duration/targetAssetId`) are unchanged.

| Field | Shape | Written by |
|---|---|---|
| `baseNav` | the default `nav.json` / `/api/scene/nav` response | `setSceneData` |
| `nav` | the active mission route; it is `baseNav`, or the `navForTarget()` merge after a dispatch to another asset | `dispatchMission` |
| `navTargets` | `nav_targets.json`, or null | `App.jsx` on load |
| `statusLines` | `{<asset_id>: string}`, the copilot `status_line` summaries | `MissionDriver`, as each asset enters range (`setStatusLine`) |
| `ui.cameraMode` | `overview` \| `mission` \| `free` | `setCameraMode`, the dock toggle and `CameraRig` (a drag or wheel switches it to `free`) |
| `mission.feed` | `[{id, t, kind, assetId, objectId?, text}]`; `kind` is one of `dispatch`, `scanned`, `arrived`, `diagnosing`, `report` or `error`; `id` is unique (`scan:<object_id>` and so on) | `dispatchMission` and `MissionDriver` (`pushFeed`) |
| `mission.runId` | an integer, bumped on every dispatch and restart so the driver resets its clock | `dispatchMission`, `restartMission` |
| `mission.diagnosisAt` | the epoch ms when the report state was reached, or null | `MissionDriver` |
| `ui.evidenceId` | the evidence ID open in the inspector's evidence drawer, or null; cleared when the selected asset changes (Tab 7) | `openEvidence(id)`, `closeEvidence()` |
| `highlight` | `{query, assetIds[]}` or null; search matches lit up in 3D (Overlays repaint, Labels priority) (Tab 7) | `setHighlight(h)`; an empty `assetIds` stores null |
| `flyRequest` | an integer; `CameraRig` flies to `selectedId` whenever it changes, even if the selection didn't (Tab 7) | `focusAsset(assetId)` |

Actions: `dispatchMission(assetId?)` returns false when the asset has no reachable mission. Also `restartMission()`, `pushFeed(entry)`, `setStatusLine(assetId, text)` and `setCameraMode(mode)`. Tab 7 adds `openEvidence`, `closeEvidence`, `setHighlight` and `focusAsset` (select plus fly-to).

The inspector tab id `evidence` is labelled **Copilot** since Tab 7; the id is unchanged.

Rules:
- `running` is the pause flag. It holds the drive clock, the arrival hold and the diagnosis timer.
- Only `MissionDriver` writes `mission.state`. It writes `mission.t` at 10 Hz. Any other write to `mission.t` is treated as a timeline scrub.
- Per-frame mission state (exact `t`, pose, in-range set) lives in `runtime` in `web/src/scene/missionRuntime.js`. Read it inside `useFrame` or a canvas loop, never from the store.
- On arrival the driver prefetches `cachedResource('copilot:<asset>:arrival_diagnosis')`, selects the target and sets `ui.inspectorTab = "evidence"`.
