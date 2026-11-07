import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import {
  SparkRenderer,
  SplatMesh,
  SplatEdit,
  SplatEditRgbaBlendMode,
  SplatEditSdf,
  SplatEditSdfType
} from '@sparkjsdev/spark';
import { Wrench, Plus, Trash2, Zap, Pause, Play, Eye, Layers, Camera, Building, Target, RotateCcw, Footprints, RotateCw, X } from 'lucide-react';
import {
  NAV_NODES,
  NAV_EDGES,
  samplePathAtProgress,
  buildCollisionBoxes,
  resolveObstacleCollisions,
  resolveManualTechnicianStep,
  isPointInObstacle
} from '../utils/pathfinding.js';
import { computeArTrafficSignal } from '../utils/exerciseEngine.js';
import { obbMatrix, rawToDisplay, EVIDENCE_PHOTO_MAP } from '../utils/cvEngine.js';
import { STRUCTURAL_BOILER_OBJECTS } from '../data/valmetDataset.js';
import { statusOf, humanize } from '../ui/status.js';
import FloorMinimap from './FloorMinimap.jsx';
import HolographicArAssetMenu from './HolographicArAssetMenu.jsx';

// ISA-101 High-Performance HMI palette: colour reserved for abnormal states; normal is neutral steel/emerald
const HEALTH_COLORS = {
  attention_required: 0xef4444, // Alarm Red
  degraded: 0xf97316,           // High / Degraded Orange
  watch: 0xeab308,              // Watch Amber
  healthy: 0x38bdf8             // Crisp Cyan/Steel for 3DGS & CAD visibility
};

/**
 * Shared Geometry Cache for High-Performance Photorealistic CAD Rendering
 */
const GEO_CACHE = {
  valvePipe: new THREE.CylinderGeometry(0.14, 0.14, 0.56, 20),
  valveFlange: new THREE.CylinderGeometry(0.22, 0.22, 0.05, 20),
  valveStem: new THREE.CylinderGeometry(0.045, 0.045, 0.36, 14),
  valveDome: new THREE.CylinderGeometry(0.26, 0.20, 0.20, 22),
  pumpSkid: new THREE.BoxGeometry(0.78, 0.10, 0.62),
  pumpVolute: new THREE.CylinderGeometry(0.26, 0.26, 0.48, 22),
  pumpNozzle: new THREE.CylinderGeometry(0.10, 0.10, 0.36, 16),
  motorBarrel: new THREE.CylinderGeometry(0.25, 0.25, 0.56, 22),
  motorBox: new THREE.BoxGeometry(0.18, 0.16, 0.18),
  sensorHead: new THREE.CylinderGeometry(0.14, 0.14, 0.20, 18),
  contourDot: new THREE.SphereGeometry(0.022, 8, 8),
  unitBox: new THREE.BoxGeometry(1, 1, 1)
};

function createProceduralEquipmentMesh(asset, colorHex) {
  const group = new THREE.Group();
  const [sx, sy, sz] = asset.bbox_size;

  const solidMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.48,
    roughness: 0.28,
    transparent: true,
    opacity: 0.96
  });

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.72,
    roughness: 0.25,
    transparent: true,
    opacity: 0.96
  });

  const darkSteelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.65,
    roughness: 0.35,
    transparent: true,
    opacity: 0.96
  });

  if (asset.asset_class === 'control_valve') {
    const pipeBody = new THREE.Mesh(GEO_CACHE.valvePipe, steelMat);
    pipeBody.rotation.z = Math.PI / 2;
    pipeBody.position.y = -sy * 0.16;
    group.add(pipeBody);

    const flangeL = new THREE.Mesh(GEO_CACHE.valveFlange, darkSteelMat);
    flangeL.rotation.z = Math.PI / 2;
    flangeL.position.set(-0.25, -sy * 0.16, 0);
    group.add(flangeL);

    const flangeR = new THREE.Mesh(GEO_CACHE.valveFlange, darkSteelMat);
    flangeR.rotation.z = Math.PI / 2;
    flangeR.position.set(0.25, -sy * 0.16, 0);
    group.add(flangeR);

    const stem = new THREE.Mesh(GEO_CACHE.valveStem, steelMat);
    stem.position.y = sy * 0.02;
    group.add(stem);

    const actuatorDome = new THREE.Mesh(GEO_CACHE.valveDome, solidMat);
    actuatorDome.position.y = sy * 0.24;
    group.add(actuatorDome);
  } else if (asset.asset_class === 'process_pump') {
    const skid = new THREE.Mesh(GEO_CACHE.pumpSkid, darkSteelMat);
    skid.position.y = -sy * 0.38;
    group.add(skid);

    const volute = new THREE.Mesh(GEO_CACHE.pumpVolute, solidMat);
    volute.rotation.z = Math.PI / 2;
    volute.position.y = -sy * 0.05;
    group.add(volute);

    const nozzle = new THREE.Mesh(GEO_CACHE.pumpNozzle, steelMat);
    nozzle.position.set(-sx * 0.10, sy * 0.20, 0);
    group.add(nozzle);
  } else if (asset.asset_class === 'electric_motor') {
    const base = new THREE.Mesh(GEO_CACHE.pumpSkid, darkSteelMat);
    base.position.y = -sy * 0.36;
    group.add(base);

    const motorBarrel = new THREE.Mesh(GEO_CACHE.motorBarrel, solidMat);
    motorBarrel.rotation.z = Math.PI / 2;
    group.add(motorBarrel);

    const junctionBox = new THREE.Mesh(GEO_CACHE.motorBox, steelMat);
    junctionBox.position.set(0, sy * 0.26, 0);
    group.add(junctionBox);
  } else {
    const head = new THREE.Mesh(GEO_CACHE.sensorHead, solidMat);
    head.rotation.x = Math.PI / 2;
    head.position.y = sy * 0.10;
    group.add(head);

    const manifold = new THREE.Mesh(GEO_CACHE.valveStem, steelMat);
    manifold.position.y = -sy * 0.14;
    group.add(manifold);
  }

  return { group, solidMat, accentMat: steelMat };
}

function createCleanIndustrialRoomArchitecture() {
  const room = new THREE.Group();

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xbec5cd,
    roughness: 0.78,
    metalness: 0.08
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 9.0), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1.045, 1.6);
  room.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xdbe0e5,
    roughness: 0.88,
    metalness: 0.05
  });

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(11.5, 4.2, 0.18), wallMat);
  backWall.position.set(0, 1.05, 4.25);
  room.add(backWall);

  const westWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.2, 9.0), wallMat);
  westWall.position.set(-5.65, 1.05, 1.6);
  room.add(westWall);

  const eastWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.2, 9.0), wallMat);
  eastWall.position.set(5.65, 1.05, 1.6);
  room.add(eastWall);

  const ductMat = new THREE.MeshStandardMaterial({
    color: 0x9aa4ae,
    metalness: 0.5,
    roughness: 0.38
  });
  const mainDuct = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 10.5, 24), ductMat);
  mainDuct.rotation.z = Math.PI / 2;
  mainDuct.position.set(0, 2.35, 1.8);
  room.add(mainDuct);

  const crossDuct1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.5, 20), ductMat);
  crossDuct1.rotation.x = Math.PI / 2;
  crossDuct1.position.set(-1.8, 2.35, 1.6);
  room.add(crossDuct1);

  const crossDuct2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.5, 20), ductMat);
  crossDuct2.rotation.x = Math.PI / 2;
  crossDuct2.position.set(2.1, 2.35, 1.6);
  room.add(crossDuct2);

  const toteMat = new THREE.MeshStandardMaterial({
    color: 0xeef1f4,
    roughness: 0.4,
    metalness: 0.1
  });
  const cageMat = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.45 });

  [-3.8, -2.5, -1.2, 0.1].forEach((xPos) => {
    [0.0, 1.15].forEach((yOff) => {
      const toteGeo = new THREE.BoxGeometry(1.05, 1.02, 1.05);
      const tote = new THREE.Mesh(toteGeo, toteMat);
      tote.position.set(xPos, -0.50 + yOff, 3.55);
      room.add(tote);

      const cage = new THREE.LineSegments(new THREE.EdgesGeometry(toteGeo), cageMat);
      cage.position.copy(tote.position);
      room.add(cage);
    });
  });

  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    metalness: 0.55,
    roughness: 0.4
  });
  [
    [-4.8, 0.5],
    [-4.8, 3.2],
    [4.8, 0.5],
    [4.8, 3.2]
  ].forEach(([px, pz]) => {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.2, 0.24), pillarMat);
    col.position.set(px, 1.05, pz);
    room.add(col);
  });

  const headerPipeMat = new THREE.MeshStandardMaterial({
    color: 0x7c8794,
    metalness: 0.65,
    roughness: 0.3
  });
  const feedHeader = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 8.6, 16), headerPipeMat);
  feedHeader.rotation.z = Math.PI / 2;
  feedHeader.position.set(0, -0.25, 2.35);
  room.add(feedHeader);

  const returnHeader = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 8.6, 16), headerPipeMat);
  returnHeader.rotation.z = Math.PI / 2;
  returnHeader.position.set(0, 0.35, 2.35);
  room.add(returnHeader);

  return room;
}

function createHumanoidRig(colorHex = 0x10b981, isHuman = false, hitboxSize = [0.56, 1.45, 0.56]) {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const mainMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.25,
    metalness: 0.65
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.5,
    metalness: 0.4
  });
  const visorMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.18), mainMat);
  torso.position.y = 0.72;
  bodyGroup.add(torso);

  const head = new THREE.Mesh(
    isHuman ? new THREE.SphereGeometry(0.12, 16, 16) : new THREE.BoxGeometry(0.21, 0.19, 0.21),
    isHuman ? darkMat : mainMat
  );
  head.position.y = 1.06;
  bodyGroup.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.055, 0.04), visorMat);
  visor.position.set(0, 1.06, 0.1);
  bodyGroup.add(visor);

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.08, 0.5, 0);
  const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.46, 10), darkMat);
  leftLeg.position.y = -0.23;
  leftLegPivot.add(leftLeg);
  bodyGroup.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.08, 0.5, 0);
  const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.46, 10), darkMat);
  rightLeg.position.y = -0.23;
  rightLegPivot.add(rightLeg);
  bodyGroup.add(rightLegPivot);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.19, 0.9, 0);
  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.36, 10), mainMat);
  leftArm.position.y = -0.18;
  leftArmPivot.add(leftArm);
  bodyGroup.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.19, 0.9, 0);
  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.36, 10), mainMat);
  rightArm.position.y = -0.18;
  rightArmPivot.add(rightArm);

  const wrenchGroup = new THREE.Group();
  const wrenchShaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.26, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.7, roughness: 0.25 })
  );
  wrenchShaft.position.set(0, -0.34, 0.08);
  wrenchShaft.rotation.x = Math.PI / 3;
  wrenchGroup.add(wrenchShaft);
  wrenchGroup.visible = false;
  rightArmPivot.add(wrenchGroup);

  bodyGroup.add(rightArmPivot);

  const [hx, hy, hz] = hitboxSize;
  const hitboxGeo = new THREE.BoxGeometry(hx, hy, hz);
  const hitboxEdges = new THREE.EdgesGeometry(hitboxGeo);
  const hitboxMat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.42
  });
  const hitboxWire = new THREE.LineSegments(hitboxEdges, hitboxMat);
  hitboxWire.position.y = hy * 0.5;
  root.add(hitboxWire);

  const ringGeo = new THREE.RingGeometry(0.95, 1.0, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.28
  });
  const radarRing = new THREE.Mesh(ringGeo, ringMat);
  radarRing.rotation.x = -Math.PI / 2;
  radarRing.position.y = 0.02;
  root.add(radarRing);

  root.userData = {
    bodyGroup,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot,
    rightArmPivot,
    wrenchGroup,
    radarRing,
    hitboxWire,
    currentAngle: 0
  };

  return root;
}

function parsePrecomputedSplatBin(arrayBuffer) {
  const count = Math.floor(arrayBuffer.byteLength / 16);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const dataView = new DataView(arrayBuffer);
  const u8 = new Uint8Array(arrayBuffer);

  for (let i = 0; i < count; i++) {
    const byteOffset = i * 16;
    const i3 = i * 3;
    positions[i3] = dataView.getFloat32(byteOffset, true);
    positions[i3 + 1] = dataView.getFloat32(byteOffset + 4, true);
    positions[i3 + 2] = dataView.getFloat32(byteOffset + 8, true);

    colors[i3] = u8[byteOffset + 12] / 255;
    colors[i3 + 1] = u8[byteOffset + 13] / 255;
    colors[i3 + 2] = u8[byteOffset + 14] / 255;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return { geometry, count };
}

function parseCustomPlyArrayBuffer(arrayBuffer) {
  const headerProbe = new Uint8Array(arrayBuffer, 0, Math.min(4096, arrayBuffer.byteLength));
  const headerText = new TextDecoder('ascii').decode(headerProbe);
  const endHeaderIdx = headerText.indexOf('end_header');
  if (endHeaderIdx === -1) {
    throw new Error('Invalid PLY header: missing end_header');
  }

  let dataOffset = endHeaderIdx + 10;
  if (headerProbe[dataOffset] === 13) dataOffset++;
  if (headerProbe[dataOffset] === 10) dataOffset++;

  const vertexMatch = headerText.match(/element vertex (\d+)/);
  const totalVertices = vertexMatch ? parseInt(vertexMatch[1], 10) : 0;
  const propMatches = headerText.match(/property float /g);
  const floatCount = propMatches ? propMatches.length : 0;

  if (headerText.includes('f_dc_0') && floatCount >= 14) {
    const stride = floatCount * 4;
    const dataView = new DataView(arrayBuffer, dataOffset);
    const maxSample = 140000;
    const step = Math.max(1, Math.floor(totalVertices / maxSample));

    const positions = [];
    const colors = [];
    const SH_C0 = 0.28209479177387814;

    for (let i = 0; i < totalVertices; i += step) {
      const bytePos = i * stride;
      if (bytePos + stride > arrayBuffer.byteLength - dataOffset) break;

      const x = dataView.getFloat32(bytePos + 0, true);
      const y = dataView.getFloat32(bytePos + 4, true);
      const z = dataView.getFloat32(bytePos + 8, true);
      const dc0 = dataView.getFloat32(bytePos + 40, true);
      const dc1 = dataView.getFloat32(bytePos + 44, true);
      const dc2 = dataView.getFloat32(bytePos + 48, true);
      const op = dataView.getFloat32(bytePos + 52, true);

      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z) || op < -1.2) continue;
      if (Math.abs(x) > 9.5 || Math.abs(y) > 5.5 || Math.abs(z) > 9.5) continue;
      if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(z) < 0.05) continue;

      positions.push(x, -y, -z);
      const r = Math.max(0, Math.min(1, 0.5 + SH_C0 * dc0));
      const g = Math.max(0, Math.min(1, 0.5 + SH_C0 * dc1));
      const b = Math.max(0, Math.min(1, 0.5 + SH_C0 * dc2));
      colors.push(r, g, b);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return { geometry, count: positions.length / 3 };
  }

  const loader = new PLYLoader();
  const geometry = loader.parse(arrayBuffer);
  return { geometry, count: geometry.attributes.position.count };
}

export default function BoilerRoomViewport({
  activeRoomScene = 'equipment_room',
  assets,
  selectedAsset,
  onSelectAsset,
  semanticBlend,
  onSemanticBlendChange,
  laserSweepTrigger,
  showStructuralBoxes,
  showContourModels,
  activeProfile,
  railMode,
  multiAgentEnabled,
  fleetAssignments,
  showDualComparison,
  humanPath,
  robotPath,
  hazardNodes,
  onToggleHazardNode,
  simPlaying,
  onSimPlayingChange,
  simProgress,
  onSimProgressChange,
  proximityRadius,
  onNearbyAssetsChange,
  pointSize,
  arFirstPersonMode,
  onToggleArFirstPerson,
  onQuickMutateTelemetry,
  onOpenArHud,
  customPlyBuffer,
  onLoadStats,
  exerciseMode = false,
  onToggleExerciseMode,
  exercisePaused = false,
  onToggleExercisePaused,
  exerciseWorkers = [],
  selectedWorkerId = null,
  onSelectWorker,
  onAddWorker,
  onDeleteWorker,
  onAssignWorkerToFault,
  onManualUpdateWorkerPose,
  onInjectRandomFault,
  autoDispatch = true,
  onToggleAutoDispatch,
  onArTrafficSignalChange,
  appMode = 'technician',
  showWorkers = true,
  onSwitchToTechnicianMode = null,
  // CV & 3DGS props from ahmad_branch integration
  viewMode = 'splat', // 'splat' | 'hybrid' | 'cad'
  onViewModeChange,
  ceilingCutaway = true,
  onToggleCeilingCutaway,
  cvSceneObjects,
  showAllCvDetections = false,
  onToggleShowAllCvDetections,
  selectedCvObjectId = null,
  onSelectCvObject,
  onSceneReady,
  objectMoves = {},
  onMoveCvObject,
  onResetCvMoves
}) {
  const mountRef = useRef(null);
  // ---- Move-Objects mode (click an object, drag it to a new spot; splats are cut out + re-instanced) ----
  const [moveMode, setMoveMode] = useState(false);
  const [moveSelectedId, setMoveSelectedId] = useState(null);
  const moveModeRef = useRef(false);
  const objectMovesRef = useRef({});
  const moveCbRef = useRef(null);
  const moveDragRef = useRef(null);
  const ghostsRef = useRef(new Map());
  const hideEditRef = useRef({ edit: null, key: '' });
  const cvSceneObjectsRef = useRef(null);
  const applySplatMovesRef = useRef(null);
  moveModeRef.current = moveMode;
  objectMovesRef.current = objectMoves;
  moveCbRef.current = onMoveCvObject;
  cvSceneObjectsRef.current = cvSceneObjects;
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const pointCloudMatRef = useRef(null);
  const pointCloudObjRef = useRef(null);
  const splatDisplayGroupRef = useRef(null);
  const splatMeshRef = useRef(null);
  const ceilingCutEditRef = useRef(null);
  const cvUnboundObbGroupRef = useRef(null);
  const hoveredAssetIdRef = useRef(null);
  const cameraFlyRef = useRef({
    active: false,
    pos: new THREE.Vector3(),
    target: new THREE.Vector3()
  });

  // Consumer Navigation Mode: 'walk' (1st-person FPS walk) | 'orbit' (3rd-person mouse drag orbit)
  const [navMode, setNavMode] = useState('walk');
  const navModeRef = useRef('walk');
  useEffect(() => {
    navModeRef.current = navMode;
  }, [navMode]);

  const firstPersonPosRef = useRef({ x: 1.42, y: -0.12, z: -1.28 });
  const firstPersonYawRef = useRef(-0.66);
  const firstPersonPitchRef = useRef(-0.11);
  const lastPointerPosRef = useRef({ x: 0, y: 0 });
  const isDraggingLookRef = useRef(false);

  const handleSetNavMode = (newMode) => {
    setNavMode(newMode);
    navModeRef.current = newMode;

    if (newMode === 'walk') {
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }
      if (cameraRef.current) {
        const curCam = cameraRef.current;
        const obstacles = buildCollisionBoxes([...(STRUCTURAL_BOILER_OBJECTS || []), ...(assets || [])]);
        const [safeX, safeZ] = resolveObstacleCollisions(curCam.position.x, curCam.position.z, 0.28, obstacles);
        firstPersonPosRef.current = { x: safeX, y: -0.12, z: safeZ };
        curCam.position.set(safeX, -0.12, safeZ);

        const dir = new THREE.Vector3();
        curCam.getWorldDirection(dir);
        firstPersonYawRef.current = Math.atan2(dir.x, dir.z);
        firstPersonPitchRef.current = Math.asin(Math.max(-0.99, Math.min(0.99, dir.y)));
      }
    } else {
      if (controlsRef.current && cameraRef.current) {
        controlsRef.current.enabled = true;
        const cosP = Math.cos(firstPersonPitchRef.current);
        const lX = Math.sin(firstPersonYawRef.current) * cosP;
        const lY = Math.sin(firstPersonPitchRef.current);
        const lZ = Math.cos(firstPersonYawRef.current) * cosP;
        controlsRef.current.target.set(
          cameraRef.current.position.x + lX * 2.5,
          cameraRef.current.position.y + lY * 2.5,
          cameraRef.current.position.z + lZ * 2.5
        );
        controlsRef.current.update();
      }
    }
  };

  const handleSetNavModeRef = useRef(handleSetNavMode);
  handleSetNavModeRef.current = handleSetNavMode;

  // Smooth Camera Fly-To helper (ported from ahmad_branch CameraRig.jsx fitToBox / flyTo)
  const triggerCameraFlyTo = (targetPos3D, approachPos3D = null, bboxSize = [0.55, 0.55, 0.55]) => {
    if (!targetPos3D) return;
    const [tx, ty, tz] = targetPos3D;
    const targetVec = new THREE.Vector3(tx, ty, tz);

    // Compute camera vantage inside the walkable room interior looking toward the object
    let dirX = 0.65 - tx;
    let dirZ = -0.35 - tz;
    if (Array.isArray(approachPos3D)) {
      const adx = approachPos3D[0] - tx;
      const adz = approachPos3D[2] - tz;
      if (Math.hypot(adx, adz) > 0.15) {
        dirX = adx;
        dirZ = adz;
      }
    }
    const len = Math.hypot(dirX, dirZ) || 1;
    const radius = Math.max(0.45, Math.hypot(bboxSize[0] || 0.5, bboxSize[1] || 0.5, bboxSize[2] || 0.5) * 0.5);
    const dist = Math.max(1.25, Math.min(2.1, radius * 2.5));

    // Swing slightly (16 deg) like ahmad_branch ARRIVAL.swingDeg so the approach aisle & asset are both framed
    const angle = Math.atan2(dirX / len, dirZ / len) + THREE.MathUtils.degToRad(16);
    const rawCamX = tx + Math.sin(angle) * dist;
    const rawCamZ = tz + Math.cos(angle) * dist;
    const [safeCamX, safeCamZ] = resolveObstacleCollisions(rawCamX, rawCamZ, 0.18);
    const camY = Math.min(0.32, Math.max(-0.68, ty + 0.36));

    cameraFlyRef.current = {
      active: true,
      pos: new THREE.Vector3(safeCamX, camY, safeCamZ),
      target: targetVec
    };
  };
  const cadRoomGroupRef = useRef(null);
  const gridHelperRef = useRef(null);
  const assetGroupRef = useRef(null);
  const structuralGroupRef = useRef(null);
  const pathGroupRef = useRef(null);
  const navGraphGroupRef = useRef(null);
  const fleetGroupRef = useRef(null);
  const exerciseGroupRef = useRef(null);
  const exercisePathGroupRef = useRef(null);
  const exerciseWorkerRigsRef = useRef(new Map());
  const arTrafficGateRef = useRef(null);
  const laserWaveMeshRef = useRef(null);
  const primaryRigRef = useRef(null);
  const secondaryRigsRef = useRef({});
  const assetMeshMapRef = useRef(new Map());
  const assetHitboxesRef = useRef([]);

  // STRICT INTERACTION RULE:
  // Nothing pops up or shows object details until the user explicitly clicks/interacts with a 3D object!
  const [clickedPopoverAssetId, setClickedPopoverAssetId] = useState(null);
  const [clickedUnboundCvObj, setClickedUnboundCvObj] = useState(null);
  const [clickedScreenAnchor, setClickedScreenAnchor] = useState(null);
  const [workerOverlays, setWorkerOverlays] = useState([]);
  const [assetTagOverlays, setAssetTagOverlays] = useState([]);
  const [arTrafficOverride, setArTrafficOverride] = useState('AUTO');
  const [liveArSignal, setLiveArSignal] = useState({
    light: 'GREEN',
    headline: 'GREEN LIGHT  —  PROCEED',
    detail: 'Corridor clear · Right-of-way granted',
    conflictingUnitId: null,
    distanceMeters: null,
    speedMultiplier: 1.0,
    laneOffset: 0
  });

  const keysPressedRef = useRef({});
  const manualPosRef = useRef(null);
  const manualWorkerPosesRef = useRef({});
  const arLookPitchRef = useRef(-0.04);
  const lastManualSyncRef = useRef(0);
  const laserSweepStateRef = useRef({ active: false, zPos: -4.5 });

  const [loadingState, setLoadingState] = useState('Loading 3D Gaussian Splatting (.spz) Scene...');
  const [splatReady, setSplatReady] = useState(false);
  const [isWasdWalking, setIsWasdWalking] = useState(false);
  const [obstacleAlert, setObstacleAlert] = useState(null);
  const [arCameraPerspective, setArCameraPerspective] = useState('1st'); // '1st' | '3rd'

  const stateRef = useRef({
    assets,
    selectedAsset,
    clickedPopoverAssetId,
    semanticBlend,
    showStructuralBoxes,
    showContourModels,
    activeProfile,
    railMode,
    multiAgentEnabled,
    fleetAssignments,
    showDualComparison,
    humanPath,
    robotPath,
    hazardNodes,
    simPlaying,
    simProgress,
    proximityRadius,
    arFirstPersonMode,
    arCameraPerspective,
    exerciseMode,
    exercisePaused,
    exerciseWorkers,
    selectedWorkerId,
    arTrafficOverride,
    viewMode,
    ceilingCutaway,
    showAllCvDetections,
    selectedCvObjectId,
    appMode,
    showWorkers
  });

  useEffect(() => {
    stateRef.current = {
      assets,
      selectedAsset,
      clickedPopoverAssetId,
      semanticBlend,
      showStructuralBoxes,
      showContourModels,
      activeProfile,
      railMode,
      multiAgentEnabled,
      fleetAssignments,
      showDualComparison,
      humanPath,
      robotPath,
      hazardNodes,
      simPlaying,
      simProgress,
      proximityRadius,
      arFirstPersonMode,
      arCameraPerspective,
      exerciseMode,
      exercisePaused,
      exerciseWorkers,
      selectedWorkerId,
      arTrafficOverride,
      viewMode,
      ceilingCutaway,
      showAllCvDetections,
      selectedCvObjectId,
      appMode,
      showWorkers,
      navMode
    };
  }, [
    assets,
    selectedAsset,
    clickedPopoverAssetId,
    semanticBlend,
    showStructuralBoxes,
    showContourModels,
    activeProfile,
    railMode,
    multiAgentEnabled,
    fleetAssignments,
    showDualComparison,
    humanPath,
    robotPath,
    hazardNodes,
    simPlaying,
    simProgress,
    proximityRadius,
    arFirstPersonMode,
    arCameraPerspective,
    exerciseMode,
    exercisePaused,
    exerciseWorkers,
    selectedWorkerId,
    arTrafficOverride,
    viewMode,
    ceilingCutaway,
    showAllCvDetections,
    selectedCvObjectId,
    appMode,
    showWorkers,
    navMode
  ]);

  useEffect(() => {
    if (!laserSweepTrigger) return;
    laserSweepStateRef.current = { active: true, zPos: -3.2 };
    if (onSemanticBlendChange) onSemanticBlendChange(0);
  }, [laserSweepTrigger]);

  // Fly camera to selected CV object when user clicks through the CV Review / Crop Tour queue
  useEffect(() => {
    if (!selectedCvObjectId || !cvSceneObjects?.objects || !cameraRef.current || !controlsRef.current) {
      return;
    }
    const obj = cvSceneObjects.objects.find((o) => o.object_id === selectedCvObjectId);
    if (!obj) return;
    const [dx, dy, dz] = rawToDisplay(obj.obb?.center ?? obj.center);
    controlsRef.current.target.set(dx, dy, dz);
    cameraRef.current.position.set(dx * 0.65, dy + 0.85, dz - 1.65);
    controlsRef.current.update();
    if (!obj.asset_id) {
      setClickedUnboundCvObj(obj);
    }
  }, [selectedCvObjectId]);

  // ======== Move-Objects: GPU SplatEditSdf Displacement (60 FPS, zero duplicate SplatMeshes!) ========
  // Spark's SplatEditSdf supports a native world-space `displace` Vector3 in the vertex shader
  // (`pos += sdfDisplaceScale.xyz * modulate`). Mounting a single SplatEdit on `scene` translates
  // the 3D Gaussian Splats inside each moved object's 3D OBB directly on the GPU!
  const getSrcObb = (obj) =>
    obj._origObb ??
    obj.obb ?? {
      center: obj.center,
      extent: (obj.aabb_max || [0.5, 0.5, 0.5]).map((v, i) => Math.abs(v - (obj.aabb_min?.[i] ?? 0))),
      rotation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ]
    };

  const makeDisplacedWorldBoxSdf = (src, move) => {
    const sdf = new SplatEditSdf({
      type: SplatEditSdfType.BOX,
      opacity: 1,
      color: new THREE.Color(1.08, 1.14, 1.22),
      displace: new THREE.Vector3(move.dx || 0, move.dy || 0, move.dz || 0),
      invert: false
    });
    const dispCenter = rawToDisplay(src.center);
    sdf.position.set(dispCenter[0], dispCenter[1], dispCenter[2]);
    const r = src.rotation || [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
    // Convert raw PLY rotation R to display/world rotation D * R * D where D = diag(1, -1, -1)
    const rotM = new THREE.Matrix4().set(
      r[0][0], -r[0][1], -r[0][2], 0,
      -r[1][0], r[1][1], r[1][2], 0,
      -r[2][0], r[2][1], r[2][2], 0,
      0, 0, 0, 1
    );
    sdf.quaternion.setFromRotationMatrix(rotM);
    const pad = 0.04;
    sdf.scale.set(
      src.extent[0] * 0.5 + pad,
      src.extent[1] * 0.5 + pad,
      src.extent[2] * 0.5 + pad
    );
    return sdf;
  };

  applySplatMovesRef.current = (moves) => {
    const scene = sceneRef.current;
    const mesh = splatMeshRef.current;
    if (!scene || !mesh) return;
    const objs = cvSceneObjectsRef.current?.objects || [];
    const byId = new Map(objs.map((o) => [o.object_id, o]));
    const ids = Object.keys(moves || {})
      .filter((id) => byId.has(id) && Math.abs(moves[id].dx) + Math.abs(moves[id].dz) > 1e-4)
      .sort();

    const key = ids
      .map((id) => `${id}:${moves[id].dx.toFixed(3)},${moves[id].dz.toFixed(3)}`)
      .join('|');
    if (hideEditRef.current.key === key) return;

    const prev = hideEditRef.current.edit;
    if (prev?.parent) prev.parent.remove(prev);

    let edit = null;
    if (ids.length > 0) {
      edit = new SplatEdit({
        rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
        softEdge: 0.02
      });
      ids.forEach((id) => {
        const obj = byId.get(id);
        if (obj) {
          edit.add(makeDisplacedWorldBoxSdf(getSrcObb(obj), moves[id]));
        }
      });
      scene.add(edit);
    }
    hideEditRef.current = { edit, key };
    mesh.updateGenerator?.();
  };

  // 1. Initialize Three.js Scene + @sparkjsdev/spark 3DGS + Clean CAD Room + Click-Only Interaction
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    sceneRef.current = scene;

    const clientW = container.clientWidth || window.innerWidth || 1280;
    const clientH = container.clientHeight || (window.innerHeight - 80) || 720;

    const camera = new THREE.PerspectiveCamera(
      52,
      clientW / clientH,
      0.03,
      100
    );
    // Start inside the Equipment Room looking at P-005, P-002, M-004, M-005, CV-009 (matches ahmad_branch interior view)
    camera.position.set(1.42, -0.12, -1.28);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(clientW, clientH);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-0.32, -0.45, 0.95);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxDistance = 18;
    controls.minDistance = 0.2;
    controls.update();
    controlsRef.current = controls;

    // Neutral industrial lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 1.45);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.15);
    dirLight.position.set(4, 9, -4);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xe2e8f0, 0.55);
    fillLight.position.set(-5, 4, 5);
    scene.add(fillLight);

    // Subtle Floor Grid (shown in CAD mode)
    const gridHelper = new THREE.GridHelper(11.5, 23, 0x9aa3ad, 0xb4bcc5);
    gridHelper.position.set(0, -1.16, 0.2);
    gridHelper.visible = false;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    // Clean Industrial CAD Room Architecture (shown in CAD mode)
    const cadRoomGroup = createCleanIndustrialRoomArchitecture();
    cadRoomGroup.visible = false;
    scene.add(cadRoomGroup);
    cadRoomGroupRef.current = cadRoomGroup;

    // ==================== AHMAD_BRANCH 3DGS DISPLAY FRAME + CEILING CUTAWAY ====================
    // 1. SparkRenderer at scene root (required for @sparkjsdev/spark SplatMesh to draw)
    try {
      const sparkRenderer = new SparkRenderer({ renderer, enableLod: false });
      scene.add(sparkRenderer);
      sparkRendererRef.current = sparkRenderer;
    } catch (err) {
      console.warn('SparkRenderer init warning:', err);
    }

    // 2. Display-frame group rotated 180 deg around X (maps raw PLY y-down to Three.js y-up)
    const splatDisplayGroup = new THREE.Group();
    splatDisplayGroup.name = 'display-frame';
    splatDisplayGroup.rotation.set(Math.PI, 0, 0);
    scene.add(splatDisplayGroup);
    splatDisplayGroupRef.current = splatDisplayGroup;

    // 3. CeilingCutaway SplatEdit mounted at SCENE ROOT (where +Y is up, matching ahmad_branch Viewer.jsx)
    try {
      const ceilingEdit = new SplatEdit({
        rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
        softEdge: 0.04
      });
      const ceilingPlane = new SplatEditSdf({
        type: SplatEditSdfType.PLANE,
        opacity: 0
      });
      ceilingPlane.rotation.x = Math.PI / 2;
      // floorY = -1.035, ceilingY = 0.811 -> cutY = -1.035 + 0.78 * (0.811 - (-1.035)) = 0.405
      ceilingPlane.position.set(0, 0.405, 0);
      ceilingEdit.add(ceilingPlane);
      ceilingEdit.visible = false;
      scene.add(ceilingEdit);
      ceilingCutEditRef.current = ceilingEdit;
    } catch (err) {
      console.warn('CeilingCutaway SplatEdit init warning:', err);
    }

    // 4. Unbound CV OBB group (inside display-frame so raw PLY OBB matrices align 1:1 with the splat!)
    const cvUnboundObbGroup = new THREE.Group();
    splatDisplayGroup.add(cvUnboundObbGroup);
    cvUnboundObbGroupRef.current = cvUnboundObbGroup;

    // Semantic Segmentation Sweep Plane
    const laserGroup = new THREE.Group();
    const laserPlaneGeo = new THREE.PlaneGeometry(11.5, 4.5);
    const laserPlaneMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22,
      depthWrite: false
    });
    laserGroup.add(new THREE.Mesh(laserPlaneGeo, laserPlaneMat));
    laserGroup.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(laserPlaneGeo),
        new THREE.LineBasicMaterial({ color: 0x38bdf8 })
      )
    );
    laserGroup.position.set(0, 0.5, -3.2);
    laserGroup.visible = false;
    scene.add(laserGroup);
    laserWaveMeshRef.current = laserGroup;

    const assetGroup = new THREE.Group();
    const structuralGroup = new THREE.Group();
    const pathGroup = new THREE.Group();
    const navGraphGroup = new THREE.Group();
    const fleetGroup = new THREE.Group();
    const exerciseGroup = new THREE.Group();
    const exercisePathGroup = new THREE.Group();

    exerciseWorkerRigsRef.current.clear();

    // Staging Station Line Pad at the Front Entrance (`front_entry`: [2.82, -1.036, -1.78])
    const stagingPadGeo = new THREE.PlaneGeometry(0.75, 2.25);
    stagingPadGeo.rotateX(-Math.PI / 2);
    const stagingPadMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.20,
      side: THREE.DoubleSide
    });
    const stagingPad = new THREE.Mesh(stagingPadGeo, stagingPadMat);
    stagingPad.position.set(2.82, -1.036, -1.78);
    stagingPad.rotation.y = -0.32;
    exerciseGroup.add(stagingPad);

    const stagingBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(stagingPadGeo),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.78 })
    );
    stagingBorder.position.copy(stagingPad.position);
    stagingBorder.rotation.copy(stagingPad.rotation);
    exerciseGroup.add(stagingBorder);

    // 3D AR Traffic Red-Light / Green-Light Virtual Floor Gate & Beacon
    const arGateGroup = new THREE.Group();
    const gateBarGeo = new THREE.BoxGeometry(0.95, 0.03, 0.12);
    const gateBarMat = new THREE.MeshBasicMaterial({
      color: 0x49a942,
      transparent: true,
      opacity: 0.85
    });
    const gateBar = new THREE.Mesh(gateBarGeo, gateBarMat);
    gateBar.position.set(0, 0.03, 0);
    arGateGroup.add(gateBar);

    const gateArchGeo = new THREE.RingGeometry(0.38, 0.44, 28, 1, 0, Math.PI);
    const gateArchMat = new THREE.MeshBasicMaterial({
      color: 0x49a942,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65
    });
    const gateArch = new THREE.Mesh(gateArchGeo, gateArchMat);
    gateArch.position.set(0, 0.05, 0);
    arGateGroup.add(gateArch);
    arGateGroup.visible = false;
    arGateGroup.userData = { gateBarMat, gateArchMat };
    scene.add(arGateGroup);
    arTrafficGateRef.current = arGateGroup;

    scene.add(assetGroup);
    scene.add(structuralGroup);
    scene.add(pathGroup);
    scene.add(navGraphGroup);
    scene.add(fleetGroup);
    scene.add(exerciseGroup);
    scene.add(exercisePathGroup);

    assetGroupRef.current = assetGroup;
    structuralGroupRef.current = structuralGroup;
    pathGroupRef.current = pathGroup;
    navGraphGroupRef.current = navGraphGroup;
    fleetGroupRef.current = fleetGroup;
    exerciseGroupRef.current = exerciseGroup;
    exercisePathGroupRef.current = exercisePathGroup;

    const primaryRig = createHumanoidRig(0xd96b27, false, [0.58, 1.38, 0.58]);
    fleetGroup.add(primaryRig);
    primaryRigRef.current = primaryRig;

    const r2Rig = createHumanoidRig(0x49a942, false, [0.58, 1.38, 0.58]);
    const h1Rig = createHumanoidRig(0x1f6fb2, true, [0.52, 1.68, 0.48]);
    fleetGroup.add(r2Rig);
    fleetGroup.add(h1Rig);
    secondaryRigsRef.current = { R2: r2Rig, H1: h1Rig };

    // 3D Gaussian Splatting Soft-Disc Shader Buffer (with automatic CeilingCutaway clipping at y > 0.405)
    const fallbackGeo = new THREE.BufferGeometry();
    const fallbackMat = new THREE.ShaderMaterial({
      uniforms: {
        uPointSize: { value: 18.0 },
        uOpacity: { value: 0.94 },
        uCutEnabled: { value: 0.0 },
        uCutY: { value: 0.405 }
      },
      vertexShader: `
        attribute vec3 color;
        varying vec3 vColor;
        varying float vCutAlpha;
        uniform float uPointSize;
        uniform float uCutEnabled;
        uniform float uCutY;
        void main() {
          vColor = color;
          vCutAlpha = (uCutEnabled > 0.5 && position.y > uCutY) ? 0.0 : 1.0;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float dist = max(0.35, -mvPosition.z);
          gl_PointSize = clamp(uPointSize / dist, 1.5, 26.0) * vCutAlpha;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vCutAlpha;
        uniform float uOpacity;
        void main() {
          if (vCutAlpha < 0.05) discard;
          vec2 cxy = 2.0 * gl_PointCoord - 1.0;
          float r2 = dot(cxy, cxy);
          if (r2 > 1.0) discard;
          float alpha = exp(-3.2 * r2) * uOpacity * vCutAlpha;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: true
    });
    const fallbackPoints = new THREE.Points(fallbackGeo, fallbackMat);
    fallbackPoints.visible = true;
    scene.add(fallbackPoints);
    pointCloudObjRef.current = fallbackPoints;
    pointCloudMatRef.current = fallbackMat;

    // Keyboard WASD / Arrow Keys / Delete Worker Listener
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && stateRef.current.selectedWorkerId) {
        e.preventDefault();
        if (onDeleteWorker) onDeleteWorker(stateRef.current.selectedWorkerId);
        return;
      }

      const k = e.key.toLowerCase();
      if (k === 'v') {
        e.preventDefault();
        if (handleSetNavModeRef.current) {
          const next = navModeRef.current === 'walk' ? 'orbit' : 'walk';
          handleSetNavModeRef.current(next);
        }
        return;
      }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keysPressedRef.current[k] = true;
        setIsWasdWalking(true);
        if (onSimPlayingChange) onSimPlayingChange(false);
        // Manual walking is ignored while the line-dispatch exercise runs (default ON): leave it.
        if (stateRef.current.exerciseMode && onToggleExerciseMode) onToggleExerciseMode(false);
        if (!manualPosRef.current && primaryRigRef.current) {
          manualPosRef.current = {
            x: primaryRigRef.current.position.x,
            y: -1.02,
            z: primaryRigRef.current.position.z,
            angle: primaryRigRef.current.rotation.y
          };
        }
      }
    };

    const handleKeyUp = (e) => {
      const k = e.key.toLowerCase();
      delete keysPressedRef.current[k];
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Precision 3D OBB + Touch-Magnet Raycaster (zero wireframe line-threshold hijacking!)
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.01 };
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    // Hybrid 3D OBB center-weighted raycast + 2D touch-magnet for effortless iPad/desktop picking
    const pickAssetFromPointer = (clientX, clientY, allowScreenMagnet = true) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // 1. Raycast ONLY against the 30 dedicated solid OBB hitbox meshes (never LineSegments!)
      const hitboxes = assetHitboxesRef.current || [];
      if (hitboxes.length > 0) {
        const hits = raycaster.intersectObjects(hitboxes, false);
        if (hits.length > 0) {
          let bestAsset = null;
          let bestScore = Infinity;
          hits.forEach((h) => {
            const a = h.object?.userData?.asset;
            if (!a) return;
            const centerVec = new THREE.Vector3(a.position[0], a.position[1], a.position[2]);
            const rayToCenter = raycaster.ray.distanceToPoint(centerVec);
            // Score prioritizes the object whose 3D center you tapped dead-on, with slight depth tie-breaker
            const score = rayToCenter + h.distance * 0.05;
            if (score < bestScore) {
              bestScore = score;
              bestAsset = a;
            }
          });
          if (bestAsset) return bestAsset;
        }
      }

      // 2. Touch-friendly 2D screen-space magnet (28px radius around projected 3D object centers)
      if (allowScreenMagnet && stateRef.current.assets?.length) {
        const localX = clientX - rect.left;
        const localY = clientY - rect.top;
        let closestAsset = null;
        let closestPx = 28;
        stateRef.current.assets.forEach((a) => {
          const p = new THREE.Vector3(a.position[0], a.position[1], a.position[2]);
          const camDist = p.distanceTo(camera.position);
          p.project(camera);
          if (p.z > -1 && p.z < 1) {
            const sx = (p.x * 0.5 + 0.5) * rect.width;
            const sy = (-(p.y * 0.5) + 0.5) * rect.height;
            const pxDist = Math.hypot(sx - localX, sy - localY) + camDist * 0.6;
            if (pxDist < closestPx) {
              closestPx = pxDist;
              closestAsset = a;
            }
          }
        });
        if (closestAsset) return closestAsset;
      }

      return null;
    };

    const handlePointerDown = (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
      isDraggingLookRef.current = true;
    };

    const handlePointerMove = (e) => {
      if (e.buttons > 0) {
        cameraFlyRef.current.active = false;
        if (!stateRef.current.showWorkers && navModeRef.current === 'walk') {
          const dx = e.clientX - lastPointerPosRef.current.x;
          const dy = e.clientY - lastPointerPosRef.current.y;
          lastPointerPosRef.current = { x: e.clientX, y: e.clientY };

          const sensitivity = 0.0032;
          firstPersonYawRef.current -= dx * sensitivity;
          firstPersonPitchRef.current = Math.max(
            -1.35,
            Math.min(1.35, firstPersonPitchRef.current - dy * sensitivity)
          );
          return;
        }
        return;
      }
      const picked = pickAssetFromPointer(e.clientX, e.clientY, false);
      const hoveredId = picked ? picked.asset_id : null;
      if (hoveredAssetIdRef.current !== hoveredId) {
        hoveredAssetIdRef.current = hoveredId;
        renderer.domElement.style.cursor = hoveredId ? 'pointer' : '';
      }
    };

    const handleWheel = () => {
      cameraFlyRef.current.active = false;
    };

    const handlePointerUp = (e) => {
      const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      // Allow up to 14px finger jitter on iPad touchscreens without treating a tap as an orbit drag
      if (moveDist > 14) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // 0. Check Exercise Mode Workers FIRST
      if (stateRef.current.exerciseMode && exerciseGroupRef.current) {
        const workerHits = raycaster.intersectObjects(exerciseGroupRef.current.children, true);
        if (workerHits.length > 0) {
          let wObj = workerHits[0].object;
          while (wObj && !wObj.userData?.workerId) {
            wObj = wObj.parent;
          }
          if (wObj?.userData?.workerId) {
            if (onSelectWorker) onSelectWorker(wObj.userData.workerId);
            return;
          }
        }
      }

      // 1. Check 30 Bound Assets / OBBs using precision center-weighted 3D + touch-magnet picker
      const clickedAsset = pickAssetFromPointer(e.clientX, e.clientY, true);
      if (clickedAsset) {
        manualPosRef.current = null;
        setIsWasdWalking(false);
        onSelectAsset(clickedAsset);
        setClickedPopoverAssetId(clickedAsset.asset_id);
        setClickedUnboundCvObj(null);
        triggerCameraFlyTo(
          clickedAsset.position,
          clickedAsset.approach_point,
          clickedAsset.bbox_size
        );
        if (clickedAsset.cvObject?.object_id && onSelectCvObject) {
          onSelectCvObject(clickedAsset.cvObject);
        }
        return;
      }

      // 2. Check Unbound CV OBBs (when "Show All 441 CV Detections" is enabled)
      if (stateRef.current.showAllCvDetections && cvUnboundObbGroupRef.current) {
        const cvHits = raycaster.intersectObjects(cvUnboundObbGroupRef.current.children, true);
        if (cvHits.length > 0) {
          let cvMesh = cvHits[0].object;
          while (cvMesh && !cvMesh.userData?.cvObject) {
            cvMesh = cvMesh.parent;
          }
          if (cvMesh?.userData?.cvObject) {
            const cvObj = cvMesh.userData.cvObject;
            setClickedUnboundCvObj(cvObj);
            setClickedPopoverAssetId(null);
            const dispCenter = rawToDisplay(cvObj.obb?.center ?? cvObj.center);
            triggerCameraFlyTo(dispCenter, null, cvObj.obb?.extent || [0.5, 0.5, 0.5]);
            if (onSelectCvObject) onSelectCvObject(cvObj);
            return;
          }
        }
      }

      // 3. Clicked on empty space -> hide Popover Card and deselect worker
      setClickedPopoverAssetId(null);
      setClickedUnboundCvObj(null);
      setClickedScreenAnchor(null);
      if (onSelectWorker) onSelectWorker(null);
    };

    // ======== Move-Objects mode: capture-phase handlers (run BEFORE OrbitControls / click picking) ========
    const NON_MOVABLE_CLASSES = ['pipe', 'door', 'sign'];
    const pickMovable = (clientX, clientY) => {
      const grp = cvUnboundObbGroupRef.current;
      if (!grp) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const picks = grp.children.filter((c) => c.isMesh && c.userData?.cvObject);
      const hits = raycaster.intersectObjects(picks, false);
      let best = null;
      let bestVol = Infinity;
      for (const h of hits) {
        const o = h.object.userData.cvObject;
        if (NON_MOVABLE_CLASSES.includes(o.class)) continue;
        const ext = o.obb?.extent || [1, 1, 1];
        const vol = ext[0] * ext[1] * ext[2];
        if (vol < bestVol) {
          bestVol = vol;
          best = h; // prefer the smallest (most specific) object under the finger
        }
      }
      return best;
    };
    const groundHit = (clientX, clientY, planeY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      const pt = new THREE.Vector3();
      return raycaster.ray.intersectPlane(plane, pt) ? pt : null;
    };
    const onMoveDown = (e) => {
      if (!moveModeRef.current) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const hit = pickMovable(e.clientX, e.clientY);
      if (!hit) return; // empty space: let OrbitControls orbit as usual
      const start = groundHit(e.clientX, e.clientY, hit.point.y);
      if (!start) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const obj = hit.object.userData.cvObject;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const src = obj._origObb ?? obj.obb ?? { center: obj.center };
      const origDisp = rawToDisplay(src.center);
      const base = objectMovesRef.current[obj.object_id] || { dx: 0, dz: 0 };
      const nodes = cvUnboundObbGroupRef.current.children
        .filter((c) => c.userData?.cvObject?.object_id === obj.object_id)
        .map((node) => ({ node, pos: node.position.clone() }));
      moveDragRef.current = {
        id: obj.object_id,
        pointerId: e.pointerId,
        planeY: hit.point.y,
        start,
        base,
        total: { ...base },
        origDisp,
        nodes,
        moved: false,
        downX: e.clientX,
        downY: e.clientY
      };
      setMoveSelectedId(obj.object_id);
      renderer.domElement.style.cursor = 'grabbing';
    };
    const onMoveMove = (e) => {
      const d = moveDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      e.stopImmediatePropagation();
      if (!d.moved && Math.hypot(e.clientX - d.downX, e.clientY - d.downY) > 6) d.moved = true;
      if (!d.moved) return;
      const p = groundHit(e.clientX, e.clientY, d.planeY);
      if (!p) return;
      let dx = d.base.dx + (p.x - d.start.x);
      let dz = d.base.dz + (p.z - d.start.z);
      // keep the object inside the room footprint
      dx = Math.max(-4.6 - d.origDisp[0], Math.min(4.6 - d.origDisp[0], dx));
      dz = Math.max(-3.4 - d.origDisp[2], Math.min(3.4 - d.origDisp[2], dz));
      d.total = { dx, dz };
      applySplatMovesRef.current?.({ ...objectMovesRef.current, [d.id]: d.total });
      d.nodes.forEach(({ node, pos }) => {
        node.position.set(pos.x + (dx - d.base.dx), pos.y, pos.z - (dz - d.base.dz));
      });
    };
    const onMoveUp = (e) => {
      const d = moveDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      e.stopImmediatePropagation();
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      moveDragRef.current = null;
      renderer.domElement.style.cursor = '';
      if (d.moved && moveCbRef.current) moveCbRef.current(d.id, d.total);
    };
    renderer.domElement.addEventListener('pointerdown', onMoveDown, true);
    renderer.domElement.addEventListener('pointermove', onMoveMove, true);
    renderer.domElement.addEventListener('pointerup', onMoveUp, true);
    renderer.domElement.addEventListener('pointercancel', onMoveUp, true);

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: true });

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth || 1280;
      const h = container.clientHeight || (window.innerHeight - 80) || 720;
      if (h <= 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    let animId;
    let lastTime = performance.now();
    let labelTick = 0;

    const updateRigOnPath = (rig, points, progress, isMoving, now, proxRadius, obstacles) => {
      if (!rig || !points || points.length === 0) return { position: [0, -1.02, 0], tangent: [0, 0, 1] };
      const sample = samplePathAtProgress(points, progress);
      const [safeX, safeZ] = resolveObstacleCollisions(
        sample.position[0],
        sample.position[2],
        0.24,
        obstacles
      );
      sample.position[0] = safeX;
      sample.position[2] = safeZ;
      rig.position.set(safeX, sample.position[1], safeZ);

      const targetAngle = Math.atan2(sample.tangent[0], sample.tangent[2]);
      const prevAngle = rig.userData.currentAngle ?? targetAngle;
      let diff = targetAngle - prevAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const smoothAngle = prevAngle + diff * 0.16;
      rig.userData.currentAngle = smoothAngle;
      rig.rotation.y = smoothAngle;

      const walkCycle = isMoving ? Math.sin(now * 0.011) * 0.55 : 0;
      const bob = isMoving ? Math.abs(Math.cos(now * 0.011)) * 0.035 : 0;
      if (rig.userData.bodyGroup) {
        rig.userData.bodyGroup.position.y = bob;
      }
      if (rig.userData.leftLegPivot && rig.userData.rightLegPivot) {
        rig.userData.leftLegPivot.rotation.x = walkCycle;
        rig.userData.rightLegPivot.rotation.x = -walkCycle;
        rig.userData.leftArmPivot.rotation.x = -walkCycle * 0.75;
        rig.userData.rightArmPivot.rotation.x = walkCycle * 0.75;
      }
      if (rig.userData.radarRing) {
        const pulse = 1 + Math.sin(now * 0.005) * 0.04;
        rig.userData.radarRing.scale.set(proxRadius * pulse, 1, proxRadius * pulse);
      }
      return sample;
    };

    const animate = (now) => {
      animId = requestAnimationFrame(animate);
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const st = stateRef.current;
      const obstacles = buildCollisionBoxes(st.assets);

      // Automatic Ceiling Cutaway (ported from ahmad_branch CeilingCutaway.jsx):
      // Only active when camera is above ceilingY (0.811) AND ceilingCutaway toggle is enabled.
      // Views from inside the room (camera.position.y <= 0.811) are untouched!
      const isAboveCeiling =
        Boolean(st.ceilingCutaway) &&
        !st.arFirstPersonMode &&
        camera.position.y > 0.811;
      if (pointCloudMatRef.current?.uniforms?.uCutEnabled) {
        pointCloudMatRef.current.uniforms.uCutEnabled.value = isAboveCeiling ? 1.0 : 0.0;
      }
      if (ceilingCutEditRef.current && ceilingCutEditRef.current.visible !== isAboveCeiling) {
        ceilingCutEditRef.current.visible = isAboveCeiling;
      }

      // Animate AI Semantic Laser Wave if triggered
      if (laserSweepStateRef.current.active && laserWaveMeshRef.current) {
        laserWaveMeshRef.current.visible = true;
        laserSweepStateRef.current.zPos += dt * 3.0;
        laserWaveMeshRef.current.position.z = laserSweepStateRef.current.zPos;
        const pct = Math.min(
          100,
          Math.max(0, Math.round(((laserSweepStateRef.current.zPos + 3.2) / 7.5) * 100))
        );
        if (onSemanticBlendChange) onSemanticBlendChange(pct);
        if (laserSweepStateRef.current.zPos >= 4.4) {
          laserSweepStateRef.current.active = false;
          laserWaveMeshRef.current.visible = false;
          if (onSemanticBlendChange) onSemanticBlendChange(100);
        }
      }

      const isTechWorkersVisible = Boolean(st.showWorkers);
      if (fleetGroupRef.current) fleetGroupRef.current.visible = false;
      if (pathGroupRef.current) pathGroupRef.current.visible = false;
      if (exerciseGroupRef.current) exerciseGroupRef.current.visible = isTechWorkersVisible;
      if (exercisePathGroupRef.current) exercisePathGroupRef.current.visible = isTechWorkersVisible;

      const keys = keysPressedRef.current;
      const anyWasdDown = Boolean(
        keys.w ||
          keys.s ||
          keys.a ||
          keys.d ||
          keys.q ||
          keys.e ||
          keys.arrowup ||
          keys.arrowdown ||
          keys.arrowleft ||
          keys.arrowright
      );

      let primarySample = {
        position: [0, -1.02, -0.32],
        tangent: [0, 0, 1]
      };

      let focusWorkerId = null;

      if (st.exerciseMode) {
        const controlledWorker =
          st.exerciseWorkers.find((w) => w.id === st.selectedWorkerId) ||
          st.exerciseWorkers.find((w) => w.manualControl) ||
          st.exerciseWorkers[0];
        const controlledId = controlledWorker?.id || 'W-01';

        // Manual Technician Movement (W/A/S/D, Arrow keys, Q/E strafe, or On-Screen iPad Touch Pad)
        if (anyWasdDown && controlledWorker) {
          cameraFlyRef.current.active = false;
          const basePos = controlledWorker.position || controlledWorker.pos || [2.905, -1.02, -2.095];
          if (!manualWorkerPosesRef.current[controlledId]) {
            manualWorkerPosesRef.current[controlledId] = {
              x: basePos[0],
              z: basePos[2],
              angle: controlledWorker.angle ?? -0.46,
              isMoving: false
            };
          }
          const mPose = manualWorkerPosesRef.current[controlledId];
          const turnSpeed = 2.15 * dt;
          if (keys.a || keys.arrowleft) mPose.angle += turnSpeed;
          if (keys.d || keys.arrowright) mPose.angle -= turnSpeed;

          let fwdInput = 0;
          if (keys.w || keys.arrowup) fwdInput += 1;
          if (keys.s || keys.arrowdown) fwdInput -= 1;

          let strafeInput = 0;
          if (keys.q) strafeInput -= 1;
          if (keys.e) strafeInput += 1;

          const hasTranslation = fwdInput !== 0 || strafeInput !== 0;
          mPose.isMoving = hasTranslation;

          if (hasTranslation) {
            const moveAngle =
              strafeInput !== 0 && fwdInput === 0
                ? mPose.angle - Math.sign(strafeInput) * (Math.PI / 2)
                : fwdInput < 0
                ? mPose.angle + Math.PI
                : mPose.angle - strafeInput * 0.45;
            const stepSpeed = (fwdInput < 0 ? 1.45 : 1.85) * dt;
            const stepRes = resolveManualTechnicianStep(
              mPose.x,
              mPose.z,
              moveAngle,
              stepSpeed,
              0.28,
              obstacles,
              st.exerciseWorkers,
              controlledId
            );
            mPose.x = stepRes.x;
            mPose.z = stepRes.z;
            if (stepRes.blocked) {
              setObstacleAlert({
                blocked: true,
                label: stepRes.obstacleLabel || 'Room Object',
                dist: stepRes.obstacleDist || 0.32
              });
            } else {
              setObstacleAlert(null);
            }
          } else {
            // Turning in place: check if an object is directly in front of the new heading
            const probeX = mPose.x + Math.sin(mPose.angle) * 0.42;
            const probeZ = mPose.z + Math.cos(mPose.angle) * 0.42;
            const hitFront = isPointInObstacle(probeX, probeZ, 0.24, obstacles);
            if (hitFront) {
              setObstacleAlert({
                blocked: false,
                label: hitFront.tag || hitFront.asset_id || hitFront.id || 'Room Object',
                dist: 0.42
              });
            } else {
              setObstacleAlert(null);
            }
          }

          if (onManualUpdateWorkerPose && now - lastManualSyncRef.current > 45) {
            lastManualSyncRef.current = now;
            onManualUpdateWorkerPose(controlledId, mPose.x, mPose.z, mPose.angle, true);
          }
        } else if (controlledId && manualWorkerPosesRef.current[controlledId]) {
          manualWorkerPosesRef.current[controlledId].isMoving = false;
        }

        const rigMap = exerciseWorkerRigsRef.current;
        const exGroup = exerciseGroupRef.current;
        const activeIds = new Set(st.exerciseWorkers.map((w) => w.id));

        if (exGroup) {
          for (const [id, r] of rigMap.entries()) {
            if (!activeIds.has(id)) {
              exGroup.remove(r);
              rigMap.delete(id);
            }
          }
        }

        st.exerciseWorkers.forEach((w, idx) => {
          const manualPose = manualWorkerPosesRef.current[w.id];
          const wpos =
            manualPose && w.manualControl !== false
              ? [manualPose.x, -1.02, manualPose.z]
              : w.position || w.pos || [0, -1.02, -0.32];
          const wAngle =
            manualPose && w.manualControl !== false ? manualPose.angle : w.angle ?? 0;

          let rig = rigMap.get(w.id);
          if (!rig && exGroup) {
            const isHuman = w.type === 'human';
            const hex =
              typeof w.colorHex === 'number'
                ? w.colorHex
                : parseInt(String(w.color || '#1f6fb2').replace('#', ''), 16);
            rig = createHumanoidRig(
              hex,
              isHuman,
              isHuman ? [0.52, 1.68, 0.48] : [0.58, 1.38, 0.58]
            );
            rig.position.set(wpos[0], -1.02, wpos[2]);
            rig.rotation.y = wAngle;
            rig.userData.workerId = w.id;
            rig.traverse((child) => {
              child.userData.workerId = w.id;
            });
            exGroup.add(rig);
            rigMap.set(w.id, rig);
          } else if (rig && exGroup && rig.parent !== exGroup) {
            exGroup.add(rig);
          }
          if (!rig) return;

          // Hide the active technician's own 3D mesh only in 1st-Person eye view; keep visible in 3rd-Person AR chase view!
          rig.visible = !(st.arFirstPersonMode && st.arCameraPerspective !== '3rd' && w.id === controlledId);

          if (manualPose && w.id === controlledId) {
            rig.position.set(wpos[0], -1.02, wpos[2]);
            rig.rotation.y = wAngle;
            rig.userData.currentAngle = wAngle;
          } else {
            rig.position.lerp(new THREE.Vector3(wpos[0], -1.02, wpos[2]), 0.35);
            const prevAngle = rig.userData.currentAngle ?? wAngle;
            let diff = wAngle - prevAngle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const smoothAngle = prevAngle + diff * 0.22;
            rig.userData.currentAngle = smoothAngle;
            rig.rotation.y = smoothAngle;
          }

          const isManualWalking = Boolean(manualPose?.isMoving && w.id === controlledId);
          const isWalking =
            isManualWalking ||
            (!st.exercisePaused &&
              (w.state === 'WALKING_TO_FAULT' || w.state === 'RETURNING') &&
              w.trafficStatus !== 'YIELDING');
          const isRepairing = w.state === 'REPAIRING';

          const walkCycle = isWalking ? Math.sin(now * 0.013 + idx * 1.3) * 0.58 : 0;
          const bob = isWalking ? Math.abs(Math.cos(now * 0.013 + idx * 1.3)) * 0.032 : 0;

          if (rig.userData.bodyGroup) {
            rig.userData.bodyGroup.position.y = bob;
          }
          if (rig.userData.wrenchGroup) {
            rig.userData.wrenchGroup.visible = isRepairing;
          }
          if (rig.userData.leftLegPivot && rig.userData.rightLegPivot) {
            rig.userData.leftLegPivot.rotation.x = walkCycle;
            rig.userData.rightLegPivot.rotation.x = -walkCycle;
            if (isRepairing) {
              const targetAsset = st.assets?.find((a) => a.asset_id === w.targetAssetId);
              const isOverheadTarget = Boolean(targetAsset && targetAsset.position?.[1] > -0.35);
              const wrenchSwing = st.exercisePaused ? 0 : Math.sin(now * 0.022) * 0.38;
              if (isOverheadTarget) {
                // Overhead roof/ceiling repair posture (e.g. CV-001 on the ceiling): reach upward!
                rig.userData.rightArmPivot.rotation.x = -2.55 + wrenchSwing;
                rig.userData.leftArmPivot.rotation.x = -2.25;
              } else {
                rig.userData.rightArmPivot.rotation.x = -1.05 + wrenchSwing;
                rig.userData.leftArmPivot.rotation.x = -0.65;
              }
            } else {
              rig.userData.leftArmPivot.rotation.x = -walkCycle * 0.75;
              rig.userData.rightArmPivot.rotation.x = walkCycle * 0.75;
            }
          }

          if (rig.userData.hitboxWire) {
            const isSel = st.selectedWorkerId === w.id || w.id === controlledId;
            rig.userData.hitboxWire.material.opacity = isSel ? 1.0 : 0.42;
          }
          if (rig.userData.radarRing) {
            const isSel = st.selectedWorkerId === w.id || w.id === controlledId;
            // Robot.jsx expanding sonar pulse ring animation from ahmad_branch
            const phase = ((now * 0.001) * (isWalking ? 0.95 : 0.42)) % 1;
            const ringScale = isWalking
              ? 0.46 + phase * 0.88
              : isSel
              ? 0.78 + Math.sin(now * 0.004) * 0.08
              : 0.52;
            rig.userData.radarRing.scale.set(ringScale, 1, ringScale);
            if (rig.userData.radarRing.material) {
              const baseHex =
                typeof w.colorHex === 'number'
                  ? w.colorHex
                  : parseInt(String(w.color || '#1f6fb2').replace('#', ''), 16);
              const sigHex =
                w.trafficStatus === 'YIELDING'
                  ? 0xef4444
                  : w.trafficStatus === 'PASSING_RIGHT'
                  ? 0xf59e0b
                  : baseHex;
              rig.userData.radarRing.material.color.setHex(sigHex);
              rig.userData.radarRing.material.opacity = isWalking
                ? Math.max(0.18, (1 - phase) * 0.62)
                : isSel
                ? 0.65
                : 0.42;
            }
          }
        });

        const focusWorker =
          st.exerciseWorkers.find((w) => w.id === st.selectedWorkerId) ||
          st.exerciseWorkers.find((w) => w.manualControl) ||
          st.exerciseWorkers.find((w) => w.state !== 'STANDBY') ||
          st.exerciseWorkers[0];
        if (focusWorker) {
          const mPose = manualWorkerPosesRef.current[focusWorker.id];
          const fwPos =
            mPose && focusWorker.manualControl !== false
              ? [mPose.x, -1.02, mPose.z]
              : focusWorker.position || focusWorker.pos || [0, -1.02, -0.32];
          const fwAngle =
            mPose && focusWorker.manualControl !== false
              ? mPose.angle
              : focusWorker.angle || 0;
          focusWorkerId = focusWorker.id;
          primarySample = {
            position: [fwPos[0], -1.02, fwPos[2]],
            tangent: [Math.sin(fwAngle), 0, Math.cos(fwAngle)]
          };
        }
      }

      const trafficPeers = st.exerciseMode
        ? st.exerciseWorkers
        : [
            secondaryRigsRef.current?.R2?.visible && {
              id: 'R2',
              type: 'robot',
              state: 'WALKING_TO_FAULT',
              position: [
                secondaryRigsRef.current.R2.position.x,
                -1.02,
                secondaryRigsRef.current.R2.position.z
              ],
              angle: secondaryRigsRef.current.R2.rotation.y
            },
            secondaryRigsRef.current?.H1?.visible && {
              id: 'H1',
              type: 'human',
              state: 'WALKING_TO_FAULT',
              position: [
                secondaryRigsRef.current.H1.position.x,
                -1.02,
                secondaryRigsRef.current.H1.position.z
              ],
              angle: secondaryRigsRef.current.H1.rotation.y
            }
          ].filter(Boolean);

      let activeSignal = computeArTrafficSignal(
        primarySample.position,
        primarySample.tangent,
        trafficPeers,
        focusWorkerId
      );

      if (st.arTrafficOverride === 'RED') {
        activeSignal = {
          light: 'RED',
          headline: 'RED LIGHT  —  HOLD POSITION',
          detail: 'Intersection stop signal active · Forward motion gated',
          conflictingUnitId: activeSignal.conflictingUnitId || 'Cross-Traffic',
          distanceMeters: activeSignal.distanceMeters || 0.85,
          speedMultiplier: 0,
          laneOffset: 0
        };
      } else if (st.arTrafficOverride === 'YELLOW') {
        activeSignal = {
          light: 'YELLOW',
          headline: 'YELLOW LIGHT  —  KEEP RIGHT LANE',
          detail: 'Shared corridor active · Right-hand passing offset +0.22 m',
          conflictingUnitId: activeSignal.conflictingUnitId || 'Oncoming Unit',
          distanceMeters: activeSignal.distanceMeters || 1.45,
          speedMultiplier: 0.75,
          laneOffset: 0.22
        };
      } else if (st.arTrafficOverride === 'GREEN') {
        activeSignal = {
          light: 'GREEN',
          headline: 'GREEN LIGHT  —  PROCEED',
          detail: 'Corridor clear · Full right-of-way granted',
          conflictingUnitId: null,
          distanceMeters: activeSignal.distanceMeters,
          speedMultiplier: 1.0,
          laneOffset: 0
        };
      }

      if (!st.exerciseMode && manualPosRef.current) {
        const speed = 2.2 * dt * (st.arFirstPersonMode ? activeSignal.speedMultiplier : 1.0);
        const turnSpeed = 2.3 * dt;
        if (keys.a || keys.arrowleft) manualPosRef.current.angle += turnSpeed;
        if (keys.d || keys.arrowright) manualPosRef.current.angle -= turnSpeed;

        let moveDir = 0;
        if (keys.w || keys.arrowup) {
          moveDir = st.arFirstPersonMode && activeSignal.light === 'RED' ? 0 : 1;
        }
        if (keys.s || keys.arrowdown) moveDir = -1;

        if (moveDir !== 0) {
          const prevX = manualPosRef.current.x;
          const prevZ = manualPosRef.current.z;
          const nx = prevX + Math.sin(manualPosRef.current.angle) * speed * moveDir;
          const nz = prevZ + Math.cos(manualPosRef.current.angle) * speed * moveDir;
          const [rx, rz] = resolveObstacleCollisions(nx, nz, 0.26, obstacles, prevX, prevZ);
          manualPosRef.current.x = rx;
          manualPosRef.current.z = rz;
        } else {
          const [rx, rz] = resolveObstacleCollisions(
            manualPosRef.current.x,
            manualPosRef.current.z,
            0.26,
            obstacles
          );
          manualPosRef.current.x = rx;
          manualPosRef.current.z = rz;
        }

        const rig = primaryRigRef.current;
        if (rig) {
          rig.position.set(manualPosRef.current.x, -1.02, manualPosRef.current.z);
          rig.rotation.y = manualPosRef.current.angle;
          rig.userData.currentAngle = manualPosRef.current.angle;

          const walkCycle = anyWasdDown && moveDir !== 0 ? Math.sin(now * 0.014) * 0.6 : 0;
          if (rig.userData.leftLegPivot && rig.userData.rightLegPivot) {
            rig.userData.leftLegPivot.rotation.x = walkCycle;
            rig.userData.rightLegPivot.rotation.x = -walkCycle;
            rig.userData.leftArmPivot.rotation.x = -walkCycle * 0.75;
            rig.userData.rightArmPivot.rotation.x = walkCycle * 0.75;
          }
          if (rig.userData.radarRing) {
            rig.userData.radarRing.scale.set(st.proximityRadius, 1, st.proximityRadius);
          }
        }

        primarySample = {
          position: [manualPosRef.current.x, -1.02, manualPosRef.current.z],
          tangent: [Math.sin(manualPosRef.current.angle), 0, Math.cos(manualPosRef.current.angle)]
        };
      } else if (!st.exerciseMode) {
        const activePath = st.activeProfile === 'human' ? st.humanPath : st.robotPath;
        let currentProgress = st.simProgress;
        const speedMult = st.arFirstPersonMode ? activeSignal.speedMultiplier : 1.0;
        if (st.simPlaying && !st.exercisePaused && activePath?.points?.length > 1 && speedMult > 0) {
          currentProgress = st.simProgress + dt * 0.15 * speedMult;
          if (currentProgress >= 1) {
            currentProgress = 0;
          }
          onSimProgressChange(currentProgress);
        }

        primarySample = updateRigOnPath(
          primaryRigRef.current,
          activePath?.points || [[0, -1.02, -0.25]],
          currentProgress,
          st.simPlaying && !st.exercisePaused && speedMult > 0,
          now,
          st.proximityRadius,
          obstacles
        );
      }

      const secRigs = secondaryRigsRef.current;
      if (!st.exerciseMode && secRigs.R2 && secRigs.H1) {
        secRigs.R2.visible = Boolean(st.multiAgentEnabled);
        secRigs.H1.visible = Boolean(st.multiAgentEnabled);

        if (st.multiAgentEnabled && st.fleetAssignments?.length >= 3) {
          const r2Assign = st.fleetAssignments.find((a) => a.agent_id === 'R2');
          const h1Assign = st.fleetAssignments.find((a) => a.agent_id === 'H1');
          if (r2Assign?.path?.points) {
            updateRigOnPath(
              secRigs.R2,
              r2Assign.path.points,
              (st.simProgress + 0.33) % 1.0,
              st.simPlaying && !st.exercisePaused,
              now + 400,
              st.proximityRadius * 0.75,
              obstacles
            );
          }
          if (h1Assign?.path?.points) {
            updateRigOnPath(
              secRigs.H1,
              h1Assign.path.points,
              (st.simProgress + 0.66) % 1.0,
              st.simPlaying && !st.exercisePaused,
              now + 800,
              st.proximityRadius * 0.75,
              obstacles
            );
          }

          const activeRigs = [primaryRigRef.current, secRigs.R2, secRigs.H1].filter(Boolean);
          const minSep = 0.66;
          for (let i = 0; i < activeRigs.length; i++) {
            for (let j = i + 1; j < activeRigs.length; j++) {
              const a = activeRigs[i];
              const b = activeRigs[j];
              const dx = b.position.x - a.position.x;
              const dz = b.position.z - a.position.z;
              const d = Math.hypot(dx, dz);
              if (d < minSep && d > 1e-4) {
                const push = (minSep - d) * 0.55;
                const nx = dx / d;
                const nz = dz / d;
                const [ax, az] = resolveObstacleCollisions(a.position.x - nx * push, a.position.z - nz * push, 0.24, obstacles);
                const [bx, bz] = resolveObstacleCollisions(b.position.x + nx * push, b.position.z + nz * push, 0.24, obstacles);
                a.position.x = ax;
                a.position.z = az;
                b.position.x = bx;
                b.position.z = bz;
              }
            }
          }
        }
      }

      if (arTrafficGateRef.current) {
        arTrafficGateRef.current.visible = Boolean(st.arFirstPersonMode);
        if (st.arFirstPersonMode) {
          const gateX = primarySample.position[0] + primarySample.tangent[0] * 1.15;
          const gateZ = primarySample.position[2] + primarySample.tangent[2] * 1.15;
          arTrafficGateRef.current.position.set(gateX, -1.02, gateZ);
          arTrafficGateRef.current.rotation.y = Math.atan2(
            primarySample.tangent[0],
            primarySample.tangent[2]
          );
          const sigColor =
            activeSignal.light === 'RED'
              ? 0xef4444
              : activeSignal.light === 'YELLOW'
              ? 0xf59e0b
              : 0x49a942;
          arTrafficGateRef.current.userData.gateBarMat?.color.setHex(sigColor);
          arTrafficGateRef.current.userData.gateArchMat?.color.setHex(sigColor);
        }
      }

      if (st.arFirstPersonMode) {
        cameraFlyRef.current.active = false;
        if (st.arCameraPerspective === '3rd') {
          // 3rd-Person AR Chase Camera: follows smoothly behind and above the active technician
          const chaseX = primarySample.position[0] - primarySample.tangent[0] * 1.38;
          const chaseY = primarySample.position[1] + 1.08;
          const chaseZ = primarySample.position[2] - primarySample.tangent[2] * 1.38;
          camera.position.lerp(new THREE.Vector3(chaseX, chaseY, chaseZ), 0.24);

          const lookX = primarySample.position[0] + primarySample.tangent[0] * 0.75;
          const lookY = primarySample.position[1] + 0.48 + (arLookPitchRef.current || 0) * 1.5;
          const lookZ = primarySample.position[2] + primarySample.tangent[2] * 0.75;
          controls.target.lerp(new THREE.Vector3(lookX, lookY, lookZ), 0.28);
          controls.update();
        } else {
          // 1st-Person AR Visor Eye View
          const eyeX = primarySample.position[0] + primarySample.tangent[0] * 0.16;
          const eyeY = primarySample.position[1] + 0.68; // Natural human eye level inside 3DGS room (-0.34)
          const eyeZ = primarySample.position[2] + primarySample.tangent[2] * 0.16;
          camera.position.lerp(new THREE.Vector3(eyeX, eyeY, eyeZ), 0.28);

          const lookX = eyeX + primarySample.tangent[0] * 2.4;
          const lookY = eyeY + (arLookPitchRef.current || -0.04) * 2.4;
          const lookZ = eyeZ + primarySample.tangent[2] * 2.4;
          controls.target.lerp(new THREE.Vector3(lookX, lookY, lookZ), 0.28);
          controls.update();
        }
      } else if (!st.showWorkers && navModeRef.current === 'walk') {
        // First-Person Walk Mode: Disable OrbitControls to guarantee zero phasing through walls
        if (controls.enabled) controls.enabled = false;

        if (cameraFlyRef.current.active) {
          const k = 1 - Math.exp(-5.8 * dt);
          camera.position.lerp(cameraFlyRef.current.pos, k);
          controls.target.lerp(cameraFlyRef.current.target, k);
          camera.lookAt(controls.target);
          if (
            camera.position.distanceTo(cameraFlyRef.current.pos) < 0.015 &&
            controls.target.distanceTo(cameraFlyRef.current.target) < 0.015
          ) {
            cameraFlyRef.current.active = false;
            firstPersonPosRef.current.x = camera.position.x;
            firstPersonPosRef.current.y = -0.12;
            firstPersonPosRef.current.z = camera.position.z;
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            firstPersonYawRef.current = Math.atan2(dir.x, dir.z);
            firstPersonPitchRef.current = Math.asin(Math.max(-0.99, Math.min(0.99, dir.y)));
          }
        } else {
          // Walk movement along yaw
          if (anyWasdDown) {
            const yaw = firstPersonYawRef.current;
            const fwdX = Math.sin(yaw);
            const fwdZ = Math.cos(yaw);
            const rightX = Math.cos(yaw);
            const rightZ = -Math.sin(yaw);

            const walkSpeed = (keys.shift ? 2.8 : 1.75) * dt;
            let moveX = 0;
            let moveZ = 0;

            if (keys.w || keys.arrowup || keys.KeyW) {
              moveX += fwdX * walkSpeed;
              moveZ += fwdZ * walkSpeed;
            }
            if (keys.s || keys.arrowdown || keys.KeyS) {
              moveX -= fwdX * walkSpeed;
              moveZ -= fwdZ * walkSpeed;
            }
            if (keys.a || keys.arrowleft || keys.q || keys.KeyA || keys.KeyQ) {
              moveX -= rightX * walkSpeed;
              moveZ -= rightZ * walkSpeed;
            }
            if (keys.d || keys.arrowright || keys.e || keys.KeyD || keys.KeyE) {
              moveX += rightX * walkSpeed;
              moveZ += rightZ * walkSpeed;
            }

            const curX = firstPersonPosRef.current.x;
            const curZ = firstPersonPosRef.current.z;
            const [resX, resZ] = resolveObstacleCollisions(
              curX + moveX,
              curZ + moveZ,
              0.28,
              obstacles,
              curX,
              curZ
            );

            firstPersonPosRef.current.x = resX;
            firstPersonPosRef.current.y = -0.12;
            firstPersonPosRef.current.z = resZ;
          }

          // Pin camera to the safe, collision-checked human position
          camera.position.set(
            firstPersonPosRef.current.x,
            -0.12,
            firstPersonPosRef.current.z
          );

          // Rotate head in-place (yaw & pitch) — camera never swings through obstacles!
          const cosP = Math.cos(firstPersonPitchRef.current);
          const lX = Math.sin(firstPersonYawRef.current) * cosP;
          const lY = Math.sin(firstPersonPitchRef.current);
          const lZ = Math.cos(firstPersonYawRef.current) * cosP;

          camera.lookAt(
            camera.position.x + lX,
            camera.position.y + lY,
            camera.position.z + lZ
          );

          controls.target.set(
            camera.position.x + lX * 2.0,
            camera.position.y + lY * 2.0,
            camera.position.z + lZ * 2.0
          );

          primarySample = {
            position: [firstPersonPosRef.current.x, -1.02, firstPersonPosRef.current.z],
            tangent: [Math.sin(firstPersonYawRef.current), 0, Math.cos(firstPersonYawRef.current)]
          };
        }
      } else {
        // Orbit Mode (or Technical Mode): Enable OrbitControls for 3rd person mouse dragging
        if (!controls.enabled) controls.enabled = true;

        if (cameraFlyRef.current.active) {
          const k = 1 - Math.exp(-5.8 * dt);
          camera.position.lerp(cameraFlyRef.current.pos, k);
          controls.target.lerp(cameraFlyRef.current.target, k);
          controls.update();
          if (
            camera.position.distanceTo(cameraFlyRef.current.pos) < 0.015 &&
            controls.target.distanceTo(cameraFlyRef.current.target) < 0.015
          ) {
            cameraFlyRef.current.active = false;
          }
        } else {
          controls.update();
        }
      }

      // Proximity, Hover & Selection OBB Animation (Overlays.jsx from ahmad_branch)
      const nearby = [];
      const isPureSplat = st.viewMode === 'splat';
      const hoveredId = hoveredAssetIdRef.current;
      const anyFocused = Boolean(st.selectedAsset?.asset_id || st.clickedPopoverAssetId);
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
      const activeTargetAssetIds = new Set(
        (st.exerciseWorkers || [])
          .filter((w) => w.state !== 'STANDBY' && w.targetAssetId)
          .map((w) => w.targetAssetId)
      );

      st.assets.forEach((asset) => {
        const dx = asset.position[0] - primarySample.position[0];
        const dy = asset.position[1] - primarySample.position[1];
        const dz = asset.position[2] - primarySample.position[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const isWithinRadius = dist <= Math.max(1.6, st.proximityRadius);
        const isClickedOpen = st.clickedPopoverAssetId === asset.asset_id;

        const revealedByLaser =
          !laserSweepStateRef.current.active ||
          asset.position[2] <= laserSweepStateRef.current.zPos + 0.35;

        if (isWithinRadius) {
          nearby.push({ ...asset, distanceToAvatar: Number(dist.toFixed(2)) });
        }

        const meshBundle = assetMeshMapRef.current.get(asset.asset_id);
        if (meshBundle) {
          const isSelected = st.selectedAsset?.asset_id === asset.asset_id;
          const isHovered = hoveredId === asset.asset_id;
          const isWorkerTarget = activeTargetAssetIds.has(asset.asset_id);
          const isAbnormal = asset.health_status !== 'healthy';
          const semanticAlpha = revealedByLaser ? st.semanticBlend / 100 : 0.04;

          // Overlays.jsx color & opacity modulation from ahmad_branch
          const baseColorHex = HEALTH_COLORS[asset.health_status] || 0x38bdf8;
          const colorObj = new THREE.Color(baseColorHex);
          if (isSelected || isClickedOpen) {
            colorObj.lerp(new THREE.Color(0x38bdf8), 0.55);
          }
          if (isHovered) {
            colorObj.lerp(new THREE.Color(0xffffff), 0.45);
          }
          meshBundle.fillMat.color.copy(colorObj);
          meshBundle.edgeMat.color.copy(colorObj);

          const baseFill =
            isSelected || isClickedOpen || isWorkerTarget
              ? 0.20 + pulse * 0.14
              : isHovered
              ? 0.18
              : isWithinRadius
              ? 0.13
              : isAbnormal
              ? 0.09
              : 0.04;
          const baseEdge =
            isSelected || isClickedOpen || isWorkerTarget
              ? 1.0
              : isHovered
              ? 0.96
              : isWithinRadius
              ? 0.85
              : isAbnormal
              ? 0.88
              : 0.48;
          const ghostFactor =
            anyFocused && !isSelected && !isClickedOpen && !isHovered && !isWithinRadius && !isWorkerTarget
              ? 0.38
              : 1.0;

          meshBundle.fillMat.opacity = baseFill * ghostFactor * Math.max(0.4, semanticAlpha);
          meshBundle.edgeMat.opacity = Math.min(1, baseEdge * ghostFactor * Math.max(0.4, semanticAlpha));

          if (meshBundle.equipMats) {
            // In pure Photoreal 3DGS mode, hide solid procedural CAD meshes so the real Gaussian Splatting pump/valve/motor hardware is 100% visible inside its CV OBB!
            const showEquipMesh = !isPureSplat && semanticAlpha > 0.08;
            meshBundle.equipGroup.visible = showEquipMesh;
            if (showEquipMesh) {
              meshBundle.equipMats.solidMat.opacity = Math.max(0.25, semanticAlpha * 0.92);
              meshBundle.equipMats.accentMat.opacity = Math.max(0.25, semanticAlpha * 0.92);
            }
          }

          if (meshBundle.equipGroup && (asset.telemetry?.vibration_mms || 0) > 4.5) {
            meshBundle.equipGroup.position.x = Math.sin(now * 0.055) * 0.014;
            meshBundle.equipGroup.position.y = Math.cos(now * 0.065) * 0.010;
          } else if (meshBundle.equipGroup) {
            meshBundle.equipGroup.position.set(0, 0, 0);
          }

          if (meshBundle.backPlaneMat) {
            meshBundle.backPlaneMat.opacity =
              st.showContourModels && isClickedOpen ? 0.65 : 0;
          }
          if (meshBundle.contourGroup) {
            meshBundle.contourGroup.visible = Boolean(
              st.showContourModels && (isClickedOpen || isWithinRadius || isHovered)
            );
          }

          if (isClickedOpen || isSelected || isWorkerTarget) {
            const s = 1.03 + pulse * 0.035;
            meshBundle.group.scale.set(s, s, s);
          } else if (isHovered) {
            meshBundle.group.scale.set(1.025, 1.025, 1.025);
          } else {
            meshBundle.group.scale.set(1, 1, 1);
          }
        }
      });

      labelTick++;
      if (labelTick % 3 === 0 && container) {
        nearby.sort((a, b) => a.distanceToAvatar - b.distanceToAvatar);
        onNearbyAssetsChange(nearby);
        setLiveArSignal(activeSignal);
        if (onArTrafficSignalChange) onArTrafficSignalChange(activeSignal);

        const width = container.clientWidth;
        const height = container.clientHeight;

        if (st.showWorkers && st.exerciseMode && st.exerciseWorkers?.length) {
          const overlays = [];
          st.exerciseWorkers.forEach((w) => {
            const wpos = w.position || w.pos || [0, -1.02, -0.32];
            const isSelected = st.selectedWorkerId === w.id;
            const headPos = new THREE.Vector3(wpos[0], -1.02 + 1.55, wpos[2]);
            headPos.project(camera);
            if (headPos.z > -1 && headPos.z < 1) {
              const sx = (headPos.x * 0.5 + 0.5) * width;
              const sy = (-(headPos.y * 0.5) + 0.5) * height;
              if (sx >= 10 && sx <= width - 10 && sy >= 10 && sy <= height - 10) {
                overlays.push({
                  id: w.id,
                  label: w.label,
                  color: w.color,
                  state: w.state,
                  targetTag: w.targetTag,
                  repairProgress: w.repairProgress,
                  trafficStatus: w.trafficStatus,
                  blockingUnitId: w.blockingUnitId,
                  isSelected,
                  x: sx,
                  y: sy
                });
              }
            }
          });
          setWorkerOverlays(overlays);
        } else {
          setWorkerOverlays([]);
        }

        // Interactive Floating 3D Asset Tag Badges (Overlays.jsx from ahmad_branch)
        const tagPills = [];
        st.assets.forEach((asset) => {
          const isSelected = st.selectedAsset?.asset_id === asset.asset_id;
          const isClicked = st.clickedPopoverAssetId === asset.asset_id;
          const isHovered = hoveredId === asset.asset_id;
          const isTarget = activeTargetAssetIds.has(asset.asset_id);
          const isAbnormal = asset.health_status !== 'healthy';
          const camDist = Math.hypot(
            asset.position[0] - camera.position.x,
            asset.position[1] - camera.position.y,
            asset.position[2] - camera.position.z
          );
          if (!isAbnormal && !isSelected && !isClicked && !isHovered && !isTarget && camDist > 2.85) {
            return;
          }
          const anchor = new THREE.Vector3(
            asset.position[0],
            asset.position[1] + (asset.bbox_size?.[1] || 0.45) * 0.56 + 0.08,
            asset.position[2]
          );
          anchor.project(camera);
          if (anchor.z > -1 && anchor.z < 1) {
            const sx = (anchor.x * 0.5 + 0.5) * width;
            const sy = (-(anchor.y * 0.5) + 0.5) * height;
            if (sx >= 24 && sx <= width - 24 && sy >= 36 && sy <= height - 36) {
              tagPills.push({
                asset_id: asset.asset_id,
                tag: asset.tag,
                health_status: asset.health_status,
                health_score: asset.health_score,
                isSelected: isSelected || isClicked,
                isHovered,
                isTarget,
                x: sx,
                y: sy
              });
            }
          }
        });
        setAssetTagOverlays(tagPills);

      }

      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(animate);

    if (onSceneReady) {
      onSceneReady({
        scene,
        camera,
        renderer,
        controls,
        displayGroup: splatDisplayGroup,
        getSplatMesh: () => splatMeshRef.current
      });
    }

    return () => {
      if (onSceneReady) onSceneReady(null);
      cancelAnimationFrame(animId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerdown', onMoveDown, true);
      renderer.domElement.removeEventListener('pointermove', onMoveMove, true);
      renderer.domElement.removeEventListener('pointerup', onMoveUp, true);
      renderer.domElement.removeEventListener('pointercancel', onMoveUp, true);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.dispose();
    };
  }, []);

  // Load Photorealistic 3D Gaussian Splats via @sparkjsdev/spark SplatMesh (.spz) with binary fallback
  useEffect(() => {
    const displayGroup = splatDisplayGroupRef.current;
    const pcObj = pointCloudObjRef.current;
    if (!displayGroup || customPlyBuffer) return;

    const isEquip = activeRoomScene === 'equipment_room';
    const spzUrl = isEquip ? '/assets/equipment_room.spz' : '/assets/boiler_room.spz';
    const binUrl = isEquip ? '/assets/equipment_room_splats.bin' : '/assets/boiler_room_splats.bin';
    const label = isEquip ? 'Equipment Room.ply (.spz)' : 'Boiler Room.ply (.spz)';
    const rawTotal = isEquip ? 1676481 : 1506136;

    let cancelled = false;
    setLoadingState(`Loading ${label} 3D Gaussian Splats...`);

    if (splatMeshRef.current) {
      displayGroup.remove(splatMeshRef.current);
      splatMeshRef.current = null;
    }
    if (pcObj) {
      pcObj.visible = false;
    }

    const loadFallbackBin = () => {
      if (!pcObj || cancelled) return;
      fetch(binUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buffer) => {
          if (cancelled) return;
          const { geometry, count } = parsePrecomputedSplatBin(buffer);
          pcObj.geometry.dispose();
          pcObj.geometry = geometry;
          pcObj.visible = viewMode !== 'cad';
          setSplatReady(true);
          setLoadingState(null);
          if (onLoadStats) {
            onLoadStats({
              sourceFile: label,
              rawVertices: rawTotal,
              activeSplats: count,
              anchoredAssets: assets.length,
              structuralFrames: cvSceneObjects?.objects?.length || 441
            });
          }
        })
        .catch((err) => {
          console.warn('Fallback splat bin error:', err);
          if (!cancelled) setLoadingState(null);
        });
    };

    try {
      const mesh = new SplatMesh({
        url: spzUrl,
        fileType: 'spz',
        lod: false,
        onProgress: (ev) => {
          if (cancelled) return;
          if (ev.total > 0) {
            const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
            setLoadingState(`Streaming ${label}... ${pct}%`);
          }
        }
      });

      mesh.initialized
        .then(() => {
          if (cancelled) return;
          displayGroup.add(mesh);
          splatMeshRef.current = mesh;
          mesh.visible = viewMode !== 'cad';
          applySplatMovesRef.current?.(objectMovesRef.current);
          if (pcObj) pcObj.visible = false;
          setSplatReady(true);
          setLoadingState(null);
          const numSplats = mesh.packedSplats?.numSplats || (isEquip ? 466000 : 450000);
          if (onLoadStats) {
            onLoadStats({
              sourceFile: label,
              rawVertices: rawTotal,
              activeSplats: numSplats,
              anchoredAssets: assets.length,
              structuralFrames: cvSceneObjects?.objects?.length || 441
            });
          }
        })
        .catch((err) => {
          console.warn('Spark .spz load failed, using binary splat fallback:', err);
          loadFallbackBin();
        });
    } catch (err) {
      console.warn('SplatMesh init failed, using binary splat fallback:', err);
      loadFallbackBin();
    }

    return () => {
      cancelled = true;
    };
  }, [activeRoomScene]);

  // Custom PLY Upload
  useEffect(() => {
    if (!customPlyBuffer || !sceneRef.current || !pointCloudObjRef.current) return;
    try {
      setLoadingState('Parsing uploaded PLY file...');
      const { geometry, count } = parseCustomPlyArrayBuffer(customPlyBuffer);
      pointCloudObjRef.current.geometry.dispose();
      pointCloudObjRef.current.geometry = geometry;
      pointCloudObjRef.current.visible = viewMode !== 'cad';
      if (splatMeshRef.current) splatMeshRef.current.visible = false;
      if (pointCloudMatRef.current?.uniforms?.uOpacity) {
        pointCloudMatRef.current.uniforms.uOpacity.value = 1.0;
      }
      setLoadingState(null);
      if (onLoadStats) {
        onLoadStats({
          sourceFile: 'Custom Uploaded PLY Scan',
          rawVertices: count,
          activeSplats: count,
          anchoredAssets: assets.length,
          structuralFrames: STRUCTURAL_BOILER_OBJECTS.length
        });
      }
    } catch (err) {
      console.error('Failed to parse custom PLY:', err);
      setLoadingState(null);
    }
  }, [customPlyBuffer]);

  // Update 3D View Mode ('splat' | 'hybrid' | 'cad')
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const isCadOnly = viewMode === 'cad';
    scene.background = new THREE.Color(isCadOnly ? 0xd7dbe0 : 0x0b1220);
    scene.fog = isCadOnly ? new THREE.FogExp2(0xd7dbe0, 0.022) : null;

    if (splatMeshRef.current) {
      splatMeshRef.current.visible = !isCadOnly;
      if (pointCloudObjRef.current) pointCloudObjRef.current.visible = false;
    } else if (pointCloudObjRef.current) {
      pointCloudObjRef.current.visible = !isCadOnly;
    }
    if (cadRoomGroupRef.current) {
      cadRoomGroupRef.current.visible = viewMode !== 'splat';
    }
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = isCadOnly;
    }
  }, [viewMode, splatReady]);

  // Render Unbound CV OBBs when "Show All 441 CV Detections" is enabled (or when an unbound CV object is selected in Review Mode)
  useEffect(() => {
    const cvGroup = cvUnboundObbGroupRef.current;
    if (!cvGroup) return;

    while (cvGroup.children.length > 0) {
      cvGroup.remove(cvGroup.children[0]);
    }

    const allObjects = cvSceneObjects?.objects || [];
    if (!allObjects.length) return;

    const MOVABLE_EXCLUDED = ['pipe', 'door', 'sign'];
    const objectsToRender = allObjects.filter((o) => {
      if (o.source === 'structure_plane') return false;
      if (moveMode) {
        // In Move mode every movable detected object (bound or unbound) is shown & pickable
        return !MOVABLE_EXCLUDED.includes(o.class);
      }
      if (o.asset_id) return false;
      if (showAllCvDetections) return true;
      return o.object_id === selectedCvObjectId;
    });

    if (objectsToRender.length === 0) return;

    const unitEdgesGeo = new THREE.EdgesGeometry(GEO_CACHE.unitBox);

    objectsToRender.forEach((obj) => {
      const isSelectedCv = moveMode ? obj.object_id === moveSelectedId : obj.object_id === selectedCvObjectId;
      const isPipe = obj.class === 'pipe';
      const isMovedObj = Boolean(obj._moved);
      const colorHex = isSelectedCv
        ? 0x38bdf8
        : moveMode
        ? isMovedObj
          ? 0xf59e0b
          : 0x22c55e
        : isPipe
        ? 0x64748b
        : 0xa855f7;

      const mat = obbMatrix(obj);
      const wireMat = new THREE.LineDashedMaterial({
        color: colorHex,
        transparent: true,
        opacity: isSelectedCv ? 0.98 : moveMode ? 0.7 : isPipe ? 0.32 : 0.62,
        dashSize: 0.04,
        gapSize: 0.025,
        depthWrite: false
      });

      const lineSegs = new THREE.LineSegments(unitEdgesGeo, wireMat);
      lineSegs.computeLineDistances();
      lineSegs.applyMatrix4(mat);
      lineSegs.raycast = () => {};
      lineSegs.userData = { cvObject: obj };
      cvGroup.add(lineSegs);

      // Invisible pick box for raycasting unbound CV OBBs
      const pickMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: isSelectedCv ? 0.16 : moveMode ? 0.05 : 0.01,
        depthWrite: false
      });
      const pickMesh = new THREE.Mesh(GEO_CACHE.unitBox, pickMat);
      pickMesh.applyMatrix4(mat);
      pickMesh.userData = { cvObject: obj };
      cvGroup.add(pickMesh);
    });
  }, [cvSceneObjects, showAllCvDetections, selectedCvObjectId, moveMode, moveSelectedId]);

  // Keep splat cut-outs / ghost copies in sync with committed moves, view mode and scene reloads
  useEffect(() => {
    applySplatMovesRef.current?.(objectMoves);
  }, [objectMoves, cvSceneObjects, splatReady, viewMode, activeRoomScene]);

  // Build 30 Bound Contoured & CV OBB Asset Models
  useEffect(() => {
    const assetGroup = assetGroupRef.current;
    const structuralGroup = structuralGroupRef.current;
    if (!assetGroup || !structuralGroup) return;

    while (assetGroup.children.length > 0) {
      assetGroup.remove(assetGroup.children[0]);
    }
    assetMeshMapRef.current.clear();
    const nextHitboxes = [];

    assets.forEach((asset) => {
      const colorHex = HEALTH_COLORS[asset.health_status] || 0x38bdf8;
      const [sx, sy, sz] = asset.bbox_size;

      const group = new THREE.Group();
      group.position.set(asset.position[0], asset.position[1], asset.position[2]);
      const r = asset.cvObject?.obb?.rotation;
      if (Array.isArray(r) && r.length === 3) {
        // Exact display-frame rotation D * R * D where D = diag(1, -1, -1) matches splatDisplayGroup
        const rotMat = new THREE.Matrix4().set(
          r[0][0], -r[0][1], -r[0][2], 0,
          -r[1][0], r[1][1], r[1][2], 0,
          -r[2][0], r[2][1], r[2][2], 0,
          0, 0, 0, 1
        );
        group.quaternion.setFromRotationMatrix(rotMat);
      } else if (asset.cvObject?.yaw_deg) {
        group.rotation.y = THREE.MathUtils.degToRad(-asset.cvObject.yaw_deg);
      }
      group.userData = { asset };

      const { group: equipGroup, solidMat, accentMat } = createProceduralEquipmentMesh(asset, colorHex);
      equipGroup.userData = { asset };
      equipGroup.traverse((c) => {
        c.raycast = () => {};
      });
      group.add(equipGroup);

      const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
      const fillMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      });
      const boxMesh = new THREE.Mesh(boxGeo, fillMat);
      boxMesh.userData = { asset };
      group.add(boxMesh);
      nextHitboxes.push(boxMesh);

      const edgesGeo = new THREE.EdgesGeometry(boxGeo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.9,
        toneMapped: false
      });
      const wireMesh = new THREE.LineSegments(edgesGeo, edgeMat);
      // Disable LineSegments raycast so Three.js default 1m line threshold never hijacks clicks!
      wireMesh.raycast = () => {};
      group.add(wireMesh);

      const backPlaneGeo = new THREE.PlaneGeometry(sx * 0.98, sy * 0.98);
      const backPlaneMat = new THREE.MeshBasicMaterial({
        color: 0x0f172a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0
      });
      const backPlaneMesh = new THREE.Mesh(backPlaneGeo, backPlaneMat);
      backPlaneMesh.position.set(0, 0, sz * 0.5);
      backPlaneMesh.raycast = () => {};
      backPlaneMesh.userData = { asset };
      group.add(backPlaneMesh);

      const contourGroup = new THREE.Group();
      if (asset.contourModel?.contourPoints?.length) {
        const localContourVecs = asset.contourModel.contourPoints.map(
          (pt) =>
            new THREE.Vector3(
              pt[0] - asset.position[0],
              pt[1] - asset.position[1],
              pt[2] - asset.position[2]
            )
        );
        localContourVecs.push(localContourVecs[0].clone());

        const contourLineGeo = new THREE.BufferGeometry().setFromPoints(localContourVecs);
        const contourLineMat = new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.95
        });
        const cLine = new THREE.Line(contourLineGeo, contourLineMat);
        cLine.raycast = () => {};
        contourGroup.add(cLine);

        const dotMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        localContourVecs.slice(0, -1).forEach((v) => {
          const dot = new THREE.Mesh(GEO_CACHE.contourDot, dotMat);
          dot.position.copy(v);
          dot.raycast = () => {};
          contourGroup.add(dot);
        });
      }
      contourGroup.visible = false;
      group.add(contourGroup);

      assetGroup.add(group);
      assetMeshMapRef.current.set(asset.asset_id, {
        group,
        fillMat,
        edgeMat,
        backPlaneMat,
        contourGroup,
        equipGroup,
        equipMats: { solidMat, accentMat }
      });
    });
    assetHitboxesRef.current = nextHitboxes;

    while (structuralGroup.children.length > 0) {
      structuralGroup.remove(structuralGroup.children[0]);
    }
    if (showStructuralBoxes && semanticBlend > 10) {
      STRUCTURAL_BOILER_OBJECTS.forEach((stObj) => {
        const [sx, sy, sz] = stObj.size;
        const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
        const edgesGeo = new THREE.EdgesGeometry(boxGeo);
        const lineMat = new THREE.LineBasicMaterial({
          color: new THREE.Color(stObj.color),
          transparent: true,
          opacity: 0.25 * (semanticBlend / 100)
        });
        const wire = new THREE.LineSegments(edgesGeo, lineMat);
        wire.raycast = () => {};
        wire.position.set(stObj.position[0], stObj.position[1], stObj.position[2]);
        structuralGroup.add(wire);
      });
    }
  }, [assets, showStructuralBoxes, showContourModels, semanticBlend]);

  // Render Centerline Waypoint 'Rails' (clean path tube only — no green/red floor node dots)
  useEffect(() => {
    const pathGroup = pathGroupRef.current;
    const navGraphGroup = navGraphGroupRef.current;
    if (!pathGroup || !navGraphGroup) return;

    while (pathGroup.children.length > 0) {
      pathGroup.remove(pathGroup.children[0]);
    }
    while (navGraphGroup.children.length > 0) {
      navGraphGroup.remove(navGraphGroup.children[0]);
    }

    const buildTube = (points, colorHex, radius = 0.042, yOffset = 0.04, opacity = 0.92, isZigZag = false) => {
      if (!points || points.length < 2) return;
      const vecs = points.map((p) => new THREE.Vector3(p[0], p[1] + yOffset, p[2]));
      const curve = new THREE.CatmullRomCurve3(
        vecs,
        false,
        isZigZag ? 'centripetal' : 'catmullrom',
        isZigZag ? 0.01 : 0.35
      );
      const tubeGeo = new THREE.TubeGeometry(curve, Math.max(24, points.length * 6), radius, 10, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 0.55,
        roughness: 0.2,
        transparent: true,
        opacity
      });
      const mesh = new THREE.Mesh(tubeGeo, tubeMat);
      mesh.raycast = () => {};
      pathGroup.add(mesh);
    };

    const isZig = railMode === 'zigzag_grid';

    // When not in exerciseMode, show the single/dual/fleet preview path tube
    if (!exerciseMode) {
      if (multiAgentEnabled && fleetAssignments?.length) {
        fleetAssignments.forEach((assign, idx) => {
          const col = assign.agent_id === 'R1' ? 0xd96b27 : assign.agent_id === 'R2' ? 0x49a942 : 0x1f6fb2;
          buildTube(assign.path?.points, col, 0.036, 0.03 + idx * 0.015, 0.88, isZig);
        });
      } else if (showDualComparison) {
        buildTube(humanPath?.points, 0x1f6fb2, 0.034, 0.06, activeProfile === 'human' ? 0.92 : 0.45, isZig);
        buildTube(robotPath?.points, 0xd96b27, 0.040, 0.03, activeProfile === 'robot' ? 0.92 : 0.45, isZig);
      } else if (activeProfile === 'human') {
        buildTube(humanPath?.points, 0x1f6fb2, 0.040, 0.04, 0.92, isZig);
      } else {
        buildTube(robotPath?.points, 0xd96b27, 0.040, 0.04, 0.92, isZig);
      }
    }

    // Only render explicit red hazard cylinders if the user placed a hazard blockade
    if (hazardNodes?.length > 0) {
      NAV_NODES.forEach((node) => {
        if (!hazardNodes.includes(node.id)) return;
        const hazGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.9, 18);
        const hazMat = new THREE.MeshBasicMaterial({
          color: 0xef4444,
          transparent: true,
          opacity: 0.28,
          depthWrite: false
        });
        const hazMesh = new THREE.Mesh(hazGeo, hazMat);
        hazMesh.position.set(node.pos[0], node.pos[1] + 0.45, node.pos[2]);
        hazMesh.userData = { nodeId: node.id };
        navGraphGroup.add(hazMesh);
      });
    }
  }, [humanPath, robotPath, activeProfile, railMode, multiAgentEnabled, fleetAssignments, showDualComparison, hazardNodes, selectedAsset, exerciseMode]);

  // Sync Dynamic Exercise Workers & Active Repair Route Tubes in 3D Scene
  useEffect(() => {
    const exerciseGroup = exerciseGroupRef.current;
    const exercisePathGroup = exercisePathGroupRef.current;
    if (!exerciseGroup || !exercisePathGroup) return;

    const rigMap = exerciseWorkerRigsRef.current;
    const activeIds = new Set(exerciseWorkers.map((w) => w.id));

    for (const [id, rig] of rigMap.entries()) {
      if (!activeIds.has(id)) {
        exerciseGroup.remove(rig);
        rigMap.delete(id);
      }
    }

    exerciseWorkers.forEach((w) => {
      const wpos = w.position || w.pos || [0, -1.02, -0.32];
      let rig = rigMap.get(w.id);
      if (!rig) {
        const isHuman = w.type === 'human';
        const hex =
          typeof w.colorHex === 'number'
            ? w.colorHex
            : parseInt(String(w.color || '#1f6fb2').replace('#', ''), 16);
        rig = createHumanoidRig(
          hex,
          isHuman,
          isHuman ? [0.52, 1.68, 0.48] : [0.58, 1.38, 0.58]
        );
        rig.position.set(wpos[0], -1.02, wpos[2]);
        rig.rotation.y = w.angle || 0;
        rig.userData.workerId = w.id;
        rig.traverse((child) => {
          child.userData.workerId = w.id;
        });
        exerciseGroup.add(rig);
        rigMap.set(w.id, rig);
      } else if (rig.parent !== exerciseGroup) {
        exerciseGroup.add(rig);
      }
    });

    while (exercisePathGroup.children.length > 0) {
      exercisePathGroup.remove(exercisePathGroup.children[0]);
    }

    if (exerciseMode) {
      const isZig = railMode === 'zigzag_grid';
      exerciseWorkers.forEach((w, idx) => {
        if (w.state === 'STANDBY' || !w.pathPoints || w.pathPoints.length < 2) return;
        const hex =
          typeof w.colorHex === 'number'
            ? w.colorHex
            : parseInt(String(w.color || '#1f6fb2').replace('#', ''), 16);
        const vecs = w.pathPoints.map(
          (p) => new THREE.Vector3(p[0], p[1] + 0.03 + (idx % 4) * 0.012, p[2])
        );
        const curve = new THREE.CatmullRomCurve3(
          vecs,
          false,
          isZig ? 'centripetal' : 'catmullrom',
          isZig ? 0.01 : 0.35
        );
        const tubeGeo = new THREE.TubeGeometry(
          curve,
          Math.max(20, w.pathPoints.length * 5),
          0.032,
          8,
          false
        );
        const tubeMat = new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.45,
          roughness: 0.25,
          transparent: true,
          opacity: w.state === 'RETURNING' ? 0.45 : 0.88
        });
        const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
        tubeMesh.raycast = () => {};
        exercisePathGroup.add(tubeMesh);

        // If target asset is elevated/on the roof (e.g. CV-001 at y = +0.71m), draw a vertical 3D riser tube
        // from the floor destination straight up to the overhead 3D OBB so the path visually connects to the roof asset
        if (w.state !== 'RETURNING' && w.targetAssetId) {
          const targetAsset = (assets || []).find((a) => a.asset_id === w.targetAssetId);
          if (targetAsset?.position && targetAsset.position[1] > -0.55) {
            const endFloor = w.pathPoints[w.pathPoints.length - 1];
            const riserCurve = new THREE.LineCurve3(
              new THREE.Vector3(endFloor[0], -0.98, endFloor[2]),
              new THREE.Vector3(targetAsset.position[0], targetAsset.position[1], targetAsset.position[2])
            );
            const riserGeo = new THREE.TubeGeometry(riserCurve, 12, 0.024, 8, false);
            const riserMat = new THREE.MeshStandardMaterial({
              color: hex,
              emissive: hex,
              emissiveIntensity: 0.75,
              roughness: 0.2,
              transparent: true,
              opacity: w.state === 'REPAIRING' ? 0.92 : 0.68
            });
            const riserMesh = new THREE.Mesh(riserGeo, riserMat);
            riserMesh.raycast = () => {};
            exercisePathGroup.add(riserMesh);
          }
        }
      });
    }
  }, [exerciseWorkers, exerciseMode, railMode, assets]);

  // Smoothly fly camera toward newly selected asset (CameraRig.jsx behavior from ahmad_branch)
  const prevSelectedAssetIdRef = useRef(selectedAsset?.asset_id);
  useEffect(() => {
    const curId = selectedAsset?.asset_id;
    if (curId && curId !== prevSelectedAssetIdRef.current && !arFirstPersonMode) {
      triggerCameraFlyTo(
        selectedAsset.position,
        selectedAsset.approach_point,
        selectedAsset.bbox_size
      );
    }
    prevSelectedAssetIdRef.current = curId;
  }, [selectedAsset?.asset_id, arFirstPersonMode]);

  const handleFacilityOverview = () => {
    if (arFirstPersonMode) onToggleArFirstPerson(false);
    manualPosRef.current = null;
    setIsWasdWalking(false);
    setClickedPopoverAssetId(null);
    setClickedUnboundCvObj(null);
    setClickedScreenAnchor(null);
    if (navMode === 'walk') {
      handleSetNavMode('orbit');
    }
    cameraFlyRef.current.pos.set(2.85, 2.45, -2.85);
    cameraFlyRef.current.target.set(0, -0.85, 0.2);
    cameraFlyRef.current.active = true;
  };

  const handleResetCameraForMode = () => {
    if (arFirstPersonMode) onToggleArFirstPerson(false);
    manualPosRef.current = null;
    setIsWasdWalking(false);
    setClickedPopoverAssetId(null);
    setClickedUnboundCvObj(null);
    setClickedScreenAnchor(null);

    if (navModeRef.current === 'walk') {
      firstPersonPosRef.current = { x: 1.42, y: -0.12, z: -1.28 };
      firstPersonYawRef.current = -0.46;
      firstPersonPitchRef.current = 0;
      cameraFlyRef.current.pos.set(1.42, -0.12, -1.28);
      cameraFlyRef.current.target.set(
        1.42 + Math.sin(-0.46) * 2.5,
        -0.12,
        -1.28 + Math.cos(-0.46) * 2.5
      );
      cameraFlyRef.current.active = true;
    } else {
      cameraFlyRef.current.pos.set(2.85, 2.45, -2.85);
      cameraFlyRef.current.target.set(0, -0.85, 0.2);
      cameraFlyRef.current.active = true;
    }
  };

  const handleResetCamera = handleResetCameraForMode;
  const handleInteriorCamera = handleResetCameraForMode;

  const handleFocusSelected = () => {
    if (arFirstPersonMode) onToggleArFirstPerson(false);
    if (!selectedAsset) return;
    triggerCameraFlyTo(
      selectedAsset.position,
      selectedAsset.approach_point,
      selectedAsset.bbox_size
    );
  };

  const clickedPopoverAsset = clickedPopoverAssetId
    ? assets.find((a) => a.asset_id === clickedPopoverAssetId)
    : null;
  const clickedSt = clickedPopoverAsset ? statusOf(clickedPopoverAsset) : null;
  const clickedPhoto = clickedPopoverAsset?.cvObject?.object_id
    ? EVIDENCE_PHOTO_MAP[clickedPopoverAsset.cvObject.object_id]
    : null;

  return (
    <main className="viewport">
      <div ref={mountRef} className="viewport-canvas" />

      {/* Simulation Exercise Mode Instruction Banner */}
      {showWorkers && exerciseMode && !arFirstPersonMode && (
        <div className={`exercise-banner ${exercisePaused ? 'paused' : ''}`}>
          <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
            <span className={`status ${exercisePaused ? 'medium' : 'info'}`}>
              {exercisePaused ? 'TIME PAUSED — BATCH FAULT SETUP' : 'SIMULATION EXERCISE · 3DGS + CV'}
            </span>
            <span className="mono muted" style={{ marginLeft: 'auto' }}>
              {exerciseWorkers.filter((w) => w.state === 'STANDBY').length}/{exerciseWorkers.length} at line
            </span>
          </div>
          <div className="exercise-banner-sub">
            {exercisePaused
              ? 'Time is frozen. Click multiple equipment OBBs and inject faults (or assign workers in Alerts), then click Resume Time to dispatch all units together.'
              : 'Photoreal 3DGS (.spz) with CV-detected 3D OBBs. Inject faults on components; standby technicians walk out using right-hand traffic rules, repair, and return.'}
          </div>
          <div className="row" style={{ gap: '5px', marginTop: '5px', flexWrap: 'wrap' }}>
            {onToggleExercisePaused && (
              <button
                className={`btn btn-sm ${exercisePaused ? 'btn-primary' : ''}`}
                onClick={() => onToggleExercisePaused(!exercisePaused)}
                title="Freeze simulation time to inject multiple faults at once"
              >
                {exercisePaused ? <Play size={12} /> : <Pause size={12} />}
                <span>{exercisePaused ? 'Resume Time' : 'Pause Time'}</span>
              </button>
            )}
            {onInjectRandomFault && (
              <button className="btn btn-sm btn-danger" onClick={onInjectRandomFault}>
                <Zap size={12} />
                <span>Inject Random Fault</span>
              </button>
            )}
            {onAddWorker && (
              <>
                <button className="btn btn-sm" onClick={() => onAddWorker('human')}>
                  <Plus size={12} />
                  <span>+ Technician</span>
                </button>
                <button className="btn btn-sm" onClick={() => onAddWorker('robot')}>
                  <Plus size={12} />
                  <span>+ AMR</span>
                </button>
              </>
            )}
            {selectedWorkerId && onDeleteWorker && (
              <button
                className="btn btn-sm btn-danger"
                onClick={() => onDeleteWorker(selectedWorkerId)}
                title="Remove selected worker (Delete key)"
              >
                <Trash2 size={12} />
                <span>Remove {selectedWorkerId} [Del]</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2D Floating Repair Progress & Worker Traffic / Selection Badges */}
      {showWorkers &&
        exerciseMode &&
        workerOverlays.map((ov) => (
          <React.Fragment key={ov.id}>
            {ov.state === 'REPAIRING' ? (
              <div className="repair-badge" style={{ left: ov.x, top: ov.y }}>
                <div className="repair-badge-head">
                  <Wrench size={13} className="tool-spin" />
                  <span>
                    {ov.id} fixing {ov.targetTag}
                  </span>
                  <span className="mono" style={{ marginLeft: 'auto' }}>
                    {Math.round(ov.repairProgress)}%
                  </span>
                </div>
                <div className="repair-bar">
                  <div style={{ width: `${Math.round(ov.repairProgress)}%` }} />
                </div>
              </div>
            ) : (
              <div
                className={`worker-tag-overlay ${ov.isSelected ? 'selected' : ''} ${
                  ov.trafficStatus === 'YIELDING' ? 'yielding' : ''
                }`}
                style={{ left: ov.x, top: ov.y }}
                onClick={() => onSelectWorker && onSelectWorker(ov.id)}
              >
                <span className="legend-swatch" style={{ background: ov.color }} />
                <span className="mono" style={{ fontWeight: 600 }}>
                  {ov.id}
                </span>
                {ov.trafficStatus === 'YIELDING' && (
                  <span style={{ color: '#ef4444', fontWeight: 700 }}>
                    · RED YIELD{ov.blockingUnitId ? ` (${ov.blockingUnitId})` : ''}
                  </span>
                )}
                {ov.trafficStatus === 'PASSING_RIGHT' && (
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>· SUB-LANE</span>
                )}
                {ov.state === 'WALKING_TO_FAULT' && ov.trafficStatus === 'CLEAR' && (
                  <span className="muted">→ {ov.targetTag}</span>
                )}
                {ov.state === 'RETURNING' && ov.trafficStatus === 'CLEAR' && (
                  <span className="muted">→ Line</span>
                )}
                {ov.isSelected && <span className="mono muted">[Del]</span>}
              </div>
            )}
          </React.Fragment>
        ))}

      {/* Interactive Floating 3D Asset Tag Badges (visible in both 3D Orbit and 1st-Person AR Visor) */}
      {assetTagOverlays.map((pill) => {
        const dotColor =
          pill.health_status === 'attention_required'
            ? '#ef4444'
            : pill.health_status === 'degraded'
            ? '#f97316'
            : pill.health_status === 'watch'
            ? '#eab308'
            : '#38bdf8';
        return (
          <button
            key={pill.asset_id}
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              const targetAsset = assets.find((a) => a.asset_id === pill.asset_id);
              if (!targetAsset) return;
              onSelectAsset(targetAsset);
              setClickedPopoverAssetId(targetAsset.asset_id);
              setClickedUnboundCvObj(null);
              if (!arFirstPersonMode) {
                triggerCameraFlyTo(
                  targetAsset.position,
                  targetAsset.approach_point,
                  targetAsset.bbox_size
                );
              }
            }}
            onMouseEnter={() => {
              hoveredAssetIdRef.current = pill.asset_id;
            }}
            onMouseLeave={() => {
              if (hoveredAssetIdRef.current === pill.asset_id) {
                hoveredAssetIdRef.current = null;
              }
            }}
            style={{
              position: 'absolute',
              left: pill.x,
              top: pill.y,
              transform: 'translate(-50%, -100%)',
              zIndex: pill.isSelected || pill.isHovered ? 18 : 11,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: pill.isSelected || pill.isHovered ? '4px 9px' : '2.5px 7px',
              borderRadius: '999px',
              border: `1px solid ${pill.isSelected || pill.isHovered ? '#38bdf8' : dotColor}`,
              background:
                pill.isSelected || pill.isHovered
                  ? 'rgba(15, 23, 42, 0.96)'
                  : 'rgba(15, 23, 42, 0.84)',
              color: '#f8fafc',
              fontFamily: 'var(--mono)',
              fontSize: pill.isSelected || pill.isHovered ? '11.5px' : '10.5px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow:
                pill.isSelected || pill.isHovered
                  ? '0 0 12px rgba(56, 189, 248, 0.55)'
                  : '0 2px 6px rgba(0,0,0,0.45)',
              pointerEvents: 'auto',
              touchAction: 'manipulation',
              userSelect: 'none',
              transition: 'transform 0.12s ease, box-shadow 0.12s ease'
            }}
            title={`Tap to focus & inspect ${pill.tag} (${pill.asset_id})`}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: dotColor,
                boxShadow: `0 0 6px ${dotColor}`
              }}
            />
            <span>{pill.tag}</span>
            {pill.health_status !== 'healthy' && (
              <span style={{ color: dotColor, fontSize: '10px' }}>
                {pill.health_score}%
              </span>
            )}
          </button>
        );
      })}

      {/* First-Person Field AR Visor Frame + Collision Radar + AR Traffic Signal System */}
      {showWorkers && arFirstPersonMode && (
        <>
          <div className="fp-frame">
            <div
              className="vp-chip top-left mono"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(15, 23, 42, 0.92)',
                border: '1px solid #38bdf8',
                color: '#f8fafc',
                padding: '5px 10px',
                pointerEvents: 'auto'
              }}
            >
              <Eye size={13} style={{ color: '#38bdf8' }} />
              <span style={{ fontWeight: 700, color: '#38bdf8' }}>
                AR SMART VISOR · {selectedWorkerId || exerciseWorkers?.[0]?.id || 'W-01'}
              </span>
              <span style={{ color: '#94a3b8' }}>|</span>
              <span>Drive with W/A/S/D or Touch Pad</span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                style={{ marginLeft: '6px', padding: '1px 7px', fontSize: '10px' }}
                onClick={() => onToggleArFirstPerson(false)}
              >
                Exit AR
              </button>
            </div>
            <div className="fp-reticle" />
          </div>

          <div className={`ar-traffic-hud ${obstacleAlert?.blocked ? 'RED' : liveArSignal.light}`}>
            <div className="traffic-lights" aria-label="AR Corridor Traffic & Collision Signal">
              <span
                className={`traffic-lamp red ${
                  obstacleAlert?.blocked || liveArSignal.light === 'RED' ? 'on' : ''
                }`}
              />
              <span
                className={`traffic-lamp yellow ${
                  !obstacleAlert?.blocked &&
                  (obstacleAlert || liveArSignal.light === 'YELLOW')
                    ? 'on'
                    : ''
                }`}
              />
              <span
                className={`traffic-lamp green ${
                  !obstacleAlert && liveArSignal.light === 'GREEN' ? 'on' : ''
                }`}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontWeight: 700, fontSize: '11.5px' }}>
                {obstacleAlert?.blocked
                  ? `OBSTACLE IN FRONT (${obstacleAlert.label})  —  COLLISION PREVENTED`
                  : obstacleAlert
                  ? `OBJECT AHEAD: ${obstacleAlert.label} (${obstacleAlert.dist}m)`
                  : liveArSignal.headline}
              </div>
              <div style={{ fontSize: '11px', color: '#cbd5e1' }} className="truncate">
                {obstacleAlert
                  ? 'ESDF + 3D OBB forward collision shield active · Turn left/right to clear obstacle'
                  : liveArSignal.detail}
              </div>
            </div>

            <div className="row" style={{ gap: '3px', marginLeft: '6px' }}>
              {['AUTO', 'RED', 'YELLOW', 'GREEN'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setArTrafficOverride(mode)}
                  style={{
                    fontSize: '10px',
                    padding: '2px 5px',
                    borderRadius: '2px',
                    border: '1px solid #475569',
                    background: arTrafficOverride === mode ? '#1f6fb2' : '#1e293b',
                    color: '#fff',
                    fontFamily: 'var(--mono)'
                  }}
                  title={`Set AR traffic signal mode to ${mode}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Interactive Holographic AR Field Service Asset HUD Menu (Bound Excel Assets + Unbound PLY Equipment) */}
      {(clickedPopoverAsset || clickedUnboundCvObj) && (
        <HolographicArAssetMenu
          asset={
            clickedPopoverAsset || {
              asset_id: clickedUnboundCvObj.object_id,
              tag: clickedUnboundCvObj.object_id,
              name: `${clickedUnboundCvObj.object_id} · ${clickedUnboundCvObj.label || humanize(clickedUnboundCvObj.class)}`,
              class: clickedUnboundCvObj.class,
              excelClass: String(clickedUnboundCvObj.class || 'EQUIPMENT').toUpperCase(),
              area: 'Plant Floor / Auxiliary Zone',
              zone: 'Plant Floor / Auxiliary Zone',
              health_score: Math.round((clickedUnboundCvObj.class_confidence || 0.88) * 100),
              health_status: 'healthy',
              severity: 'info',
              status: 'normal',
              issue_code: 'SPATIAL_CV_DETECTION',
              issue_summary: `${(clickedUnboundCvObj.splat_count || 0).toLocaleString()} splats · ${(clickedUnboundCvObj.voxel_count || 0).toLocaleString()} voxels`,
              recommended_action: 'Inspect spatial clearance and verify 3DGS bounding box alignment',
              telemetry: {},
              cvObject: clickedUnboundCvObj
            }
          }
          assets={assets}
          evidencePhoto={
            (clickedPopoverAsset?.cvObject?.object_id || clickedUnboundCvObj?.object_id)
              ? EVIDENCE_PHOTO_MAP[clickedPopoverAsset?.cvObject?.object_id || clickedUnboundCvObj?.object_id]
              : null
          }
          onClose={() => {
            setClickedPopoverAssetId(null);
            setClickedUnboundCvObj(null);
            setClickedScreenAnchor(null);
          }}
          onSelectAsset={(id) => {
            const target = assets.find((a) => a.asset_id === id) || id;
            onSelectAsset(target);
            setClickedUnboundCvObj(null);
            setClickedPopoverAssetId(typeof id === 'string' ? id : id?.asset_id);
          }}
          onUpdateTelemetry={onQuickMutateTelemetry}
          onExecuteMaintenanceAction={(assetId, action) => {
            const targetAsset = assets.find((a) => a.asset_id === assetId) || clickedPopoverAsset;
            if (!targetAsset) return;
            if (action === 'dispatch') {
              const idle =
                exerciseWorkers.find((w) => w.state === 'STANDBY') || exerciseWorkers[0];
              if (idle && onAssignWorkerToFault) {
                onAssignWorkerToFault(idle.id, targetAsset);
              }
            } else if (action === 'restore' && onQuickMutateTelemetry) {
              onQuickMutateTelemetry(
                targetAsset.asset_id,
                {
                  vibration_mms: 1.4,
                  bearing_temp_c: 52.0,
                  stiction_index: 0.08
                },
                'NORMAL_OPERATION'
              );
            } else if (action === 'inject_fault' && onQuickMutateTelemetry) {
              onQuickMutateTelemetry(
                targetAsset.asset_id,
                {
                  vibration_mms: 8.4,
                  bearing_temp_c: 88.5,
                  stiction_index: 0.72
                },
                'CRITICAL_FAULT_INJECTED'
              );
            }
          }}
          onCenterAsset={() => handleFocusSelected()}
          onMoveObject={onMoveCvObject}
          objectMoves={objectMoves}
          onSwitchToTechnicianMode={!showWorkers ? onSwitchToTechnicianMode : null}
        />
      )}
      {/* On-Click Unbound CV Object Popover (with 1-Click 3D Splat Separation & Move Controls) */}
      {clickedUnboundCvObj && !clickedPopoverAsset && (
        <div
          style={{
            right: 16,
            bottom: 52,
            background: 'rgba(6, 16, 26, 0.94)',
            border: '1.5px solid #00f2ff',
            boxShadow: '0 0 24px rgba(0, 242, 255, 0.35)',
            color: '#ecfeff',
            width: '340px'
          }}
          className="vp-popover"
        >
          <div className="vp-popover-head" style={{ borderBottom: '1px solid rgba(0,242,255,0.25)' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontWeight: 800, color: '#00f2ff', fontSize: '13px' }}>
                  {clickedUnboundCvObj.label || humanize(clickedUnboundCvObj.class)}
                </span>
                <span className="mono" style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {clickedUnboundCvObj.object_id}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '3px',
                    background: 'rgba(0,242,255,0.16)',
                    border: '1px solid rgba(0,242,255,0.45)',
                    color: '#00f2ff'
                  }}
                >
                  {Math.round((clickedUnboundCvObj.class_confidence || 0.75) * 100)}% CV
                </span>
              </div>
              <div className="mono" style={{ fontSize: '11px', marginTop: '3px', color: '#94a3b8' }}>
                {(clickedUnboundCvObj.splat_count || 0).toLocaleString()} splats ·{' '}
                {(clickedUnboundCvObj.voxel_count || 0).toLocaleString()} voxels · Movable 3D Splat Object
              </div>
            </div>
            <button
              className="btn btn-sm btn-icon"
              style={{ background: 'transparent', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.3)' }}
              onClick={() => setClickedUnboundCvObj(null)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="vp-popover-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {EVIDENCE_PHOTO_MAP[clickedUnboundCvObj.object_id] && (
              <img
                src={EVIDENCE_PHOTO_MAP[clickedUnboundCvObj.object_id]}
                alt={clickedUnboundCvObj.object_id}
                style={{ width: '100%', height: '95px', objectFit: 'cover', borderRadius: '3px' }}
              />
            )}
            <div
              style={{
                padding: '8px',
                borderRadius: '4px',
                background: 'rgba(0, 242, 255, 0.08)',
                border: '1px solid rgba(0, 242, 255, 0.3)'
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: '6px' }}>
                <span className="mono" style={{ fontSize: '10px', color: '#00f2ff', fontWeight: 700 }}>
                  ✥ SEPARATE & MOVE 3D OBJECT SPLATS
                </span>
                <button
                  onClick={() => {
                    setMoveMode((m) => !m);
                    setMoveSelectedId(clickedUnboundCvObj.object_id);
                  }}
                  style={{
                    fontSize: '10px',
                    padding: '2px 7px',
                    borderRadius: '3px',
                    border: '1px solid #00f2ff',
                    background: moveMode ? '#00f2ff' : 'transparent',
                    color: moveMode ? '#04121d' : '#00f2ff',
                    fontFamily: 'var(--mono)',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {moveMode ? 'Drag Mode: ON' : 'Enable 3D Drag'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                {[
                  { label: '◀ Left', dx: -0.6, dz: 0 },
                  { label: '▲ Fwd', dx: 0, dz: 0.6 },
                  { label: '▼ Back', dx: 0, dz: -0.6 },
                  { label: 'Right ▶', dx: 0.6, dz: 0 },
                  { label: '↺ Reset', reset: true }
                ].map((b) => (
                  <button
                    key={b.label}
                    onClick={() => {
                      if (!onMoveCvObject) return;
                      const oid = clickedUnboundCvObj.object_id;
                      const cur = objectMoves?.[oid] || { dx: 0, dz: 0 };
                      if (b.reset) {
                        onMoveCvObject(oid, 0, 0);
                      } else {
                        onMoveCvObject(oid, cur.dx + b.dx, cur.dz + b.dz);
                      }
                    }}
                    style={{
                      padding: '5px 3px',
                      borderRadius: '3px',
                      border: '1px solid rgba(0,242,255,0.4)',
                      background: 'rgba(15, 23, 42, 0.85)',
                      color: '#ecfeff',
                      fontSize: '10px',
                      fontFamily: 'var(--mono)',
                      cursor: 'pointer'
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {loadingState && (
        <div className="vp-loading">
          <div className="vp-loading-box">
            <div className="spinner" />
            <span>{loadingState}</span>
          </div>
        </div>
      )}

      {/* Consumer Mode: Floating Bottom Camera Dock (while keeping our Holographic Part HUD on click) */}
      {!showWorkers && (
        <>
          <div className="consumer-dock">
            <div className="dock-mode-switch">
              <button
                type="button"
                className={`dock-mode-btn ${navMode === 'walk' ? 'active' : ''}`}
                onClick={() => handleSetNavMode('walk')}
                title="First-Person Walking Mode (Press V to toggle)"
              >
                <Footprints size={13} />
                <span>Walk (V)</span>
              </button>
              <button
                type="button"
                className={`dock-mode-btn ${navMode === 'orbit' ? 'active' : ''}`}
                onClick={() => handleSetNavMode('orbit')}
                title="Third-Person Orbit Dragging Mode (Press V to toggle)"
              >
                <RotateCw size={13} />
                <span>Orbit (V)</span>
              </button>
            </div>
            <button onClick={handleResetCameraForMode} title="Reset Camera Position">
              <RotateCcw size={14} />
              <span>Reset Position</span>
            </button>
            <button onClick={handleFacilityOverview} title="Top-down facility overview with cutaway">
              <Building size={14} />
              <span>Facility Overview</span>
            </button>
            {selectedAsset && (
              <button onClick={handleFocusSelected} title={`Focus ${selectedAsset.tag}`}>
                <Target size={14} />
                <span>Focus {selectedAsset.tag}</span>
              </button>
            )}
          </div>
          <div className="consumer-walk-hint">
            {navMode === 'walk' ? (
              <span>
                <strong>Walk Mode</strong>: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or <kbd>Arrows</kbd> to walk · Drag mouse to look around · Press <kbd>V</kbd> for Orbit · Click any part to inspect
              </span>
            ) : (
              <span>
                <strong>Orbit Mode</strong>: Drag mouse to rotate around room · Scroll to zoom · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to pan · Press <kbd>V</kbd> for Walk
              </span>
            )}
          </div>
        </>
      )}

      {/* Top-right Viewport Camera & 3DGS/CV Toolbar */}
      {showWorkers && (
      <div className="vp-toolbar">
        {onViewModeChange && (
          <>
            <button
              className={viewMode === 'splat' ? 'on' : ''}
              onClick={() => onViewModeChange('splat')}
              title="Photoreal 3D Gaussian Splatting (.spz) + CV OBB Wireframes"
            >
              3DGS Scan (.spz)
            </button>
            <button
              className={viewMode === 'hybrid' ? 'on' : ''}
              onClick={() => onViewModeChange('hybrid')}
              title="Hybrid: Photoreal 3DGS Scan + Extracted 3D CAD Equipment"
            >
              Hybrid 3DGS+CAD
            </button>
            <button
              className={viewMode === 'cad' ? 'on' : ''}
              onClick={() => onViewModeChange('cad')}
              title="Clean 3D CAD Facility Reconstruction"
            >
              Clean CAD
            </button>
          </>
        )}

        {onToggleCeilingCutaway && viewMode !== 'cad' && (
          <button
            className={ceilingCutaway ? 'on' : ''}
            onClick={() => onToggleCeilingCutaway(!ceilingCutaway)}
            title="Automatically cut away ceiling splats when viewing from above"
          >
            Ceiling Cutaway
          </button>
        )}

        {onToggleShowAllCvDetections && (
          <button
            className={showAllCvDetections ? 'on' : ''}
            onClick={() => onToggleShowAllCvDetections(!showAllCvDetections)}
            title="Toggle between showing only the 30 bound Valmet asset OBBs vs all 441 CV-detected OBBs"
          >
            {showAllCvDetections ? 'All 441 CV OBBs: ON' : '30 Bound OBBs'}
          </button>
        )}

        <button
          className={moveMode ? 'on' : ''}
          onClick={() => {
            setMoveMode((m) => !m);
            if (!moveMode && onToggleShowAllCvDetections && !showAllCvDetections) {
              onToggleShowAllCvDetections(true);
            }
          }}
          style={{
            borderColor: moveMode ? '#00f2ff' : undefined,
            background: moveMode ? '#0891b2' : undefined,
            color: moveMode ? '#fff' : undefined,
            fontWeight: moveMode ? 700 : undefined
          }}
          title="Click & drag any 3D object (Forklift, IBC Tote, Crated Unit, Workbench, Pump, Valve) to separate and move its 3D Gaussian Splats in real time"
        >
          {moveMode ? '✥ Move Objects: ON (Drag 3D)' : '✥ Move Objects'}
        </button>

        {Object.keys(objectMoves || {}).length > 0 && onResetCvMoves && (
          <button
            onClick={() => onResetCvMoves()}
            style={{ borderColor: '#f59e0b', color: '#b45309', fontWeight: 600 }}
            title="Reset all moved 3D objects back to their original scanned positions"
          >
            Reset Moves ({Object.keys(objectMoves).length})
          </button>
        )}

        {onToggleExercisePaused && (
          <button
            className={exercisePaused ? 'on' : ''}
            onClick={() => onToggleExercisePaused(!exercisePaused)}
            title="Pause or resume simulation time to batch multiple faults"
          >
            {exercisePaused ? 'â–¶ Resume' : 'â¸ Pause'}
          </button>
        )}

        <button
          className={arFirstPersonMode ? 'on' : ''}
          onClick={() => onToggleArFirstPerson(!arFirstPersonMode)}
        >
          {arFirstPersonMode ? 'Exit 1st-Person AR' : '1st-Person AR'}
        </button>
        <button onClick={handleFocusSelected}>
          Focus {selectedAsset?.tag || 'Asset'}
        </button>
        <button onClick={handleInteriorCamera} title="Jump inside the 3DGS room scan">
          Interior View
        </button>
        <button onClick={handleResetCamera} title="Top-down overview with automatic ceiling cutaway">
          Overview
        </button>
      </div>
      )}

      {/* Bottom-left 2D Floor Occupancy & ESDF Minimap (ported from ahmad_branch) */}
      {!arFirstPersonMode && showWorkers && (
        <FloorMinimap
          assets={assets}
          selectedAsset={selectedAsset}
          onSelectAsset={(asset) => {
            onSelectAsset(asset);
            setClickedPopoverAssetId(asset.asset_id);
          }}
          exerciseMode={exerciseMode}
          exerciseWorkers={exerciseWorkers}
          activePathPoints={activeProfile === 'human' ? humanPath?.points : robotPath?.points}
          cvObjectCount={cvSceneObjects?.objects?.length || 441}
        />
      )}

      {/* Bottom-right Technician Manual Drive & AR Controller Pad (Only appears when 1st-Person AR is active, with 1st/3rd Person toggle) */}
      {showWorkers && arFirstPersonMode && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
            zIndex: 45,
            background: 'rgba(9, 13, 22, 0.90)',
            color: '#f8fafc',
            border: '1px solid rgba(56, 189, 248, 0.48)',
            borderRadius: 12,
            padding: '10px 12px',
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.35)',
            backdropFilter: 'blur(10px)',
            width: 244,
            userSelect: 'none',
            WebkitUserSelect: 'none',
            touchAction: 'none',
            fontFamily: 'var(--sans)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
            <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', letterSpacing: '0.05em', color: '#38bdf8' }}>
              DRIVE TECHNICIAN
            </span>
            <button
              onClick={() => onToggleArFirstPerson(false)}
              style={{
                fontSize: 10,
                fontFamily: 'var(--mono)',
                fontWeight: 700,
                padding: '3px 7px',
                borderRadius: 5,
                border: '1px solid #f43f5e',
                background: '#f43f5e',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Exit AR
            </button>
          </div>

          {/* 1st-Person vs 3rd-Person Camera Perspective Switcher */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 4,
              background: 'rgba(15, 23, 42, 0.85)',
              padding: 3,
              borderRadius: 7,
              border: '1px solid rgba(148, 163, 184, 0.25)',
              marginBottom: 8,
            }}
          >
            <button
              type="button"
              onClick={() => setArCameraPerspective('1st')}
              style={{
                padding: '4px 6px',
                fontSize: 10,
                fontFamily: 'var(--mono)',
                fontWeight: 700,
                borderRadius: 5,
                border: 'none',
                background: arCameraPerspective === '1st' ? '#0284c7' : 'transparent',
                color: arCameraPerspective === '1st' ? '#fff' : '#94a3b8',
                cursor: 'pointer',
              }}
            >
              1st-Person
            </button>
            <button
              type="button"
              onClick={() => setArCameraPerspective('3rd')}
              style={{
                padding: '4px 6px',
                fontSize: 10,
                fontFamily: 'var(--mono)',
                fontWeight: 700,
                borderRadius: 5,
                border: 'none',
                background: arCameraPerspective === '3rd' ? '#0284c7' : 'transparent',
                color: arCameraPerspective === '3rd' ? '#fff' : '#94a3b8',
                cursor: 'pointer',
              }}
            >
              3rd-Person
            </button>
          </div>

          {/* Unit Selector Pills */}
          {exerciseMode && exerciseWorkers.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {exerciseWorkers.map((w) => {
                const activeId = selectedWorkerId || exerciseWorkers[0]?.id;
                const isSelected = w.id === activeId;
                return (
                  <button
                    key={w.id}
                    onClick={() => onSelectWorker && onSelectWorker(w.id)}
                    style={{
                      flex: 1,
                      minWidth: 44,
                      padding: '3px 5px',
                      fontSize: 10,
                      fontFamily: 'var(--mono)',
                      fontWeight: 700,
                      borderRadius: 5,
                      border: isSelected ? `1.5px solid ${w.color}` : '1px solid rgba(148,163,184,0.4)',
                      background: isSelected ? w.color : 'transparent',
                      color: isSelected ? '#fff' : '#cbd5e1',
                      cursor: 'pointer',
                    }}
                  >
                    {w.id}
                  </button>
                );
              })}
            </div>
          )}

          {/* Obstacle Anti-Collision Status Banner */}
          <div
            style={{
              marginBottom: 8,
              padding: '4px 7px',
              borderRadius: 6,
              fontSize: 10,
              fontFamily: 'var(--mono)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: obstacleAlert?.blocked
                ? 'rgba(239, 68, 68, 0.18)'
                : 'rgba(16, 185, 129, 0.14)',
              border: obstacleAlert?.blocked
                ? '1px solid rgba(239, 68, 68, 0.6)'
                : '1px solid rgba(16, 185, 129, 0.4)',
              color: obstacleAlert?.blocked ? '#fca5a5' : '#6ee7b7',
            }}
          >
            <span>
              {obstacleAlert?.blocked
                ? `BLOCKED: ${obstacleAlert.label}`
                : 'Anti-Collision Radar: CLEAR'}
            </span>
            {obstacleAlert?.blocked && (
              <span>{(obstacleAlert.dist ?? 0).toFixed(2)}m</span>
            )}
          </div>

          {/* Touch + Mouse Directional D-Pad */}
          {(() => {
            const bindHoldKey = (keyCode) => ({
              onPointerDown: (e) => {
                e.preventDefault();
                e.stopPropagation();
                keysPressedRef.current[keyCode] = true;
              },
              onPointerUp: (e) => {
                e.preventDefault();
                keysPressedRef.current[keyCode] = false;
              },
              onPointerLeave: () => {
                keysPressedRef.current[keyCode] = false;
              },
              onPointerCancel: () => {
                keysPressedRef.current[keyCode] = false;
              },
            });
            const btnStyle = {
              height: 34,
              borderRadius: 7,
              border: '1px solid rgba(148,163,184,0.3)',
              background: 'rgba(30, 41, 59, 0.9)',
              color: '#f8fafc',
              fontSize: 11,
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              touchAction: 'none',
            };
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                <button style={btnStyle} title="Strafe Left (Q)" {...bindHoldKey('KeyQ')}>
                  Q
                </button>
                <button
                  style={{ ...btnStyle, background: '#2563eb', color: '#fff', border: '1px solid #1d4ed8' }}
                  title="Walk Forward (W / Up)"
                  {...bindHoldKey('KeyW')}
                >
                  W
                </button>
                <button style={btnStyle} title="Strafe Right (E)" {...bindHoldKey('KeyE')}>
                  E
                </button>
                <button style={btnStyle} title="Turn Left (A / Left)" {...bindHoldKey('KeyA')}>
                  A
                </button>
                <button style={btnStyle} title="Step Back (S / Down)" {...bindHoldKey('KeyS')}>
                  S
                </button>
                <button style={btnStyle} title="Turn Right (D / Right)" {...bindHoldKey('KeyD')}>
                  D
                </button>
              </div>
            );
          })()}

          {/* Release Manual Control Option when a worker is in Manual Override */}
          {exerciseMode && (() => {
            const activeId = selectedWorkerId || exerciseWorkers[0]?.id;
            const activeWorker = exerciseWorkers.find((w) => w.id === activeId);
            if (!activeWorker?.manualControl) return null;
            return (
              <button
                onClick={() => {
                  delete manualWorkerPosesRef.current[activeWorker.id];
                  if (onManualUpdateWorkerPose) {
                    onManualUpdateWorkerPose(
                      activeWorker.id,
                      activeWorker.slotPos[0],
                      activeWorker.slotPos[2],
                      0,
                      false
                    );
                  }
                }}
                style={{
                  marginTop: 7,
                  width: '100%',
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(148,163,184,0.45)',
                  background: 'transparent',
                  color: '#cbd5e1',
                  fontSize: 10,
                  fontFamily: 'var(--mono)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Return {activeWorker.id} to Auto Standby
              </button>
            );
          })()}
        </div>
      )}

      {/* Bottom-left Compact Legend */}
      {showWorkers && (
      <div className="vp-chip bottom-left">
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> Drive Technician
        </span>
        <span>·</span>
        <span>Click 3D OBB to inspect</span>
        {exerciseMode && (
          <>
            <span>·</span>
            <span>
              Click worker + <kbd>Del</kbd> to remove
            </span>
          </>
        )}
      </div>
      )}
    </main>
  );
}
