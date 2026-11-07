// Pure mission maths, shared by the viewer and scripts/check-mission.mjs.
// Everything is in raw PLY frame (y-down); yaw = atan2(dx, dz) about raw +y.

export const PROXIMITY = { enterM: 1.6, exitM: 2.0, fovDeg: 90, hz: 10 };
export const TIMING = { preRollS: 0.6, approachS: 1.5, minDiagnosisS: 1.2 };

const TAU = Math.PI * 2;

export function wrapAngle(a) {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

export function lerpAngle(a, b, f) {
  return a + wrapAngle(b - a) * f;
}

// Index of the last sample with sample.t <= t.
function sampleIndex(samples, t) {
  let lo = 0;
  let hi = samples.length - 1;
  if (t <= samples[0].t) return 0;
  if (t >= samples[hi].t) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function sampleAt(samples, t, out = {}) {
  const i = sampleIndex(samples, t);
  const a = samples[i];
  const b = samples[Math.min(i + 1, samples.length - 1)];
  const span = b.t - a.t;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
  const pos = out.pos ?? [0, 0, 0];
  for (let k = 0; k < 3; k += 1) pos[k] = a.pos[k] + (b.pos[k] - a.pos[k]) * f;
  out.pos = pos;
  out.yaw = lerpAngle(a.yaw, b.yaw, f);
  out.speed = a.speed + (b.speed - a.speed) * f;
  out.s = a.s + (b.s - a.s) * f;
  out.phase = f < 1 ? a.phase : b.phase;
  out.index = i;
  return out;
}

export function missionDuration(samples) {
  return samples.length ? samples[samples.length - 1].t : 0;
}

// End of the drive phase; the turn-in-place (if any) follows it.
export function driveEnd(samples) {
  for (let i = samples.length - 1; i >= 0; i -= 1) if (samples[i].phase === "drive") return samples[i].t;
  return missionDuration(samples);
}

// Motion state from mission time. "dispatched" (pre-roll) and the post-arrival
// states are owned by the driver, not by t.
export function stateAt(t, duration, approachStart = duration - TIMING.approachS) {
  if (t >= duration) return "arrived";
  if (t >= approachStart) return "approaching";
  return "en_route";
}

// OBB footprint in x-z (centre, unit axes, half extents), as navigation.py.
export function footprint(object) {
  const obb = object.obb ?? {
    center: object.center,
    extent: object.aabb_max.map((v, i) => v - object.aabb_min[i]),
    rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  };
  const r = obb.rotation;
  const ax = [r[0][0], r[2][0]];
  const az = [r[0][2], r[2][2]];
  const nx = Math.hypot(ax[0], ax[1]) || 1;
  const nz = Math.hypot(az[0], az[1]) || 1;
  return {
    centre: [obb.center[0], obb.center[2]],
    ax: [ax[0] / nx, ax[1] / nx],
    az: [az[0] / nz, az[1] / nz],
    half: [obb.extent[0] / 2, obb.extent[2] / 2],
  };
}

// Horizontal distance from p (raw xyz) to the footprint, in metres.
export function footprintDistance(p, fp, mpu) {
  const dx = p[0] - fp.centre[0];
  const dz = p[2] - fp.centre[1];
  const u = Math.max(Math.abs(dx * fp.ax[0] + dz * fp.ax[1]) - fp.half[0], 0);
  const w = Math.max(Math.abs(dx * fp.az[0] + dz * fp.az[1]) - fp.half[1], 0);
  return Math.hypot(u, w) * mpu;
}

export function inFov(p, yaw, centreXZ, fovDeg = PROXIMITY.fovDeg) {
  const ux = centreXZ[0] - p[0];
  const uz = centreXZ[1] - p[2];
  const n = Math.hypot(ux, uz);
  if (n < 1e-9) return true;
  const dot = (Math.sin(yaw) * ux + Math.cos(yaw) * uz) / n;
  return dot >= Math.cos(((fovDeg / 2) * Math.PI) / 180);
}

// Per-asset enter/exit hysteresis. "scanned" fires once per mission, the
// first time an asset is active and inside the field-of-view cone.
export function createProximityTracker(objects, mpu, opts = {}) {
  const { enterM, exitM, fovDeg } = { ...PROXIMITY, ...opts };
  const items = objects.map((object) => ({ object, fp: footprint(object), active: false, scanned: false }));
  return {
    reset() {
      for (const item of items) Object.assign(item, { active: false, scanned: false });
    },
    update(pos, yaw) {
      const events = [];
      for (const item of items) {
        const d = footprintDistance(pos, item.fp, mpu);
        const id = item.object.object_id;
        if (!item.active && d < enterM) {
          item.active = true;
          events.push({ type: "enter", objectId: id, distanceM: d });
        } else if (item.active && d > exitM) {
          item.active = false;
          events.push({ type: "exit", objectId: id, distanceM: d });
        }
        if (item.active && !item.scanned && inFov(pos, yaw, item.fp.centre, fovDeg)) {
          item.scanned = true;
          events.push({ type: "scanned", objectId: id, distanceM: d });
        }
      }
      return events;
    },
    activeIds() {
      return items.filter((item) => item.active).map((item) => item.object.object_id);
    },
  };
}

// The whole mission's proximity timeline, polled at PROXIMITY.hz. Scrubbing
// reads it by time, so the result never depends on the frame rate.
export function simulateMission(samples, objects, mpu, opts = {}) {
  const hz = opts.hz ?? PROXIMITY.hz;
  const tracker = createProximityTracker(objects, mpu, opts);
  const duration = missionDuration(samples);
  const events = [];
  const pose = {};
  const steps = Math.ceil(duration * hz);
  for (let k = 0; k <= steps; k += 1) {
    const t = Math.min(duration, k / hz);
    sampleAt(samples, t, pose);
    for (const e of tracker.update(pose.pos, pose.yaw)) events.push({ ...e, t: Math.round(t * 1000) / 1000 });
  }
  return events;
}

// Object ids active at time t, in order of entry.
export function activeAt(events, t) {
  const active = new Map();
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === "enter") active.set(e.objectId, e.t);
    else if (e.type === "exit") active.delete(e.objectId);
  }
  return [...active.keys()];
}

// Active navigation for a target: the nav_targets mission merged over nav.json,
// the same merge as GET /api/scene/nav?target=.
export function navForTarget(baseNav, navTargets, assetId) {
  if (!assetId || assetId === baseNav?.target_asset_id) return baseNav;
  const entry = navTargets?.targets?.find((t) => t.asset_id === assetId);
  if (!entry?.reachable || !entry.mission) return null;
  return {
    ...baseNav,
    ...entry.mission,
    approach: { ...entry.approach, object_id: entry.object_id, asset_id: entry.asset_id },
    goal: entry.approach?.position ?? baseNav.goal,
    target_asset_id: entry.asset_id,
    target_object_id: entry.object_id,
  };
}
