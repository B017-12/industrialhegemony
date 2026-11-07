# Five-Minute Demo Script

## 0:00-0:30: Problem

Show the boiler-room splat. Say: the scene is photorealistic but semantically blind. It has no object IDs, classes, or asset links, and the supplied Excel coordinates are placeholders.

Mention the data issue clearly: only the first 502,482 splats are usable in our download, so the prototype runs on the verified valid slice.

## 0:30-1:30: Extraction

Show the generated overlays:

- floor, ceiling, and wall planes from RANSAC;
- DBSCAN clusters framed as boxes;
- reviewed labels from `labels_override.json`;
- count on screen: 71 framed objects, 40 reviewed labels, 30 Excel assets bound procedurally.

Say: we did not train a model. Geometry proposes object instances, and the review layer makes labels honest and editable.

## 1:30-3:15: Dispatch And Navigation

Select the `P-002` target mapped to `ASSET-014`.

Start or resume the robot path. Point out:

- the route is generated from an occupancy grid on supported floor;
- obstacles are inflated for robot clearance;
- nearby assets highlight as the robot passes;
- status cards come from the Excel-backed API.

## 3:15-4:20: Arrival Diagnosis

Click `Arrival Diagnosis`.

Narrate the answer:

- vibration rose from 2.42 to 4.57 mm/s;
- healthy pump vibration averages about 2.08 mm/s;
- flow and pressure fell over the same period;
- events and historical cases support cavitation risk;
- `DQ-0098` and procedural mapping reduce confidence;
- follow site procedures before touching equipment.

Emphasize evidence IDs shown in the UI and the deterministic fallback if no LLM is available.

## 4:20-5:00: Architecture And Scale-Up

Show one architecture slide:

- offline Python pipeline;
- FastAPI + SQLite data service;
- React + three.js viewer;
- grounded copilot with citation validation.

Close with scale-up: replace Excel with live data adapters, process larger sites by zone, keep stable object IDs across reruns, and add image/pose-based segmentation if organisers provide training images.
