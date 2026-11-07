/**
 * Thin client for the FastAPI backend (backend/app.py) with static fallbacks.
 *
 * Every scene getter tries the API first and falls back to the JSON the pipeline writes into
 * public/assets/, so the app also runs without Python. Asset data and the copilot need the backend.
 *
 * Frame: world, y up, metres-ish (same frame as equipment_room_splats.bin). Shapes:
 *  objects.json  { objects: [{ object_id, center[3], extents[3] (x, y, z), yaw (rad, about +y),
 *                  class, label_confidence, label_source, n_points, mean_rgb[3], touches_floor,
 *                  height_above_floor[2], asset?: { asset_id, tag, asset_class, health_score,
 *                  condition_state, issue_code, criticality, mapping_method, mapping_confidence } }] }
 *  path.json     { target, points[[x,y,z]], walk_speed_mps, final_heading_rad, clearance[], metrics, checks }
 *  timeline.json { radius_m, sample_step_m, frames: [{ i, t, nearby: [{object_id, distance_m, asset_id}],
 *                  entered[], left[] }] }  — frame i corresponds to path.points[i]
 *  rails.json    { body_bands, rails: [{ rail_id, points[[x,y,z]], length_m, min_body_clearance_m }] }
 *  registry.json { start_xz, target, entries: [{ object_id, asset_id, tag, mapping_method, mapping_confidence }] }
 */

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url} -> ${res.status}`);
  return res.json();
}

async function withFallback(apiUrl, staticUrl) {
  try {
    return await getJson(apiUrl);
  } catch {
    return getJson(staticUrl);
  }
}

export const getObjects = () => withFallback('/api/scene/objects', '/assets/objects.json');
export const getPath = () => withFallback('/api/sim/path', '/assets/path.json');
export const getTimeline = () => withFallback('/api/sim/timeline', '/assets/timeline.json');
export const getRails = () => withFallback('/api/sim/rails', '/assets/rails.json');
export const getRegistry = () => getJson('/assets/registry.json');
export const getAssetCards = () => withFallback('/api/assets', '/assets/pack_assets.json');

export const getAsset = (assetId) => getJson(`/api/assets/${assetId}`);
export const getTelemetry = (assetId, lastN = 48) => getJson(`/api/assets/${assetId}/telemetry?last_n=${lastN}`);
export const getEvents = (assetId, limit = 20) => getJson(`/api/assets/${assetId}/events?limit=${limit}`);
export const getDocuments = (assetId) => getJson(`/api/assets/${assetId}/documents`);
export const getStatusLine = (assetId) => getJson(`/api/assets/${assetId}/status-line`);
export const getSceneAnchors = () => getJson('/api/scene/anchors');

export const appendTelemetry = (assetId, values) =>
  getJson(`/api/assets/${assetId}/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });

/** Grounded diagnosis: { headline, observations[{text, evidence_ids}], hypotheses[...], safe_next_checks[],
 *  confidence, confidence_rationale[], safety_note, citations[], removed_citations[], mode: 'llm'|'fallback' } */
export const askCopilot = (assetId, question) =>
  getJson('/api/copilot/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_id: assetId, question })
  });

export const draftWorkOrder = (body) =>
  getJson('/api/work-orders/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
