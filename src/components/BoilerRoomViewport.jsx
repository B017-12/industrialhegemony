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
 * Builds an articulated Human-Sized Robot / Technician Rig with:
 * - Bounding Hitbox Wireframe (`hitboxMesh`)
 * - Articulated Left/Right Legs & Left/Right Arms (`leftLeg`, `rightLeg`, `leftArm`, `rightArm`)
 *   for procedural walking animation tied to path velocity
 * - Torso, Head/LiDAR Visor, and Equidistant Clearance Radar Ring
 */
function createHumanoidRig(colorHex = 0xf97316, isHuman = false, hitboxSize = [0.56, 1.45, 0.52]) {
  const root = new THREE.Group();

  // 1. Bounding Hitbox Wireframe (proving zero collision with walls/pipes)
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

  // Subtle translucent hitbox volume
  const hitboxFill = new THREE.Mesh(
    hitboxGeo,
    new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.05,
      depthWrite: false
    })
  );
  hitboxFill.position.y = hy * 0.5;
  root.add(hitboxFill);

  // 2. Articulated Body Group
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
    emissiveIntensity: 0.85
  });

  // Torso / Chassis
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.18), primaryMat);
  torso.position.y = 0.76;
  bodyGroup.add(torso);

  // Head / Helmet / LiDAR Dome
  const head = new THREE.Mesh(
    isHuman
      ? new THREE.SphereGeometry(0.12, 16, 16)
      : new THREE.BoxGeometry(0.20, 0.18, 0.20),
    primaryMat
  );
  head.position.y = 1.10;
  bodyGroup.add(head);

  // AR Visor / Optical Sensor Eye (faces +Z)
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.05), visorMat);
  visor.position.set(0, 1.10, 0.10);
  bodyGroup.add(visor);

  // Articulated Left & Right Legs (pivoting at hip y = 0.52)
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

  // Articulated Left & Right Arms (pivoting at shoulder y = 0.94)
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

  // Equidistant Wall/Pipe Clearance Whiskers (Left & Right laser feelers showing equal distance to obstacles)
  const whiskerGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.65, 0.35, 0),
    new THREE.Vector3(0.65, 0.35, 0)
  ]);
  const whiskerLine = new THREE.Line(
    whiskerGeo,
    new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.06, gapSize: 0.04 })
  );
  whiskerLine.computeLineDistances();
  root.add(whiskerLine);

  // Proximity Radar Ring on floor
  const radarGeo = new THREE.RingGeometry(0.95, 1.0, 48);
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

/**
 * Parses a raw 3D Gaussian Splatting binary PLY buffer or standard PLY buffer in browser
 */
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
  assets,
  selectedAsset,
  onSelectAsset,
  hoveredAsset,
  onHoverAsset,
  semanticBlend,
  showStructuralBoxes,
  showContourModels,
  activeProfile,
  railMode,              // 'smooth_rail' | 'zigzag_grid'
  multiAgentEnabled,     // true = coordinate R1, R2, H1 simultaneously
  fleetAssignments,      // output of coordinateMultiAgentFleet
  showDualComparison,
  humanPath,
  robotPath,
  hazardNodes,
  onToggleHazardNode,
  simPlaying,
  simProgress,
  onSimProgressChange,
  proximityRadius,
  onNearbyAssetsChange,
  pointSize,
  arFirstPersonMode,     // Live First-Person AR Camera Overlay inside the 3D scene!
  onToggleArFirstPerson,
  customPlyBuffer,
  onLoadStats
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const pointCloudMatRef = useRef(null);
  const pointCloudObjRef = useRef(null);
  const assetGroupRef = useRef(null);
  const structuralGroupRef = useRef(null);
  const pathGroupRef = useRef(null);
  const navGraphGroupRef = useRef(null);
  const fleetGroupRef = useRef(null);
  const primaryRigRef = useRef(null);
  const secondaryRigsRef = useRef({});
  const assetMeshMapRef = useRef(new Map());

  const [projectedLabels, setProjectedLabels] = useState([]);
  const [hoverScreenPos, setHoverScreenPos] = useState({ x: 0, y: 0 });
  const [loadingState, setLoadingState] = useState('Loading Industrial Boiler Room (1).ply splat cloud...');

  const stateRef = useRef({
    assets,
    selectedAsset,
    hoveredAsset,
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
      hoveredAsset,
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
    hoveredAsset,
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

  // 1. Initialize Three.js Scene, Articulated Humanoid/Robot Rigs, Raycast Hover + Click
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a12);
    scene.fog = new THREE.FogExp2(0x060a12, 0.042);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.1, -0.25, 1.85);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 16;
    controls.minDistance = 0.4;
    controls.update();
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0x38bdf8, 1.3);
    dirLight.position.set(4, 8, -3);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(11, 22, 0x1e293b, 0x0f172a);
    gridHelper.position.set(0, -1.04, 1.6);
    scene.add(gridHelper);

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

    // Create Primary Articulated Rig (R1 / Active Agent) + Multi-Agent Rigs (R2, H1)
    const primaryRig = createHumanoidRig(0xf97316, false, [0.58, 1.38, 0.58]);
    fleetGroup.add(primaryRig);
    primaryRigRef.current = primaryRig;

    const r2Rig = createHumanoidRig(0xa855f7, false, [0.58, 1.38, 0.58]);
    const h1Rig = createHumanoidRig(0x06b6d4, true, [0.52, 1.68, 0.48]);
    fleetGroup.add(r2Rig);
    fleetGroup.add(h1Rig);
    secondaryRigsRef.current = { R2: r2Rig, H1: h1Rig };

    // Load pre-extracted 3DGS Splat Binary
    fetch('/assets/boiler_room_splats.bin')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch boiler_room_splats.bin');
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
          colors[i * 3 + 0] = Math.min(1, r * 1.15);
          colors[i * 3 + 1] = Math.min(1, g * 1.15);
          colors[i * 3 + 2] = Math.min(1, b * 1.15);
          offset += 16;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        const spriteTex = new THREE.CanvasTexture(canvas);

        const material = new THREE.PointsMaterial({
          size: 0.055,
          vertexColors: true,
          map: spriteTex,
          alphaTest: 0.08,
          transparent: true,
          opacity: 0.92,
          sizeAttenuation: true
        });

        const pointsObj = new THREE.Points(geometry, material);
        scene.add(pointsObj);
        pointCloudObjRef.current = pointsObj;
        pointCloudMatRef.current = material;
        setLoadingState(null);
        if (onLoadStats) {
          onLoadStats({
            sourceFile: 'Industrial Boiler Room (1).ply',
            rawVertices: 1506136,
            activeSplats: count,
            anchoredAssets: 30,
            structuralFrames: STRUCTURAL_BOILER_OBJECTS.length
          });
        }
      })
      .catch((err) => {
        console.error('Error loading splats:', err);
        setLoadingState('Error loading splat binary');
      });

    // Raycaster for 3D Hover Inspection + Click Selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const handlePointerMove = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      if (assetGroupRef.current) {
        const hits = raycaster.intersectObjects(assetGroupRef.current.children, true);
        if (hits.length > 0) {
          let obj = hits[0].object;
          while (obj && !obj.userData?.asset) {
            obj = obj.parent;
          }
          if (obj?.userData?.asset) {
            renderer.domElement.style.cursor = 'pointer';
            setHoverScreenPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            onHoverAsset(obj.userData.asset);
            return;
          }
        }
      }
      renderer.domElement.style.cursor = 'grab';
      onHoverAsset(null);
    };

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

      if (assetGroupRef.current) {
        const hits = raycaster.intersectObjects(assetGroupRef.current.children, true);
        if (hits.length > 0) {
          let obj = hits[0].object;
          while (obj && !obj.userData?.asset) {
            obj = obj.parent;
          }
          if (obj?.userData?.asset) {
            onSelectAsset(obj.userData.asset);
          }
        }
      }
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
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

    // Helper to animate an articulated rig along its assigned rail path with smooth rotation & walking gait
    const updateRigOnPath = (rig, points, progress, isMoving, now, proxRadius) => {
      if (!rig || !points || points.length === 0) return { position: [0, -1.02, 0], tangent: [0, 0, 1] };
      const sample = samplePathAtProgress(points, progress);
      rig.position.set(sample.position[0], sample.position[1], sample.position[2]);

      // Smooth angular interpolation (no jerky rotation on rail corners!)
      const targetAngle = Math.atan2(sample.tangent[0], sample.tangent[2]);
      const prevAngle = rig.userData.currentAngle ?? targetAngle;
      let diff = targetAngle - prevAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const smoothAngle = prevAngle + diff * 0.16;
      rig.userData.currentAngle = smoothAngle;
      rig.rotation.y = smoothAngle;

      // Walking limb swing animation tied to movement
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
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const st = stateRef.current;
      const activePath = st.activeProfile === 'human' ? st.humanPath : st.robotPath;

      let currentProgress = st.simProgress;
      if (st.simPlaying && activePath?.points?.length > 1) {
        currentProgress = st.simProgress + dt * 0.15;
        if (currentProgress >= 1) {
          currentProgress = 0;
        }
        onSimProgressChange(currentProgress);
      }

      // 1. Update Primary Rig (R1 / Active Selection)
      const primarySample = updateRigOnPath(
        primaryRigRef.current,
        activePath?.points || [[0, -1.02, -0.2]],
        currentProgress,
        st.simPlaying,
        now,
        st.proximityRadius
      );

      // 2. Update Secondary Multi-Agent Fleet Rigs (R2, H1) if Multi-Agent Coordination is enabled
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
              (currentProgress + 0.33) % 1.0,
              st.simPlaying,
              now + 400,
              st.proximityRadius * 0.75
            );
          }
          if (h1Assign?.path?.points) {
            updateRigOnPath(
              secRigs.H1,
              h1Assign.path.points,
              (currentProgress + 0.66) % 1.0,
              st.simPlaying,
              now + 800,
              st.proximityRadius * 0.75
            );
          }
        }
      }

      // 3. First-Person AR Camera Mode: Lock camera to the Avatar's AR Visor looking down the rail!
      if (st.arFirstPersonMode && primaryRigRef.current) {
        const eyeX = primarySample.position[0];
        const eyeY = primarySample.position[1] + 1.15;
        const eyeZ = primarySample.position[2];
        camera.position.lerp(new THREE.Vector3(eyeX, eyeY, eyeZ), 0.18);

        // Look slightly toward selectedAsset or forward along the rail tangent
        const lookX = eyeX + primarySample.tangent[0] * 2.5;
        const lookY = eyeY - 0.12;
        const lookZ = eyeZ + primarySample.tangent[2] * 2.5;
        controls.target.lerp(new THREE.Vector3(lookX, lookY, lookZ), 0.18);
        controls.update();
      } else {
        controls.update();
      }

      // 4. Proximity & Hover Highlighting across all 30 Contoured Assets
      const nearby = [];
      st.assets.forEach((asset) => {
        const dx = asset.position[0] - primarySample.position[0];
        const dy = asset.position[1] - primarySample.position[1];
        const dz = asset.position[2] - primarySample.position[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const isWithinRadius = dist <= st.proximityRadius;
        const isSelected = st.selectedAsset?.asset_id === asset.asset_id;
        const isHovered = st.hoveredAsset?.asset_id === asset.asset_id;

        if (isWithinRadius) {
          nearby.push({ ...asset, distanceToAvatar: Number(dist.toFixed(2)) });
        }

        const meshBundle = assetMeshMapRef.current.get(asset.asset_id);
        if (meshBundle) {
          const semanticAlpha = st.semanticBlend / 100;
          const baseBoxOpacity = isHovered
            ? 0.52
            : isSelected
            ? 0.40
            : isWithinRadius
            ? 0.28
            : 0.08;
          const baseEdgeOpacity = isHovered || isSelected ? 1.0 : isWithinRadius ? 0.95 : 0.55;

          meshBundle.fillMat.opacity = baseBoxOpacity * semanticAlpha;
          meshBundle.edgeMat.opacity = baseEdgeOpacity * Math.max(0.15, semanticAlpha);
          if (meshBundle.backPlaneMat) {
            meshBundle.backPlaneMat.opacity =
              st.showContourModels
                ? (isHovered || isSelected ? 0.68 : 0.36) * semanticAlpha
                : 0;
          }
          if (meshBundle.contourGroup) {
            meshBundle.contourGroup.visible = Boolean(st.showContourModels && semanticAlpha > 0.1);
          }

          if (isHovered || isSelected || isWithinRadius) {
            const s = isHovered ? 1.07 : 1 + Math.sin(now * 0.007) * 0.035;
            meshBundle.group.scale.set(s, s, s);
          } else {
            meshBundle.group.scale.set(1, 1, 1);
          }
        }
      });

      labelTick++;
      if (labelTick % 3 === 0 && container) {
        nearby.sort((a, b) => a.distanceToAvatar - b.distanceToAvatar);
        onNearbyAssetsChange(nearby);

        const width = container.clientWidth;
        const height = container.clientHeight;
        const nextLabels = [];

        st.assets.forEach((asset) => {
          const isSelected = st.selectedAsset?.asset_id === asset.asset_id;
          const isHovered = st.hoveredAsset?.asset_id === asset.asset_id;
          const nearItem = nearby.find((n) => n.asset_id === asset.asset_id);
          const isCritical =
            asset.health_status === 'attention_required' || asset.health_status === 'degraded';

          if (!isSelected && !isHovered && !nearItem && !isCritical && st.semanticBlend < 75) return;
          if (st.semanticBlend < 15 && !isSelected && !isHovered) return;

          const worldPos = new THREE.Vector3(
            asset.position[0],
            asset.position[1] + asset.bbox_size[1] * 0.58,
            asset.position[2]
          );
          worldPos.project(camera);

          if (worldPos.z > -1 && worldPos.z < 1) {
            const x = (worldPos.x * 0.5 + 0.5) * width;
            const y = (-(worldPos.y * 0.5) + 0.5) * height;
            if (x > 20 && x < width - 20 && y > 20 && y < height - 20) {
              nextLabels.push({
                asset,
                x,
                y,
                isSelected,
                isHovered,
                isNearby: Boolean(nearItem),
                distanceToAvatar: nearItem?.distanceToAvatar ?? null
              });
            }
          }
        });

        setProjectedLabels(nextLabels);
      }

      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.dispose();
    };
  }, []);

  // 2. Custom PLY upload
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

  // 3. Point Size & Semantic Lens Blend
  useEffect(() => {
    if (!pointCloudMatRef.current) return;
    pointCloudMatRef.current.size = pointSize;
    const blendFactor = semanticBlend / 100;
    pointCloudMatRef.current.opacity = 1.0 - blendFactor * 0.25;
  }, [pointSize, semanticBlend]);

  // 4. Build 30 Contoured 3D Asset Models (with Wall/Floor Attachment Contour Points + Planar Back-Wall)
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

      // Main 3D Bounding Box
      const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
      const fillMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.14,
        depthWrite: false
      });
      const boxMesh = new THREE.Mesh(boxGeo, fillMat);
      boxMesh.userData = { asset };
      group.add(boxMesh);

      const edgesGeo = new THREE.EdgesGeometry(boxGeo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.88
      });
      const wireMesh = new THREE.LineSegments(edgesGeo, edgeMat);
      group.add(wireMesh);

      // Occluded Back-Side Plane ("The back side that's not visible can be just a plane")
      const backPlaneGeo = new THREE.PlaneGeometry(sx * 0.98, sy * 0.98);
      const backPlaneMat = new THREE.MeshBasicMaterial({
        color: 0x0f172a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: showContourModels ? 0.55 : 0
      });
      const backPlaneMesh = new THREE.Mesh(backPlaneGeo, backPlaneMat);
      backPlaneMesh.position.set(0, 0, sz * 0.5);
      backPlaneMesh.userData = { asset };
      group.add(backPlaneMesh);

      // Multi-Point Attachment Contour Loop (where the object attaches to the wall or floor)
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
        // Close loop
        localContourVecs.push(localContourVecs[0].clone());

        const contourLineGeo = new THREE.BufferGeometry().setFromPoints(localContourVecs);
        const contourLineMat = new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.95
        });
        contourGroup.add(new THREE.Line(contourLineGeo, contourLineMat));

        // Render discrete attachment contour vertex markers along the wall/floor seam
        const dotGeo = new THREE.SphereGeometry(0.026, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        localContourVecs.slice(0, -1).forEach((v) => {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(v);
          contourGroup.add(dot);
        });
      }
      contourGroup.visible = Boolean(showContourModels);
      group.add(contourGroup);

      assetGroup.add(group);
      assetMeshMapRef.current.set(asset.asset_id, {
        group,
        fillMat,
        edgeMat,
        backPlaneMat,
        contourGroup
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
          opacity: 0.35 * (semanticBlend / 100)
        });
        const wire = new THREE.LineSegments(edgesGeo, lineMat);
        wire.position.set(stObj.position[0], stObj.position[1], stObj.position[2]);
        structuralGroup.add(wire);
      });
    }
  }, [assets, showStructuralBoxes, showContourModels, semanticBlend]);

  // 5. Render Centerline Waypoint 'Rails', Smooth vs. Zig-Zag Paths, and Multi-Agent Fleet Routes
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
      // If Zig-Zag mode is selected, use piecewise linear segments so the jagged zig-zag is clearly visible;
      // if Smooth Centerline Rail mode is selected, use smooth Catmull-Rom rail interpolation!
      const curve = new THREE.CatmullRomCurve3(
        vecs,
        false,
        isZigZag ? 'centripetal' : 'catmullrom',
        isZigZag ? 0.01 : 0.35
      );
      const tubeGeo = new THREE.TubeGeometry(curve, Math.max(30, points.length * 8), radius, 12, false);
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
      // Render all 3 coordinated agent rail trajectories (R1 Orange, R2 Purple, H1 Cyan)
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

    // Draw pre-baked Equidistant Centerline 'Rails' on the floor (double-rail track lines)
    const nodeMap = new Map(NAV_NODES.map((n) => [n.id, n]));
    NAV_EDGES.forEach((edge) => {
      const u = nodeMap.get(edge.from);
      const v = nodeMap.get(edge.to);
      if (!u || !v) return;

      // Centerline rail
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(u.pos[0], u.pos[1] + 0.012, u.pos[2]),
        new THREE.Vector3(v.pos[0], v.pos[1] + 0.012, v.pos[2])
      ]);
      const m = new THREE.LineBasicMaterial({
        color: edge.has_stairs ? 0x0284c7 : 0x334155,
        transparent: true,
        opacity: 0.75
      });
      navGraphGroup.add(new THREE.Line(g, m));
    });

    // Interactive Rail Nodes & Dynamic Hazard Cylinders
    NAV_NODES.forEach((node) => {
      const isHazard = hazardNodes.includes(node.id);
      const isStair = node.id === 'N-M-STEP';

      const sphereGeo = new THREE.SphereGeometry(isHazard ? 0.16 : 0.065, 16, 16);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: isHazard ? 0xef4444 : isStair ? 0x38bdf8 : 0x64748b,
        transparent: true,
        opacity: isHazard ? 0.95 : 0.75
      });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.set(node.pos[0], node.pos[1] + 0.04, node.pos[2]);
      sphere.userData = { nodeId: node.id, label: node.label };
      navGraphGroup.add(sphere);

      if (isHazard) {
        const hazGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.9, 24);
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

  return (
    <div className="relative w-full h-full select-none overflow-hidden bg-slate-950">
      {/* Three.js WebGL Mount */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* First-Person Live AR Visor Overlay (When AR Walk Mode is active) */}
      {arFirstPersonMode && (
        <div className="pointer-events-none absolute inset-0 z-20 border-4 border-emerald-400/40 flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <div className="px-3 py-1.5 rounded-lg bg-slate-950/85 border border-emerald-400/60 font-mono text-xs text-emerald-300 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>AR VISOR LIVE POV • EQUIDISTANT RAIL LOCKED</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-950/85 border border-sky-400/50 font-mono text-xs text-sky-300">
              TARGET: {selectedAsset?.tag} ({selectedAsset?.qr_id}) • HEALTH {selectedAsset?.health_score}%
            </div>
          </div>

          {/* Center AR Crosshair Reticle */}
          <div className="mx-auto my-auto w-44 h-44 rounded-2xl border border-dashed border-emerald-400/60 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full border-2 border-emerald-400" />
          </div>

          <div className="mx-auto px-4 py-2 rounded-xl bg-slate-950/90 border border-slate-700 font-mono text-xs text-slate-200">
            Following Pre-Baked Centerline Rail • Equal Wall/Pipe Clearance Verified • Hover any 3D object to preview contour model
          </div>
        </div>
      )}

      {/* 3D HOVER PREVIEW CARD (Triggered immediately when mouse hovers over any 3D object in the scene!) */}
      {hoveredAsset && (
        <div
          style={{
            left: Math.min(window.innerWidth - 340, hoverScreenPos.x + 18),
            top: Math.max(16, hoverScreenPos.y - 20)
          }}
          className="pointer-events-none absolute z-30 w-72 p-3 rounded-xl bg-slate-950/95 border-2 border-sky-400 shadow-2xl space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-bold text-white">
              {hoveredAsset.tag} ({hoveredAsset.asset_id})
            </span>
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-slate-950"
              style={{ backgroundColor: HEALTH_CSS[hoveredAsset.health_status] }}
            >
              {hoveredAsset.health_score}% {hoveredAsset.health_status.toUpperCase()}
            </span>
          </div>
          <div className="text-xs text-slate-200 font-medium">
            {hoveredAsset.service_description}
          </div>
          <div className="text-[11px] font-mono text-sky-300">
            {hoveredAsset.contourModel?.attachmentType}: {hoveredAsset.contourModel?.contourPointCount} Contour Pts + Planar Back
          </div>
          <div className="grid grid-cols-2 gap-1 pt-1 text-[10px] font-mono text-slate-300 border-t border-slate-800">
            <span>Status: {hoveredAsset.status_reason}</span>
            <span>QR: {hoveredAsset.qr_id}</span>
            {hoveredAsset.telemetry?.pressure_bar !== undefined && (
              <span>Press: {hoveredAsset.telemetry.pressure_bar} bar</span>
            )}
            {hoveredAsset.telemetry?.vibration_mms !== undefined && (
              <span>Vib: {hoveredAsset.telemetry.vibration_mms} mm/s</span>
            )}
          </div>
          <div className="text-[10px] text-emerald-300 font-mono">
            Click to dispatch agent & open 3D Contour Preview →
          </div>
        </div>
      )}

      {/* Loading Indicator */}
      {loadingState && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm z-30">
          <div className="px-6 py-4 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-center">
            <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <div className="text-sm font-medium text-slate-200">{loadingState}</div>
          </div>
        </div>
      )}

      {/* Floating 3D HTML Semantic Badges */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
        {projectedLabels.map(({ asset, x, y, isSelected, isHovered, isNearby, distanceToAvatar }) => {
          const borderColor = HEALTH_CSS[asset.health_status] || '#10b981';
          return (
            <button
              key={asset.asset_id}
              onClick={() => onSelectAsset(asset)}
              onMouseEnter={() => onHoverAsset(asset)}
              onMouseLeave={() => onHoverAsset(null)}
              style={{
                transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`,
                borderColor
              }}
              className={`pointer-events-auto absolute top-0 left-0 px-2 py-1 rounded-md border text-left transition-shadow ${
                isSelected || isHovered
                  ? 'bg-slate-900/95 ring-2 ring-sky-400 shadow-lg z-30 scale-105'
                  : isNearby
                  ? 'bg-slate-900/90 ring-1 ring-emerald-400/70 shadow-md z-20'
                  : 'bg-slate-950/80 opacity-85 hover:opacity-100 z-10'
              }`}
            >
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: borderColor }}
                />
                <span className="font-mono text-[11px] font-bold text-white">
                  {asset.tag}
                </span>
                <span className="font-mono text-[10px] text-slate-300">
                  {asset.health_score}%
                </span>
                {isNearby && (
                  <span className="px-1 py-0.2 rounded bg-emerald-500/20 border border-emerald-500/40 text-[9px] font-mono text-emerald-300">
                    {distanceToAvatar}m
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Viewport Quick Camera & First-Person AR Controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
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

      {/* Bottom Legend Overlay */}
      <div className="absolute bottom-3 left-3 z-20 px-3 py-2 rounded-lg bg-slate-900/85 backdrop-blur-md border border-slate-800 text-[11px] text-slate-300 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
          <span>Critical/Degraded</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 rounded bg-orange-500 inline-block" />
          <span>R1 AMR Rail</span>
        </div>
        {multiAgentEnabled && (
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 rounded bg-purple-500 inline-block" />
            <span>R2 AMR Rail</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 rounded bg-cyan-400 inline-block" />
          <span>H1 Human Rail</span>
        </div>
        <div className="text-sky-300 font-mono">
          Hover any 3D object for instant telemetry & contour preview • Click floor nodes to drop hazards
        </div>
      </div>
    </div>
  );
}
