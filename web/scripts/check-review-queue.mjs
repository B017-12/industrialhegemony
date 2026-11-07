import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyOverrides, mergeOverrides } from "../src/review/overrides.js";
import { buildQueue, nearestNeighbours, queueStats, REVIEW_GOAL } from "../src/review/queue.js";

// Checks the Tab 8 review-queue order and the override merge on the real data
// (node scripts/check-review-queue.mjs). Prints the queue head and the progress.
const root = resolve(import.meta.dirname, "../..");
const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const scene = read("data/derived/scene_objects.json");
const nav = read("data/derived/nav.json");
const navTargets = read("data/derived/nav_targets.json");
const overridesFile = read("data/derived/labels_override.json");

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const reachable = new Set(navTargets.targets.filter((t) => t.reachable).map((t) => t.asset_id));
const args = (overrides) => ({
  objects: mergeOverrides(scene.objects, overrides),
  path: nav.path,
  mpu: scene.metres_per_unit,
  targetObjectId: nav.target_object_id,
  reachableAssets: reachable,
});

// Order on the pipeline output alone, as if nothing were reviewed yet.
const fresh = buildQueue(args({ overrides: {} }));
const bound = scene.objects.filter((o) => o.asset_id).length;
check("covers every object once", new Set(fresh.map((i) => i.objectId)).size === scene.objects.length, `${fresh.length}`);
check("mission target first", fresh[0].objectId === nav.target_object_id, fresh[0].objectId);
check("then the other bound objects", fresh.slice(1, bound).every((i) => i.group === "bound"), `${bound - 1} bound`);
const boundItems = fresh.filter((i) => i.group === "bound");
const firstUnreachable = boundItems.findIndex((i) => !reachable.has(i.object.asset_id));
check(
  "reachable bound objects before unreachable ones",
  firstUnreachable === -1 || boundItems.slice(firstUnreachable).every((i) => !reachable.has(i.object.asset_id)),
  `${boundItems.filter((i) => reachable.has(i.object.asset_id)).length} reachable`,
);
const route = fresh.filter((i) => i.group === "route");
check("route objects sorted by distance", route.every((i, k) => k === 0 || route[k - 1].routeDistanceM <= i.routeDistanceM), `${route.length} route`);
check(`bound + route reach the ${REVIEW_GOAL} goal`, bound + route.length >= REVIEW_GOAL, `${bound} + ${route.length}`);
const planes = scene.objects.filter((o) => o.source === "structure_plane").length;
check("structure planes come last", planes > 0 && fresh.slice(-planes).every((i) => i.object.source === "structure_plane"), `${planes} planes`);

// Reviewed objects move to the end and hidden ones leave the viewer.
const sample = {
  overrides: {
    [nav.target_object_id]: { label_source: "human", review_status: "relabelled", class: "valve", reviewer: "check", reviewed_at: "x" },
    [route[0].objectId]: { label_source: "human", review_status: "rejected", reviewer: "check", reviewed_at: "x" },
  },
};
const after = buildQueue(args(sample));
check("reviewed objects move to the end", after.slice(-2).every((i) => i.reviewed) && !after[0].reviewed);
const visible = applyOverrides(scene, sample);
check("rejected object hidden from the viewer", !visible.objects.some((o) => o.object_id === route[0].objectId) && visible.hiddenObjects.length === 1);
check("relabel merged over the object", visible.objects.find((o) => o.object_id === nav.target_object_id).class === "valve");

const target = scene.objects.find((o) => o.object_id === nav.target_object_id);
const neighbours = nearestNeighbours(target, scene.objects);
check("3 merge neighbours, nearest first", neighbours.length === 3 && neighbours[0].distance <= neighbours[2].distance,
  neighbours.map((n) => `${n.object.object_id} ${n.distance.toFixed(2)}`).join(", "));

// Progress on the current labels_override.json.
const current = buildQueue(args(overridesFile));
const stats = queueStats(current);
console.log(`\nReview progress: ${stats.reviewed} of ${REVIEW_GOAL} (queue ${stats.total})`);
for (const [group, s] of Object.entries(stats.byGroup)) console.log(`  ${group}: ${s.reviewed}/${s.total}`);
console.log("Next up:", current.filter((i) => !i.reviewed).slice(0, 8).map((i) => `${i.objectId} (${i.group})`).join(", ") || "none");

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll review-queue checks pass.");
