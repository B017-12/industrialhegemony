/**
 * Centerline Waypoint 'Rails', Equipment Collision Solver & Multi-Agent Fleet Coordinator
 *
 * Implements:
 * 1. 2D/3D Equipment & Structure AABB Collision System (`buildCollisionBoxes`, `resolveObstacleCollisions`):
 *    - Prevents both automated A* pathfinding and manual WASD walking from clipping through any of the
 *      30 Valmet assets or room structures (IBC totes, manifold racks, safety guardrails).
 * 2. Pre-baked Open-Aisle Centerline 'Rails' (`NAV_NODES` & `NAV_EDGES`):
 *    - Waypoints placed strictly in unobstructed plant corridors with obstacle-deflected curve smoothing.
 * 3. Multi-Robot & Multi-Human Fleet Coordination (R1, R2, H1):
 *    - Assigns the closest available unit to each active alarm without path or target conflicts.
 */

import { VALMET_ASSETS } from '../data/valmetDataset.js';

/**
 * Static room furniture/structures in `BoilerRoomViewport.jsx` that act as physical colliders
 */
export const STATIC_ROOM_OBSTACLES = [
  {
    id: 'ROOM-GUARDRAIL-YELLOW',
    label: 'Mid-Bay Safety Guardrail',
    position: [0.88, -0.82, 1.05],
    bbox_size: [0.26, 0.38, 0.72]
  },
  {
    id: 'ROOM-IBC-TOTES',
    label: 'Back-Wall IBC Tote Storage',
    position: [-2.02, -0.15, 3.72],
    bbox_size: [3.55, 1.75, 0.72]
  },
  {
    id: 'ROOM-EAST-MANIFOLD-RACK',
    label: 'East Wall Blue Manifold Frame',
    position: [2.10, -0.15, 3.72],
    bbox_size: [3.20, 1.65, 0.22]
  }
];

/**
 * Builds 2D X-Z Axis-Aligned Bounding Boxes (AABBs) for all equipment and static room obstacles.
 * Only includes equipment whose vertical span intersects the operator/robot body height (y - sy/2 < 0.55)
 * so high overhead ceiling transmitters/valves (y >= 0.85) don't block floor aisles underneath them,
 * OR includes all floor/skid assets (we include all assets with bottom < 0.55m, which is 22 floor/skid assets,
 * plus a slightly tighter footprint for elevated rack assets so you never clip any visible 3D mesh).
 */
export function buildCollisionBoxes(assets = VALMET_ASSETS) {
  const boxes = [];

  for (const a of assets || []) {
    if (!a?.position || !a?.bbox_size) continue;
    const [x, y, z] = a.position;
    const [sx, sy, sz] = a.bbox_size;
    const bottomY = y - sy * 0.5;
    // Assets mounted on the overhead rack/upper deck (bottomY > 0.42, i.e. >1.45m above the y=-1.02 floor)
    // are above floor-walking clearance; all floor/skid/waist-level assets are solid floor colliders.
    if (bottomY > 0.42) continue;

    const hx = sx * 0.5;
    const hz = sz * 0.5;

    boxes.push({
      id: a.asset_id,
      tag: a.tag,
      cx: x,
      cz: z,
      minX: x - hx,
      maxX: x + hx,
      minZ: z - hz,
      maxZ: z + hz
    });
  }

  for (const st of STATIC_ROOM_OBSTACLES) {
    const [x, , z] = st.position;
    const [sx, , sz] = st.bbox_size;
    boxes.push({
      id: st.id,
      tag: st.label,
      cx: x,
      cz: z,
      minX: x - sx * 0.5,
      maxX: x + sx * 0.5,
      minZ: z - sz * 0.5,
      maxZ: z + sz * 0.5
    });
  }

  return boxes;
}

/**
 * Checks whether a 2D circle at (x, z) with `radius` overlaps any obstacle AABB.
 */
export function isPointInObstacle(x, z, radius = 0.24, obstacles = null, ignoreId = null) {
  const list = obstacles || buildCollisionBoxes();
  for (const b of list) {
    if (ignoreId && b.id === ignoreId) continue;
    if (
      x > b.minX - radius &&
      x < b.maxX + radius &&
      z > b.minZ - radius &&
      z < b.maxZ + radius
    ) {
      return b;
    }
  }
  return null;
}

/**
 * Resolves circle-vs-AABB collisions for manual WASD walking and path vertices.
 * Pushes (x, z) outside any overlapping equipment bounding box along the minimum penetration axis
 * (enabling smooth sliding along equipment housings and room walls).
 */
export function resolveObstacleCollisions(
  x,
  z,
  radius = 0.25,
  obstacles = null,
  prevX = null,
  prevZ = null
) {
  const list = obstacles || buildCollisionBoxes();
  let nx = Math.max(-5.1, Math.min(5.1, x));
  let nz = Math.max(-1.1, Math.min(3.45, z));

  for (let pass = 0; pass < 5; pass++) {
    let hitAny = false;
    for (const b of list) {
      const minX = b.minX - radius;
      const maxX = b.maxX + radius;
      const minZ = b.minZ - radius;
      const maxZ = b.maxZ + radius;

      if (nx > minX && nx < maxX && nz > minZ && nz < maxZ) {
        hitAny = true;
        const dLeft = nx - minX;
        const dRight = maxX - nx;
        const dFront = nz - minZ;
        const dBack = maxZ - nz;

        const minPen = Math.min(dLeft, dRight, dFront, dBack);
        const eps = 0.008;
        if (minPen === dLeft) nx = minX - eps;
        else if (minPen === dRight) nx = maxX + eps;
        else if (minPen === dFront) nz = minZ - eps;
        else nz = maxZ + eps;
      }
    }
    if (!hitAny) break;
  }

  // If still wedged between two touching boxes and previous valid position is provided, revert axis
  if (prevX !== null && prevZ !== null && isPointInObstacle(nx, nz, radius * 0.85, list)) {
    const tryX = resolveSingleStep(x, prevZ, radius, list);
    if (!isPointInObstacle(tryX[0], tryX[1], radius * 0.85, list)) return tryX;
    const tryZ = resolveSingleStep(prevX, z, radius, list);
    if (!isPointInObstacle(tryZ[0], tryZ[1], radius * 0.85, list)) return tryZ;
    return [prevX, prevZ];
  }

  return [
    Math.max(-5.1, Math.min(5.1, nx)),
    Math.max(-1.1, Math.min(3.45, nz))
  ];
}

function resolveSingleStep(x, z, radius, list) {
  let nx = x;
  let nz = z;
  for (const b of list) {
    const minX = b.minX - radius;
    const maxX = b.maxX + radius;
    const minZ = b.minZ - radius;
    const maxZ = b.maxZ + radius;
    if (nx > minX && nx < maxX && nz > minZ && nz < maxZ) {
      const dLeft = nx - minX;
      const dRight = maxX - nx;
      const dFront = nz - minZ;
      const dBack = maxZ - nz;
      const m = Math.min(dLeft, dRight, dFront, dBack);
      if (m === dLeft) nx = minX - 0.01;
      else if (m === dRight) nx = maxX + 0.01;
      else if (m === dFront) nz = minZ - 0.01;
      else nz = maxZ + 0.01;
    }
  }
  return [nx, nz];
}

/**
 * Liang-Barsky 2D segment vs expanded AABB intersection test
 */
export function segmentIntersectsBox(ax, az, bx, bz, box, margin = 0.20) {
  const minX = box.minX - margin;
  const maxX = box.maxX + margin;
  const minZ = box.minZ - margin;
  const maxZ = box.maxZ + margin;

  const dx = bx - ax;
  const dz = bz - az;

  let t0 = 0;
  let t1 = 1;

  const p = [-dx, dx, -dz, dz];
  const q = [ax - minX, maxX - ax, az - minZ, maxZ - az];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-8) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

/**
 * Open-Aisle Centerline Waypoint Graph (`NAV_NODES`)
 * Every node is positioned in verified unobstructed corridor space.
 */
export const NAV_NODES = [
  // Entry & Tool Crib Hub
  { id: 'N-ENTRY', label: 'Tool Crib & LOTO Entry', pos: [0.00, -1.02, -0.25], clearance: 1.85 },

  // South Main Corridor Rail (z = 0.22 — completely clear across entire room width)
  { id: 'N-S-WEST2', label: 'West Perimeter South', pos: [-4.40, -1.02, 0.22], clearance: 1.50 },
  { id: 'N-S-WEST1', label: 'South-West Feedwater Aisle', pos: [-1.20, -1.02, 0.22], clearance: 1.65 },
  { id: 'N-S-CENTER', label: 'Central Boiler Floor Hub', pos: [0.00, -1.02, 0.22], clearance: 1.80 },
  { id: 'N-S-EAST1', label: 'South-East Pump Aisle', pos: [1.85, -1.02, 0.22], clearance: 1.65 },
  { id: 'N-S-EAST2', label: 'East Perimeter South', pos: [4.42, -1.02, 0.22], clearance: 1.55 },

  // Mid Corridor Rail
  { id: 'N-M-WEST2', label: 'West Perimeter Mid Aisle', pos: [-4.40, -1.02, 1.35], clearance: 1.40 },
  { id: 'N-M-WEST1', label: 'CV-003 East Inspection Aisle', pos: [-1.18, -1.02, 1.15], clearance: 1.45 },
  { id: 'N-M-STEP', label: 'Elevated Catwalk Step (Stairs)', pos: [-0.55, -0.82, 1.15], clearance: 0.78 },
  { id: 'N-M-CENTER', label: 'Central Spine Mid Aisle', pos: [0.15, -1.02, 1.25], clearance: 1.45 },
  { id: 'N-M-EAST1', label: 'Main Pump Skid South Bay', pos: [1.85, -1.02, 1.15], clearance: 1.45 },
  { id: 'N-M-EAST2', label: 'East Perimeter Pump Aisle (P-005)', pos: [4.42, -1.02, 1.85], clearance: 1.45 },

  // North Corridor Rail
  { id: 'N-N-WEST2', label: 'Aux Loop North-West Bay (M-006)', pos: [-1.95, -1.02, 2.08], clearance: 1.35 },
  { id: 'N-N-WEST1', label: 'North-West Valve Aisle (CV-009)', pos: [-1.18, -1.02, 2.35], clearance: 1.40 },
  { id: 'N-N-CENTER', label: 'North Boiler Drum Aisle', pos: [-0.05, -1.02, 2.52], clearance: 1.45 },
  { id: 'N-N-EAST1', label: 'North-East Skid Aisle (P-002)', pos: [1.92, -1.02, 2.56], clearance: 1.45 },
  { id: 'N-N-EAST2', label: 'East Perimeter North Corner', pos: [4.42, -1.02, 2.56], clearance: 1.40 }
];

export const NAV_EDGES = [
  // Entry connections
  { from: 'N-ENTRY', to: 'N-S-CENTER', has_stairs: false, min_width: 2.0, rail_id: 'RAIL-MAIN-ENTRY' },
  { from: 'N-ENTRY', to: 'N-S-WEST1', has_stairs: false, min_width: 1.6, rail_id: 'RAIL-WEST-ENTRY' },
  { from: 'N-ENTRY', to: 'N-S-EAST1', has_stairs: false, min_width: 1.6, rail_id: 'RAIL-EAST-ENTRY' },

  // South Main Corridor (z = 0.22)
  { from: 'N-S-WEST2', to: 'N-S-WEST1', has_stairs: false, min_width: 1.5, rail_id: 'RAIL-SOUTH-1' },
  { from: 'N-S-WEST1', to: 'N-S-CENTER', has_stairs: false, min_width: 1.8, rail_id: 'RAIL-SOUTH-2' },
  { from: 'N-S-CENTER', to: 'N-S-EAST1', has_stairs: false, min_width: 1.8, rail_id: 'RAIL-SOUTH-3' },
  { from: 'N-S-EAST1', to: 'N-S-EAST2', has_stairs: false, min_width: 1.5, rail_id: 'RAIL-SOUTH-4' },

  // South to Mid Cross-Aisles
  { from: 'N-S-WEST2', to: 'N-M-WEST2', has_stairs: false, min_width: 1.4, rail_id: 'RAIL-WEST-OUTER' },
  { from: 'N-S-WEST1', to: 'N-M-WEST1', has_stairs: true, min_width: 0.85, rail_id: 'RAIL-WEST-INNER-STEP' },
  { from: 'N-S-CENTER', to: 'N-M-STEP', has_stairs: true, min_width: 0.75, rail_id: 'RAIL-CATWALK-STAIR' },
  { from: 'N-M-STEP', to: 'N-M-WEST1', has_stairs: true, min_width: 0.75, rail_id: 'RAIL-CATWALK-WEST' },
  { from: 'N-M-STEP', to: 'N-N-CENTER', has_stairs: true, min_width: 0.75, rail_id: 'RAIL-CATWALK-NORTH' },

  { from: 'N-S-CENTER', to: 'N-M-CENTER', has_stairs: false, min_width: 1.5, rail_id: 'RAIL-CENTRAL-SPINE' },
  { from: 'N-S-EAST1', to: 'N-M-EAST1', has_stairs: false, min_width: 1.5, rail_id: 'RAIL-EAST-INNER' },
  { from: 'N-S-EAST2', to: 'N-M-EAST2', has_stairs: false, min_width: 1.5, rail_id: 'RAIL-EAST-OUTER' },

  // Mid Corridor Connections (only where unobstructed!)
  { from: 'N-M-WEST1', to: 'N-M-CENTER', has_stairs: false, min_width: 1.4, rail_id: 'RAIL-MID-CENTER' },

  // Mid to North Connections
  { from: 'N-M-WEST1', to: 'N-N-WEST1', has_stairs: false, min_width: 1.4, rail_id: 'RAIL-NW-INNER' },
  { from: 'N-M-WEST1', to: 'N-N-WEST2', has_stairs: false, min_width: 1.35, rail_id: 'RAIL-NW-POCKET' },
  { from: 'N-M-CENTER', to: 'N-N-CENTER', has_stairs: false, min_width: 1.45, rail_id: 'RAIL-NORTH-SPINE' },
  { from: 'N-M-EAST2', to: 'N-N-EAST2', has_stairs: false, min_width: 1.45, rail_id: 'RAIL-NE-OUTER' },

  // North Corridor Connections
  { from: 'N-N-WEST2', to: 'N-N-WEST1', has_stairs: false, min_width: 1.35, rail_id: 'RAIL-NORTH-1' },
  { from: 'N-N-WEST1', to: 'N-N-CENTER', has_stairs: false, min_width: 1.4, rail_id: 'RAIL-NORTH-2' },
  { from: 'N-N-CENTER', to: 'N-N-EAST1', has_stairs: false, min_width: 1.4, rail_id: 'RAIL-NORTH-3' },
  { from: 'N-N-EAST1', to: 'N-N-EAST2', has_stairs: false, min_width: 1.4, rail_id: 'RAIL-NORTH-4' }
];

export function euclidean3D(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Computes a guaranteed collision-free floor stand-off point for inspecting a target asset or point.
 */
export function computeSafeStandOffPoint(targetPoint3D, obstacles = null) {
  const list = obstacles || buildCollisionBoxes();
  const tx = targetPoint3D[0];
  const tz = targetPoint3D[2];

  // Check if targetPoint3D is near or inside an asset box; generate candidate stand-off positions around it
  const candidates = [
    [tx, tz],
    [tx, tz - 0.55],
    [tx - 0.55, tz],
    [tx + 0.55, tz],
    [tx, tz + 0.55],
    [tx - 0.45, tz - 0.45],
    [tx + 0.45, tz - 0.45]
  ];

  let bestPt = null;
  let bestScore = Infinity;

  for (const [cx, cz] of candidates) {
    const [rx, rz] = resolveObstacleCollisions(cx, cz, 0.30, list);
    // Find nearest navigation node that has unobstructed line-of-sight (or minimal distance)
    let minNodeDist = Infinity;
    for (const n of NAV_NODES) {
      const d = Math.hypot(rx - n.pos[0], rz - n.pos[2]);
      let hits = 0;
      for (const b of list) {
        if (segmentIntersectsBox(n.pos[0], n.pos[2], rx, rz, b, 0.16)) {
          hits++;
        }
      }
      const score = d + hits * 3.5 + Math.hypot(rx - tx, rz - tz) * 0.5;
      if (score < minNodeDist) minNodeDist = score;
    }
    if (minNodeDist < bestScore) {
      bestScore = minNodeDist;
      bestPt = [rx, -1.02, rz];
    }
  }

  return bestPt || [tx, -1.02, tz];
}

export function findNearestNode(point3D, blockedNodeIds = [], obstacles = null) {
  const list = obstacles || buildCollisionBoxes();
  let best = NAV_NODES[0];
  let bestScore = Infinity;
  for (const node of NAV_NODES) {
    if (blockedNodeIds.includes(node.id)) continue;
    const d = euclidean3D(node.pos, point3D);
    // Penalize nodes whose straight line to point3D crosses an equipment bounding box
    let hitCount = 0;
    for (const b of list) {
      if (segmentIntersectsBox(node.pos[0], node.pos[2], point3D[0], point3D[2], b, 0.16)) {
        hitCount++;
      }
    }
    const score = d + hitCount * 4.0;
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

/**
 * Chaikin curve subdivision + obstacle deflection so smoothed trajectories never cut through equipment corners!
 */
export function smoothCenterlinePoints(rawPoints, iterations = 2, obstacles = null) {
  if (!rawPoints || rawPoints.length < 2) return rawPoints || [];
  const list = obstacles || buildCollisionBoxes();

  let pts = rawPoints.map((p) => {
    const [rx, rz] = resolveObstacleCollisions(p[0], p[2], 0.28, list);
    return [rx, p[1], rz];
  });

  if (pts.length >= 3) {
    for (let iter = 0; iter < iterations; iter++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const q = [
          0.75 * p0[0] + 0.25 * p1[0],
          0.75 * p0[1] + 0.25 * p1[1],
          0.75 * p0[2] + 0.25 * p1[2]
        ];
        const r = [
          0.25 * p0[0] + 0.75 * p1[0],
          0.25 * p0[1] + 0.75 * p1[1],
          0.25 * p0[2] + 0.75 * p1[2]
        ];
        const [qx, qz] = resolveObstacleCollisions(q[0], q[2], 0.28, list);
        const [rx, rz] = resolveObstacleCollisions(r[0], r[2], 0.28, list);
        next.push([qx, q[1], qz], [rx, r[1], rz]);
      }
      next.push(pts[pts.length - 1]);
      pts = next;
    }
  }

  return deflectPolylineAroundObstacles(pts, list, 0.28);
}

/**
 * Subdivides any segment that grazes an obstacle and pushes intermediate vertices outside all AABBs
 */
export function deflectPolylineAroundObstacles(points, obstacles, radius = 0.28) {
  if (!points || points.length < 2) return points || [];
  const refined = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(segLen / 0.22));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const mx = a[0] + (b[0] - a[0]) * t;
      const my = a[1] + (b[1] - a[1]) * t;
      const mz = a[2] + (b[2] - a[2]) * t;
      const [rx, rz] = resolveObstacleCollisions(mx, mz, radius, obstacles);
      refined.push([rx, my, rz]);
    }
  }

  return refined;
}

/**
 * Creates a simulated raw "zig-zag" voxel grid path between waypoints while still respecting equipment collisions
 */
export function generateZigZagComparisonPoints(rawPoints, obstacles = null) {
  if (!rawPoints || rawPoints.length < 2) return rawPoints || [];
  const list = obstacles || buildCollisionBoxes();
  const zig = [rawPoints[0]];
  for (let i = 0; i < rawPoints.length - 1; i++) {
    const a = rawPoints[i];
    const b = rawPoints[i + 1];
    const mid1 = [a[0] + (b[0] - a[0]) * 0.5, a[1], a[2] + (i % 2 === 0 ? 0.16 : -0.16)];
    const mid2 = [b[0] + (i % 2 === 0 ? -0.14 : 0.14), b[1], a[2] + (b[2] - a[2]) * 0.65];
    const [m1x, m1z] = resolveObstacleCollisions(mid1[0], mid1[2], 0.28, list);
    const [m2x, m2z] = resolveObstacleCollisions(mid2[0], mid2[2], 0.28, list);
    zig.push([m1x, mid1[1], m1z], [m2x, mid2[1], m2z], b);
  }
  return deflectPolylineAroundObstacles(zig, list, 0.28);
}

/**
 * Computes collision-free A* path along pre-baked Centerline Rails for 'human' or 'robot' profile.
 */
export function computeAStarPath(
  startNodeOrPoint,
  targetPoint3D,
  profile = 'robot',
  hazardNodeIds = [],
  railMode = 'smooth_rail',
  congestionPenaltyMap = null
) {
  const t0 = performance.now();
  const obstacles = buildCollisionBoxes();
  const safeTarget = computeSafeStandOffPoint(targetPoint3D, obstacles);
  const nodeMap = new Map(NAV_NODES.map((n) => [n.id, n]));
  const goalNode = findNearestNode(safeTarget, hazardNodeIds, obstacles);

  const getPenalty = (key) => {
    if (!congestionPenaltyMap || !key) return 0;
    if (congestionPenaltyMap instanceof Map) return congestionPenaltyMap.get(key) || 0;
    return congestionPenaltyMap[key] || 0;
  };

  const customStartPoint = Array.isArray(startNodeOrPoint) ? startNodeOrPoint : null;
  let resolvedStartNode;
  if (customStartPoint) {
    if (customStartPoint[2] < 0.0) {
      // Starting from South Staging Line: step straight North into South Corridor (z = 0.22)
      // and choose the least-congested nearby corridor node (excluding N-ENTRY funnel)
      const corridorPoint = [customStartPoint[0], -1.02, 0.22];
      const southCandidates = NAV_NODES.filter(
        (n) => n.id !== 'N-ENTRY' && n.pos[2] <= 0.35 && !hazardNodeIds.includes(n.id)
      );
      const candidates = southCandidates.length
        ? southCandidates
        : NAV_NODES.filter((n) => n.id !== 'N-ENTRY' && !hazardNodeIds.includes(n.id));
      let bestNode = candidates[0] || NAV_NODES[0];
      let bestScore = Infinity;
      for (const n of candidates) {
        const dStart = euclidean3D(corridorPoint, n.pos);
        const dGoal = euclidean3D(n.pos, goalNode.pos) * 0.35;
        const pen = getPenalty(n.id) * 1.35;
        const score = dStart + dGoal + pen;
        if (score < bestScore) {
          bestScore = score;
          bestNode = n;
        }
      }
      resolvedStartNode = bestNode;
    } else {
      resolvedStartNode = findNearestNode(customStartPoint, hazardNodeIds, obstacles);
    }
  } else {
    resolvedStartNode = nodeMap.get(startNodeOrPoint) || NAV_NODES[0];
  }
  const startNodeId = resolvedStartNode.id;

  const adj = new Map();
  NAV_NODES.forEach((n) => adj.set(n.id, []));

  for (const edge of NAV_EDGES) {
    const u = nodeMap.get(edge.from);
    const v = nodeMap.get(edge.to);
    if (!u || !v) continue;

    if (hazardNodeIds.includes(edge.from) || hazardNodeIds.includes(edge.to)) {
      continue;
    }

    if (profile === 'robot') {
      if (edge.has_stairs) continue;
      if (edge.min_width < 1.1) continue;
    }

    const baseCost = euclidean3D(u.pos, v.pos);
    const clearanceBonus = edge.min_width >= 1.5 ? 0.92 : 1.0;
    const congestionCost =
      (getPenalty(edge.from) + getPenalty(edge.to) + getPenalty(edge.rail_id) * 1.5) * 0.95;
    const weight =
      (profile === 'robot' && edge.min_width < 1.35
        ? baseCost * 1.15
        : baseCost * clearanceBonus) + congestionCost;

    adj.get(edge.from).push({ to: edge.to, cost: weight, edge });
    adj.get(edge.to).push({ to: edge.from, cost: weight, edge });
  }

  const openSet = new Set([startNodeId]);
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  NAV_NODES.forEach((n) => {
    gScore.set(n.id, Infinity);
    fScore.set(n.id, Infinity);
  });

  const startNode = resolvedStartNode;
  gScore.set(startNode.id, 0);
  fScore.set(startNode.id, euclidean3D(startNode.pos, goalNode.pos));

  while (openSet.size > 0) {
    let currentId = null;
    let lowestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        currentId = id;
      }
    }

    if (!currentId) break;
    if (currentId === goalNode.id) {
      const nodeIds = [];
      let curr = currentId;
      while (curr) {
        nodeIds.unshift(curr);
        curr = cameFrom.get(curr);
      }
      const rawWaypoints = nodeIds.map((id) => [...nodeMap.get(id).pos]);
      if (
        customStartPoint &&
        euclidean3D(customStartPoint, rawWaypoints[0]) > 0.15
      ) {
        // Step straight north to z = 0.22 at customStartPoint[0] first so workers leave the line in parallel lanes!
        if (customStartPoint[2] < 0.0 && Math.abs(customStartPoint[0] - rawWaypoints[0][0]) > 0.12) {
          rawWaypoints.unshift([customStartPoint[0], -1.02, 0.22]);
        }
        rawWaypoints.unshift([...customStartPoint]);
      }
      if (euclidean3D(rawWaypoints[rawWaypoints.length - 1], safeTarget) > 0.20) {
        rawWaypoints.push(safeTarget);
      }

      const points =
        railMode === 'zigzag_grid'
          ? generateZigZagComparisonPoints(rawWaypoints, obstacles)
          : smoothCenterlinePoints(rawWaypoints, 2, obstacles);

      let totalDist = 0;
      for (let i = 1; i < points.length; i++) {
        totalDist += euclidean3D(points[i - 1], points[i]);
      }

      const elapsedMs = Math.max(0.4, performance.now() - t0);
      return {
        reachable: true,
        profile,
        railMode,
        nodeIds,
        rawWaypoints,
        points,
        distanceMeters: Number(totalDist.toFixed(2)),
        computeTimeMs: Number(elapsedMs.toFixed(2)),
        usedStairs: nodeIds.includes('N-M-STEP') || (nodeIds.includes('N-S-WEST1') && nodeIds.includes('N-M-WEST1')),
        avoidedHazards: hazardNodeIds.length
      };
    }

    openSet.delete(currentId);
    const neighbors = adj.get(currentId) || [];
    for (const nb of neighbors) {
      let turnPenalty = 0;
      const parentId = cameFrom.get(currentId);
      if (parentId) {
        const pPos = nodeMap.get(parentId).pos;
        const cPos = nodeMap.get(currentId).pos;
        const nPos = nodeMap.get(nb.to).pos;
        const v1x = cPos[0] - pPos[0];
        const v1z = cPos[2] - pPos[2];
        const v2x = nPos[0] - cPos[0];
        const v2z = nPos[2] - cPos[2];
        const dot = (v1x * v2x + v1z * v2z) / ((Math.hypot(v1x, v1z) * Math.hypot(v2x, v2z)) || 1);
        if (dot < 0.7) turnPenalty = 0.28;
      }

      const tentativeG = (gScore.get(currentId) ?? Infinity) + nb.cost + turnPenalty;
      if (tentativeG < (gScore.get(nb.to) ?? Infinity)) {
        cameFrom.set(nb.to, currentId);
        gScore.set(nb.to, tentativeG);
        const nbNode = nodeMap.get(nb.to);
        fScore.set(nb.to, tentativeG + euclidean3D(nbNode.pos, goalNode.pos));
        openSet.add(nb.to);
      }
    }
  }

  return {
    reachable: false,
    profile,
    railMode,
    nodeIds: [startNodeId],
    rawWaypoints: [startNode.pos],
    points: [startNode.pos],
    distanceMeters: 0,
    computeTimeMs: Number((performance.now() - t0).toFixed(2)),
    usedStairs: false,
    avoidedHazards: hazardNodeIds.length
  };
}

/**
 * Initial Fleet Agents for Multi-Robot & Multi-Human Coordination
 */
export const INITIAL_FLEET_AGENTS = [
  {
    agent_id: 'R1',
    name: 'AMR-Unit-01 (West Patrol)',
    role: 'Wheeled AMR',
    type: 'robot',
    color: '#d96b27',
    homeNodeId: 'N-S-WEST1',
    hitboxSize: [0.58, 1.35, 0.58],
    assignedAssetId: 'ASSET-003', // CV-003
    status: 'DISPATCHED'
  },
  {
    agent_id: 'R2',
    name: 'AMR-Unit-02 (East Skid)',
    role: 'Wheeled AMR',
    type: 'robot',
    color: '#49a942',
    homeNodeId: 'N-S-EAST1',
    hitboxSize: [0.58, 1.35, 0.58],
    assignedAssetId: 'ASSET-014', // P-002
    status: 'DISPATCHED'
  },
  {
    agent_id: 'H1',
    name: 'Tech-Lead-01 (Field Ops)',
    role: 'Field Operator',
    type: 'human',
    color: '#1f6fb2',
    homeNodeId: 'N-ENTRY',
    hitboxSize: [0.52, 1.72, 0.46],
    assignedAssetId: 'ASSET-024', // M-006
    status: 'DISPATCHED'
  }
];

/**
 * Multi-Robot & Multi-Human Proximity Dispatcher
 */
export function coordinateMultiAgentFleet(
  fleetAgents,
  assets,
  hazardNodes = [],
  railMode = 'smooth_rail',
  primarySelectedAsset = null
) {
  const emergencyQueue = assets
    .filter((a) => a.health_status === 'attention_required' || a.health_status === 'degraded')
    .sort((a, b) => a.health_score - b.health_score);

  if (
    primarySelectedAsset &&
    !emergencyQueue.some((e) => e.asset_id === primarySelectedAsset.asset_id)
  ) {
    emergencyQueue.unshift(primarySelectedAsset);
  }

  const claimedAssetIds = new Set();
  const assignments = [];
  const remainingAgents = [...fleetAgents];

  while (remainingAgents.length > 0) {
    let bestPair = null;
    let bestDistance = Infinity;

    for (const agent of remainingAgents) {
      const candidateTargets = emergencyQueue.filter((t) => !claimedAssetIds.has(t.asset_id));
      for (const target of candidateTargets) {
        const path = computeAStarPath(
          agent.homeNodeId,
          target.position || target.approach_point,
          agent.type,
          hazardNodes,
          railMode
        );
        if (path.reachable && path.distanceMeters < bestDistance) {
          bestDistance = path.distanceMeters;
          bestPair = { agent, target, path };
        }
      }
    }

    if (bestPair) {
      claimedAssetIds.add(bestPair.target.asset_id);
      const idx = remainingAgents.findIndex((a) => a.agent_id === bestPair.agent.agent_id);
      remainingAgents.splice(idx, 1);
      assignments.push({
        ...bestPair.agent,
        targetAsset: bestPair.target,
        path: bestPair.path,
        conflictFree: true
      });
    } else {
      const agent = remainingAgents.shift();
      const fallbackTarget = primarySelectedAsset || assets[0];
      const path = computeAStarPath(
        agent.homeNodeId,
        fallbackTarget.position || fallbackTarget.approach_point,
        agent.type,
        hazardNodes,
        railMode
      );
      assignments.push({
        ...agent,
        targetAsset: fallbackTarget,
        path,
        conflictFree: true
      });
    }
  }

  const order = { R1: 0, R2: 1, H1: 2 };
  assignments.sort((a, b) => (order[a.agent_id] ?? 9) - (order[b.agent_id] ?? 9));
  return assignments;
}

/**
 * Samples position and smoothed forward heading vector along a 3D rail polyline at normalized progress t in [0, 1]
 */
export function samplePathAtProgress(points, progress) {
  if (!points || points.length === 0) {
    return { position: [0, -1.02, 0], tangent: [0, 0, 1] };
  }
  if (points.length === 1) {
    return { position: [...points[0]], tangent: [0, 0, 1] };
  }

  const clamped = Math.max(0, Math.min(1, progress));
  const segLengths = [];
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const d = euclidean3D(points[i - 1], points[i]);
    segLengths.push(d);
    totalLen += d;
  }

  if (totalLen < 1e-5) {
    return { position: [...points[0]], tangent: [0, 0, 1] };
  }

  const targetDist = clamped * totalLen;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (acc + segLen >= targetDist || i === segLengths.length - 1) {
      const localT = segLen > 1e-5 ? (targetDist - acc) / segLen : 0;
      const p0 = points[i];
      const p1 = points[i + 1];
      const pos = [
        p0[0] + (p1[0] - p0[0]) * localT,
        p0[1] + (p1[1] - p0[1]) * localT,
        p0[2] + (p1[2] - p0[2]) * localT
      ];

      const nextIdx = Math.min(points.length - 1, i + 2);
      const pLook = points[nextIdx];
      const dx = (p1[0] - p0[0]) * (1 - localT * 0.4) + (pLook[0] - p0[0]) * (localT * 0.4);
      const dz = (p1[2] - p0[2]) * (1 - localT * 0.4) + (pLook[2] - p0[2]) * (localT * 0.4);
      const lenXZ = Math.hypot(dx, dz) || 1;
      return {
        position: pos,
        tangent: [dx / lenXZ, 0, dz / lenXZ]
      };
    }
    acc += segLen;
  }

  return { position: [...points[points.length - 1]], tangent: [0, 0, 1] };
}
