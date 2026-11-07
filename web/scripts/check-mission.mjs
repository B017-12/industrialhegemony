import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  activeAt,
  lerpAngle,
  missionDuration,
  navForTarget,
  sampleAt,
  simulateMission,
  stateAt,
  driveEnd,
} from "../src/scene/mission.js";

// Reproduces Tab 3's simulated proximity order on the default mission
// (docs/kt/03-navigation.md, section 8) and checks the sampling maths.
const root = resolve(import.meta.dirname, "../..");
const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const nav = read("data/derived/nav.json");
const scene = read("data/derived/scene_objects.json");
const targets = read("data/derived/nav_targets.json");
const mpu = scene.metres_per_unit;
const bound = scene.objects.filter((o) => o.asset_id);
const tagOf = (id) => scene.objects.find((o) => o.object_id === id)?.display_label?.split(" ")[0] ?? id;

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const samples = nav.samples;
const duration = missionDuration(samples);
check("duration matches stats", Math.abs(duration - nav.stats.duration_s) < 0.01, `${duration} s`);

const first = sampleAt(samples, -1);
const last = sampleAt(samples, duration + 5);
check("clamps before start", first.pos.every((v, i) => v === samples[0].pos[i]));
check("ends at approach pose", last.pos.every((v, i) => Math.abs(v - nav.approach.position[i]) < 1e-6));

const mid = samples[10];
const next = samples[11];
const half = sampleAt(samples, (mid.t + next.t) / 2);
check(
  "linear interpolation at a midpoint",
  half.pos.every((v, i) => Math.abs(v - (mid.pos[i] + next.pos[i]) / 2) < 1e-9),
);
check("yaw takes the short arc across +-pi", Math.abs(lerpAngle(3.0, -3.0, 0.5) - Math.PI) < 1e-9);

// Arc length from integrating interpolated positions equals the exported s.
let length = 0;
let prev = sampleAt(samples, 0).pos.slice();
for (let t = 0.01; t <= duration; t += 0.01) {
  const p = sampleAt(samples, t).pos;
  length += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
  prev = p.slice();
}
check("path length matches", Math.abs(length * mpu - nav.stats.path_length_m) < 0.02, `${(length * mpu).toFixed(3)} m`);

const approachStart = driveEnd(samples) - 1.5;
check("state en_route at 1 s", stateAt(1, duration, approachStart) === "en_route");
check("state approaching near the end", stateAt(duration - 0.5, duration, approachStart) === "approaching");
check("state arrived at the end", stateAt(duration, duration, approachStart) === "arrived");

const events = simulateMission(samples, bound, mpu);
const enters = events.filter((e) => e.type === "enter");
console.log("\nProximity timeline (enter 1.6 m, exit 2.0 m, 10 Hz):");
for (const e of events) console.log(`  ${e.t.toFixed(1).padStart(4)} s  ${e.type.padEnd(7)} ${tagOf(e.objectId).padEnd(8)} ${e.distanceM.toFixed(2)} m`);

// Default mission on the full-room Equipment Room.ply scene (docs/kt/10-equipment-room-ply.md).
// The front entry sits beside P-006 and CV-007, so both are in range from the start.
const expected = [
  ["P-006", 0],
  ["CV-007", 0],
  ["CV-002", 0.8],
  ["P-005", 3.3],
  ["VS-003", 14.6],
  ["CV-009", 15.6],
  ["M-004", 16.3],
  ["P-002", 17.6],
  ["VS-002", 19.3],
  ["P-003", 21.5],
  ["CV-006", 21.7],
];
const got = enters.map((e) => [tagOf(e.objectId), e.t]);
check(
  "default mission proximity order reproduced",
  expected.length === got.length && expected.every(([tag, t], i) => got[i][0] === tag && Math.abs(got[i][1] - t) < 0.051),
  got.map(([tag, t]) => `${tag}@${t}`).join(", "),
);
const atArrival = activeAt(events, duration).map(tagOf).sort();
check("P-002, M-004 and VS-002 in range at arrival", ["P-002", "M-004", "VS-002"].every((tag) => atArrival.includes(tag)), atArrival.join(", "));
check("only P-006 and CV-007 in range at start", activeAt(events, 0).map(tagOf).sort().join() === "CV-007,P-006");

const reachable = targets.targets.filter((t) => t.reachable);
let swapped = 0;
for (const t of reachable) {
  const n = navForTarget(nav, targets, t.asset_id);
  if (n && n.samples.length && n.target_object_id === t.object_id) swapped += 1;
}
check("every reachable target yields a mission", swapped === reachable.length, `${swapped}/${reachable.length}`);
check("unreachable target yields null", navForTarget(nav, targets, targets.targets.find((t) => !t.reachable).asset_id) === null);

console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
process.exit(failures ? 1 : 0);
