# Equipment identity and highlighting

This phase stops forced tag assignment and records one review row per `Asset_Master` record. A highlight is a saved region box. These checks show that the software keeps one asset id, one review row, and one region together. They do not show which physical machine a tag is.

## What was not used as a tag

No nameplate, QR, or photo reads a tag. Excel `Scene_Anchors` stay `placeholder_until_valmet_scene_received` and are not the `ply_raw` frame. Class, size, colour, reach, and area adjacency do not assign a tag. `mapping_confidence` is no longer written. The 0.45 and 0.3 figures were caps, not probabilities. Diagnosis caps in `backend/app/confidence.py` are unchanged.

No row is `verified_identity`. No live row is `reviewed_correspondence`: the video pin has no named reviewer. A later review-mode bind can reach `reviewed_correspondence` only when a named reviewer saves it, and that status is still not verified identity.

## Status table

Scene revision `105192389b3bcdfa`. Source `Equipment Room.ply`, pipeline `tab2-segmentation-1`, frame `ply_raw`. Thirty rows, reviewer empty on every row.

| Tag | Asset | Status | Location | Region |
|---|---|---|---|---|
| P-002 | ASSET-014 | procedural_assignment | approximate_location_marker | OBJ-0185 |
| PT-001 | ASSET-025 | procedural_assignment | approximate_location_marker | OBJ-0172 |
| PT-002 | ASSET-026 | procedural_assignment | parent_assembly | OBJ-0211 |
| PT-003 | ASSET-027 | procedural_assignment | parent_assembly | OBJ-0566 |
| VS-001 | ASSET-028 | procedural_assignment | parent_assembly | OBJ-0185 |
| VS-002 | ASSET-029 | procedural_assignment | parent_assembly | OBJ-0185 |
| VS-003 | ASSET-030 | procedural_assignment | parent_assembly | OBJ-0185 |
| CV-001, CV-002, CV-003 | ASSET-001, ASSET-002, ASSET-003 | class_only_candidate | unknown | none |
| M-001 | ASSET-019 | class_only_candidate | unknown | none |
| P-001 | ASSET-013 | class_only_candidate | unknown | none |
| M-006, P-005, and 16 other tags | including ASSET-024 and ASSET-017 | unmapped | unknown | none |

Counts: 7 procedural assignments, 5 class-only candidates, 18 unmapped. Location kinds: 2 approximate markers, 5 parent assemblies, 23 unknown. `exact_component` is unused. `conflicting_evidence` is reserved for a pin whose object id is missing or whose stored box fingerprint no longer matches. None of the current rows are in that state.

OBJ-0185 stays the only explicit pin (`video_evidence`, fingerprint center `[-1.252, 0.388, 1.259]`, extent `[0.277, 0.52, 0.086]`). It was not moved onto OBJ-0303. The six hosted sensors stay simulated parent links and do not take `asset_id`. PT-001 on the pipe OBJ-0172 is an approximate marker, not a sensor body. CV-001, CV-002, CV-003, M-001, and P-001 lost the asset id the ranker had written. Their reviewed classes remain candidates. Ranking does not pick a winner.

## Lineage

No splat index was added. `Segment.members` are voxel-cloud indices. Voxel aggregation drops the source PLY rows, so those indices are not rows of `Equipment Room.ply` (1,676,481 points). `equipment_room.spz` is a crop and opacity filter (1,504,114 points) and is not in PLY row order. Objects store `splat_count` only. The highlight is the oriented box. The label says the splats inside it are not isolated.

A pin is reused in `assign_stable_ids` only when the IoU match is the same previous object at or above the existing 0.2 floor and the fingerprint still agrees. A weak overlap gets a new id, and the pin then fails the missing-object check instead of moving onto that cluster. The room was not resegmented.

## Highlight

Selection is asset id, then the review row's saved region ids, then the box. Candidates, unmapped rows, and conflicting rows do not set `scene_object_id`. The box hue stays the primary asset's condition colour. Selection is a separate accent edge (`#4cc2ff`) on the saved region only. An in-range neighbour does not take the selection fill and is not exempt from dimming. A box click resolves the object's own asset id. Clicking OBJ-0185 returns ASSET-014, not a hosted sensor. Choosing VS-003 keeps ASSET-030, highlights OBJ-0185, and the label says parent assembly, not the sensor body. The label does not print a mapping percent.

## Checks actually run

- `python3 -m pipeline.mapping` — selftest passed: a reviewed class does not receive a tag; the explicit pin survives a second bind; a pin whose object moved or disappeared is not applied to another object; an unmapped id never gains a region; a hosted row keeps `parent_assembly` and does not take `asset_id`.
- `python3 -m pytest -q` in `backend/` — 115 passed. Includes stale fingerprint, ASSET-024 and ASSET-017 with `scene: null`, parent labelling for ASSET-030, and the evidence text for ASSET-014 (status and location kind, no "mapping confidence").
- `node scripts/check-mapping.mjs` — 19 passed, including select A / drop A on B, box click to the workbook id, same id for details and evidence, and the parent-assembly label.
- `node scripts/check-mission.mjs` — passed. Proximity now reports only P-002 at 17.6 s, because only an object that owns `asset_id` is a proximity target. CV-001 and CV-003 are class candidates and were not put back.
- `node scripts/sync-public.mjs`, then `node scripts/snapshot-api.mjs` against the live API on port 8000. Live `GET /api/assets` and `web/public/data/api/assets.json` match on `scene_object_id`, `mapping_status`, `location_kind`, `scene_revision`, and `tag` (0 mismatches, revision `105192389b3bcdfa`).
- Browser on http://localhost:5173/. Selecting P-002 shows the condition-coloured box, the approximate-marker sentence, and inspector ASSET-014. Selecting M-006 clears that card, shows ASSET-024 as unmapped with candidate OBJ-0222 and no region, and leaves the P-002 box in its condition colour. Cyan accent pixels in the scene view dropped from about 5,500 to about 1,600; the red condition pixels stayed. Selecting VS-003 shows ASSET-030, region OBJ-0185, and "Parent assembly, not the sensor body". Clicking that box on the canvas returned ASSET-014.

## Linkage versus identity

The same asset id is used for the review row, the highlight, the inspector, and the evidence card. That is a software link. It is not a measurement of which machine the tag belongs to. P-002 on OBJ-0185 is a reachable pipe fragment beside the circulator. The tag is not printed on the machine.
