import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CENTRIFUGAL_PUMP_MODEL_ID,
  MODEL_CATALOG,
  PUMP_FAULT_SCENARIOS,
  PUMP_GLB_PARTS,
  PUMP_PART_BY_NODE_NAME,
  PUMP_PART_GROUPS
} from '../data/modelCatalog.js';

/**
 * Interactive 31-Part Centrifugal Pump 3D GLB Cutaway, Explode & Fault Simulator
 *
 * Implements the 3-step judge reveal for Valmet SpatialSense:
 *   1. Find the model ("Find the pump on the boiler feedwater line and show me the seal")
 *   2. Open the pump (Slide casing forward, keep shaft/impeller/bearings/seal in place, Explode slider 0-100%,
 *      and click/move any of the 31 named parts individually)
 *   3. Show a fault ("Mechanical seal leak" — pulse the mechanical seal in red and animate leaking droplets
 *      where the shaft exits the housing, labeled "Illustrative fault scenario")
 *
 * 3D Model Credit: Engine-X by Parth Parmar (engx3d.com) — CC BY-NC 4.0
 */
export default function PumpGlbInspector({
  asset,
  theme,
  initialRequest = null,
  onTriggerTelemetryFault
}) {
  const mountRef = useRef(null);
  const catalogEntry = MODEL_CATALOG[CENTRIFUGAL_PUMP_MODEL_ID];

  // Interactive controls state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [casingSlidePct, setCasingSlidePct] = useState(
    initialRequest?.open_casing !== false ? 100 : 0
  );
  const [explodePct, setExplodePct] = useState(initialRequest?.explode_pct ?? 0);
  const [activeGroupId, setActiveGroupId] = useState(
    initialRequest?.part_id || 'mechanical_seal'
  );
  const [selectedNodeName, setSelectedNodeName] = useState(
    'Mechanical seal (rotating ring)'
  );
  const [faultMode, setFaultMode] = useState(
    initialRequest?.fault_scenario || 'mechanical_seal_leak'
  );
  const [spinShaft, setSpinShaft] = useState(true);
  const [xrayCasing, setXrayCasing] = useState(false);
  const [partOffsets, setPartOffsets] = useState({}); // { [nodeName]: { dx, dy, dz } } in mm

  // Sync when AI Copilot sends a new cutaway request
  useEffect(() => {
    if (!initialRequest) return;
    if (initialRequest.open_casing !== undefined) {
      setCasingSlidePct(initialRequest.open_casing ? 100 : 0);
    }
    if (initialRequest.explode_pct !== undefined) {
      setExplodePct(initialRequest.explode_pct);
    }
    if (initialRequest.part_id) {
      setActiveGroupId(initialRequest.part_id);
      const grp = PUMP_PART_GROUPS.find((g) => g.id === initialRequest.part_id);
      if (grp?.nodes?.[0]) setSelectedNodeName(grp.nodes[0]);
    }
    if (initialRequest.fault_scenario) {
      setFaultMode(initialRequest.fault_scenario);
    }
  }, [initialRequest]);

  // Keep latest state in a ref for the 60 FPS Three.js animation loop
  const stateRef = useRef({
    casingSlidePct,
    explodePct,
    activeGroupId,
    selectedNodeName,
    faultMode,
    spinShaft,
    xrayCasing,
    partOffsets
  });
  useEffect(() => {
    stateRef.current = {
      casingSlidePct,
      explodePct,
      activeGroupId,
      selectedNodeName,
      faultMode,
      spinShaft,
      xrayCasing,
      partOffsets
    };
  }, [
    casingSlidePct,
    explodePct,
    activeGroupId,
    selectedNodeName,
    faultMode,
    spinShaft,
    xrayCasing,
    partOffsets
  ]);

  const cameraPresetsRef = useRef(null);

  const selectedPartSpec = useMemo(
    () =>
      PUMP_PART_BY_NODE_NAME[selectedNodeName] ||
      PUMP_GLB_PARTS[0],
    [selectedNodeName]
  );

  const activeFaultSpec =
    PUMP_FAULT_SCENARIOS[faultMode] || PUMP_FAULT_SCENARIOS.nominal;

  const curPartOffset = partOffsets[selectedNodeName] || { dx: 0, dy: 0, dz: 0 };

  const handleSetPartOffset = (axis, val) => {
    setPartOffsets((prev) => ({
      ...prev,
      [selectedNodeName]: {
        ...(prev[selectedNodeName] || { dx: 0, dy: 0, dz: 0 }),
        [axis]: Number(val)
      }
    }));
  };

  const handleResetAllPositions = () => {
    setCasingSlidePct(0);
    setExplodePct(0);
    setPartOffsets({});
    setXrayCasing(false);
    cameraPresetsRef.current?.overview?.();
  };

  // Step 1/2 preset: Open Pump & Focus Mechanical Seal
  const handleOpenPumpAndFocusSeal = () => {
    setCasingSlidePct(100);
    setActiveGroupId('mechanical_seal');
    setSelectedNodeName('Mechanical seal (rotating ring)');
    cameraPresetsRef.current?.focusSeal?.();
  };

  // Step 3 preset: Trigger Mechanical Seal Leak ("Illustrative fault scenario")
  const handleTriggerSealLeak = () => {
    setCasingSlidePct(100);
    setActiveGroupId('mechanical_seal');
    setSelectedNodeName('Mechanical seal (rotating ring)');
    setFaultMode('mechanical_seal_leak');
    cameraPresetsRef.current?.focusSeal?.();
    if (onTriggerTelemetryFault && asset?.asset_id) {
      onTriggerTelemetryFault(asset.asset_id, 'SEAL_DEGRADATION');
    }
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040d17);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 50);
    camera.position.set(1.65, 1.35, 3.15);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0.15, 0.42, 0);
    controls.minDistance = 0.65;
    controls.maxDistance = 9.0;
    controls.update();

    // High-contrast studio lighting for internal metallic & silicon-carbide components
    const ambLight = new THREE.AmbientLight(0xdbeafe, 1.15);
    scene.add(ambLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(4.5, 6.0, 5.0);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.15);
    fillLight.position.set(-4.0, 2.5, -3.5);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x00f2ff, 1.2, 8);
    rimLight.position.set(0.3, 1.4, 1.6);
    scene.add(rimLight);

    // Subtle engineering reference floor grid
    const grid = new THREE.GridHelper(6.5, 26, 0x0ea5e9, 0x1e293b);
    grid.position.y = -0.32;
    scene.add(grid);

    // Root scaled group: 1 mm in GLB = 0.0055 Three.js units (so 425 mm pump = ~2.34 units wide)
    const MM_SCALE = 0.0055;
    const pumpGroup = new THREE.Group();
    pumpGroup.scale.setScalar(MM_SCALE);
    // Offset so shaft axis (Y = 170 mm) sits around world Y = +0.62
    pumpGroup.position.set(0.1, -0.30, 0);
    scene.add(pumpGroup);

    // Seal exit highlight torus ring (in mm space inside pumpGroup, centered at X=16, Y=170, Z=0)
    const sealRingGeo = new THREE.TorusGeometry(32, 2.2, 16, 48);
    sealRingGeo.rotateY(Math.PI / 2);
    const sealRingMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.9
    });
    const sealBeaconRing = new THREE.Mesh(sealRingGeo, sealRingMat);
    sealBeaconRing.position.set(16, 170, 0);
    pumpGroup.add(sealBeaconRing);

    // Leaking water droplets particle pool (28 droplets in mm space originating at X=15, Y=154, Z=0)
    const DROPLET_COUNT = 28;
    const dropletsGroup = new THREE.Group();
    pumpGroup.add(dropletsGroup);

    const dropletGeo = new THREE.SphereGeometry(3.4, 10, 10);
    // Stretch slightly vertically to look like falling liquid drops
    dropletGeo.scale(0.82, 1.45, 0.82);

    const droplets = [];
    for (let i = 0; i < DROPLET_COUNT; i++) {
      const isRedTint = i % 3 === 0;
      const mat = new THREE.MeshStandardMaterial({
        color: isRedTint ? 0xf87171 : 0x38bdf8,
        emissive: isRedTint ? 0xef4444 : 0x0284c7,
        emissiveIntensity: 0.75,
        roughness: 0.1,
        metalness: 0.1,
        transparent: true,
        opacity: 0.92
      });
      const mesh = new THREE.Mesh(dropletGeo, mat);
      const phase = i / DROPLET_COUNT;
      const angle = (i * 2.39996) % (Math.PI * 2);
      droplets.push({
        mesh,
        phase,
        vx: (Math.cos(angle) * 14) + 4,
        vz: Math.sin(angle) * 18,
        vy0: -15 - (i % 5) * 8
      });
      dropletsGroup.add(mesh);
    }

    // Puddle ripple ring on the baseplate directly underneath the mechanical seal exit (X=16, Y=2, Z=0)
    const puddleGeo = new THREE.RingGeometry(6, 28, 32);
    puddleGeo.rotateX(-Math.PI / 2);
    const puddleMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65
    });
    const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat);
    puddleMesh.position.set(16, 2.2, 0);
    dropletsGroup.add(puddleMesh);

    // Camera smooth fly-to target state
    const camFly = {
      active: false,
      pos: new THREE.Vector3(),
      target: new THREE.Vector3()
    };

    cameraPresetsRef.current = {
      overview: () => {
        camFly.pos.set(1.55, 1.25, 2.95);
        camFly.target.set(0.15, 0.55, 0);
        camFly.active = true;
      },
      focusSeal: () => {
        // Frame the mechanical seal shaft exit (world X ≈ 0.19, Y ≈ 0.63, Z = 0) with the slid-open casing visible to the right
        camFly.pos.set(0.32, 1.02, 1.88);
        camFly.target.set(0.28, 0.62, 0);
        camFly.active = true;
      },
      focusImpeller: () => {
        camFly.pos.set(0.95, 0.98, 1.95);
        camFly.target.set(0.52, 0.62, 0);
        camFly.active = true;
      },
      focusBearings: () => {
        camFly.pos.set(-0.25, 1.05, 1.95);
        camFly.target.set(-0.02, 0.62, 0);
        camFly.active = true;
      }
    };

    // Load `/assets/models/pump.glb`
    const partNodesMap = new Map(); // nodeName -> { mesh, spec, baseMat, curSlide: [0,0,0] }
    const pickableMeshes = [];
    let currentShaftAngle = 0;

    const loader = new GLTFLoader();
    loader.load(
      catalogEntry.glb_path,
      (gltf) => {
        const root = gltf.scene;
        // Reset root offset so millimeter coordinates align cleanly
        root.position.set(0, 0, 0);
        root.traverse((obj) => {
          if (obj.isMesh) {
            const nodeName = obj.parent?.name && PUMP_PART_BY_NODE_NAME[obj.parent.name]
              ? obj.parent.name
              : obj.name;
            const spec = PUMP_PART_BY_NODE_NAME[nodeName] || {
              nodeName,
              partId: 'volute_casing',
              group: 'volute_casing',
              groupLabel: 'Pump Component',
              role: 'Centrifugal pump internal component.',
              isRotating: false,
              casingSlide: [0, 0, 0],
              explodeVec: [0, 0, 0],
              baseColor: 0x64748b
            };

            // Clone material so each of the 31 parts can be highlighted/pulsed independently
            const origMat = obj.material;
            const mat = origMat ? origMat.clone() : new THREE.MeshStandardMaterial();
            if (origMat?.color) {
              // Blend original material color with distinct engineering group tint
              mat.color = origMat.color.clone().lerp(new THREE.Color(spec.baseColor), 0.35);
            } else {
              mat.color = new THREE.Color(spec.baseColor);
            }
            mat.metalness = Math.max(0.35, mat.metalness ?? 0.55);
            mat.roughness = Math.min(0.55, mat.roughness ?? 0.35);
            obj.material = mat;

            // If this part rotates around the shaft axis (Y = 170 mm, Z = 0 mm),
            // recenter its geometry around Y = 170, Z = 0 so `obj.rotation.x` spins cleanly on the shaft axis!
            if (spec.isRotating && obj.geometry) {
              obj.geometry = obj.geometry.clone();
              obj.geometry.translate(0, -170, 0);
              obj.position.set(0, 170, 0);
              obj.userData.baseOrigin = [0, 170, 0];
            } else {
              obj.userData.baseOrigin = [obj.position.x, obj.position.y, obj.position.z];
            }

            obj.userData.nodeName = nodeName;
            obj.userData.partSpec = spec;
            partNodesMap.set(nodeName, {
              mesh: obj,
              spec,
              mat,
              baseColor: mat.color.clone(),
              curPos: [...obj.userData.baseOrigin]
            });
            pickableMeshes.push(obj);
          }
        });

        pumpGroup.add(root);
        setLoading(false);

        // Frame the opened pump & seal on initial load if requested
        if (stateRef.current.casingSlidePct > 0) {
          cameraPresetsRef.current?.focusSeal?.();
        }
      },
      undefined,
      (err) => {
        console.error('Failed to load pump.glb:', err);
        setLoadError(String(err?.message || err));
        setLoading(false);
      }
    );

    // Raycaster for clicking any of the 31 parts in the 3D viewer
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downXY = { x: 0, y: 0 };

    const onPointerDown = (e) => {
      downXY = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e) => {
      if (Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickableMeshes, false);
      if (hits.length > 0) {
        const hitMesh = hits[0].object;
        const nodeName = hitMesh.userData?.nodeName;
        const spec = hitMesh.userData?.partSpec;
        if (nodeName) {
          setSelectedNodeName(nodeName);
          if (spec?.group) setActiveGroupId(spec.group);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // ResizeObserver so canvas stays crisp
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 400;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // 60 FPS Animation Loop
    let rafId = 0;
    let lastTime = performance.now();

    const animate = (now) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const st = stateRef.current;
      const slideFactor = (st.casingSlidePct || 0) / 100;
      const explodeFactor = (st.explodePct || 0) / 100;
      const faultSpec = PUMP_FAULT_SCENARIOS[st.faultMode] || PUMP_FAULT_SCENARIOS.nominal;
      const pulseWave = 0.5 + 0.5 * Math.sin(now * 0.0085);

      if (st.spinShaft) {
        currentShaftAngle = (currentShaftAngle + dt * 5.2) % (Math.PI * 2);
      }

      // Smoothly update each of the 31 parts' position, rotation, and highlight/fault material
      partNodesMap.forEach((entry, nodeName) => {
        const { mesh, spec, mat, baseColor, curPos } = entry;
        const baseOrigin = mesh.userData.baseOrigin || [0, 0, 0];
        const userOff = st.partOffsets[nodeName] || { dx: 0, dy: 0, dz: 0 };

        const targetX =
          baseOrigin[0] +
          spec.casingSlide[0] * slideFactor +
          spec.explodeVec[0] * explodeFactor +
          (userOff.dx || 0);
        const targetY =
          baseOrigin[1] +
          spec.casingSlide[1] * slideFactor +
          spec.explodeVec[1] * explodeFactor +
          (userOff.dy || 0);
        const targetZ =
          baseOrigin[2] +
          spec.casingSlide[2] * slideFactor +
          spec.explodeVec[2] * explodeFactor +
          (userOff.dz || 0);

        curPos[0] += (targetX - curPos[0]) * 0.16;
        curPos[1] += (targetY - curPos[1]) * 0.16;
        curPos[2] += (targetZ - curPos[2]) * 0.16;
        mesh.position.set(curPos[0], curPos[1], curPos[2]);

        if (spec.isRotating) {
          mesh.rotation.x = currentShaftAngle;
        }

        // Determine visual highlight / fault pulse
        const isFaultTarget =
          faultSpec.targetGroupId && spec.group === faultSpec.targetGroupId;
        const isSelectedNode = st.selectedNodeName === nodeName;
        const isSelectedGroup = st.activeGroupId === spec.group;

        if (isFaultTarget && faultSpec.pulseColorHex) {
          mat.color.copy(baseColor).lerp(new THREE.Color(faultSpec.pulseColorHex), 0.65);
          mat.emissive.setHex(faultSpec.pulseColorHex);
          mat.emissiveIntensity = 0.35 + pulseWave * 0.95;
        } else if (isSelectedNode) {
          mat.color.copy(baseColor).lerp(new THREE.Color(0x00f2ff), 0.55);
          mat.emissive.setHex(0x00f2ff);
          mat.emissiveIntensity = 0.45;
        } else if (isSelectedGroup) {
          mat.color.copy(baseColor);
          mat.emissive.setHex(0x0ea5e9);
          mat.emissiveIntensity = 0.18;
        } else {
          mat.color.copy(baseColor);
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }

        // Optional X-Ray translucent casing so internal parts are visible even when casing is closed
        if (spec.group === 'volute_casing') {
          const wantTrans = st.xrayCasing;
          if (mat.transparent !== wantTrans) {
            mat.transparent = wantTrans;
            mat.depthWrite = !wantTrans;
            mat.needsUpdate = true;
          }
          mat.opacity = wantTrans ? 0.26 : 1.0;
        }
      });

      // Animate Mechanical Seal Leak droplets & pulsing red beacon ring at shaft exit
      const showSealLeak = st.faultMode === 'mechanical_seal_leak';
      dropletsGroup.visible = showSealLeak;
      sealBeaconRing.visible =
        showSealLeak || st.activeGroupId === 'mechanical_seal';

      if (sealBeaconRing.visible) {
        const ringColor = showSealLeak ? 0xef4444 : 0x00f2ff;
        sealRingMat.color.setHex(ringColor);
        sealRingMat.opacity = 0.45 + pulseWave * 0.5;
        const s = 1.0 + pulseWave * 0.14;
        sealBeaconRing.scale.set(1, s, s);
      }

      if (showSealLeak) {
        droplets.forEach((d) => {
          d.phase = (d.phase + dt * 0.72) % 1.0;
          const t = d.phase;
          // Spawn around the bottom lip of the seal gland where the shaft exits (X = 14..22, Y = 152, Z = 0)
          const x = 16 + d.vx * t;
          const z = d.vz * t;
          // Gravity arc down to the baseplate at Y = 3 mm
          const y = Math.max(3, 152 + d.vy0 * t - 165 * t * t);
          d.mesh.position.set(x, y, z);
          const scale = y <= 6 ? 1.5 * (1 - t) : 0.85 + 0.35 * Math.sin(t * Math.PI);
          d.mesh.scale.setScalar(Math.max(0.15, scale));
        });
        const puddleScale = 0.85 + pulseWave * 0.35;
        puddleMesh.scale.set(puddleScale, puddleScale, 1);
        puddleMat.opacity = 0.35 + pulseWave * 0.35;
      }

      // Smooth camera preset transitions
      if (camFly.active) {
        camera.position.lerp(camFly.pos, 0.12);
        controls.target.lerp(camFly.target, 0.14);
        if (
          camera.position.distanceTo(camFly.pos) < 0.02 &&
          controls.target.distanceTo(camFly.target) < 0.02
        ) {
          camFly.active = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
    };
  }, [catalogEntry.glb_path]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Top Guided Judge Demo Banner: 1. Find Model -> 2. Open Pump -> 3. Show Mechanical Seal Leak */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(2, 12, 24, 0.92)',
          border: `1.5px solid ${
            faultMode !== 'nominal' ? '#ef4444' : theme.primary
          }`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              background: 'rgba(0, 242, 255, 0.16)',
              border: `1px solid ${theme.primary}`,
              color: theme.primary,
              fontFamily: 'var(--mono)',
              fontSize: '10px',
              fontWeight: 800
            }}
          >
            CATALOG ID: {catalogEntry.model_id}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 800, color: '#fff' }}>
            {asset?.tag || 'P-002'} · Generic centrifugal pump (Boiler Feedwater Line)
          </span>
          {activeFaultSpec.badge && (
            <span
              style={{
                padding: '3px 9px',
                borderRadius: '999px',
                background: 'rgba(239, 68, 68, 0.22)',
                border: '1px solid #ef4444',
                color: '#fca5a5',
                fontFamily: 'var(--mono)',
                fontSize: '10.5px',
                fontWeight: 800,
                letterSpacing: '0.03em'
              }}
            >
              ● {activeFaultSpec.badge.toUpperCase()}: {activeFaultSpec.label}
            </span>
          )}
        </div>

        {/* 3-Step Judge Walkthrough Quick Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleOpenPumpAndFocusSeal}
            style={{
              padding: '4px 10px',
              borderRadius: '5px',
              border: `1px solid ${theme.primary}`,
              background:
                casingSlidePct > 50
                  ? theme.primary
                  : 'rgba(0, 242, 255, 0.14)',
              color: casingSlidePct > 50 ? '#031018' : '#ecfeff',
              fontFamily: 'var(--mono)',
              fontSize: '10.5px',
              fontWeight: 800,
              cursor: 'pointer'
            }}
            title="Slide the volute casing forward along +X while keeping the shaft, impeller, bearings, and mechanical seal in their installed positions"
          >
            {casingSlidePct > 50 ? '✓ 1. Casing Slid Open (Seal Exposed)' : '1. Open Pump (Slide Casing Forward)'}
          </button>

          <button
            type="button"
            onClick={() =>
              setCasingSlidePct((prev) => (prev > 50 ? 0 : 100))
            }
            style={{
              padding: '4px 9px',
              borderRadius: '5px',
              border: `1px solid ${theme.borderSoft}`,
              background: 'rgba(15, 23, 42, 0.85)',
              color: theme.text,
              fontFamily: 'var(--mono)',
              fontSize: '10.5px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {casingSlidePct > 50 ? 'Close Casing' : 'Slide Casing'}
          </button>

          <button
            type="button"
            onClick={handleTriggerSealLeak}
            style={{
              padding: '4px 10px',
              borderRadius: '5px',
              border: '1px solid #ef4444',
              background:
                faultMode === 'mechanical_seal_leak'
                  ? '#ef4444'
                  : 'rgba(239, 68, 68, 0.18)',
              color: '#fff',
              fontFamily: 'var(--mono)',
              fontSize: '10.5px',
              fontWeight: 800,
              cursor: 'pointer'
            }}
            title="Pulse the mechanical seal in red and animate water droplets where the shaft exits the housing"
          >
            💧 Fault: Mechanical Seal Leak
          </button>

          <button
            type="button"
            onClick={handleResetAllPositions}
            style={{
              padding: '4px 8px',
              borderRadius: '5px',
              border: `1px solid ${theme.borderSoft}`,
              background: 'rgba(15, 23, 42, 0.75)',
              color: theme.muted,
              fontFamily: 'var(--mono)',
              fontSize: '10px',
              cursor: 'pointer'
            }}
          >
            Reset Assembly
          </button>
        </div>
      </div>

      {/* Main Split Grid: Left Interactive 3D Three.js GLB Canvas + Right 31-Part Inspector & Sliders */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '10px' }}>
        {/* Left Column: Three.js 31-Part GLB Viewport + Sliders Overlay */}
        <div
          style={{
            position: 'relative',
            borderRadius: '8px',
            overflow: 'hidden',
            border: `1.5px solid ${theme.border}`,
            background: '#040d17',
            minHeight: '390px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div
            ref={mountRef}
            style={{
              width: '100%',
              height: '330px',
              cursor: 'grab',
              position: 'relative'
            }}
          />

          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(4, 13, 23, 0.82)',
                fontFamily: 'var(--mono)',
                fontSize: '12px',
                color: theme.primary
              }}
            >
              Loading 31-part Centrifugal Pump GLB (/assets/models/pump.glb · 2.1 MB)...
            </div>
          )}

          {loadError && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(4, 13, 23, 0.9)',
                color: '#f87171',
                fontFamily: 'var(--mono)',
                fontSize: '12px',
                padding: '16px'
              }}
            >
              GLB Load Error: {loadError}
            </div>
          )}

          {/* Top-Left Floating Overlay inside 3D Canvas: Active Part & Fault Callout */}
          <div
            style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(4, 13, 23, 0.86)',
              border: `1px solid ${theme.borderSoft}`,
              pointerEvents: 'none',
              maxWidth: '320px'
            }}
          >
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.muted }}>
              SELECTED INTERNAL COMPONENT (CLICK ANY PART IN 3D)
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '12.5px', fontWeight: 800, color: '#fff' }}>
              {selectedNodeName}
            </div>
            <div style={{ fontSize: '10.5px', color: theme.primary, fontFamily: 'var(--mono)' }}>
              Group: {selectedPartSpec.groupLabel} · Part ID: {selectedPartSpec.partId}
            </div>
          </div>

          {/* Top-Right Camera Angle Quick Pills */}
          <div
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              display: 'flex',
              gap: '4px',
              flexWrap: 'wrap'
            }}
          >
            {[
              { label: 'Seal View', fn: () => cameraPresetsRef.current?.focusSeal?.() },
              { label: 'Impeller View', fn: () => cameraPresetsRef.current?.focusImpeller?.() },
              { label: 'Bearings View', fn: () => cameraPresetsRef.current?.focusBearings?.() },
              { label: 'Full Skid', fn: () => cameraPresetsRef.current?.overview?.() }
            ].map((btn) => (
              <button
                key={btn.label}
                type="button"
                onClick={btn.fn}
                style={{
                  padding: '3px 7px',
                  borderRadius: '4px',
                  border: `1px solid ${theme.borderSoft}`,
                  background: 'rgba(15, 23, 42, 0.85)',
                  color: '#e2e8f0',
                  fontFamily: 'var(--mono)',
                  fontSize: '9.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Bottom Interactive Sliders Bar inside the 3D Viewport Card */}
          <div
            style={{
              padding: '8px 10px',
              background: 'rgba(6, 20, 34, 0.96)',
              borderTop: `1px solid ${theme.borderSoft}`,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr auto',
              gap: '10px',
              alignItems: 'center'
            }}
          >
            {/* Slider 1: Slide Casing Forward (0 - 100%) */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: 'var(--mono)',
                  fontSize: '10px',
                  marginBottom: '2px'
                }}
              >
                <span style={{ color: theme.primary, fontWeight: 700 }}>
                  OPEN PUMP (SLIDE CASING FORWARD)
                </span>
                <span style={{ color: '#fff', fontWeight: 800 }}>{casingSlidePct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={casingSlidePct}
                onChange={(e) => setCasingSlidePct(Number(e.target.value))}
                style={{ width: '100%', accentColor: theme.primary, cursor: 'pointer' }}
              />
            </div>

            {/* Slider 2: Explode All 31 Parts (0 - 100%) */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: 'var(--mono)',
                  fontSize: '10px',
                  marginBottom: '2px'
                }}
              >
                <span style={{ color: '#fbbf24', fontWeight: 700 }}>
                  EXPLODE 31 INTERNAL PARTS
                </span>
                <span style={{ color: '#fff', fontWeight: 800 }}>{explodePct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={explodePct}
                onChange={(e) => setExplodePct(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#fbbf24', cursor: 'pointer' }}
              />
            </div>

            {/* Rotor Spin & Casing X-Ray Toggles */}
            <div style={{ display: 'flex', gap: '5px' }}>
              <button
                type="button"
                onClick={() => setSpinShaft((s) => !s)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: `1px solid ${spinShaft ? '#10b981' : theme.borderSoft}`,
                  background: spinShaft ? 'rgba(16, 185, 129, 0.2)' : 'rgba(15, 23, 42, 0.8)',
                  color: spinShaft ? '#6ee7b7' : theme.muted,
                  fontFamily: 'var(--mono)',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
                title="Toggle 1480 RPM shaft, coupling, rotating seal ring, and 6-vane impeller rotation"
              >
                {spinShaft ? '⟳ Shaft Spin: ON' : '⟳ Shaft Spin: OFF'}
              </button>
              <button
                type="button"
                onClick={() => setXrayCasing((x) => !x)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: `1px solid ${xrayCasing ? theme.primary : theme.borderSoft}`,
                  background: xrayCasing ? 'rgba(0, 242, 255, 0.2)' : 'rgba(15, 23, 42, 0.8)',
                  color: xrayCasing ? theme.primary : theme.muted,
                  fontFamily: 'var(--mono)',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
                title="Make the Volute Casing translucent so you can see the impeller and seal even with the casing closed"
              >
                {xrayCasing ? '◉ Casing X-Ray: ON' : '◎ Casing X-Ray'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Fault Simulation Selector + 6 Functional Groups + 31 Individual Parts Mover */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Fault Simulation Bar */}
          <div
            style={{
              padding: '8px 10px',
              borderRadius: '8px',
              background: theme.panelBg,
              border: `1px solid ${
                faultMode !== 'nominal' ? 'rgba(239, 68, 68, 0.7)' : theme.borderSoft
              }`
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px'
              }}
            >
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', fontWeight: 800, color: '#fff' }}>
                3. SIMULATE INTERNAL FAULT SCENARIO
              </span>
              {activeFaultSpec.badge && (
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: '9.5px',
                    color: '#fca5a5',
                    fontWeight: 700
                  }}
                >
                  {activeFaultSpec.badge}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
              {Object.values(PUMP_FAULT_SCENARIOS).map((f) => {
                const active = faultMode === f.id;
                const isLeak = f.id === 'mechanical_seal_leak';
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFaultMode(f.id);
                      if (f.targetGroupId) {
                        setActiveGroupId(f.targetGroupId);
                        const grp = PUMP_PART_GROUPS.find((g) => g.id === f.targetGroupId);
                        if (grp?.nodes?.[0]) setSelectedNodeName(grp.nodes[0]);
                      }
                      if (isLeak) {
                        setCasingSlidePct(100);
                        cameraPresetsRef.current?.focusSeal?.();
                      } else if (f.id === 'impeller_cavitation') {
                        setCasingSlidePct(100);
                        cameraPresetsRef.current?.focusImpeller?.();
                      } else if (f.id === 'bearing_overheat') {
                        cameraPresetsRef.current?.focusBearings?.();
                      }
                    }}
                    style={{
                      padding: '5px 7px',
                      borderRadius: '5px',
                      border: `1px solid ${
                        active
                          ? f.id === 'nominal'
                            ? '#10b981'
                            : '#ef4444'
                          : theme.borderSoft
                      }`,
                      background: active
                        ? f.id === 'nominal'
                          ? 'rgba(16, 185, 129, 0.24)'
                          : 'rgba(239, 68, 68, 0.28)'
                        : 'rgba(15, 23, 42, 0.7)',
                      color: '#fff',
                      fontFamily: 'var(--mono)',
                      fontSize: '10px',
                      fontWeight: active ? 800 : 600,
                      textAlign: 'left',
                      cursor: 'pointer'
                    }}
                  >
                    {f.id === 'nominal' ? '✓ ' : '⚠ '}
                    {f.label}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#cbd5e1', lineHeight: 1.35 }}>
              {activeFaultSpec.summary}
            </div>
          </div>

          {/* Selected Part Detail & Individual Component X/Y/Z Offset Mover */}
          <div
            style={{
              padding: '8px 10px',
              borderRadius: '8px',
              background: theme.panelBg,
              border: `1px solid ${theme.borderSoft}`
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 800, color: theme.primary }}>
                {selectedNodeName}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPartOffsets((prev) => {
                    const next = { ...prev };
                    delete next[selectedNodeName];
                    return next;
                  })
                }
                style={{
                  padding: '2px 6px',
                  borderRadius: '3px',
                  border: `1px solid ${theme.borderSoft}`,
                  background: 'rgba(15, 23, 42, 0.7)',
                  color: theme.muted,
                  fontFamily: 'var(--mono)',
                  fontSize: '9.5px',
                  cursor: 'pointer'
                }}
              >
                Reset Part Offset
              </button>
            </div>
            <div style={{ fontSize: '11px', color: '#e2e8f0', marginTop: '3px', lineHeight: 1.35 }}>
              {selectedPartSpec.role}
            </div>

            {/* Individual Part X / Y / Z Pull-Out Sliders */}
            <div
              style={{
                marginTop: '6px',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '6px',
                fontFamily: 'var(--mono)',
                fontSize: '9.5px'
              }}
            >
              {[
                { axis: 'dx', label: ' Pull Axial (X)' },
                { axis: 'dy', label: 'Lift Vertical (Y)' },
                { axis: 'dz', label: 'Slide Lateral (Z)' }
              ].map(({ axis, label }) => (
                <div key={axis}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: theme.muted }}>
                    <span>{label}</span>
                    <span style={{ color: '#fff' }}>{curPartOffset[axis] || 0}mm</span>
                  </div>
                  <input
                    type="range"
                    min="-160"
                    max="160"
                    value={curPartOffset[axis] || 0}
                    onChange={(e) => handleSetPartOffset(axis, e.target.value)}
                    style={{ width: '100%', accentColor: theme.primary, cursor: 'pointer' }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 6 Functional Subsystem Group Pills + Scrollable 31 Named Parts List */}
          <div
            style={{
              padding: '8px 10px',
              borderRadius: '8px',
              background: theme.panelBg,
              border: `1px solid ${theme.borderSoft}`,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: '150px'
            }}
          >
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.muted, marginBottom: '5px' }}>
              SUBSYSTEM GROUPS &amp; ALL 31 NAMED GLB PARTS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
              {PUMP_PART_GROUPS.map((grp) => {
                const on = activeGroupId === grp.id;
                return (
                  <button
                    key={grp.id}
                    type="button"
                    onClick={() => {
                      setActiveGroupId(grp.id);
                      if (grp.nodes[0]) setSelectedNodeName(grp.nodes[0]);
                      if (grp.id === 'mechanical_seal') cameraPresetsRef.current?.focusSeal?.();
                      else if (grp.id === 'impeller') cameraPresetsRef.current?.focusImpeller?.();
                      else if (grp.id === 'bearings') cameraPresetsRef.current?.focusBearings?.();
                    }}
                    style={{
                      padding: '3px 7px',
                      borderRadius: '4px',
                      border: `1px solid ${on ? grp.color : theme.borderSoft}`,
                      background: on ? 'rgba(0, 242, 255, 0.18)' : 'rgba(15, 23, 42, 0.65)',
                      color: on ? '#fff' : theme.muted,
                      fontFamily: 'var(--mono)',
                      fontSize: '9.5px',
                      fontWeight: on ? 800 : 600,
                      cursor: 'pointer'
                    }}
                  >
                    {grp.shortLabel} ({grp.nodes.length})
                  </button>
                );
              })}
            </div>

            <div
              style={{
                maxHeight: '105px',
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '4px',
                paddingRight: '2px'
              }}
            >
              {PUMP_GLB_PARTS.map((p, idx) => {
                const isSel = selectedNodeName === p.nodeName;
                const inGrp = activeGroupId === p.group;
                return (
                  <button
                    key={p.nodeName}
                    type="button"
                    onClick={() => {
                      setSelectedNodeName(p.nodeName);
                      setActiveGroupId(p.group);
                    }}
                    style={{
                      padding: '3px 6px',
                      borderRadius: '4px',
                      border: `1px solid ${
                        isSel ? theme.primary : inGrp ? 'rgba(56, 189, 248, 0.35)' : 'rgba(51, 65, 85, 0.5)'
                      }`,
                      background: isSel
                        ? 'rgba(0, 242, 255, 0.22)'
                        : inGrp
                        ? 'rgba(15, 23, 42, 0.85)'
                        : 'rgba(15, 23, 42, 0.45)',
                      color: isSel ? '#fff' : inGrp ? '#e2e8f0' : '#94a3b8',
                      fontFamily: 'var(--mono)',
                      fontSize: '9.5px',
                      fontWeight: isSel ? 800 : 500,
                      textAlign: 'left',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                    title={`${p.nodeName} — ${p.role}`}
                  >
                    {idx + 1}. {p.nodeName}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Required Attribution Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '5px 10px',
          borderRadius: '6px',
          background: 'rgba(2, 10, 19, 0.82)',
          border: `1px solid ${theme.borderSoft}`,
          fontFamily: 'var(--mono)',
          fontSize: '10px',
          color: theme.muted
        }}
      >
        <span>
          3D Assembly: <strong style={{ color: '#e2e8f0' }}>Generic centrifugal pump (pump.glb · 2.1 MB · 31 named parts)</strong>
        </span>
        <span>
          Credit:{' '}
          <a
            href="https://engx3d.com/3d-models/centrifugal-pump"
            target="_blank"
            rel="noreferrer"
            style={{ color: theme.primary, textDecoration: 'underline' }}
          >
            Engine-X by Parth Parmar (engx3d.com)
          </a>{' '}
          · License: <strong style={{ color: '#e2e8f0' }}>CC BY-NC 4.0</strong>
        </span>
      </div>
    </div>
  );
}
