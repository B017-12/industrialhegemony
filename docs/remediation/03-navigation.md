# Continuous point-to-point navigation

Each dispatch plans from the robot’s current pose on the existing Theta* grid. Arrival diagnosis names the mission target. Equipment that lost its region in the mapping phase stays unbound.

## Root cause

`dispatchMission` loaded a stored mission from `nav_targets.json`. Every stored mission begins at the front entry `(2.90541, 1.17269, 2.09514)`. Arrival did not block another dispatch. The second leg teleported because the route was replaced with that dock path.

`planRoute` in `web/src/scene/planner.js` already accepts a start pose. The viewer never loaded `nav_grid.json`, so the store’s grid stayed empty and that function was unused.

Selection is the equipment box, not a splat. A click that misses the boxes clears the selection. There is no floor-click destination. A Gaussian intersection is not used as a goal.

## Frames

Everything the planner reads is `ply_raw`, y down. Metres are units times `metres_per_unit` (1.2374). Yaw is `atan2(dx, dz)` about raw +y, from +z toward +x. The display frame, a 180° turn about X, is not used.

`nav_grid.json` says `layout`: row `j` indexes z, column `i` indexes x. Cell `(j, i)` covers `[x0 + i*cell, x0 + (i+1)*cell)` by `[z0 + j*cell, z0 + (j+1)*cell)`. Its centre is `(x0 + (i+0.5)*cell, z0 + (j+0.5)*cell)`. `cell` is 0.05 units. The robot’s y is `floor_y`.

`cellOf` is `j = floor((z - z0) / cell)`, `i = floor((x - x0) / cell)`.

## Start, goal, and the path

A start whose cell is walkable is used as that cell. The route’s first sample is the true pose, so the robot does not jump to the cell centre.

A start in a non-walkable cell may snap only one cell diagonal, `cell * metres_per_unit * sqrt(2)`, about 0.087 m. The straight connector to that cell must stay on walkable cells after it leaves the start cell. A pose outside the grid, farther than that bound, or with a blocked connector returns an error and leaves the robot where it is. The old whole-map snap is gone.

A goal may snap up to the existing 0.2 m. Farther than that, the result is unreachable and has no samples. Equipment goals are the stored service approach (`standoff_m` on the footprint), not the object centre. P-002’s approach is 0.57 m from its box centre, PT-003’s is 0.63 m, and PT-001’s is 0.87 m.

Theta* still refuses a diagonal step that would cut a blocked corner, and the shortcut still requires line of sight. After Catmull-Rom, the polyline fallback, and the raw fallback, the smoothed points that will be sampled are collision-checked. If every fallback fails, the result is unreachable and no samples are returned.

## Who can be dispatched

The mission target is the asset the user dispatched. VS-003 stays ASSET-030 and uses OBJ-0185’s approach. An asset with no `scene_object_id` fails closed. M-006, CV-001, CV-002, CV-003, M-001, and P-001 are in that set. Their old rows in `nav_targets.json` are not reused. Those tags were not bound again.

Live approaches that differ are P-002 and the vibration sensors on OBJ-0185, PT-002 on OBJ-0211 (the same cell as P-002), PT-003 on OBJ-0566 (about 0.80 m from P-002), and PT-001 on OBJ-0172 (about 0.20 m from the dock). The checked chain is the dock, then P-002, then PT-003, then PT-001.

## Mission state

The store states are `idle`, `planning`, `moving`, `arrived`, `unreachable`, and `error`. Planning is synchronous, so the committed state is `moving`, `unreachable`, `error`, or the previous state when the robot is already on the pose. Feed entries are still `dispatch`, `scanned`, `arrived`, `diagnosing`, `report`, and `error`. Diagnosis runs during `arrived` and stays on `mission.targetAssetId`.

A list click or a box click changes the selection only. The dock button reads `Dispatch to {selected tag}`. It also shows the selected tag and the mission tag. Dispatch is allowed when the state is `idle`, `arrived`, `unreachable`, or `error`, and during `moving` only while playback is paused. A playing route is left as it is.

A failed plan does not replace `nav`. Reset writes one stationary sample at the current pose, clears the mission target, and does not load the dock route.

Each committed dispatch bumps `mission.epoch`. A diagnosis response is applied only when that epoch and asset id are still the active arrival. If the user has selected a different asset, the diagnosis does not change the selection.

## API and offline

`GET /api/scene/nav` returns the stored front-entry catalogue and sets `planned_from` to `front_entry`. A `start` query returns 400. The viewer does not use that body as a second leg.

The grid is loaded from `/data/derived/nav_grid.json`, including when the API is down. `web/scripts/sync-public.mjs` copies that file. If the grid is missing, one stored mission may be used only when its first sample is already within the snap bound of the robot. Any other missing-grid dispatch is `error`. Stored missions are not stitched or reversed. Diagnosis still uses the copilot snapshot when the API is down.

## Checks actually run

- `node scripts/check-navigation.mjs` in `web/`: 34 passed. Dock to P-002, that arrival to PT-003, that arrival to PT-001. Each `samples[0]` is within the snap bound of the previous pose. M-006 and unbound P-001 leave the route in place, then PT-003 plans. A playing route rejects a new dispatch. Selection alone does not change the mission target. A late diagnosis for the first epoch is ignored. VS-003 keeps ASSET-030. Smoothed samples stay on walkable cells. An off-grid goal returns unreachable with no samples. Without a grid, the dock segment is allowed once and the next leg is `error`.
- `node scripts/check-mission.mjs`: passed. Proximity is still P-002 at 17.6 s. Sample time reports `moving`, then `arrived`.
- `python3 -m pytest -q` in `backend/`: passed, including `planned_from == front_entry`, sample 0 equal to the stored start, and 400 when `start` is set.
- Browser on http://localhost:5173/, grid loaded, backend online. Choosing P-002 in the list set the button to “Dispatch to P-002” and left the mission target empty. Choosing M-006 set “Dispatch to M-006”, disabled, mission still empty. The box handler for OBJ-0185 selected ASSET-014 and left the mission target empty until dispatch. Dispatch of P-002 used `planned_from: current_pose` and sample 0 was the dock (gap 0 m). After arrival, M-006 did not replace the route. Dispatch of PT-003 started on that arrival pose (gap 0 m, 5.38 m from the dock). The feed then read “Arrived at PT-003 approach pose” and “Diagnosis ready”, with the mission target still ASSET-027. The dock showed “Current pose”, “Approach PT-003”, and “Selected PT-003 · Mission PT-003”.
