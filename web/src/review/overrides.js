// labels_override.json merge rules, shared by the store, data loading and the
// review queue. Pure: no store, three.js or DOM imports (Node scripts use it).

export const HIDDEN_REVIEW_STATUSES = new Set(["rejected", "merged"]);

export const INSTANCE_CLASSES = ["pump", "motor", "valve", "tank", "cabinet", "pipe", "ladder", "crate", "trolley", "sign", "door", "other"];
export const STRUCTURE_CLASSES = ["floor", "ceiling", "wall"];

export const isHidden = (object) => HIDDEN_REVIEW_STATUSES.has(object?.review_status);

// Every object with its override merged in, hidden ones included.
export function mergeOverrides(baseObjects, overridesFile) {
  const overrides = overridesFile?.overrides || {};
  return baseObjects.map((object) => {
    const entry = overrides[object.object_id];
    return entry ? { ...object, ...entry } : object;
  });
}

// What the viewer shows: rejected and merged objects are dropped from `objects`
// so overlays, labels, the minimap and the mission never see them.
export function applyOverrides(sceneObjects, overridesFile) {
  const merged = mergeOverrides(sceneObjects.objects, overridesFile);
  return {
    ...sceneObjects,
    objects: merged.filter((o) => !isHidden(o)),
    hiddenObjects: merged.filter(isHidden),
  };
}
