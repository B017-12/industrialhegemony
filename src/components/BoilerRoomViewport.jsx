import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { NAV_NODES, NAV_EDGES, samplePathAtProgress } from '../utils/pathfinding';
import { STRUCTURAL_BOILER_OBJECTS } from '../data/valmetDataset';

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
 * Parses a raw 3D Gaussian Splatting binary PLY buffer (like "Industrial Boiler Room (1).ply")
 * or standard vertex-colored PLY buffer directly in the browser!
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

  // Check if this is a 3DGS PLY file (e.g., 59 float properties = 236 bytes per vertex with f_dc_0..2)
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

      // Convert 3DGS camera space (X right, Y down, Z forward) to Three.js (X right, Y up, Z out)
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

  // Fallback to standard Three.js PLYLoader
  const loader = new PLYLoader();
  const geometry = loader.parse(arrayBuffer);
  return { geometry, count: geometry.attributes.position.count };
}

export default function BoilerRoomViewport({
  assets,
  selectedAsset,
  onSelectAsset,
  semanticBlend,       // 0 = Raw Point Cloud Scan, 100 = Full Semantic World
  showStructuralBoxes, // Toggle structural/environmental 3D boxes
  activeProfile,       // 'robot' | 'human'
  showDualComparison,  // Show both Cyan (Human) and Orange (Robot) paths simultaneously
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
  const avatarGroupRef = useRef(null);
  const radarRingRef = useRef(null);
  const assetMeshMapRef = useRef(new Map());

  const [projectedLabels, setProjectedLabels] = useState([]);
  const [loadingState, setLoadingState] = useState('Loading Industrial Boiler Room (1).ply splat cloud...');

  // Keep latest callbacks/props in refs for animation loop access
  const stateRef = useRef({
    assets,
    selectedAsset,
    semanticBlend,
    showStructuralBoxes,
    activeProfile,
    showDualComparison,
    humanPath,
    robotPath,
    hazardNodes,
    simPlaying,
    simProgress,
    proximityRadius
  });

  useEffect(() => {
    stateRef.current = {
      assets,
      selectedAsset,
      semanticBlend,
      showStructuralBoxes,
      activeProfile,
      showDualComparison,
      humanPath,
      robotPath,
      hazardNodes,
      simPlaying,
      simProgress,
      proximityRadius
    };
  }, [
    assets,
    selectedAsset,
    semanticBlend,
    showStructuralBoxes,
    activeProfile,
    showDualComparison,
    humanPath,
    robotPath,
    hazardNodes,
    simPlaying,
    simProgress,
    proximityRadius
  ]);

  // 1. Initialize Three.js Scene, Camera, Renderer, Controls, and Load Boiler Room PLY Binary
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a12);
    scene.fog = new THREE.FogExp2(0x060a12, 0.045);
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
    controls.minDistance = 0.5;
    controls.update();
    controlsRef.current = controls;

    // Subtle industrial lighting for 3D semantic meshes & robot avatar
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
    dirLight.position.set(4, 8, -3);
    scene.add(dirLight);

    // Walkable Floor Grid aligned with PLY floor height (Y = -1.03m)
    const gridHelper = new THREE.GridHelper(11, 22, 0x1e293b, 0x0f172a);
    gridHelper.position.set(0, -1.04, 1.6);
    scene.add(gridHelper);

    // Groups
    const assetGroup = new THREE.Group();
    const structuralGroup = new THREE.Group();
    const pathGroup = new THREE.Group();
    const navGraphGroup = new THREE.Group();
    const avatarGroup = new THREE.Group();

    scene.add(assetGroup);
    scene.add(structuralGroup);
    scene.add(pathGroup);
    scene.add(navGraphGroup);
    scene.add(avatarGroup);

    assetGroupRef.current = assetGroup;
    structuralGroupRef.current = structuralGroup;
    pathGroupRef.current = pathGroup;
    navGraphGroupRef.current = navGraphGroup;
    avatarGroupRef.current = avatarGroup;

    // Build Autonomous Mobile Robot (AMR) / Technician Avatar + Proximity Radar Ring
    const robotBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.28, 20),
      new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.5, roughness: 0.3 })
    );
    robotBody.position.y = 0.16;
    avatarGroup.add(robotBody);

    const lidarTurret = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.14, 16),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.6 })
    );
    lidarTurret.position.y = 0.36;
    avatarGroup.add(lidarTurret);

    // Heading arrow cone on avatar
    const headingCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.24, 12),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    headingCone.rotation.x = Math.PI / 2;
    headingCone.position.set(0, 0.25, 0.28);
    avatarGroup.add(headingCone);

    // Proximity Radar Ring on floor around avatar
    const radarGeo = new THREE.RingGeometry(0.95, 1.0, 48);
    radarGeo.rotateX(-Math.PI / 2);
    const radarMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65
    });
    const radarRing = new THREE.Mesh(radarGeo, radarMat);
    radarRing.position.y = 0.02;
    avatarGroup.add(radarRing);

    const radarFillGeo = new THREE.CircleGeometry(1.0, 48);
    radarFillGeo.rotateX(-Math.PI / 2);
    const radarFillMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.10
    });
    const radarFill = new THREE.Mesh(radarFillGeo, radarFillMat);
    radarFill.position.y = 0.01;
    radarRing.add(radarFill);
    radarRingRef.current = radarRing;

    // Load pre-extracted 3DGS Splat Binary from "Industrial Boiler Room (1).ply"
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

          // Boost contrast & warmth slightly for crisp industrial visibility
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

        // Create soft circular Gaussian splat sprite texture
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

    // Raycaster for clicking 3D asset bounding boxes or floor hazard nodes
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const handlePointerDown = (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e) => {
      const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moveDist > 6) return; // Ignore camera orbit drags

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // Check floor waypoint nodes first if Shift key held or clicked directly on a waypoint sphere
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

      // Check 30 Valmet Semantic Asset 3D Bounding Boxes
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

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    // Resize listener
    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Animation & Proximity Radar Loop
    let animId;
    let lastTime = performance.now();
    let labelTick = 0;

    const animate = (now) => {
      animId = requestAnimationFrame(animate);
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      controls.update();

      const st = stateRef.current;
      const activePath = st.activeProfile === 'human' ? st.humanPath : st.robotPath;

      // Advance avatar along collision-free path
      let currentProgress = st.simProgress;
      if (st.simPlaying && activePath?.points?.length > 1) {
        currentProgress = st.simProgress + dt * 0.16;
        if (currentProgress >= 1) {
          currentProgress = 0;
        }
        onSimProgressChange(currentProgress);
      }

      // Position Avatar & compute Proximity-Based Asset Highlighting
      const sample = samplePathAtProgress(activePath?.points || [[0, -1.02, -0.2]], currentProgress);
      if (avatarGroupRef.current) {
        avatarGroupRef.current.position.set(
          sample.position[0],
          sample.position[1],
          sample.position[2]
        );
        const angle = Math.atan2(sample.tangent[0], sample.tangent[2]);
        avatarGroupRef.current.rotation.y = angle;
      }

      if (radarRingRef.current) {
        const pulse = 1 + Math.sin(now * 0.005) * 0.04;
        radarRingRef.current.scale.set(
          st.proximityRadius * pulse,
          1,
          st.proximityRadius * pulse
        );
      }

      // Check which of the 30 Valmet assets fall inside the Avatar's Proximity Radius
      const nearby = [];
      st.assets.forEach((asset) => {
        const dx = asset.position[0] - sample.position[0];
        const dy = asset.position[1] - sample.position[1];
        const dz = asset.position[2] - sample.position[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const isWithinRadius = dist <= st.proximityRadius;
        const isSelected = st.selectedAsset?.asset_id === asset.asset_id;

        if (isWithinRadius) {
          nearby.push({ ...asset, distanceToAvatar: Number(dist.toFixed(2)) });
        }

        // Dynamically pulse 3D bounding box opacity & scale when highlighted or in proximity
        const meshBundle = assetMeshMapRef.current.get(asset.asset_id);
        if (meshBundle) {
          const semanticAlpha = st.semanticBlend / 100;
          const baseBoxOpacity = isSelected ? 0.42 : isWithinRadius ? 0.30 : 0.09;
          const baseEdgeOpacity = isSelected ? 1.0 : isWithinRadius ? 0.95 : 0.55;

          meshBundle.fillMat.opacity = baseBoxOpacity * semanticAlpha;
          meshBundle.edgeMat.opacity = baseEdgeOpacity * Math.max(0.15, semanticAlpha);

          if (isSelected || isWithinRadius) {
            const s = 1 + Math.sin(now * 0.007) * 0.035;
            meshBundle.group.scale.set(s, s, s);
          } else {
            meshBundle.group.scale.set(1, 1, 1);
          }
        }
      });

      // Project 2D HUD floating coordinates every 3 frames for smooth performance
      labelTick++;
      if (labelTick % 3 === 0 && container) {
        nearby.sort((a, b) => a.distanceToAvatar - b.distanceToAvatar);
        onNearbyAssetsChange(nearby);

        const width = container.clientWidth;
        const height = container.clientHeight;
        const nextLabels = [];

        st.assets.forEach((asset) => {
          const isSelected = st.selectedAsset?.asset_id === asset.asset_id;
          const nearItem = nearby.find((n) => n.asset_id === asset.asset_id);
          const isCritical =
            asset.health_status === 'attention_required' || asset.health_status === 'degraded';

          // Show floating 3D badges for: Selected asset, Proximity-detected assets, Critical assets, or all when semanticBlend > 75
          if (!isSelected && !nearItem && !isCritical && st.semanticBlend < 75) return;
          if (st.semanticBlend < 15 && !isSelected) return;

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
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.dispose();
    };
  }, []);

  // 2. Handle Custom Drag-and-Drop / Uploaded PLY ArrayBuffer
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

  // 3. Update Point Size & "Dumb Scan -> Semantic World" Lens Blend
  useEffect(() => {
    if (!pointCloudMatRef.current) return;
    pointCloudMatRef.current.size = pointSize;
    // Slightly dim raw point cloud as Semantic World reaches 100% so 3D bounding frames pop cleanly
    const blendFactor = semanticBlend / 100;
    pointCloudMatRef.current.opacity = 1.0 - blendFactor * 0.25;
  }, [pointSize, semanticBlend]);

  // 4. Build / Update 30 Valmet Semantic 3D Asset Bounding Boxes + Structural Boiler Frames
  useEffect(() => {
    const assetGroup = assetGroupRef.current;
    const structuralGroup = structuralGroupRef.current;
    if (!assetGroup || !structuralGroup) return;

    // Clear existing
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
        opacity: 0.85
      });
      const wireMesh = new THREE.LineSegments(edgesGeo, edgeMat);
      group.add(wireMesh);

      // Corner bracket accent rings on top of bounding box
      const beaconGeo = new THREE.RingGeometry(0.06, 0.11, 16);
      beaconGeo.rotateX(-Math.PI / 2);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        side: THREE.DoubleSide
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.y = sy / 2 + 0.02;
      group.add(beacon);

      assetGroup.add(group);
      assetMeshMapRef.current.set(asset.asset_id, { group, fillMat, edgeMat });
    });

    // Rebuild Structural Boiler Room 3D Frames (Drums, Headers, Pipe Racks, MCC, Catwalk)
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
  }, [assets, showStructuralBoxes, semanticBlend]);

  // 5. Render Dual-Profile 3D A* Navigation Tubes & Interactive Floor Waypoint / Hazard Graph
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

    const buildTube = (points, colorHex, radius = 0.045, yOffset = 0.04, opacity = 0.92) => {
      if (!points || points.length < 2) return;
      const vecs = points.map((p) => new THREE.Vector3(p[0], p[1] + yOffset, p[2]));
      const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.15);
      const tubeGeo = new THREE.TubeGeometry(curve, Math.max(24, points.length * 10), radius, 12, false);
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

    if (showDualComparison) {
      // Render both Human (Cyan) and Wheeled Robot (Orange) paths simultaneously
      buildTube(humanPath?.points, 0x06b6d4, 0.038, 0.06, activeProfile === 'human' ? 0.95 : 0.55);
      buildTube(robotPath?.points, 0xf97316, 0.045, 0.03, activeProfile === 'robot' ? 0.95 : 0.55);
    } else if (activeProfile === 'human') {
      buildTube(humanPath?.points, 0x06b6d4, 0.045, 0.04, 0.95);
    } else {
      buildTube(robotPath?.points, 0xf97316, 0.045, 0.04, 0.95);
    }

    // Draw vertical target drop-line from selectedAsset down to its floor approach point
    if (selectedAsset) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(selectedAsset.position[0], selectedAsset.position[1], selectedAsset.position[2]),
        new THREE.Vector3(selectedAsset.approach_point[0], -1.02, selectedAsset.approach_point[2])
      ]);
      const lineMat = new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.1, gapSize: 0.06 });
      const line = new THREE.Line(lineGeo, lineMat);
      line.computeLineDistances();
      pathGroup.add(line);
    }

    // Render Interactive Walkable Waypoint Nodes & Dynamic Hazard Zones
    NAV_NODES.forEach((node) => {
      const isHazard = hazardNodes.includes(node.id);
      const isStair = node.id === 'N-M-STEP';

      const sphereGeo = new THREE.SphereGeometry(isHazard ? 0.16 : 0.075, 16, 16);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: isHazard ? 0xef4444 : isStair ? 0x38bdf8 : 0x475569,
        transparent: true,
        opacity: isHazard ? 0.95 : 0.65
      });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.set(node.pos[0], node.pos[1] + 0.05, node.pos[2]);
      sphere.userData = { nodeId: node.id, label: node.label };
      navGraphGroup.add(sphere);

      // If dynamic hazard is active on this node, render a translucent Red Hazard Cylinder
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

    // Subtle floor graph connectivity lines
    const nodeMap = new Map(NAV_NODES.map((n) => [n.id, n]));
    NAV_EDGES.forEach((edge) => {
      const u = nodeMap.get(edge.from);
      const v = nodeMap.get(edge.to);
      if (!u || !v) return;
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(u.pos[0], u.pos[1] + 0.01, u.pos[2]),
        new THREE.Vector3(v.pos[0], v.pos[1] + 0.01, v.pos[2])
      ]);
      const m = new THREE.LineBasicMaterial({
        color: edge.has_stairs ? 0x0284c7 : 0x1e293b,
        transparent: true,
        opacity: 0.45
      });
      navGraphGroup.add(new THREE.Line(g, m));
    });
  }, [humanPath, robotPath, activeProfile, showDualComparison, hazardNodes, selectedAsset]);

  // Camera Focus helper when user clicks "Focus Asset" or resets view
  const handleResetCamera = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(0.2, 2.3, -3.4);
    controlsRef.current.target.set(0.1, -0.25, 1.85);
    controlsRef.current.update();
  };

  const handleFocusSelected = () => {
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

      {/* Loading Indicator */}
      {loadingState && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm z-30">
          <div className="px-6 py-4 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl text-center">
            <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <div className="text-sm font-medium text-slate-200">{loadingState}</div>
            <div className="text-xs text-slate-400 mt-1">Decoding 3DGS Spherical Harmonics (f_dc_0..2) & Spatial Anchors</div>
          </div>
        </div>
      )}

      {/* Floating 3D HTML Semantic Badges (Criteria 1 & 2: 3D Framing + Proximity Highlighting) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
        {projectedLabels.map(({ asset, x, y, isSelected, isNearby, distanceToAvatar }) => {
          const borderColor = HEALTH_CSS[asset.health_status] || '#10b981';
          return (
            <button
              key={asset.asset_id}
              onClick={() => onSelectAsset(asset)}
              style={{
                transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`,
                borderColor
              }}
              className={`pointer-events-auto absolute top-0 left-0 px-2 py-1 rounded-md border text-left transition-shadow ${
                isSelected
                  ? 'bg-slate-900/95 ring-2 ring-sky-400 shadow-lg shadow-sky-500/20 z-30 scale-105'
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
              {(isSelected || isNearby) && (
                <div className="text-[9px] text-slate-300 truncate max-w-[140px]">
                  {asset.status_reason === 'NORMAL_OPERATION'
                    ? asset.service_description
                    : `${asset.status_reason} • ${asset.telemetry.pressure_bar || asset.telemetry.bearing_temp_c}${
                        asset.telemetry.pressure_bar ? ' bar' : '°C'
                      }`}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Viewport Quick Camera Controls (Top-Right of 3D Canvas) */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
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

      {/* Legend Overlay (Bottom-Left of 3D Canvas) */}
      <div className="absolute bottom-3 left-3 z-20 px-3 py-2 rounded-lg bg-slate-900/85 backdrop-blur-md border border-slate-800 text-[11px] text-slate-300 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
          <span>Critical / Degraded (6)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
          <span>Watch (4)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
          <span>Healthy (20)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 rounded bg-cyan-400 inline-block" />
          <span>Human Path (Stairs OK)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 rounded bg-orange-500 inline-block" />
          <span>AMR Robot Path (Flat ≥1.1m)</span>
        </div>
        <div className="text-slate-400">
          Tip: Click any 3D box to inspect & route • Click floor nodes to drop dynamic hazards
        </div>
      </div>
    </div>
  );
}
