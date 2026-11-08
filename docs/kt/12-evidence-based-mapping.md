# 12 Evidence-based Excel mapping (Sat 7 Nov 2026)

**Outcome:** 6 of 30 workbook rows are bound to verified hardware, 6 are hosted on that hardware, and 18 are not located in the scan.

The segmentation was not changed. `data/derived/vision/detections.json` was used only to rank views. The class of each candidate was decided from the projected box in the posed frames (`data/derived/diagnostics/evidence_sheets/`).

## What was verified

| Tag | Asset | Object | Class | Reach |
|---|---|---|---|---|
| P-002 | ASSET-014 | OBJ-0185 | pump | reachable |
| P-001 | ASSET-013 | OBJ-0303 | pump | 1.57 m, no approach pose |
| M-001 | ASSET-019 | OBJ-0222 | motor | reachable |
| CV-001 | ASSET-001 | OBJ-0211 | valve | reachable |
| CV-002 | ASSET-002 | OBJ-0295 | valve | reachable |
| CV-003 | ASSET-003 | OBJ-0566 | valve | reachable |

P-002 stays on OBJ-0185. In `frame_00278.jpg` and `frame_00243.jpg` that box is the pipe fragment beside the dark inline circulator, next to the blue tank. The circulator body that is clearly inside its own box is OBJ-0303 (`frame_00001.jpg`, `frame_00014.jpg`). That body is 1.57 m from the walkable floor, so the robot cannot use it as the demo target. OBJ-0548 looked like a second circulator on the first pass and is the white pipe beside OBJ-0303; it is not bound.

No pressure gauge stayed inside one box across frames, so no transmitter is its own object.

## Hosted sensors

Hosted rows do not take `asset_id`. They are stored on the host as `hosted_assets` with `mapping_method: host_mounted` and confidence 0.3.

- VS-001, VS-002 and VS-003 are on OBJ-0185. All three are AREA-04, the same area as P-002.
- PT-001 is on OBJ-0172, a vertical pipe (`frame_00198.jpg`).
- PT-002 is on OBJ-0211 (CV-001).
- PT-003 is on OBJ-0566 (CV-003).

`scene_index.bindings()` yields each hosted asset with the host's `object_id`. `GET /api/assets` already copies that id into `scene_object_id`, so the asset route was not changed. The dispatch menu uses a nav target that copies the host approach pose. 11 of these 12 targets are reachable. P-001 is the one that is not.

## Not located

CV-004 through CV-012, P-003, P-004, P-005, P-006, and M-002 through M-006. The mapping report reason is `no verified <class> left in scan`. Bare fittings and boxes that the geometry pass had called pumps or valves were reviewed as pipes, crates, tanks or other, and they are not eligible.

## Checks

- `python3 -m pipeline.mapping`
- `python3 _analysis/check_bindings.py`
- `cd backend && pytest` (113 passed)
- `cd web && node scripts/check-mission.mjs`
- Contact sheet: `data/derived/diagnostics/bindings_sheet.jpg`
- Browser: selecting P-002 shows "Mounted on this object: VS-001, VS-002, VS-003". Selecting VS-001 opens that sensor on the same host, with Send robot available.
