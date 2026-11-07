# Technical Note

## Summary

This prototype converts the supplied unlabelled Gaussian splat into framed scene objects, binds the synthetic Excel asset records procedurally, plans a collision-free robot route, and generates a grounded diagnosis for the target pump.

## Source PLY

The demo runs on the intact organiser splat `Equipment Room.ply`: 1,676,481 splats covering the whole room, SHA-256 `83d8c7d99316c08c9719cfc2c5a6b9d1903b89847780e2458adc662c79f32955`.

It replaces the first download, `Industrial Boiler Room (1).ply` (SHA-256 `117195366421b07aa6738415e94609d96cd41993a0c5b8e8b730849f6b7f1b03`). That file declared 1,506,136 splats, but only the first 502,482 were usable, and they covered only part of the room. With the full room, walkable floor grew from 6.7 to 17.4 m², and 23 of 30 assets now have an approach pose, up from 13 (`docs/kt/10-equipment-room-ply.md`).

## Geometry Pipeline

The offline pipeline reads splat centres and filters implausible points by opacity, scale, and local-neighbour distance. It fits floor, ceiling, and walls with RANSAC, removes those structure points, voxel-downsamples the remainder, and clusters object candidates with DBSCAN-style radius expansion.

Outputs:

- `data/derived/scene_objects.json`
- `data/derived/nav.json`
- `data/derived/floor_occ.png`
- `data/derived/diagnostics/boxes_front.png`

The current run produced 71 framed objects and 30 procedural asset bindings.

## Coordinate Convention

All generated coordinates remain in raw PLY frame. The scene is y-down. The viewer puts the splat and overlays under one shared parent group rotated 180 degrees about X, which keeps boxes, path, and robot aligned.

## Navigation

The route is planned on a 2D floor occupancy grid. A cell is walkable only if floor support exists. Obstacles are detected in a walking-height band above the floor and inflated for clearance. The generated path to `ASSET-014` is about 3.67 metres using the provisional 1.25 m/unit scale.

## Backend And Copilot

The backend imports all workbook sheets into SQLite and exposes FastAPI routes for assets, scene objects, navigation, and copilot queries. The copilot evidence bundle is deterministic: asset state, computed telemetry trends, events, maintenance history, historical cases, data-quality issues, and core knowledge documents.

The diagnosis endpoint validates citations before returning a response. If an LLM is unavailable, the deterministic response still provides cited observations, hypotheses, safe checks, caveats, and confidence.

## Limitations

- The current scene is only the valid PLY slice, not the full room.
- Excel scene anchors are placeholders, so mapping is procedural rather than visually verified asset identity.
- Labels are coarse. Human-reviewed overrides are stored separately from generated pipeline output.
- The viewer includes a sampled PLY fallback; Spark is installed as `@sparkjsdev/spark`, but fallback rendering remains available for robustness.

## Scale-Up Path

Process larger sites zone by zone, store derived objects in Postgres/PostGIS, preserve object IDs by overlap matching across reruns, replace Excel with OPC UA/MQTT adapters, and add image/pose-based semantic lifting if source training images and camera poses become available.
