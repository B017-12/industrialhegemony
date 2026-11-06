import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  Bot,
  Box,
  Database,
  Eye,
  Footprints,
  GitMerge,
  Layers,
  Pause,
  Play,
  QrCode,
  Radar,
  Search,
  Sparkles,
  Upload,
  Users
} from 'lucide-react';
import {
  createInitialDataPipeline,
  updateAssetTelemetryInMemory,
  simulateLiveTelemetryTick
} from './utils/dataPipeline.js';
import {
  computeAStarPath,
  INITIAL_FLEET_AGENTS,
  coordinateMultiAgentFleet
} from './utils/pathfinding.js';
import BoilerRoomViewport from './components/BoilerRoomViewport.jsx';
import AssetInspectorPanel from './components/AssetInspectorPanel.jsx';
import { EdgeCopilotDrawer, MobileArFieldHudModal } from './components/EdgeCopilotAndArHud.jsx';

export default function App() {
  // 1. Fast In-Memory Telemetry & Excel Data Pipeline
  const [pipeline, setPipeline] = useState(() => createInitialDataPipeline());
  const [liveStreaming, setLiveStreaming] = useState(false);

  // Selected & Hovered 3D Assets
  const [selectedAssetId, setSelectedAssetId] = useState('ASSET-003'); // CV-003
  const [hoveredAsset, setHoveredAsset] = useState(null);

  const selectedAsset = useMemo(
    () =>
      pipeline.assets.find((a) => a.asset_id === selectedAssetId) ||
      pipeline.assets[0],
    [pipeline.assets, selectedAssetId]
  );

  // Feature 1: "Dumb Scan -> Semantic World" Lens & 3D Contour + Planar Back Models
  const [semanticBlend, setSemanticBlend] = useState(92);
  const [showStructuralBoxes, setShowStructuralBoxes] = useState(true);
  const [showContourModels, setShowContourModels] = useState(true);
  const [pointSize, setPointSize] = useState(0.055);

  // Feature 2: Centerline Waypoint 'Rails', Smooth vs. Zig-Zag Comparison & Multi-Agent Fleet
  const [activeProfile, setActiveProfile] = useState('robot'); // 'robot' | 'human'
  const [railMode, setRailMode] = useState('smooth_rail'); // 'smooth_rail' | 'zigzag_grid'
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(true);
  const [showDualComparison, setShowDualComparison] = useState(true);
  const [hazardNodes, setHazardNodes] = useState([]);
  const [simPlaying, setSimPlaying] = useState(true);
  const [simProgress, setSimProgress] = useState(0.18);
  const [proximityRadius, setProximityRadius] = useState(1.75);
  const [nearbyAssets, setNearbyAssets] = useState([]);

  // Feature 4: Main AR Functionality (First-Person 3D AR Visor POV + Mobile QR AR HUD Modal)
  const [arFirstPersonMode, setArFirstPersonMode] = useState(false);
  const [isArHudOpen, setIsArHudOpen] = useState(false);
  const [checkedLotoSteps, setCheckedLotoSteps] = useState({});
  const [draftedWoBanner, setDraftedWoBanner] = useState(null);

  // Left Sidebar Filter
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // File Uploads (.PLY and Excel/JSON Data Import)
  const fileInputRef = useRef(null);
  const [customPlyBuffer, setCustomPlyBuffer] = useState(null);
  const [sceneStats, setSceneStats] = useState({
    sourceFile: 'Industrial Boiler Room (1).ply',
    rawVertices: 1506136,
    activeSplats: 121537,
    anchoredAssets: 30,
    structuralFrames: pipeline.structuralObjects.length
  });

  // Live Telemetry Stream Interval (mutates in-memory arrays on the fly)
  useEffect(() => {
    if (!liveStreaming) return;
    const timer = setInterval(() => {
      setPipeline((prev) => simulateLiveTelemetryTick(prev));
    }, 1800);
    return () => clearInterval(timer);
  }, [liveStreaming]);

  // Compute Centerline Rail A* Paths for Human & Robot
  const humanPath = useMemo(
    () =>
      computeAStarPath(
        'N-ENTRY',
        selectedAsset?.approach_point || [0, -1.02, 1.5],
        'human',
        hazardNodes,
        railMode
      ),
    [selectedAsset, hazardNodes, railMode]
  );

  const robotPath = useMemo(
    () =>
      computeAStarPath(
        'N-ENTRY',
        selectedAsset?.approach_point || [0, -1.02, 1.5],
        'robot',
        hazardNodes,
        railMode
      ),
    [selectedAsset, hazardNodes, railMode]
  );

  // Compute Multi-Robot & Multi-Human Fleet Coordination (R1 -> Object A, R2 -> Object B, H1 -> Object C)
  const fleetAssignments = useMemo(
    () =>
      coordinateMultiAgentFleet(
        INITIAL_FLEET_AGENTS,
        pipeline.assets,
        hazardNodes,
        railMode,
        selectedAsset
      ),
    [pipeline.assets, hazardNodes, railMode, selectedAsset]
  );

  // Filtered Assets for Left Sidebar
  const filteredAssets = useMemo(() => {
    return pipeline.assets.filter((a) => {
      if (statusFilter === 'critical') {
        if (a.health_status !== 'attention_required' && a.health_status !== 'degraded') return false;
      } else if (statusFilter === 'watch') {
        if (a.health_status !== 'watch') return false;
      } else if (statusFilter === 'healthy') {
        if (a.health_status !== 'healthy') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          a.tag.toLowerCase().includes(q) ||
          a.asset_id.toLowerCase().includes(q) ||
          a.service_description.toLowerCase().includes(q) ||
          a.area_name.toLowerCase().includes(q) ||
          a.status_reason.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [pipeline.assets, statusFilter, searchQuery]);

  const handleSelectAsset = (asset) => {
    if (!asset) return;
    setSelectedAssetId(asset.asset_id);
  };

  const handleMutateTelemetry = (assetId, patch, customReason = null) => {
    setPipeline((prev) => updateAssetTelemetryInMemory(prev, assetId, patch, customReason));
  };

  const handleToggleHazardNode = (nodeId) => {
    setHazardNodes((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  };

  const handleDropDemoHazard = () => {
    setHazardNodes((prev) => (prev.length > 0 ? [] : ['N-S-EAST1', 'N-M-WEST1']));
  };

  const handleToggleLotoStep = (stepKey) => {
    setCheckedLotoSteps((prev) => ({
      ...prev,
      [stepKey]: !prev[stepKey]
    }));
  };

  const handleDraftWorkOrder = (asset) => {
    const newId = asset.work_order?.wo_id || `WO-2026-${asset.tag}`;
    setDraftedWoBanner({
      id: newId,
      message: `Dispatched grounded work order packet for ${asset.tag} (${asset.service_description}) citing ${asset.doc_refs.join(', ')}.`
    });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setCustomPlyBuffer(ev.target.result);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const statusColorDot = {
    attention_required: 'bg-red-500',
    degraded: 'bg-orange-500',
    watch: 'bg-amber-500',
    healthy: 'bg-emerald-500'
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-950 text-slate-100">
      {/* ==================== TOP COMMAND BAR ==================== */}
      <header className="h-14 shrink-0 px-4 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between gap-3 select-none">
        {/* Brand & Pipeline Status */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-sky-500 flex items-center justify-center text-slate-950 font-black text-base shadow-lg">
            V
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm tracking-tight text-white">
                Valmet SpatialSense
              </h1>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                In-Memory Pipeline v{pipeline.version}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
              <span>{sceneStats.activeSplats.toLocaleString()} Splats</span>
              <span>•</span>
              <span className="text-sky-300">30 Contoured 3D Assets</span>
              <span>•</span>
              <span className="text-emerald-300">Centerline Waypoint Rails</span>
            </div>
          </div>
        </div>

        {/* Center Feature 1: "Dumb Scan -> Semantic World" Lens Slider */}
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800">
          <button
            onClick={() => setSemanticBlend(0)}
            className={`text-xs font-mono px-2 py-0.5 rounded transition ${
              semanticBlend < 15
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Raw Scan
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={semanticBlend}
            onChange={(e) => setSemanticBlend(Number(e.target.value))}
            className="w-24 accent-emerald-400 cursor-pointer"
          />
          <button
            onClick={() => setSemanticBlend(100)}
            className={`text-xs font-mono px-2 py-0.5 rounded transition ${
              semanticBlend >= 85
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Semantic ({semanticBlend}%)
          </button>
        </div>

        {/* Right Controls: Smooth Rail vs. Zig-Zag Toggle, Multi-Agent Fleet, AR HUD, Live Stream */}
        <div className="flex items-center gap-2">
          {/* Centerline Rail vs Zig-Zag Pathfinding Comparison Toggle */}
          <button
            onClick={() =>
              setRailMode((m) => (m === 'smooth_rail' ? 'zigzag_grid' : 'smooth_rail'))
            }
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition ${
              railMode === 'smooth_rail'
                ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-semibold'
                : 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold'
            }`}
            title="Toggle between Pre-Baked Equidistant Centerline Rails (Smooth) and Naive Zig-Zag Grid Pathfinding"
          >
            <GitMerge className="w-3.5 h-3.5" />
            <span>{railMode === 'smooth_rail' ? 'Rail: Smooth Centerline' : 'Path: Zig-Zag Grid'}</span>
          </button>

          {/* Live In-Memory Telemetry Stream Toggle */}
          <button
            onClick={() => setLiveStreaming((s) => !s)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition ${
              liveStreaming
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-semibold'
                : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
            title="Stream real-time telemetry mutations into the fast in-memory array"
          >
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span>{liveStreaming ? 'Live Stream: ON' : 'Live Stream'}</span>
          </button>

          {/* Dynamic Floor Hazard Button */}
          <button
            onClick={handleDropDemoHazard}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition ${
              hazardNodes.length > 0
                ? 'bg-red-500/20 border-red-500/50 text-red-300 font-semibold'
                : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
            <span>
              {hazardNodes.length > 0 ? `Hazards (${hazardNodes.length})` : 'Drop Hazard'}
            </span>
          </button>

          {/* Open Mobile AR HUD */}
          <button
            onClick={() => setIsArHudOpen(true)}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 shadow"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>AR Scanner</span>
          </button>

          {/* Load Custom PLY */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".ply"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-1"
            title="Load any .ply scan"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span>.PLY</span>
          </button>
        </div>
      </header>

      {/* ==================== MAIN 3-COLUMN WORKSPACE ==================== */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR: Avatar Rig, Centerline Rails, Multi-Robot Fleet Coordinator & 30 Assets */}
        <aside className="w-80 shrink-0 h-full bg-slate-900/95 border-r border-slate-800 flex flex-col overflow-hidden select-none">
          {/* Rig & Waypoint Rail Controller */}
          <div className="p-3.5 border-b border-slate-800 bg-slate-950/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <Radar className="w-3.5 h-3.5 text-emerald-400" />
                <span>Rig & Centerline Rails</span>
              </span>
              <div className="flex items-center gap-1 text-[10px] font-mono">
                <button
                  onClick={() => setActiveProfile('robot')}
                  className={`px-1.5 py-0.5 rounded ${
                    activeProfile === 'robot'
                      ? 'bg-orange-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-orange-300'
                  }`}
                >
                  AMR ({robotPath.distanceMeters}m)
                </button>
                <button
                  onClick={() => setActiveProfile('human')}
                  className={`px-1.5 py-0.5 rounded ${
                    activeProfile === 'human'
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-cyan-300'
                  }`}
                >
                  Human ({humanPath.distanceMeters}m)
                </button>
              </div>
            </div>

            {/* Walk / Scrub Slider */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSimPlaying((p) => !p)}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1 shrink-0"
              >
                {simPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{simPlaying ? 'Pause' : 'Walk'}</span>
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={simProgress}
                onChange={(e) => {
                  setSimPlaying(false);
                  setSimProgress(Number(e.target.value));
                }}
                className="w-full accent-emerald-400 cursor-pointer"
              />
              <span className="font-mono text-[11px] text-slate-300 w-9 text-right">
                {Math.round(simProgress * 100)}%
              </span>
            </div>

            {/* Multi-Robot & Multi-Human Fleet Coordination Panel */}
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={multiAgentEnabled}
                    onChange={(e) => setMultiAgentEnabled(e.target.checked)}
                    className="accent-emerald-400"
                  />
                  <span>Multi-Robot Fleet (R1, R2, H1)</span>
                </label>
                <span className="text-[10px] font-mono text-emerald-400">Zero Conflict</span>
              </div>

              {multiAgentEnabled && (
                <div className="space-y-1 pt-1">
                  {fleetAssignments.map((assign) => (
                    <button
                      key={assign.agent_id}
                      onClick={() => handleSelectAsset(assign.targetAsset)}
                      className="w-full px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 flex items-center justify-between text-[10px] font-mono transition"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: assign.color }}
                        />
                        <span className="font-bold text-white">{assign.agent_id}</span>
                        <span className="text-slate-400">→</span>
                        <span className="text-sky-300 font-bold">
                          {assign.targetAsset?.tag}
                        </span>
                      </span>
                      <span className="text-emerald-300">
                        {assign.path?.distanceMeters}m rail
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Checkboxes for Contour Models & Structural Frames */}
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showContourModels}
                  onChange={(e) => setShowContourModels(e.target.checked)}
                  className="accent-sky-400"
                />
                <span>Contour + Back Plane</span>
              </label>
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showStructuralBoxes}
                  onChange={(e) => setShowStructuralBoxes(e.target.checked)}
                  className="accent-sky-400"
                />
                <span>Structural Frames</span>
              </label>
            </div>
          </div>

          {/* Search & Status Filter */}
          <div className="p-3 border-b border-slate-800 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search 30 contoured assets..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="grid grid-cols-4 gap-1 text-[11px] font-mono">
              {[
                { key: 'all', label: 'All (30)' },
                { key: 'critical', label: 'Fault' },
                { key: 'watch', label: 'Watch' },
                { key: 'healthy', label: 'OK' }
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  className={`py-1 rounded border transition ${
                    statusFilter === tab.key
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable List of 30 Valmet Assets (with Hover Sync!) */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
            {filteredAssets.map((asset) => {
              const isSelected = selectedAsset?.asset_id === asset.asset_id;
              const isHovered = hoveredAsset?.asset_id === asset.asset_id;
              const isNear = nearbyAssets.some((n) => n.asset_id === asset.asset_id);
              const assignedAgent = multiAgentEnabled
                ? fleetAssignments.find((f) => f.targetAsset?.asset_id === asset.asset_id)
                : null;

              return (
                <button
                  key={asset.asset_id}
                  onClick={() => handleSelectAsset(asset)}
                  onMouseEnter={() => setHoveredAsset(asset)}
                  onMouseLeave={() => setHoveredAsset(null)}
                  className={`w-full p-2.5 rounded-xl border text-left transition flex items-start justify-between gap-2 ${
                    isSelected || isHovered
                      ? 'bg-sky-500/15 border-sky-400 shadow-md'
                      : isNear
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          statusColorDot[asset.health_status]
                        }`}
                      />
                      <span className="font-mono text-xs font-bold text-white">
                        {asset.tag}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {asset.asset_id}
                      </span>
                      {assignedAgent && (
                        <span
                          className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold text-slate-950"
                          style={{ backgroundColor: assignedAgent.color }}
                        >
                          {assignedAgent.agent_id}
                        </span>
                      )}
                      {isNear && (
                        <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[9px]">
                          RADAR
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-300 truncate mt-0.5">
                      {asset.service_description}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                      {asset.contourModel?.contourPointCount} Contour Pts • {asset.status_reason}
                    </div>
                  </div>

                  <div className="text-right shrink-0 font-mono">
                    <div
                      className={`text-xs font-bold ${
                        asset.health_score < 60
                          ? 'text-red-400'
                          : asset.health_score < 80
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {asset.health_score}%
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{asset.qr_id}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* CENTER 3D VIEWPORT + BOTTOM EDGE AI COPILOT DRAWER */}
        <main className="flex-1 flex flex-col h-full overflow-hidden">
          <div className="flex-1 relative overflow-hidden">
            <BoilerRoomViewport
              assets={pipeline.assets}
              selectedAsset={selectedAsset}
              onSelectAsset={handleSelectAsset}
              hoveredAsset={hoveredAsset}
              onHoverAsset={setHoveredAsset}
              semanticBlend={semanticBlend}
              showStructuralBoxes={showStructuralBoxes}
              showContourModels={showContourModels}
              activeProfile={activeProfile}
              railMode={railMode}
              multiAgentEnabled={multiAgentEnabled}
              fleetAssignments={fleetAssignments}
              showDualComparison={showDualComparison}
              humanPath={humanPath}
              robotPath={robotPath}
              hazardNodes={hazardNodes}
              onToggleHazardNode={handleToggleHazardNode}
              simPlaying={simPlaying}
              simProgress={simProgress}
              onSimProgressChange={setSimProgress}
              proximityRadius={proximityRadius}
              onNearbyAssetsChange={setNearbyAssets}
              pointSize={pointSize}
              arFirstPersonMode={arFirstPersonMode}
              onToggleArFirstPerson={setArFirstPersonMode}
              customPlyBuffer={customPlyBuffer}
              onLoadStats={setSceneStats}
            />
          </div>

          <EdgeCopilotDrawer
            selectedAsset={selectedAsset}
            humanPath={humanPath}
            robotPath={robotPath}
            nearbyAssets={nearbyAssets}
          />
        </main>

        {/* RIGHT SIDEBAR: Pre-Walk 3D Contour Viewer, "Why" Tree & In-Memory Telemetry Mutator */}
        <AssetInspectorPanel
          selectedAsset={selectedAsset}
          nearbyAssets={nearbyAssets}
          onSelectAsset={handleSelectAsset}
          checkedLotoSteps={checkedLotoSteps}
          onToggleLotoStep={handleToggleLotoStep}
          onOpenArHud={() => setIsArHudOpen(true)}
          onDraftWorkOrder={handleDraftWorkOrder}
          draftedWoBanner={draftedWoBanner}
          onMutateTelemetry={handleMutateTelemetry}
          pipelineMeta={pipeline}
        />
      </div>

      {/* Synced Mobile AR Field HUD Modal */}
      <MobileArFieldHudModal
        isOpen={isArHudOpen}
        onClose={() => setIsArHudOpen(false)}
        selectedAsset={selectedAsset}
        checkedLotoSteps={checkedLotoSteps}
        onToggleLotoStep={handleToggleLotoStep}
        humanPath={humanPath}
      />
    </div>
  );
}
