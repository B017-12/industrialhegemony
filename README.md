# Valmet DNA SpatialSense — Semantic 3D Industrial Digital Twin & Autonomous Field-Service Copilot

Built for the **Valmet × Since AI 2026 Challenge** (*Industrial Metaverse: Semantic 3D Scene Understanding & Autonomous Field-Service Copilot*).

**Valmet DNA SpatialSense** transforms raw 3D Gaussian Splatting (`.spz` / `.ply`) captures of industrial facilities (`Equipment Room.ply` — 1.67M splats, and `Industrial Boiler Room (1).ply` — 1.50M splats) into an interactive **Semantic Industrial Digital Twin** grounded in the 30 assets (`ASSET-001` to `ASSET-030`), scene anchors (`ANCHOR-001` to `ANCHOR-030`), 3-day telemetry, plant events, SAP PM work orders, LOTO checklists, and RAG SOP documents from the official **Valmet Builder Pack**.

---

## Quick Start

### 1. One-Click Full Stack on Windows (Frontend + Python Backend)
Double-click or run [`run_full.bat`](run_full.bat) from the project root:
```cmd
.\run_full.bat
```
- Automatically checks/installs `uv` (Python 3.12), syncs Python dependencies, installs `npm` packages if needed, launches the FastAPI backend on **`http://127.0.0.1:8000`**, and starts the Vite React app on **`http://localhost:5173`**.

### 2. Frontend-Only (Vite Dev Server)
```bash
npm install
npm run dev
```
Open **`http://localhost:5173`**. (All 3D scene edits, CV inspections, telemetry waveforms, and copilot queries automatically use built-in client-side fallbacks when the Python backend is not running.)

### 3. Zero-Build / iPad (`iSH`) Standalone Mode
If running on a lightweight environment without Node/Vite (e.g., iPad `iSH` shell):
```sh
node instant_server.mjs
# or: python3 -m http.server 5173 (open /standalone.html)
```

---

## Dual-Persona UI Architecture (Obsidian Glassmorphism)

The top header bar switches seamlessly between two operational modes:

### 1. Technical Console (Default Mode)
- **Full-Bleed 3D Viewport + Collapsible Slide-Out Drawers**:
  - **Alerts & Dispatch**: Live simulation exercise controller (`Pause/Resume Time`, `Inject Random Fault`, `+ Technician`, `+ AMR`), active fault triage, and 1-click unit dispatch.
  - **Assets (30)**: Searchable, filterable inventory of all 30 anchored Valmet assets with live health scores and 3D fly-to focus.
  - **CV & 3DGS (441)**: Interactive browser for all 441 Computer Vision 3D Oriented Bounding Boxes (OBBs), class confidence filters, and ground-truth overrides.
  - **Visual AI**: Multi-frame visual inspection (`backend/vision`), discrepancy cross-checking against Excel state, and bounding-box region linking.
  - **Scene Edit**: Real-time 3D Gaussian Splat object separation & translation (`@sparkjsdev/spark` `SplatEdit` + SDF volume masking). Move or remove floor obstacles (chairs, ladders, pallets, cabinets, pumps) and watch medial-axis floor rails and A* routes replan automatically.
  - **Navigation & Fleet**: Dual-profile kinematic routing (**Human Technician** vs. **Wheeled AMR**), dynamic floor hazard injection, and multi-agent fleet coordination (`R1`, `R2`, `H1`).
  - **Work Orders**: SAP PM work order queue (`WO-...`) and 4-stage challenge verification scenarios.
  - **Copilot**: Natural-language **3D Scene Command Box** + **Diagnostic Assistant** grounded in the Valmet Excel Builder Pack.
  - **Settings**: Switch between **Area 01 — Equipment Room** and **Area 02 — Boiler House**, toggle rendering modes (`3DGS Scan (.spz)`, `Hybrid 3DGS+CAD`, `Clean CAD`), toggle automatic ceiling cutaway, or launch the **1st-Person Technician AR Visor & Drive Pad**.

### 2. Consumer Mode (Matterport-Style Experience)
- **Clean Photorealistic Exploration**: Hides all autonomous workers, path tubes, and engineering clutter so stakeholders can tour the facility cleanly.
- **First-Person Walk (`V`) & Third-Person Orbit (`V`)**:
  - **Walk Mode**: Eye-level (`Y = -0.12 m`) WASD / Arrow walking with mouse-drag look and ESDF + 3D OBB obstacle collision prevention.
  - **Orbit Mode**: Smooth 360° room rotation, zoom, and top-down **Facility Overview** with automatic ceiling cutaway.

---

## Holographic AR Part HUD (`HolographicArAssetMenu.jsx`) & 31-Part 3D Pump Cutaway (`PumpGlbInspector.jsx`)

Clicking any 3D equipment bounding box (or floating tag pill) opens the **Holographic AR Field Service Asset HUD**:
- **Interactive 31-Part Centrifugal Pump 3D GLB Cutaway (`P-002 / ASSET-014` & `P-001`..`P-006`)**:
  - **AI Model & Part Resolution (`modelCatalog.js`)**: Ask the Diagnostic Assistant *"Find the pump on the boiler feedwater line and show me the seal."* (or click **`🔬 Pump Seal Cutaway (P-002)`** in the top bar). SpatialSense resolves `P-002` (`ASSET-014`, labeled **Generic centrifugal pump — Boiler Feedwater Line**) to catalog entry `MODEL-CENTRIFUGAL-PUMP-ENGX` (`/assets/models/pump.glb`, 2.1 MB, 31 named parts) and `part_id: "mechanical_seal"`.
  - **Slide Casing Forward & Explode Slider (`0%–100%`)**: Slide the volute casing, suction/discharge flanges, wear ring, and joint bolts forward along `+X` while keeping the rotating pump shaft, 6-bladed impeller, inboard/outboard bearings, and mechanical seal in their installed positions. Use the **Explode** slider to spread all 31 parts outward, or click any of the 31 parts in 3D to move it individually along `X / Y / Z`.
  - **Illustrative Fault Scenario — `Mechanical seal leak`**: Pulses the `Mechanical seal (rotating ring)`, `Mechanical seal seat`, and `Seal gland` in alarm red (`#ef4444`) and animates leaking water droplets where the shaft exits the housing.
  - **3D Model Attribution**: *Centrifugal Pump (31 parts)* by **Engine-X by Parth Parmar ([engx3d.com](https://engx3d.com/3d-models/centrifugal-pump))**, licensed under **CC BY-NC 4.0**.
- **Photorealistic Cutout & 3D Wireframe Scanner**: Displays high-contrast equipment cutouts (`/assets/parts/*.png` for Control Valves, Process Pumps, Electric Motors, Pressure Transmitters, Vibration Sensors, Forklifts, IBC Totes, and Control Cabinets) with animated fault-hotspot callouts and interactive 360° rotation/zoom.
- **Exact Excel Workbook Binding**: Displays the asset's exact rows from `Asset_Master`, `Scene_Anchors`, `Current_State`, `Telemetry`, `Alarms_Events`, `Maintenance_History`, `Knowledge_Docs`, and `Data_Quality`.
- **Interactive Telemetry Simulator & Splat Mover**: Mutate live telemetry sliders (or inject/restore faults) to test real-time health recalculation, or shift the object's 3D Gaussian Splats in 0.6 m steps directly from the HUD.

---

## Python Pipeline & FastAPI Backend (`pipeline/` & `backend/`)

### Data & 3D Processing Pipeline (`pipeline/`)
| Stage | Description | Output |
|---|---|---|
| `clean` | Memmaps the 3DGS PLY, filters floaters (`sigmoid(opacity) > 0.1`, `max_scale < 0.3`), transforms to world frame | `data/derived/splats_clean.npz`, `public/assets/equipment_room_splats.bin` |
| `orient` | Extracts floor/ceiling planes via height histogram + RANSAC | `data/derived/transform.json` |
| `segment` | Removes floor/ceiling/walls → 4 cm voxel grid → connected components → watershed split → 3D OBBs | `public/assets/objects.json` |
| `rails` | Computes per-height-band occupancy, ESDF clearance, and medial-axis walkable rails | `public/assets/rails.json` |
| `map` & `navigate` | Binds the 30 Valmet Excel assets to 3D OBBs and computes collision-checked routes & timelines | `public/assets/registry.json`, `path.json`, `timeline.json` |

### FastAPI Endpoints (`backend/app.py`)
- **Asset & Telemetry API**: `GET /api/assets`, `GET /api/assets/{id}`, `GET/POST /api/assets/{id}/telemetry`, `GET /api/assets/{id}/events`, `GET /api/assets/{id}/documents`, `GET /api/scene/anchors`.
- **Grounded AI Copilot (`backend/ai/`)**: `POST /api/copilot/query` & `POST /api/work-orders/draft`. Builds a deterministic evidence pack from the Excel store, validates all cited IDs (`EVT-*`, `WO-*`, `CASE-*`, `DQ-*`, `DOC-*`), and supports optional Gemini LLM integration via `.env` (`LLM_MODEL` + `GEMINI_API_KEY`) with automatic offline fallback.
- **Scene Edit & Replanning (`backend/scene_edit/`)**: `GET/POST/DELETE /api/scene/edits`, `POST /api/scene/edits/preview`, `POST /api/scene/command` (natural-language object movement & removal with live rail/route replanning).
- **Visual Inspection (`backend/vision/`)**: `GET /api/vision/frames`, `POST /api/vision/inspect`, `GET /api/vision/crosscheck/{asset_id}`.

---

## Project Structure

```text
├── backend/                  # FastAPI server (AI copilot, scene editing, vision inspection)
│   ├── ai/                   # Pydantic AI agent + deterministic evidence-pack fallback
│   ├── scene_edit/           # 3D object move/remove engine & medial-axis rail replanner
│   ├── vision/               # Multi-frame visual inspection & Excel state cross-checker
│   └── app.py                # Main FastAPI application (:8000)
├── pipeline/                 # Offline 3DGS PLY segmentation, RANSAC orientation & Excel ingestion
├── data/                     # Raw builder_pack.xlsx & derived splats_clean.npz / transform.json
├── public/assets/            # Pre-extracted .spz/.bin splats, CV OBBs, evidence crops & part PNGs
├── src/
│   ├── components/
│   │   ├── BoilerRoomViewport.jsx       # Spark 3DGS + Three.js viewport, Walk/Orbit & Worker sim
│   │   ├── HolographicArAssetMenu.jsx   # Holographic AR Part HUD with cutouts & live telemetry
│   │   ├── AssetInspectorPanel.jsx      # Deep 4-tab technical inspector drawer
│   │   ├── EdgeCopilotAndArHud.jsx      # Diagnostic Assistant, Scene Command Box & Mobile AR LOTO Modal
│   │   ├── CvReviewPanel.jsx            # 441 CV OBB browser & classification editor
│   │   ├── SceneInspectorPanel.jsx      # Visual AI camera frame inspector
│   │   ├── SceneEditPanel.jsx           # Interactive 3D splat object mover & route replanner
│   │   └── FloorMinimap.jsx             # 2D ESDF occupancy & live worker radar minimap
│   ├── data/                 # Valmet 30-asset dataset, Excel catalog & mission stages
│   ├── sceneEdit/            # Real-time Spark SplatEdit SDF volume mover hooks
│   ├── utils/                # A* pathfinding, CV engine, autonomous worker exercise engine
│   └── App.jsx               # Dual-mode application shell (Technical Console & Consumer Mode)
├── run_full.bat              # One-click Windows launcher (Backend + Frontend)
└── standalone.html           # Zero-build browser loader for iPad / lightweight environments
```
