# Pipeline

Offline Python pipeline for turning the valid Gaussian splat slice and Excel workbook into derived scene artifacts.

```bash
python3 -m pip install -r pipeline/requirements.txt
python3 -m pipeline.run          # defaults: valid PLY slice, workbook, data/derived (about 16 s)
```

Options: `--ply`, `--workbook`, `--out-dir`, `--previous` (the `scene_objects.json` to keep object ids stable against; default is the current output, then `data/derived/baseline/`), `--max-rows`.

Modules:

| Module | Owner | Job |
|---|---|---|
| `run.py` | Tab 2 (CLI), Tab 3 (navigation call site) | Orchestration |
| `config.py` | shared | Constants, matplotlib cache dir |
| `io_ply.py` | Tab 2 | PLY header and memmap, properties by name |
| `filtering.py` | Tab 2 | Splat attributes (opacity, covariance normal, CIELAB), opacity/covariance filter, SOR, opacity-weighted voxels |
| `structure.py` | Tab 2 | RANSAC + SVD floor, ceiling, walls (boundary and fill tests), scale calibration |
| `instances.py` | Tab 2 | Local PCA, pipe seeds + cylinder fit, HDBSCAN, edge absorption, split, merge, DBSCAN comparison |
| `classify.py` | Tab 2 | Object descriptors, quality filter, heuristic classes, pipe relations |
| `geometry.py` | Tab 2 | Yaw OBB (rotating calipers), OBB 3D IoU, cylinder fit, eigen features |
| `mapping.py` | Tab 2, Tab 8 | Stable ids (Hungarian on IoU), reachable-floor estimate, procedural asset binding after pinning reviewer bindings from `labels_override.json`; `python3 -m pipeline.mapping` runs its self-test |
| `label_vlm.py` | Tab 8 | Optional VLM suggestions for crop-tour images into `vlm_labels.json` (needs `OPENAI_API_KEY`; never writes `human`); `--selftest` uses a stub client |
| `export.py` | Tab 2 | Object JSON, diagnostics images, metrics |
| `navigation.py` | Tab 3 | Floor grid, ESDF clearance cost, Theta*, approach poses, Catmull-Rom smoothing, timed motion profile; `python3 -m pipeline.navigation` runs its self-test |

Outputs:

- `data/derived/scene_objects.json`
- `data/derived/nav.json` (default mission to ASSET-014), `nav_targets.json` (approach pose and mission per bound asset)
- `data/derived/floor_occ.png`, `nav_map.pgm` + `nav_map.yaml` (ROS map)
- `data/derived/diagnostics/boxes_front.png`, `before_after.png`, `segmentation_metrics.json`, `nav_esdf.png`
- `data/derived/baseline/`: the pre-Tab-2 outputs, kept for the before/after comparison

After a rerun, `cd web && node scripts/sync-public.mjs` copies the outputs into `web/public` (`npm run dev` does this too).
