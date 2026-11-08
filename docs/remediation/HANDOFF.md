# Handoff — continuous point-to-point navigation

1. Goal and scope. Plan each dispatch from the robot’s current pose with the existing Theta* grid, and keep arrival diagnosis on the active mission target. No new equipment bindings, no new splat, no floor-click goal, no server planner. Detail is in `docs/remediation/03-navigation.md`.

2. Facts now.
   - Scene revision `105192389b3bcdfa` is unchanged. Class candidates and unmapped assets still have no region. Dispatch uses a live `scene_object_id` only.
   - The checked chain is the front entry, then P-002 (ASSET-014, OBJ-0185), then PT-003 (ASSET-027, OBJ-0566), then PT-001 (ASSET-025, OBJ-0172). VS-003 keeps ASSET-030 and uses OBJ-0185’s approach. M-006 and P-001 fail closed.
   - Approaches are footprint standoffs: P-002 0.57 m, PT-003 0.63 m, PT-001 0.87 m from the box centre.
   - Start snap is one cell diagonal, about 0.087 m, and the connector has to be walkable. The frame is `ply_raw`. Grid row `j` is z, column `i` is x. Robot y is `floor_y`.
   - Store states are `idle`, `planning`, `moving`, `arrived`, `unreachable`, `error`. A playing route is not retargeted. Dispatch after arrival or while paused plans from the current pose. Reset freezes that pose and does not load the dock route.
   - `GET /api/scene/nav` is the stored front-entry catalogue (`planned_from: front_entry`). A `start` query returns 400. The viewer plans on `nav_grid.json`, which is also served as a static file when the API is down.

3. Files changed. `web/src/scene/planner.js`, `dispatch.js`, `mission.js`, `MissionDriver.jsx`, `store.js`, `data.js`, `App.jsx`, the dock, top bar, robot, minimap, camera, labels, overlays, command palette, scene evidence, and the overview send button. `web/scripts/sync-public.mjs`, `check-mission.mjs`, and new `check-navigation.mjs`. `backend/app/routes/scene.py` and `backend/tests/test_routes.py`.

4. Contracts.
   - Do not copy a stored mission over a robot that has left the dock. Without the grid, one stored segment is allowed only when its first sample is already within the snap bound.
   - Do not stitch stored missions or reverse one.
   - A smoothed path that fails the collision check is unreachable and has no samples.
   - Diagnosis responses carry `mission.epoch`. A late response for an earlier epoch is ignored.
   - The selected asset and the mission target may differ. The dock button names the selected tag.

5. Tests actually run.
   - `node scripts/check-navigation.mjs`: 34 passed.
   - `node scripts/check-mission.mjs`: passed. Proximity is still P-002 at 17.6 s.
   - `python3 -m pytest -q` in `backend/`: passed.
   - Browser on http://localhost:5173/: list selection, disabled M-006, dispatch of P-002 from the dock, then PT-003 from that arrival pose. The PT-003 feed arrived and diagnosed ASSET-027. Sample 0 of the second leg matched the arrival pose.

6. Remaining. Eighteen assets, including M-006 and P-005, have no region. CV-001, CV-002, CV-003, M-001, and P-001 are class candidates and were not bound again to make a longer demo route. There is still no click-a-point-on-the-floor destination. Tag identity is still not a nameplate reading.

7. Stop. Do not start another remediation phase from this handoff.
