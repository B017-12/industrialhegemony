# Implementation plan (after the 8 Nov evidence audit)

Do this next. Do not start it from the audit tab. Keep the current FastAPI, Vite, React, three.js 0.181.2 and Spark 2.4.0 stack. Do not rebuild the room, retrain a splat, or redesign the shell.

Submission is 10:00. The audit finished about 00:40. Budget about four hours of implementation and proof, then stop. Leave the rest of the morning for the demo recording.

## Decision

Route the second leg with the Theta* port already in `web/src/scene/planner.js`, on the existing `nav_grid.json`. Do not add a server planner.

Source: Nash, Daniel, Koenig and Felner, "Theta*: Any-Angle Path Planning on Grids", AAAI 2007, pp. 1177–1183. https://aaai.org/papers/01177-aaai07-187-theta-any-angle-path-planning-on-grids/ and the PDF https://fileadmin.cs.lth.se/ai/Proceedings/aaai07/12/AAAI07-187.pdf

What it supports: on a grid of blocked and unblocked cells, Theta* searches along grid edges and returns an any-angle path that is not forced to those edges. It is not guaranteed to be the shortest path. The 2010 JAIR version (https://doi.org/10.1613/jair.2994) adds non-uniform cell costs. Our grid already stores an ESDF cost `1 + w·exp(−d/σ)`.

Compatibility: `planner.js` is plain JavaScript. Node ran it in this audit against the current `nav_grid.json` (205×186, 4,540 walkable cells) with no new dependency. Spark 2.4.0 and three 0.181.2 are unrelated to the planner.

Untested locally: the UI does not call `planRoute`. The Python planner was not run from an arrival pose, so JS and Python lengths are not compared. Line-of-sight through the shared P-002 / CV-001 corner was not inspected cell by cell.

Camera fix: no new algorithm. `frameArrival` already has the target box and the robot pose. Place the camera along the approach yaw, far enough to fit the box, and reject positions whose floor cell is blocked in `nav_grid`. That uses the grid we already have. A viewpoint-selection paper is not required for this bug.

## What not to do

- Do not bind the 18 unmapped assets. M-006 and P-005 are attention-required and still have no geometry. Say so.
- Do not move P-002 onto OBJ-0303. That circulator is 1.57 m off the walkable floor. Keep OBJ-0185 and the existing note that it is a fragment and the tag is not on the machine.
- Do not copy `Scene_Anchors` `x_local_m` / `y_local_m` / `z_local_m` onto the splat.
- Do not mark `video_evidence` or `procedural_class_match` as verified identity.
- Do not rerun segmentation unless a mapping code change requires it. The override file is an input to `bind_assets` and must not be overwritten.

## Critical subset

Demo these, and label each one's mapping method:

| Tag | Promise |
|---|---|
| P-002 | Reachable cavitation target on OBJ-0185. Workbook diagnosis stays ASSET-014. |
| CV-003 | Different approach, 0.84 m from P-002. The robot must drive there from the arrival cell. |
| CV-002 or M-001 | Longer second leg, about 6 m, also from the arrival cell. |
| CV-001, VS-003 | Same approach cell as P-002. Dispatch must say the robot is already at that pose, and the inspector must show the asset that was clicked. |
| M-006, P-005 | Stay unmapped. Dispatch stays disabled with an explicit reason. |

## Work, in order

### 1. Dispatch from the current pose (about 90 minutes)

- Load and `decodeGrid` `nav_grid.json` once in `App.jsx` / `data.js`. Put it on the store. Today `navGrid` is always null.
- Change `dispatchMission` so it calls `planDispatch`. Keep `navForTarget` only as the idle route from the front entry when the grid is missing.
- `resolveTarget` must find a hosted asset through `scene_object_id` (VS-003 → OBJ-0185). It already checks `scene_object_id` before `asset_id`.
- The dock's enabled state must use that result. "Already at this approach pose" is a disabled reason, not a silent no-op and not a replay from the door.
- If the selection is an object with no `asset_id`, dispatch that object only when `nav_targets` grows an approach for it. Until then, disable with a reason. Do not fall back to `mission.targetAssetId`.
- `MissionDriver` already restarts on `runId`. The new `samples[0]` must be the current pose, snapped to a walkable cell, not the front entry.
- `restartMission` returns to the front-entry route and clears the target.

Files: `web/src/store.js`, `web/src/data.js`, `web/src/App.jsx`, `web/src/ui/MissionDock.jsx`, `web/src/scene/dispatch.js`. `planner.js` stays unless a checked route is in collision.

### 2. Arrival camera and selection drawing (about 60 minutes)

- Resolve the arrival object by `target_object_id`, then by host `scene_object_id`, then by `asset_id`. A VS-003 mission must frame OBJ-0185.
- Build the camera position from the approach yaw and the box size. Reject a candidate whose (x, z) cell is blocked. Keep the existing user release: one shot, then `controlstart` may switch to `free`. Do not write `setLookAt` on every frame after the shot.
- In `Overlays.jsx`, an in-range neighbour dims while something else is selected. The selected box uses the accent colour. A hosted selection still highlights the host, and the label must show the selected tag (VS-003) as well as the host (P-002).
- PT-001's 0.37 m route ends on top of the front entry. Do not feature it. Leave the approach as generated unless the second-leg test shows the robot cannot stand there.

Files: `web/src/scene/CameraRig.jsx`, `web/src/scene/Overlays.jsx`, `web/src/scene/Labels.jsx`.

### 3. Prove it (about 60 minutes)

Extend `web/scripts/check-mission.mjs`. Do not replace the existing proximity checks.

- Decode the grid.
- Plan P-002 approach → CV-003 and → CV-002. Sample 0 is within one cell of the P-002 approach, not the front entry. Clearance stays at least the robot radius. CV-003 length is under 2 m. CV-002 is under 8 m.
- Plan P-002 approach → CV-001 and → VS-003. Both return the already-there error.
- A missing asset id does not resolve to P-002.
- `cd backend && pytest` still passes. These UI fixes should not need an API change.
- Browser, on the running app: dispatch P-002, let it arrive, dispatch CV-003, confirm the robot leaves the cluster without jumping to the door. Then select M-006 and confirm the button stays disabled and the mission target does not change. Drag the view after arrival and confirm the camera mode becomes `free` and the shot moves. Refresh once and confirm the splat still loads from `equipment_room.spz`.

## Acceptance

- From a completed P-002 arrival, CV-003 and CV-002 each get a route whose start is the arrival cell.
- VS-003 and CV-001 do not replay the door-to-cluster route. The UI says the robot is already there. The inspector shows the clicked asset's workbook row.
- M-006 and P-005 stay unbound.
- The arrival shot shows the target box without sitting inside the splat, and a drag afterwards moves the camera.
- No new asset is labelled verified.

## If time runs out

Ship item 1 and the node checks. Item 2 can be a smaller patch: fix the hosted object lookup and dim in-range neighbours, and leave the fixed camera distance if the drag test shows the user can pull back. Do not spend the morning binding more tags.
