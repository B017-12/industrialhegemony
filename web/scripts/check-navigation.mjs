// Point-to-point checks on the real nav_grid. Legs use assets that still have
// a scene region: P-002, then PT-003, then PT-001. Class candidates are not rebound.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyDispatch, diagnosisStillCurrent } from "../src/scene/dispatch.js";
import { clearanceM, decodeGrid, planRoute, snapLimitM } from "../src/scene/planner.js";

const root = resolve(import.meta.dirname, "../..");
const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const nav = read("data/derived/nav.json");
const targets = read("data/derived/nav_targets.json");
const scene = read("data/derived/scene_objects.json");
const assets = read("web/public/data/api/assets.json");
const grid = decodeGrid(read("data/derived/nav_grid.json"));

const P002 = "ASSET-014";
const PT003 = "ASSET-027";
const PT001 = "ASSET-025";
const VS003 = "ASSET-030";
const M006 = "ASSET-024";
const P001 = "ASSET-013";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const limit = snapLimitM(grid);
const dock = nav.start_pose.position;
const mpu = grid.mpu;
const horiz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]) * mpu;

function pose(pos, yaw = 0) {
  return { pos: [...pos], yaw, name: "current_position" };
}

function state(extra = {}) {
  return {
    navGrid: grid,
    baseNav: nav,
    nav,
    navTargets: targets,
    sceneObjects: scene,
    assets,
    running: true,
    mission: { state: "idle", t: 0, runId: 0, epoch: 0, targetAssetId: null, targetObjectId: null, feed: [] },
    ...extra,
  };
}

function cellWalkable(x, z) {
  const j = Math.floor((z - grid.z0) / grid.cell);
  const i = Math.floor((x - grid.x0) / grid.cell);
  return j >= 0 && i >= 0 && j < grid.h && i < grid.w && grid.walkable[j * grid.w + i] === 1;
}

function leg(from, assetId, prior) {
  const applied = applyDispatch(prior ?? state(), assetId, { start: pose(from) });
  return applied;
}

const first = leg(dock, P002);
check("dock to P-002 plans", first.ok && first.mission.targetAssetId === P002 && first.mission.state === "moving", first.mission.blockReason ?? "");
check("P-002 route starts at the dock", first.ok && horiz(first.nav.samples[0].pos, dock) <= limit, first.ok ? horiz(first.nav.samples[0].pos, dock).toFixed(3) : "");
check("P-002 is planned from the current pose", first.nav?.planned_from === "current_pose");

const arriveA = first.nav.samples[first.nav.samples.length - 1].pos;
const second = leg(arriveA, PT003, { ...state(), nav: first.nav, mission: { ...first.mission, state: "arrived" }, running: false });
check("P-002 arrival to PT-003 plans", second.ok && second.mission.targetAssetId === PT003, second.mission.blockReason ?? "");
check("PT-003 starts at the P-002 pose", second.ok && horiz(second.nav.samples[0].pos, arriveA) <= limit);
check("PT-003 does not start at the dock", second.ok && horiz(second.nav.samples[0].pos, dock) > 1);

const arriveB = second.ok ? second.nav.samples[second.nav.samples.length - 1].pos : arriveA;
const third = leg(arriveB, PT001, { ...state(), nav: second.nav, mission: { ...second.mission, state: "arrived" }, running: false });
check("PT-003 arrival to PT-001 plans", third.ok && third.mission.targetAssetId === PT001, third.mission.blockReason ?? "");
check("PT-001 starts at the PT-003 pose", third.ok && horiz(third.nav.samples[0].pos, arriveB) <= limit);
check("PT-001 does not start at the dock", third.ok && horiz(third.nav.samples[0].pos, dock) > 1);

function pathHolds(route, name) {
  if (!route?.samples?.length) {
    check(`${name} has samples`, false);
    return;
  }
  let walkable = true;
  let tight = false;
  let minC = Infinity;
  for (const sample of route.samples) {
    const [x, , z] = sample.pos;
    if (!cellWalkable(x, z)) walkable = false;
    const c = clearanceM(grid, x, z);
    minC = Math.min(minC, c);
    if (c + 1e-3 < (route.stats?.min_clearance_m ?? 0) - 0.02) tight = true;
  }
  check(`${name} samples stay on walkable cells`, walkable);
  check(`${name} samples keep the reported clearance`, !tight, `${minC.toFixed(3)} m`);
}
pathHolds(first.nav, "P-002");
pathHolds(second.nav, "PT-003");
pathHolds(third.nav, "PT-001");

const held = state({ nav: first.nav, mission: { ...first.mission, state: "arrived" }, running: false });
const miss = applyDispatch(held, M006, { start: pose(arriveA) });
const pump = applyDispatch(held, P001, { start: pose(arriveA) });
check("M-006 is unreachable and does not replace the route", !miss.ok && miss.mission.state === "unreachable" && miss.nav === held.nav);
check("unbound P-001 does not reuse its stale route", !pump.ok && pump.nav === held.nav && pump.mission.targetAssetId === P002);
const same = applyDispatch(held, P002, { start: pose(arriveA) });
check("already at P-002 keeps the route and the pose", !same.ok && same.mission.state === "arrived" && same.nav === held.nav);
const after = applyDispatch(held, PT003, { start: pose(arriveA) });
check("a reachable target still plans after an unreachable one", after.ok && after.mission.targetAssetId === PT003);

const again = applyDispatch(
  { ...state(), nav: first.nav, mission: { ...first.mission, state: "arrived", t: first.nav.samples.at(-1).t }, running: false },
  P002,
  { start: pose(dock) },
);
check("repeated dispatch from the dock still starts there", again.ok && horiz(again.nav.samples[0].pos, dock) <= limit);

const playing = { ...state(), nav: first.nav, mission: { ...first.mission, state: "moving" }, running: true };
const blocked = applyDispatch(playing, PT003, { start: pose(arriveA) });
check("playing motion rejects a new dispatch", !blocked.ok && blocked.mission.state === "moving" && blocked.mission.targetAssetId === P002 && blocked.nav === playing.nav);

const idle = state();
idle.selectedAssetId = PT003;
idle.mission.targetAssetId = P002;
const untouched = applyDispatch(idle, null);
check("selection does not dispatch by itself", !untouched.ok && untouched.mission.targetAssetId === P002 && untouched.mission.state === "idle");
const chosen = applyDispatch(idle, idle.selectedAssetId, { start: pose(dock) });
check("an explicit dispatch uses the selected asset", chosen.ok && chosen.mission.targetAssetId === PT003);

const late = { epoch: first.mission.epoch, assetId: P002 };
check("diagnosis matches the mission that requested it", diagnosisStillCurrent({ ...first.mission, state: "arrived" }, late));
check("a later dispatch ignores the previous diagnosis", second.ok && !diagnosisStillCurrent(second.mission, late));
check("the later mission keeps its own target", second.mission.targetAssetId === PT003 && second.mission.epoch !== first.mission.epoch);

const hosted = applyDispatch(state(), VS003, { start: pose(dock) });
check("VS-003 keeps its own asset id on the host approach", hosted.ok && hosted.mission.targetAssetId === VS003 && hosted.mission.targetObjectId === "OBJ-0185");

for (const id of [P002, PT003, PT001]) {
  const row = targets.targets.find((t) => t.asset_id === id);
  const object = scene.objects.find((o) => o.object_id === row.object_id);
  const centre = object.obb?.center ?? object.center;
  const stand = horiz(row.approach.position, centre);
  check(`${id} approach is a standoff, not the centroid`, row.approach.standoff_m > 0.2 && stand > 0.2, `${stand.toFixed(2)} m`);
}

const outside = planRoute(grid, pose([1e5, 0, 1e5]), targets.targets.find((t) => t.asset_id === P002).approach);
check("a start outside the grid is an error with no samples", outside.code === "error" && !outside.samples, outside.error ?? "");
const blockedGoal = planRoute(grid, pose(dock), { position: [1e5, grid.floorY, 1e5], yaw: 0 });
check("an off-grid goal is unreachable with no samples", blockedGoal.code === "unreachable" && !blockedGoal.samples, blockedGoal.error ?? "");

const noGrid = state({ navGrid: null });
const stored = applyDispatch(noGrid, P002, { start: pose(dock) });
check("without a grid the dock can use its stored segment", stored.ok && stored.nav.planned_from === "stored_front_entry" && horiz(stored.nav.samples[0].pos, dock) <= limit);
const storedNext = applyDispatch(
  { ...noGrid, nav: stored.nav, mission: { ...stored.mission, state: "arrived" }, running: false },
  PT003,
  { start: pose(arriveA) },
);
check("without a grid a second leg is an error and keeps the route", !storedNext.ok && storedNext.mission.state === "error" && storedNext.nav === stored.nav);

console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
process.exit(failures ? 1 : 0);
