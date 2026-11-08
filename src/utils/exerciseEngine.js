/**
 * Simulation Exercise Engine:
 * - Staging Lineup at South Station
 * - Worker Lifecycle State Machine (STANDBY -> WALKING_TO_FAULT -> REPAIRING -> RETURNING -> STANDBY)
 * - Intelligent Multi-Worker Traffic Management (Right-hand lane offset, priority yielding, mutual separation)
 * - Dynamic Worker Addition & Deletion
 */

import {
  NAV_NODES,
  FRONT_ENTRY_SLOTS,
  FRONT_ENTRY_YAW,
  computeAStarPath,
  resolveObstacleCollisions,
  samplePathAtProgress,
  euclidean3D
} from './pathfinding.js';

const WORKER_PALETTE = [
  '#1f6fb2', // Industrial Blue
  '#d96b27', // Safety Orange
  '#49a942', // Valmet Green
  '#7c4dff', // Deep Violet
  '#00838f', // Teal
  '#ad1457', // Crimson Berry
  '#5d4037', // Bronze
  '#455a64'  // Slate Steel
];

/**
 * Computes the [x, y, z] position for a worker slot at the Front Entrance (`front_entry` from ahmad_branch).
 */
export function computeStagingSlotPosition(index, totalCount) {
  if (index < FRONT_ENTRY_SLOTS.length) {
    return [...FRONT_ENTRY_SLOTS[index]];
  }
  const extraIdx = index - FRONT_ENTRY_SLOTS.length + 1;
  const lastSlot = FRONT_ENTRY_SLOTS[FRONT_ENTRY_SLOTS.length - 1];
  return [
    Number((lastSlot[0] - extraIdx * 0.35).toFixed(3)),
    -1.02,
    Number((lastSlot[2] + extraIdx * 0.25).toFixed(3))
  ];
}

/**
 * Creates the initial lineup of workers standing at the Front Entrance (`front_entry`).
 */
export function createInitialExerciseWorkers(count = 4) {
  const specs = [
    { id: 'W-01', name: 'J. Korhonen', role: 'Field Technician', type: 'human' },
    { id: 'W-02', name: 'A. Nieminen', role: 'Instrument Tech', type: 'human' },
    { id: 'R-01', name: 'AMR-Unit-01', role: 'Autonomous Robot', type: 'robot' },
    { id: 'W-03', name: 'S. Laine', role: 'Mechanical Tech', type: 'human' }
  ];

  const list = specs.slice(0, count).map((s, idx) => {
    const slotPos = computeStagingSlotPosition(idx, count);
    const color = WORKER_PALETTE[idx % WORKER_PALETTE.length];
    return {
      ...s,
      color,
      colorHex: parseInt(color.replace('#', ''), 16),
      slotIndex: idx,
      slotPos,
      pos: [...slotPos],
      position: [...slotPos],
      angle: FRONT_ENTRY_YAW, // Facing into the equipment room from front_entry
      state: 'STANDBY', // 'STANDBY' | 'WALKING_TO_FAULT' | 'REPAIRING' | 'RETURNING'
      trafficStatus: 'CLEAR', // 'CLEAR' | 'YIELDING' | 'PASSING_RIGHT'
      targetAssetId: null,
      targetTag: null,
      pathPoints: [],
      outboundPathPoints: [],
      pathProgress: 0,
      pathLength: 0,
      repairProgress: 0
    };
  });

  return list;
}

/**
 * Re-computes staging line slot positions whenever workers are added or deleted.
 */
export function rebalanceStagingLine(workers) {
  const total = workers.length;
  return workers.map((w, idx) => {
    const slotPos = computeStagingSlotPosition(idx, total);
    const updated = {
      ...w,
      slotIndex: idx,
      slotPos
    };
    if (w.state === 'STANDBY') {
      updated.pos = [...slotPos];
      updated.position = [...slotPos];
      updated.angle = FRONT_ENTRY_YAW;
    }
    return updated;
  });
}

/**
 * Adds a new worker (Human Technician or Wheeled AMR) to the staging line.
 */
export function addExerciseWorker(workers, type = 'human') {
  const isRobot = type === 'robot';
  const prefix = isRobot ? 'R-' : 'W-';
  let num = 1;
  while (workers.some((w) => w.id === `${prefix}${String(num).padStart(2, '0')}`)) {
    num++;
  }
  const id = `${prefix}${String(num).padStart(2, '0')}`;
  const humanNames = ['M. Heikkinen', 'T. Koskinen', 'L. Jarvinen', 'K. Lehtonen', 'P. Salminen', 'E. Tuominen'];
  const name = isRobot
    ? `AMR-Unit-${String(num).padStart(2, '0')}`
    : humanNames[(num - 1) % humanNames.length];
  const role = isRobot ? 'Autonomous Robot' : 'Field Technician';

  const nextTotal = workers.length + 1;
  const slotPos = computeStagingSlotPosition(workers.length, nextTotal);
  const color = WORKER_PALETTE[workers.length % WORKER_PALETTE.length];

  const newWorker = {
    id,
    name,
    role,
    type,
    color,
    colorHex: parseInt(color.replace('#', ''), 16),
    slotIndex: workers.length,
    slotPos,
    pos: [...slotPos],
    position: [...slotPos],
    angle: 0,
    state: 'STANDBY',
    trafficStatus: 'CLEAR',
    targetAssetId: null,
    targetTag: null,
    pathPoints: [],
    pathProgress: 0,
    pathLength: 0,
    repairProgress: 0
  };

  return rebalanceStagingLine([...workers, newWorker]);
}

/**
 * Removes a worker by ID and re-centers the staging line.
 */
export function removeExerciseWorker(workers, workerId) {
  const filtered = workers.filter((w) => w.id !== workerId);
  return rebalanceStagingLine(filtered);
}

/**
 * Builds a node congestion map counting how many other active workers have reserved each waypoint node.
 * Used by computeAStarPath to load-balance simultaneous outbound/returning workers across parallel aisles.
 */
export function buildCongestionPenaltyMap(workers = [], excludeWorkerId = null) {
  const penaltyMap = {};
  for (const w of workers) {
    if (!w || w.id === excludeWorkerId) continue;
    if (w.state !== 'WALKING_TO_FAULT' && w.state !== 'RETURNING') continue;
    if (Array.isArray(w.nodeIds)) {
      for (const nodeId of w.nodeIds) {
        penaltyMap[nodeId] = (penaltyMap[nodeId] || 0) + 1;
      }
    }
  }
  return penaltyMap;
}

/**
 * Computes which floor waypoint nodes (NAV_NODES) are currently locked/occupied by an active worker.
 * Returns a Map<nodeId, workerId> for intersection block signaling.
 */
export function computeLockedIntersectionNodes(workers = []) {
  const lockedBy = new Map();
  for (const node of NAV_NODES) {
    let bestWorker = null;
    let bestScore = -Infinity;

    for (const w of workers) {
      if (!w || (w.state !== 'WALKING_TO_FAULT' && w.state !== 'RETURNING')) continue;
      const dx = node.pos[0] - w.pos[0];
      const dz = node.pos[2] - w.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 0.72) continue;

      const sample = w.pathPoints?.length ? samplePathAtProgress(w.pathPoints, w.pathProgress || 0) : null;
      const fwdX = sample ? sample.tangent[0] : Math.sin(w.angle || 0);
      const fwdZ = sample ? sample.tangent[2] : Math.cos(w.angle || 0);
      const toNodeDot = dist > 1e-4 ? (dx / dist) * fwdX + (dz / dist) * fwdZ : 1;

      // Worker locks the node only while actively crossing its core (<0.28m) or approaching it (toNodeDot > 0.15)
      if (dist < 0.28 || (toNodeDot > 0.15 && w.trafficStatus !== 'YIELDING')) {
        const stateBonus = w.state === 'WALKING_TO_FAULT' ? 2.0 : 0.5;
        const slotTieBreak = (10 - (w.slotIndex || 0)) * 0.02;
        const score = (1.0 - dist) * 4.0 + stateBonus + slotTieBreak;
        if (score > bestScore) {
          bestScore = score;
          bestWorker = w;
        }
      }
    }

    if (bestWorker) {
      lockedBy.set(node.id, bestWorker.id);
    }
  }
  return lockedBy;
}

const REPAIR_REACH_M = 1.08;

/**
 * True when the worker stands close enough (X-Z) to the asset or its approach point to repair it without walking.
 */
export function isWithinRepairReach(worker, asset) {
  const pos = worker?.pos || worker?.position;
  if (!pos || !asset?.position) return false;
  const app = asset.approach_point || asset.position;
  const dApp = Math.hypot(app[0] - pos[0], app[2] - pos[2]);
  const dObj = Math.hypot(asset.position[0] - pos[0], asset.position[2] - pos[2]);
  return Math.min(dApp, dObj) <= REPAIR_REACH_M;
}

/**
 * Assigns a specific worker to walk to and repair a faulted asset using slot-aware entry routing
 * and congestion-aware A* load balancing. A worker already within reach starts repairing on the spot.
 */
export function assignWorkerToAsset(workers, workerId, asset, hazardNodes = [], railMode = 'smooth_rail') {
  // Unlocated assets only have placeholder coordinates, so there is nowhere to walk to
  if (!asset || asset.located === false) return workers;

  const congestionMap = buildCongestionPenaltyMap(workers, workerId);

  return workers.map((w) => {
    if (w.id !== workerId) return w;

    const stayOnSite = Boolean(w.manualControl || w.stayOnSite);

    if (isWithinRepairReach(w, asset)) {
      return {
        ...w,
        manualControl: false,
        stayOnSite,
        state: 'REPAIRING',
        trafficStatus: 'CLEAR',
        blockingUnitId: null,
        lockedNodeId: null,
        lateralOffset: 0,
        targetAssetId: asset.asset_id,
        targetTag: asset.tag,
        angle: Math.atan2(asset.position[0] - w.pos[0], asset.position[2] - w.pos[2]),
        nodeIds: [],
        pathPoints: [],
        outboundPathPoints: [],
        pathProgress: 0,
        pathLength: 0,
        repairProgress: w.targetAssetId === asset.asset_id ? w.repairProgress || 0 : 0,
        lastRepairedAssetId: null
      };
    }

    const targetPt = asset.approach_point || asset.position;
    const path = computeAStarPath(
      w.pos,
      targetPt,
      w.type,
      hazardNodes,
      railMode,
      congestionMap
    );

    const pts = path.points?.length ? [[...w.pos], ...path.points.slice(1)] : [[...w.pos], [...targetPt]];
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += euclidean3D(pts[i - 1], pts[i]);
    }

    return {
      ...w,
      manualControl: false,
      stayOnSite,
      lastRepairedAssetId: null,
      state: 'WALKING_TO_FAULT',
      trafficStatus: 'CLEAR',
      blockingUnitId: null,
      lockedNodeId: null,
      lateralOffset: w.lateralOffset || 0,
      targetAssetId: asset.asset_id,
      targetTag: asset.tag,
      nodeIds: path.nodeIds || [],
      pathPoints: pts,
      outboundPathPoints: pts,
      pathProgress: 0,
      pathLength: Math.max(0.5, len),
      repairProgress: 0
    };
  });
}

/**
 * Advances all workers by `dt` seconds with 4-Layer Fleet Traffic Management:
 * - Layer 1: Slot-aware entry & congestion-aware A* load balancing
 * - Layer 2: Intersection Block Signaling (waypoint mutex locks) & same-direction queue spacing
 * - Layer 3: Persistent lateral corridor sub-lanes & smooth passing offsets
 * - Layer 4: Locked intersection node telemetry for 3D Red/Green floor signals
 */
export function stepExerciseSimulation(
  workers,
  assets,
  dt,
  obstacles,
  hazardNodes = [],
  railMode = 'smooth_rail',
  autoDispatch = false
) {
  const completedAssetIds = [];
  let nextWorkers = workers.map((w) => ({ ...w }));

  // 1. Optional Auto-Dispatch: pair idle STANDBY workers with unassigned faulted assets
  if (autoDispatch) {
    const faultedAssets = (assets || []).filter(
      (a) => a.health_status === 'attention_required' || a.health_status === 'degraded'
    );
    for (const faultAsset of faultedAssets) {
      const alreadyAssigned = nextWorkers.some(
        (w) =>
          w.targetAssetId === faultAsset.asset_id &&
          (w.state === 'WALKING_TO_FAULT' || w.state === 'REPAIRING')
      );
      if (!alreadyAssigned) {
        const idleWorker = nextWorkers.find((w) => w.state === 'STANDBY' && !w.manualControl);
        if (idleWorker) {
          nextWorkers = assignWorkerToAsset(
            nextWorkers,
            idleWorker.id,
            faultAsset,
            hazardNodes,
            railMode
          );
        }
      }
    }
  }

  // 2. Compute Intersection Block Reservations across all floor waypoint nodes
  const lockedNodesMap = computeLockedIntersectionNodes(nextWorkers);

  // 3. Step each worker state machine + apply 4-Layer Traffic Control
  const walkSpeedMetersPerSec = 1.65;

  for (let i = 0; i < nextWorkers.length; i++) {
    const w = nextWorkers[i];

    // If user is manually driving this technician (W/A/S/D or Touch D-Pad), preserve manual pose & allow proximity repair
    if (w.manualControl) {
      w.position = [...(w.pos || w.position || w.slotPos)];
      w.pos = [...w.position];
      w.trafficStatus = 'CLEAR';
      w.blockingUnitId = null;
      w.lockedNodeId = null;

      // A just-finished asset stays "faulted" until the App applies the restore; don't restart its repair at 0%
      if (w.lastRepairedAssetId) {
        const lastAsset = (assets || []).find((a) => a.asset_id === w.lastRepairedAssetId);
        const lastStillFaulted =
          lastAsset &&
          (lastAsset.health_status === 'attention_required' || lastAsset.health_status === 'degraded');
        if (!lastAsset || !isWithinRepairReach(w, lastAsset) || !lastStillFaulted) {
          w.lastRepairedAssetId = null;
        }
      }

      // Check if manually driven technician is standing next to a faulted asset
      const nearFault = (assets || []).find((a) => {
        if (a.health_status !== 'attention_required' && a.health_status !== 'degraded') return false;
        if (a.asset_id === w.lastRepairedAssetId) return false;
        return isWithinRepairReach(w, a);
      });

      if (nearFault) {
        w.state = 'REPAIRING';
        w.targetAssetId = nearFault.asset_id;
        w.targetTag = nearFault.tag;
        w.repairProgress = Math.min(100, (w.repairProgress || 0) + dt * 28);
        if (w.repairProgress >= 100) {
          completedAssetIds.push(nearFault.asset_id);
          w.lastRepairedAssetId = nearFault.asset_id;
          w.repairProgress = 0;
          w.state = 'STANDBY';
          w.targetAssetId = null;
          w.targetTag = null;
        }
      } else {
        w.state = 'STANDBY';
        w.targetAssetId = null;
        w.targetTag = null;
        w.repairProgress = 0;
      }
      continue;
    }

    if (w.state === 'STANDBY') {
      w.pos = [...w.slotPos];
      w.position = [...w.slotPos];
      w.angle = FRONT_ENTRY_YAW;
      w.trafficStatus = 'CLEAR';
      w.blockingUnitId = null;
      w.lockedNodeId = null;
      w.lateralOffset = 0;
      continue;
    }

    if (w.state === 'REPAIRING') {
      w.trafficStatus = 'CLEAR';
      w.blockingUnitId = null;
      w.lockedNodeId = null;
      w.position = [...w.pos];
      const targetAsset = (assets || []).find((a) => a.asset_id === w.targetAssetId);
      if (targetAsset) {
        // Face toward the equipment being repaired
        const dx = targetAsset.position[0] - w.pos[0];
        const dz = targetAsset.position[2] - w.pos[2];
        w.angle = Math.atan2(dx, dz);
      }

      // 5.0 seconds to complete repair (20% per second)
      w.repairProgress = Math.min(100, w.repairProgress + dt * 20);

      if (w.repairProgress >= 100) {
        if (w.targetAssetId) {
          completedAssetIds.push(w.targetAssetId);
        }
        if (w.stayOnSite) {
          // Manually driven technician: stay at the asset and hand control back to the user
          w.lastRepairedAssetId = w.targetAssetId;
          w.state = 'STANDBY';
          w.manualControl = true;
          w.stayOnSite = false;
          w.targetAssetId = null;
          w.targetTag = null;
          w.nodeIds = [];
          w.pathPoints = [];
          w.outboundPathPoints = [];
          w.pathProgress = 0;
          w.repairProgress = 0;
          continue;
        }
        // Return along the exact reversed ESDF path back to the worker's Front Entrance slot (`w.slotPos`)
        const revPts =
          w.outboundPathPoints && w.outboundPathPoints.length >= 2
            ? [...w.outboundPathPoints].reverse()
            : [[...w.pos], [...w.slotPos]];
        revPts[0] = [...w.pos];
        revPts[revPts.length - 1] = [...w.slotPos];

        let rLen = 0;
        for (let k = 1; k < revPts.length; k++) {
          rLen += euclidean3D(revPts[k - 1], revPts[k]);
        }

        w.state = 'RETURNING';
        w.targetAssetId = null;
        w.targetTag = null;
        w.nodeIds = w.nodeIds ? [...w.nodeIds].reverse() : [];
        w.pathPoints = revPts;
        w.pathProgress = 0;
        w.pathLength = Math.max(0.5, rLen);
        w.repairProgress = 0;
      }
      continue;
    }

    // Worker is WALKING_TO_FAULT or RETURNING
    if (w.state === 'WALKING_TO_FAULT' || w.state === 'RETURNING') {
      const sampleNow = samplePathAtProgress(w.pathPoints, w.pathProgress);
      const fwdX = sampleNow.tangent[0];
      const fwdZ = sampleNow.tangent[2];
      // Right-hand perpendicular vector in X-Z plane
      const rightX = -fwdZ;
      const rightZ = fwdX;

      let speedFactor = 1.0;
      let targetLateralShift = 0;
      let repulseX = 0;
      let repulseZ = 0;
      w.trafficStatus = 'CLEAR';
      w.blockingUnitId = null;
      w.lockedNodeId = null;

      // Check if this worker holds or is yielding at an intersection node block
      for (const node of NAV_NODES) {
        const holderId = lockedNodesMap.get(node.id);
        if (!holderId) continue;
        if (holderId === w.id) {
          w.lockedNodeId = node.id;
          continue;
        }
        const holder = nextWorkers.find((u) => u.id === holderId);
        if (!holder || holder.trafficStatus === 'YIELDING') continue;

        const ndx = node.pos[0] - w.pos[0];
        const ndz = node.pos[2] - w.pos[2];
        const ndist = Math.hypot(ndx, ndz);
        if (ndist > 0.22 && ndist < 0.92) {
          const toNodeDot = (ndx / ndist) * fwdX + (ndz / ndist) * fwdZ;
          // Approaching an intersection node already locked by another moving worker
          if (toNodeDot > 0.30) {
            speedFactor = 0;
            w.trafficStatus = 'YIELDING';
            w.blockingUnitId = holderId;
          }
        }
      }

      // Check pairwise worker-to-worker interactions (outbound queue, merging, head-on passing)
      for (let j = 0; j < nextWorkers.length; j++) {
        if (i === j) continue;
        const other = nextWorkers[j];
        if (other.blockingUnitId === w.id) continue;

        // Standby workers are parked in their dedicated staging slots; never block active corridor traffic
        if (other.state === 'STANDBY') {
          continue;
        }

        const dx = other.pos[0] - w.pos[0];
        const dz = other.pos[2] - w.pos[2];
        const dist = Math.hypot(dx, dz);

        if (dist < 1.25 && dist > 1e-4) {
          const dirX = dx / dist;
          const dirZ = dz / dist;
          // > 0 means `other` is in front of `w`
          const forwardDot = dirX * fwdX + dirZ * fwdZ;

          let otherFwdX = Math.sin(other.angle || 0);
          let otherFwdZ = Math.cos(other.angle || 0);
          if (
            (other.state === 'WALKING_TO_FAULT' || other.state === 'RETURNING') &&
            other.pathPoints?.length
          ) {
            const otherSample = samplePathAtProgress(other.pathPoints, other.pathProgress || 0);
            otherFwdX = otherSample.tangent[0];
            otherFwdZ = otherSample.tangent[2];
          }

          // > 0 means `w` is in front of `other`
          const otherForwardDot = (-dirX) * otherFwdX + (-dirZ) * otherFwdZ;
          // < 0 means head-on / opposite direction; > 0 means same / converging direction
          const headingDot = fwdX * otherFwdX + fwdZ * otherFwdZ;

          const wPriority = (w.state === 'WALKING_TO_FAULT' ? 100 : 50) - (w.slotIndex || 0);
          const otherPriority =
            (other.state === 'REPAIRING' ? 200 : other.state === 'WALKING_TO_FAULT' ? 100 : 50) -
            (other.slotIndex || 0);

          if (other.state === 'REPAIRING') {
            // Stationary worker repairing equipment: steer around them in right-hand lane unless very close to same target
            if (forwardDot > 0.1 && dist < 1.05) {
              if (w.targetAssetId === other.targetAssetId && dist < 0.72) {
                speedFactor = 0;
                w.trafficStatus = 'YIELDING';
                w.blockingUnitId = other.id;
              } else {
                targetLateralShift = 0.26;
                speedFactor = Math.min(speedFactor, 0.76);
                if (w.trafficStatus !== 'YIELDING') {
                  w.trafficStatus = 'PASSING_RIGHT';
                }
              }
            }
          } else if (headingDot < -0.22 && forwardDot > -0.15) {
            // Head-on / opposite traffic: both shift to their right-hand sub-lane (+0.28 m)
            targetLateralShift = 0.28;
            speedFactor = Math.min(speedFactor, 0.78);
            if (w.trafficStatus !== 'YIELDING') {
              w.trafficStatus = 'PASSING_RIGHT';
            }
            // In narrow pinch points or corners, lower-priority worker holds until oncoming unit clears
            if (dist < 0.82 && wPriority < otherPriority && forwardDot > 0.08) {
              speedFactor = 0;
              w.trafficStatus = 'YIELDING';
              w.blockingUnitId = other.id;
            }
          } else if (forwardDot > 0.18) {
            // Same-direction following OR diagonal intersection merge (`headingDot >= -0.22`)
            const isFollowingLead = otherForwardDot <= 0.15;
            const losesMergeTie = otherForwardDot > 0.15 && wPriority < otherPriority;

            if (isFollowingLead || losesMergeTie) {
              if (dist < 0.86) {
                // Hard queue stop at 0.86m following distance (RED LIGHT)
                speedFactor = 0;
                w.trafficStatus = 'YIELDING';
                w.blockingUnitId = other.id;
              } else {
                // Approaching lead worker (0.86m - 1.25m): adopt staggered corridor sub-lane & match pace
                targetLateralShift = (w.slotIndex % 2 === 0 ? 1 : -1) * 0.18;
                speedFactor = Math.min(speedFactor, 0.62);
                if (w.trafficStatus !== 'YIELDING') {
                  w.trafficStatus = 'PASSING_RIGHT';
                }
              }
            } else {
              // This worker has right-of-way at a merge: use right-hand sub-lane cleanly
              targetLateralShift = 0.18;
              if (w.trafficStatus !== 'YIELDING') {
                w.trafficStatus = 'PASSING_RIGHT';
              }
            }
          }

          // Hard personal-space repulsion if moving and closer than 0.56m
          if (dist < 0.56 && other.state !== 'STANDBY' && speedFactor > 0) {
            const push = (0.56 - dist) * 0.6;
            repulseX -= dirX * push;
            repulseZ -= dirZ * push;
          }
        }
      }

      if (speedFactor === 0) {
        // Hold current position steady at Red Signal without snapping laterally
        w.position = [...w.pos];
      } else {
        // Smoothly interpolate persistent lateral sub-lane offset
        const prevOffset = w.lateralOffset || 0;
        const blend = Math.min(1, dt * 6.5);
        w.lateralOffset = prevOffset + (targetLateralShift - prevOffset) * blend;

        const progressStep = (walkSpeedMetersPerSec * speedFactor * dt) / Math.max(0.5, w.pathLength);
        w.pathProgress = Math.min(1, w.pathProgress + progressStep);

        const nextSample = samplePathAtProgress(w.pathPoints, w.pathProgress);
        const rawX = nextSample.position[0] + rightX * w.lateralOffset + repulseX;
        const rawZ = nextSample.position[2] + rightZ * w.lateralOffset + repulseZ;

        const [safeX, safeZ] = resolveObstacleCollisions(rawX, rawZ, 0.24, obstacles);
        w.pos = [safeX, -1.02, safeZ];
        w.position = [...w.pos];
        w.angle = Math.atan2(nextSample.tangent[0], nextSample.tangent[2]);
      }

      if (w.pathProgress >= 1) {
        if (w.state === 'WALKING_TO_FAULT') {
          w.state = 'REPAIRING';
          w.repairProgress = 0;
          w.trafficStatus = 'CLEAR';
          w.blockingUnitId = null;
          w.lockedNodeId = null;
          w.lateralOffset = 0;
        } else if (w.state === 'RETURNING') {
          w.state = 'STANDBY';
          w.pos = [...w.slotPos];
          w.position = [...w.slotPos];
          w.angle = FRONT_ENTRY_YAW;
          w.trafficStatus = 'CLEAR';
          w.blockingUnitId = null;
          w.lockedNodeId = null;
          w.lateralOffset = 0;
          w.nodeIds = [];
          w.pathPoints = [];
          w.pathProgress = 0;
        }
      }
    }
  }

  return {
    workers: nextWorkers,
    completedAssetIds,
    lockedNodeIds: Array.from(lockedNodesMap.keys())
  };
}

/**
 * Computes the Red-Light / Yellow-Light / Green-Light AR Traffic Signal state for an operator or AMR
 * based on forward corridor occupancy, intersection crossing, and active right-of-way rules.
 */
export function computeArTrafficSignal(
  observerPos = [0, -1.02, -0.32],
  observerTangent = [0, 0, 1],
  otherUnits = [],
  selfId = null
) {
  const [ox, , oz] = observerPos;
  const [fx, , fz] = observerTangent;
  const fLen = Math.hypot(fx, fz) || 1;
  const fwdX = fx / fLen;
  const fwdZ = fz / fLen;

  let selfUnit = null;
  let nearestConflict = null;
  let nearestConflictDist = Infinity;
  let nearestAny = null;
  let nearestAnyDist = Infinity;

  for (const u of otherUnits) {
    if (!u) continue;
    if (selfId && u.id === selfId) {
      selfUnit = u;
      continue;
    }
    const upos = u.position || u.pos;
    if (!upos) continue;

    const dx = upos[0] - ox;
    const dz = upos[2] - oz;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) continue;

    if (dist < nearestAnyDist) {
      nearestAnyDist = dist;
      nearestAny = u;
    }

    // Ignore standby units unless very close in front
    if (u.state === 'STANDBY' && dist > 0.78) continue;

    const dirX = dx / dist;
    const dirZ = dz / dist;
    const forwardDot = dirX * fwdX + dirZ * fwdZ;

    if (forwardDot > -0.15 && dist < nearestConflictDist) {
      nearestConflictDist = dist;
      nearestConflict = { unit: u, dist, forwardDot };
    }
  }

  if (selfUnit?.trafficStatus === 'YIELDING') {
    const cId =
      selfUnit.blockingUnitId || nearestConflict?.unit?.id || nearestAny?.id || 'Cross-Traffic';
    const cDist = Number.isFinite(nearestConflictDist)
      ? nearestConflictDist
      : Number.isFinite(nearestAnyDist)
      ? nearestAnyDist
      : 0.72;
    return {
      light: 'RED',
      headline: 'RED LIGHT  ΓÇö  STOP & YIELD',
      detail: `Yielding right-of-way to ${cId} (${cDist.toFixed(2)} m ahead ┬╖ Intersection Block Locked)`,
      conflictingUnitId: cId,
      distanceMeters: Number(cDist.toFixed(2)),
      speedMultiplier: 0,
      laneOffset: 0
    };
  }

  if (
    nearestConflict &&
    ((nearestConflict.dist < 1.08 && nearestConflict.forwardDot > 0.22) ||
      nearestConflict.dist < 0.68)
  ) {
    const u = nearestConflict.unit;
    return {
      light: 'RED',
      headline: 'RED LIGHT  ΓÇö  HOLD POSITION',
      detail: `${u.id} (${u.type === 'robot' ? 'AMR' : 'Technician'}) occupying aisle ${nearestConflict.dist.toFixed(2)} m ahead`,
      conflictingUnitId: u.id,
      distanceMeters: Number(nearestConflict.dist.toFixed(2)),
      speedMultiplier: 0,
      laneOffset: 0
    };
  }

  if (
    selfUnit?.trafficStatus === 'PASSING_RIGHT' ||
    (nearestConflict && nearestConflict.dist < 1.95 && nearestConflict.forwardDot > -0.1)
  ) {
    const u = nearestConflict?.unit || nearestAny;
    const d = nearestConflict?.dist ?? nearestAnyDist ?? 1.4;
    return {
      light: 'YELLOW',
      headline: 'YELLOW LIGHT  ΓÇö  KEEP RIGHT LANE',
      detail: `Passing ${u?.id || 'unit'} (${d.toFixed(2)} m) ┬╖ Right-hand lane offset +0.22 m`,
      conflictingUnitId: u?.id || null,
      distanceMeters: Number(d.toFixed(2)),
      speedMultiplier: 0.78,
      laneOffset: 0.22
    };
  }

  return {
    light: 'GREEN',
    headline: 'GREEN LIGHT  ΓÇö  PROCEED',
    detail: nearestAny
      ? `Corridor clear ┬╖ Nearest unit ${nearestAny.id} at ${nearestAnyDist.toFixed(2)} m`
      : 'Corridor clear ┬╖ Right-of-way granted',
    conflictingUnitId: null,
    distanceMeters: nearestAny ? Number(nearestAnyDist.toFixed(2)) : null,
    speedMultiplier: 1.0,
    laneOffset: 0
  };
}
