# Evidence audit (8 Nov 2026, 00:30 EET)

Phase 1 only. No application code was changed. Previous KT notes were treated as leads and rechecked against the files and the running app.

## What was inspected

- Challenge brief: `Valmet_x_SinceAI_2026_Challenge_Brief_FINAL_updated (1).docx` (31 paragraphs).
- Workbook: `Valmet_SinceAI_2026_Synthetic_Industrial_Metaverse_Builder_Pack (1) (2) (1).xlsx` (16 sheets, columns and identity rows; not the 4,320 telemetry rows or the 1,000 events).
- Knowledge row `DOC-3D-MAPPING` (168 characters).
- Attached UI screenshots (two). A live arrival screenshot in the running app.
- Boiler-room video file metadata and three frames at 8 s, 45 s and 90 s. The full 112 s was not watched. The two short semantic-extraction demos were not opened. The file contains location metadata; it is not recorded here.
- `Equipment Room.ply` header (1,676,481 vertices). The original `Industrial Boiler Room (1).ply` is not in the tree. `_analysis/boiler_room_valid.ply` and `ply_inspection_report.txt` document the older damaged file (502,482 valid vertices of 1,506,136).
- Rendered splat: `web/public/assets/splat-manifest.json` points at `equipment_room.spz` (30,627,537 bytes, generated 2026-11-07). Live Spark load reported 1,504,114 splats from that URL. `boiler_room.spz` is present and unused by the manifest.
- `data/derived/scene_objects.json`, `labels_override.json`, `nav.json`, `nav_targets.json`, `nav_grid.json` (keys and rasters, not the base64 dumped), `splat_alignment.json` (keys and Sim(3) summary).
- Public copies of those JSON files are byte-identical to `data/derived/`.
- Frontend: `web/src/store.js`, `scene/dispatch.js`, `scene/planner.js`, `scene/mission.js`, `scene/MissionDriver.jsx`, `scene/CameraRig.jsx`, `scene/Overlays.jsx`, `scene/Splat.jsx`, `ui/MissionDock.jsx`, `App.jsx` legend, `data.js`.
- Backend: `scene_index.py`, `routes/scene.py`, `routes/assets.py`.
- Live API on port 8000 and the Vite app on port 5173. `window.__store.navGrid` was `null`.

Not reopened this phase: the evidence contact sheets and the cited `frame_*.jpg` crops. Binding notes inside `scene_objects.json` were read. Those notes are pipeline text, not a fresh visual review.

## Screenshot symptoms

The two attached screenshots show the same 3D framing: a close, blurred view into pipes, with a green CV-001 card and a red P-002 card. The legend says "All bindings unverified". The viewport reads about 7 fps.

- First shot: the inspector is VS-003, healthy, vibration sensor. The feed says the robot arrived at VS-003 and the diagnosis is ready. The dock says "Re-dispatch to VS-003". The lit boxes are CV-001 and P-002, not a vibration sensor.
- Second shot: the inspector is M-006, attention, overheating. The diagnosis text says no 3D binding exists. The dock says "Dispatch to M-006". The same CV-001 and P-002 boxes and the same camera remain.

A live arrival at P-002 (ASSET-014) reproduced the framing: the robot, a green CV-001 volume and a red P-002 volume sit in one tight cluster. The copilot for that arrival cited P-002 cavitation (vibration 4.57 mm/s, flow 76.17%, pressure 4.04 bar) and labelled the binding unverified. CV-001, P-002 and CV-003 were in range together.

## Workbook facts

Sheets: START_HERE, Public_Research, Asset_Master (30×16), Scene_Anchors (30×16), Current_State (30), Telemetry_Sample_3d (4,320), Alarms_Events (1,000), Maintenance_History (300), Historical_Service_Cases (50), Knowledge_Docs (8), RAG_Corpus_Index (38), Data_Quality (120), Builder_Questions (10), API_Contract (8), Dashboard, Change_Log.

Asset_Master columns include `asset_id`, `tag`, `asset_class`, `area_id`, `area_name`, `criticality`, `scene_anchor_id`, `qr_id`, `nfc_id`, `synthetic_record`. There is no parent, child, photo, drawing or nameplate column.

Classes: 12 control valves (CV-001–012), 6 process pumps (P-001–006), 6 electric motors (M-001–006), 3 pressure transmitters (PT-001–003), 3 vibration sensors (VS-001–003). Areas are named Chemical Preparation, Machine Hall, Stock Preparation, Utility Island and Water Treatment. Those names are plant labels, not splat coordinates.

Current_State: 17 healthy, 6 degraded, 4 watch, 3 attention_required.

| Tag | Asset | Issue | In the scan? |
|---|---|---|---|
| P-002 | ASSET-014 | CAVITATION_RISK, health 45 | Reachable fragment |
| P-005 | ASSET-017 | FOULING, health 44 | No binding |
| M-006 | ASSET-024 | OVERHEATING, health 45 | No binding |

Scene_Anchors: `x_local_m` spans −0.32 to 30.39, `y_local_m` −0.39 to 15.49, `z_local_m` 0.47 to 2.15. Every row has `mapping_status = placeholder_until_valmet_scene_received`, `mapping_confidence = 0.65`, `identity_methods = asset_id / QR / NFC / manual mapping`, and `synthetic_record = true`. The remap instruction says to remap when a Valmet splat arrives. The room crop used for the rendered splat is about x −5.2..4.5, y −1.7..1.7, z −4.2..3.8 in the PLY frame. The Excel numbers are a different, explicitly placeholder frame. They are not applied to the PLY.

`DOC-3D-MAPPING`: "Map visible objects to stable asset IDs with explicit confidence. Mapping may use scene hierarchy, annotation, QR/NFC or computer vision. Never silently guess identity."

Four buckets:

1. Device identity. None. No nameplate, QR or photo in the workbook ties a tag to a physical object. The stored note on P-002 says the tag is not printed on the machine.
2. Class identity. Reviewed geometry classes (`label_source: vlm`) for a pump, a motor and three valves, plus the frame notes stored on those objects.
3. Synthetic operations. Health, telemetry, events, cases, work orders and data-quality rows. `synthetic_record` is present on those sheets. This data is valid for the copilot once an asset is selected. It does not locate the asset.
4. Scene mapping. Scene_Anchors are placeholders. The only scene links are the ones the pipeline wrote into `scene_objects.json`.

## Current bindings

438 objects, 1.2374 m/unit, frame `ply_raw`, source `Equipment Room.ply`. Classes include 239 pipes, 126 other, 5 pumps, 3 valves, 1 motor. Objects store `splat_count` only. Original splat indices are not saved. The SPZ is a cropped, opacity-filtered reorder (1,504,114 of 1,676,481). Selection uses oriented boxes, so the compression does not swap Excel identity. It also cannot be used to recover which source splats belong to an object.

Six primary bindings and six hosted sensors. Eighteen assets have no scene object. `nav_targets.json` lists those 12 and no per-object approach table (`objects` is absent). Eleven routes are reachable. Every reachable route's first sample is the front entry `(2.90541, 1.17269, 2.09514)`.

| Tag | Asset | Object | Visual class | Method | Conf. | Reach | What the note actually supports |
|---|---|---|---|---|---|---|---|
| P-002 | ASSET-014 | OBJ-0185 | pump | video_evidence | 0.45 | yes | Pipe fragment beside a circulator. Tag is an assignment. |
| P-001 | ASSET-013 | OBJ-0303 | pump | procedural_class_match | 0.45 | 1.57 m, no | Inline circulator body. Not walkable. |
| M-001 | ASSET-019 | OBJ-0222 | motor | procedural_class_match | 0.45 | yes | Red motor head on a white housing, per the stored note. |
| CV-001 | ASSET-001 | OBJ-0211 | valve | procedural_class_match | 0.45 | yes | Valve with a blue handwheel, per the stored note. |
| CV-002 | ASSET-002 | OBJ-0295 | valve | procedural_class_match | 0.45 | yes | Valve with a handwheel, per the stored note. |
| CV-003 | ASSET-003 | OBJ-0566 | valve | procedural_class_match | 0.45 | yes | Valve handle, per the stored note. |
| VS-001/002/003 | ASSET-028/029/030 | OBJ-0185 | hosted on the P-002 fragment | host_mounted | 0.3 | same cell as P-002 | Same area as P-002. Not a separate sensor body. |
| PT-002 | ASSET-026 | OBJ-0211 | hosted on CV-001 | host_mounted | 0.3 | same cell as CV-001 | No gauge object was accepted. |
| PT-003 | ASSET-027 | OBJ-0566 | hosted on CV-003 | host_mounted | 0.3 | same cell as CV-003 | Same. |
| PT-001 | ASSET-025 | OBJ-0172 | hosted on a pipe | host_mounted | 0.3 | yes, 0.37 m route | Vertical pipe. Approach is almost the front entry. |
| M-006, P-005, and 16 others | | none | | unmapped | | | No reviewed instance left. |

P-002, CV-001, VS-001, VS-002, VS-003 and PT-002 share one approach cell, `(-1.24459, 1.17269, 0.79514)`. CV-003's approach is 0.84 m away. CV-002 and M-001 are about 6 m away.

`labels_override.json` has 74 `vlm` class entries and one asset pin: OBJ-0185 → ASSET-014, `video_evidence`. The other five primaries are not pinned. `pipeline/run.py` reads the override file inside `bind_assets` and does not rewrite it. A rerun keeps the P-002 pin if OBJ-0185 still exists. The other primaries are recomputed from reviewed classes. `pipeline/semantic.py` refuses to merge a reviewed segment. That protection was not re-executed this phase.

Live `GET /api/assets` matched `web/public/data/api/assets.json` on `scene_object_id`, tag, condition and health for all 30 rows (0 mismatches). `GET /api/assets/ASSET-024` has `scene: null`. `GET /api/assets/ASSET-030` returns OBJ-0185 with `mapping_method: host_mounted` and the P-002 display label. Anchor summary: 12 remapped, 18 unmapped, 11 reachable. Copilot response bodies were not diffed.

## Identity trace

Excel row → SQLite import → `scene_index.bindings()` (primary `asset_id`, else `hosted_assets`) → `scene_object_id` on `GET /api/assets` → frontend `selectAsset` → overlay box → `navForTarget` precomputed route → arrival copilot for `mission.targetAssetId`.

- Bindings are class evidence plus one video-evidence pin. They are not nameplate matches. The legend hardcodes "All bindings unverified" (`App.jsx`). `status.js` also marks `video_evidence` and `host_mounted` as unverified. That is the right claim for the tag, and a coarser claim than the class notes.
- `dispatchMission` falls back to `mission.targetAssetId`, then `nav.json`'s P-002, when called with no id. The dock uses `selectedAssetId ?? mission.targetAssetId`. Clicking an unbound box clears `selectedAssetId` (`setSelectedId` reads only `object.asset_id`), so the next dispatch sends the previous asset.
- `planDispatch` in `dispatch.js` can replan from `runtime.pose` on `nav_grid.json`. Nothing calls it. `App.jsx` never loads the grid. The live store's `navGrid` was null.
- Hosted selection does resolve the host: clicking VS-003 set `selectedAssetId` to ASSET-030 and `selectedId` to OBJ-0185, whose own `asset_id` is ASSET-014. The box label is therefore P-002. `frameArrival` looks up `object.asset_id === targetAssetId`, so a VS-003 mission finds no object and does not reframe.
- Highlight brightness treats in-range neighbours like a selection (`Overlays.jsx`). At the shared cell, CV-001 and P-002 both stay filled.
- Arrival diagnosis follows `mission.targetAssetId`, not the box label. A VS-003 mission asks the copilot for ASSET-030. A P-002 mission returns the cavitation row. Workbook retrieval for the selected asset id is working. The 3D target is the host fragment, and neighbours at the same cell look selected.

## Reproduced interactions

Live app, backend online, splat ready from `equipment_room.spz`.

1. Dispatched ASSET-014. Route start was the front entry, end the shared cell, 24.04 s, 242 samples. Playback reached `report`. Inspector showed the P-002 cavitation diagnosis. Camera mode was `mission`. The view was the tight cluster described above.
2. `selectAsset('ASSET-002')` while arrived set the selection to OBJ-0295 and switched the camera to `free`. `dispatchMission('ASSET-002')` returned true and replaced the route. The new sample 0 was the front entry again, not the arrival pose. State went to `dispatched`, t = 0.
3. `dispatchMission('ASSET-024')` returned false. `selectedId` became null. The mission target stayed ASSET-002.
4. Clicking M-006 in the asset tree selected it and showed a disabled "Dispatch to M-006" button. The feed still said "Dispatched to CV-002".
5. Clicking VS-003 selected ASSET-030 on OBJ-0185 (host asset ASSET-014). The button became an enabled "Dispatch to VS-003". The mission target was still CV-002 until a dispatch. A further click on that button was not issued; the store path used by that button was already executed for other targets.
6. `setSelectedId` on unbound OBJ-0078 (the box click handler) cleared `selectedAssetId`. `dispatchMission()` with no argument dispatched ASSET-002 again from the front entry.
7. Node executed `planRoute` on the real grid, which the UI does not load. From the P-002 approach cell: CV-002 is 5.97 m / 21.3 s, CV-003 is 0.84 m / 6.2 s, M-001 is 6.04 m / 21.8 s, all with clearance about 0.34 m. CV-001 and VS-003 return "The robot is already at this approach pose".

Command palette was not clicked. It calls the same `dispatchMission(assetId)`. A pointer drag on the arrival camera was not performed, so orbit-at-arrival is not confirmed. Code sets `cameraMode` to `free` on `controlstart` and does not call `setLookAt` every frame after the one arrival shot. Selection of another bound asset did switch the mode to `free` and fly.

The dev server was left `idle` with the overview camera. `mission.targetAssetId` was still ASSET-002 because reset does not clear it. A refresh loads `nav.json` (P-002) again.

## Root causes

Confirmed:

- Second-leg travel always restarts at the front entry because the dock and the store use precomputed `navForTarget` routes. The from-current-pose planner is dead code, and the grid is never loaded.
- Assets with no binding (M-006, P-005, 16 others) cannot dispatch. The button disables. The previous boxes stay lit.
- An unbound box click dispatches the previous asset.
- P-002, CV-001 and the three vibration sensors share one approach cell, so the robot cannot move between them and the arrival shot frames the cluster.
- `frameArrival` misses hosted targets and uses a fixed 2.3-unit offset. The live P-002 arrival is inside that clutter.
- Tag identity is not verified. Eighteen assets must stay unmapped. Excel anchors must not be copied onto the splat.

Unconfirmed:

- Whether a drag at the arrival shot is eaten by the label layer. Not tested with a pointer.
- Whether the Python planner reproduces the JS leg lengths. Only the JS port was run from an arrival pose.
- Whether the stored frame notes still match the image crops. The crops were not reopened.
