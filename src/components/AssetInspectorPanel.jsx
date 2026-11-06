import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Database,
  FileText,
  GitBranch,
  Layers,
  QrCode,
  ShieldAlert,
  Sparkles,
  Wrench
} from 'lucide-react';
import { VALMET_RAG_DOCS } from '../data/valmetDataset.js';

/**
 * Interactive 3D Asset Contour & Planar-Back Preview Canvas
 * Allows a technician to inspect the extracted 3D object model (with its wall/floor attachment
 * contour points and planar occluded back-side) BEFORE walking there!
 */
function AssetContourMiniViewer({ asset }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || !asset) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 20);
    camera.position.set(1.25, 0.95, -1.45);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
    dLight.position.set(2, 3, -2);
    scene.add(dLight);

    const root = new THREE.Group();
    scene.add(root);

    const [sx, sy, sz] = asset.bbox_size;

    // 1. Occluded Back-Side Plane ("The back side that's not visible can be just a plane")
    const backPlaneGeo = new THREE.PlaneGeometry(sx * 1.05, sy * 1.05);
    const backPlaneMat = new THREE.MeshBasicMaterial({
      color: 0x1e293b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const backPlane = new THREE.Mesh(backPlaneGeo, backPlaneMat);
    backPlane.position.set(0, 0, sz * 0.5);
    root.add(backPlane);

    const backBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(backPlaneGeo),
      new THREE.LineBasicMaterial({ color: 0xf59e0b })
    );
    backBorder.position.copy(backPlane.position);
    root.add(backBorder);

    // 2. Contoured 3D Equipment Mesh Preview inside the bounding box
    const colorMap = {
      attention_required: 0xef4444,
      degraded: 0xf97316,
      watch: 0xf59e0b,
      healthy: 0x10b981
    };
    const statusColor = colorMap[asset.health_status] || 0x10b981;

    const equipMat = new THREE.MeshStandardMaterial({
      color: statusColor,
      metalness: 0.55,
      roughness: 0.3,
      transparent: true,
      opacity: 0.78
    });

    if (asset.asset_class === 'control_valve') {
      // Valve body + diaphragm actuator dome
      const body = new THREE.Mesh(new THREE.CylinderGeometry(sx * 0.25, sx * 0.25, sx * 0.7, 16), equipMat);
      body.rotation.z = Math.PI / 2;
      body.position.y = -sy * 0.15;
      root.add(body);
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(sx * 0.36, sx * 0.22, sy * 0.35, 20), equipMat);
      dome.position.y = sy * 0.22;
      root.add(dome);
    } else if (asset.asset_class === 'process_pump' || asset.asset_class === 'electric_motor') {
      // Horizontal pump/motor cylinder + skid base
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(sy * 0.32, sy * 0.32, sx * 0.75, 20), equipMat);
      cyl.rotation.z = Math.PI / 2;
      root.add(cyl);
      const base = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.88, sy * 0.14, sz * 0.82), equipMat);
      base.position.y = -sy * 0.38;
      root.add(base);
    } else {
      // Transmitter / Vibration Sensor housing
      const sensor = new THREE.Mesh(new THREE.SphereGeometry(Math.min(sx, sy) * 0.34, 18, 18), equipMat);
      root.add(sensor);
    }

    // 3. Bounding Wireframe Box
    const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: statusColor })
    );
    root.add(wire);

    // 4. Multi-Point Attachment Contour Loop & Vertex Spheres (Wall / Floor Attachment Seam)
    if (asset.contourModel?.contourPoints?.length) {
      const localPts = asset.contourModel.contourPoints.map(
        (pt) =>
          new THREE.Vector3(
            pt[0] - asset.position[0],
            pt[1] - asset.position[1],
            pt[2] - asset.position[2]
          )
      );
      localPts.push(localPts[0].clone());

      const cLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(localPts),
        new THREE.LineBasicMaterial({ color: 0x38bdf8 })
      );
      root.add(cLine);

      const dotGeo = new THREE.SphereGeometry(0.032, 10, 10);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      localPts.slice(0, -1).forEach((v) => {
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(v);
        root.add(dot);
      });
    }

    let animId;
    const animate = (now) => {
      animId = requestAnimationFrame(animate);
      root.rotation.y = Math.sin(now * 0.0009) * 0.65;
      renderer.render(scene, camera);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, [asset]);

  return (
    <div className="relative w-full h-44 rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
      <div ref={mountRef} className="w-full h-full" />
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-slate-900/90 border border-sky-500/40 font-mono text-[10px] text-sky-300">
        3D Pre-Walk Preview • {asset.contourModel?.contourPointCount || 12} Attachment Contour Pts
      </div>
      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-slate-900/90 border border-amber-500/40 font-mono text-[10px] text-amber-300">
        Occluded Back = Flat Plane
      </div>
    </div>
  );
}

export default function AssetInspectorPanel({
  selectedAsset,
  nearbyAssets,
  onSelectAsset,
  checkedLotoSteps,
  onToggleLotoStep,
  onOpenArHud,
  onDraftWorkOrder,
  draftedWoBanner,
  onMutateTelemetry,
  pipelineMeta
}) {
  const [activeTab, setActiveTab] = useState('why'); // 'why' | 'contour' | 'telemetry' | 'loto'

  if (!selectedAsset) return null;

  const isCritical =
    selectedAsset.health_status === 'attention_required' ||
    selectedAsset.health_status === 'degraded';

  const badgeStyles = {
    attention_required: 'bg-red-500/20 text-red-300 border-red-500/40',
    degraded: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    watch: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    healthy: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
  };

  return (
    <aside className="w-[410px] shrink-0 h-full bg-slate-900/95 border-l border-slate-800 flex flex-col overflow-hidden select-none">
      {/* Asset Identity Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/60">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold text-white">
                {selectedAsset.tag}
              </span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {selectedAsset.asset_id}
              </span>
              <span
                className={`text-[11px] font-mono uppercase px-2 py-0.5 rounded border font-semibold ${
                  badgeStyles[selectedAsset.health_status]
                }`}
              >
                {selectedAsset.health_status.replace('_', ' ')} • {selectedAsset.health_score}%
              </span>
            </div>
            <div className="text-xs text-slate-300 mt-1 font-medium">
              {selectedAsset.service_description} ({selectedAsset.subtype.replace(/_/g, ' ')})
            </div>
          </div>

          <button
            onClick={onOpenArHud}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center gap-1.5 shrink-0"
            title="Open Synced Mobile AR Field HUD"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>AR HUD</span>
          </button>
        </div>

        {/* Spatial & Anchor Metadata Pills */}
        <div className="grid grid-cols-3 gap-1.5 mt-3 text-[11px]">
          <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Area / Zone</span>
            <span className="font-mono text-slate-200 truncate block">{selectedAsset.area_name}</span>
          </div>
          <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">3D Anchor Pos</span>
            <span className="font-mono text-sky-300">
              [{selectedAsset.position.map((v) => v.toFixed(1)).join(', ')}]
            </span>
          </div>
          <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">QR / Connectivity</span>
            <span className="font-mono text-slate-200">{selectedAsset.qr_id}</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="grid grid-cols-4 border-b border-slate-800 bg-slate-950/40 text-xs font-medium">
        <button
          onClick={() => setActiveTab('why')}
          className={`py-2.5 px-2 border-b-2 transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'why'
              ? 'border-sky-400 text-sky-300 bg-sky-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>Why Tree</span>
        </button>
        <button
          onClick={() => setActiveTab('contour')}
          className={`py-2.5 px-2 border-b-2 transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'contour'
              ? 'border-sky-400 text-sky-300 bg-sky-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          <span>3D Contour</span>
        </button>
        <button
          onClick={() => setActiveTab('telemetry')}
          className={`py-2.5 px-2 border-b-2 transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'telemetry'
              ? 'border-sky-400 text-sky-300 bg-sky-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Live Data</span>
        </button>
        <button
          onClick={() => setActiveTab('loto')}
          className={`py-2.5 px-2 border-b-2 transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'loto'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          <span>LOTO SOP</span>
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* TAB 1: CONTEXT DECISION TREE + PRE-WALK 3D CONTOUR PREVIEW */}
        {activeTab === 'why' && (
          <>
            {/* Pre-Walk 3D Contoured Asset Model Preview */}
            <AssetContourMiniViewer asset={selectedAsset} />

            {/* Process Coupling Topology Card */}
            <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Spatial & Process Topology</span>
                <span className="text-sky-400">{selectedAsset.line_id}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Upstream</div>
                  <div className="font-mono text-slate-200 mt-0.5 truncate" title={selectedAsset.upstream_asset}>
                    {selectedAsset.upstream_asset}
                  </div>
                </div>
                <div className="p-2 rounded bg-sky-500/10 border border-sky-500/30 text-center">
                  <div className="text-[10px] text-sky-300">Selected</div>
                  <div className="font-mono font-bold text-white mt-0.5">{selectedAsset.tag}</div>
                </div>
                <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Downstream</div>
                  <div className="font-mono text-slate-200 mt-0.5 truncate" title={selectedAsset.downstream_asset}>
                    {selectedAsset.downstream_asset}
                  </div>
                </div>
              </div>
            </div>

            {/* 4-Step Context Decision Tree */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                <span>Explainable AI Context Decision Tree</span>
                <span className="text-[11px] font-mono text-emerald-400">
                  Anomaly Score: {(selectedAsset.anomaly_score * 100).toFixed(0)}%
                </span>
              </div>

              {selectedAsset.decision_tree.map((node, i) => (
                <div
                  key={node.step}
                  className="relative pl-6 pb-2 border-l-2 border-slate-700 last:border-l-0"
                >
                  <span
                    className={`absolute -left-[9px] top-0.5 w-4 h-4 rounded-full text-[10px] font-mono font-bold flex items-center justify-center ${
                      i === 3
                        ? 'bg-emerald-500 text-slate-950'
                        : isCritical
                        ? 'bg-orange-500 text-slate-950'
                        : 'bg-sky-500 text-slate-950'
                    }`}
                  >
                    {node.step}
                  </span>
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400">
                      {node.node}
                    </span>
                    <div className="text-xs font-semibold text-white mt-0.5">{node.title}</div>
                    <div className="text-xs text-slate-300 mt-1 leading-relaxed">{node.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Grounded Work Order */}
            {selectedAsset.work_order && (
              <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-orange-300 flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5" />
                    {selectedAsset.work_order.wo_id} ({selectedAsset.work_order.priority})
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-200">
                    {selectedAsset.work_order.failure_code}
                  </span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {selectedAsset.work_order.summary}
                </p>
              </div>
            )}
          </>
        )}

        {/* TAB 2: 3D ATTACHMENT CONTOUR & BACK-PLANE GEOMETRY INSPECTOR */}
        {activeTab === 'contour' && (
          <div className="space-y-3">
            <AssetContourMiniViewer asset={selectedAsset} />

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="font-mono font-bold text-sky-300">
                Attachment Seam & Planar Back-Wall Specification
              </div>
              <p className="text-slate-300 leading-relaxed">
                This 3D model is bounded by <strong>{selectedAsset.contourModel?.contourPointCount || 12} attachment contour vertices</strong> tracing where {selectedAsset.tag} attaches to the {selectedAsset.contourModel?.attachmentType === 'FLOOR_SKID_CONTOUR' ? 'boiler house floor skid' : 'pipe rack / wall'}, while the occluded rear face is modeled as a single flat plane (`[{selectedAsset.contourModel?.backPlane?.center?.join(', ')}]`).
              </p>
              <div className="grid grid-cols-2 gap-1.5 pt-2 font-mono text-[10px] text-slate-300">
                {selectedAsset.contourModel?.contourPoints?.slice(0, 8).map((pt, idx) => (
                  <div key={idx} className="px-2 py-1 rounded bg-slate-900 border border-slate-800">
                    Contour Pt #{idx + 1}: [{pt.join(', ')}]
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: FAST IN-MEMORY TELEMETRY PIPELINE & ON-THE-FLY MUTATION */}
        {activeTab === 'telemetry' && (
          <div className="space-y-3">
            {/* In-Memory Pipeline Status & Live Fault / Repair Injector */}
            <div className="p-3 rounded-lg bg-slate-950 border border-sky-500/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-sky-300">
                  In-Memory Excel Telemetry Pipeline (v{pipelineMeta?.version || 1})
                </span>
                <span className="text-[10px] font-mono text-emerald-400">
                  Updated {pipelineMeta?.lastUpdated}
                </span>
              </div>
              <div className="text-[11px] text-slate-300">
                Modify or append live telemetry on the fly — automatically updates 3D bounding box color, health score, and multi-robot emergency dispatch:
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() =>
                    onMutateTelemetry(
                      selectedAsset.asset_id,
                      {
                        vibration_mms: 7.4,
                        bearing_temp_c: 84.5,
                        stiction_index: 0.62,
                        position_pct: (selectedAsset.telemetry.setpoint_pct || 65) - 12.5
                      },
                      'EMERGENCY_SPIKE_INJECTED'
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 font-mono text-xs font-semibold"
                >
                  ⚡ Inject Emergency Spike
                </button>
                <button
                  onClick={() =>
                    onMutateTelemetry(
                      selectedAsset.asset_id,
                      {
                        vibration_mms: 1.8,
                        bearing_temp_c: 58.0,
                        stiction_index: 0.14,
                        position_pct: selectedAsset.telemetry.setpoint_pct || 64.0
                      },
                      'NORMAL_OPERATION'
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-semibold"
                >
                  ✓ Restore Nominal State
                </button>
              </div>
            </div>

            {/* Live Sliders to Tweak Telemetry Values On The Fly */}
            <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2.5 text-xs">
              <div className="font-semibold text-slate-200">
                Interactive Telemetry Override ({selectedAsset.tag})
              </div>

              <div>
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-slate-400">Vibration (mm/s RMS)</span>
                  <span className="text-white">{selectedAsset.telemetry.vibration_mms ?? 2.1} mm/s</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="9.5"
                  step="0.1"
                  value={selectedAsset.telemetry.vibration_mms ?? 2.1}
                  onChange={(e) =>
                    onMutateTelemetry(selectedAsset.asset_id, {
                      vibration_mms: Number(e.target.value)
                    })
                  }
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-slate-400">Bearing / Body Temp (°C)</span>
                  <span className="text-white">
                    {selectedAsset.telemetry.bearing_temp_c ?? selectedAsset.telemetry.temperature_c ?? 55}°C
                  </span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="95"
                  step="0.5"
                  value={selectedAsset.telemetry.bearing_temp_c ?? selectedAsset.telemetry.temperature_c ?? 55}
                  onChange={(e) =>
                    onMutateTelemetry(selectedAsset.asset_id, {
                      bearing_temp_c: Number(e.target.value),
                      temperature_c: Number(e.target.value)
                    })
                  }
                  className="w-full accent-orange-400 cursor-pointer"
                />
              </div>
            </div>

            {/* Current Telemetry Grid */}
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(selectedAsset.telemetry).map(([key, val]) => (
                <div
                  key={key}
                  className="p-2 rounded-lg bg-slate-950/80 border border-slate-800"
                >
                  <div className="text-[10px] font-mono uppercase text-slate-400">
                    {key.replace(/_/g, ' ')}
                  </div>
                  <div className="text-sm font-mono font-bold text-white mt-0.5">
                    {val}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: INTERACTIVE LOTO & FIELD SOP CHECKLIST */}
        {activeTab === 'loto' && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-emerald-400" />
                Zero-Energy LOTO & Field Calibration Protocol
              </div>
              <div className="text-[11px] text-emerald-300/80 mt-1">
                Synced in real time with the Technician Mobile AR HUD ({selectedAsset.qr_id}).
              </div>
            </div>

            <div className="space-y-2">
              {selectedAsset.loto_checklist.map((stepText, idx) => {
                const stepKey = `${selectedAsset.asset_id}-${idx}`;
                const isDone = Boolean(checkedLotoSteps[stepKey]);
                return (
                  <label
                    key={stepKey}
                    onClick={() => onToggleLotoStep(stepKey)}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ${
                      isDone
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 line-through opacity-85'
                        : 'bg-slate-950/80 border-slate-800 text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => {}}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <span className="leading-relaxed">{stepText}</span>
                  </label>
                );
              })}
            </div>

            <button
              onClick={() => onDraftWorkOrder(selectedAsset)}
              className="w-full py-2.5 px-4 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 shadow-lg transition"
            >
              <Sparkles className="w-4 h-4" />
              <span>Generate AI-Grounded Work Order Packet</span>
            </button>

            {draftedWoBanner && (
              <div className="p-3 rounded-lg bg-sky-500/15 border border-sky-500/40 text-xs text-sky-200 space-y-1">
                <div className="font-mono font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Dispatched: {draftedWoBanner.id}</span>
                </div>
                <div>{draftedWoBanner.message}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
