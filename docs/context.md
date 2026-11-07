# Shared Challenge Context

## Inputs

- Scene PLY: `Equipment Room.ply` (intact organiser splat, 1,676,481 splats, full room)
- Superseded: `Industrial Boiler Room (1).ply` (damaged) and its valid slice `_analysis/boiler_room_valid.ply`
- Validator: `_analysis/validate_ply.py`
- Geometry/navigation spike: `_analysis/spike.py`
- Workbook: `Valmet_SinceAI_2026_Synthetic_Industrial_Metaverse_Builder_Pack (1) (2) (1).xlsx`
- Brief: `Valmet_x_SinceAI_2026_Challenge_Brief_FINAL_updated (1).docx`

## PLY Findings

- `Equipment Room.ply`: all 1,676,481 rows are plausible; SHA-256 `83d8c7d99316c08c9719cfc2c5a6b9d1903b89847780e2458adc662c79f32955`. The pipeline's floor-to-ceiling fit gives 1.2374 m/unit.
- Its frame is close to, but not identical with, the old file's frame (scale 1.0365, 0.84 degrees, about 23 cm shift), so every derived artefact was regenerated from it (`docs/kt/10-equipment-room-ply.md`).
- The earlier `Industrial Boiler Room (1).ply` (SHA-256 `117195366421b07aa6738415e94609d96cd41993a0c5b8e8b730849f6b7f1b03`) had only its first 502,482 of 1,506,136 splats intact.
- The scene is y-down, matching common COLMAP-trained splat conventions.
- Keep all generated coordinates in raw PLY frame.
- In three.js, put the splat and every overlay under one parent group rotated 180 degrees about X.

## Product Strategy

The demo should prove:

1. The semantically blind splat is converted into many framed scene objects.
2. Excel assets are bound to scene objects using an explicit procedural mapping.
3. A robot follows a collision-free route over supported floor.
4. Nearby assets display status while the robot moves.
5. The copilot diagnosis cites computed evidence from the workbook and separates observations from hypotheses.

## Implementation Strategy

- Do not train models.
- Use CPU geometry: opacity/scale/outlier filtering, RANSAC structure planes, DBSCAN object clusters, occupancy-grid pathfinding.
- Use optional vision-language labels only as suggestions; human overrides are authoritative.
- Use FastAPI + SQLite for the backend.
- Use React + three.js + Spark for the browser viewer.
- Keep deterministic fallbacks for labels and copilot output so the demo does not require network access.

## Demo Target

Target asset: `ASSET-014` / `P-002`, a process pump with `attention_required` and `CAVITATION_RISK`.

Key evidence to preserve:

- Mean vibration rose from 2.42 mm/s to 4.57 mm/s.
- Healthy pump average vibration is 2.08 mm/s.
- Flow fell from 83.1% to 76.2%.
- Pressure fell from 4.52 bar to 4.04 bar.
- Open events: `EVT-00136`, `EVT-00893`.
- Matching cases: `CASE-022`, `CASE-026`, `CASE-049`.
- Data-quality issue: `DQ-0098`.
