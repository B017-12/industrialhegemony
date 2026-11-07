# 09 Full-room splat from the video: KT handoff (Sat 7 Nov 2026, 11:05)

> **Superseded (14:00):** the organisers supplied an intact splat, `Equipment Room.ply`, and the app now runs on it. See [10-equipment-room-ply.md](10-equipment-room-ply.md). The Brush model `_analysis/brush_out/full/export_30000.ply` is kept only to place the video cameras in the new frame. Its floater and nav-grid problem below no longer matters.

**Goal (P0):**
- the complete boiler room renders in the app as a Gaussian splat;
- M-004 and VS-002 can be reached by robot dispatch.

**Plan:** `~/.cursor/plans/full-room_splat_fix_12a59689.plan.md`. Don't edit the plan file.

## Where things stand

| Step | State |
|---|---|
| 1. Dispatch fix | **Done**, not yet browser-verified |
| 2. COLMAP forensic check | **Done**, passed |
| 3. Brush build (local, Metal on the Radeon 5300M) | **Done** |
| 4. Full training, 30k steps | **Done** at 12:02 (74 min): `export_30000.ply`, 1.5M splats, held-out PSNR 26.04 dB, SSIM 0.882 |
| 5. Splat validator | **Done**, run on the 5k checkpoint |
| 6. Alignment into `ply_raw` | **Done**, solved on the 5k checkpoint; re-solve on the 30k model |
| 7. Pipeline rerun | **Blocked**: the walkable floor is tiny (see "Open problem") |
| 8. Bind M-004 and VS-002 | Tool written (`_analysis/project_objects.py`), not run |
| 9. Web integration (spz, manifest, sync) | Not started |
| 10. Browser verification | Not started |
| 11. Write-up `docs/research/10-full-room-fix.md` and STATUS line | Not started (this KT file stands in for it until then) |

## Root cause (established)

1. **The app has never had a full-room splat.**
   - `web/public/assets/splat-manifest.json` still points at `boiler_room.spz`, which is built from the 502,482 valid rows of the damaged supplied PLY.
   - That slice is the south strip of the room.
   - The COLMAP model from 09-recovery-plan had camera poses only. Nothing had trained Gaussians from them.
2. **M-004 and VS-002 have no real position in any data.**
   - The workbook `Scene_Anchors` rows say `placeholder_until_valmet_scene_received`, with coordinates in a synthetic plant frame.
   - The pipeline bound both as `procedural_fallback` onto unclassified `other` objects (`OBJ-0104` and `OBJ-0113`), 2.8 m and 4.2 m from the walkable floor.
   - A real position can only come from binding them to equipment that's visible in the rebuilt room (step 8).
3. **Dispatch bug** (separate from the above): the Dispatch button always sent `mission.targetAssetId` (P-002).

## What was done, with evidence

### Dispatch fix
In `web/src/ui/MissionDock.jsx`, the primary button now:
- dispatches to `selectedAssetId ?? mission.targetAssetId`;
- is labelled with that asset's tag;
- is disabled, with a tooltip, when `navForTarget()` has no route.

### COLMAP check
`_analysis/check_sfm.py` reads the binaries with numpy through `_analysis/colmap_io.py`. Outputs are in `_analysis/sfm_full/check/` (`sfm_check.json`, `sfm_check.png`).

| Measure | Result |
|---|---|
| Registered frames | 373 / 373 |
| 3D points | 54,118 |
| Mean reprojection error | 0.894 px |
| Track length (median) | 5 |
| Pose jumps | none |
| Camera 1 (335 images) | fx = 1154.8, fy = 1152.9 |
| Camera 2 (38 bridge frames) | fx = 1157.5, fy = 1155.2 |
| Weakly constrained images (fewer than 100 observations) | 11, minimum 31; none dropped |

- The plan view is a clean rectangular room with all four walls.
- An earlier 28-image side model (`txt3`) has fx/fy differing by 13%. It is **not** used.

### Brush build
- Brush 1.0.0, commit `1388f74` (3 Oct 2026), built with Rust 1.99. The toolchain is project-local in `_analysis/.rust`.
- The binary is `_analysis/bin/brush`.
- Building took 33 min. The sandbox redirects cargo's target directory to `/var/folders/.../cursor-sandbox-cache/.../cargo-target`, so the binary was copied out.
- **Brush needs the GPU, so run it with sandbox permission `all`.**
- Brush keeps the COLMAP world frame: no normalisation, no flip. Its exported PLY says `Vertical axis: -0.05 -0.98 0.18`, which matches the gravity estimate from the cameras.

### Training (finished 12:02, 4,440 s)

```bash
cd _analysis && RUST_LOG=info bin/brush sfm_full/undist --total-train-iters 30000 --max-resolution 1200 \
  --eval-split-every 8 --eval-every 2500 --export-every 5000 --export-path "$PWD/brush_out/full" \
  --render-mode default --max-splats 1500000 > brush_out/full/log.txt 2>&1
```

- The smoke run did 500 steps in 43 s, so the Kaggle fallback isn't needed.
- `default` render mode was chosen because Spark renders standard 3DGS with no mip filter.
- Held-out evaluation (every 8th frame) so far:

  | Step | PSNR | SSIM |
  |---|---|---|
  | 2,500 | 22.0 dB | 0.803 |
  | 5,000 | 23.7 dB | 0.845 |
  | 15,000 | 25.5 dB | 0.877 |
  | 20,000 | 25.8 dB | 0.880 |
  | 25,000 | 26.0 dB | 0.882 |
  | 30,000 | **26.0 dB** | **0.882** |

- The splat count reached the 1.5M cap at about step 7,800.
- Exports appear as `_analysis/brush_out/full/export_05000.ply`, then `_10000`, `_15000` and so on up to `_30000`. Each is about 355 MB at 1.5M splats.
- Check progress with: `tr '\r' '\n' < _analysis/brush_out/full/log.txt | grep -E "Eval|Refine" | tail -3`

### Alignment into the app frame
`_analysis/align_to_ply_raw.py` maps COLMAP/Brush coordinates into `ply_raw` (y-down, floor at max y). Registering into the existing frame keeps every existing asset position, override and nav artefact valid.

**`solve` stages:**
1. Level the cloud: gravity from the cameras, refined on the floor plane.
2. **Global search** over scale (0.5–1.0), yaw and mirroring, scored by FFT cross-correlation of the plan-view wall density against the valid slice.
3. Fine yaw/scale refinement.
4. Trimmed, scaled ICP.
5. Write `frame_calibration` (the inherited 1.2865 m/unit and the ceiling height) into the output JSON.

**`apply`:**
- transforms positions, quaternions (`quat(R) ⊗ q`), log-scales (+ log s) and the SH rest bands (exact rotation per band);
- crops to the room box.

The SH rotation is unit-tested to 1e-15 for bands 1–3, and the covariance check is exact. That test caught a transpose bug, now fixed.

**Result on the 5k model** (`_analysis/brush_out/align_5k.json`; the sparse-point solve agrees):

| Measure | Value |
|---|---|
| Scale | 0.6988 (sparse solve: 0.7013) |
| Yaw | 269° |
| Rotation determinant | +1 |
| Plan-correlation score | 0.45 |
| Best mirrored score | 0.27 (so not mirrored) |
| Mean offset of nearby point pairs | 2–4 mm per axis (no systematic bias) |
| Median point-to-point residual | 7–9 cm |
| Aligned room in `ply_raw` | x from -4.86 to 3.93, z from -3.46 to 3.44 (11.3 m × 8.9 m) |

- The 7–9 cm residual is limited by the density of opaque splats at step 5k. Re-measure on the 30k model.
- The old slice is the south strip of the aligned room (z below about -1). The north two-thirds is new.

**Two dead ends worth knowing about:**
- A floor-to-ceiling scale on **sparse** points gave 1.50, double the true value, because the ceiling has almost no SfM points.
- A height-profile scale was also wrong. The global plan-correlation search is what works.

### Validation of the 5k model
Output is `_analysis/brush_out/validation_5k/` (`validation.json`, `coverage.png`).

| Measure | New splat | Old slice |
|---|---|---|
| Splats | 1,107,609 (0 non-finite, 0 zero quaternions, 0 larger than 1 m) | |
| Room cells occupied (0.25 m cells) | **74%** | 21% |
| North half occupied | **77%** | 0% |
| Walls present (x_min / x_max / z_min / z_max) | 97 / 100 / 98 / 100% | 39 / 39 / 98 / 0% |

### Pipeline changes (frame calibration)
**Problem:** the new splat barely contains the ceiling; the camera is pitched about 11° down. The pipeline's own ceiling fit therefore landed on a pipe band at y = -0.31, which:
- gave **1.84 m/unit instead of 1.2865**, inflating every metric distance by 43%;
- made `instances.py` drop every point above that false ceiling.

**Fix:**
- `pipeline/structure.py`: `fit_structure(points, weight, frame=None)`. When `frame` is given, the inherited `ceiling_y` seeds the ceiling RANSAC; if the ceiling is barely observed, the inherited plane is used instead. The inherited `metres_per_unit` is kept, with `method: inherited_frame_calibration`. A non-finite `rms` is replaced so the JSON stays valid.
- `pipeline/run.py`: new `--frame-calibration <json>`, which reads its `frame_calibration` block.
- **Without the flag, behaviour is unchanged.**

**Result on the 5k model:** the ceiling fits by RANSAC at y = -0.81 (3,091 inliers); the scale is 1.2865.

## Open problem (start here once training finishes)

**The navigation grid is mostly blocked.** On the 5k model with the correct scale:

| Grid measure | Value |
|---|---|
| Support (floor) cells | 8,355 |
| Blocked cells | 11,233 |
| Free cells | 1,277, in 30 components |
| Walkable | 0.99 units² |

So `pipeline.run` fails with `ASSET-014 (...) has no reachable approach pose`. Diagnostics are in `_analysis/brush_out/debug_5k/grid.png` (support, blocked, free and walkable layers).

**Ground truth from the camera path:** a person walked every cell under it, so nothing can really stand there. Under the path (radius 0.15 m), the 5k model has 13,100 splats:

| Height above floor | Splats |
|---|---|
| Within ±6 cm (the floor surface) | 4,402 |
| 0.12–1.8 m (the obstacle band) | **3,660** |

The obstacle-band splats are **floaters**: small (1–3 cm) and low opacity (median 0.2–0.25). The nav grid blocks a cell once it holds 3 splats with opacity ≥ 0.1 (`navigation.PARAMS["min_obstacle_splats"]`, `filtering.clean_splats(min_opacity=0.1)`). That threshold was tuned for the old splat and is far too sensitive here. The 5k model also isn't converged: median alpha is 0.16, and only 6% of splats exceed 0.5.

**Next steps, in order:**
1. Wait for `export_30000.ply`, then repeat the camera-path measurement on it. Floaters often persist after convergence.
2. Fix it as **free-space evidence, not a hand-tuned hack**. Splats inside the volume the camera swept, or between a camera and the surfaces it observed, are floaters. Options:
   - (a) drop splats within about 0.4 m of the camera path and below camera height;
   - (b) for nav obstacles only, require opacity ≥ 0.5 and a few splats per cell, scaled to splat density;
   - (c) `npx @playcanvas/splat-transform in.ply -G out.ply` (filter floaters).

   Validate any of these by checking that cells under the camera path become free while walls and equipment stay blocked, and compare `debug_nav.py` grid stats before and after.
3. Re-solve the alignment on the 30k model, then apply it:
   ```bash
   python3 -u _analysis/align_to_ply_raw.py solve --splat _analysis/brush_out/full/export_30000.ply --scale-min 0.5 --scale-max 1.0 --icp-max 0.1 \
     --out data/derived/splat_alignment.json --plot _analysis/brush_out/align_30k.png
   python3 _analysis/align_to_ply_raw.py apply --splat _analysis/brush_out/full/export_30000.ply --alignment data/derived/splat_alignment.json \
     --out _analysis/brush_out/boiler_room_full_raw.ply --crop -5.3 -1.9 -3.9 4.3 1.35 3.9
   python3 _analysis/validate_splat.py _analysis/brush_out/boiler_room_full_raw.ply --alignment data/derived/splat_alignment.json \
     --out _analysis/brush_out/validation_30k --eval-log _analysis/brush_out/full/log.txt
   ```
4. Nav debugging loop (caches the stages, about 25 s per run; delete `stages.pkl` when the PLY changes):
   ```bash
   MPLCONFIGDIR=.cache/matplotlib python3 _analysis/debug_nav.py <aligned.ply> _analysis/brush_out/debug_30k data/derived/splat_alignment.json
   ```
5. Pipeline. Keep a scratch directory until navigation works; a full run is about 5 min at 1.1M splats:
   ```bash
   python3 -m pipeline.run --ply <aligned.ply> --frame-calibration data/derived/splat_alignment.json \
     --out-dir _analysis/brush_out/pipeline_30k --previous data/derived/scene_objects.json
   ```
   When it succeeds, rerun with `--out-dir data/derived`. The old outputs are backed up in `data/derived/baseline_valid_slice/`.
6. Bind M-004 and VS-002 (step 8):
   ```bash
   python3 _analysis/project_objects.py --classes motor pump other --scene <out>/scene_objects.json \
     --alignment data/derived/splat_alignment.json --out data/derived/diagnostics/evidence
   ```
   - Pick a visible electric motor for M-004. The inline circulator pumps' motor heads (red and black, visible in the video) are the natural candidates.
   - Pick a pump or motor housing for VS-002, and state plainly that the sensor itself isn't visible.
   - Add both to `data/derived/labels_override.json` under `overrides` as `{"<OBJ-id>": {"asset_id": "ASSET-022", "mapping_confidence": 0.6, "mapping_notes": "<evidence frame>"}}`. ASSET-029 is VS-002.
   - Rerun the pipeline and confirm both have `reachable: true` in `nav_targets.json`.
7. Web:
   - Adapt `web/scripts/compress-splat.mjs`: input `_analysis/brush_out/boiler_room_full_raw.ply`, output `boiler_room_full.spz`, a new `cropBox`, and `fallbackUrl` set to the old spz.
   - Then `node scripts/sync-public.mjs` (from `web/`).
   - 1.5M splats is inside Spark's desktop budget (1–5M). If fps drops, use `maxStdDev: Math.sqrt(5)` in `web/src/scene/Splat.jsx`.
8. Verify in the browser (the Vite and uvicorn dev servers are already running in terminals 4 and 5):
   - overview and top-down screenshots of both sides;
   - the fps reading;
   - Dispatch to M-004 and to VS-002, with the robot arriving;
   - `node web/scripts/check-mission.mjs`, and `pytest` in `backend/`.

## Files

| File | What it is |
|---|---|
| `web/src/ui/MissionDock.jsx` | Dispatch fix |
| `pipeline/structure.py`, `pipeline/run.py` | Frame calibration (`--frame-calibration`) |
| `_analysis/colmap_io.py` | numpy COLMAP binary readers |
| `_analysis/check_sfm.py` | SfM forensic check |
| `_analysis/align_to_ply_raw.py` | `solve` / `apply` Sim(3) into `ply_raw`, with SH rotation |
| `_analysis/validate_splat.py` | Attribute, coverage and PSNR report for a splat in `ply_raw` |
| `_analysis/debug_nav.py` | Pipeline stages up to the nav grid, cached, with grid plots |
| `_analysis/project_objects.py` | Object boxes drawn onto the video frames (evidence for bindings) |
| `_analysis/bin/brush`, `_analysis/brush/`, `_analysis/.rust/` | Brush binary, source and toolchain (git-ignore these) |
| `_analysis/brush_out/` | Smoke run, full run, `align_5k.*`, `aligned_5k.ply`, `validation_5k/`, `debug_5k/` |
| `data/derived/baseline_valid_slice/` | Backup of every derived artefact before any rerun |

`data/derived/` itself is **unchanged** so far, so the running app still shows the old slice.

## Sources used

- [Brush README](https://github.com/ArthurBrussee/brush) (macOS/AMD through WebGPU; COLMAP input).
- VRAM and buffer issues: [#248](https://github.com/ArthurBrussee/brush/issues/248), [#304](https://github.com/ArthurBrussee/brush/issues/304).
- Fusion panics: [#420](https://github.com/ArthurBrussee/brush/issues/420) (watch for it; not seen yet).
- Sim(3) update for splats, including the SH Wigner rotation in the (-y, z, -x) basis: [splatreg PLY interop](https://archerkattri.github.io/splatreg/ply-interop/); [PlayCanvas forum on SH rotation](https://forum.playcanvas.com/t/solved-sh-coordinates-and-gaussian-reorientation/40396).
- Scale ambiguity between COLMAP models: [colmap #841](https://github.com/colmap/colmap/issues/841), [#2228](https://github.com/colmap/colmap/issues/2228).
- Umeyama alignment of video 3DGS rooms to a floor plan: [TU Delft 2026 thesis](https://www.gdmc.nl/publications/2026/MScThesisMingjieTeo.pdf).
- Spark splat budgets and `maxStdDev`: [performance](https://sparkjs.dev/docs/performance/), [SparkRenderer](https://sparkjs.dev/docs/spark-renderer/).
- Invalid or NaN splats in exports: [supersplat #406](https://github.com/playcanvas/supersplat/pull/406).
- [splat-transform flags](https://github.com/playcanvas/splat-transform), including `-G` floater filter and `-N` NaN filter.
