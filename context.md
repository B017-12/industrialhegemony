# Valmet DNA SpatialSense — Design & Engineering Context (`ibrahim` Branch)

## 1. Overview of Recent Design & 2D/3D Optimization Changes

This document records the architecture, UI/UX design changes, and iPad (`iSH` + Safari) performance optimizations implemented on the `ibrahim` branch.

---

## 2. 2D Static-Image Holographic AR Field Service HUD (`src/components/HolographicArAssetMenu.jsx`)

### Goal
When a user taps or clicks any 3D part/asset in the facility scan, display the futuristic **AR Field Service HUD** matching the reference industrial AR designs while keeping rendering lightweight and instant on iPad Safari.

### Why We Switched to a Pre-Rendered 2D Static Image Architecture
1. **Static Offscreen Canvas Baking (`generateStaticCadCutawayDataUrl` & `generateStaticWaveDataUrl`)**:
   - Instead of running a second WebGL canvas or heavy multi-layer animated SVG DOM trees inside the popup, the **3D CAD Internal Cutaway & Thermal Wear Heatmap** and **30-minute Sensor Sparklines** are drawn **once** onto an offscreen 2D `<canvas>` and exported as static `<img src="data:image/png;..." />` data URLs.
   - Background imagery uses the static high-resolution inspection frame (`evidencePhoto` or `/assets/vision/frames/FRM-005.jpg`) with a dark HUD gradient overlay.
2. **Removed Per-Frame React Re-Renders**:
   - Previously, `BoilerRoomViewport.jsx` called `setClickedScreenAnchor(...)` inside the 60 FPS `requestAnimationFrame` loop, forcing React to re-render the entire viewport and popover every frame.
   - We removed `setClickedScreenAnchor` from the animation loop and wrapped `HolographicArAssetMenu` in `React.memo`, dropping idle HUD CPU/GPU cost to near zero.
3. **Removed GPU `backdrop-filter: blur()`**:
   - Blurring a live 1.6M-splat WebGL framebuffer on every frame caused severe frame drops on iPad Safari. Replacing it with high-contrast opaque/semi-opaque industrial HUD panels (`#05111b` / `rgba(6, 22, 36, 0.92)`) keeps frame rates smooth.

### 5 Interactive AR Field Service Views
1. **`1. Topology & Causality` (Process Engineer View)**:
   - 4-node horizontal causality chain (`P-002 Suction Strainer ΔP: 0.12 bar` → `P-005 Process Pump Health: 44%` → `CV-005 Downstream Valve ΔP: 0.31 bar` → `PT-002 Pressure Transmitter P: 2.18 bar`) with static sparkline previews.
   - High-contrast left alert callout (`ATTENTION REQUIRED`, `Health Score: 44/100`, `ISSUE: FOULING / CAVITATION`, `RECOMMENDED ACTION: Inspect hydraulic path & clear suction strainer`) paired with the static 2D holographic CAD cutaway image.
2. **`2. Multi-Panel HUD` (Deep Diagnostic / Power User View)**:
   - **Left Panel**: `LIVE SENSOR DATA (30 min)` with static waveform images for `Vibration (mm/s)`, `Suction Index`, and `Flow Rate (m³/h)`.
   - **Center Panel**: `TAG` / `Health: 44/100` / `▲ HIGH URGENCY` header above the static holographic CAD image.
   - **Right Panel**: Interactive `LOCKOUT-TAGOUT` checklist (`Isolate inlet valve`, `Depressurize system`, `Verify zero energy`, `Apply lock & tag`) and `SOP Reference: DOC-PROCESS_PUMP-CORE`.
3. **`3. Quick-Inspection Badge` (Walkthrough / Quick Check View)**:
   - Minimalist holographic target ring (`TARGET`) + compact `HEALTH %` and `REMAINING USEFUL LIFE (hrs)` badge.
4. **`4. 3D CAD & Wear Heatmap` (Mechanical Repair View)**:
   - Static 2D X-Ray cutaway & thermal wear heatmap image with leader-line callouts for `Impeller Erosion (12.4 mm)` and `Suction Strainer Pressure Drop (9.95 m)`, `Wear Level (High / Med / Low)` legend, an `Explode CAD (0–100%)` slider that re-bakes the static image on release, and hydraulic pressure drop cards.
5. **`5. Shift Manager Analytics` (Executive View)**:
   - `Performance Trend (90d vs Now)`, `Downtime Risk (€ 320 /hr ↗)`, `Next Maintenance Window (18 days)`, `Fleet Status (Utility Island)` health bars (`P-001` through `P-008`), and an action banner with `View Details →`.

### 4 Switchable HUD Color Themes
- **Cyber Cyan** (`#00f2ff`)
- **Emerald Mint** (`#10b981`)
- **Industrial Amber** (`#f59e0b`)
- **Violet Spectrum** (`#c084fc`)

### Bug Fix for Part Click Crash
- Fixed a `ReferenceError` in `src/components/BoilerRoomViewport.jsx` where `<HolographicArAssetMenu>` referenced undefined `onUpdateTelemetry` and `onExecuteMaintenanceAction` identifiers instead of `BoilerRoomViewport`'s actual props (`onQuickMutateTelemetry` and `onAssignWorkerToFault`).

---

## 3. Separable & Movable 3D Objects (`src/components/BoilerRoomViewport.jsx`, `src/App.jsx`, `src/utils/cvEngine.js`)

- Added **`✥ Move Objects`** in the top-right 3D viewport toolbar and 1-click directional nudge buttons (`◀ Left`, `▲ Fwd`, `▼ Back`, `Right ▶`, `↺ Reset`) in both the Holographic Asset HUD and unbound CV object popovers.
- Uses `@sparkjsdev/spark` `SplatEdit` + `SplatEditSdf` (`SplatEditSdfType.BOX`) with world-space `displace: new THREE.Vector3(dx, 0, dz)` to shift an object's 3D Gaussian Splats in the vertex shader without duplicating `SplatMesh` memory.
- Updates `cvSceneObjects` and `syncAssetsWithCvObjects` so A* floor pathfinding and worker collision avoidance route around moved objects automatically.

---

## 4. 1st-Person / 3rd-Person AR Manual Driving & Overhead Roof Asset Pathfinding

- **Manual Technician Driving (`WASD` + Touch D-Pad)**:
  - The `Drive Technician` HUD (`1st-Person Eye` / `3rd-Person Chase` toggle, worker selector, and forward obstacle anti-collision radar) is shown **only** when `1st-Person AR` mode is active.
- **Overhead / Roof Asset Pathfinding (`CV-001`)**:
  - Overhead valves like `CV-001` (`y = 1.65 m` on the roof piping rack) project their technician walk target (`approach_point`) directly onto the walkable floor beneath the valve (`[-2.18, -1.02, -1.68]`), with a vertical cyan laser plumb-line connecting the floor service point to the overhead valve.

---

## 5. iPad (`iSH`) Standalone Server & Module Loader (`standalone.html`, `instant_server.mjs`)

- Ordered all modules in `standalone.html` in strict dependency order (`pathfinding.js` before `cvEngine.js`, `sceneApi.js` and `sceneEdit/*` before panels, and `HolographicArAssetMenu.jsx` before `BoilerRoomViewport.jsx`).
- Updated the relative-import resolver regex in `standalone.html` (`(['"])(\\.\\.?\\/(?:[\\w\\/.-]*\\/)?${baseName})(\\.(jsx|js))?\\1`) so parent-directory imports like `../sceneApi.js` resolve cleanly to in-memory Blob URLs.
- Vendored `public/assets/vendor/TransformControls.js` locally so Three.js controls work without external CDN module mismatches.

### Running on iPad (`iSH`)
```sh
git pull origin ibrahim
node instant_server.mjs
```
(Or `node instant_server.js` — both work identically.)
Then open `http://localhost:5173` in Safari.

---

## 6. Excel Workbook Data Integration & Part-Matched Transparent UI (`src/data/excelPartCatalog.js`)

### Full Extraction from *Valmet x Since AI 2026 - Synthetic Industrial Metaverse Builder Data Pack.xlsx*
- Parsed all sheets from the official Excel workbook (`Asset_Master`, `Scene_Anchors`, `Current_State`, `Telemetry`, `Alarms_Events`, `Maintenance_History`, `Knowledge_Docs`, `RAG_Corpus_Index`, and `Data_Quality`) into `src/data/excelPartCatalog.js` (`EXCEL_ASSET_RECORDS`).
- Every asset (`ASSET-001` through `ASSET-030`) is enriched in `src/utils/dataPipeline.js` with its exact Excel item name, class, area, criticality, install/service dates, connectivity profile (`OPC_UA`, `HART`, `FOUNDATION_FIELDBUS`, `MQTT_EDGE`, `SIMULATED_API`), QR/NFC IDs, scene anchor paths, current state (`health_score`, `issue_code`, `issue_summary`, `recommended_action`), live telemetry columns, alarm events, maintenance work orders, RAG corpus documents, and data quality flags:
  - **`CV-001`..`CV-012` (`ASSET-001`..`ASSET-012`)**: `CONTROL_VALVE` (e.g., `CV-001 · Control Valve (Utility Island)`)
  - **`P-001`..`P-006` (`ASSET-013`..`ASSET-018`)**: `PROCESS_PUMP` (e.g., `P-005 · Process Pump (Utility Island)`)
  - **`M-001`..`M-006` (`ASSET-019`..`ASSET-024`)**: `ELECTRIC_MOTOR` (e.g., `M-006 · Electric Motor (Stock Preparation)`)
  - **`PT-001`..`PT-003` (`ASSET-025`..`ASSET-027`)**: `PRESSURE_TRANSMITTER` (e.g., `PT-002 · Pressure Transmitter (Utility Island)`)
  - **`VS-001`..`VS-003` (`ASSET-028`..`ASSET-030`)**: `VIBRATION_SENSOR` (e.g., `VS-002 · Vibration Sensor (Chemical Preparation)`)

### Part-Matched Transparent Images (`public/assets/parts/*.png` + Online Wikimedia Transparent PNGs)
- Each equipment class in the PLY has both a local transparent-background hologram PNG in `public/assets/parts/` and an online Wikimedia Commons transparent part diagram URL (`🌐 Web Part Image` toggle inside the HUD):
  - `public/assets/parts/control_valve.png` (`CONTROL_VALVE`)
  - `public/assets/parts/process_pump.png` (`PROCESS_PUMP`)
  - `public/assets/parts/electric_motor.png` (`ELECTRIC_MOTOR`)
  - `public/assets/parts/pressure_transmitter.png` (`PRESSURE_TRANSMITTER`)
  - `public/assets/parts/vibration_sensor.png` (`VIBRATION_SENSOR`)
  - `public/assets/parts/forklift.png` (`FORKLIFT`)
  - `public/assets/parts/ibc_tote.png` (`IBC_TOTE`)
  - `public/assets/parts/cabinet.png` (`CABINET`)

### Part-Specific Holographic UI (`src/components/HolographicArAssetMenu.jsx`)
- Clicking **any** part in the PLY (bound Excel asset or unbound CV equipment) adapts the entire HUD to match that exact part:
  - **Header**: Displays the exact Excel item name, Excel class badge, industrial protocol, and criticality badge.
  - **Visual Display Switcher**: Switch between `🖼️ Transparent Part`, `🌐 Web Part Image`, and `🔬 X-Ray Cutaway`.
  - **Part-Matched Telemetry, Callouts & LOTO**: Sensor graphs, cutaway datum callouts, mechanical health cards, LOTO steps, and SOP reference automatically adapt to the clicked part class (`CONTROL_VALVE`, `PROCESS_PUMP`, `ELECTRIC_MOTOR`, `PRESSURE_TRANSMITTER`, `VIBRATION_SENSOR`, etc.).
  - **Tab 6 (`6. Excel Data Sheet`)**: Inspects the complete Excel workbook records (`Asset_Master`, `Scene_Anchors`, `Current_State`, `Alarms_Events`, `Maintenance_History`, `RAG_Corpus_Index`, `Data_Quality`) for the selected part.

