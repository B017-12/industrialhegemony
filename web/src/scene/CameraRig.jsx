import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useStore } from "../store.js";
import { floorHeight, rawToDisplay, sceneBounds } from "./frame.js";
import { runtime } from "./missionRuntime.js";
import { obbCorners } from "./Overlays.jsx";

const ELEVATION_DEG = 38;
const AZIMUTH_DEG = 200;
const MAX_POLAR = THREE.MathUtils.degToRad(84);
const MIN_POLAR = THREE.MathUtils.degToRad(4);

// Chase camera, in scene units: behind and above the robot, looking ahead of it.
const FOLLOW = { back: 1.7, height: 1.15, ahead: 0.7, lift: 0.3, lambda: 3 };
// Arrival shot: from the robot's side of the target, swung off-axis so the
// robot doesn't hide the asset.
const ARRIVAL = { distance: 2.3, height: 1.1, swingDeg: 62 };
const FLY_MIN_SIZE = 0.6;
const POST_ARRIVAL = new Set(["arrived", "diagnosing", "report"]);

// Fit distance for a bounding sphere of radius r: d = r / sin(f / 2), with f the
// narrower of the vertical and horizontal fields of view.
export function fitDistance(radius, camera) {
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  return radius / Math.sin(Math.min(vertical, horizontal) / 2);
}

function displayBox(object) {
  const box = new THREE.Box3();
  for (const c of obbCorners(object)) box.expandByPoint(rawToDisplay(c));
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  return box.setFromCenterAndSize(centre, size.max(new THREE.Vector3(FLY_MIN_SIZE, FLY_MIN_SIZE, FLY_MIN_SIZE)));
}

// Robot heading in display space: raw forward (sin yaw, 0, cos yaw) under the
// 180-degree X flip.
function displayForward(yaw, out) {
  return out.set(Math.sin(yaw), 0, -Math.cos(yaw));
}

// For in-canvas tools (scene/CropTour.jsx): the controls and a flyTo that
// resolves when the transition ends.
export const cameraApi = { controls: null, flyTo: null };

export function CameraRig({ sceneObjects }) {
  const controlsRef = useRef();
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const follow = useRef({ active: false, pos: new THREE.Vector3(), target: new THREE.Vector3(), framedRun: -1 });

  // Keyed on the rounded bounds, not the sceneObjects reference: a label
  // review write re-merges the objects and must not refit the camera.
  const boundsKey = useMemo(() => {
    const box = sceneBounds(sceneObjects);
    return [...box.min.toArray(), ...box.max.toArray(), floorHeight(sceneObjects)].map((v) => v.toFixed(1)).join(",");
  }, [sceneObjects]);
  const fit = useMemo(() => {
    const box = sceneBounds(sceneObjects);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const floorY = floorHeight(sceneObjects);
    const boundary = box.clone();
    boundary.min.y = floorY + 0.05;
    return { box, sphere, boundary, floorY };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey]);

  const fitView = (transition) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { sphere } = fit;
    const distance = fitDistance(sphere.radius, camera);
    const elevation = THREE.MathUtils.degToRad(ELEVATION_DEG);
    const azimuth = THREE.MathUtils.degToRad(AZIMUTH_DEG);
    const offset = new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth),
    ).multiplyScalar(distance);
    const position = sphere.center.clone().add(offset);
    controls.setLookAt(...position.toArray(), ...sphere.center.toArray(), transition);
  };

  // Hidden (rejected or merged) objects can still be flown to while reviewing them.
  const flyTo = (objectId, transition = true) => {
    const controls = controlsRef.current;
    const s = useStore.getState();
    const object =
      s.sceneObjects?.objects.find((o) => o.object_id === objectId) ??
      s.sceneObjects?.hiddenObjects?.find((o) => o.object_id === objectId);
    if (!controls || !object) return Promise.resolve();
    return controls.fitToBox(displayBox(object), transition, { paddingTop: 0.35, paddingBottom: 0.35, paddingLeft: 0.5, paddingRight: 0.5 });
  };

  const frameArrival = () => {
    const controls = controlsRef.current;
    const s = useStore.getState();
    const object = sceneObjects.objects.find((o) => o.asset_id === s.mission.targetAssetId);
    if (!controls || !object) return;
    const target = displayBox(object).getCenter(new THREE.Vector3());
    const robot = rawToDisplay(runtime.pose.pos);
    const side = robot.clone().sub(target).setY(0);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
    side.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(ARRIVAL.swingDeg));
    const position = target.clone().addScaledVector(side, ARRIVAL.distance).setY(target.y + ARRIVAL.height);
    const look = target.clone().lerp(robot, 0.2);
    controls.setLookAt(...position.toArray(), ...look.toArray(), true);
  };

  useEffect(() => {
    const controls = controlsRef.current;
    const distance = fitDistance(fit.sphere.radius, camera);
    camera.near = Math.max(0.005, fit.sphere.radius * 0.002);
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    controls.minDistance = fit.sphere.radius * 0.08;
    controls.maxDistance = distance * 1.6;
    controls.minPolarAngle = MIN_POLAR;
    controls.maxPolarAngle = MAX_POLAR;
    controls.setBoundary(fit.boundary);
    controls.boundaryFriction = 0.2;
    fitView(false);
    Object.assign(cameraApi, { controls, flyTo });
    if (import.meta.env.DEV) window.__viewer = { controls, camera, fit, fitView, flyTo };
    // Refit only when the scene data changes, not on every resize.
  }, [fit, camera]);

  useEffect(() => {
    camera.far = fitDistance(fit.sphere.radius, camera) * 10;
    camera.updateProjectionMatrix();
  }, [size, camera, fit]);

  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        if (state.viewRequest !== prev.viewRequest) {
          fitView(true);
          if (state.ui.cameraMode !== "overview") state.setCameraMode("overview");
        } else if (state.ui.cameraMode !== prev.ui.cameraMode && state.ui.cameraMode === "overview") {
          fitView(true);
        }
        if (state.flyRequest !== prev.flyRequest && state.selectedId) {
          flyTo(state.selectedId);
          if (state.ui.cameraMode !== "free") state.setCameraMode("free");
        } else if (state.selectedId !== prev.selectedId && state.selectedId) {
          // The arrival shot already frames the target; don't fly away from it.
          const isArrivalSelect =
            POST_ARRIVAL.has(state.mission.state) && state.selectedAssetId === state.mission.targetAssetId;
          if (!isArrivalSelect) {
            flyTo(state.selectedId);
            if (state.ui.cameraMode !== "free") state.setCameraMode("free");
          }
        }
      }),
    [fit, camera, sceneObjects],
  );

  // Any direct camera input hands control back to the user.
  useEffect(() => {
    const controls = controlsRef.current;
    const release = () => {
      const s = useStore.getState();
      if (s.ui.cameraMode !== "free") s.setCameraMode("free");
    };
    controls.addEventListener("controlstart", release);
    gl.domElement.addEventListener("wheel", release, { passive: true });
    return () => {
      controls.removeEventListener("controlstart", release);
      gl.domElement.removeEventListener("wheel", release);
    };
  }, [gl]);

  const scratch = useMemo(
    () => ({ robot: new THREE.Vector3(), forward: new THREE.Vector3(), pos: new THREE.Vector3(), target: new THREE.Vector3() }),
    [],
  );

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const s = useStore.getState();
    const f = follow.current;
    const mode = s.ui.cameraMode;

    if (mode === "mission" && POST_ARRIVAL.has(runtime.state)) {
      f.active = false;
      if (f.framedRun !== s.mission.runId) {
        f.framedRun = s.mission.runId;
        frameArrival();
      }
      return;
    }
    if (mode !== "mission") {
      f.active = false;
      return;
    }

    const { robot, forward, pos, target } = scratch;
    robot.copy(rawToDisplay(runtime.pose.pos));
    displayForward(runtime.pose.yaw, forward);
    pos.copy(robot).addScaledVector(forward, -FOLLOW.back);
    pos.y += FOLLOW.height;
    target.copy(robot).addScaledVector(forward, FOLLOW.ahead);
    target.y += FOLLOW.lift;

    if (!f.active) {
      // Start from wherever the camera is now, so dispatch swoops in.
      f.active = true;
      f.framedRun = -1;
      controls.getPosition(f.pos);
      controls.getTarget(f.target);
    }
    const k = 1 - Math.exp(-FOLLOW.lambda * Math.min(delta, 0.1));
    f.pos.lerp(pos, k);
    f.target.lerp(target, k);
    controls.setLookAt(f.pos.x, f.pos.y, f.pos.z, f.target.x, f.target.y, f.target.z, false);
  });

  return <CameraControls ref={controlsRef} makeDefault smoothTime={0.3} draggingSmoothTime={0.12} dollyToCursor />;
}
