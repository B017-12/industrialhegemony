import * as THREE from 'three';
import { buildAssetContourModel } from './dataPipeline.js';
import { resolveObstacleCollisions } from './pathfinding.js';
import { VALMET_ASSETS } from '../data/valmetDataset.js';

export const DISPLAY_ROTATION = [Math.PI, 0, 0];

export const INSTANCE_CLASSES = [
  'pump',
  'motor',
  'valve',
  'tank',
  'cabinet',
  'pipe',
  'ladder',
  'crate',
  'trolley',
  'sign',
  'door',
  'other'
];

export const HIDDEN_REVIEW_STATUSES = new Set(['rejected', 'merged']);

export const EVIDENCE_PHOTO_MAP = {
  'OBJ-0180': '/assets/evidence/OBJ-0180.jpg',
  'OBJ-0183': '/assets/evidence/OBJ-0183.jpg',
  'OBJ-0185': '/assets/evidence/OBJ-0185.jpg',
  'OBJ-0189': '/assets/evidence/OBJ-0189.jpg',
  'OBJ-0235': '/assets/evidence/OBJ-0235.jpg',
  'OBJ-0241': '/assets/evidence/OBJ-0241.jpg',
  'OBJ-0265': '/assets/evidence/OBJ-0265.jpg',
  'OBJ-0268': '/assets/evidence/OBJ-0268.jpg',
  'OBJ-0303': '/assets/evidence/OBJ-0303.jpg',
  'OBJ-0470': '/assets/evidence/OBJ-0470.jpg'
};

const LOCAL_STORAGE_OVERRIDES_KEY = 'valmet.cv.overrides.v1';

/**
 * Converts raw PLY coordinates (y-down) into Three.js display coordinates (y-up)
 * matching a parent group rotated by [Math.PI, 0, 0].
 */
export function rawToDisplay([x, y, z]) {
  return [Number(x.toFixed(4)), Number((-y).toFixed(4)), Number((-z).toFixed(4))];
}

export function displayToRaw([x, y, z]) {
  return [x, -y, -z];
}

export function isHiddenObject(object) {
  return HIDDEN_REVIEW_STATUSES.has(object?.review_status);
}

/**
 * Builds the Three.js Matrix4 for an object's 3D Oriented Bounding Box (OBB)
 * in the raw PLY frame (mounted inside the display-frame group with rotation [Math.PI, 0, 0]).
 */
export function obbMatrix(object) {
  const obb = object.obb ?? {
    center: object.center,
    extent: object.aabb_max.map((v, i) => v - object.aabb_min[i]),
    rotation: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]
  };
  const [r0, r1, r2] = obb.rotation || [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  const rotation = new THREE.Matrix4().set(
    r0[0], r0[1], r0[2], 0,
    r1[0], r1[1], r1[2], 0,
    r2[0], r2[1], r2[2], 0,
    0, 0, 0, 1
  );
  return new THREE.Matrix4()
    .makeTranslation(...obb.center)
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeScale(...obb.extent));
}

/**
 * Merges base scene_objects.json with labels_override.json and any user-saved localStorage overrides.
 */
export function mergeCvOverrides(baseObjects = [], overridesMap = {}) {
  return baseObjects.map((object) => {
    const entry = overridesMap[object.object_id];
    return entry ? { ...object, ...entry } : object;
  });
}

export function applyCvOverrides(baseSceneObjects, overridesMap = {}) {
  if (!baseSceneObjects?.objects) {
    return { objects: [], hiddenObjects: [], metres_per_unit: 1.2374 };
  }
  const merged = mergeCvOverrides(baseSceneObjects.objects, overridesMap);
  return {
    ...baseSceneObjects,
    objects: merged.filter((o) => !isHiddenObject(o)),
    hiddenObjects: merged.filter(isHiddenObject)
  };
}

export function loadStoredOverrides() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveStoredOverrides(overridesMap) {
  try {
    localStorage.setItem(LOCAL_STORAGE_OVERRIDES_KEY, JSON.stringify(overridesMap));
  } catch {
    // ignore storage quota errors
  }
}

export function clearStoredOverrides() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_OVERRIDES_KEY);
  } catch {
    // ignore
  }
}

/**
 * Loads all CV pipeline artifacts from /assets/derived/ and /assets/evidence/
 */
export async function fetchCvSceneBundle() {
  const [sceneRes, ovRes, evIdxRes, metricsRes, navRes, navTargetsRes] = await Promise.all([
    fetch('/assets/derived/scene_objects.json'),
    fetch('/assets/derived/labels_override.json'),
    fetch('/assets/evidence/index.json').catch(() => null),
    fetch('/assets/evidence/segmentation_metrics.json').catch(() => null),
    fetch('/assets/derived/nav.json').catch(() => null),
    fetch('/assets/derived/nav_targets.json').catch(() => null)
  ]);

  const baseSceneObjects = sceneRes.ok ? await sceneRes.json() : { objects: [], metres_per_unit: 1.2374 };
  const fileOverridesJson = ovRes.ok ? await ovRes.json() : { overrides: {} };
  const evidenceFrames = evIdxRes && evIdxRes.ok ? await evIdxRes.json() : {};
  const segmentationMetrics = metricsRes && metricsRes.ok ? await metricsRes.json() : null;
  const navData = navRes && navRes.ok ? await navRes.json() : null;
  const navTargets = navTargetsRes && navTargetsRes.ok ? await navTargetsRes.json() : null;

  const storedOverrides = loadStoredOverrides();
  const combinedOverrides = {
    ...(fileOverridesJson.overrides || {}),
    ...storedOverrides
  };

  return {
    baseSceneObjects,
    fileOverrides: fileOverridesJson.overrides || {},
    overridesMap: combinedOverrides,
    evidenceFrames,
    segmentationMetrics,
    navData,
    navTargets
  };
}

/**
 * 2D OBB footprint in display X-Z space (ported from ahmad_branch web/src/scene/mission.js)
 */
export function cvObjectDisplayFootprint(object) {
  const obb = object.obb ?? {
    center: object.center,
    extent: object.aabb_max.map((v, i) => Math.abs(v - object.aabb_min[i])),
    rotation: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]
  };
  const dispCenter = rawToDisplay(obb.center);
  const r = obb.rotation || [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  // Under rawToDisplay [x, -y, -z], Z components negate
  const ax = [r[0][0], -r[2][0]];
  const az = [r[0][2], -r[2][2]];
  const nx = Math.hypot(ax[0], ax[1]) || 1;
  const nz = Math.hypot(az[0], az[1]) || 1;
  return {
    id: object.object_id,
    asset_id: object.asset_id || null,
    centre: [dispCenter[0], dispCenter[2]],
    centerY: dispCenter[1],
    heightY: obb.extent[1],
    ax: [ax[0] / nx, ax[1] / nx],
    az: [az[0] / nz, az[1] / nz],
    half: [Math.max(0.08, obb.extent[0] * 0.5), Math.max(0.08, obb.extent[2] * 0.5)]
  };
}

/**
 * Horizontal distance in scene units from display point [x, y, z] to a 2D OBB footprint.
 */
export function footprintDistanceUnits(x, z, fp) {
  const dx = x - fp.centre[0];
  const dz = z - fp.centre[1];
  const u = Math.max(Math.abs(dx * fp.ax[0] + dz * fp.ax[1]) - fp.half[0], 0);
  const w = Math.max(Math.abs(dx * fp.az[0] + dz * fp.az[1]) - fp.half[1], 0);
  return Math.hypot(u, w);
}

/**
 * Synchronizes the 30 Valmet assets with their bound 3D CV OBBs from scene_objects.json
 * and their ESDF collision-free approach poses from nav_targets.json.
 */
export function syncAssetsWithCvObjects(assets, cvSceneObjects, evidenceFrames = {}, navTargets = null) {
  if (!cvSceneObjects?.objects?.length) return assets;

  const boundByAssetId = new Map();
  cvSceneObjects.objects.forEach((obj) => {
    if (obj.asset_id && !isHiddenObject(obj)) {
      boundByAssetId.set(obj.asset_id, obj);
    }
  });

  const navTargetByAssetId = new Map();
  if (navTargets?.targets?.length) {
    navTargets.targets.forEach((t) => {
      if (t.asset_id) navTargetByAssetId.set(t.asset_id, t);
    });
  }

  return assets.map((asset) => {
    const cvObj = boundByAssetId.get(asset.asset_id);
    if (!cvObj) return asset;

    const dispCenter = rawToDisplay(cvObj.obb?.center ?? cvObj.center);
    const extent = cvObj.obb?.extent ?? cvObj.aabb_max.map((v, i) => Math.abs(v - cvObj.aabb_min[i]));
    const bboxSize = [
      Math.max(0.22, Number(extent[0].toFixed(3))),
      Math.max(0.22, Number(extent[1].toFixed(3))),
      Math.max(0.22, Number(extent[2].toFixed(3)))
    ];

    // A user-moved object invalidates its pre-baked ESDF approach pose; recompute from its new floor position
    const navTarget = cvObj._moved ? null : navTargetByAssetId.get(asset.asset_id);
    let approachDisp;
    if (navTarget?.approach?.position) {
      approachDisp = rawToDisplay(navTarget.approach.position);
      approachDisp[1] = -1.02;
    } else {
      // Overhead/roof assets (e.g. CV-001 on the ceiling at y = +0.71m) or perimeter assets without a pre-baked ESDF entry:
      // target the walkable floor point directly underneath (for overhead assets) or 0.48m towards the aisle (for floor assets)
      const isOverhead = dispCenter[1] > -0.25;
      let targetX = dispCenter[0];
      let targetZ = dispCenter[2];
      if (!isOverhead) {
        const toAisleX = -1.0 - dispCenter[0];
        const toAisleZ = -0.5 - dispCenter[2];
        const dAisle = Math.hypot(toAisleX, toAisleZ) || 1;
        const standoff = Math.max(bboxSize[0], bboxSize[2]) * 0.5 + 0.34;
        targetX = dispCenter[0] + (toAisleX / dAisle) * standoff;
        targetZ = dispCenter[2] + (toAisleZ / dAisle) * standoff;
      }
      const [rx, rz] = resolveObstacleCollisions(targetX, targetZ, 0.26);
      approachDisp = [Number(rx.toFixed(4)), -1.02, Number(rz.toFixed(4))];
    }

    const updatedAsset = {
      ...asset,
      position: dispCenter,
      bbox_size: bboxSize,
      approach_point: approachDisp,
      is_overhead: dispCenter[1] > -0.25,
      esdf_reachable: true,
      cvObject: {
        object_id: cvObj.object_id,
        detected_class: cvObj.class,
        display_label: cvObj.display_label || cvObj.class,
        class_confidence: cvObj.class_confidence ?? 0.75,
        splat_count: cvObj.splat_count ?? 0,
        voxel_count: cvObj.voxel_count ?? 0,
        mapping_method: cvObj.mapping_method || 'procedural_class_match',
        mapping_confidence: cvObj.mapping_confidence ?? 0.5,
        mapping_notes: cvObj.mapping_notes || null,
        review_status: cvObj.review_status || null,
        reviewer: cvObj.reviewer || null,
        yaw_deg: cvObj.obb?.yaw_deg ?? 0,
        obb: cvObj.obb,
        raw_center: cvObj.center,
        evidence_photo: EVIDENCE_PHOTO_MAP[cvObj.object_id] || null,
        evidence_frames: evidenceFrames[cvObj.object_id] || []
      }
    };
    updatedAsset.contourModel = buildAssetContourModel(updatedAsset);
    const baseEntry = VALMET_ASSETS.find((va) => va.asset_id === asset.asset_id);
    if (baseEntry) {
      baseEntry.position = dispCenter;
      baseEntry.bbox_size = bboxSize;
      baseEntry.approach_point = approachDisp;
      baseEntry.is_overhead = updatedAsset.is_overhead;
    }
    return updatedAsset;
  });
}

/**
 * Builds the prioritized Computer Vision Review Queue (441 objects):
 * 1. Video-Evidence & Pinned Objects first
 * 2. Bound Valmet Assets (30 objects)
 * 3. High-confidence Unbound Equipment (pumps, valves, motors, cabinets, tanks)
 * 4. Unbound Pipes & Structural Planes
 * Reviewed objects move cleanly to the bottom of their group.
 */
export function buildCvReviewQueue(objects = []) {
  const isReviewed = (o) => o?.label_source === 'human' || Boolean(o?.review_status);

  const items = objects
    .filter((o) => o.source !== 'structure_plane')
    .map((o) => {
      let group = 'equipment';
      if (o.mapping_method === 'video_evidence' || EVIDENCE_PHOTO_MAP[o.object_id]) {
        group = 'video_evidence';
      } else if (o.asset_id) {
        group = 'bound';
      } else if (o.class === 'pipe' || o.class === 'other') {
        group = 'pipes_and_other';
      }
      return {
        objectId: o.object_id,
        group,
        reviewed: isReviewed(o),
        hasPhoto: Boolean(EVIDENCE_PHOTO_MAP[o.object_id]),
        object: o
      };
    });

  const groupRank = {
    video_evidence: 0,
    bound: 1,
    equipment: 2,
    pipes_and_other: 3
  };

  return items.sort((a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
    if (groupRank[a.group] !== groupRank[b.group]) return groupRank[a.group] - groupRank[b.group];
    if (a.hasPhoto !== b.hasPhoto) return a.hasPhoto ? -1 : 1;
    return (b.object.splat_count || 0) - (a.object.splat_count || 0);
  });
}

/**
 * Returns up to `count` nearest neighboring 3D OBBs for merging split detections.
 */
export function nearestCvNeighbours(targetObject, allObjects = [], count = 4) {
  if (!targetObject) return [];
  const c = targetObject.obb?.center ?? targetObject.center;
  return allObjects
    .filter(
      (o) =>
        o.object_id !== targetObject.object_id &&
        !isHiddenObject(o) &&
        o.source !== 'structure_plane'
    )
    .map((o) => {
      const d = o.obb?.center ?? o.center;
      const distUnits = Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]);
      return {
        object: o,
        distanceMeters: Number((distUnits * 1.2374).toFixed(2))
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, count);
}

/**
 * Computes the union AABB & OBB when merging two fragmented CV detections (`primary` + `secondary`).
 */
export function computeMergedObbOverride(primary, secondary, reviewer = 'Operator') {
  const min = primary.aabb_min.map((v, i) => Math.min(v, secondary.aabb_min[i]));
  const max = primary.aabb_max.map((v, i) => Math.max(v, secondary.aabb_max[i]));
  const center = min.map((v, i) => Number(((v + max[i]) * 0.5).toFixed(5)));
  const extent = min.map((v, i) => Number((max[i] - v).toFixed(5)));

  return {
    [primary.object_id]: {
      aabb_min: min,
      aabb_max: max,
      center,
      obb: {
        center,
        extent,
        rotation: primary.obb?.rotation || [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1]
        ],
        yaw_deg: primary.obb?.yaw_deg || 0
      },
      splat_count: (primary.splat_count || 0) + (secondary.splat_count || 0),
      review_status: 'confirmed',
      label_source: 'human',
      reviewer,
      merged_with: secondary.object_id
    },
    [secondary.object_id]: {
      review_status: 'merged',
      merged_into: primary.object_id,
      label_source: 'human',
      reviewer
    }
  };
}
