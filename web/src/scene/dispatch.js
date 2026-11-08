// Dispatch targets: an Excel asset ({ assetId }) or a saved scene region
// ({ objectId }). The goal is that object's service approach in nav_targets.json,
// never its interior centroid. The route is planned from the robot's current
// pose (planner.js on nav_grid.json). A stored mission is one front-entry
// segment and is used only when the grid is missing and the robot is still
// on that segment's first sample.
import { missionDuration, navForTarget, sampleAt } from "./mission.js";
import { runtime } from "./missionRuntime.js";
import { planRoute, snapLimitM } from "./planner.js";

export const DISPATCHABLE = new Set(["idle", "planning", "arrived", "unreachable", "error"]);

export function normaliseTarget(target) {
  if (!target) return null;
  return typeof target === "string" ? { assetId: target } : target;
}

const fmt1 = (v) => (v == null ? "?" : Number(v).toFixed(1));

function objectLabel(object) {
  return object.display_label ? `${object.object_id} (${object.display_label})` : object.object_id;
}

export function horizontalM(a, b, mpu) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]) * mpu;
}

export function alreadyAtApproach(start, approach, mpu) {
  if (!start?.pos || !approach?.position || !mpu) return false;
  return horizontalM(start.pos, approach.position, mpu) < 0.1;
}

// Playing motion keeps its route. A paused move, and every settled state, can dispatch.
export function dispatchAllowed(state, running) {
  if (DISPATCHABLE.has(state ?? "idle")) return true;
  return state === "moving" && running === false;
}

function approachFor(navTargets, object, assetId) {
  const listed = navTargets?.objects?.[object.object_id];
  if (listed?.approach || listed?.reachable === false) return listed;
  const rows = (navTargets?.targets ?? []).filter((t) => t.object_id === object.object_id);
  return rows.find((t) => t.asset_id === assetId) ?? rows.find((t) => t.reachable && t.approach) ?? rows[0] ?? null;
}

// { ok, object, assetId, approach, label } or { ok: false, label, reason, code }.
export function resolveTarget(s, rawTarget) {
  const target = normaliseTarget(rawTarget);
  if (!target) return { ok: false, code: "blocked", label: "", reason: "Select an asset to send the robot to" };
  const objects = s.sceneObjects?.objects ?? [];
  let object = null;
  if (target.objectId) {
    object = objects.find((o) => o.object_id === target.objectId) ?? null;
  } else if (target.assetId) {
    const sceneId = s.assets?.find((a) => a.asset_id === target.assetId)?.scene_object_id;
    if (!sceneId) {
      const tag = s.assets?.find((a) => a.asset_id === target.assetId)?.tag ?? target.assetId;
      return { ok: false, code: "unreachable", label: tag, reason: `${tag} is not bound to a scene object, so it has no position in the scan` };
    }
    object = objects.find((o) => o.object_id === sceneId) ?? null;
  }
  // The requested asset stays the mission target. A hosted sensor must not be
  // replaced by the host object's own asset id.
  const assetId = target.assetId ?? object?.asset_id ?? null;
  const tag = assetId ? (s.assets?.find((a) => a.asset_id === assetId)?.tag ?? assetId) : null;
  const label = tag ?? (object ? object.object_id : (target.objectId ?? ""));
  const longLabel = tag ?? (object ? objectLabel(object) : label);
  if (!object) return { ok: false, code: "unreachable", label, reason: `${label} is not bound to a scene object, so it has no position in the scan` };
  if (!object.asset_id && !assetId) {
    return { ok: false, code: "unreachable", label, reason: `${longLabel} is not a saved equipment region` };
  }
  if (object.source === "structure_plane") return { ok: false, code: "error", label, reason: `${object.display_label ?? "Structure"} is not a dispatch target` };
  const pose = approachFor(s.navTargets, object, assetId);
  if (!pose) return { ok: false, code: "unreachable", label, reason: `No approach pose for ${longLabel}` };
  if (!pose.reachable || !pose.approach) {
    return {
      ok: false,
      code: "unreachable",
      label,
      reason: `${longLabel} is ${fmt1(pose.distance_to_walkable_m)} m from the scanned floor, so the robot cannot stand next to it`,
    };
  }
  return { ok: true, object, assetId, approach: pose.approach, label, longLabel };
}

// Pose the driver last sampled, or the active sample when the driver has not run yet.
export function robotPose(s) {
  if (runtime.nav && runtime.pose?.pos) return { pos: [...runtime.pose.pos], yaw: runtime.pose.yaw ?? 0 };
  const samples = s.nav?.samples;
  if (!samples?.length) return null;
  const pose = sampleAt(samples, s.mission?.t ?? 0);
  return { pos: [...pose.pos], yaw: pose.yaw ?? 0 };
}

// Idle uses the route's first sample (the dock preview, or a pose frozen by reset).
// Every other state uses the robot's current pose.
export function currentStart(s) {
  if ((s.mission?.state ?? "idle") !== "idle") {
    const live = robotPose(s);
    if (live) return { ...live, name: "current_position" };
  }
  const sample = s.nav?.samples?.[0];
  if (sample?.pos) return { pos: [...sample.pos], yaw: sample.yaw ?? 0, name: s.nav.start_name ?? "current_position" };
  const sp = s.navGrid?.startPose ?? s.navTargets?.start_pose ?? s.baseNav?.start_pose;
  return sp?.position ? { pos: [...sp.position], yaw: sp.yaw ?? 0, name: sp.name ?? "front_entry" } : null;
}

function metresPerUnit(s) {
  return s.navGrid?.mpu ?? s.baseNav?.metres_per_unit ?? s.navTargets?.metres_per_unit ?? 1;
}

// One stationary sample, so reset does not reload the dock route.
export function frozenNav(s, pose) {
  const pos = [...pose.pos];
  const yaw = pose.yaw ?? 0;
  const sample = { t: 0, s: 0, pos, yaw, speed: 0, phase: "arrived" };
  return {
    ...(s.nav ?? s.baseNav ?? {}),
    samples: [sample],
    path: [pos],
    path_raw: [pos],
    path_shortcut: [pos],
    start: pos,
    goal: pos,
    start_name: "current_position",
    start_pose: { position: pos, yaw, name: "current_position" },
    target_asset_id: null,
    target_object_id: null,
    path_length_m: 0,
    path_length_units: 0,
    stats: { path_length_m: 0, duration_s: 0, planner: "hold" },
  };
}

function storedSegment(s, assetId, start) {
  const stored = assetId ? navForTarget(s.baseNav, s.navTargets, assetId) : null;
  const sample0 = stored?.samples?.[0]?.pos;
  if (!stored?.samples?.length || !start || !sample0) return null;
  const limit = s.navGrid ? snapLimitM(s.navGrid) : (s.baseNav?.cell_size ?? 0.05) * metresPerUnit(s) * Math.SQRT2;
  if (horizontalM(start.pos, sample0, metresPerUnit(s)) > limit) return null;
  return {
    ...stored,
    planned_from: "stored_front_entry",
    start_name: stored.start_name ?? "front_entry",
  };
}

export function planDispatch(s, rawTarget, opts = {}) {
  if (!opts.force && !dispatchAllowed(s.mission?.state ?? "idle", s.running)) {
    return {
      ok: false,
      code: "blocked",
      label: "",
      reason: "Pause the robot or wait until it arrives before sending a new target",
    };
  }
  const r = resolveTarget(s, rawTarget);
  if (!r.ok) return r;
  const start = opts.start ?? currentStart(s);
  if (!start) return { ...r, ok: false, code: "error", reason: "The robot pose is not known yet" };
  if (alreadyAtApproach(start, r.approach, metresPerUnit(s))) {
    return { ...r, ok: false, code: "already", reason: "The robot is already at this approach pose" };
  }
  if (!s.navGrid) {
    const nav = storedSegment(s, r.assetId, start);
    if (!nav) {
      return {
        ...r,
        ok: false,
        code: "error",
        reason: "The navigation grid is not loaded, so a route from the current pose cannot be checked",
      };
    }
    return { ...r, nav, start };
  }
  const route = planRoute(s.navGrid, start, r.approach);
  if (route.error) return { ...r, ok: false, code: route.code ?? "unreachable", reason: route.error };
  const nav = {
    ...s.baseNav,
    ...route,
    approach: { ...r.approach, object_id: r.object.object_id, asset_id: r.assetId },
    target_asset_id: r.assetId,
    target_object_id: r.object.object_id,
    planned_from: "current_pose",
    start_name: start.name,
    start_pose: { position: start.pos, yaw: start.yaw, name: start.name },
  };
  return { ...r, nav, start };
}

// Commit a dispatch without touching the store. A failed plan keeps `nav`.
export function applyDispatch(s, rawTarget, opts = {}) {
  const planned = planDispatch(s, rawTarget, opts);
  if (!planned.ok) {
    const nextState = planned.code === "unreachable" || planned.code === "error" ? planned.code : s.mission.state;
    return {
      ok: false,
      nav: s.nav,
      mission: { ...s.mission, state: nextState, blockReason: planned.reason },
    };
  }
  const epoch = (s.mission.epoch ?? 0) + 1;
  return {
    ok: true,
    nav: planned.nav,
    mission: {
      ...s.mission,
      state: "moving",
      t: 0,
      feed: [{ id: `dispatch-${epoch}`, t: 0, kind: "dispatch", assetId: planned.assetId, text: `Dispatched to ${planned.label}` }],
      diagnosisAt: null,
      duration: missionDuration(planned.nav.samples),
      targetAssetId: planned.assetId,
      targetObjectId: planned.object.object_id,
      runId: (s.mission.runId ?? 0) + 1,
      epoch,
      blockReason: null,
    },
  };
}

// A late copilot response applies only to the mission that requested it.
export function diagnosisStillCurrent(mission, pending) {
  return Boolean(
    pending &&
      mission &&
      pending.epoch === mission.epoch &&
      pending.assetId === mission.targetAssetId &&
      mission.state === "arrived",
  );
}
