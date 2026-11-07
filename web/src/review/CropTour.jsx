import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { uploadCrop } from "../data.js";
import { cameraApi } from "../scene/CameraRig.jsx";
import { rawToDisplay } from "../scene/frame.js";
import { obbCorners } from "../scene/Overlays.jsx";
import { useStore } from "../store.js";

// Spark sorts splats in a worker after the camera moves; this many frames lets
// the sort and the accent box repaint settle before the capture.
const SETTLE_FRAMES = 18;
const MAX_WAIT_FRAMES = 40;
const PAD = 0.35; // crop padding, as a fraction of the box's projected size
const MIN_CROP_PX = 128;
const MAX_CROP_PX = 512;

const frames = (n) =>
  new Promise((resolve) => {
    let left = n;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

function findObject(id) {
  const s = useStore.getState().sceneObjects;
  return s?.objects.find((o) => o.object_id === id) ?? s?.hiddenObjects?.find((o) => o.object_id === id) ?? null;
}

// Renders once and copies the object's projected box (plus padding) out of the
// drawing buffer. It must run in the same task as gl.render, because the
// canvas is created without preserveDrawingBuffer.
function capture(gl, scene, camera, object) {
  gl.render(scene, camera);
  const canvas = gl.domElement;
  const W = canvas.width;
  const H = canvas.height;
  const v = new THREE.Vector3();
  const xs = [];
  const ys = [];
  for (const c of obbCorners(object)) {
    v.copy(rawToDisplay(c)).project(camera);
    xs.push(((v.x + 1) / 2) * W);
    ys.push(((1 - v.y) / 2) * H);
  }
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = Math.max(x1 - x0, y1 - y0) * PAD;
  const size = (lo, hi) => Math.max(hi - lo + 2 * pad, MIN_CROP_PX);
  const w = Math.min(size(x0, x1), W);
  const h = Math.min(size(y0, y1), H);
  const sx = Math.round(Math.min(Math.max((x0 + x1) / 2 - w / 2, 0), W - w));
  const sy = Math.round(Math.min(Math.max((y0 + y1) / 2 - h / 2, 0), H - h));
  const scale = Math.min(1, MAX_CROP_PX / Math.max(w, h));
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  out.getContext("2d").drawImage(canvas, sx, sy, w, h, 0, 0, out.width, out.height);
  return { image: out.toDataURL("image/png"), bbox_px: [sx, sy, Math.round(w), Math.round(h)], viewport_px: [W, H] };
}

async function runTour(gl, scene, camera) {
  const store = useStore.getState;
  const { objectIds } = store().review.tour;
  const original = store().selectedId;
  let failed = 0;
  store().setCameraMode("free");
  for (let i = 0; i < objectIds.length; i += 1) {
    if (store().review.tour.state !== "running") break;
    const id = objectIds[i];
    const object = findObject(id);
    if (!object) {
      failed += 1;
      continue;
    }
    // Selecting paints the box in the accent colour; the instant fly then
    // overrides the smooth one CameraRig starts on selection.
    store().setSelectedId(id);
    await cameraApi.flyTo?.(id, false);
    await frames(SETTLE_FRAMES);
    for (let k = 0; k < MAX_WAIT_FRAMES && cameraApi.controls?.active; k += 1) await frames(1);
    try {
      const shot = capture(gl, scene, camera, object);
      const position = camera.position.toArray().map((n) => +n.toFixed(4));
      const target = cameraApi.controls?.getTarget(new THREE.Vector3()).toArray().map((n) => +n.toFixed(4));
      await uploadCrop(id, { ...shot, camera: { position, target } });
    } catch (error) {
      console.warn(`Crop ${id} failed`, error);
      failed += 1;
    }
    store().setTour({ done: i + 1, failed });
    store().setReview({ cropsVersion: store().review.cropsVersion + 1 });
  }
  store().setTour({ state: "idle" });
  store().setSelectedId(original);
}

// Inside the Canvas. Starts the crop tour when the review panel sets
// review.tour.state to "running"; setting it to "cancelling" stops it after
// the current object.
export function CropTour() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        if (state.review.tour.state === "running" && prev.review.tour.state !== "running") runTour(gl, scene, camera);
      }),
    [gl, scene, camera],
  );
  return null;
}
