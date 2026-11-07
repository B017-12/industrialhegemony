# Valmet Industrial Metaverse Prototype

This repository builds a local hackathon prototype for the Valmet x Since AI challenge: extract framed scene objects from a Gaussian splat, bind the supplied Excel assets procedurally, simulate a collision-free robot route, and show grounded fault diagnosis for the target pump.

## Important Data Note

The scene source is the intact organiser splat `Equipment Room.ply`: 1,676,481 splats covering the whole room. Its SHA-256 is:

```text
83d8c7d99316c08c9719cfc2c5a6b9d1903b89847780e2458adc662c79f32955
```

It replaces the earlier `Industrial Boiler Room (1).ply`, which was damaged after its first 502,482 splats (SHA-256 `117195366421b07aa6738415e94609d96cd41993a0c5b8e8b730849f6b7f1b03`). That file's valid slice, `_analysis/boiler_room_valid.ply`, is kept only for reference. See `docs/kt/10-equipment-room-ply.md`.

## Architecture

- `pipeline/`: offline Python pipeline for PLY validation, structure planes, DBSCAN object boxes, navigation grid, and procedural asset mapping.
- `backend/`: FastAPI + SQLite service for Excel data, scene objects, navigation, and grounded copilot responses.
- `web/`: React + three.js + Spark viewer for the splat, object overlays, robot path, proximity HUD, and diagnosis panel.
- `docs/`: shared context, data contracts, runbook, demo script, slides outline, and technical note.
- `data/derived/`: generated JSON/PNG artifacts consumed by backend and frontend.

## Quick Start

Commands will be finalized as each stream lands:

```bash
# Pipeline
python -m pipeline.run --ply "Equipment Room.ply"

# Backend
cd backend && python -m uvicorn app.main:app --reload

# Frontend
cd web && npm install && npm run dev
```

See `docs/context.md`, `docs/contracts.md`, and `docs/runbook.md` for the current working agreements.
