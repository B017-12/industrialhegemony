# Runbook

Run all commands from the repository root unless noted otherwise.

## 1. Validate PLY

```bash
python3 _analysis/validate_ply.py "Equipment Room.ply"
```

Expected: 1,676,481 of 1,676,481 plausible rows, with SHA-256:

```text
83d8c7d99316c08c9719cfc2c5a6b9d1903b89847780e2458adc662c79f32955
```

## 2. Generate Derived Scene Artifacts

```bash
python3 -m pipeline.run --ply "Equipment Room.ply" --workbook "Valmet_SinceAI_2026_Synthetic_Industrial_Metaverse_Builder_Pack (1) (2) (1).xlsx"
```

This takes about 4 minutes. Video-evidence bindings in `data/derived/labels_override.json` (P-002, M-004, VS-002) are pinned on every rerun. Then refresh the viewer assets from `web/`:

```bash
node scripts/compress-splat.mjs && node scripts/sync-public.mjs
```

Expected outputs:

- `data/derived/scene_objects.json`
- `data/derived/nav.json`
- `data/derived/floor_occ.png`
- `data/derived/diagnostics/`

## 3. Start Backend

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/api/health
```

## 4. Start Frontend

```bash
cd web
npm install
npm run dev
```

Open the Vite URL and verify:

- Clean splat renders.
- Object boxes align with the splat.
- Robot follows the navigation path.
- Proximity HUD displays bound asset cards.
- Arrival diagnosis appears for `ASSET-014`.

## 5. Demo Smoke Test

1. Run the pipeline.
2. Start backend.
3. Start frontend.
4. Dispatch the robot to `ASSET-014`.
5. Confirm the copilot answer cites evidence IDs and includes a safety caveat.
