import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useStore } from "../store.js";
import { STATUS_HEX, statusHexOf } from "../ui/status.js";
import { runtime } from "./missionRuntime.js";

const ACCENT = new THREE.Color(STATUS_HEX.accent);
const UNBOUND = new THREE.Color(STATUS_HEX.unbound);
const WHITE = new THREE.Color(0xffffff);
const POST_ARRIVAL = new Set(["arrived", "diagnosing", "report"]);
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Unit-cube corner signs and the 12 edges between them.
const CORNERS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const VERTS_PER_BOX = EDGES.length * 2;

export function obbMatrix(object) {
  const obb = object.obb ?? {
    center: object.center,
    extent: object.aabb_max.map((v, i) => v - object.aabb_min[i]),
    rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  };
  const [r0, r1, r2] = obb.rotation;
  const rotation = new THREE.Matrix4().set(
    r0[0], r0[1], r0[2], 0,
    r1[0], r1[1], r1[2], 0,
    r2[0], r2[1], r2[2], 0,
    0, 0, 0, 1,
  );
  return new THREE.Matrix4()
    .makeTranslation(...obb.center)
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeScale(...obb.extent));
}

// Raw-frame OBB corners (8 x [x, y, z]).
export function obbCorners(object) {
  const m = obbMatrix(object);
  const v = new THREE.Vector3();
  return CORNERS.map((c) => v.set(...c).multiplyScalar(0.5).applyMatrix4(m).toArray());
}

// Clutter level of an unbound object: pipes and low-confidence "other" fade back.
function quietness(object) {
  if (object.asset_id) return 1;
  if (object.class === "pipe") return 0.35;
  if (object.class === "other" && (object.class_confidence ?? 0) <= 0.2) return 0.3;
  return 0.6;
}

function edgeSet(objects, matrices) {
  const positions = new Float32Array(objects.length * VERTS_PER_BOX * 3);
  const corner = new THREE.Vector3();
  objects.forEach((_, b) => {
    const corners = CORNERS.map((c) => corner.set(...c).multiplyScalar(0.5).applyMatrix4(matrices[b]).toArray());
    EDGES.forEach(([a, z], e) => {
      const offset = (b * VERTS_PER_BOX + e * 2) * 3;
      positions.set(corners[a], offset);
      positions.set(corners[z], offset + 3);
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(objects.length * VERTS_PER_BOX * 4), 4));
  return geometry;
}

// Boxes in raw PLY frame; must be mounted inside the display-frame group.
// Three draw calls: an additive instanced fill (also the pick target), solid
// edges for bound objects and dashed edges for unbound ones.
export function Overlays({ objects }) {
  const fillRef = useRef();
  const hovered = useRef(null);
  const dirty = useRef(true);
  const seenVersion = useRef(-1);

  const model = useMemo(() => {
    const matrices = objects.map(obbMatrix);
    const boundIdx = [];
    const unboundIdx = [];
    objects.forEach((o, i) => (o.asset_id ? boundIdx : unboundIdx).push(i));
    const solid = new THREE.LineSegments(
      edgeSet(boundIdx.map((i) => objects[i]), boundIdx.map((i) => matrices[i])),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
    );
    const dashed = new THREE.LineSegments(
      edgeSet(unboundIdx.map((i) => objects[i]), unboundIdx.map((i) => matrices[i])),
      new THREE.LineDashedMaterial({ vertexColors: true, transparent: true, depthWrite: false, dashSize: 0.025, gapSize: 0.02 }),
    );
    dashed.computeLineDistances();
    solid.renderOrder = 11;
    dashed.renderOrder = 11;
    // Where each object's edge vertices live: [lineSegments, first vertex].
    const slots = objects.map(() => null);
    boundIdx.forEach((i, k) => (slots[i] = [solid, k * VERTS_PER_BOX]));
    unboundIdx.forEach((i, k) => (slots[i] = [dashed, k * VERTS_PER_BOX]));
    return { matrices, solid, dashed, slots };
  }, [objects]);

  useEffect(() => {
    const mesh = fillRef.current;
    model.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    dirty.current = true;
    return () => {
      for (const line of [model.solid, model.dashed]) {
        line.geometry.dispose();
        line.material.dispose();
      }
    };
  }, [model]);

  // Repaint on selection, asset status and mission target changes.
  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        if (
          state.selectedId !== prev.selectedId ||
          state.assets !== prev.assets ||
          state.highlight !== prev.highlight ||
          state.mission.targetAssetId !== prev.mission.targetAssetId
        ) {
          dirty.current = true;
        }
      }),
    [],
  );

  const colour = useMemo(() => new THREE.Color(), []);
  const fillColour = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const mesh = fillRef.current;
    if (!mesh) return;
    const pulsing = POST_ARRIVAL.has(runtime.state);
    if (runtime.version !== seenVersion.current) {
      seenVersion.current = runtime.version;
      dirty.current = true;
    }
    if (!dirty.current && !(pulsing && !reducedMotion)) return;
    dirty.current = false;

    const s = useStore.getState();
    const statusOf = new Map(s.assets.map((a) => [a.asset_id, a.condition_state]));
    const selectedId = s.selectedId;
    const targetAsset = s.mission.targetAssetId;
    const active = new Set(runtime.active);
    const lit = new Set(s.highlight?.assetIds ?? []);
    const pulse = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 5);

    objects.forEach((object, i) => {
      const id = object.object_id;
      const isSelected = id === selectedId;
      const isHovered = id === hovered.current;
      const isTarget = Boolean(object.asset_id) && object.asset_id === targetAsset;
      const inRange = active.has(id);
      const isLit = Boolean(object.asset_id) && lit.has(object.asset_id);
      const ghost = (selectedId && !isSelected) || (lit.size > 0 && !isLit);

      if (isSelected) colour.copy(ACCENT);
      else if (object.asset_id) colour.set(statusHexOf(statusOf.get(object.asset_id)));
      else colour.copy(UNBOUND);
      if (isHovered && !isSelected) colour.lerp(WHITE, 0.45);

      let edgeAlpha = object.asset_id ? 0.75 : 0.45 * quietness(object);
      let fill = object.asset_id ? 0.07 : 0;
      if (inRange) [edgeAlpha, fill] = [1, 0.16];
      if (isLit) [edgeAlpha, fill] = [1, 0.22];
      if (isTarget && pulsing) [edgeAlpha, fill] = [0.7 + 0.3 * pulse, 0.12 + 0.22 * pulse];
      if (isHovered) [edgeAlpha, fill] = [1, Math.max(fill, 0.12)];
      if (isSelected) [edgeAlpha, fill] = [1, 0.14];
      if (ghost && !isTarget && !inRange && !isLit) [edgeAlpha, fill] = [edgeAlpha * 0.25, fill * 0.2];

      // Additive blending: a darker colour is a fainter fill.
      mesh.setColorAt(i, fillColour.copy(colour).multiplyScalar(fill));
      const [line, first] = model.slots[i];
      const attr = line.geometry.getAttribute("color");
      for (let v = 0; v < VERTS_PER_BOX; v += 1) {
        attr.array.set([colour.r, colour.g, colour.b, edgeAlpha], (first + v) * 4);
      }
    });
    mesh.instanceColor.needsUpdate = true;
    model.solid.geometry.getAttribute("color").needsUpdate = true;
    model.dashed.geometry.getAttribute("color").needsUpdate = true;
  });

  const setHovered = (id) => {
    if (hovered.current === id) return;
    hovered.current = id;
    document.body.style.cursor = id ? "pointer" : "";
    dirty.current = true;
  };

  return (
    <>
      <instancedMesh
        ref={fillRef}
        args={[null, null, objects.length]}
        renderOrder={10}
        onPointerMove={(e) => {
          e.stopPropagation();
          setHovered(objects[e.instanceId]?.object_id ?? null);
        }}
        onPointerOut={() => setHovered(null)}
        onClick={(e) => {
          e.stopPropagation();
          useStore.getState().setSelectedId(objects[e.instanceId]?.object_id ?? null);
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <primitive object={model.solid} />
      <primitive object={model.dashed} />
    </>
  );
}
