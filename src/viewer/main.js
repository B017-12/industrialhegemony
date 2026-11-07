/**
 * SpatialSense scan viewer — shows the real pipeline output on the photoreal scan:
 * Gaussian splats (public/assets/equipment_room.splat), extracted object frames (objects.json),
 * equal-clearance rails (rails.json), the collision-checked route (path.json), an avatar walking it with
 * proximity highlighting (timeline.json), and the grounded copilot diagnosis on arrival (/api/copilot/query).
 *
 * Everything is in the pipeline's world frame (y up), so no transforms are applied here.
 */
import './viewer.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { DropInViewer } from '@mkkellogg/gaussian-splats-3d';
import { askCopilot, getObjects, getPath, getRails, getTimeline } from '../api.js';

const COLOR = {
  target: 0xff4d4f,
  healthy: 0x22c55e,
  watch: 0xf59e0b,
  degraded: 0xf97316,
  attention_required: 0xef4444,
  scene: 0x94a3b8,
  rail: 0xfacc15,
  route: 0x34d399,
  avatar: 0x22d3ee
};
const CSS_COLOR = {
  target: 'var(--target)',
  healthy: 'var(--ok)',
  watch: 'var(--watch)',
  degraded: 'var(--degraded)',
  attention_required: 'var(--attention)',
  scene: 'var(--scene)'
};
const BODY_HEIGHT = 1.75;
const BODY_RADIUS = 0.16;
const HEAD_RADIUS = 0.12;
const LIST_SCENE_OBJECTS = 4;

const $ = (id) => document.getElementById(id);
const pretty = (s) => String(s || '').toLowerCase().replaceAll('_', ' ');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- renderer, scene, camera
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
stage.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
stage.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(3, 8, 4);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- state
const state = {
  objects: new Map(), // object_id -> { o, group, edges, fill, label, status }
  targetId: null,
  path: null,
  timeline: null,
  points: [],
  step: 0.1,
  length: 0,
  s: 0,
  playing: false,
  speed: 1,
  arrived: false,
  near: new Set(),
  selected: null,
  hovered: null,
  splats: null,
  pointCloud: null,
  ready: false
};
window.__viewer = state; // handy for debugging and automated screenshots

// ---------------------------------------------------------------- scan: photoreal splats, point fallback
function loadSplats() {
  const viewer = new DropInViewer({ sharedMemoryForWorkers: false, gpuAcceleratedSort: false, dynamicScene: false });
  scene.add(viewer);
  state.splats = viewer;
  return viewer
    .addSplatScene('/assets/equipment_room.splat', {
      splatAlphaRemovalThreshold: 10,
      showLoadingUI: false,
      onProgress: (pct) => setLoading(`Loading scan... ${Math.round(pct)}%`)
    })
    .then(() => setLoading(null));
}

async function loadPointCloud() {
  if (state.pointCloud) return state.pointCloud;
  const buf = await (await fetch('/assets/equipment_room_splats.bin')).arrayBuffer();
  const dv = new DataView(buf);
  const n = dv.getInt32(0, true);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0, off = 4; i < n; i++, off += 16) {
    pos[i * 3] = dv.getFloat32(off, true);
    pos[i * 3 + 1] = dv.getFloat32(off + 4, true);
    pos[i * 3 + 2] = dv.getFloat32(off + 8, true);
    col[i * 3] = dv.getUint8(off + 12) / 255;
    col[i * 3 + 1] = dv.getUint8(off + 13) / 255;
    col[i * 3 + 2] = dv.getUint8(off + 14) / 255;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  state.pointCloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.02, vertexColors: true }));
  scene.add(state.pointCloud);
  return state.pointCloud;
}

function setLoading(text) {
  const el = $('loading');
  el.hidden = !text;
  if (text) el.textContent = text;
}

// ---------------------------------------------------------------- object frames + labels
function statusOf(o) {
  if (o.object_id === state.targetId) return 'target';
  return o.asset ? o.asset.condition_state : 'scene';
}

function makeLabel(o, status) {
  const el = document.createElement('div');
  el.className = `tag${status === 'target' ? ' target' : ''}`;
  el.style.setProperty('--c', CSS_COLOR[status] || CSS_COLOR.scene);
  const a = o.asset;
  const title = a ? `${a.tag} · ${pretty(a.asset_class)}` : pretty(o.class);
  const sub = a
    ? `${o.object_id} · health ${a.health_score} · ${pretty(a.condition_state)}`
    : `${o.object_id} · ${o.n_points.toLocaleString()} pts · label conf ${o.label_confidence}`;
  el.innerHTML = `<div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div>`;
  const label = new CSS2DObject(el);
  label.position.set(0, o.extents[1] / 2, 0);
  label.visible = false;
  return label;
}

function addObject(o) {
  const status = statusOf(o);
  const color = COLOR[status] ?? COLOR.scene;
  const [w, h, d] = o.extents;
  const geo = new THREE.BoxGeometry(w, h, d);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: status === 'scene' ? 0.3 : 0.75 })
  );
  const fill = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false })
  );
  fill.userData.objectId = o.object_id;
  const group = new THREE.Group();
  group.add(edges, fill);
  group.position.set(...o.center);
  group.rotation.y = -o.yaw; // pipeline yaw: box u-axis = (cos yaw, sin yaw) in the x-z plane
  const label = makeLabel(o, status);
  group.add(label);
  scene.add(group);
  state.objects.set(o.object_id, { o, group, edges, fill, label, status, highlighted: false });
}

function setHighlight(entry, on) {
  entry.highlighted = on;
  const isAsset = entry.status !== 'scene';
  // emphasised frames (target, selected, nearby Excel assets) draw on top of the scan with a label;
  // nearby scene objects only brighten, and show their label on hover
  const emphasise = entry.status === 'target' || entry === state.selected || (on && isAsset);
  entry.edges.material.opacity = emphasise ? 1 : on ? 0.8 : isAsset ? 0.75 : 0.3;
  entry.edges.material.depthTest = !emphasise;
  entry.edges.renderOrder = emphasise ? 10 : 0;
  entry.fill.material.opacity = emphasise ? 0.14 : on ? 0.05 : 0;
  entry.label.visible = emphasise || entry === state.hovered;
  applyBoxVisibility(entry);
}

function applyBoxVisibility(entry) {
  const showAll = $('tg-boxes').checked;
  entry.group.visible = showAll || entry.highlighted || entry.status !== 'scene';
}

// ---------------------------------------------------------------- rails, route, avatar
function addRails(rails) {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: COLOR.rail, transparent: true, opacity: 0.7 });
  for (const r of rails.rails) {
    const pts = r.points.map(([x, y, z]) => new THREE.Vector3(x, y + 0.015, z));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  scene.add(group);
  return group;
}

function addRoute(points) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone().setY(p.y + 0.03)));
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, points.length * 2, 0.025, 6, false),
    new THREE.MeshBasicMaterial({ color: COLOR.route, transparent: true, opacity: 0.9 })
  );
  scene.add(tube);
}

function makeAvatar(radius) {
  // visual body only; the planner's clearance envelope (rails.py BODY_BANDS) is wider than this
  const avatar = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: COLOR.avatar, roughness: 0.45, emissive: 0x0e7490, emissiveIntensity: 0.35, transparent: true, opacity: 0.92
  });
  const torsoLength = BODY_HEIGHT - 2 * HEAD_RADIUS - 0.08 - 2 * BODY_RADIUS;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_RADIUS, torsoLength, 6, 16), mat);
  torso.position.y = BODY_RADIUS + torsoLength / 2 + 0.02;
  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 20, 14), mat);
  head.position.y = BODY_HEIGHT - HEAD_RADIUS;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x67e8f9, emissiveIntensity: 0.9 })
  );
  visor.position.set(0, BODY_HEIGHT - HEAD_RADIUS, HEAD_RADIUS - 0.02);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.03, radius, 96),
    new THREE.MeshBasicMaterial({ color: COLOR.avatar, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  avatar.add(torso, head, visor, ring);
  scene.add(avatar);
  return avatar;
}

function poseAt(s) {
  const pts = state.points;
  const f = THREE.MathUtils.clamp(s / state.step, 0, pts.length - 1);
  const i = Math.min(Math.floor(f), pts.length - 2);
  const pos = pts[i].clone().lerp(pts[i + 1], f - i);
  const dir = pts[i + 1].clone().sub(pts[i]);
  return { pos, dir, frame: Math.round(f) };
}

// ---------------------------------------------------------------- proximity panel
function updateProximity(frameIdx) {
  const frame = state.timeline.frames[Math.min(frameIdx, state.timeline.frames.length - 1)];
  const ids = new Set(frame.nearby.map((n) => n.object_id));
  for (const id of state.near) if (!ids.has(id)) setHighlight(state.objects.get(id), false);
  const entered = [];
  for (const id of ids) {
    if (!state.near.has(id)) {
      setHighlight(state.objects.get(id), true);
      entered.push(id);
    }
  }
  state.near = ids;
  if (entered.length || frame.left.length || $('near-list').dataset.frame !== String(frame.i)) {
    renderNearList(frame, new Set(entered));
  }
}

function renderNearList(frame, entered) {
  const list = $('near-list');
  list.dataset.frame = String(frame.i);
  if (!frame.nearby.length) {
    list.innerHTML = '<li class="muted">No objects within reach.</li>';
    return;
  }
  // every nearby Excel asset, then the closest few scene objects
  const assets = frame.nearby.filter((n) => n.asset_id);
  const others = frame.nearby.filter((n) => !n.asset_id);
  const rows = [...assets, ...others.slice(0, LIST_SCENE_OBJECTS)];
  const more = others.length - LIST_SCENE_OBJECTS;
  list.innerHTML = rows
    .map((n) => {
      const e = state.objects.get(n.object_id);
      const a = e.o.asset;
      const title = a ? `${a.tag} · ${pretty(a.asset_class)}` : pretty(e.o.class);
      const sub = a ? `health ${a.health_score} · ${pretty(a.condition_state)} · ${a.issue_code}` : n.object_id;
      return `<li data-id="${n.object_id}" class="${entered.has(n.object_id) ? 'entered' : ''}">
        <span class="dot" style="--c:${CSS_COLOR[e.status] || CSS_COLOR.scene}"></span>
        <span class="what">${esc(title)}<small>${esc(sub)}</small></span>
        <span class="dist">${n.distance_m.toFixed(1)} m</span></li>`;
    })
    .join('') + (more > 0 ? `<li class="muted more">+ ${more} more scene objects in range</li>` : '');
}

$('near-list').addEventListener('click', (ev) => {
  const li = ev.target.closest('li[data-id]');
  if (li) select(li.dataset.id);
});

// ---------------------------------------------------------------- selection + diagnosis
function select(objectId) {
  const e = state.objects.get(objectId);
  if (!e) return;
  const prev = state.selected;
  state.selected = e;
  if (prev && prev !== e) setHighlight(prev, state.near.has(prev.o.object_id));
  setHighlight(e, state.near.has(objectId));
  const o = e.o;
  const a = o.asset;
  const sec = $('detail');
  sec.hidden = false;
  sec.innerHTML = `<h2>Selected</h2>
    <h3>${esc(a ? `${a.tag} · ${pretty(a.asset_class)}` : pretty(o.class))}</h3>
    <dl class="kv">
      <dt>Object</dt><dd>${o.object_id} · ${o.n_points.toLocaleString()} splats</dd>
      <dt>Label</dt><dd>${esc(pretty(o.class))} (${esc(o.label_source)}, conf ${o.label_confidence})</dd>
      <dt>Size</dt><dd>${o.extents.map((v) => v.toFixed(2)).join(' × ')} m</dd>
      ${a ? `<dt>Asset</dt><dd>${a.asset_id} · criticality ${esc(a.criticality)}</dd>
      <dt>Condition</dt><dd>${esc(pretty(a.condition_state))} · health ${a.health_score} · ${esc(a.issue_code)}</dd>
      <dt>Mapping</dt><dd>${esc(pretty(a.mapping_method))} · conf ${a.mapping_confidence}</dd>` : ''}
    </dl>
    ${a ? `<button id="btn-diagnose" style="margin-top:8px">Diagnose ${esc(a.tag)}</button>` : ''}`;
  $('btn-diagnose')?.addEventListener('click', () => diagnose(a.asset_id));
}

async function diagnose(assetId) {
  const sec = $('diagnosis');
  $('diag-panel').hidden = false;
  sec.innerHTML = '<h2>AI diagnosis</h2><p class="muted">Asking the copilot...</p>';
  let ans;
  try {
    ans = await askCopilot(assetId, 'Diagnose this asset and recommend the next safe inspection steps.');
  } catch {
    sec.innerHTML = `<h2>AI diagnosis</h2><p class="muted">Backend not reachable. Start it with<br>
      <code>uv run uvicorn backend.app:app --port 8000</code></p>`;
    return;
  }
  const claims = (list) =>
    list
      .map((c) => `<li>${esc(c.text)}<br>${c.evidence_ids.map((i) => `<span class="chip">${esc(i)}</span>`).join('')}</li>`)
      .join('');
  const modeBadge =
    ans.mode === 'llm'
      ? `<span class="badge" style="background:#0e7490">LLM · ${esc(ans.model)}</span>`
      : '<span class="badge" style="background:#334155">deterministic fallback</span>';
  sec.innerHTML = `<h2>AI diagnosis ${modeBadge}</h2>
    <h3>${esc(ans.headline)}</h3>
    <div class="subhead">Confidence ${(ans.confidence * 100).toFixed(0)}%</div>
    <div class="conf"><div style="width:${ans.confidence * 100}%"></div></div>
    <ul class="rationale">${ans.confidence_rationale.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="subhead">Observations (facts)</div><ul class="claims">${claims(ans.observations)}</ul>
    <div class="subhead">Hypotheses (evidence, not proof)</div><ul class="claims">${claims(ans.hypotheses)}</ul>
    <div class="subhead">Safe next checks</div>
    <ol class="checks">${ans.safe_next_checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
    <div class="safety">${esc(ans.safety_note)}</div>
    ${ans.removed_citations.length ? `<p class="muted">Removed unknown citations: ${ans.removed_citations.map(esc).join(', ')}</p>` : ''}`;
}

// ---------------------------------------------------------------- picking + hover labels
const raycaster = new THREE.Raycaster();
let downAt = null;

function pick(e) {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const fills = [...state.objects.values()].filter((x) => x.group.visible).map((x) => x.fill);
  const hit = raycaster.intersectObjects(fills, false)[0];
  return hit ? state.objects.get(hit.object.userData.objectId) : null;
}

let hoverQueued = false;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (hoverQueued || e.buttons) return;
  hoverQueued = true;
  requestAnimationFrame(() => {
    hoverQueued = false;
    const hit = pick(e);
    if (hit === state.hovered) return;
    const prev = state.hovered;
    state.hovered = hit;
    if (prev) setHighlight(prev, prev.highlighted);
    if (hit) setHighlight(hit, hit.highlighted);
    renderer.domElement.style.cursor = hit ? 'pointer' : '';
  });
});
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const hit = pick(e);
  if (hit) select(hit.o.object_id);
});

// ---------------------------------------------------------------- controls
function setPlaying(on) {
  state.playing = on;
  $('btn-play').textContent = on ? 'Pause' : state.s > 0 && !state.arrived ? 'Resume' : 'Walk';
}
function restart() {
  state.s = 0;
  state.arrived = false;
  $('diag-panel').hidden = true;
  setPlaying(false);
}
$('diag-close').addEventListener('click', () => ($('diag-panel').hidden = true));
function arrive() {
  state.arrived = true;
  setPlaying(false);
  $('btn-play').textContent = 'Walk again';
  const t = state.objects.get(state.targetId);
  select(state.targetId);
  diagnose(t.o.asset.asset_id);
}
$('btn-play').addEventListener('click', () => {
  if (state.arrived) restart();
  setPlaying(!state.playing);
});
$('btn-restart').addEventListener('click', restart);
$('sel-speed').addEventListener('change', (e) => (state.speed = Number(e.target.value)));
$('scrub').addEventListener('input', (e) => {
  state.s = (Number(e.target.value) / 1000) * state.length;
  if (state.s >= state.length - 1e-6) arrive();
  else state.arrived = false;
});
$('tg-boxes').addEventListener('change', () => state.objects.forEach(applyBoxVisibility));
$('tg-rails').addEventListener('change', (e) => (state.railGroup.visible = e.target.checked));
$('tg-splats').addEventListener('change', async (e) => {
  const photoreal = e.target.checked;
  if (state.splats) state.splats.visible = photoreal;
  if (!photoreal) (await loadPointCloud()).visible = true;
  else if (state.pointCloud) state.pointCloud.visible = false;
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    $('btn-play').click();
  }
});

// ---------------------------------------------------------------- main
async function main() {
  const [objectsDoc, path, timeline, rails] = await Promise.all([getObjects(), getPath(), getTimeline(), getRails()]);
  state.path = path;
  state.timeline = timeline;
  state.targetId = path.target.object_id;
  state.step = timeline.sample_step_m;
  state.points = path.points.map((p) => new THREE.Vector3(...p));
  state.length = (state.points.length - 1) * state.step;

  objectsDoc.objects.forEach(addObject);
  state.objects.forEach((e) => setHighlight(e, false));
  state.railGroup = addRails(rails);
  addRoute(state.points);
  const avatar = makeAvatar(timeline.radius_m);
  $('near-radius').textContent = `(≤ ${timeline.radius_m} m)`;

  const mapped = objectsDoc.objects.filter((o) => o.asset).length;
  const m = path.metrics.binding_lr_imbalance_m;
  $('stats').innerHTML =
    `<b>${objectsDoc.objects.length}</b> objects framed · <b>${mapped}</b> mapped to Excel assets · ` +
    `target <b>${esc(path.target.tag)}</b> (${esc(path.target.issue_code)})<br>` +
    `route <b>${path.length_m} m</b> · ${path.checks.collision_free ? 'collision-free PASS' : 'COLLISION FAIL'} · ` +
    `rail |L−R| median <b>${m.median} m</b>`;

  // overview camera: above the room (ceiling is cut away in the splat export), looking at the route
  const box = new THREE.Box3().setFromPoints(state.points);
  const centre = box.getCenter(new THREE.Vector3());
  camera.position.set(centre.x, centre.y + 7.5, centre.z + 6);
  controls.target.copy(centre);

  const clock = new THREE.Clock();
  let heading = 0;
  let pulse = 0;
  const tick = () => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (state.playing && !state.arrived) {
      state.s += dt * path.walk_speed_mps * state.speed;
      if (state.s >= state.length) {
        state.s = state.length;
        arrive();
      }
      $('scrub').value = String(Math.round((state.s / state.length) * 1000));
    }
    const { pos, dir, frame } = poseAt(state.s);
    avatar.position.copy(pos);
    let want = Math.atan2(dir.x, dir.z);
    if (state.arrived) {
      const c = state.objects.get(state.targetId).o.center;
      want = Math.atan2(c[0] - pos.x, c[2] - pos.z);
    }
    heading += Math.atan2(Math.sin(want - heading), Math.cos(want - heading)) * Math.min(1, dt * 8);
    avatar.rotation.y = heading;
    updateProximity(frame);

    const target = state.objects.get(state.targetId);
    pulse += dt;
    target.fill.material.opacity = 0.1 + 0.08 * Math.sin(pulse * 4) + (state.arrived ? 0.08 : 0);

    if ($('tg-follow').checked) {
      const fwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
      const want = pos.clone().addScaledVector(fwd, -3.0).add(new THREE.Vector3(0, 2.6, 0));
      camera.position.lerp(want, Math.min(1, dt * 3));
      controls.target.lerp(pos.clone().add(new THREE.Vector3(0, 0.9, 0)), Math.min(1, dt * 5));
    }
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();

  try {
    await loadSplats();
  } catch (err) {
    console.warn('Splat scan unavailable, showing the point cloud instead:', err);
    $('tg-splats').checked = false;
    await loadPointCloud();
    setLoading(null);
  }
  state.ready = true;
}

main().catch((err) => {
  console.error(err);
  setLoading(`Could not load pipeline output: ${err.message}. Run: uv run python -m pipeline.run_all`);
});
