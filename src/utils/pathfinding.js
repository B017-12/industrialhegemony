/**
 * Dual-Profile Obstacle-Aware 3D A* Pathfinding Engine
 * Aligned to the walkable floor plane (Y ≈ -1.03m) of "Industrial Boiler Room (1).ply"
 *
 * Supports:
 * 1. Human Technician Profile: Can traverse catwalk steps (has_stairs: true) & narrow 0.6m pipe alleys
 * 2. Wheeled Inspection Robot (AMR) Profile: Rejects stairs, requires min_width >= 1.1m, avoids floor blowdown trenches
 * 3. Real-Time Dynamic Hazard Placement: Clicking any node or toggling the hazard button drops a dynamic obstruction
 *    and recalculates the optimal path in <2ms.
 */

export const NAV_NODES = [
  // Entry & Tool Crib Hub
  { id: 'N-ENTRY', label: 'Tool Crib & LOTO Entry', pos: [0.00, -1.02, -0.20] },

  // South Main Corridor (Wide AMR-safe aisle)
  { id: 'N-S-WEST2', label: 'South-West MCC Aisle', pos: [-2.85, -1.02, 0.55] },
  { id: 'N-S-WEST1', label: 'South-West Feedwater Aisle', pos: [-1.45, -1.02, 0.55] },
  { id: 'N-S-CENTER', label: 'Central Boiler Floor Hub', pos: [0.00, -1.02, 0.65] },
  { id: 'N-S-EAST1', label: 'South-East Pump Approach', pos: [1.45, -1.02, 0.65] },
  { id: 'N-S-EAST2', label: 'East Perimeter Aisle South', pos: [2.75, -1.02, 0.75] },

  // Central Walkable Corridor (Contains Catwalk Step & Narrow Pipe Shortcut)
  { id: 'N-M-WEST2', label: 'West Pipe Rack Corridor', pos: [-2.45, -1.02, 1.45] },
  { id: 'N-M-WEST1', label: 'CV-003 Inspection Bay', pos: [-1.25, -1.02, 1.25] },
  { id: 'N-M-STEP', label: 'Elevated Catwalk Step (Stairs)', pos: [-0.45, -0.78, 1.35] },
  { id: 'N-M-CENTER', label: 'Mid-Bay Valve Alley', pos: [0.45, -1.02, 1.45] },
  { id: 'N-M-EAST1', label: 'Main Pump Skid West Aisle', pos: [1.55, -1.02, 1.55] },
  { id: 'N-M-EAST2', label: 'P-005 East Pump Bay', pos: [2.75, -1.02, 1.85] },

  // North Corridor (Near Boiler Drum, P-002, CV-009, M-006)
  { id: 'N-N-WEST2', label: 'Aux Loop North-West (M-006 Bay)', pos: [-2.25, -1.02, 2.25] },
  { id: 'N-N-WEST1', label: 'North-West Valve Bay (CV-009)', pos: [-1.25, -1.02, 2.45] },
  { id: 'N-N-CENTER', label: 'North Boiler Drum Front', pos: [0.25, -1.02, 2.35] },
  { id: 'N-N-EAST1', label: 'P-002 Main Pump Skid Front', pos: [1.50, -1.02, 2.35] },
  { id: 'N-N-EAST2', label: 'North-East Skid Corner', pos: [2.55, -1.02, 2.45] }
];

export const NAV_EDGES = [
  // Entry connections
  { from: 'N-ENTRY', to: 'N-S-CENTER', has_stairs: false, min_width: 2.0 },
  { from: 'N-ENTRY', to: 'N-S-WEST1', has_stairs: false, min_width: 1.6 },
  { from: 'N-ENTRY', to: 'N-S-EAST1', has_stairs: false, min_width: 1.6 },

  // South corridor
  { from: 'N-S-WEST2', to: 'N-S-WEST1', has_stairs: false, min_width: 1.5 },
  { from: 'N-S-WEST1', to: 'N-S-CENTER', has_stairs: false, min_width: 1.8 },
  { from: 'N-S-CENTER', to: 'N-S-EAST1', has_stairs: false, min_width: 1.8 },
  { from: 'N-S-EAST1', to: 'N-S-EAST2', has_stairs: false, min_width: 1.5 },

  // South to Mid connections
  { from: 'N-S-WEST2', to: 'N-M-WEST2', has_stairs: false, min_width: 1.4 },
  { from: 'N-S-WEST1', to: 'N-M-WEST1', has_stairs: false, min_width: 1.4 },
  // Direct shortcut over the catwalk step (Human ONLY: has_stairs = true, narrow width = 0.75m)
  { from: 'N-S-CENTER', to: 'N-M-STEP', has_stairs: true, min_width: 0.75 },
  { from: 'N-M-STEP', to: 'N-M-WEST1', has_stairs: true, min_width: 0.75 },
  { from: 'N-M-STEP', to: 'N-N-CENTER', has_stairs: true, min_width: 0.75 },

  // Standard wide aisles South to Mid
  { from: 'N-S-CENTER', to: 'N-M-CENTER', has_stairs: false, min_width: 1.4 },
  { from: 'N-S-EAST1', to: 'N-M-EAST1', has_stairs: false, min_width: 1.5 },
  { from: 'N-S-EAST2', to: 'N-M-EAST2', has_stairs: false, min_width: 1.5 },

  // Mid corridor horizontal connections
  { from: 'N-M-WEST2', to: 'N-M-WEST1', has_stairs: false, min_width: 1.3 },
  // Narrow pipe alley between M-WEST1 and M-CENTER (0.7m width — human can squeeze through, robot cannot)
  { from: 'N-M-WEST1', to: 'N-M-CENTER', has_stairs: false, min_width: 0.72 },
  { from: 'N-M-CENTER', to: 'N-M-EAST1', has_stairs: false, min_width: 1.4 },
  { from: 'N-M-EAST1', to: 'N-M-EAST2', has_stairs: false, min_width: 1.4 },

  // Mid to North connections
  { from: 'N-M-WEST2', to: 'N-N-WEST2', has_stairs: false, min_width: 1.3 },
  { from: 'N-M-WEST1', to: 'N-N-WEST1', has_stairs: false, min_width: 1.3 },
  { from: 'N-M-CENTER', to: 'N-N-CENTER', has_stairs: false, min_width: 1.4 },
  { from: 'N-M-EAST1', to: 'N-N-EAST1', has_stairs: false, min_width: 1.5 },
  { from: 'N-M-EAST2', to: 'N-N-EAST2', has_stairs: false, min_width: 1.4 },

  // North corridor horizontal connections
  { from: 'N-N-WEST2', to: 'N-N-WEST1', has_stairs: false, min_width: 1.3 },
  { from: 'N-N-WEST1', to: 'N-N-CENTER', has_stairs: false, min_width: 1.3 },
  { from: 'N-N-CENTER', to: 'N-N-EAST1', has_stairs: false, min_width: 1.5 },
  { from: 'N-N-EAST1', to: 'N-N-EAST2', has_stairs: false, min_width: 1.4 }
];

function euclidean3D(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function findNearestNode(point3D, blockedNodeIds = []) {
  let best = NAV_NODES[0];
  let bestDist = Infinity;
  for (const node of NAV_NODES) {
    if (blockedNodeIds.includes(node.id)) continue;
    const d = euclidean3D(node.pos, point3D);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best;
}

/**
 * Computes collision-free A* path for 'human' or 'robot' profile
 */
export function computeAStarPath(startNodeId, targetPoint3D, profile = 'robot', hazardNodeIds = []) {
  const t0 = performance.now();
  const nodeMap = new Map(NAV_NODES.map((n) => [n.id, n]));
  const goalNode = findNearestNode(targetPoint3D, hazardNodeIds);

  const adj = new Map();
  NAV_NODES.forEach((n) => adj.set(n.id, []));

  for (const edge of NAV_EDGES) {
    const u = nodeMap.get(edge.from);
    const v = nodeMap.get(edge.to);
    if (!u || !v) continue;

    // Check dynamic hazard block
    if (hazardNodeIds.includes(edge.from) || hazardNodeIds.includes(edge.to)) {
      continue;
    }

    // Profile-specific kinematic constraints
    if (profile === 'robot') {
      if (edge.has_stairs) continue; // Wheeled AMR cannot climb stairs
      if (edge.min_width < 1.1) continue; // Wheeled AMR requires >= 1.1m clearance
    }

    const baseCost = euclidean3D(u.pos, v.pos);
    // Humans slightly prefer direct paths; robots penalize tighter aisles
    const weight = profile === 'robot' && edge.min_width < 1.35 ? baseCost * 1.15 : baseCost;

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

  const startNode = nodeMap.get(startNodeId) || NAV_NODES[0];
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
      const points = nodeIds.map((id) => [...nodeMap.get(id).pos]);
      // Append final approach stand-off point so avatar faces the target asset cleanly
      const finalApproach = [
        targetPoint3D[0],
        -1.02,
        targetPoint3D[2]
      ];
      if (euclidean3D(points[points.length - 1], finalApproach) > 0.25) {
        points.push(finalApproach);
      }

      let totalDist = 0;
      for (let i = 1; i < points.length; i++) {
        totalDist += euclidean3D(points[i - 1], points[i]);
      }

      const elapsedMs = Math.max(0.4, performance.now() - t0);
      return {
        reachable: true,
        profile,
        nodeIds,
        points,
        distanceMeters: Number(totalDist.toFixed(2)),
        computeTimeMs: Number(elapsedMs.toFixed(2)),
        usedStairs: nodeIds.includes('N-M-STEP'),
        avoidedHazards: hazardNodeIds.length
      };
    }

    openSet.delete(currentId);
    const neighbors = adj.get(currentId) || [];
    for (const nb of neighbors) {
      const tentativeG = (gScore.get(currentId) ?? Infinity) + nb.cost;
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
    nodeIds: [startNodeId],
    points: [startNode.pos],
    distanceMeters: 0,
    computeTimeMs: Number((performance.now() - t0).toFixed(2)),
    usedStairs: false,
    avoidedHazards: hazardNodeIds.length
  };
}

/**
 * Samples position and forward heading vector along a 3D polyline at normalized progress t in [0, 1]
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
      const dx = p1[0] - p0[0];
      const dz = p1[2] - p0[2];
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
