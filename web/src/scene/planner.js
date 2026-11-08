// Route planning in the viewer, a port of pipeline/navigation.py (Theta*,
// greedy shortcut, centripetal Catmull-Rom, collision fallback, curvature-
// limited trapezoidal speed profile, turn in place). It runs on nav_grid.json
// so the robot can be sent from wherever it is to any approach pose.
//
// Frame: ply_raw, y down. Metres = units * metres_per_unit. Yaw = atan2(dx, dz)
// about raw +y, from +z toward +x. The display frame (180° about X) is not used.
// Grid row j indexes z and column i indexes x. Cell (j, i) covers
// [x0 + i*cell, x0 + (i+1)*cell) by [z0 + j*cell, z0 + (j+1)*cell). Its centre
// is (x0 + (i+0.5)*cell, z0 + (j+0.5)*cell). The robot's y is floor_y.

const SQRT2 = Math.SQRT2;
const NEIGHBOURS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];

function decodeBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k += 1) out[k] = bin.charCodeAt(k);
  return out;
}

export function decodeGrid(doc) {
  const [h, w] = doc.shape;
  const walkable = decodeBase64(doc.walkable_u8);
  const blocked = decodeBase64(doc.blocked_u8);
  const raw = decodeBase64(doc.esdf_mm_u16le);
  const view = new DataView(raw.buffer);
  const esdf = new Float32Array(h * w);
  const cost = new Float32Array(h * w);
  const { cost_w: cw, cost_sigma_m: sigma } = doc.params;
  for (let k = 0; k < h * w; k += 1) {
    esdf[k] = view.getUint16(k * 2, true) / 1000;
    cost[k] = 1 + cw * Math.exp(-esdf[k] / sigma);
  }
  return {
    h, w, cell: doc.cell, x0: doc.x0, z0: doc.z0, floorY: doc.floor_y, mpu: doc.metres_per_unit,
    params: doc.params, startPose: doc.start_pose, walkable, blocked, esdf, cost,
  };
}

const centre = (g, j, i) => [g.x0 + (i + 0.5) * g.cell, g.z0 + (j + 0.5) * g.cell];
const cellOf = (g, x, z) => [Math.floor((z - g.z0) / g.cell), Math.floor((x - g.x0) / g.cell)];
const inside = (g, j, i) => j >= 0 && j < g.h && i >= 0 && i < g.w;
const isWalkable = (g, j, i) => inside(g, j, i) && g.walkable[j * g.w + i] === 1;

// A start that is off its walkable cell may snap only this far (one cell diagonal).
export function snapLimitM(g) {
  return g.cell * g.mpu * Math.SQRT2;
}

export const GOAL_SNAP_M = 0.2;

// Supercover traversal between cell centres; corner crossings add both side cells.
function lineCells(a, b) {
  let [j, i] = a;
  const [j1, i1] = b;
  const dj = j1 - j;
  const di = i1 - i;
  const sj = dj > 0 ? 1 : -1;
  const si = di > 0 ? 1 : -1;
  const tdj = dj ? Math.abs(1 / dj) : Infinity;
  const tdi = di ? Math.abs(1 / di) : Infinity;
  let tmj = 0.5 * tdj;
  let tmi = 0.5 * tdi;
  const cells = [[j, i]];
  for (let n = 0; n < Math.abs(dj) + Math.abs(di) + 2; n += 1) {
    if (j === j1 && i === i1) break;
    if (Math.abs(tmj - tmi) < 1e-9) {
      cells.push([j + sj, i], [j, i + si]);
      j += sj;
      i += si;
      tmj += tdj;
      tmi += tdi;
    } else if (tmj < tmi) {
      j += sj;
      tmj += tdj;
    } else {
      i += si;
      tmi += tdi;
    }
    cells.push([j, i]);
  }
  return cells;
}

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(priority, value) {
    const a = this.items;
    a.push([priority, value]);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p][0] <= a[k][0]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

export class Planner {
  constructor(grid) {
    this.g = grid;
    this.cellM = grid.cell * grid.mpu;
    this.expansions = 0;
  }

  los(a, b) {
    for (const [j, i] of lineCells(a, b)) if (!isWalkable(this.g, j, i)) return false;
    return true;
  }

  segCost(a, b) {
    const cells = lineCells(a, b);
    let sum = 0;
    for (const [j, i] of cells) sum += this.g.cost[j * this.g.w + i];
    return Math.hypot(b[0] - a[0], b[1] - a[1]) * this.cellM * (sum / cells.length);
  }

  pathCost(cells) {
    let sum = 0;
    for (let k = 0; k < cells.length - 1; k += 1) sum += this.segCost(cells[k], cells[k + 1]);
    return sum;
  }

  heuristic(a, b) {
    const dj = Math.abs(a[0] - b[0]);
    const di = Math.abs(a[1] - b[1]);
    return (Math.max(dj, di) + (SQRT2 - 1) * Math.min(dj, di)) * this.cellM;
  }

  // Basic Theta* over the 8-connected walkable grid (no diagonal corner cutting).
  search(start, goal) {
    const { g } = this;
    const n = g.h * g.w;
    const key = (c) => c[0] * g.w + c[1];
    const cost = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const sk = key(start);
    const gk = key(goal);
    cost[sk] = 0;
    parent[sk] = sk;
    const heap = new MinHeap();
    heap.push(this.heuristic(start, goal), sk);
    const cellOfKey = (k) => [Math.floor(k / g.w), k % g.w];
    while (heap.size) {
      const [, s] = heap.pop();
      if (closed[s]) continue;
      if (s === gk) break;
      closed[s] = 1;
      this.expansions += 1;
      const sc = cellOfKey(s);
      for (const [dj, di] of NEIGHBOURS) {
        const nc = [sc[0] + dj, sc[1] + di];
        if (!isWalkable(g, nc[0], nc[1])) continue;
        const nk = key(nc);
        if (closed[nk]) continue;
        if (dj && di && !(isWalkable(g, sc[0] + dj, sc[1]) && isWalkable(g, sc[0], sc[1] + di))) continue;
        let best = cost[s] + this.segCost(sc, nc);
        let bestParent = s;
        const p = parent[s];
        if (p !== s) {
          const pc = cellOfKey(p);
          if (this.los(pc, nc)) {
            const alt = cost[p] + this.segCost(pc, nc);
            if (alt <= best) {
              best = alt;
              bestParent = p;
            }
          }
        }
        if (best < cost[nk]) {
          cost[nk] = best;
          parent[nk] = bestParent;
          heap.push(best + this.heuristic(nc, goal), nk);
        }
      }
    }
    if (parent[gk] === -1) return null;
    const path = [gk];
    while (path[path.length - 1] !== sk) path.push(parent[path[path.length - 1]]);
    return path.reverse().map(cellOfKey);
  }

  // Greedy farthest-visible shortcut, accepted only if it doesn't raise clearance cost.
  shortcut(cells) {
    const out = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let k = cells.length - 1;
      while (k > i + 1) {
        if (this.los(cells[i], cells[k]) && this.segCost(cells[i], cells[k]) <= this.pathCost(cells.slice(i, k + 1)) + 1e-9) break;
        k -= 1;
      }
      out.push(cells[k]);
      i = k;
    }
    return out;
  }
}

// ----------------------------------------------------------------- geometry

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polylineLength(points) {
  let s = 0;
  for (let k = 1; k < points.length; k += 1) s += dist(points[k - 1], points[k]);
  return s;
}

export function densify(points, step) {
  const out = [];
  for (let k = 0; k < points.length - 1; k += 1) {
    const [a, b] = [points[k], points[k + 1]];
    const m = Math.max(Math.ceil(dist(a, b) / step), 1);
    for (let q = 0; q < m; q += 1) out.push([a[0] + ((b[0] - a[0]) * q) / m, a[1] + ((b[1] - a[1]) * q) / m]);
  }
  out.push(points[points.length - 1]);
  return out;
}

// Centripetal Catmull-Rom (Barry-Goldman evaluation) through all points.
export function catmullRom(points, step, alpha = 0.5) {
  if (points.length < 3) return densify(points, step);
  const first = [2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1]];
  const n = points.length;
  const lastExt = [2 * points[n - 1][0] - points[n - 2][0], 2 * points[n - 1][1] - points[n - 2][1]];
  const ext = [first, ...points, lastExt];
  const out = [];
  const lerp = (p, q, ta, tb, t) => [((tb - t) / (tb - ta)) * p[0] + ((t - ta) / (tb - ta)) * q[0], ((tb - t) / (tb - ta)) * p[1] + ((t - ta) / (tb - ta)) * q[1]];
  for (let k = 1; k < ext.length - 2; k += 1) {
    const [p0, p1, p2, p3] = [ext[k - 1], ext[k], ext[k + 1], ext[k + 2]];
    const t0 = 0;
    const t1 = t0 + Math.max(dist(p0, p1) ** alpha, 1e-9);
    const t2 = t1 + Math.max(dist(p1, p2) ** alpha, 1e-9);
    const t3 = t2 + Math.max(dist(p2, p3) ** alpha, 1e-9);
    const m = Math.max(Math.ceil(dist(p1, p2) / step), 1);
    for (let q = 0; q < m; q += 1) {
      const t = t1 + ((t2 - t1) * q) / m;
      const a1 = lerp(p0, p1, t0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      out.push(lerp(b1, b2, t1, t2, t));
    }
  }
  out.push(points[n - 1]);
  return out;
}

function cumulative(points) {
  const s = [0];
  for (let k = 1; k < points.length; k += 1) s.push(s[k - 1] + dist(points[k - 1], points[k]));
  return s;
}

// Linear interpolation of ys at x over increasing xs (np.interp).
function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  return span > 0 ? ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / span : ys[lo];
}

export function resample(points, step) {
  const s = cumulative(points);
  const total = s[s.length - 1];
  const n = Math.max(Math.ceil(total / step) + 1, 2);
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const su = (total * k) / (n - 1);
    out.push([interp(su, s, xs), interp(su, s, zs)]);
  }
  return out;
}

const wrapAngle = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

// ----------------------------------------------------------------- clearance

// Exact distance in metres from (x, z) to the nearest blocked cell square,
// searched within `windowM` (beyond that the point is clear by at least windowM).
export function clearanceM(g, x, z, windowM = 0.8) {
  const [cj, ci] = cellOf(g, x, z);
  const r = Math.ceil(windowM / (g.cell * g.mpu)) + 1;
  const half = g.cell / 2;
  let best = Infinity;
  for (let j = Math.max(0, cj - r); j <= Math.min(g.h - 1, cj + r); j += 1) {
    for (let i = Math.max(0, ci - r); i <= Math.min(g.w - 1, ci + r); i += 1) {
      if (!g.blocked[j * g.w + i]) continue;
      const [bx, bz] = centre(g, j, i);
      const d = Math.hypot(Math.max(Math.abs(x - bx) - half, 0), Math.max(Math.abs(z - bz) - half, 0));
      if (d < best) best = d;
    }
  }
  return Math.min(best * g.mpu, windowM);
}

function collisionFree(g, xz, from = 0, radius = g.params.robot_radius_m) {
  for (let k = from; k < xz.length; k += 1) {
    const [j, i] = cellOf(g, xz[k][0], xz[k][1]);
    if (!isWalkable(g, j, i) || clearanceM(g, xz[k][0], xz[k][1]) <= radius) return false;
  }
  return true;
}

// Cells the straight connector crosses, after the pose's own cell, must be walkable.
function connectorClear(g, x, z, cell) {
  const origin = cellOf(g, x, z);
  const cells = lineCells(origin, cell);
  for (let k = 1; k < cells.length; k += 1) {
    const [cj, ci] = cells[k];
    if (!isWalkable(g, cj, ci)) return false;
  }
  const [tx, tz] = centre(g, cell[0], cell[1]);
  const n = Math.max(Math.ceil(Math.hypot(tx - x, tz - z) / (g.cell * 0.25)), 1);
  for (let k = 1; k <= n; k += 1) {
    const px = x + ((tx - x) * k) / n;
    const pz = z + ((tz - z) * k) / n;
    const [pj, pi] = cellOf(g, px, pz);
    if (pj === origin[0] && pi === origin[1]) continue;
    if (!isWalkable(g, pj, pi)) return false;
  }
  return true;
}

// Walkable cell for (x, z), or a cell at most maxOffsetM away with a clear connector.
// No whole-map search. {error: "outside" | "unreachable" | "connector"} when it cannot.
export function snapToWalkable(g, x, z, maxOffsetM = snapLimitM(g)) {
  const [j, i] = cellOf(g, x, z);
  if (!inside(g, j, i)) return { error: "outside" };
  if (isWalkable(g, j, i)) return { cell: [j, i], snapped: false, offsetM: 0 };
  const radius = Math.ceil(maxOffsetM / (g.cell * g.mpu)) + 1;
  let best = null;
  let bestD = Infinity;
  for (let jj = j - radius; jj <= j + radius; jj += 1) {
    for (let ii = i - radius; ii <= i + radius; ii += 1) {
      if (!isWalkable(g, jj, ii)) continue;
      const c = centre(g, jj, ii);
      const d = Math.hypot(c[0] - x, c[1] - z) * g.mpu;
      if (d <= maxOffsetM && d < bestD) {
        bestD = d;
        best = [jj, ii];
      }
    }
  }
  if (!best) return { error: "unreachable" };
  if (!connectorClear(g, x, z, best)) return { error: "connector" };
  return { cell: best, snapped: true, offsetM: bestD };
}

// ----------------------------------------------------------------- motion

function turnSamples(fromYaw, toYaw, t0, base, p) {
  const turn = wrapAngle(toYaw - fromYaw);
  if (Math.abs(turn) <= (1 * Math.PI) / 180) return { samples: [], duration: 0, turn };
  const wMax = (p.turn_rate_dps * Math.PI) / 180;
  const wAcc = (p.turn_acc_dps2 * Math.PI) / 180;
  const th = Math.abs(turn);
  const tAcc = Math.min(wMax / wAcc, Math.sqrt(th / wAcc));
  const wPeak = wAcc * tAcc;
  const tCruise = Math.max(th - wPeak * tAcc, 0) / wPeak;
  const total = 2 * tAcc + tCruise;
  const angle = (u) => {
    if (u < tAcc) return 0.5 * wAcc * u * u;
    if (u < tAcc + tCruise) return 0.5 * wPeak * tAcc + wPeak * (u - tAcc);
    const r = total - u;
    return th - 0.5 * wAcc * r * r;
  };
  const samples = [];
  const dt = p.sample_dt_s;
  for (let u = dt; u < total; u += dt) samples.push({ ...base, t: round(t0 + u, 3), yaw: round(wrapAngle(fromYaw + Math.sign(turn) * angle(u)), 5), speed: 0, phase: "turn" });
  samples.push({ ...base, t: round(t0 + total, 3), yaw: round(wrapAngle(toYaw), 5), speed: 0, phase: "turn" });
  return { samples, duration: total, turn };
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// Optional initial turn from startYaw to the path heading, curvature-limited
// trapezoidal drive, then turn in place to finalYaw. Same sample shape as nav.json.
export function motionProfile(g, xz, finalYaw, startYaw = null) {
  const p = g.params;
  const { mpu, floorY } = g;
  let dense = resample(xz, 0.01);
  let s = cumulative(dense).map((v) => v * mpu);
  if (s[s.length - 1] < 1e-6) {
    dense = [xz[0], xz[0]];
    s = [0, 1e-6];
  }
  const n = dense.length;
  const grad = (vals) =>
    vals.map((_, k) => {
      const a = Math.max(k - 1, 0);
      const b = Math.min(k + 1, n - 1);
      return (vals[b] - vals[a]) / Math.max(s[b] - s[a], 1e-12);
    });
  const dx = grad(dense.map((q) => q[0]));
  const dz = grad(dense.map((q) => q[1]));
  const yaw = dx.map((v, k) => Math.atan2(v, dz[k]));
  for (let k = 1; k < n; k += 1) yaw[k] = yaw[k - 1] + wrapAngle(yaw[k] - yaw[k - 1]);
  const dyaw = grad(yaw).map(Math.abs);
  const kappa = dyaw.map((_, k) => {
    let sum = 0;
    for (let q = -4; q <= 4; q += 1) sum += dyaw[Math.min(Math.max(k + q, 0), n - 1)];
    return sum / 9;
  });
  const v = kappa.map((c) => Math.min(p.v_max_mps, Math.sqrt(p.a_lat_mps2 / Math.max(c, 1e-9))));
  v[0] = 0;
  v[n - 1] = 0;
  const a = p.a_max_mps2;
  for (let k = 1; k < n; k += 1) v[k] = Math.min(v[k], Math.sqrt(v[k - 1] ** 2 + 2 * a * (s[k] - s[k - 1])));
  for (let k = n - 2; k >= 0; k -= 1) v[k] = Math.min(v[k], Math.sqrt(v[k + 1] ** 2 + 2 * a * (s[k + 1] - s[k])));
  const t = [0];
  for (let k = 1; k < n; k += 1) t.push(t[k - 1] + (2 * (s[k] - s[k - 1])) / Math.max(v[k - 1] + v[k], 1e-9));
  const driveT = t[n - 1];

  const xs = dense.map((q) => q[0]);
  const zs = dense.map((q) => q[1]);
  const sampleAtT = (ti, offset) => {
    const si = interp(ti, t, s);
    return {
      t: round(ti + offset, 3),
      s: round(si, 4),
      pos: [round(interp(si, s, xs), 5), round(floorY, 5), round(interp(si, s, zs), 5)],
      yaw: round(wrapAngle(interp(si, s, yaw)), 5),
      speed: round(interp(ti, t, v), 4),
      phase: "drive",
    };
  };

  const samples = [];
  let offset = 0;
  let startTurn = { duration: 0, turn: 0 };
  if (startYaw != null) {
    const first = sampleAtT(0, 0);
    startTurn = turnSamples(startYaw, yaw[0], 0, first, p);
    if (startTurn.duration > 0) {
      samples.push({ ...first, yaw: round(wrapAngle(startYaw), 5), phase: "turn" }, ...startTurn.samples);
      offset = startTurn.duration;
    }
  }
  const dt = p.sample_dt_s;
  for (let ti = offset > 0 ? dt : 0; ti < driveT; ti += dt) samples.push(sampleAtT(ti, offset));
  samples.push(sampleAtT(driveT, offset));

  const yawEnd = yaw[n - 1];
  const end = samples[samples.length - 1];
  const final = turnSamples(yawEnd, finalYaw, offset + driveT, end, p);
  samples.push(...final.samples);
  samples[samples.length - 1].phase = "arrived";
  samples[samples.length - 1].yaw = round(wrapAngle(finalYaw), 5);
  return {
    samples,
    stats: {
      start_turn_s: round(startTurn.duration, 2),
      drive_duration_s: round(driveT, 2),
      turn_duration_s: round(final.duration, 2),
      duration_s: round(offset + driveT + final.duration, 2),
      turn_in_place_deg: round((final.turn * 180) / Math.PI, 1),
      peak_speed_mps: round(Math.max(...v), 3),
    },
  };
}

// ----------------------------------------------------------------- route

// Cell approach_lead_m behind the goal along its heading, so the robot drives straight in.
function preApproach(g, planner, start, goal, finalYaw) {
  const lead = g.params.approach_lead_m / g.mpu;
  const [gx, gz] = centre(g, goal[0], goal[1]);
  const c = cellOf(g, gx - lead * Math.sin(finalYaw), gz - lead * Math.cos(finalYaw));
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  if (same(c, start) || same(c, goal) || !isWalkable(g, c[0], c[1]) || !planner.los(c, goal)) return null;
  return c;
}

// First smoothed point that has left the snapped origin cell. -1 if it never does.
function joinIndex(g, pts, origin) {
  if (!origin) return 0;
  return pts.findIndex(([x, z]) => {
    const [j, i] = cellOf(g, x, z);
    return j !== origin[0] || i !== origin[1];
  });
}

// Plan from a pose ({pos: [x, y, z], yaw}) to an approach pose ({position, yaw}).
// Returns the nav fields the viewer uses, or {error, code} with no samples.
// code is "error" (the start is not usable), "unreachable", or "already".
export function planRoute(g, startPose, approach, opts = {}) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const [sx, , sz] = startPose.pos;
  const startSnap = snapToWalkable(g, sx, sz, snapLimitM(g));
  if (startSnap.error === "outside") return { error: "The robot is outside the navigation grid", code: "error" };
  if (startSnap.error === "connector") {
    return { error: "The connector from the robot to the walkable grid is blocked", code: "error" };
  }
  if (!startSnap.cell) return { error: "The robot is not on a connected walkable cell", code: "error" };
  const [gxp, , gzp] = approach.position;
  if (Math.hypot(gxp - sx, gzp - sz) * g.mpu < 0.1) {
    return { error: "The robot is already at this approach pose", code: "already" };
  }
  const goalSnap = snapToWalkable(g, gxp, gzp, GOAL_SNAP_M);
  if (!goalSnap.cell || (goalSnap.snapped && goalSnap.offsetM > GOAL_SNAP_M)) {
    return { error: "The approach pose is not on the walkable floor", code: "unreachable" };
  }
  const start = startSnap.cell;
  const goal = goalSnap.cell;
  const finalYaw = approach.yaw;

  const planner = new Planner(g);
  const lead = preApproach(g, planner, start, goal, finalYaw);
  let raw = planner.search(start, lead ?? goal);
  if (!raw) return { error: "No collision-free route between the robot and the approach pose", code: "unreachable" };
  let short = planner.shortcut(raw);
  if (lead) {
    raw = [...raw, goal];
    short = [...short, goal];
  }
  const toXZ = (cells) => cells.map(([j, i]) => centre(g, j, i));
  // Start exactly where the robot is, not at its cell centre, so there is no jump.
  const here = [sx, sz];
  const withHere = (pts) => {
    const d = dist(here, pts[0]);
    if (d < 1e-4) return pts;
    return d < g.cell * 0.5 && pts.length > 1 ? [here, ...pts.slice(1)] : [here, ...pts];
  };
  const rawXZ = withHere(toXZ(raw));
  const shortXZ = withHere(toXZ(short));
  // A snapped start may occupy its own non-walkable cell. Only that cell is exempt,
  // and only after connectorClear. Every later point is collision-checked.
  const origin = startSnap.snapped ? cellOf(g, sx, sz) : null;
  const step = g.params.spline_step_units;
  // Walkable cells clear the radius centre to centre; the exact distance to an obstacle square can be up to half
  // a cell less, so an endpoint may sit just under the radius. The route only has to be no tighter than its ends.
  const ends = [rawXZ[rawXZ.length - 1], ...(origin ? [] : [here])];
  const floor = Math.min(g.params.robot_radius_m, ...ends.map(([x, z]) => clearanceM(g, x, z) - 1e-6));
  const accept = (pts) => {
    const join = joinIndex(g, pts, origin);
    if (join < 0) return null;
    return collisionFree(g, pts, join, floor) ? join : null;
  };
  let smoothing = "centripetal_catmull_rom";
  let smooth = catmullRom(shortXZ, step);
  let startK = accept(smooth);
  if (startK == null) {
    smoothing = "polyline_fallback";
    smooth = densify(shortXZ, step);
    startK = accept(smooth);
  }
  if (startK == null) {
    smoothing = "raw_polyline_fallback";
    smooth = densify(rawXZ, step);
    startK = accept(smooth);
  }
  if (startK == null) return { error: "The smoothed route cuts through occupied space", code: "unreachable" };
  const { samples, stats } = motionProfile(g, smooth, finalYaw, opts.startYaw ?? startPose.yaw ?? null);
  const pathXZ = resample(smooth, g.params.path_step_units);
  const y = round(g.floorY, 5);
  const as3 = (pts) => pts.map(([x, z]) => [round(x, 5), y, round(z, 5)]);
  let minClear = Infinity;
  let sumClear = 0;
  for (let k = startK; k < smooth.length; k += 1) {
    const c = clearanceM(g, smooth[k][0], smooth[k][1]);
    minClear = Math.min(minClear, c);
    sumClear += c;
  }
  const lengthU = polylineLength(smooth);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    path: as3(pathXZ),
    path_raw: as3(rawXZ),
    path_shortcut: as3(shortXZ),
    samples,
    start: as3([pathXZ[0]])[0],
    goal: as3([pathXZ[pathXZ.length - 1]])[0],
    path_length_units: round(lengthU, 5),
    path_length_m: round(lengthU * g.mpu, 4),
    stats: {
      planner: "theta_star_js",
      smoothing,
      smoothing_fallback: smoothing !== "centripetal_catmull_rom",
      pre_approach_waypoint: Boolean(lead),
      start_snapped_m: startSnap.snapped ? round(startSnap.offsetM, 3) : 0,
      path_length_m: round(lengthU * g.mpu, 4),
      raw_length_m: round(polylineLength(rawXZ) * g.mpu, 4),
      min_clearance_m: round(minClear, 4),
      min_margin_m: round(minClear - g.params.robot_radius_m, 4),
      mean_clearance_m: round(sumClear / Math.max(smooth.length - startK, 1), 4),
      expansions: planner.expansions,
      plan_ms: round(t1 - t0, 1),
      ...stats,
    },
  };
}
