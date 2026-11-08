# 11 AI-assisted labelling and dispatch from any position (Sat 7 Nov 2026, 17:10, IN PROGRESS)

**Status:** about two thirds done.
- **Python side:** all code is written and every selftest passes, but there is no full end-to-end run with vision yet.
- **Web side:** all code is written, but none of it has run or been tested yet.
- **Detection:** the frame-detection run (about an hour) is still going in the background.

Plan (do not edit): `~/.cursor/plans/vision_labelling_and_dispatch_93ad229d.plan.md`.

## The two problems being fixed

1. **Poor object labels.** The labels came from geometry heuristics only. The 373 posed video frames were not used for recognition.
2. **The dispatch button goes dead after a mission.** For example, after a mission to P-002, clicking another asset or object leaves the button disabled, and only a page refresh brings it back. The user wants the robot to move from any point to any object, with collision avoidance intact. There are three root causes:
   - `procedural_fill: false` left only 2 assets bound, so almost nothing had a route.
   - Routes were precomputed in Python and always started from the front entry.
   - The dock fell back silently to P-002.

The user chose to auto-bind all 30 Excel assets to the best-matching AI-detected equipment by class. These bindings are labelled "AI-assisted", capped at 0.5 mapping confidence, and reviewable.

## Approach

Training-free 2D-to-3D lifting, following the pattern in OpenMask3D, MaskClustering, Open3DIS and ConceptGraphs:
1. **Detect** objects in each frame with an open-vocabulary detector: Grounding DINO tiny, with a CLIP ViT-B/32 check of each crop.
2. **Project** each segmented 3D object into every posed COLMAP frame. A z-buffer keeps only the voxels that are actually visible.
3. **Vote** on a class per object across views.
4. **Merge** fragments that consistently share one detection box.
5. **Create** new instances from detections that no existing segment explains.
6. **Fall back** to the heuristic label when there is little support (fewer than 2 views, or a posterior below 0.3).

The web app gets a JS port of the Theta\* planner. It plans from the robot's *current* pose on the exported navigation grid.

## Todo status

| Todo | State |
|---|---|
| vision-env (`.venv-vision`, torch 2.2.2, numpy<2) | done |
| detect2d (`pipeline/detect2d.py`) | done; full run in progress |
| semantic-fusion (`pipeline/semantic.py`, wired into `pipeline/run.py`) | done; selftest passes |
| auto-binding (`pipeline/mapping.py`, confidence caps, UI labels) | done; selftest passes |
| nav-exports (`nav_grid.json`, approach poses for all objects) | written; waiting on the current pipeline run |
| web-planner (`web/src/scene/planner.js` + `check-mission.mjs`) | planner written; checks NOT written |
| dispatch-ux (store, dock, driver, inspector) | written; untested |
| verify | not started |

## Update 17:55: detection finished, first fusion run done, found a weighting bug

- **Detection finished.** All 373 frames, 6,510 detections. In `data/derived/vision/detections.json`, by class: other 1406, crate 1215, cabinet 993, pipe 624, pump 600, motor 337, gauge 330, valve 311, tank 298, ladder 242, trolley 154.
- **`python3 -m pipeline.run` (with vision)** reused the cache and took **62 s**.
  - Result: 416 objects, of which 11 were merge groups absorbing 37 fragments, plus 1 new instance.
  - Only **27 objects were vision-labelled**; 387 fell back to the geometry label.
  - Mapping: ai_assisted 1, ai_assisted_fallback 3, procedural_class_match 13, procedural_fallback 11, video_evidence 2.
  - 25 / 30 assets have an approach pose.
  - 34 evidence images were written to `data/derived/vision/evidence/`.
- **Root cause of the low count:** coverage is fine, since 395 of 414 objects are seen in 2 or more views. The posterior in `pipeline/semantic.py` `fuse()` (around line 244) is wrong:
  ```python
  total = sum(scored.values()) + BACKGROUND * max(seen[i], 1)
  ```
  - Each view's vote is `match * det_score * p_cls`, typically 0.05–0.3.
  - But `BACKGROUND = 0.15` is added for *every* view that sees the object.
  - So an object seen in 67 views gets about 10 units of background mass and loses.
  - Example: one object has crate support in 40 / 67 views, yet its posterior is crate 0.129, cabinet 0.126, other 0.126.
  - The best-class support histogram is: 0 views 169, 1 view 36, 2–9 views 117, 10+ views 92. So roughly 200 objects have real multi-view support.
- **Suggested fix (not applied):**
  - Count background only for views where the object is visible but *no* box matched it, and/or lower `BACKGROUND` to about 0.02–0.03.
  - Alternatively, use the support fraction per class (`support[cls] / seen`) as the decision statistic.
  - Then re-run `python3 -m pipeline.run` (62 s) and check the evidence images. Watch the precision of "crate", "cabinet" and "other", which dominate the detections.
  - `semantic.py` is not in the cache key, so tuning it doesn't invalidate the cache.
- I fixed the misleading "no detections.json" message in `run.py` when `--no-vision` is passed.
- **Nothing on the web side has been run yet.** Next steps 2–8 below are still open. Step 4 is now "fix the posterior, re-run, then spot-check".

## Background jobs (none running now)

These may have stopped if the original chat closed. Check with `ps aux | rg "detect2d|pipeline.run"`.

1. **Detection: finished at 17:53** (373 / 373). It doesn't need re-running unless the vocabulary or model changes; a change to either makes it start over. It is resumable. Command for reference:
   ```bash
   .venv-vision/bin/python -u -m pipeline.detect2d 2>&1 | grep --line-buffered -v -i warn | tee data/derived/vision/detect2d.log
   ```
   It needs to run outside the sandbox, because torch hits an OpenMP shared-memory error inside it.
2. **`python3 -m pipeline.run --no-vision`: finished at 17:12 (391 s).**
   - It wrote `data/derived/pipeline_stage1.cache` (42 MB) and `data/derived/nav_grid.json` (204 KB).
   - All 30 assets are bound: 14 class match, 14 fallback, 2 video evidence. These are still the non-vision methods.
   - 23 of 30 assets have an approach pose, and 299 of 439 objects are reachable.
   - The default route to P-002 is unchanged: 7.56 m, 24.0 s, minimum clearance 0.33 m.
   - Next step 1 below is therefore done.
   - The cache is invalidated by any change to `io_ply`, `filtering`, `structure`, `instances`, `classify` or `geometry` in `pipeline/`. Avoid editing those modules, or the next run takes another 9 minutes.

## Files changed or added

**Pipeline (Python)**
- `pipeline/detect2d.py` (new).
  - Detection vocabulary: prompt phrases mapped to app classes. Two new mappings: pressure gauge → `gauge`, and hand truck/cart → `trolley`.
  - Per-phrase token-max scoring instead of HF post-processing, which merges labels.
  - CLIP check on crops at 0, +10% and +20% padding.
  - Options: `--selftest`, `--limit`, `--no-clip`, `--short-side` (default 600).
  - The models must be safetensors-only (`use_safetensors=True`). The transformers version here refuses `.bin` checkpoints on torch < 2.6 (CVE-2025-32434). That is why CLIP is `laion/CLIP-ViT-B-32-laion2B-s34B-b79K`, not `openai/clip-vit-base-patch32`.
- `pipeline/semantic.py` (new).
  - Fusion: `load_frames`, z-buffer `visible_mask`, `fuse`, `decide`, `merge_segments`, `fresh_segments`, `apply_vision`.
  - `write_evidence` writes `data/derived/vision/evidence/OBJ-xxxx.jpg`: two frame tiles, with the projected 3D box in yellow and the detection in green.
  - Thresholds are at the top of the file.
- `pipeline/run.py`: stage-1 cache, vision step after `classify`, `label_source="vision_fusion"` plus an `obj["vision"]` block, evidence images. New flags `--detections --alignment --no-vision --no-cache`.
- `pipeline/mapping.py`:
  - New `ASSET_CLASS_TIERS` (match tier, then fallback tier per Excel asset class) and `ai_assisted` / `ai_assisted_fallback` methods.
  - Pipes are now candidates. Reach limit 0.95 m. Every asset gets bound.
- `pipeline/navigation.py`: `object_approaches` for **every** object goes into `nav_targets.json` → `objects{oid: {reachable, distance_to_walkable_m, approach}}`. `write_nav_grid` writes `nav_grid.json` (walkable, blocked and distance-field rasters in base64, plus planner and motion parameters).
- New `gauge` class added to `classify.py`, `label_vlm.py`, `backend/app/labels.py`, `web/src/review/overrides.js` and `export.py` (colour).
- `backend/app/confidence.py`: caps `ai_assisted` 0.5, `ai_assisted_fallback` 0.25.
- `data/derived/labels_override.json`: `procedural_fill: true`. The two video-evidence pins are kept: OBJ-0185 → ASSET-014 and OBJ-0189 → ASSET-022.
- `pipeline/README.md` and `.gitignore` (`.venv-vision/`, vision logs).

**Web**
- `web/src/scene/planner.js` (new). A JS port of the Python planner:
  - Theta\* with a cost of 1 + w·exp(−d/σ), where d is clearance (distance to the nearest obstacle), then shortcutting.
  - Centripetal Catmull-Rom smoothing, falling back to the polyline and then the raw polyline if the spline collides.
  - A trapezoidal speed profile, with an initial turn in place from the current yaw.
  - `planRoute(grid, {pos, yaw}, approach)` returns a nav-shaped object, or `{error}`.
- `web/src/scene/dispatch.js` (new):
  - `resolveTarget(state, {assetId} | {objectId} | "ASSET-xxx")` returns `{ok, object, approach, label}` or `{ok: false, reason}`.
  - `currentStart` is the front entry when the mission is idle, else `runtime.pose`.
  - `planDispatch` falls back to the old precomputed routes if `nav_grid.json` is missing.
- `web/src/store.js`:
  - New state: `navGrid`, `dispatchError`, and `mission.targetObjectId` / `targetLabel`.
  - `dispatchMission(target)` returns `{ok, reason}`.
  - `restartMission` resets to `baseNav` (front entry).
- `web/src/data.js` + `App.jsx`: `loadNavGrid` → `decodeGrid` → `setSceneData({navGrid})`.
- `web/src/ui/MissionDock.jsx`:
  - The target is the selected asset, else the selected object, else the current target. There is no P-002 fallback.
  - When the button is disabled, its tooltip gives the reason.
  - Button label "Dispatch to P-005", or "Move to OBJ-0108 (…)" for unbound objects.
  - Inline red `dispatchError`. The timeline start is labelled "Previous stop" or "Front entry".
- `web/src/scene/MissionDriver.jsx`: arrival is logged with the target label. Objects with no asset skip the copilot diagnosis and go straight to "report".
- `web/src/ui/inspector/SceneEvidence.jsx` (new): `SendRobotButton` and `VisionEvidence` (vision summary plus evidence image). Used in `ObjectCard.jsx` and `OverviewTab.jsx`.
- `web/src/scene/CameraRig.jsx` and `Overlays.jsx`: the target is found by object ID.
- `TopBar.jsx` and `selectors.js`: "N AI-assisted" count and target label.
- `web/scripts/sync-public.mjs`: copies `nav_grid.json` and mirrors `data/derived/vision/evidence/` into `web/public`.

## Next steps, in order

1. **Wait for `pipeline.run --no-vision`.**
   - Confirm that `data/derived/nav_grid.json` exists and its size is reasonable.
   - Confirm that `nav_targets.json` has `objects` and a summary with `objects_reachable`.
2. **Write the checks in `web/scripts/check-mission.mjs`:**
   - Decode the grid with `decodeGrid`. The script reads JSON from disk; `atob` exists in Node 18 and later.
   - The JS route length to P-002 is within 15% of Python's `nav.json` `stats.path_length_m`.
   - Every sample is collision-free: clearance ≥ robot radius after the snapped-start prefix.
   - Chained planning: entry → asset A, then from A's approach pose → asset B, then back.
   - Replace the stale `expected` proximity list (it assumes only M-004 and P-002 are bound). Compute the expectation from the new data, or make the check order-independent.
   - Run with `cd web && node scripts/check-mission.mjs`.
3. **Run `cd web && npx vite build`** (or the project's lint) to catch import and JSX errors in the untested web edits.
4. **When detection finishes,** run `python3 -m pipeline.run`. This is fast thanks to the cache. Then:
   - Inspect the vision summary it prints: the class histogram and how many objects were fused, merged or created new.
   - Look through `data/derived/vision/evidence/*.jpg` and spot-check about 30 objects.
   - Tune the thresholds in `semantic.py`: `MIN_SUPPORT_VIEWS`, `MIN_POSTERIOR`, `BACKGROUND`, and the 0.15 match score.
5. **Run the selftests:** `python3 -m pipeline.mapping`, `python3 -m pipeline.navigation`, `python3 -m pipeline.semantic`, and `.venv-vision/bin/python -m pipeline.detect2d --selftest`.
6. **Refresh the web data:** `cd web && node scripts/sync-public.mjs && npm run snapshot` (the snapshot regenerates `web/public/data/api` from the backend).
7. **Manual test in the viewer:**
   - Dispatch to P-002, then select another asset and an unbound object mid-route and after arrival.
   - Each time the robot should re-plan from where it is, and the button should never go dead without a reason.
   - Reset should return the robot to the front entry.
8. **Write the final KT** (replace this file's IN PROGRESS status) and update `docs/kt/STATUS.md`.

## Known risks and open questions

- The web edits have never been executed. Expect small runtime bugs in `planner.js`, especially in `motionProfile`, the snapped start and `decodeGrid`'s base64 decoding.
- `atTarget` disables dispatch to the target the robot is already at. `planRoute` also refuses a start within 0.1 m of the goal.
- Some places still compare on the asset ID only: the "in range" scan list (`simulateMission` is fed bound objects only), the label highlight in `Labels.jsx`, and the `Minimap.jsx` target marker. They work for assets but do not highlight unbound-object targets.
- `CommandPalette.jsx` still dispatches by asset ID string. That is fine, since the string form is supported.
- The bindings are by class, not by nameplate: the Excel tag is *assigned*, not read. The UI must keep saying "Unverified · AI-assisted".
