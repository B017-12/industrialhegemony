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
