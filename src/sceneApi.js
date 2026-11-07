/**
 * Client for the scene-understanding (/api/vision/*) and scene-edit (/api/scene/edits*) backend routes.
 * Contracts: backend/vision/schema.py (VisionFinding, CrossCheck) and backend/scene_edit/*.
 */

async function req(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = '';
    let body = null;
    try {
      body = await res.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* ignore */
    }
    const err = new Error(`${init?.method || 'GET'} ${url} -> ${res.status} ${detail}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

const post = (url, body) =>
  req(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---- vision
export const visionHealth = () => req('/api/vision/health');
export const visionFrames = () => req('/api/vision/frames');
export const visionForObject = (objectId) => req(`/api/vision/object/${objectId}`);
export const visionForAsset = (assetId) => req(`/api/vision/asset/${assetId}`);
export const visionInspect = (body) => post('/api/vision/inspect', body);
export const visionCrosscheck = (assetId) => req(`/api/vision/crosscheck/${assetId}`);
export const visionLink = (regionId, body) => post(`/api/vision/regions/${regionId}/link`, body);
export const visionLabel = (regionId, body) => post(`/api/vision/regions/${regionId}/label`, body);
export const visionAddRegion = (body) => post('/api/vision/regions', body);
export const visionEval = () => req('/api/vision/eval');
export const visionFindings = () => req('/api/vision/findings');

// ---- scene edits (move objects, replan)
export const sceneEdits = (targetAssetId) =>
  req(`/api/scene/edits${targetAssetId ? `?target_asset_id=${targetAssetId}` : ''}`);
export const scenePreview = (body) => post('/api/scene/edits/preview', body);
export const sceneCommit = (body) => post('/api/scene/edits', body);
export const sceneUndo = (editId) => req(`/api/scene/edits/${editId}`, { method: 'DELETE' });
export const sceneReset = () => req('/api/scene/edits', { method: 'DELETE' });
export const sceneReplan = () => req('/api/scene/replan');
export const sceneMovables = () => req('/api/scene/movables');
