# Tab 8: Label review and VLM labelling

Status: **PARTIAL**. The tooling is built and tested: backend routes, pipeline pinning, the VLM script, and the web review mode with a crop tour and a keyboard queue. pytest, the build and both Node checks pass. What's missing is the browser and human side. The review mode has never been opened in a browser, the crop tour has never run, and **no object has a person-confirmed label yet** (0 of 40). The Tab 7 tooltip clamp was planned here but not done. The user stopped the tab at this point.

## 1. Outcome

- **Review mode in the viewer.** Open it from the top-bar "Review labels" button, the `L` key or Cmd+K.
  - It replaces the inspector with a review panel: reviewer name, "N of 40 reviewed" progress, crop-tour controls, the current object (crop, suggestions, facts, binding) and the full queue.
  - Every action is one key: accept (`A`, or `Shift+A` for unsure), class (`C`, then `1`-`9`, `0`, `-`, `=`), rename (`R`), merge into one of 3 nearest neighbours (`M`, then `1`-`3`), reject (`X`), bind (`B`), unbind (`U`), skip (`S` or right arrow), back (left arrow), undo (`Z`).
- **Queue order.** P-002's target `OBJ-0015` comes first, then the other 29 bound objects (reachable ones first), then the 14 unbound objects within 1.6 m of the default route, then the rest. That's 44 in the first three groups, enough for the 40 goal.
- **Backend.** Writes go through `PATCH /api/labels/overrides/{id}`, which requires a reviewer name and stamps `reviewed_at`. In the same atomic write, it:
  - unbinds an asset's old object on a rebind;
  - computes the union box for a merge;
  - unbinds a rejected object.
  Undo posts the returned `previous` entries to `/api/labels/restore`.
- **Hidden objects.** Rejected and merged objects disappear from overlays, labels, the minimap, missions and backend bindings. Saving a label no longer refits the camera.
- **Pipeline.** `pipeline/mapping.py` pins every reviewer binding and unbinding, and excludes rejected and merged objects. A rerun after a rebind therefore moves the mission. Class matching still uses the pipeline's own heuristic classes, so relabelling `OBJ-0015` to `valve` keeps it as the P-002 target.
- **VLM.** `pipeline/label_vlm.py` is written and its self-test passes, but it has not been run (no `OPENAI_API_KEY`). It only writes `vlm_labels.json` suggestions, never `human`.

## 2. Changes

New:
- `backend/app/labels.py`: review actions (`apply_action`), the merge box, restore, delete, summary and crop storage, all behind a lock with atomic writes.
- `backend/app/routes/labels.py`: `/api/labels/*` routes (overrides GET, PATCH, DELETE; restore; summary; crops; vlm).
- `backend/tests/test_labels.py`: 16 tests. They use a temporary override file, so `data/derived/` is never touched.
- `pipeline/label_vlm.py`: optional VLM labeller (OpenAI Responses API with a strict class `enum`), plus `--selftest` with a stub client.
- `web/src/review/overrides.js`: pure merge rules (`applyOverrides` drops hidden objects into `hiddenObjects`, plus `mergeOverrides`, `isHidden` and the class lists).
- `web/src/review/queue.js`: `buildQueue`, `nearestNeighbours`, `queueStats` and `REVIEW_GOAL`.
- `web/src/review/CropTour.jsx`: in-canvas tour (select, instant fly, 18 settle frames, `gl.render`, crop of the projected box, upload).
- `web/src/review/ReviewPanel.jsx`: the review UI and its keyboard handler (capture phase, so `Esc` closes sub-modes before the app's own `Esc` chain).
- `web/scripts/check-review-queue.mjs`: Node check of the queue order and merge rules on the real data.
- `docs/research/08-labelling.md`: research note (written by a subagent).

Changed:
- `backend/app/scene_index.py`: `load_overrides`, `is_hidden`; bindings skip hidden objects; `BINDING_FIELDS` gains `review_status`, `reviewer` and `reviewed_at`.
- `backend/app/confidence.py`: `human_assigned` cap 0.5, with its own reason text.
- `backend/app/evidence.py`: the `MAP:` text says when a person reviewed the label.
- `backend/app/artifacts.py`: `write_json` (atomic write plus cache drop).
- `backend/app/config.py`: `CROPS_DIR`, `VLM_LABELS`.
- `backend/app/models.py`, `backend/app/routes/__init__.py`: review models; the router is registered.
- `pipeline/mapping.py`: `load_overrides`, pinning in `bind_assets`, `selftest()` (`python3 -m pipeline.mapping`).
- `pipeline/run.py`: passes the overrides to `bind_assets`.
- `pipeline/README.md`: rows for the module changes.
- `web/src/store.js`: `baseSceneObjects`, `labelOverrides`, `ui.mode`, `review.{tour, cropsVersion}`, and the actions `setLabelOverrides`, `setReviewMode`, `setReview` and `setTour`.
- `web/src/data.js`: `fetchOverrides` (API first, then the static file), `loadSceneData` returning base objects and overrides, plus `patchOverride`, `restoreOverrides`, `uploadCrop`, `fetchLabelSummary`, `fetchCrops`, `fetchVlmLabels` and `cropUrl`.
- `web/src/App.jsx`: loads the base objects and overrides; adds the `L` shortcut; the legend now says "All bindings unverified".
- `web/src/scene/CameraRig.jsx`: `fit` is keyed on rounded bounds; `flyTo` can reach hidden objects and returns a promise; exports `cameraApi`.
- `web/src/scene/Viewer.jsx`: mounts `CropTour`.
- `web/src/ui/inspector/Inspector.jsx`: shows `ReviewInspector` in review mode.
- `web/src/ui/TopBar.jsx`: the `ReviewToggle` button, with the human-reviewed count.
- `web/src/ui/CommandPalette.jsx`: the "Review labels" command.
- `web/src/ui/status.js`, `primitives.jsx`, `inspector/OverviewTab.jsx`: `human_assigned` shows as "Unverified · Reviewer-assigned" with its own caveat text.
- `docs/contracts.md`, `docs/labeling.md`: see section 4. `labeling.md` also has the review workflow.

## 3. How to run and verify

```bash
cd backend && python3 -m pytest -q -p no:asyncio      # 111 passed (95 + 16)
python3 -m pipeline.mapping                             # mapping selftest ok
python3 -m pipeline.label_vlm --selftest                # label_vlm selftest ok
python3 -m pipeline.label_vlm                           # no crops yet / no key: exits cleanly
cd web && node scripts/check-review-queue.mjs           # 11 PASS, prints progress and the next 8 objects
cd web && node scripts/check-mission.mjs                # all checks pass
cd web && npx vite build                                # passes, bundle 4.19 MB
curl -s http://127.0.0.1:8000/api/labels/summary        # {"objects":101,...,"human_reviewed":0,...}
```

The review session, which is the first job for whoever resumes:
1. Open http://localhost:5173 and press `L`. Enter your name.
2. Click "Capture 101". Watch that the crops show the object and its accent box; stop with "Stop" if they don't.
3. Review at least 40 objects. Start with `OBJ-0015`: it is visually a handwheel valve, so the recommendation is `C`, then `3` (valve), and it stays the P-002 target. Then work through the 29 bound objects and the 14 route objects.
4. If any binding moved, run `python3 -m pipeline.run`. Then run `node web/scripts/sync-public.mjs`, `npm run snapshot` (backend up), and `cd backend && python3 -m app.cache --warm ASSET-014`.
5. Write the label-source counts into `docs/labeling.md`, using `/api/labels/summary`.

## 4. Contract changes

All are in `docs/contracts.md`. No existing response shape changed.

- **`labels_override.json` entries** gain optional `review_status` (`confirmed`, `relabelled`, `rejected` or `merged`), `reviewer`, `reviewed_at`, `merged_into` and `merged_from`, plus the union `obb`, `center` and `aabb_*` on a merge parent. Hidden objects are dropped by every consumer.
- **New `mapping_method`:** `human_assigned` (0.45, capped at 0.5).
- **New files:** `data/derived/crops/` (`OBJ-xxxx.png` plus `index.json`) and `data/derived/vlm_labels.json` (optional).
- **New routes:** `GET /api/labels/overrides`, `PATCH /api/labels/overrides/{id}`, `POST /api/labels/restore`, `DELETE /api/labels/overrides/{id}`, `GET /api/labels/summary`, `POST /api/labels/crops/{id}`, `GET /api/labels/crops`, `GET /api/labels/crops/{id}.png`, `GET /api/labels/vlm`.
- **Web:** overrides are now read from `/api/labels/overrides` first, with the static copy as fallback.
- **Not yet in the "Frontend store" section of `contracts.md`:** `baseSceneObjects`, `labelOverrides`, `sceneObjects.hiddenObjects`, `ui.mode`, `review.{tour, cropsVersion}` and the actions listed in section 2.

## 5. Research used

See `docs/research/08-labelling.md`.

| Source | Decision |
|---|---|
| OpenMask3D, Open-YOLO 3D, ConceptGraphs | Geometry proposes, a 2D model names. One framed view per object with padded context; the tour picks the view with `fitToBox`, not a top-k visibility search. |
| OpenAI Structured Outputs | A strict JSON schema with a class `enum`; an off-list answer falls back to `other` with confidence 0. |
| Work on verbalised-confidence calibration | VLM confidence only orders the queue and flags `needs_review` below 0.6. It is never written as a label. |
| CVAT and Label Studio shortcuts | Single-key actions, number keys for classes, next and back, undo, and reviewer plus timestamp on every entry. |

The research note arrived after the build, and it recommends several things that were not adopted. They are worth doing before the VLM is run for real:
- **Two views per object.** Score 3 camera angles by visibility and send the best 2 in one request, instead of one `fitToBox` view.
- **Wider padding.** Use about 20% per side; the current `PAD` is 0.35 of the fitted box.
- **Box outline.** Draw the outline on the crop and prompt for "the object inside the outline". Today the crop relies on the viewer's accent box being visible.
- **Low image detail.** Send crops at `detail: "low"`.
- **More review triggers.** Set `needs_review` when the model's class differs from the heuristic class, when the two views disagree, or when the class is `other`. Today only confidence below 0.6 sets it, and the model's self-reported confidence tends to run high (80–100%).
- **Queue order and labelling.** Order the queue by disagreement first, then by lowest confidence. Label the number "self-reported confidence" in the UI.

The suggested keys (`Enter` accept, `J`/`K` next and previous, `Cmd+Z` undo, `Shift+B` unbind) differ from the built ones (`A`, arrows, `Z`, `U`). Nothing needs to change; this is only noted.

## 6. Evidence

- pytest: **111 passed**. The new tests cover:
  - a relabel round trip (file, API and `/api/assets` scene);
  - confirm keeping the class;
  - rejection of a bad class, a blank reviewer and a missing reviewer field;
  - an unknown object returning 404;
  - a rebind unbinding the old object, moving the anchor, and keeping the copilot capped at 0.5 with a reviewer reason;
  - undo via restore;
  - a merged box containing both children's corners;
  - merge conflicts returning 409;
  - reject unbinding;
  - `MAP:` evidence naming the reviewer, with validation still passing;
  - summary counts;
  - crop upload and serve, and a bad PNG returning 422;
  - `/api/labels/vlm` returning 404 when the VLM was never run.
- `check-review-queue.mjs`: 11 PASS.
  - Order checks: the target comes first; then the 29 bound objects, 12 of them reachable, with reachable first; then 14 route objects sorted by distance; structure planes come last.
  - Merge rules: reviewed objects move to the end; a rejected object is hidden; a relabel is merged; merge neighbours of `OBJ-0015` are `OBJ-0098` (0.45), `OBJ-0117` (0.53) and `OBJ-0115` (0.61).
- Live backend (`--reload`, port 8000): `/api/labels/summary` returns 101 objects, 4 structure and 97 heuristic, 0 human, 0 crops.
- `data/derived/labels_override.json` is still empty, so tests never wrote to it.
- Build passes (4.19 MB, was 4.16). `check-mission.mjs` passes.
- **No screenshots.** `08-1` to `08-4` were not captured.

## 7. Known issues and limitations

- **Nothing browser-verified.** The review panel, the keyboard handler, `CropTour` (especially whether `gl.render` plus `drawImage` captures Spark splats with `preserveDrawingBuffer` off), crop display, undo and the camera-stability fix are built but unverified.
  - If crops come out black, set `preserveDrawingBuffer: true` on the Canvas `gl` prop during the tour, or capture inside a `useFrame` after render.
- **0 of 40 reviewed.** The Tab 8 acceptance criterion is unmet until a person runs the session.
- **Tab 7 tooltip clamp not fixed.** `TelemetryChart.jsx` line 198 still assumes a 130 px tooltip. The fix: measure it with a ref, and flip it left when `x + 8 + w > width`.
- **Rejecting or merging the selected object clears the selection.** The panel then moves on to the next object, but Back (left arrow) can't return to it; use Undo (`Z`) instead.
- **Hidden objects have no box in their crop**, because they are not drawn.
- **The mission doesn't follow a binding change until the pipeline reruns.** `MissionDriver` keeps the proximity timeline from the last dispatch. After a rebind, `nav.json` and `nav_targets.json` still point at the old object until `python3 -m pipeline.run`. The PATCH response's `notes` says so.
- **No offline writes.** In static mode the panel disables saving and offers "Download labels_override.json". Crops need the backend.
- The Node checks print the harmless `MODULE_TYPELESS_PACKAGE_JSON` warning, the same one Tab 7 noted.

## 8. Notes for the next tabs

- **Resume Tab 8 first:**
  - run the session in section 3;
  - capture `08-1-review-queue`, `08-2-crop-tour`, `08-3-relabelled-target` and `08-4-tooltip-fixed`;
  - fix the tooltip;
  - add the new store fields to `contracts.md`.
- **Scripted checks** (dev mode):
  - `__store.getState().setReviewMode(true)` opens review mode;
  - `setTour({state: "running", objectIds: ["OBJ-0015"], done: 0, total: 1, failed: 0})` runs a 1-object tour;
  - `/api/labels/crops` shows the result.
- **Never** write `label_source: human` from a script or agent. Tests must monkeypatch `config.LABELS_OVERRIDE`, as `test_labels.py` does.
- **Tab 9:**
  - report label counts from `/api/labels/summary` in the technical note and slides;
  - decide whether `data/derived/crops/` goes into git (it's about 101 small PNGs);
  - rerun `npm run snapshot` and re-warm the cache after the review, so the offline `MAP:` evidence matches.
