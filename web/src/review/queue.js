// Review-queue order (Tab 8). Pure functions over the merged object list, so
// scripts/check-review-queue.mjs can run them on the real data in Node.
import { footprint, footprintDistance, PROXIMITY } from "../scene/mission.js";
import { isHidden } from "./overrides.js";

export const REVIEW_GOAL = 40;
export const ROUTE_RANGE_M = PROXIMITY.enterM;

export const GROUPS = {
  target: "Mission target",
  bound: "Bound to an Excel asset",
  route: "Along the robot route",
  other: "Everything else",
};

export const isReviewed = (object) => object?.label_source === "human" || isHidden(object);

// Closest approach in metres between the route and an object's footprint.
export function routeDistance(object, path, mpu) {
  if (!path?.length) return Infinity;
  const fp = footprint(object);
  let best = Infinity;
  for (const p of path) best = Math.min(best, footprintDistance(p, fp, mpu));
  return best;
}

/**
 * objects: every object with overrides merged in, hidden ones included.
 * Order: the mission target, the other bound objects (reachable first), unbound
 * objects within ROUTE_RANGE_M of the default route (closest first), then the
 * rest (equipment before pipes and structure). Reviewed objects move to the end,
 * keeping that order, so the next unreviewed object is always first.
 */
export function buildQueue({ objects, path, mpu, targetObjectId, reachableAssets = new Set() }) {
  const items = objects.map((object) => {
    const distance = routeDistance(object, path, mpu);
    let group = "other";
    if (object.object_id === targetObjectId) group = "target";
    else if (object.asset_id) group = "bound";
    else if (distance <= ROUTE_RANGE_M && object.source !== "structure_plane") group = "route";
    return { objectId: object.object_id, group, routeDistanceM: distance, reviewed: isReviewed(object), object };
  });
  const groupRank = { target: 0, bound: 1, route: 2, other: 3 };
  const otherRank = (o) => (o.source === "structure_plane" ? 2 : o.class === "pipe" ? 1 : 0);
  const sortKey = (item) => {
    const o = item.object;
    if (item.group === "bound") return [reachableAssets.has(o.asset_id) ? 0 : 1, o.asset_id];
    if (item.group === "route") return [item.routeDistanceM, o.object_id];
    if (item.group === "other") return [otherRank(o), o.object_id];
    return [0, o.object_id];
  };
  const compare = (a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
    if (groupRank[a.group] !== groupRank[b.group]) return groupRank[a.group] - groupRank[b.group];
    const [a1, a2] = sortKey(a);
    const [b1, b2] = sortKey(b);
    if (a1 !== b1) return a1 < b1 ? -1 : 1;
    return a2 < b2 ? -1 : a2 > b2 ? 1 : 0;
  };
  return items.sort(compare);
}

// Up to `count` visible, non-structure neighbours by OBB-centre distance, for merging.
export function nearestNeighbours(object, objects, count = 3) {
  const c = object.obb?.center ?? object.center;
  return objects
    .filter((o) => o.object_id !== object.object_id && !isHidden(o) && o.source !== "structure_plane")
    .map((o) => {
      const d = o.obb?.center ?? o.center;
      return { object: o, distance: Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

export function queueStats(queue) {
  const reviewed = queue.filter((i) => i.reviewed).length;
  const byGroup = {};
  for (const item of queue) {
    byGroup[item.group] ??= { total: 0, reviewed: 0 };
    byGroup[item.group].total += 1;
    if (item.reviewed) byGroup[item.group].reviewed += 1;
  }
  return { total: queue.length, reviewed, byGroup };
}
