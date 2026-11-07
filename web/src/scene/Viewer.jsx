import { Canvas } from "@react-three/fiber";
import { memo, useMemo } from "react";
import { CropTour } from "../review/CropTour.jsx";
import { useStore } from "../store.js";
import { CameraRig } from "./CameraRig.jsx";
import { CeilingCutaway } from "./CeilingCutaway.jsx";
import { FpsMeter } from "./FpsMeter.jsx";
import { DISPLAY_ROTATION } from "./frame.js";
import { LabelProjector } from "./Labels.jsx";
import { MissionDriver } from "./MissionDriver.jsx";
import { Overlays } from "./Overlays.jsx";
import { Robot } from "./Robot.jsx";
import { SparkLayer, Splat } from "./Splat.jsx";

// ?dpr=1 (or 1.5, 2) pins the device pixel ratio; splat cost scales with pixels.
const DPR_PARAM = Number(new URLSearchParams(window.location.search).get("dpr"));
const DPR = DPR_PARAM > 0 ? DPR_PARAM : [1, 1.5];

function SceneContent() {
  const sceneObjects = useStore((s) => s.sceneObjects);
  const nav = useStore((s) => s.nav);
  const framed = useMemo(
    () => sceneObjects?.objects.filter((o) => o.source !== "structure_plane") ?? [],
    [sceneObjects],
  );

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <hemisphereLight args={[0xffffff, 0x334155, 1.6]} />
      <directionalLight position={[2, 6, 3]} intensity={1.2} />
      <SparkLayer />
      <group name="display-frame" rotation={DISPLAY_ROTATION}>
        <Splat />
        {framed.length > 0 && <Overlays objects={framed} />}
        {nav?.samples && sceneObjects && <Robot nav={nav} metresPerUnit={sceneObjects.metres_per_unit} />}
      </group>
      {sceneObjects && <CeilingCutaway sceneObjects={sceneObjects} />}
      {sceneObjects && <CameraRig sceneObjects={sceneObjects} />}
      {sceneObjects && <LabelProjector objects={sceneObjects.objects} />}
      <MissionDriver />
      <CropTour />
      <FpsMeter />
    </>
  );
}

// Mounted once for the lifetime of the page. It takes no props, so HUD state
// changes in App never reach the Canvas.
export const Viewer = memo(function Viewer() {
  return (
    <Canvas
      className="viewer-canvas"
      gl={{ antialias: false, powerPreference: "high-performance" }}
      dpr={DPR}
      camera={{ fov: 50, near: 0.01, far: 100, position: [0, 2, 8] }}
      onCreated={(state) => {
        if (import.meta.env.DEV) window.__r3f = state;
      }}
      onPointerMissed={() => useStore.getState().setSelectedId(null)}
      fallback={<div className="viewer-message">WebGL2 is not available in this browser, so the 3D scene cannot be shown.</div>}
    >
      <SceneContent />
    </Canvas>
  );
});
