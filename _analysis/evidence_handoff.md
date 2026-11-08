# Evidence mapping handoff

Read this file first. Do not re-segment, retrain, or import stash leftovers (`pipeline/semantic.py` is untracked and must stay unused by committed code).

## Tab 1 — overrides locked

All 17 entries in `data/derived/labels_override.json` exist in `data/derived/scene_objects.json`. Centres below are the current OBB centres. None were copied from stash. Extra vlm verdicts were left in place.

Required pins present: OBJ-0163, OBJ-0181, OBJ-0185, OBJ-0189, OBJ-0225, OBJ-0247, OBJ-0422, OBJ-0454, OBJ-0544, plus the other reviewed rows already in the file.

| id | scene class | override class | asset | center xyz |
|---|---|---|---|---|
| OBJ-0163 | other | crate | | -3.9224, 0.6915, 2.9745 |
| OBJ-0181 | other | pipe | | -3.2538, 0.0480, -0.4295 |
| OBJ-0185 | pump | pump | ASSET-014 | -1.2522, 0.3884, 1.2596 |
| OBJ-0189 | pump | motor | ASSET-022 | -0.9153, -0.1175, 1.2972 |
| OBJ-0197 | other | pipe | | 3.5178, -0.7402, -1.3508 |
| OBJ-0225 | pump | crate | | 3.4004, 1.0146, 2.6331 |
| OBJ-0243 | pump | other | | 1.0826, 1.0015, -2.4028 |
| OBJ-0247 | other | (class unset) | ASSET-029 | -1.8595, -0.0018, 1.2012 |
| OBJ-0268 | pump | trolley | | -1.7058, 0.0275, -1.3180 |
| OBJ-0317 | pump | tank | | -2.4152, 0.8673, 1.4173 |
| OBJ-0374 | pump | other | | 1.0004, 1.0740, -2.8997 |
| OBJ-0409 | valve | pipe | | -2.6518, -0.0163, -0.0528 |
| OBJ-0422 | valve | trolley | | 1.4500, 0.2127, -2.2508 |
| OBJ-0454 | valve | trolley | | 1.1166, 0.2283, -2.3306 |
| OBJ-0497 | valve | other | | 2.1879, 0.2984, 1.6033 |
| OBJ-0517 | valve | trolley | | -1.5295, 0.1693, -0.7866 |
| OBJ-0544 | motor | tank | | -2.6404, 0.9532, 2.7093 |

OBJ-0185 is a fragment beside the circulator body. Tab 3 must re-check it and name a better pump body if one is verified.

Heuristic pump/motor/valve objects: 56. Already overridden among them: OBJ-0185, OBJ-0189, OBJ-0225, OBJ-0243, OBJ-0268, OBJ-0317, OBJ-0374, OBJ-0409, OBJ-0422, OBJ-0454, OBJ-0497, OBJ-0517, OBJ-0544.

## Tab 2 — scored

`equipment_candidates.json` is written. Contact sheets are in `data/derived/diagnostics/evidence_sheets/` (70 objects). Thresholds left as implemented in `_analysis/equipment_evidence.py`.

## Tab 3 — verdicts

Reviewed from the sheets. Equipment that passed:

- pump: OBJ-0185 (reachable fragment beside the circulator; P-002 pin kept because OBJ-0303 is 1.57 m and OBJ-0548 is 2.46 m from the walkable floor), OBJ-0303, OBJ-0548
- motor: OBJ-0222
- valve: OBJ-0211, OBJ-0295, OBJ-0566
- gauge: none consistent enough to accept

OBJ-0189 is a ladder and pipe, not a motor. OBJ-0247 is the blue expansion tank, not a motor head. Both pins were cleared.

## Tab 4 and 5 — code

Strict binding is in `pipeline/mapping.py`. Hosted sensors are yielded by `scene_index.bindings()`, so `scene_object_id` still comes from `routes/assets.py` with no change to that route. Preview on fresh objects: 7 primary binds, 6 hosted (VS-001/002/003 on OBJ-0185, PT-001 on OBJ-0172, PT-002 on OBJ-0211, PT-003 on OBJ-0566), 17 not located.

## Next tab

Wait for `python3 -m pipeline.run`, then check_bindings, the bindings sheet, pytest, check-mission, and the KT note.
