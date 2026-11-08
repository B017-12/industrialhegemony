import * as THREE from 'three';

/**
 * AR Navigation Guidance (Live-View style floor chevrons, turn sign, destination beacon, open-direction fan).
 * Headings follow the scene convention: h = atan2(dirX, dirZ), +h turns left, right-hand vector = (-cos h, sin h).
 */

const FLOOR_Y = -1.02;
const LIFT = 0.014;
// 1st-person: eye is 0.68 m up with a 52 deg FOV and the hands cover the lower frame, so floor marks under ~3 m are hidden
const FLOAT_HEIGHT = 0.42;
const FLOAT_TILT = 0.95;
const FLOAT_SCALE = 0.62;
const FLOAT_START = 1.25;
const RENDER_ORDER = 10000;

const CHEVRON_COUNT = 11;
const CHEVRON_SPACING = 0.4;
const RIBBON_START = 0.75;
const RIBBON_LENGTH = 4.3;
const RIBBON_SEGMENTS = 56;
const SCROLL_SPEED = 0.55;
const TURN_ANGLE = (35 * Math.PI) / 180;
const TURN_LOOKAHEAD = 3.5;
const TURN_SIGN_HIDE = 0.85;
const TURN_SIGN_HEIGHT = 0.5;
const TURN_SIGN_SCALE = 0.9;
const REJOIN_DIST = 0.6;
const ARRIVE_DIST = 0.4;

const FAN_SWEEP_STEP = (7.5 * Math.PI) / 180;
const FAN_SWEEP_HALF = Math.PI / 2;
const FAN_MAX_REACH = 2.2;
const FAN_MIN_OPEN = 1.25;
const FAN_FIRST = 0.95;
const FAN_FIRST_ELEVATED = 1.15;
const FAN_STEP = 0.32;
const FAN_EDGE_REL = 0.52;
const FAN_EDGE_DIST = 1.2;
const FAN_PROBE_RADIUS = 0.2;
const FAN_MAX_OPENINGS = 4;
const FAN_CHEVRONS = 4;
const ROOM_BOUNDS = { minX: -4.35, maxX: 3.85, minZ: -3.25, maxZ: 3.45 };

export const GUIDANCE_COLORS = {
  GREEN: 0x38bdf8,
  YELLOW: 0xf59e0b,
  RED: 0xef4444,
  ARRIVED: 0x34d399,
  FREE: 0x7dd3fc
};

const WHITE = new THREE.Color(0xffffff);
const SHADOW_COLOR = 0x020617;
const _fanCore = new THREE.Color();

const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

function overlayMaterial(color, opacity, additive = false) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
  });
}

function overlayMesh(geo, mat, order = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = RENDER_ORDER + order;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  return mesh;
}

// Flat chevron lying on the floor, tip pointing local +Z
function createChevronGeometry(width = 0.28) {
  const hw = width / 2;
  const s = new THREE.Shape();
  s.moveTo(0, 0.085);
  s.lineTo(hw, 0.085 - hw);
  s.lineTo(hw, 0.085 - hw - 0.07);
  s.lineTo(0, 0.015);
  s.lineTo(-hw, 0.085 - hw - 0.07);
  s.lineTo(-hw, 0.085 - hw);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, 0.02);
  return geo;
}

// Standing turn arrow in the XY plane (faces +Z), pointing right; mirror X for left
function createTurnArrowShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.1, -0.18);
  s.lineTo(-0.04, -0.18);
  s.lineTo(-0.04, 0.02);
  s.lineTo(0.06, 0.02);
  s.lineTo(0.06, -0.035);
  s.lineTo(0.165, 0.05);
  s.lineTo(0.06, 0.135);
  s.lineTo(0.06, 0.08);
  s.lineTo(-0.02, 0.08);
  s.quadraticCurveTo(-0.1, 0.08, -0.1, 0.0);
  s.closePath();
  return s;
}

function createUturnArrowShape() {
  const s = new THREE.Shape();
  s.moveTo(0.04, -0.18);
  s.lineTo(0.1, -0.18);
  s.lineTo(0.1, 0.02);
  s.absarc(0, 0.02, 0.1, 0, Math.PI, false);
  s.lineTo(-0.1, -0.06);
  s.lineTo(-0.15, -0.06);
  s.lineTo(-0.07, -0.16);
  s.lineTo(0.01, -0.06);
  s.lineTo(-0.04, -0.06);
  s.lineTo(-0.04, 0.02);
  s.absarc(0, 0.02, 0.04, Math.PI, 0, true);
  s.closePath();
  return s;
}

function createStraightArrowShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.03, -0.18);
  s.lineTo(0.03, -0.18);
  s.lineTo(0.03, 0.04);
  s.lineTo(0.09, 0.04);
  s.lineTo(0, 0.16);
  s.lineTo(-0.09, 0.04);
  s.lineTo(-0.03, 0.04);
  s.closePath();
  return s;
}

const RIBBON_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RIBBON_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uLength;
  uniform float uFlow;
  varying vec2 vUv;
  void main() {
    float across = abs(vUv.x - 0.5) * 2.0;
    float edge = smoothstep(0.72, 0.96, across) * (1.0 - smoothstep(0.96, 1.0, across));
    float core = (1.0 - smoothstep(0.0, 0.9, across)) * 0.16;
    float along = vUv.y;
    float fade = smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.62, 1.0, along));
    float meters = along * uLength;
    float dash = smoothstep(0.55, 1.0, sin((meters - uTime * uFlow) * 7.0) * 0.5 + 0.5) * 0.22 * (1.0 - across);
    float a = (edge * 0.75 + core + dash) * fade * uOpacity;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), edge * 0.35), a);
  }
`;

const PILLAR_VERT = RIBBON_VERT;
const PILLAR_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float h = vUv.y;
    float fall = pow(1.0 - h, 1.6);
    float bands = smoothstep(0.75, 1.0, sin((h * 9.0 - uTime * 1.6) * 3.14159) * 0.5 + 0.5) * 0.35;
    float a = (fall * 0.55 + bands * fall) * uOpacity;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.18), a);
  }
`;

function shaderOverlay(vertexShader, fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

export function createArGuidanceRig() {
  const root = new THREE.Group();
  root.name = 'ArGuidanceRig';
  root.visible = false;

  // Lane ribbon (positions rewritten every frame along the upcoming route)
  const ribbonGeo = new THREE.BufferGeometry();
  const vCount = (RIBBON_SEGMENTS + 1) * 2;
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vCount * 3), 3));
  const uvs = new Float32Array(vCount * 2);
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const v = i / RIBBON_SEGMENTS;
    uvs.set([0, v, 1, v], i * 4);
  }
  ribbonGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const idx = [];
  for (let i = 0; i < RIBBON_SEGMENTS; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  ribbonGeo.setIndex(idx);
  const ribbonMat = shaderOverlay(RIBBON_VERT, RIBBON_FRAG, {
    uColor: { value: new THREE.Color(GUIDANCE_COLORS.GREEN) },
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uLength: { value: RIBBON_LENGTH },
    uFlow: { value: SCROLL_SPEED }
  });
  const ribbon = overlayMesh(ribbonGeo, ribbonMat, 0);
  ribbon.visible = false;
  root.add(ribbon);

  // Route chevrons with additive glow underlays
  const chevronGeo = createChevronGeometry(0.28);
  const chevrons = [];
  for (let i = 0; i < CHEVRON_COUNT; i++) {
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    const shadow = overlayMesh(chevronGeo, overlayMaterial(SHADOW_COLOR, 0.3), 0);
    shadow.scale.set(1.12, 1, 1.18);
    const glow = overlayMesh(chevronGeo, overlayMaterial(GUIDANCE_COLORS.GREEN, 0.3, true), 1);
    glow.scale.set(1.25, 1, 1.32);
    const core = overlayMesh(chevronGeo, overlayMaterial(0xffffff, 0.9), 2);
    group.add(shadow, glow, core);
    root.add(group);
    chevrons.push({ group, shadow, glow, core });
  }

  // RED hold line across the lane
  const holdGroup = new THREE.Group();
  holdGroup.rotation.order = 'YXZ';
  const holdBar = overlayMesh(new THREE.PlaneGeometry(0.72, 0.06).rotateX(-Math.PI / 2), overlayMaterial(GUIDANCE_COLORS.RED, 0.95), 3);
  const holdGlow = overlayMesh(new THREE.PlaneGeometry(0.9, 0.22).rotateX(-Math.PI / 2), overlayMaterial(GUIDANCE_COLORS.RED, 0.35, true), 2);
  const holdStripes = [];
  for (let i = 0; i < 4; i++) {
    const stripe = overlayMesh(new THREE.PlaneGeometry(0.11, 0.035).rotateX(-Math.PI / 2), overlayMaterial(0xffffff, 0.85), 4);
    stripe.position.set(-0.27 + i * 0.18, 0.001, 0);
    holdStripes.push(stripe);
    holdGroup.add(stripe);
  }
  holdGroup.add(holdGlow, holdBar);
  holdGroup.visible = false;
  root.add(holdGroup);

  // Floating billboard turn sign
  const turnSign = new THREE.Group();
  const plate = overlayMesh(new THREE.CircleGeometry(0.235, 48), overlayMaterial(0x0b1220, 0.78), 5);
  const plateRing = overlayMesh(new THREE.RingGeometry(0.235, 0.255, 64), overlayMaterial(GUIDANCE_COLORS.GREEN, 0.95), 6);
  const plateHalo = overlayMesh(new THREE.RingGeometry(0.255, 0.34, 64), overlayMaterial(GUIDANCE_COLORS.GREEN, 0.22, true), 5);
  const arrowGeos = {
    right: new THREE.ShapeGeometry(createTurnArrowShape()),
    left: new THREE.ShapeGeometry(createTurnArrowShape()).scale(-1, 1, 1),
    uturn: new THREE.ShapeGeometry(createUturnArrowShape()),
    straight: new THREE.ShapeGeometry(createStraightArrowShape())
  };
  const arrowMat = overlayMaterial(0xffffff, 1);
  const arrow = overlayMesh(arrowGeos.right, arrowMat, 7);
  arrow.position.z = 0.002;
  const stem = overlayMesh(new THREE.PlaneGeometry(0.012, 1), overlayMaterial(GUIDANCE_COLORS.GREEN, 0.5, true), 4);
  turnSign.add(plateHalo, plate, plateRing, arrow, stem);
  turnSign.visible = false;
  root.add(turnSign);
  const turnFloorMark = overlayMesh(new THREE.RingGeometry(0.16, 0.2, 48).rotateX(-Math.PI / 2), overlayMaterial(GUIDANCE_COLORS.GREEN, 0.7, true), 1);
  turnFloorMark.visible = false;
  root.add(turnFloorMark);

  // Destination beacon
  const beacon = new THREE.Group();
  const beaconRing = overlayMesh(new THREE.RingGeometry(0.2, 0.235, 64).rotateX(-Math.PI / 2), overlayMaterial(GUIDANCE_COLORS.GREEN, 0.95), 1);
  const beaconPulse = overlayMesh(new THREE.RingGeometry(0.2, 0.225, 64).rotateX(-Math.PI / 2), overlayMaterial(GUIDANCE_COLORS.GREEN, 0.6, true), 1);
  const beaconDisc = overlayMesh(new THREE.CircleGeometry(0.2, 48).rotateX(-Math.PI / 2), overlayMaterial(GUIDANCE_COLORS.GREEN, 0.14, true), 0);
  const pillarMat = shaderOverlay(PILLAR_VERT, PILLAR_FRAG, {
    uColor: { value: new THREE.Color(GUIDANCE_COLORS.GREEN) },
    uTime: { value: 0 },
    uOpacity: { value: 1 }
  });
  const pillar = overlayMesh(new THREE.CylinderGeometry(0.07, 0.11, 1.55, 24, 1, true), pillarMat, 2);
  pillar.position.y = 1.55 / 2;
  const diamondMat = overlayMaterial(GUIDANCE_COLORS.GREEN, 0.95);
  const diamond = overlayMesh(new THREE.OctahedronGeometry(0.075, 0), diamondMat, 3);
  diamond.scale.set(1, 1.45, 1);
  diamond.position.y = 1.2;
  const diamondEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.076, 0)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
  );
  diamondEdges.renderOrder = RENDER_ORDER + 4;
  diamondEdges.frustumCulled = false;
  diamondEdges.raycast = () => {};
  diamond.add(diamondEdges);
  beacon.add(beaconDisc, beaconRing, beaconPulse, pillar, diamond);
  beacon.visible = false;
  root.add(beacon);

  // Free-roam open-direction fan (one chevron trail per detected opening)
  const fanChevronGeo = createChevronGeometry(0.22);
  const fan = [];
  for (let o = 0; o < FAN_MAX_OPENINGS; o++) {
    const items = [];
    for (let k = 0; k < FAN_CHEVRONS; k++) {
      const group = new THREE.Group();
      group.rotation.order = 'YXZ';
      const shadow = overlayMesh(fanChevronGeo, overlayMaterial(SHADOW_COLOR, 0.3), 0);
      shadow.scale.set(1.12, 1, 1.18);
      const glow = overlayMesh(fanChevronGeo, overlayMaterial(GUIDANCE_COLORS.FREE, 0.25, true), 1);
      glow.scale.set(1.25, 1, 1.32);
      const core = overlayMesh(fanChevronGeo, overlayMaterial(0xffffff, 0.85), 2);
      group.add(shadow, glow, core);
      group.visible = false;
      root.add(group);
      items.push({ group, shadow, glow, core });
    }
    fan.push({ items });
  }

  root.userData = {
    ribbon,
    ribbonGeo,
    ribbonMat,
    chevrons,
    holdGroup,
    holdBar,
    holdGlow,
    turnSign,
    turnFloorMark,
    plateRing,
    plateHalo,
    stem,
    arrow,
    arrowGeos,
    beacon,
    beaconRing,
    beaconPulse,
    beaconDisc,
    pillarMat,
    diamond,
    diamondMat,
    fan,
    fanScan: null,
    color: new THREE.Color(GUIDANCE_COLORS.GREEN),
    coreColor: new THREE.Color(0xffffff),
    scroll: 0,
    lastNow: 0
  };
  return root;
}

export function disposeArGuidanceRig(rig) {
  if (!rig) return;
  const geos = new Set();
  const mats = new Set();
  rig.traverse((obj) => {
    if (obj.geometry) geos.add(obj.geometry);
    if (obj.material) mats.add(obj.material);
  });
  Object.values(rig.userData.arrowGeos || {}).forEach((g) => geos.add(g));
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
}

/** Prepares a 2D (x, z) polyline with cumulative arc lengths */
export function buildRoute(points) {
  if (!points || points.length < 2) return null;
  const pts = [];
  for (const p of points) {
    const x = p[0];
    const z = p.length > 2 ? p[2] : p[1];
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(x - prev[0], z - prev[1]) < 1e-4) continue;
    pts.push([x, z]);
  }
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, total: cum[cum.length - 1] };
}

/** Nearest arc-length position on the route to (x, z) */
export function projectOntoRoute(route, x, z) {
  let best = { arc: 0, dist: Infinity, x: route.pts[0][0], z: route.pts[0][1], seg: 0 };
  for (let i = 1; i < route.pts.length; i++) {
    const [ax, az] = route.pts[i - 1];
    const [bx, bz] = route.pts[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.dist) {
      best = { arc: route.cum[i - 1] + Math.sqrt(len2) * t, dist: d, x: px, z: pz, seg: i - 1 };
    }
  }
  return best;
}

function pointAtArc(route, s, out) {
  const { pts, cum, total } = route;
  const c = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < c) i++;
  const segLen = cum[i] - cum[i - 1];
  const t = segLen > 1e-6 ? (c - cum[i - 1]) / segLen : 0;
  out.x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
  out.z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
  return out;
}

const _pa = { x: 0, z: 0 };
const _pb = { x: 0, z: 0 };

/** Position plus smoothed heading at arc length s (heading looks across corners for soft bends) */
export function sampleRouteAt(route, s, out = { x: 0, z: 0, h: 0 }) {
  pointAtArc(route, s, out);
  const span = 0.14;
  pointAtArc(route, Math.max(0, s - span), _pa);
  pointAtArc(route, Math.min(route.total, s + span), _pb);
  const dx = _pb.x - _pa.x;
  const dz = _pb.z - _pa.z;
  if (Math.abs(dx) + Math.abs(dz) > 1e-6) out.h = Math.atan2(dx, dz);
  return out;
}

/** Positions and headings along the remaining route */
export function sampleRouteAhead(route, startArc, length, step) {
  const out = [];
  for (let d = 0; d <= length + 1e-6; d += step) {
    if (startArc + d > route.total) break;
    out.push(sampleRouteAt(route, startArc + d, { x: 0, z: 0, h: 0 }));
  }
  return out;
}

const segHeading = (route, i) =>
  Math.atan2(route.pts[i + 1][0] - route.pts[i][0], route.pts[i + 1][1] - route.pts[i][1]);

/** First vertex ahead of startArc where the route bends sharply (consecutive small bends are accumulated) */
export function findNextTurn(route, startArc, maxDist = TURN_LOOKAHEAD) {
  const { pts, cum } = route;
  for (let i = 1; i < pts.length - 1; i++) {
    if (cum[i] <= startArc + 0.05) continue;
    const dist = cum[i] - startArc;
    if (dist > maxDist) break;
    const h0 = segHeading(route, i - 1);
    let j = i;
    let delta = wrapAngle(segHeading(route, j) - h0);
    while (Math.abs(delta) < TURN_ANGLE && j + 1 < pts.length - 1 && cum[j + 1] - cum[i] < 0.6) {
      j++;
      delta = wrapAngle(segHeading(route, j) - h0);
    }
    if (Math.abs(delta) >= TURN_ANGLE) {
      const direction = Math.abs(delta) > (150 * Math.PI) / 180 ? 'uturn' : delta > 0 ? 'left' : 'right';
      return { dist, direction, x: pts[i][0], z: pts[i][1], angle: delta };
    }
  }
  return null;
}

function setOverlayColor(mat, hex) {
  if (mat.uniforms?.uColor) mat.uniforms.uColor.value.setHex(hex);
  else mat.color.setHex(hex);
}

function hideRouteVisuals(ud) {
  ud.ribbon.visible = false;
  ud.chevrons.forEach((c) => (c.group.visible = false));
  ud.holdGroup.visible = false;
  ud.turnSign.visible = false;
  ud.turnFloorMark.visible = false;
}

function hideFan(ud) {
  ud.fan.forEach((f) => f.items.forEach((it) => (it.group.visible = false)));
}

const _s = { x: 0, z: 0, h: 0 };

/**
 * Lays out and animates the guidance rig for this frame and returns HUD data.
 * route: { points, progress?, manual?, targetLabel, targetPos?, speed, onSite? } or null for free roam.
 * elevated: float and tilt the chevrons toward the viewer (1st-person eye view).
 */
export function updateArGuidance(
  rig,
  { now, position, tangent, route, signal, obstacles, camera, isPointInObstacle, elevated = false }
) {
  const ud = rig.userData;
  const t = now * 0.001;
  const dt = ud.lastNow ? Math.min(0.1, (now - ud.lastNow) / 1000) : 0;
  ud.lastNow = now;
  ud.markY = elevated ? FLOOR_Y + FLOAT_HEIGHT : FLOOR_Y + LIFT + 0.002;
  ud.markTilt = elevated ? FLOAT_TILT : 0;
  ud.markScale = elevated ? FLOAT_SCALE : 1;
  ud.markStart = elevated ? FLOAT_START : RIBBON_START;

  const px = position[0];
  const pz = position[2];
  const heading = Math.atan2(tangent[0], tangent[2]);
  const light = signal?.light || 'GREEN';
  const isHold = light === 'RED';
  const colorHex = isHold ? GUIDANCE_COLORS.RED : light === 'YELLOW' ? GUIDANCE_COLORS.YELLOW : GUIDANCE_COLORS.GREEN;

  ud.color.setHex(colorHex);
  ud.coreColor.copy(ud.color).lerp(WHITE, 0.3);
  if (!isHold) ud.scroll = (ud.scroll + dt * SCROLL_SPEED) % CHEVRON_SPACING;

  const built = route?.points ? buildRoute(route.points) : null;

  // On site at the target asset: beacon only
  if (route?.onSite && route.targetPos) {
    hideRouteVisuals(ud);
    hideFan(ud);
    placeBeacon(ud, route.targetPos[0], route.targetPos[2], GUIDANCE_COLORS.ARRIVED, t, camera);
    return { mode: 'onsite', maneuver: 'arrive', targetLabel: route.targetLabel, remaining: 0, progress: 1 };
  }

  if (!built || built.total < 0.05) {
    hideRouteVisuals(ud);
    ud.beacon.visible = false;
    const openDirs = layoutFan(ud, px, pz, heading, obstacles, isPointInObstacle, t, isHold);
    return { mode: isHold ? 'hold' : 'free', maneuver: 'free', openDirs, targetLabel: null };
  }
  hideFan(ud);

  // Where along the route the technician is
  let arc;
  let offRoute = 0;
  const proj = projectOntoRoute(built, px, pz);
  if (!route.manual && Number.isFinite(route.progress)) {
    arc = Math.max(0, Math.min(1, route.progress)) * built.total;
    pointAtArc(built, arc, _pa);
    if (Math.hypot(_pa.x - px, _pa.z - pz) > REJOIN_DIST * 1.5) arc = proj.arc;
  } else {
    arc = proj.arc;
    offRoute = proj.dist;
  }

  // Off-route: prepend a leg from the technician to the nearest route point
  let guide = built;
  let guideArc = 0;
  const rejoin = offRoute > REJOIN_DIST;
  if (rejoin) {
    const pts = [[px, -1, pz], [proj.x, -1, proj.z]];
    for (let i = proj.seg + 1; i < built.pts.length; i++) pts.push([built.pts[i][0], -1, built.pts[i][1]]);
    guide = buildRoute(pts) || built;
  } else {
    guideArc = arc;
  }

  const remaining = Math.max(0, guide.total - guideArc);
  const end = built.pts[built.pts.length - 1];
  const beaconX = route.targetPos ? route.targetPos[0] : end[0];
  const beaconZ = route.targetPos ? route.targetPos[2] : end[1];

  if (remaining < ARRIVE_DIST) {
    hideRouteVisuals(ud);
    placeBeacon(ud, beaconX, beaconZ, GUIDANCE_COLORS.ARRIVED, t, camera);
    return { mode: 'arrived', maneuver: 'arrive', targetLabel: route.targetLabel, remaining, progress: 1 };
  }

  const laneOffset = light === 'YELLOW' ? signal?.laneOffset || 0 : 0;
  const lateral = (h) => [-Math.cos(h) * laneOffset, Math.sin(h) * laneOffset];

  ud.ribbon.visible = false;
  layoutChevrons(ud, guide, guideArc, remaining, lateral, t, isHold);

  // RED: hold line ahead across the lane
  if (isHold) {
    const holdArc = Math.min(guideArc + (elevated ? 1.3 : 0.95), guide.total);
    sampleRouteAt(guide, holdArc, _s);
    const [ox, oz] = lateral(_s.h);
    ud.holdGroup.visible = true;
    ud.holdGroup.position.set(_s.x + ox, ud.markY, _s.z + oz);
    ud.holdGroup.rotation.set(-ud.markTilt, _s.h, 0);
    ud.holdGroup.scale.setScalar(elevated ? 0.7 : 1);
    const p = 0.65 + 0.35 * Math.sin(t * 6);
    ud.holdBar.material.opacity = 0.75 + 0.25 * p;
    ud.holdGlow.material.opacity = 0.2 + 0.25 * p;
  } else {
    ud.holdGroup.visible = false;
  }

  // Next turn sign
  const turn = findNextTurn(guide, guideArc);
  const signFade = turn ? Math.max(0, Math.min(1, (turn.dist - TURN_SIGN_HIDE) / 0.4)) : 0;
  if (turn && signFade > 0.01) {
    const bob = Math.sin(t * 2.4) * 0.02;
    const appear = Math.min(1, (TURN_LOOKAHEAD - turn.dist) / 0.6 + 0.2) * signFade;
    const signY = FLOOR_Y + TURN_SIGN_HEIGHT + bob;
    ud.turnSign.visible = true;
    ud.turnSign.position.set(turn.x, signY, turn.z);
    const signScale = TURN_SIGN_SCALE * (0.85 + 0.15 * appear);
    ud.turnSign.scale.setScalar(signScale);
    if (camera) ud.turnSign.lookAt(camera.position.x, signY, camera.position.z);
    ud.arrow.geometry = ud.arrowGeos[turn.direction] || ud.arrowGeos.right;
    ud.arrow.material.color.copy(ud.coreColor).lerp(WHITE, 0.6);
    setOverlayColor(ud.plateRing.material, colorHex);
    setOverlayColor(ud.plateHalo.material, colorHex);
    setOverlayColor(ud.stem.material, colorHex);
    ud.plateHalo.material.opacity = (0.16 + 0.12 * Math.sin(t * 4)) * appear;
    ud.plateRing.material.opacity = 0.95 * appear;
    ud.arrow.material.opacity = appear;
    ud.stem.material.opacity = 0.5 * appear;
    const stemLen = Math.max(0.01, (TURN_SIGN_HEIGHT + bob) / signScale - 0.235);
    ud.stem.scale.y = stemLen;
    ud.stem.position.y = -0.235 - stemLen / 2;
    ud.turnFloorMark.visible = true;
    ud.turnFloorMark.position.set(turn.x, FLOOR_Y + LIFT, turn.z);
    const ms = 1 + ((t * 0.9) % 1) * 0.6;
    ud.turnFloorMark.scale.set(ms, 1, ms);
    setOverlayColor(ud.turnFloorMark.material, colorHex);
    ud.turnFloorMark.material.opacity = 0.7 * (1 - ((t * 0.9) % 1)) * appear;
  } else {
    ud.turnSign.visible = false;
    ud.turnFloorMark.visible = false;
  }

  placeBeacon(ud, beaconX, beaconZ, isHold ? GUIDANCE_COLORS.RED : colorHex, t, camera);

  const speed = route.speed || 1.6;
  const mode = isHold ? 'hold' : rejoin ? 'rejoin' : light === 'YELLOW' ? 'yield' : 'route';
  return {
    mode,
    maneuver: turn ? turn.direction : 'straight',
    distToTurn: turn ? turn.dist : null,
    remaining,
    rejoinDist: rejoin ? offRoute : 0,
    eta: remaining / Math.max(0.2, speed),
    progress: built.total > 0 ? Math.max(0, Math.min(1, arc / built.total)) : 0,
    targetLabel: route.targetLabel
  };
}

function layoutChevrons(ud, guide, startArc, remaining, lateral, t, isHold) {
  const span = CHEVRON_COUNT * CHEVRON_SPACING;
  const pulsePhase = (t * 0.75) % 1;
  const start = ud.markStart;
  ud.chevrons.forEach((c, i) => {
    const d = start + i * CHEVRON_SPACING + ud.scroll;
    if (d > remaining - 0.1) {
      c.group.visible = false;
      return;
    }
    sampleRouteAt(guide, startArc + d, _s);
    const [ox, oz] = lateral(_s.h);
    c.group.visible = true;
    c.group.position.set(_s.x + ox, ud.markY, _s.z + oz);
    c.group.rotation.set(-ud.markTilt, _s.h, 0);

    const f = (d - start) / span;
    const fadeIn = Math.min(1, (d - start) / 0.35);
    const fadeOut = 1 - Math.max(0, (f - 0.55) / 0.45);
    const endFade = Math.min(1, (remaining - d) / 0.5);
    const vis = Math.max(0, fadeIn * fadeOut * endFade);
    const wave = isHold ? 0 : Math.exp(-((f - pulsePhase) ** 2) / 0.012);
    const base = isHold ? 0.35 : 0.72;

    c.core.material.color.copy(ud.coreColor).lerp(WHITE, wave * 0.6);
    c.core.material.opacity = Math.min(1, (base + wave * 0.35) * vis);
    c.glow.material.color.copy(ud.color);
    c.glow.material.opacity = (0.22 + wave * 0.45) * vis;
    c.shadow.material.opacity = 0.32 * vis;
    c.group.scale.setScalar(ud.markScale * (1 + wave * 0.12));
  });
}

function placeBeacon(ud, x, z, hex, t, camera) {
  const b = ud.beacon;
  b.visible = true;
  b.position.set(x, FLOOR_Y + LIFT, z);
  setOverlayColor(ud.beaconRing.material, hex);
  setOverlayColor(ud.beaconPulse.material, hex);
  setOverlayColor(ud.beaconDisc.material, hex);
  setOverlayColor(ud.pillarMat, hex);
  setOverlayColor(ud.diamondMat, hex);
  const phase = (t * 0.8) % 1;
  const ps = 1 + phase * 1.6;
  ud.beaconPulse.scale.set(ps, 1, ps);
  ud.beaconPulse.material.opacity = 0.7 * (1 - phase);
  ud.pillarMat.uniforms.uTime.value = t;
  let near = 1;
  if (camera) {
    const d = Math.hypot(camera.position.x - x, camera.position.z - z);
    near = Math.min(1, Math.max(0.25, (d - 0.3) / 1.2));
  }
  ud.pillarMat.uniforms.uOpacity.value = near;
  ud.diamond.position.y = 1.2 + Math.sin(t * 2) * 0.04;
  ud.diamond.rotation.y = t * 1.4;
  ud.diamondMat.opacity = 0.6 + 0.35 * near;
}

const openingLabel = (rel) => {
  const deg = Math.abs((rel * 180) / Math.PI);
  if (deg <= 15) return 'Ahead';
  const side = rel > 0 ? 'left' : 'right';
  return deg <= 55 ? `Bear ${side}` : side === 'left' ? 'Left' : 'Right';
};

/** Sweeps headings around the technician and groups clear ones into walkable openings */
function scanOpenings(px, pz, heading, obstacles, isPointInObstacle) {
  const blocked = (x, z) =>
    x < ROOM_BOUNDS.minX ||
    x > ROOM_BOUNDS.maxX ||
    z < ROOM_BOUNDS.minZ ||
    z > ROOM_BOUNDS.maxZ ||
    Boolean(isPointInObstacle && isPointInObstacle(x, z, FAN_PROBE_RADIUS, obstacles));

  const sweep = [];
  for (let rel = -FAN_SWEEP_HALF; rel <= FAN_SWEEP_HALF + 1e-6; rel += FAN_SWEEP_STEP) {
    const h = heading + rel;
    const dx = Math.sin(h);
    const dz = Math.cos(h);
    let free = 0;
    for (let d = 0.25; d <= FAN_MAX_REACH + 1e-6; d += 0.1) {
      if (blocked(px + dx * d, pz + dz * d)) break;
      free = d;
    }
    sweep.push({ rel, free });
  }

  // Contiguous clear runs, split so one wide open area still yields ahead / bear-left / bear-right options
  const maxRun = 7;
  const candidates = [];
  let run = [];
  const flush = () => {
    for (let i = 0; i < run.length; i += maxRun) {
      const chunk = run.slice(i, i + maxRun);
      const mid = chunk[Math.floor(chunk.length / 2)].rel;
      let best = chunk[0];
      for (const s of chunk) {
        if (s.free > best.free + 1e-6 || (Math.abs(s.free - best.free) < 1e-6 && Math.abs(s.rel - mid) < Math.abs(best.rel - mid))) {
          best = s;
        }
      }
      candidates.push(best);
    }
    run = [];
  };
  for (const s of sweep) {
    if (s.free >= FAN_MIN_OPEN) run.push(s);
    else if (run.length) flush();
  }
  if (run.length) flush();

  return candidates
    .sort((a, b) => b.free - Math.abs(b.rel) * 0.4 - (a.free - Math.abs(a.rel) * 0.4))
    .slice(0, FAN_MAX_OPENINGS)
    .sort((a, b) => b.rel - a.rel)
    .map((c) => ({ ...c, label: openingLabel(c.rel) }));
}

function layoutFan(ud, px, pz, heading, obstacles, isPointInObstacle, t, isHold) {
  const now = t * 1000;
  const prev = ud.fanScan;
  if (
    !prev ||
    Math.hypot(px - prev.x, pz - prev.z) > 0.03 ||
    Math.abs(wrapAngle(heading - prev.heading)) > 0.03 ||
    now - prev.at > 250
  ) {
    ud.fanScan = { x: px, z: pz, heading, at: now, openings: scanOpenings(px, pz, heading, obstacles, isPointInObstacle) };
  }
  const { openings } = ud.fanScan;

  const colorHex = isHold ? GUIDANCE_COLORS.RED : GUIDANCE_COLORS.FREE;
  const coreCol = _fanCore.setHex(colorHex).lerp(WHITE, 0.3);
  const phase = (t * 1.1) % 1;

  ud.fan.forEach((slot, o) => {
    const opening = openings[o];
    const isWide = opening && Math.abs(opening.rel) > FAN_EDGE_REL;
    const h = opening ? heading + opening.rel : 0;
    // Wide openings would sit outside the 1st-person view: anchor them at the view edge, sweeping toward the opening
    const anchorH = opening ? heading + Math.sign(opening.rel) * FAN_EDGE_REL : 0;
    const edgeDist = FAN_EDGE_DIST + (ud.markTilt ? 0.2 : 0);
    const anchorX = px + Math.sin(anchorH) * edgeDist;
    const anchorZ = pz + Math.cos(anchorH) * edgeDist;
    slot.items.forEach((it, k) => {
      const d = (ud.markTilt ? FAN_FIRST_ELEVATED : FAN_FIRST) + k * FAN_STEP;
      const show = Boolean(opening) && (isWide ? k < FAN_CHEVRONS - 1 : d <= opening.free - 0.05);
      it.group.visible = show;
      if (!show) return;
      if (isWide) {
        it.group.position.set(anchorX + Math.sin(h) * k * 0.24, ud.markY, anchorZ + Math.cos(h) * k * 0.24);
      } else {
        it.group.position.set(px + Math.sin(h) * d, ud.markY, pz + Math.cos(h) * d);
      }
      it.group.rotation.set(-ud.markTilt, h, 0);
      it.group.scale.setScalar(ud.markScale);
      const f = k / (FAN_CHEVRONS - 1);
      const wave = isHold ? 0 : Math.exp(-((f - phase) ** 2) / 0.05);
      const strength = Math.abs(opening.rel) <= 0.27 ? 1 : 0.75;
      const vis = strength * (1 - f * 0.35);
      it.core.material.color.copy(coreCol);
      it.core.material.opacity = Math.min(1, (0.55 + wave * 0.4) * vis);
      it.glow.material.color.setHex(colorHex);
      it.glow.material.opacity = (0.18 + wave * 0.4) * vis;
      it.shadow.material.opacity = 0.3 * vis;
    });
  });
  return [...new Set(openings.map((o) => o.label))];
}
