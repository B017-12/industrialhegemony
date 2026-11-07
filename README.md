# Valmet SpatialSense — Semantic 3D Boiler Room & Autonomous Field-Service Copilot

Built for the **Valmet × Since AI 2026 Challenge** (*Industrial Metaverse: Semantic 3D Scene Understanding & Autonomous Field-Service Copilot*).

This React + Three.js frontend prototype transforms `Industrial Boiler Room (1).ply` (1,506,136 raw 3D Gaussian Splatting vertices) into an interactive **Semantic Industrial Metaverse** grounded in the 30 assets (`ASSET-001` to `ASSET-030`), scene anchors (`ANCHOR-001` to `ANCHOR-030`), telemetry, events, work orders, and RAG SOP documents from the official **Valmet Builder Pack**.

---

## Quick Start (How to Run in Your IDE)

Open a terminal in `d:\i` and run:

```powershell
npm install
npm run dev
```

Or run the included launcher script in PowerShell:

```powershell
.\start_prototype.ps1
```

Then open **http://localhost:5173** in your browser.

---

## Core Architecture & Features

### 1. Real 3DGS PLY Splat Extraction & "Dumb Scan → Semantic World" Lens
- **File**: [`src/components/BoilerRoomViewport.jsx`](src/components/BoilerRoomViewport.jsx) & [`scripts/preprocess_ply.mjs`](scripts/preprocess_ply.mjs)
- Reads the binary 3D Gaussian Splatting file `Industrial Boiler Room (1).ply`, decodes the 0th-order Spherical Harmonics (`f_dc_0`, `f_dc_1`, `f_dc_2`) into RGB colors via $C = 0.5 + 0.282095 \cdot f_{dc}$, filters low-opacity floaters (`opacity < -1.2`), and converts 3DGS camera coordinates (`+Y` down, `+Z` forward) to Three.js right-handed world space (`+Y` up, floor at $Y \approx -1.03\text{ m}$).
- Use the **Raw 3D Scan ↔ Semantic World** slider in the top bar to smoothly transition between the unindexed point cloud and the 3D-framed semantic digital twin (30 Valmet assets + 8 primary boiler vessels, headers, pipe racks, and MCC cabinets).

### 2. Dual-Profile Obstacle-Aware 3D A* Pathfinding & Proximity Radar
- **File**: [`src/utils/pathfinding.js`](src/utils/pathfinding.js)
- Implements a real-time 3D A* navigation graph on the walkable boiler house floor (`Y = -1.02m`):
  - **Human Technician Profile (Cyan Tube)**: Traverses the central **Elevated Catwalk Step (`N-M-STEP`, `has_stairs: true`)** and narrow `0.72m` pipe alleys.
  - **Wheeled AMR Inspection Robot Profile (Orange Tube)**: Rejects edges with `has_stairs: true` or `min_width < 1.1m`, routing safely along the wide perimeter corridor.
- **Proximity-Based Asset Highlighting**: As the robot/avatar walks along the path (`Play/Pause` or scrub slider), a pulsing 3D radar ring scans for assets within the configurable **Proximity Radius** (`0.8m – 3.2m`), dynamically scaling their 3D wireframes and surfacing live distance + telemetry badges.
- **Live Dynamic Hazard Rerouting**: Click **"Drop Floor Hazard"** (or click any floor waypoint sphere in the 3D scene) to place a red hazard zone and watch A* reroute in `<2ms`.

### 3. Context-Aware Maintenance "Why" Panel & Grounded Valmet Dataset
- **Files**: [`src/data/valmetDataset.js`](src/data/valmetDataset.js) & [`src/components/AssetInspectorPanel.jsx`](src/components/AssetInspectorPanel.jsx)
- Clicking any 3D bounding box or sidebar asset (such as faulty **`CV-003`**, cavitating **`P-002`**, fouled **`P-005`**, or overheated **`M-006`**) displays:
  - **Spatial & Process Coupling Topology** (e.g., how suction strainer fouling on `P-002` propagates pressure pulsations downstream to `CV-003` and `PT-002`).
  - **4-Step Explainable Context Decision Tree** (`OBSERVATION` → `SPATIAL_CONTEXT` → `ROOT_CAUSE` → `SAFE_ACTION`).
  - **30-Minute Telemetry Trends**, active plant events (`EVT-...`), open work orders (`WO-...`), data quality flags (`DQ-...`), and cited Valmet RAG docs (`DOC-CONTROL_VALVE-CORE`, `DOC-PROCESS_PUMP-CORE`, `DOC-FIELD-SAFETY`, etc.).

### 4. Synced Mobile AR Field HUD & Offline Edge AI Copilot
- **File**: [`src/components/EdgeCopilotAndArHud.jsx`](src/components/EdgeCopilotAndArHud.jsx) & [`src/utils/copilotEngine.js`](src/utils/copilotEngine.js)
- Click **"AR HUD"** in the top-right of the inspector panel to open the simulated **Mobile AR Field View** anchored to the physical QR tag (`QR-SYN-0001` to `QR-SYN-0030`) with a synced hands-free LOTO checklist.
- Use the bottom **Offline Edge AI Copilot** bar to run preset or custom natural-language queries with explicit asset, event, work order, and SOP document citations.

---

## Python pipeline & backend (branch `feat/pipeline`)

Real extraction from `Equipment Room.ply` (the same boiler room as `Industrial Boiler Room (1).mp4`) and a
grounded copilot over the Excel builder pack. CPU only; ~40 s end to end.

### Setup
```bash
# challenge files are read-only; link them in (paths are gitignored)
mkdir -p data/raw
ln -s "/path/to/VALMET/Equipment Room.ply" data/raw/equipment_room.ply
ln -s "/path/to/VALMET/Valmet_SinceAI_2026_Synthetic_Industrial_Metaverse_Builder_Pack (1) (2) (1).xlsx" data/raw/builder_pack.xlsx
uv sync                                   # Python 3.12 env
uv run python -m pipeline.run_all         # writes public/assets/*.json + equipment_room_splats.bin
uv run uvicorn backend.app:app --port 8000
npm run dev                               # Vite proxies /api -> :8000
# open http://localhost:5173/viewer.html  # photoreal scan + extracted frames + rails + walking avatar + diagnosis
uv run pytest                             # 11 tests: route invariants, API contract, grounding
```
Copilot LLM: copy `.env.example` to `.env`, set `LLM_MODEL=google:<model>` + `GEMINI_API_KEY`. Without them the
copilot answers deterministically from the same evidence (mode `fallback`).

### Stages (`pipeline/`)
| stage | what it does | output |
|---|---|---|
| clean | memmap the 3DGS PLY; keep splats with sigmoid(opacity) > 0.1 and max scale < 0.3 (912k of 1.68M); world frame = (x, −y, −z) | `splats_clean.npz`, `public/assets/equipment_room_splats.bin` |
| orient | floor/ceiling from the height histogram + RANSAC (floor tilt 0.34°) | `transform.json`, sanity renders |
| export_splat | room-cropped, ceiling-cut Gaussian splats in the world frame (1.0M splats, 33 MB; gitignored) | `public/assets/equipment_room.splat` |
| excel | all 16 sheets into an in-memory store (telemetry append supported) | `public/assets/pack_assets.json` |
| segment | floor/ceiling/wall removal → 4 cm voxels → bridged connected components → recursive watershed / spatial split → oriented boxes | 221 objects |
| label | heuristic class + explicit `label_confidence`, per-object thumbnails for a VLM pass | `objects.json` |
| rails | per-height-band occupancy; body clearance = distance − half-width; rails = medial axis of the walkable area (**left = right nearest obstacle**) | `public/assets/rails.json` |
| map | P-005 (ASSET-017, FOULING, health 44) pinned to a confirmed pump; other 29 assets placed procedurally by class, healthy ones along the route | `public/assets/registry.json`, `objects.json` |
| navigate | min-cost route pulled onto the rails; collision check per band; left/right clearance per sample; proximity timeline | `public/assets/path.json`, `timeline.json` |

Scene choices that survive re-segmentation (target position, start) live in `pipeline/scene_config.json`.

### Scan viewer (`viewer.html`, `src/viewer/`)
Separate page from the prototype app, rendering the real pipeline output: photoreal splats via
`@mkkellogg/gaussian-splats-3d` (point-cloud fallback), object frames coloured by Excel condition with
demo-2-style labels, rails, the route, an avatar walking it with a 1.5 m proximity ring and live "nearby"
list, click-to-inspect, and the copilot diagnosis on arrival. Space = walk/pause. Runs at ~1M splats on an
Intel Iris Xe.

### Backend (`backend/`)
Routes follow the pack's `API_Contract` sheet: `GET /api/assets`, `/api/assets/{id}`, `/telemetry` (+ `POST` append),
`/events`, `/documents`, `/api/scene/anchors`, `POST /api/copilot/query`, `POST /api/work-orders/draft` (DRAFT only),
plus `/api/scene/objects`, `/api/sim/{rails,path,timeline}`, `/api/assets/{id}/status-line`.
The copilot builds a deterministic evidence pack (telemetry trends vs healthy peers, events, work orders, matching
historical cases, data-quality issues, docs), computes confidence (model confidence − data-quality and mapping
penalties), and strips any cited ID that does not exist in the pack. `src/api.js` is the frontend client.

### Honest limitations
- Class labels are heuristic (many objects are `clutter`); the VLM labelling pass needs a Gemini key.
- Scene units are not calibrated (room height reads 2.05 units).
- `telemetry_full_14d_30min.csv` and `DOC-ASSET-*.md` are referenced by the pack but were not provided.
