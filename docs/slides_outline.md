# Slides Outline

## 1. Challenge And Data Reality

- Goal: turn an unlabelled industrial splat plus Excel records into an asset-aware 3D maintenance demo.
- PLY issue: only the first 502,482 splats are usable in our download.
- Excel scene anchors are placeholders, so asset mapping is procedural.

## 2. Object Extraction

- CPU-only pipeline: clean splats, fit floor/ceiling/walls, remove structure, DBSCAN remaining splat centres.
- Output: 71 framed objects, including structure and equipment candidates.
- Human review layer stores labels in `labels_override.json`.

## 3. Navigation

- Occupancy grid built from the same splat centres.
- Walkable cells require floor support.
- Obstacles are inflated for robot clearance.
- Demo path targets `ASSET-014` / `P-002`.

## 4. Excel Mapping And Backend

- Workbook imported to SQLite one sheet at a time.
- FastAPI serves assets, scene objects, navigation, and copilot routes.
- All 30 Excel assets are bound to scene objects with explicit procedural confidence.

## 5. Grounded Copilot

- Evidence bundle is computed in code from telemetry, current state, events, cases, data quality, and knowledge docs.
- Response includes observations, hypotheses, next checks, caveats, confidence, and evidence IDs.
- Citation validator rejects unknown evidence IDs.

## 6. Demo Flow

- Select P-002.
- Robot follows the generated path.
- Nearby assets show Excel-backed status.
- Arrival diagnosis explains cavitation risk with citations.

## 7. Limitations And Scaling

- Valid slice only unless organisers provide an intact PLY.
- Procedural mapping because workbook coordinates are placeholders.
- Next steps: zone streaming, stable IDs across reruns, live OPC UA/MQTT adapters, and image/pose-based semantic lifting when source data is available.
