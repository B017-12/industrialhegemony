import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { Wrench, Plus, Trash2, Zap, Pause, Play } from 'lucide-react';
import {
  NAV_NODES,
  NAV_EDGES,
  samplePathAtProgress,
  buildCollisionBoxes,
  resolveObstacleCollisions
} from '../utils/pathfinding.js';
import { computeArTrafficSignal } from '../utils/exerciseEngine.js';
import { STRUCTURAL_BOILER_OBJECTS } from '../data/valmetDataset.js';
import { statusOf, humanize } from '../ui/status.js';

// ISA-101 High-Performance HMI palette: colour reserved for abnormal states; normal is neutral steel grey
const HEALTH_COLORS = {
  attention_required: 0xc62828, // Alarm Red
  degraded: 0xe06c00,           // High / Degraded Orange
  watch: 0xc99400,              // Watch Amber
  healthy: 0x6b7682             // Neutral Industrial Steel
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
  contourDot: new THREE.SphereGeometry(0.022, 8, 8)
};

/**
 * Builds realistic industrial CAD equipment meshes (metallic steel bodies + color-coded actuator/status housings)
 * that sit inside the clean reconstructed CAD room — just like semantic_extraction_demo_2.mp4!
 */
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

/**
 * Builds the Clean Industrial CAD Room Architecture (Concrete Floor, Walls, Overhead HVAC Ducts,
 * IBC Tote Rack, Pipe Manifold Rack, Forklift Bay) so when Semantic World is active,
 * all noisy point-cloud "white dots" disappear completely and the room looks like a crisp 3D CAD environment!
 */
function createCleanIndustrialRoomArchitecture() {
  const room = new THREE.Group();

  // 1. Neutral Industrial Epoxy Concrete Floor (ISA-101 mid-light grey)
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xbec5cd,
    roughness: 0.78,
    metalness: 0.08
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 9.0), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1.045, 1.6);
  room.add(floor);

  // 2. Industrial Light-Grey Painted Concrete Walls
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

  // 3. Overhead Galvanized HVAC & Steam Ductwork
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

  // 4. Back-Wall Stacked IBC Tote Wall & Pipe Manifold Frame
  const toteMat = new THREE.MeshStandardMaterial({
    color: 0xeef1f4,
    roughness: 0.4,
    metalness: 0.1
  });
  const cageMat = new THREE.LineBasicMaterial({ color: 0x8a949e });

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const toteGeo = new THREE.BoxGeometry(0.82, 0.85, 0.82);
      const tote = new THREE.Mesh(toteGeo, toteMat);
      tote.position.set(-3.4 + col * 0.92, -0.58 + row * 0.90, 3.65);
      room.add(tote);

      const cage = new THREE.LineSegments(new THREE.EdgesGeometry(toteGeo), cageMat);
      cage.position.copy(tote.position);
      room.add(cage);
    }
  }

  // Industrial Manifold Rack on East Wall
  const blueRackMat = new THREE.MeshStandardMaterial({
    color: 0x4b6b88,
    metalness: 0.45,
    roughness: 0.4
  });
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.65, 0.16), blueRackMat);
  rackFrame.position.set(2.1, -0.15, 3.72);
  room.add(rackFrame);

  // Safety Guardrail in Mid-Bay (aligned 1:1 with STATIC_ROOM_OBSTACLES collider)
  const yellowMat = new THREE.MeshStandardMaterial({
    color: 0xc99400,
    metalness: 0.3,
    roughness: 0.4
  });
  const yellowRail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.38, 0.72), yellowMat);
  yellowRail.position.set(0.88, -0.82, 1.05);
  room.add(yellowRail);

  return room;
}

function createHumanoidRig(colorHex = 0xf97316, isHuman = false, hitboxSize = [0.56, 1.45, 0.52]) {
  const root = new THREE.Group();

  const [hx, hy, hz] = hitboxSize;
  const hitboxGeo = new THREE.BoxGeometry(hx, hy, hz);
  const hitboxEdges = new THREE.EdgesGeometry(hitboxGeo);
  const hitboxMat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.48
  });
  const hitboxWire = new THREE.LineSegments(hitboxEdges, hitboxMat);
  hitboxWire.position.y = hy * 0.5;
  root.add(hitboxWire);

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const primaryMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: isHuman ? 0.18 : 0.65,
    roughness: isHuman ? 0.45 : 0.32
  });
  const darkJointMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.5,
    roughness: 0.4
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.9
  });

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(isHuman ? 0.30 : 0.32, isHuman ? 0.46 : 0.42, 0.19),
    primaryMat
  );
  torso.position.y = 0.76;
  bodyGroup.add(torso);

  if (isHuman) {
    // High-visibility reflective safety vest band across human technician torso
    const vestBandMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      emissive: 0xca8a04,
      emissiveIntensity: 0.25,
      roughness: 0.3
    });
    const vestBand = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.07, 0.20), vestBandMat);
    vestBand.position.y = 0.78;
    bodyGroup.add(vestBand);

    // Human face/head + industrial safety hard-hat
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xf1c27d,
      roughness: 0.55,
      metalness: 0.05
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 16), skinMat);
    head.position.y = 1.13;
    bodyGroup.add(head);

    // Safety glasses / visor
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, 0.04), darkJointMat);
    glasses.position.set(0, 1.14, 0.10);
    bodyGroup.add(glasses);

    // Industrial Hard-Hat Dome + Brim
    const helmetMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.25,
      metalness: 0.2
    });
    const helmetDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      helmetMat
    );
    helmetDome.position.y = 1.15;
    bodyGroup.add(helmetDome);

    const helmetBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.02, 16), helmetMat);
    helmetBrim.position.set(0, 1.16, 0.015);
    bodyGroup.add(helmetBrim);
  } else {
    // Autonomous AMR Robot Head + Glowing LiDAR Visor
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.19, 0.22), primaryMat);
    head.position.y = 1.10;
    bodyGroup.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.05), visorMat);
    visor.position.set(0, 1.10, 0.10);
    bodyGroup.add(visor);
  }

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.085, 0.52, 0);
  const leftLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.48, 0.105), darkJointMat);
  leftLegMesh.position.y = -0.24;
  leftLegPivot.add(leftLegMesh);
  bodyGroup.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.085, 0.52, 0);
  const rightLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.48, 0.105), darkJointMat);
  rightLegMesh.position.y = -0.24;
  rightLegPivot.add(rightLegMesh);
  bodyGroup.add(rightLegPivot);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.20, 0.94, 0);
  const leftArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.38, 0.085), primaryMat);
  leftArmMesh.position.y = -0.18;
  leftArmPivot.add(leftArmMesh);
  bodyGroup.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.20, 0.94, 0);
  const rightArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.38, 0.085), primaryMat);
  rightArmMesh.position.y = -0.18;
  rightArmPivot.add(rightArmMesh);

  // 3D Steel Wrench Tool in Right Hand (visible during REPAIRING state)
  const toolMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.85,
    roughness: 0.2
  });
  const wrenchGroup = new THREE.Group();
  const wrenchShaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.26), toolMat);
  wrenchShaft.position.set(0, -0.35, 0.11);
  wrenchGroup.add(wrenchShaft);
  const wrenchJaw = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12), toolMat);
  wrenchJaw.rotation.z = Math.PI / 2;
  wrenchJaw.position.set(0, -0.35, 0.24);
  wrenchGroup.add(wrenchJaw);
  wrenchGroup.visible = false;
  rightArmPivot.add(wrenchGroup);

  bodyGroup.add(rightArmPivot);

  const radarGeo = new THREE.RingGeometry(0.96, 1.0, 36);
  radarGeo.rotateX(-Math.PI / 2);
  const radarMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.28
  });
  const radarRing = new THREE.Mesh(radarGeo, radarMat);
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
  onInjectRandomFault,
  autoDispatch = true,
  onToggleAutoDispatch,
  onArTrafficSignalChange
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const pointCloudMatRef = useRef(null);
  const pointCloudObjRef = useRef(null);
  const cadRoomGroupRef = useRef(null);
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

  // STRICT INTERACTION RULE:
  // Nothing pops up or shows object details until the user explicitly clicks/interacts with a 3D object!
  const [clickedPopoverAssetId, setClickedPopoverAssetId] = useState(null);
  const [clickedScreenAnchor, setClickedScreenAnchor] = useState(null);
  const [workerOverlays, setWorkerOverlays] = useState([]);
  const [arTrafficOverride, setArTrafficOverride] = useState('AUTO'); // 'AUTO' | 'RED' | 'YELLOW' | 'GREEN'
  const [liveArSignal, setLiveArSignal] = useState({
    light: 'GREEN',
    headline: 'GREEN LIGHT — PROCEED',
    detail: 'Corridor clear · Right-of-way granted',
    conflictingUnitId: null,
    distanceMeters: null,
    speedMultiplier: 1.0,
    laneOffset: 0
  });

  const keysPressedRef = useRef({});
  const manualPosRef = useRef(null);
  const laserSweepStateRef = useRef({ active: false, zPos: -4.5 });

  const [loadingState, setLoadingState] = useState('Loading Equipment Room.ply 3D Scene...');
  const [isWasdWalking, setIsWasdWalking] = useState(false);

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
    exerciseMode,
    exercisePaused,
    exerciseWorkers,
    selectedWorkerId,
    arTrafficOverride
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
      exerciseMode,
      exercisePaused,
      exerciseWorkers,
      selectedWorkerId,
      arTrafficOverride
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
    exerciseMode,
    exercisePaused,
    exerciseWorkers,
    selectedWorkerId,
    arTrafficOverride
  ]);

  useEffect(() => {
    if (!laserSweepTrigger) return;
    laserSweepStateRef.current = { active: true, zPos: -3.2 };
    if (onSemanticBlendChange) onSemanticBlendChange(0);
  }, [laserSweepTrigger]);

  // 1. Initialize Three.js Scene + Clean CAD Room + Click-Only Interaction
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd7dbe0);
    scene.fog = new THREE.FogExp2(0xd7dbe0, 0.022);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    // Zoomed-out default perspective so the entire equipment room and worker staging line fit comfortably
    camera.position.set(0.2, 3.35, -4.85);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.1, -0.35, 1.55);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxDistance = 18;
    controls.minDistance = 0.4;
    controls.update();
    controlsRef.current = controls;

    // Neutral industrial lighting for ISA-101 light viewport
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x9aa4ae, 1.15);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(4, 9, -4);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xe2e8f0, 0.55);
    fillLight.position.set(-5, 4, 5);
    scene.add(fillLight);

    // Subtle Floor Grid
    const gridHelper = new THREE.GridHelper(11.5, 23, 0x9aa3ad, 0xb4bcc5);
    gridHelper.position.set(0, -1.04, 1.6);
    scene.add(gridHelper);

    // Clean Industrial CAD Room Architecture
    const cadRoomGroup = createCleanIndustrialRoomArchitecture();
    scene.add(cadRoomGroup);
    cadRoomGroupRef.current = cadRoomGroup;

    // Semantic Segmentation Sweep Plane
    const laserGroup = new THREE.Group();
    const laserPlaneGeo = new THREE.PlaneGeometry(11.5, 4.5);
    const laserPlaneMat = new THREE.MeshBasicMaterial({
      color: 0x1f6fb2,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22,
      depthWrite: false
    });
    laserGroup.add(new THREE.Mesh(laserPlaneGeo, laserPlaneMat));
    laserGroup.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(laserPlaneGeo),
        new THREE.LineBasicMaterial({ color: 0x1f6fb2 })
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

    // Clear rig map on new scene mount (prevents React 18 StrictMode stale parent references)
    exerciseWorkerRigsRef.current.clear();

    // Staging Station Line Pad on Floor (z = -0.32) where workers stand in a line
    const stagingPadGeo = new THREE.PlaneGeometry(5.2, 0.56);
    stagingPadGeo.rotateX(-Math.PI / 2);
    const stagingPadMat = new THREE.MeshBasicMaterial({
      color: 0x1f6fb2,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide
    });
    const stagingPad = new THREE.Mesh(stagingPadGeo, stagingPadMat);
    stagingPad.position.set(0, -1.036, -0.32);
    exerciseGroup.add(stagingPad);

    const stagingBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(stagingPadGeo),
      new THREE.LineBasicMaterial({ color: 0x1f6fb2, transparent: true, opacity: 0.65 })
    );
    stagingBorder.position.copy(stagingPad.position);
    exerciseGroup.add(stagingBorder);

    // 3D AR Traffic Red-Light / Green-Light Virtual Floor Gate & Beacon (visible in 1st-Person AR Mode)
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

    // Load Equipment Room.ply binary (for Raw Scan mode or Laser Sweep transition)
    fetch('/assets/equipment_room_splats.bin')
      .then((res) => {
        if (!res.ok) return fetch('/assets/boiler_room_splats.bin');
        return res;
      })
      .then((res) => res.arrayBuffer())
      .then((buffer) => {
        const dv = new DataView(buffer);
        const count = dv.getInt32(0, true);
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);

        let offset = 4;
        for (let i = 0; i < count; i++) {
          positions[i * 3 + 0] = dv.getFloat32(offset + 0, true);
          positions[i * 3 + 1] = dv.getFloat32(offset + 4, true);
          positions[i * 3 + 2] = dv.getFloat32(offset + 8, true);

          const r = dv.getUint8(offset + 12) / 255;
          const g = dv.getUint8(offset + 13) / 255;
          const b = dv.getUint8(offset + 14) / 255;
          colors[i * 3 + 0] = Math.min(1, r * 1.1);
          colors[i * 3 + 1] = Math.min(1, g * 1.1);
          colors[i * 3 + 2] = Math.min(1, b * 1.1);
          offset += 16;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
          size: 0.045,
          vertexColors: true,
          transparent: true,
          opacity: 0.0, // Hidden at 100% Semantic Mode so there are ZERO noisy white dots!
          sizeAttenuation: true
        });

        const pointsObj = new THREE.Points(geometry, material);
        pointsObj.visible = false; // Completely hidden in 100% Semantic CAD World
        scene.add(pointsObj);
        pointCloudObjRef.current = pointsObj;
        pointCloudMatRef.current = material;
        setLoadingState(null);
        if (onLoadStats) {
          onLoadStats({
            sourceFile: 'Equipment Room.ply',
            rawVertices: 1676481,
            activeSplats: count,
            anchoredAssets: 30,
            structuralFrames: STRUCTURAL_BOILER_OBJECTS.length
          });
        }
      })
      .catch((err) => {
        console.error('Error loading splats:', err);
        setLoadingState(null);
      });

    // Keyboard WASD / Arrow Keys / Delete Worker Listener
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && stateRef.current.selectedWorkerId) {
        e.preventDefault();
        if (onDeleteWorker) onDeleteWorker(stateRef.current.selectedWorkerId);
        return;
      }

      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keysPressedRef.current[k] = true;
        setIsWasdWalking(true);
        if (onSimPlayingChange) onSimPlayingChange(false);
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

    // Raycaster ONLY on Click / PointerUp — ZERO passive labels or popups!
    // When you click/interact with an object, its floating callout badge + control card appears anchored to it.
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const handlePointerDown = (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e) => {
      const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moveDist > 6) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // 0. Check Exercise Mode Workers FIRST so clicking a worker selects them (for Delete or manual dispatch)
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

      // 1. Check 30 Contoured 3D Assets
      if (assetGroupRef.current) {
        const hits = raycaster.intersectObjects(assetGroupRef.current.children, true);
        if (hits.length > 0) {
          let obj = hits[0].object;
          while (obj && !obj.userData?.asset) {
            obj = obj.parent;
          }
          if (obj?.userData?.asset) {
            manualPosRef.current = null;
            setIsWasdWalking(false);
            const clickedAsset = obj.userData.asset;
            onSelectAsset(clickedAsset);
            setClickedPopoverAssetId(clickedAsset.asset_id);
            return;
          }
        }
      }

      // 2. Check Floor Waypoint Hazard Nodes
      if (navGraphGroupRef.current) {
        const navHits = raycaster.intersectObjects(navGraphGroupRef.current.children, true);
        if (navHits.length > 0) {
          const nodeId = navHits[0].object.userData?.nodeId;
          if (nodeId && nodeId !== 'N-ENTRY') {
            onToggleHazardNode(nodeId);
            return;
          }
        }
      }

      // 3. Clicked on empty space -> hide the Popover Card and deselect worker
      setClickedPopoverAssetId(null);
      setClickedScreenAnchor(null);
      if (onSelectWorker) onSelectWorker(null);
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
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

      // Animate AI Semantic Laser Wave if triggered (sweeps from Raw Point Cloud -> Clean 3D CAD World!)
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

      // Toggle visibility between Simulation Exercise Mode and Standard Fleet Patrol Mode
      if (fleetGroupRef.current) fleetGroupRef.current.visible = !st.exerciseMode;
      if (pathGroupRef.current) pathGroupRef.current.visible = !st.exerciseMode;
      if (exerciseGroupRef.current) exerciseGroupRef.current.visible = Boolean(st.exerciseMode);
      if (exercisePathGroupRef.current) exercisePathGroupRef.current.visible = Boolean(st.exerciseMode);

      // WASD / Arrow Keys Manual Walking vs. Exercise Mode vs. Centerline Rail Patrol
      const keys = keysPressedRef.current;
      const anyWasdDown =
        keys.w || keys.s || keys.a || keys.d || keys.arrowup || keys.arrowdown || keys.arrowleft || keys.arrowright;

      let primarySample = {
        position: [0, -1.02, -0.32],
        tangent: [0, 0, 1]
      };

      let focusWorkerId = null;

      if (st.exerciseMode) {
        // Animate all Simulation Exercise Workers (standing in a line, walking with traffic rules, repairing, returning)
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
          const wpos = w.position || w.pos || [0, -1.02, -0.32];
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
            rig.rotation.y = w.angle || 0;
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

          rig.position.lerp(new THREE.Vector3(wpos[0], -1.02, wpos[2]), 0.35);

          const prevAngle = rig.userData.currentAngle ?? w.angle ?? 0;
          let diff = (w.angle ?? 0) - prevAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const smoothAngle = prevAngle + diff * 0.22;
          rig.userData.currentAngle = smoothAngle;
          rig.rotation.y = smoothAngle;

          const isWalking =
            !st.exercisePaused &&
            (w.state === 'WALKING_TO_FAULT' || w.state === 'RETURNING') &&
            w.trafficStatus !== 'YIELDING';
          const isRepairing = w.state === 'REPAIRING';

          const walkCycle = isWalking ? Math.sin(now * 0.012 + idx * 1.3) * 0.58 : 0;
          const bob = isWalking ? Math.abs(Math.cos(now * 0.012 + idx * 1.3)) * 0.032 : 0;

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
              // Active tool repair arm motion
              const wrenchSwing = st.exercisePaused ? 0 : Math.sin(now * 0.022) * 0.38;
              rig.userData.rightArmPivot.rotation.x = -1.05 + wrenchSwing;
              rig.userData.leftArmPivot.rotation.x = -0.65;
            } else {
              rig.userData.leftArmPivot.rotation.x = -walkCycle * 0.75;
              rig.userData.rightArmPivot.rotation.x = walkCycle * 0.75;
            }
          }

          if (rig.userData.hitboxWire) {
            const isSel = st.selectedWorkerId === w.id;
            rig.userData.hitboxWire.material.opacity = isSel ? 1.0 : 0.42;
          }
          if (rig.userData.radarRing) {
            const isSel = st.selectedWorkerId === w.id;
            rig.userData.radarRing.scale.set(isSel ? 0.85 : 0.52, 1, isSel ? 0.85 : 0.52);
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
            }
          }
        });

        // Update 3D Floor Intersection Block Signals (Red = Locked by Worker, Green = Clear)
        if (navGraphGroupRef.current) {
          const lockedNodeSet = new Set();
          st.exerciseWorkers.forEach((w) => {
            if (w.lockedNodeId) lockedNodeSet.add(w.lockedNodeId);
            if (w.state === 'WALKING_TO_FAULT' || w.state === 'RETURNING') {
              const wpos = w.position || w.pos || [0, -1.02, -0.32];
              NAV_NODES.forEach((n) => {
                if (Math.hypot(n.pos[0] - wpos[0], n.pos[2] - wpos[2]) < 0.62) {
                  lockedNodeSet.add(n.id);
                }
              });
            }
          });
          const anyMoving = st.exerciseWorkers.some(
            (w) => w.state === 'WALKING_TO_FAULT' || w.state === 'RETURNING'
          );
          navGraphGroupRef.current.children.forEach((obj) => {
            if (obj.userData?.isNavNodeSphere && !obj.userData?.isHazard) {
              const isLocked = lockedNodeSet.has(obj.userData.nodeId);
              obj.material.color.setHex(
                isLocked ? 0xef4444 : anyMoving ? 0x49a942 : obj.userData.isStair ? 0x38bdf8 : 0x64748b
              );
              obj.material.opacity = isLocked ? 0.95 : anyMoving ? 0.82 : 0.6;
            }
            if (obj.userData?.isNavSignalRing && !obj.userData?.isHazard) {
              const isLocked = lockedNodeSet.has(obj.userData.nodeId);
              obj.visible = Boolean(anyMoving || isLocked);
              obj.material.color.setHex(isLocked ? 0xef4444 : 0x49a942);
              obj.material.opacity = isLocked ? 0.78 : 0.35;
            }
          });
        }

        const focusWorker =
          st.exerciseWorkers.find((w) => w.id === st.selectedWorkerId) ||
          st.exerciseWorkers.find((w) => w.state !== 'STANDBY') ||
          st.exerciseWorkers[0];
        if (focusWorker) {
          const fwPos = focusWorker.position || focusWorker.pos || [0, -1.02, -0.32];
          focusWorkerId = focusWorker.id;
          primarySample = {
            position: [fwPos[0], -1.02, fwPos[2]],
            tangent: [Math.sin(focusWorker.angle || 0), 0, Math.cos(focusWorker.angle || 0)]
          };
        }
      }

      // Compute AR Red-Light / Yellow-Light / Green-Light Traffic Signal for current avatar
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
          headline: 'RED LIGHT — HOLD POSITION',
          detail: 'Intersection stop signal active · Forward motion gated',
          conflictingUnitId: activeSignal.conflictingUnitId || 'Cross-Traffic',
          distanceMeters: activeSignal.distanceMeters || 0.85,
          speedMultiplier: 0,
          laneOffset: 0
        };
      } else if (st.arTrafficOverride === 'YELLOW') {
        activeSignal = {
          light: 'YELLOW',
          headline: 'YELLOW LIGHT — KEEP RIGHT LANE',
          detail: 'Shared corridor active · Right-hand passing offset +0.22 m',
          conflictingUnitId: activeSignal.conflictingUnitId || 'Oncoming Unit',
          distanceMeters: activeSignal.distanceMeters || 1.45,
          speedMultiplier: 0.75,
          laneOffset: 0.22
        };
      } else if (st.arTrafficOverride === 'GREEN') {
        activeSignal = {
          light: 'GREEN',
          headline: 'GREEN LIGHT — PROCEED',
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
          // Red Light in AR Mode gates forward motion while still allowing backing up or turning
          moveDir = st.arFirstPersonMode && activeSignal.light === 'RED' ? 0 : 1;
        }
        if (keys.s || keys.arrowdown) moveDir = -1;

        if (moveDir !== 0) {
          const prevX = manualPosRef.current.x;
          const prevZ = manualPosRef.current.z;
          const nx = prevX + Math.sin(manualPosRef.current.angle) * speed * moveDir;
          const nz = prevZ + Math.cos(manualPosRef.current.angle) * speed * moveDir;
          // Sub-step collision resolution with smooth wall/equipment sliding
          const [rx, rz] = resolveObstacleCollisions(nx, nz, 0.26, obstacles, prevX, prevZ);
          manualPosRef.current.x = rx;
          manualPosRef.current.z = rz;
        } else {
          // Ensure resting position is also outside any equipment
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

      // Secondary Multi-Agent Fleet Rigs (R2, H1) + Mutual Traffic Avoidance in Standard Mode
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

          // Enforce mutual personal-space traffic separation across R1, R2, H1
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

      // Update 3D AR Traffic Virtual Floor Gate & Beacon in 1st-Person AR Mode
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

      // First-Person AR Camera Mode: Position camera slightly behind & above the avatar so the robot body never blocks your view!
      if (st.arFirstPersonMode) {
        const eyeX = primarySample.position[0] + primarySample.tangent[0] * 0.35;
        const eyeY = primarySample.position[1] + 1.32;
        const eyeZ = primarySample.position[2] + primarySample.tangent[2] * 0.35;
        camera.position.lerp(new THREE.Vector3(eyeX, eyeY, eyeZ), 0.22);

        const lookX = eyeX + primarySample.tangent[0] * 3.0;
        const lookY = eyeY - 0.15;
        const lookZ = eyeZ + primarySample.tangent[2] * 3.0;
        controls.target.lerp(new THREE.Vector3(lookX, lookY, lookZ), 0.22);
        controls.update();
      } else {
        controls.update();
      }

      // Proximity & Click Highlighting across all 30 Contoured Assets
      const nearby = [];
      st.assets.forEach((asset) => {
        const dx = asset.position[0] - primarySample.position[0];
        const dy = asset.position[1] - primarySample.position[1];
        const dz = asset.position[2] - primarySample.position[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const isWithinRadius = dist <= st.proximityRadius;
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
          const isAbnormal = asset.health_status !== 'healthy';
          const semanticAlpha = revealedByLaser ? st.semanticBlend / 100 : 0.04;
          const baseBoxOpacity = isClickedOpen || isSelected
            ? 0.22
            : isAbnormal
            ? 0.10
            : 0.02;
          const baseEdgeOpacity = isClickedOpen || isSelected
            ? 0.98
            : isAbnormal
            ? 0.82
            : isWithinRadius
            ? 0.45
            : 0.18;

          meshBundle.fillMat.opacity = baseBoxOpacity * semanticAlpha;
          meshBundle.edgeMat.opacity = baseEdgeOpacity * Math.max(0.15, semanticAlpha);

          if (meshBundle.equipMats) {
            meshBundle.equipMats.solidMat.opacity = Math.max(0.25, semanticAlpha * 0.95);
            meshBundle.equipMats.accentMat.opacity = Math.max(0.25, semanticAlpha * 0.95);
            meshBundle.equipGroup.visible = semanticAlpha > 0.08;
          }

          // Real-Time Physical Vibration Jitter on Faulty Rotating Equipment
          if (meshBundle.equipGroup && (asset.telemetry?.vibration_mms || 0) > 4.5) {
            meshBundle.equipGroup.position.x = Math.sin(now * 0.055) * 0.014;
            meshBundle.equipGroup.position.y = Math.cos(now * 0.065) * 0.010;
          } else if (meshBundle.equipGroup) {
            meshBundle.equipGroup.position.set(0, 0, 0);
          }

          if (meshBundle.backPlaneMat) {
            meshBundle.backPlaneMat.opacity =
              st.showContourModels && isClickedOpen ? 0.72 * semanticAlpha : 0;
          }
          // Only show the 12 cyan contour dots on the object you are actively interacting with (or in radar) so the scene stays super clean!
          if (meshBundle.contourGroup) {
            meshBundle.contourGroup.visible = Boolean(
              st.showContourModels && (isClickedOpen || isWithinRadius) && semanticAlpha > 0.2
            );
          }

          if (isClickedOpen) {
            const s = 1.08 + Math.sin(now * 0.008) * 0.03;
            meshBundle.group.scale.set(s, s, s);
          } else {
            meshBundle.group.scale.set(1, 1, 1);
          }
        }
      });

      // Project 3D anchor positions for clicked asset popover AND active exercise worker repair badges
      labelTick++;
      if (labelTick % 3 === 0 && container) {
        nearby.sort((a, b) => a.distanceToAvatar - b.distanceToAvatar);
        onNearbyAssetsChange(nearby);
        setLiveArSignal(activeSignal);
        if (onArTrafficSignalChange) onArTrafficSignalChange(activeSignal);

        const width = container.clientWidth;
        const height = container.clientHeight;

        if (st.exerciseMode && st.exerciseWorkers?.length) {
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

        if (st.clickedPopoverAssetId) {
          const clickedAsset = st.assets.find((a) => a.asset_id === st.clickedPopoverAssetId);
          if (clickedAsset) {
            const worldPos = new THREE.Vector3(
              clickedAsset.position[0],
              clickedAsset.position[1] + clickedAsset.bbox_size[1] * 0.68,
              clickedAsset.position[2]
            );
            worldPos.project(camera);
            if (worldPos.z > -1 && worldPos.z < 1) {
              const x = (worldPos.x * 0.5 + 0.5) * width;
              const y = (-(worldPos.y * 0.5) + 0.5) * height;
              const num = parseInt(clickedAsset.asset_id.split('-')[1], 10) || 1;
              const triCount = (7.4 + ((num * 3.7) % 24.5)).toFixed(1);
              setClickedScreenAnchor({
                x: Math.min(width - 330, Math.max(20, x)),
                y: Math.min(height - 260, Math.max(60, y)),
                triCount,
                meshIdx: String(num).padStart(2, '0')
              });
            }
          }
        }
      }

      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.dispose();
    };
  }, []);

  // Switch between Equipment Room.ply and Industrial Boiler Room (1).ply
  useEffect(() => {
    if (!sceneRef.current || !pointCloudObjRef.current || customPlyBuffer) return;
    const isEquip = activeRoomScene === 'equipment_room';
    const binUrl = isEquip
      ? '/assets/equipment_room_splats.bin'
      : '/assets/boiler_room_splats.bin';
    const label = isEquip ? 'Equipment Room.ply' : 'Industrial Boiler Room (1).ply';
    const rawTotal = isEquip ? 1676481 : 1506136;

    fetch(binUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${binUrl}`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        const dv = new DataView(buffer);
        const count = dv.getInt32(0, true);
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);

        let offset = 4;
        for (let i = 0; i < count; i++) {
          positions[i * 3 + 0] = dv.getFloat32(offset + 0, true);
          positions[i * 3 + 1] = dv.getFloat32(offset + 4, true);
          positions[i * 3 + 2] = dv.getFloat32(offset + 8, true);

          const r = dv.getUint8(offset + 12) / 255;
          const g = dv.getUint8(offset + 13) / 255;
          const b = dv.getUint8(offset + 14) / 255;
          colors[i * 3 + 0] = Math.min(1, r * 1.1);
          colors[i * 3 + 1] = Math.min(1, g * 1.1);
          colors[i * 3 + 2] = Math.min(1, b * 1.1);
          offset += 16;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        pointCloudObjRef.current.geometry.dispose();
        pointCloudObjRef.current.geometry = geometry;
        if (onLoadStats) {
          onLoadStats({
            sourceFile: label,
            rawVertices: rawTotal,
            activeSplats: count,
            anchoredAssets: assets.length,
            structuralFrames: STRUCTURAL_BOILER_OBJECTS.length
          });
        }
      })
      .catch((err) => {
        console.error('Error switching room binary:', err);
      });
  }, [activeRoomScene]);

  // Custom PLY Upload
  useEffect(() => {
    if (!customPlyBuffer || !sceneRef.current || !pointCloudObjRef.current) return;
    try {
      setLoadingState('Parsing uploaded PLY file...');
      const { geometry, count } = parseCustomPlyArrayBuffer(customPlyBuffer);
      pointCloudObjRef.current.geometry.dispose();
      pointCloudObjRef.current.geometry = geometry;
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

  // Completely hide noisy point-cloud dots when Semantic World >= 80% so the scene is 100% clean CAD!
  useEffect(() => {
    if (!pointCloudMatRef.current || !pointCloudObjRef.current) return;
    pointCloudMatRef.current.size = pointSize;
    const blendFactor = semanticBlend / 100;
    if (semanticBlend >= 80) {
      // 100% Clean CAD Mode: ZERO white dots!
      pointCloudObjRef.current.visible = false;
      pointCloudMatRef.current.opacity = 0;
    } else {
      pointCloudObjRef.current.visible = true;
      pointCloudMatRef.current.opacity = 1.0 - blendFactor * 1.15;
    }
    if (cadRoomGroupRef.current) {
      cadRoomGroupRef.current.visible = semanticBlend >= 25;
    }
  }, [pointSize, semanticBlend]);

  // Build 30 Contoured 3D Asset Models
  useEffect(() => {
    const assetGroup = assetGroupRef.current;
    const structuralGroup = structuralGroupRef.current;
    if (!assetGroup || !structuralGroup) return;

    while (assetGroup.children.length > 0) {
      assetGroup.remove(assetGroup.children[0]);
    }
    assetMeshMapRef.current.clear();

    assets.forEach((asset) => {
      const colorHex = HEALTH_COLORS[asset.health_status] || 0x10b981;
      const [sx, sy, sz] = asset.bbox_size;

      const group = new THREE.Group();
      group.position.set(asset.position[0], asset.position[1], asset.position[2]);
      group.userData = { asset };

      const { group: equipGroup, solidMat, accentMat } = createProceduralEquipmentMesh(asset, colorHex);
      equipGroup.userData = { asset };
      group.add(equipGroup);

      const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
      const fillMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.06,
        depthWrite: false
      });
      const boxMesh = new THREE.Mesh(boxGeo, fillMat);
      boxMesh.userData = { asset };
      group.add(boxMesh);

      const edgesGeo = new THREE.EdgesGeometry(boxGeo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.85
      });
      const wireMesh = new THREE.LineSegments(edgesGeo, edgeMat);
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
        contourGroup.add(new THREE.Line(contourLineGeo, contourLineMat));

        const dotMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        localContourVecs.slice(0, -1).forEach((v) => {
          const dot = new THREE.Mesh(GEO_CACHE.contourDot, dotMat);
          dot.position.copy(v);
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
        wire.position.set(stObj.position[0], stObj.position[1], stObj.position[2]);
        structuralGroup.add(wire);
      });
    }
  }, [assets, showStructuralBoxes, showContourModels, semanticBlend]);

  // Render Centerline Waypoint 'Rails'
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
      pathGroup.add(mesh);
    };

    const isZig = railMode === 'zigzag_grid';

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

    const nodeMap = new Map(NAV_NODES.map((n) => [n.id, n]));
    NAV_EDGES.forEach((edge) => {
      const u = nodeMap.get(edge.from);
      const v = nodeMap.get(edge.to);
      if (!u || !v) return;

      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(u.pos[0], u.pos[1] + 0.012, u.pos[2]),
        new THREE.Vector3(v.pos[0], v.pos[1] + 0.012, v.pos[2])
      ]);
      const m = new THREE.LineBasicMaterial({
        color: edge.has_stairs ? 0x0284c7 : 0x475569,
        transparent: true,
        opacity: 0.65
      });
      navGraphGroup.add(new THREE.Line(g, m));
    });

    NAV_NODES.forEach((node) => {
      const isHazard = hazardNodes.includes(node.id);
      const isStair = node.id === 'N-M-STEP';

      const sphereGeo = new THREE.SphereGeometry(isHazard ? 0.16 : 0.055, 12, 12);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: isHazard ? 0xef4444 : isStair ? 0x38bdf8 : 0x64748b,
        transparent: true,
        opacity: isHazard ? 0.95 : 0.6
      });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.set(node.pos[0], node.pos[1] + 0.04, node.pos[2]);
      sphere.userData = {
        nodeId: node.id,
        label: node.label,
        isNavNodeSphere: true,
        isHazard,
        isStair
      };
      navGraphGroup.add(sphere);

      if (!isHazard && node.id !== 'N-ENTRY') {
        const ringGeo = new THREE.RingGeometry(0.18, 0.24, 24);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x49a942,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.35
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(node.pos[0], node.pos[1] + 0.014, node.pos[2]);
        ring.visible = false;
        ring.userData = {
          nodeId: node.id,
          isNavSignalRing: true,
          isHazard
        };
        navGraphGroup.add(ring);
      }

      if (isHazard) {
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
      }
    });
  }, [humanPath, robotPath, activeProfile, railMode, multiAgentEnabled, fleetAssignments, showDualComparison, hazardNodes, selectedAsset]);

  // Sync Dynamic Exercise Workers & Active Repair Route Tubes in 3D Scene
  useEffect(() => {
    const exerciseGroup = exerciseGroupRef.current;
    const exercisePathGroup = exercisePathGroupRef.current;
    if (!exerciseGroup || !exercisePathGroup) return;

    const rigMap = exerciseWorkerRigsRef.current;
    const activeIds = new Set(exerciseWorkers.map((w) => w.id));

    // Remove deleted workers from 3D group
    for (const [id, rig] of rigMap.entries()) {
      if (!activeIds.has(id)) {
        exerciseGroup.remove(rig);
        rigMap.delete(id);
      }
    }

    // Add or update existing workers
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

    // Rebuild active worker route tubes in exercisePathGroup
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
        exercisePathGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
      });
    }
  }, [exerciseWorkers, exerciseMode, railMode]);

  const handleResetCamera = () => {
    if (arFirstPersonMode) onToggleArFirstPerson(false);
    manualPosRef.current = null;
    setIsWasdWalking(false);
    setClickedPopoverAssetId(null);
    setClickedScreenAnchor(null);
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(0.2, 3.35, -4.85);
    controlsRef.current.target.set(0.1, -0.35, 1.55);
    controlsRef.current.update();
  };

  const handleFocusSelected = () => {
    if (arFirstPersonMode) onToggleArFirstPerson(false);
    if (!cameraRef.current || !controlsRef.current || !selectedAsset) return;
    const [x, y, z] = selectedAsset.position;
    controlsRef.current.target.set(x, y, z);
    cameraRef.current.position.set(x * 0.5, y + 1.35, z - 2.45);
    controlsRef.current.update();
  };

  const clickedPopoverAsset = clickedPopoverAssetId
    ? assets.find((a) => a.asset_id === clickedPopoverAssetId)
    : null;
  const clickedSt = clickedPopoverAsset ? statusOf(clickedPopoverAsset) : null;

  return (
    <main className="viewport">
      <div ref={mountRef} className="viewport-canvas" />

      {/* Simulation Exercise Mode Instruction Banner */}
      {exerciseMode && !arFirstPersonMode && (
        <div className={`exercise-banner ${exercisePaused ? 'paused' : ''}`}>
          <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
            <span className={`status ${exercisePaused ? 'medium' : 'info'}`}>
              {exercisePaused ? 'TIME PAUSED — BATCH FAULT SETUP' : 'SIMULATION EXERCISE'}
            </span>
            <span className="mono muted" style={{ marginLeft: 'auto' }}>
              {exerciseWorkers.filter((w) => w.state === 'STANDBY').length}/{exerciseWorkers.length} at line
            </span>
          </div>
          <div className="exercise-banner-sub">
            {exercisePaused
              ? 'Time is frozen. Click multiple equipment items and inject faults (or assign workers in Alerts), then click Resume Time to dispatch all units together.'
              : 'Inject faults on components (or use Pause Time to batch multiple faults). Standby technicians walk out using right-hand traffic rules, repair with a live tool indicator, and return to the line.'}
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
      {exerciseMode &&
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

      {/* First-Person Field POV Frame + AR Red-Light / Green-Light Traffic Signal System */}
      {arFirstPersonMode && (
        <>
          <div className="fp-frame">
            <div className="vp-chip top-left mono">
              <span>First-Person AR POV · W/A/S/D Walk (Red Light Gates Forward Motion)</span>
            </div>
            <div className="fp-reticle" />
          </div>

          <div className={`ar-traffic-hud ${liveArSignal.light}`}>
            <div className="traffic-lights" aria-label="AR Corridor Traffic Signal">
              <span className={`traffic-lamp red ${liveArSignal.light === 'RED' ? 'on' : ''}`} />
              <span
                className={`traffic-lamp yellow ${liveArSignal.light === 'YELLOW' ? 'on' : ''}`}
              />
              <span
                className={`traffic-lamp green ${liveArSignal.light === 'GREEN' ? 'on' : ''}`}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontWeight: 700, fontSize: '11.5px' }}>
                {liveArSignal.headline}
              </div>
              <div style={{ fontSize: '11px', color: '#cbd5e1' }} className="truncate">
                {liveArSignal.detail}
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

      {/* On-Click Asset Callout Popover */}
      {clickedPopoverAsset && clickedScreenAnchor && clickedSt && (
        <div
          style={{
            left: clickedScreenAnchor.x,
            top: clickedScreenAnchor.y
          }}
          className="vp-popover"
        >
          <div className="vp-popover-head">
            <span className={`sdot ${clickedSt.cls}`} style={{ marginTop: '4px' }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row" style={{ gap: '6px' }}>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {clickedPopoverAsset.tag}
                </span>
                <span className="mono muted">{clickedPopoverAsset.asset_id}</span>
                <span className={`status ${clickedSt.cls}`} style={{ marginLeft: 'auto' }}>
                  {clickedSt.label} · {clickedPopoverAsset.health_score}%
                </span>
              </div>
              <div className="text-2 truncate" style={{ fontSize: '12px', marginTop: '2px' }}>
                {clickedPopoverAsset.service_description}
              </div>
              <div className="mono muted" style={{ fontSize: '11px', marginTop: '2px' }}>
                mesh {clickedScreenAnchor.meshIdx} ({clickedScreenAnchor.triCount}k tris) ·{' '}
                {clickedPopoverAsset.contourModel?.contourPointCount || 12} seam pts
              </div>
            </div>
            <button
              className="btn btn-sm btn-icon"
              onClick={() => {
                setClickedPopoverAssetId(null);
                setClickedScreenAnchor(null);
              }}
              aria-label="Close callout"
            >
              ✕
            </button>
          </div>

          <div className="vp-popover-body">
            <div className="metric-grid">
              <div className="metric">
                <div className="k">Pressure</div>
                <div className="v mono" style={{ fontSize: '13px' }}>
                  {clickedPopoverAsset.telemetry?.pressure_bar ?? 5.5}
                  <small>bar</small>
                </div>
              </div>
              <div className="metric">
                <div className="k">Vibration</div>
                <div className="v mono" style={{ fontSize: '13px' }}>
                  {clickedPopoverAsset.telemetry?.vibration_mms ?? 2.1}
                  <small>mm/s</small>
                </div>
              </div>
            </div>

            <div className="vp-popover-actions">
              <button className="btn btn-sm" onClick={handleFocusSelected}>
                Center Camera
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  if (onOpenArHud) onOpenArHud();
                }}
              >
                Verify ({clickedPopoverAsset.qr_id})
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  if (onQuickMutateTelemetry) {
                    onQuickMutateTelemetry(
                      clickedPopoverAsset.asset_id,
                      {
                        vibration_mms: 1.6,
                        bearing_temp_c: 54.0,
                        stiction_index: 0.12,
                        position_pct: clickedPopoverAsset.telemetry?.setpoint_pct || 64.0
                      },
                      'NORMAL_OPERATION'
                    );
                  }
                }}
              >
                Restore Nominal
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => {
                  if (onQuickMutateTelemetry) {
                    onQuickMutateTelemetry(
                      clickedPopoverAsset.asset_id,
                      {
                        vibration_mms: 7.8,
                        bearing_temp_c: 86.0,
                        stiction_index: 0.65
                      },
                      'CRITICAL_FAULT_INJECTED'
                    );
                  }
                }}
              >
                Inject Fault
              </button>
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

      {/* Top-right Viewport Camera Toolbar */}
      <div className="vp-toolbar">
        {onToggleExercisePaused && (
          <button
            className={exercisePaused ? 'on' : ''}
            onClick={() => onToggleExercisePaused(!exercisePaused)}
            title="Pause or resume simulation time to batch multiple faults"
          >
            {exercisePaused ? '▶ Resume Time' : '⏸ Pause Time'}
          </button>
        )}
        {onToggleExerciseMode && (
          <button
            className={exerciseMode ? 'on' : ''}
            onClick={() => onToggleExerciseMode(!exerciseMode)}
            title="Toggle Simulation Exercise Mode (Workers line up & repair injected faults)"
          >
            {exerciseMode ? 'Exercise Mode: ON' : 'Exercise Mode'}
          </button>
        )}
        {isWasdWalking && (
          <button
            className="on"
            onClick={() => {
              manualPosRef.current = null;
              setIsWasdWalking(false);
              if (onSimPlayingChange) onSimPlayingChange(true);
            }}
          >
            Resume Auto-Patrol
          </button>
        )}
        <button
          className={arFirstPersonMode ? 'on' : ''}
          onClick={() => onToggleArFirstPerson(!arFirstPersonMode)}
        >
          {arFirstPersonMode ? 'Exit 1st-Person AR' : '1st-Person AR POV'}
        </button>
        <button onClick={handleFocusSelected}>
          Focus {selectedAsset?.tag || 'Asset'}
        </button>
        <button onClick={handleResetCamera}>Reset View</button>
      </div>

      {/* Bottom-left Compact Legend */}
      <div className="vp-chip bottom-left">
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> Walk
        </span>
        <span>·</span>
        <span>Click equipment to inspect</span>
        {exerciseMode ? (
          <>
            <span>·</span>
            <span>Click worker + <kbd>Del</kbd> to remove</span>
          </>
        ) : (
          <>
            <span>·</span>
            <span>
              <span className="legend-swatch" style={{ background: '#d96b27' }} />
              AMR R1
            </span>
            {multiAgentEnabled && (
              <>
                <span>
                  <span className="legend-swatch" style={{ background: '#49a942' }} />
                  AMR R2
                </span>
                <span>
                  <span className="legend-swatch" style={{ background: '#1f6fb2' }} />
                  Operator H1
                </span>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
