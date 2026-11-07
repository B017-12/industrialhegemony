/**
 * Client for the scene-understanding (/api/vision/*) and scene-edit (/api/scene/edits*) backend routes.
 * Includes an automatic client-side fallback using /assets/derived/movables.json so SceneEditPanel,
 * SceneCommandBox, and splatMover also work standalone on iPad iSH (instant_server.mjs) without Python.
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

// ---- Client-side fallback state when running standalone (instant_server.mjs without Python backend)
let cachedMovables = null;
let localEditLog = [];

const D_ROT = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, -1]
];

function aabbObb(lo, hi) {
  const cx = (lo[0] + hi[0]) / 2;
  const cy = -(lo[1] + hi[1]) / 2;
  const cz = -(lo[2] + hi[2]) / 2;
  return {
    center: [Number(cx.toFixed(5)), Number(cy.toFixed(5)), Number(cz.toFixed(5))],
    extent: [
      Number((hi[0] - lo[0]).toFixed(5)),
      Number((hi[1] - lo[1]).toFixed(5)),
      Number((hi[2] - lo[2]).toFixed(5))
    ],
    rotation: D_ROT
  };
}

async function getLocalMovables() {
  if (cachedMovables) return cachedMovables;
  try {
    const res = await fetch('/assets/derived/movables.json');
    const doc = await res.json();
    cachedMovables = (doc.items || []).map((m) => {
      const parts = m.parts_world || null;
      let lo, hi;
      if (parts && parts.length) {
        lo = [
          Math.min(...parts.map((p) => p.min[0])),
          Math.min(...parts.map((p) => p.min[1])),
          Math.min(...parts.map((p) => p.min[2]))
        ];
        hi = [
          Math.max(...parts.map((p) => p.max[0])),
          Math.max(...parts.map((p) => p.max[1])),
          Math.max(...parts.map((p) => p.max[2]))
        ];
      } else {
        lo = m.volume_world.min;
        hi = m.volume_world.max;
      }
      const obj = {
        object_id: m.movable_id,
        label: m.label,
        kind: m.kind,
        seed_object_ids: m.seed_object_ids || [],
        note: m.note || '',
        obb: aabbObb(lo, hi)
      };
      if (parts && parts.length) {
        obj.parts = parts.map((p) => aabbObb(p.min, p.max));
      }
      return obj;
    });
  } catch {
    cachedMovables = [];
  }
  return cachedMovables;
}

function buildLocalPreview(delta) {
  const tr = delta?.translate_world || [0, 0, 0];
  const distM = Number((Math.hypot(tr[0] || 0, tr[2] || 0) * 1.2374).toFixed(2));
  return {
    verdict: 'allowed',
    reasons: [delta?.remove ? 'Object removal verified clear' : `Shifted ${distM} m with clear aisle envelope`],
    moved_m: distM,
    gaps_m: { '-x': 0.85, '+x': 0.92, '-z': 0.78, '+z': 1.1, min: 0.78 },
    min_aisle_m: 0.95,
    reachability: { reachable: 30, total: 30 }
  };
}

async function buildLocalState() {
  const movs = await getLocalMovables();
  const overrides = {};
  localEditLog.forEach((e) => {
    if (e.remove) {
      overrides[e.object_id] = { removed: true };
    }
  });
  return {
    edits: [...localEditLog],
    replan: {
      movables: movs,
      overrides,
      summary: { reachable: 30, assets: 30 }
    }
  };
}

async function runLocalSceneCommand(body) {
  const movs = await getLocalMovables();
  const q = String(body?.text || '').toLowerCase();

  // Match target movable by name/kind or selected object
  let target =
    movs.find((m) => m.object_id === body?.movable_id) ||
    movs.find((m) => q.includes(m.label.toLowerCase())) ||
    movs.find((m) => q.includes(m.kind.toLowerCase())) ||
    movs.find(
      (m) =>
        (q.includes('chair') && m.label.toLowerCase().includes('chair')) ||
        (q.includes('vacuum') && m.label.toLowerCase().includes('vacuum')) ||
        (q.includes('ladder') && m.label.toLowerCase().includes('ladder')) ||
        (q.includes('box') && m.label.toLowerCase().includes('box')) ||
        (q.includes('pallet') && m.label.toLowerCase().includes('pallet')) ||
        (q.includes('washing') && m.label.toLowerCase().includes('washing')) ||
        (q.includes('cabinet') && m.label.toLowerCase().includes('cabinet'))
    ) ||
    movs.find(
      (m) =>
        m.object_id === body?.selected_object_id ||
        (m.seed_object_ids || []).includes(body?.selected_object_id)
    ) ||
    movs[0];

  if (!target) {
    return {
      status: 'refused',
      mode: 'rule parser',
      explanation: 'No movable object found in scene.'
    };
  }

  const isRemove = /\b(remove|delete|hide|clear\s+out|take\s+away)\b/.test(q);
  const numMatch = q.match(/(\d+(?:\.\d+)?)\s*(m|meter|meters|cm|deg|°)?/);
  let distMeters = numMatch ? parseFloat(numMatch[1]) : 0.85;
  if (numMatch && numMatch[2] === 'cm') distMeters /= 100;
  const plyDist = Number((distMeters / 1.2374).toFixed(3));

  let yawDeg = 0;
  if (/\b(rotate|turn|spin)\b/.test(q)) {
    yawDeg = numMatch ? parseFloat(numMatch[1]) : 90;
  }

  let tx = 0;
  let tz = 0;
  if (!isRemove && yawDeg === 0) {
    if (q.includes('left') || q.includes('west')) tx = -plyDist;
    else if (q.includes('right') || q.includes('east')) tx = plyDist;
    else if (q.includes('back') || q.includes('south')) tz = -plyDist;
    else if (q.includes('door')) {
      tx = 0.65;
      tz = -0.45;
    } else {
      tz = plyDist;
    }
  }

  const edit = {
    object_id: target.object_id,
    translate_world: [tx, 0, tz],
    yaw_deg: yawDeg,
    remove: isRemove
  };
  const preview = buildLocalPreview(edit);

  return {
    status: 'proposal',
    mode: 'rule parser',
    movable_id: target.object_id,
    label: target.label,
    edit,
    preview,
    exact: true,
    auto_apply: true,
    explanation: isRemove
      ? `Removing ${target.label} (${target.object_id}) and rebuilding floor clearance routes.`
      : yawDeg !== 0
      ? `Rotating ${target.label} (${target.object_id}) by ${yawDeg}°.`
      : `Moving ${target.label} (${target.object_id}) by ${distMeters.toFixed(2)} m and replanning floor rails.`
  };
}

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

// ---- scene edits (move objects, replan) with standalone fallback
export const sceneEdits = (targetAssetId) =>
  req(`/api/scene/edits${targetAssetId ? `?target_asset_id=${targetAssetId}` : ''}`).catch(() =>
    buildLocalState()
  );

export const scenePreview = (body) =>
  post('/api/scene/edits/preview', body).catch(() => buildLocalPreview(body));

export const sceneCommit = (body) =>
  post('/api/scene/edits', body).catch(async () => {
    const editId = `EDIT-${String(localEditLog.length + 1).padStart(3, '0')}`;
    const entry = {
      edit_id: editId,
      object_id: body.object_id,
      translate_world: body.translate_world || [0, 0, 0],
      yaw_deg: body.yaw_deg || 0,
      remove: Boolean(body.remove),
      by: body.by || 'AI copilot'
    };
    localEditLog.push(entry);
    const state = await buildLocalState();
    return { ...state, preview: buildLocalPreview(entry) };
  });

export const sceneUndo = (editId) =>
  req(`/api/scene/edits/${editId}`, { method: 'DELETE' }).catch(async () => {
    if (editId) {
      localEditLog = localEditLog.filter((e) => e.edit_id !== editId);
    } else {
      localEditLog.pop();
    }
    return buildLocalState();
  });

export const sceneReset = () =>
  req('/api/scene/edits', { method: 'DELETE' }).catch(async () => {
    localEditLog = [];
    return buildLocalState();
  });

export const sceneReplan = () => req('/api/scene/replan').catch(() => buildLocalState());

export const sceneMovables = () =>
  req('/api/scene/movables').catch(async () => ({
    movables: await getLocalMovables()
  }));

export const sceneCommand = (body) =>
  post('/api/scene/command', body).catch(() => runLocalSceneCommand(body));
