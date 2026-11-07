/**
 * Moves an extracted object in the Spark 3DGS scene: hides its original splats with a SplatEdit box and draws a
 * copy of those splats (editable=false) at the new pose. A TransformControls gizmo drives a live preview; a ghost
 * box (green / amber / red by feasibility verdict) carries gap labels on its four sides.
 *
 * Frames: OBBs are ply_raw (inside the display group rotated PI about X). Edits are in the world/display frame
 * (x, -y_ply, -z_ply): translation on the floor plus yaw about +y through the box centre (backend/scene_edit).
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  PackedSplats,
  SplatMesh,
  SplatEdit,
  SplatEditRgbaBlendMode,
  SplatEditSdf,
  SplatEditSdfType
} from '@sparkjsdev/spark';

const D = new THREE.Matrix4().makeScale(1, -1, -1); // raw <-> display (its own inverse)
const FLOOR_RAW_Y = 1.183 - 0.04; // world floor -1.183 (data/derived/transform.json) + floor-slab skip
const VERDICT_COLOR = { allowed: 0x2e7d32, warning: 0xe06c00, blocked: 0xc62828, pending: 0x1f6fb2 };

function rawBox(obj) {
  const { center, extent, rotation } = obj.obb;
  const R = new THREE.Matrix4().set(
    rotation[0][0], rotation[0][1], rotation[0][2], 0,
    rotation[1][0], rotation[1][1], rotation[1][2], 0,
    rotation[2][0], rotation[2][1], rotation[2][2], 0,
    0, 0, 0, 1
  );
  return { c: new THREE.Vector3(...center), e: new THREE.Vector3(...extent), R };
}

/** World-frame matrix of one edit applied about the object's current centre (display frame). */
function editMatrixWorld(centreW, translate, yawDeg) {
  const t = new THREE.Vector3(translate[0], 0, translate[2]);
  return new THREE.Matrix4()
    .makeTranslation(centreW.x + t.x, centreW.y, centreW.z + t.z)
    .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(yawDeg)))
    .multiply(new THREE.Matrix4().makeTranslation(-centreW.x, -centreW.y, -centreW.z));
}

const toRaw = (mWorld) => D.clone().multiply(mWorld).multiply(D);

function labelSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false })
  );
  sprite.scale.set(0.075, 0.025, 1); // constant on-screen size
  sprite.renderOrder = 999;
  sprite.userData.draw = (text, color) => {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 192, 64);
    g.fillStyle = 'rgba(16,22,28,0.82)';
    g.fillRect(0, 8, 192, 48);
    g.fillStyle = color;
    g.font = 'bold 30px JetBrains Mono, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 96, 33);
    tex.needsUpdate = true;
  };
  return sprite;
}

export function createSplatMover(ctx, { onChange, onDragEnd }) {
  const { scene, camera, renderer, controls, displayGroup, getSplatMesh } = ctx;
  const entries = new Map(); // objectId -> { copy, hide, committedWorld: Matrix4, base: obj }
  let active = null;
  let throttle = null;

  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSpace('world');
  gizmo.size = 0.8;
  const helper = gizmo.getHelper ? gizmo.getHelper() : gizmo;
  scene.add(helper);
  const proxy = new THREE.Object3D();
  scene.add(proxy);

  gizmo.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    if (!e.value && active) onDragEnd?.(currentDelta());
  });
  gizmo.addEventListener('objectChange', () => {
    if (!active) return;
    updateLive();
    clearTimeout(throttle);
    throttle = setTimeout(() => onChange?.(currentDelta()), 220);
  });

  function ensureEntry(obj) {
    if (entries.has(obj.object_id)) return entries.get(obj.object_id);
    const mesh = getSplatMesh?.();
    const { c, e, R } = rawBox(obj);
    // a movable may be a union of boxes (it touches a neighbour); test every part
    const parts = (obj.parts?.length ? obj.parts : [obj.obb]).map((obb) => {
      const b = rawBox({ obb });
      return { ...b, Rt: b.R.clone().transpose(), half: b.e.clone().multiplyScalar(0.5) };
    });
    const packed = new PackedSplats();
    const p = new THREE.Vector3();
    let n = 0;
    if (mesh?.forEachSplat) {
      mesh.forEachSplat((i, centre, scales, quat, opacity, color) => {
        if (centre.y > FLOOR_RAW_Y) return; // floor slab (raw y is down)
        for (const b of parts) {
          p.copy(centre).sub(b.c).applyMatrix4(b.Rt);
          if (Math.abs(p.x) <= b.half.x && Math.abs(p.y) <= b.half.y && Math.abs(p.z) <= b.half.z) {
            packed.pushSplat(centre, scales, quat, opacity, color);
            n += 1;
            break;
          }
        }
      });
    }
    let copy = null;
    if (n > 0) {
      copy = new SplatMesh({ packedSplats: packed, editable: false });
      copy.matrixAutoUpdate = false;
      displayGroup.add(copy);
    } else {
      // fallback: solid proxy box when the splats cannot be copied
      copy = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x8a949e, transparent: true, opacity: 0.65 })
      );
      copy.matrixAutoUpdate = false;
      copy.userData.boxBase = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(R).multiply(new THREE.Matrix4().makeScale(e.x, e.y, e.z));
      displayGroup.add(copy);
    }
    const hide = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, softEdge: 0.01 });
    parts.forEach((b) => {
      const sdf = new SplatEditSdf({ type: SplatEditSdfType.BOX, opacity: 0 });
      sdf.position.copy(b.c);
      sdf.quaternion.setFromRotationMatrix(b.R);
      sdf.scale.copy(b.half.clone().addScalar(0.005)); // hide a hair wider than the copy
      hide.add(sdf);
    });
    hide.visible = false;
    displayGroup.add(hide);
    const entry = { copy, hide, committedWorld: new THREE.Matrix4(), base: obj, splats: n };
    entries.set(obj.object_id, entry);
    setEntryMatrix(entry, entry.committedWorld);
    return entry;
  }

  function setEntryMatrix(entry, mWorld) {
    const mRaw = toRaw(mWorld);
    entry.copy.matrix.copy(entry.copy.userData.boxBase ? mRaw.clone().multiply(entry.copy.userData.boxBase) : mRaw);
    entry.copy.matrixWorldNeedsUpdate = true;
    const moved = !mWorld.equals(new THREE.Matrix4());
    entry.hide.visible = moved || active?.entry === entry;
    entry.copy.visible = entry.hide.visible;
  }

  // ---- ghost box with gap labels
  const ghost = new THREE.Group();
  const ghostBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: VERDICT_COLOR.pending, depthTest: false, transparent: true })
  );
  ghostBox.renderOrder = 998;
  ghost.add(ghostBox);
  const labels = { '+x': labelSprite(), '-x': labelSprite(), '+z': labelSprite(), '-z': labelSprite() };
  const labelGroup = new THREE.Group(); // world-axis aligned: gaps are measured along world +-x / +-z
  Object.values(labels).forEach((s) => labelGroup.add(s));
  labelGroup.visible = false;
  scene.add(labelGroup);
  ghost.visible = false;
  proxy.add(ghost);

  function centreWorld(obj) {
    return new THREE.Vector3(obj.obb.center[0], -obj.obb.center[1], -obj.obb.center[2]);
  }

  function currentDelta() {
    if (!active) return null;
    const d = proxy.position.clone().sub(active.start);
    return {
      object_id: active.obj.object_id,
      translate_world: [Number(d.x.toFixed(4)), 0, Number(d.z.toFixed(4))],
      yaw_deg: Number(THREE.MathUtils.radToDeg(proxy.rotation.y).toFixed(2))
    };
  }

  function updateLive() {
    labelGroup.position.copy(proxy.position);
    const d = currentDelta();
    const live = editMatrixWorld(active.start, d.translate_world, d.yaw_deg).multiply(active.entry.committedWorld);
    setEntryMatrix(active.entry, live);
  }

  return {
    /** Start editing `obj` (current pose, i.e. after committed edits). */
    begin(obj, mode = 'translate') {
      this.end();
      const baseObj = entries.get(obj.object_id)?.base || obj;
      const entry = ensureEntry(baseObj);
      active = { obj, entry, start: centreWorld(obj) };
      proxy.position.copy(active.start);
      proxy.rotation.set(0, 0, 0);
      // ghost oriented like the box (display frame axes = D * R_raw)
      const { e, R } = rawBox(obj);
      const rotDisplay = D.clone().multiply(R);
      ghostBox.matrixAutoUpdate = false;
      ghostBox.matrix.copy(rotDisplay).multiply(new THREE.Matrix4().makeScale(e.x, e.y, e.z));
      const r = Math.max(e.x, e.z) * 0.5 + 0.18;
      labels['+x'].position.set(r, 0, 0);
      labels['-x'].position.set(-r, 0, 0);
      labels['+z'].position.set(0, 0, r);
      labels['-z'].position.set(0, 0, -r);
      Object.values(labels).forEach((s) => (s.visible = false));
      ghostBox.material.color.setHex(VERDICT_COLOR.pending);
      ghost.visible = true;
      labelGroup.visible = true;
      labelGroup.position.copy(proxy.position);
      gizmo.attach(proxy);
      this.setMode(mode);
      setEntryMatrix(entry, entry.committedWorld);
      return { splats: entry.splats };
    },
    setMode(mode) {
      gizmo.setMode(mode);
      gizmo.showX = mode === 'translate';
      gizmo.showZ = mode === 'translate';
      gizmo.showY = mode === 'rotate';
    },
    /** Nudge in world units / degrees (keyboard-free precise moves). */
    nudge(dx, dz, dyawDeg = 0) {
      if (!active) return;
      proxy.position.x += dx;
      proxy.position.z += dz;
      proxy.rotation.y += THREE.MathUtils.degToRad(dyawDeg);
      updateLive();
      onChange?.(currentDelta());
    },
    delta: currentDelta,
    /** Show the backend feasibility preview on the ghost. */
    setPreview(pv) {
      if (!active || !pv) return;
      const col = VERDICT_COLOR[pv.verdict] ?? VERDICT_COLOR.pending;
      ghostBox.material.color.setHex(col);
      const css = `#${new THREE.Color(col).getHexString()}`;
      Object.entries(labels).forEach(([k, s]) => {
        const v = pv.gaps_m?.[k];
        s.visible = true;
        s.userData.draw(v == null ? '>2.4 m' : `${v.toFixed(2)} m`, v != null && v < 0.15 ? '#ff8a80' : '#e8ebee');
      });
      ghost.userData.verdict = pv.verdict;
      return css;
    },
    /** Snap back to the committed pose (blocked or cancelled). */
    cancel() {
      if (!active) return;
      proxy.position.copy(active.start);
      proxy.rotation.set(0, 0, 0);
      labelGroup.position.copy(proxy.position);
      setEntryMatrix(active.entry, active.entry.committedWorld);
      ghostBox.material.color.setHex(VERDICT_COLOR.pending);
      Object.values(labels).forEach((s) => (s.visible = false));
    },
    end() {
      if (active) setEntryMatrix(active.entry, active.entry.committedWorld);
      active = null;
      gizmo.detach();
      ghost.visible = false;
      labelGroup.visible = false;
      controls.enabled = true;
    },
    /**
     * Apply the committed edit log: `baseObjects` maps object_id -> original (unmoved) object.
     * Objects without edits return to their original pose.
     */
    applyEdits(edits, baseObjects) {
      const perObj = new Map();
      edits.forEach((e) => {
        if (!perObj.has(e.object_id)) perObj.set(e.object_id, []);
        perObj.get(e.object_id).push(e);
      });
      perObj.forEach((list, id) => {
        const base = baseObjects[id];
        if (!base) return;
        const entry = ensureEntry(base);
        const m = new THREE.Matrix4();
        const c = centreWorld(base);
        list.forEach((e) => {
          m.premultiply(editMatrixWorld(c, e.translate_world, e.yaw_deg));
          c.x += e.translate_world[0];
          c.z += e.translate_world[2];
        });
        entry.committedWorld.copy(m);
        setEntryMatrix(entry, m);
      });
      entries.forEach((entry, id) => {
        if (!perObj.has(id)) {
          entry.committedWorld.identity();
          setEntryMatrix(entry, entry.committedWorld);
        }
      });
    },
    isActive: () => !!active,
    dispose() {
      this.end();
      gizmo.dispose?.();
      scene.remove(helper);
      scene.remove(proxy);
      scene.remove(labelGroup);
      entries.forEach(({ copy, hide }) => {
        displayGroup.remove(copy);
        displayGroup.remove(hide);
        copy.dispose?.();
      });
      entries.clear();
    }
  };
}
