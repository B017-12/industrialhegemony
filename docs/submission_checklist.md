# Submission Checklist

## Required Deliverables

- Working demo
- Repository with README
- 5-8 slides
- Video no longer than 5 minutes
- Short technical note

## Smoke Test Commands

From the repository root:

```bash
python3 -m pipeline.run --ply "Equipment Room.ply" --workbook "Valmet_SinceAI_2026_Synthetic_Industrial_Metaverse_Builder_Pack (1) (2) (1).xlsx"
```

Backend:

```bash
cd backend
python3 -m uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd web
npm install
npm run dev
```

## API Checks

```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/assets/ASSET-014
curl "http://localhost:8000/api/scene/nav?target=ASSET-014"
curl -X POST http://localhost:8000/api/copilot/query \
  -H "Content-Type: application/json" \
  -d '{"asset_id":"ASSET-014","mode":"arrival_diagnosis"}'
```

## Browser Checks

- Clean splat or sampled fallback renders.
- Object boxes align with the scene.
- Status line shows about 71 framed objects and 30 Excel assets.
- `P-002 process pump target` is visible/selectable.
- Robot moves along the red path.
- Nearby asset cards appear while moving.
- `Arrival Diagnosis` returns cited observations and caveats.

## Recording Checklist

- Keep the browser, backend terminal, and slides ready before recording.
- Do one full dry run before the final recording.
- State the PLY limitation once, early and confidently.
- Use the phrase "procedural mapping" when showing Excel bindings.
- Show evidence IDs in the diagnosis panel.
- End with scaling plan and limitations.

## Final Files To Mention

- `README.md`
- `docs/demo_script.md`
- `docs/slides_outline.md`
- `docs/technical_note.md`
- `data/derived/scene_objects.json`
- `data/derived/nav.json`
- `data/derived/labels_override.json`
