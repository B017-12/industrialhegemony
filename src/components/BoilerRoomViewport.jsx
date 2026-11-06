import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { NAV_NODES, NAV_EDGES, samplePathAtProgress } from '../utils/pathfinding.js';
import { STRUCTURAL_BOILER_OBJECTS } from '../data/valmetDataset.js';

const HEALTH_COLORS = {
  attention_required: 0xef4444, // Red
  degraded: 0xf97316,           // Orange-Red
  watch: 0xf59e0b,              // Amber
  healthy: 0x10b981             // Emerald
};

const HEALTH_CSS = {
  attention_required: '#ef4444',
  degraded: '#f97316',
  watch: '#f59e0b',
  healthy: '#10b981'
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

  // 1. Smooth Epoxy Concrete Floor
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.65,
    metalness: 0.12
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 9.0), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1.045, 1.6);
  room.add(floor);

  // 2. Industrial Light-Grey Painted Concrete Walls (Back Wall + West/East Walls)
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.85,
    metalness: 0.08
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

  // 3. Overhead Galvanized HVAC & Steam Ductwork (matching semantic_extraction_demo_2.mp4 ceiling)
  const ductMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.65,
    roughness: 0.30
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

  // 4. Back-Wall Stacked White IBC Tote Wall & Blue Pipe Manifold Frame (from Equipment Room video!)
  const toteMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.35,
    metalness: 0.15
  });
  const cageMat = new THREE.LineBasicMaterial({ color: 0x64748b });

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

  // Blue Industrial Manifold Rack on East Wall (matching the blue rack in semantic_extraction_demo_2.mp4)
  const blueRackMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    metalness: 0.55,
    roughness: 0.3
  });
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.65, 0.16), blueRackMat);
  rackFrame.position.set(2.1, -0.15, 3.72);
  room.add(rackFrame);

  // Yellow Safety Conveyor / Guardrail in Mid-Bay
  const yellowMat = new THREE.MeshStandardMaterial({
    color: 0xeab308,
    metalness: 0.4,
    roughness: 0.3
  });
  const yellowRail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.38, 1.85), yellowMat);
  yellowRail.position.set(0.95, -0.82, 1.45);
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
    opacity: 0.52
  });
  const hitboxWire = new THREE.LineSegments(hitboxEdges, hitboxMat);
  hitboxWire.position.y = hy * 0.5;
  root.add(hitboxWire);

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const primaryMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: isHuman ? 0.2 : 0.65,
    roughness: 0.35
  });
  const darkJointMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.7,
    roughness: 0.3
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.9
  });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.18), primaryMat);
  torso.position.y = 0.76;
  bodyGroup.add(torso);

  const head = new THREE.Mesh(
    isHuman
      ? new THREE.SphereGeometry(0.12, 12, 12)
      : new THREE.BoxGeometry(0.20, 0.18, 0.20),
    primaryMat
  );
  head.position.y = 1.10;
  bodyGroup.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.05), visorMat);
  visor.position.set(0, 1.10, 0.10);
  bodyGroup.add(visor);

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.08, 0.52, 0);
  const leftLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.48, 0.10), darkJointMat);
  leftLegMesh.position.y = -0.24;
  leftLegPivot.add(leftLegMesh);
  bodyGroup.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.08, 0.52, 0);
  const rightLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.48, 0.10), darkJointMat);
  rightLegMesh.position.y = -0.24;
  rightLegPivot.add(rightLegMesh);
  bodyGroup.add(rightLegPivot);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.19, 0.94, 0);
  const leftArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.38, 0.08), primaryMat);
  leftArmMesh.position.y = -0.18;
  leftArmPivot.add(leftArmMesh);
  bodyGroup.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.19, 0.94, 0);
  const rightArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.38, 0.08), primaryMat);
  rightArmMesh.position.y = -0.18;
  rightArmPivot.add(rightArmMesh);
  bodyGroup.add(rightArmPivot);

  const radarGeo = new THREE.RingGeometry(0.95, 1.0, 36);
  radarGeo.rotateX(-Math.PI / 2);
  const radarMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.65
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
  onLoadStats
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
  const laserWaveMeshRef = useRef(null);
  const primaryRigRef = useRef(null);
  const secondaryRigsRef = useRef({});
  const assetMeshMapRef = useRef(new Map());

  // STRICT INTERACTION RULE:
  // Nothing pops up or shows object details until the user explicitly clicks/interacts with a 3D object!
  const [clickedPopoverAssetId, setClickedPopoverAssetId] = useState(null);
  const [clickedScreenAnchor, setClickedScreenAnchor] = useState(null);

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
    arFirstPersonMode
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
      arFirstPersonMode
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
    arFirstPersonMode
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
    scene.background = new THREE.Color(0x0b1120);
    scene.fog = new THREE.FogExp2(0x0b1120, 0.032);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      52,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(0.2, 2.3, -3.4);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.1, -0.25, 1.85);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxDistance = 16;
    controls.minDistance = 0.4;
    controls.update();
    controlsRef.current = controls;

    // Bright, realistic industrial lighting so solid 3D CAD meshes look crisp and clear
    const hemiLight = new THREE.HemisphereLight(0xf8fafc, 0x1e293b, 1.15);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.25);
    dirLight.position.set(4, 9, -4);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.55);
    fillLight.position.set(-5, 4, 5);
    scene.add(fillLight);

    // Subtle Floor Grid
    const gridHelper = new THREE.GridHelper(11.5, 23, 0x334155, 0x1e293b);
    gridHelper.position.set(0, -1.04, 1.6);
    scene.add(gridHelper);

    // Clean Industrial CAD Room Architecture (Replaces noisy white point-cloud dots when Semantic World >= 80%!)
    const cadRoomGroup = createCleanIndustrialRoomArchitecture();
    scene.add(cadRoomGroup);
    cadRoomGroupRef.current = cadRoomGroup;

    // Purple/Blue AI Semantic Extraction Laser Wave Plane
    const laserGroup = new THREE.Group();
    const laserPlaneGeo = new THREE.PlaneGeometry(11.5, 4.5);
    const laserPlaneMat = new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.30,
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

    scene.add(assetGroup);
    scene.add(structuralGroup);
    scene.add(pathGroup);
    scene.add(navGraphGroup);
    scene.add(fleetGroup);

    assetGroupRef.current = assetGroup;
    structuralGroupRef.current = structuralGroup;
    pathGroupRef.current = pathGroup;
    navGraphGroupRef.current = navGraphGroup;
    fleetGroupRef.current = fleetGroup;

    const primaryRig = createHumanoidRig(0xf97316, false, [0.58, 1.38, 0.58]);
    fleetGroup.add(primaryRig);
    primaryRigRef.current = primaryRig;

    const r2Rig = createHumanoidRig(0xa855f7, false, [0.58, 1.38, 0.58]);
    const h1Rig = createHumanoidRig(0x06b6d4, true, [0.52, 1.68, 0.48]);
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

    // Keyboard WASD / Arrow Keys Listener
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
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

      // 1. Check 30 Contoured 3D Assets FIRST
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

      // 3. Clicked on empty space -> hide the Popover Card so screen stays 100% clean!
      setClickedPopoverAssetId(null);
      setClickedScreenAnchor(null);
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

    const updateRigOnPath = (rig, points, progress, isMoving, now, proxRadius) => {
      if (!rig || !points || points.length === 0) return { position: [0, -1.02, 0], tangent: [0, 0, 1] };
      const sample = samplePathAtProgress(points, progress);
      rig.position.set(sample.position[0], sample.position[1], sample.position[2]);

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

      // WASD / Arrow Keys Manual Walking vs. Centerline Rail Patrol
      const keys = keysPressedRef.current;
      const anyWasdDown =
        keys.w || keys.s || keys.a || keys.d || keys.arrowup || keys.arrowdown || keys.arrowleft || keys.arrowright;

      let primarySample;

      if (manualPosRef.current) {
        const speed = 2.2 * dt;
        const turnSpeed = 2.3 * dt;
        if (keys.a || keys.arrowleft) manualPosRef.current.angle += turnSpeed;
        if (keys.d || keys.arrowright) manualPosRef.current.angle -= turnSpeed;

        let moveDir = 0;
        if (keys.w || keys.arrowup) moveDir = 1;
        if (keys.s || keys.arrowdown) moveDir = -1;

        if (moveDir !== 0) {
          const nx = manualPosRef.current.x + Math.sin(manualPosRef.current.angle) * speed * moveDir;
          const nz = manualPosRef.current.z + Math.cos(manualPosRef.current.angle) * speed * moveDir;
          manualPosRef.current.x = Math.max(-4.2, Math.min(4.2, nx));
          manualPosRef.current.z = Math.max(-1.2, Math.min(3.8, nz));
        }

        const rig = primaryRigRef.current;
        if (rig) {
          rig.position.set(manualPosRef.current.x, -1.02, manualPosRef.current.z);
          rig.rotation.y = manualPosRef.current.angle;
          rig.userData.currentAngle = manualPosRef.current.angle;

          const walkCycle = anyWasdDown ? Math.sin(now * 0.014) * 0.6 : 0;
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
      } else {
        const activePath = st.activeProfile === 'human' ? st.humanPath : st.robotPath;
        let currentProgress = st.simProgress;
        if (st.simPlaying && activePath?.points?.length > 1) {
          currentProgress = st.simProgress + dt * 0.15;
          if (currentProgress >= 1) {
            currentProgress = 0;
          }
          onSimProgressChange(currentProgress);
        }

        primarySample = updateRigOnPath(
          primaryRigRef.current,
          activePath?.points || [[0, -1.02, -0.2]],
          currentProgress,
          st.simPlaying,
          now,
          st.proximityRadius
        );
      }

      // Secondary Multi-Agent Fleet Rigs (R2, H1)
      const secRigs = secondaryRigsRef.current;
      if (secRigs.R2 && secRigs.H1) {
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
              st.simPlaying,
              now + 400,
              st.proximityRadius * 0.75
            );
          }
          if (h1Assign?.path?.points) {
            updateRigOnPath(
              secRigs.H1,
              h1Assign.path.points,
              (st.simProgress + 0.66) % 1.0,
              st.simPlaying,
              now + 800,
              st.proximityRadius * 0.75
            );
          }
        }
      }

      // First-Person AR Camera Mode: Position camera slightly behind & above the avatar so the robot body never blocks your view!
      if (st.arFirstPersonMode && primaryRigRef.current) {
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
          const semanticAlpha = revealedByLaser ? st.semanticBlend / 100 : 0.04;
          const baseBoxOpacity = isClickedOpen
            ? 0.42
            : isWithinRadius
            ? 0.18
            : 0.04;
          const baseEdgeOpacity = isClickedOpen ? 1.0 : isWithinRadius ? 0.90 : 0.55;

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

      // Project ONLY the currently clicked/interacted object's 3D anchor position!
      labelTick++;
      if (labelTick % 4 === 0 && container) {
        nearby.sort((a, b) => a.distanceToAvatar - b.distanceToAvatar);
        onNearbyAssetsChange(nearby);

        if (st.clickedPopoverAssetId) {
          const clickedAsset = st.assets.find((a) => a.asset_id === st.clickedPopoverAssetId);
          if (clickedAsset) {
            const width = container.clientWidth;
            const height = container.clientHeight;
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
        const col = assign.agent_id === 'R1' ? 0xf97316 : assign.agent_id === 'R2' ? 0xa855f7 : 0x06b6d4;
        buildTube(assign.path?.points, col, 0.04, 0.03 + idx * 0.015, 0.9, isZig);
      });
    } else if (showDualComparison) {
      buildTube(humanPath?.points, 0x06b6d4, 0.036, 0.06, activeProfile === 'human' ? 0.95 : 0.5, isZig);
      buildTube(robotPath?.points, 0xf97316, 0.044, 0.03, activeProfile === 'robot' ? 0.95 : 0.5, isZig);
    } else if (activeProfile === 'human') {
      buildTube(humanPath?.points, 0x06b6d4, 0.044, 0.04, 0.95, isZig);
    } else {
      buildTube(robotPath?.points, 0xf97316, 0.044, 0.04, 0.95, isZig);
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
      sphere.userData = { nodeId: node.id, label: node.label };
      navGraphGroup.add(sphere);

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

  const handleResetCamera = () => {
    if (arFirstPersonMode) onToggleArFirstPerson(false);
    manualPosRef.current = null;
    setIsWasdWalking(false);
    setClickedPopoverAssetId(null);
    setClickedScreenAnchor(null);
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(0.2, 2.3, -3.4);
    controlsRef.current.target.set(0.1, -0.25, 1.85);
    controlsRef.current.update();
  };

  const handleFocusSelected = () => {
    if (arFirstPersonMode) onToggleArFirstPerson(false);
    if (!cameraRef.current || !controlsRef.current || !selectedAsset) return;
    const [x, y, z] = selectedAsset.position;
    controlsRef.current.target.set(x, y, z);
    cameraRef.current.position.set(x * 0.5, y + 1.1, z - 2.1);
    controlsRef.current.update();
  };

  const clickedPopoverAsset = clickedPopoverAssetId
    ? assets.find((a) => a.asset_id === clickedPopoverAssetId)
    : null;

  return (
    <div className="relative w-full h-full select-none overflow-hidden bg-slate-950">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* First-Person Live AR Visor Overlay */}
      {arFirstPersonMode && (
        <div className="pointer-events-none absolute inset-0 z-20 border-4 border-emerald-400/40 flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <div className="px-3 py-1.5 rounded-lg bg-slate-950/85 border border-emerald-400/60 font-mono text-xs text-emerald-300 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>AR VISOR LIVE POV • PRESS W,A,S,D TO WALK FREELY</span>
            </div>
          </div>

          <div className="mx-auto my-auto w-44 h-44 rounded-2xl border border-dashed border-emerald-400/60 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full border-2 border-emerald-400" />
          </div>

          <div className="mx-auto px-4 py-2 rounded-xl bg-slate-950/90 border border-slate-700 font-mono text-xs text-slate-200">
            Use W/A/S/D keys to walk around • Click any 3D object to pop up its Object Details Card
          </div>
        </div>
      )}

      {/* STRICT ON-INTERACTION FLOATING CALLOUT + CONTROL CARD (Hidden until you click a 3D object!) */}
      {clickedPopoverAsset && clickedScreenAnchor && (
        <div
          style={{
            left: clickedScreenAnchor.x,
            top: clickedScreenAnchor.y
          }}
          className="pointer-events-auto absolute z-30 w-80 p-3.5 rounded-xl bg-slate-950/95 border-2 border-sky-400 shadow-2xl space-y-2.5"
        >
          {/* MovingAtoms-style Callout Header ("CV-003 | mesh 03 - 18.5k tris") */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: HEALTH_CSS[clickedPopoverAsset.health_status] }}
                />
                <span className="font-mono text-sm font-bold text-white">
                  {clickedPopoverAsset.tag} ({clickedPopoverAsset.asset_id})
                </span>
              </div>
              <div className="text-[10px] font-mono text-sky-300 mt-0.5">
                mesh {clickedScreenAnchor.meshIdx} - {clickedScreenAnchor.triCount}k tris • {clickedPopoverAsset.service_description}
              </div>
            </div>
            <button
              onClick={() => {
                setClickedPopoverAssetId(null);
                setClickedScreenAnchor(null);
              }}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300"
            >
              ✕
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono">
            <span
              className="px-2 py-0.5 rounded font-bold text-slate-950"
              style={{ backgroundColor: HEALTH_CSS[clickedPopoverAsset.health_status] }}
            >
              Health {clickedPopoverAsset.health_score}% ({clickedPopoverAsset.health_status.toUpperCase()})
            </span>
            <span className="text-slate-300">
              {clickedPopoverAsset.contourModel?.contourPointCount} Contour Pts + Planar Back
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-mono">
            <div>
              <span className="text-slate-400 block">Pressure</span>
              <span className="text-white font-bold">
                {clickedPopoverAsset.telemetry?.pressure_bar ?? 5.5} bar
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Vibration</span>
              <span className="text-orange-300 font-bold">
                {clickedPopoverAsset.telemetry?.vibration_mms ?? 2.1} mm/s
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Temp</span>
              <span className="text-sky-300 font-bold">
                {clickedPopoverAsset.telemetry?.bearing_temp_c ?? clickedPopoverAsset.telemetry?.temperature_c ?? 54}°C
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
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
              className="py-1.5 px-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-[11px]"
            >
              ✓ Repair / Calibrate
            </button>
            <button
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
              className="py-1.5 px-2 rounded-lg bg-red-500/25 hover:bg-red-500/40 border border-red-500/50 text-red-300 font-mono font-bold text-[11px]"
            >
              ⚡ Trigger Fault
            </button>
            <button
              onClick={handleFocusSelected}
              className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-[11px]"
            >
              🎥 Zoom To Object
            </button>
            <button
              onClick={() => {
                if (onOpenArHud) onOpenArHud();
              }}
              className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 font-mono text-[11px]"
            >
              📱 Scan QR ({clickedPopoverAsset.qr_id})
            </button>
          </div>
        </div>
      )}

      {loadingState && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm z-30">
          <div className="px-6 py-4 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-center">
            <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <div className="text-sm font-medium text-slate-200">{loadingState}</div>
          </div>
        </div>
      )}

      {/* Viewport Quick Camera Controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        {isWasdWalking && (
          <button
            onClick={() => {
              manualPosRef.current = null;
              setIsWasdWalking(false);
              if (onSimPlayingChange) onSimPlayingChange(true);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-mono text-xs font-bold shadow"
          >
            WASD Manual Walk Active (Click to Resume Auto-Rail)
          </button>
        )}
        <button
          onClick={() => onToggleArFirstPerson(!arFirstPersonMode)}
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold shadow transition ${
            arFirstPersonMode
              ? 'bg-emerald-500 text-slate-950 border-emerald-400'
              : 'bg-slate-900/90 hover:bg-slate-800 border-emerald-500/50 text-emerald-300'
          }`}
        >
          {arFirstPersonMode ? 'Exit AR First-Person POV' : 'Enter AR First-Person POV'}
        </button>
        <button
          onClick={handleFocusSelected}
          className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-sky-300 shadow"
        >
          Focus {selectedAsset?.tag || 'Asset'}
        </button>
        <button
          onClick={handleResetCamera}
          className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 shadow"
        >
          Reset Orbit
        </button>
      </div>

      {/* Bottom Interactive Game Controls Legend */}
      <div className="absolute bottom-3 left-3 z-20 px-3 py-2 rounded-lg bg-slate-900/90 backdrop-blur-md border border-slate-800 text-[11px] text-slate-300 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-1.5 font-mono text-emerald-300 font-semibold">
          <span>🎮 W, A, S, D to Walk</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-sky-300 font-semibold">
          <span>🖱️ Click any 3D object to pop up its Object Details Card</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 rounded bg-orange-500 inline-block" />
          <span>R1 Rail</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 rounded bg-purple-500 inline-block" />
          <span>R2 Rail</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 rounded bg-cyan-400 inline-block" />
          <span>H1 Human Rail</span>
        </div>
      </div>
    </div>
  );
}
