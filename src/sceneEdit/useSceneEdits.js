import { useCallback, useEffect, useMemo, useState } from 'react';
import { sceneCommit, sceneEdits, sceneMovables, scenePreview, sceneReset, sceneUndo } from '../sceneApi.js';

const EMPTY = Object.freeze({});

/**
 * Backend edit log + replanned routes (equal-clearance rails) for the main app.
 * `replan` is in nav_targets.json shape (ply_raw) and can be passed to setCvNavigationData unchanged;
 * `overrides` maps moved object_id -> {obb, center, aabb_min, aabb_max} for applyCvOverrides.
 */
export function useSceneEdits(targetAssetId) {
  const [edits, setEdits] = useState([]);
  const [replan, setReplan] = useState(null);
  const [online, setOnline] = useState(null);
  const [error, setError] = useState(null);

  const take = useCallback((d) => {
    setEdits(d.edits || []);
    setReplan(d.replan || null);
    setOnline(true);
    setError(null);
    return d;
  }, []);

  const refresh = useCallback(
    () =>
      sceneEdits(targetAssetId)
        .then(take)
        .catch((e) => {
          setOnline(false);
          setError(String(e.message || e));
        }),
    [targetAssetId, take]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Hand-verified whole, freestanding objects (original poses) -> the only things that can move
  const [movablesBase, setMovablesBase] = useState([]);
  useEffect(() => {
    sceneMovables()
      .then((d) => setMovablesBase(d.movables || []))
      .catch(() => setMovablesBase([]));
  }, []);
  const movablesBaseById = useMemo(
    () => Object.fromEntries(movablesBase.map((m) => [m.object_id, m])),
    [movablesBase]
  );
  const movables = replan?.movables?.length ? replan.movables : movablesBase; // current poses
  /** Movable (current pose) that a clicked segmentation box belongs to, or null if the box is fixed. */
  const movableFor = useCallback(
    (objectId) =>
      movables.find((m) => m.object_id === objectId || (m.seed_object_ids || []).includes(objectId)) || null,
    [movables]
  );

  const preview = useCallback(
    (delta) => scenePreview({ ...delta, target_asset_id: targetAssetId || null }),
    [targetAssetId]
  );

  const commit = useCallback(
    async (delta, by) => {
      try {
        return take(await sceneCommit({ ...delta, target_asset_id: targetAssetId || null, by: by || null }));
      } catch (e) {
        setError(String(e.message || e));
        throw e;
      }
    },
    [targetAssetId, take]
  );

  const undo = useCallback((editId) => sceneUndo(editId).then(take), [take]);
  const reset = useCallback(() => sceneReset().then(take), [take]);

  return {
    edits,
    replan,
    overrides: replan?.overrides || EMPTY,
    movables,
    movablesBaseById,
    movableFor,
    online,
    error,
    refresh,
    preview,
    commit,
    undo,
    reset
  };
}

/** Merge moved-object poses into the CV override map (scene edits win over label overrides for pose fields). */
export function mergeEditOverrides(overridesMap, editOverrides) {
  if (!editOverrides || !Object.keys(editOverrides).length) return overridesMap;
  const out = { ...overridesMap };
  Object.entries(editOverrides).forEach(([id, pose]) => {
    out[id] = { ...(out[id] || {}), ...pose, scene_edit: true };
    // removed from the scene: 'rejected' is the status applyCvOverrides already filters out of the CV boxes
    if (pose.removed) out[id].review_status = 'rejected';
  });
  return out;
}
