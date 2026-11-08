import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeOverrides } from "../src/review/overrides.js";
import {
  linkageFor,
  regionLabel,
  workbookAssetForObject,
} from "../src/scene/selection.js";

// Software linkage only. These checks do not prove which physical machine a tag is.
const root = resolve(import.meta.dirname, "../..");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const scene = read("data/derived/scene_objects.json");
const overrides = read("data/derived/labels_override.json");
const review = read("data/derived/equipment_review.json");
const objects = mergeOverrides(scene.objects, overrides);

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const pump = linkageFor("ASSET-014", objects);
const other = linkageFor("ASSET-024", objects);
const sensor = linkageFor("ASSET-030", objects);
const valve = linkageFor("ASSET-001", objects);
check("selecting A highlights A's region", pump.regionIds.join(",") === "OBJ-0185", pump.regionIds.join(","));
check("selecting B drops A's region", other.regionIds.length === 0 && !other.regionIds.includes("OBJ-0185"));
check("box click resolves to A's workbook id", workbookAssetForObject(objects.find((object) => object.object_id === "OBJ-0185")) === "ASSET-014");
check("details and evidence use A's id", pump.detailAssetId === "ASSET-014" && pump.evidenceAssetId === "ASSET-014");
check("details and evidence use the sensor id", sensor.detailAssetId === "ASSET-030" && sensor.evidenceAssetId === "ASSET-030");
check(
  "parent mapping is labelled as a parent",
  regionLabel(objects.find((object) => object.object_id === "OBJ-0185"), "ASSET-030") === "Parent assembly, not the sensor body",
);
check("class candidate has no region", valve.regionIds.length === 0);
check("unmapped motor has no region", other.regionIds.length === 0);

const rows = Object.fromEntries(review.rows.map((row) => [row.asset_id, row]));
check("review revision matches the pin", rows["ASSET-014"].scene_revision === review.scene_revision);
check("review revision matches the override", overrides.overrides["OBJ-0185"].scene_revision === review.scene_revision);
check("P-002 review region is OBJ-0185", rows["ASSET-014"].region_object_ids.join(",") === "OBJ-0185");
check("M-006 review has no region", rows["ASSET-024"].mapping_status === "unmapped" && rows["ASSET-024"].region_object_ids.length === 0);
check("P-005 review has no region", rows["ASSET-017"].mapping_status === "unmapped" && rows["ASSET-017"].region_object_ids.length === 0);
check("CV-001 is class only", rows["ASSET-001"].mapping_status === "class_only_candidate" && rows["ASSET-001"].region_object_ids.length === 0);
check("VS-003 review is a parent assembly", rows["ASSET-030"].location_kind === "parent_assembly" && rows["ASSET-030"].region_object_ids.join(",") === "OBJ-0185");
check("no row is verified identity", review.rows.every((row) => row.mapping_status !== "verified_identity"));
check("no calibrated mapping probability", review.rows.every((row) => row.mapping_confidence == null));

const moved = structuredClone(scene.objects.find((object) => object.object_id === "OBJ-0185"));
moved.obb.center = [moved.obb.center[0] + 3, moved.obb.center[1], moved.obb.center[2]];
const stale = mergeOverrides([moved], overrides)[0];
check("a moved pin is not applied", stale.asset_id == null && stale.mapping_status === "conflicting_evidence");
check("a moved pin does not highlight A", linkageFor("ASSET-014", [stale]).regionIds.length === 0);

console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
process.exit(failures ? 1 : 0);
