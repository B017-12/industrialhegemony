// Equipment id -> saved region. Pure: Node scripts import it. Candidates do not highlight.

export const SAVED_STATUSES = new Set(["verified_identity", "reviewed_correspondence", "procedural_assignment"]);

export const PROXY_REGION = "Region box. The splats inside it are not isolated; this is not a nameplate identification.";

export function isSavedMapping(record) {
  if (!record) return false;
  const status = record.mapping_status;
  if (status === "conflicting_evidence" || status === "class_only_candidate" || status === "unmapped") return false;
  if (status) return SAVED_STATUSES.has(status);
  return Boolean(record.mapping_method);
}

export function regionIdsForAsset(assetId, objects) {
  if (!assetId) return [];
  const ids = [];
  for (const object of objects ?? []) {
    if (object.asset_id === assetId && isSavedMapping(object)) ids.push(object.object_id);
    for (const hosted of object.hosted_assets ?? []) {
      if (hosted.asset_id === assetId && isSavedMapping(hosted)) ids.push(object.object_id);
    }
  }
  return [...new Set(ids)];
}

// A box click resolves to the object's own asset, never a sensor hosted on it.
export function workbookAssetForObject(object) {
  if (!object?.asset_id || !isSavedMapping(object)) return null;
  return object.asset_id;
}

export function shownAssetId(object, selectedAssetId) {
  if (selectedAssetId && (object?.hosted_assets ?? []).some((hosted) => hosted.asset_id === selectedAssetId)) {
    return selectedAssetId;
  }
  return object?.asset_id ?? null;
}

export function regionLabel(object, assetId) {
  const hosted = (object?.hosted_assets ?? []).find((item) => item.asset_id === assetId);
  const kind = hosted?.location_kind ?? (object?.asset_id === assetId ? object?.location_kind : null);
  if (kind === "parent_assembly") return "Parent assembly, not the sensor body";
  if (kind === "approximate_location_marker") return "Approximate location marker, not a verified component";
  if (kind === "exact_component") return "Exact component region";
  return "Unknown location";
}

// Details and evidence stay on the asset that was selected, including a parent-region sensor.
export function linkageFor(assetId, objects) {
  return {
    assetId,
    regionIds: regionIdsForAsset(assetId, objects),
    detailAssetId: assetId,
    evidenceAssetId: assetId,
  };
}
