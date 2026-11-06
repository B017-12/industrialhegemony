import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  Award,
  BookOpen,
  Bot,
  Box,
  ChevronRight,
  Database,
  Eye,
  Footprints,
  Gamepad2,
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
import { CHALLENGE_BRIEF_MISSIONS } from './data/challengeBriefMissions.js';
import BoilerRoomViewport from './components/BoilerRoomViewport.jsx';
import AssetInspectorPanel from './components/AssetInspectorPanel.jsx';
import { EdgeCopilotDrawer, MobileArFieldHudModal } from './components/EdgeCopilotAndArHud.jsx';

export default function App() {
  // 1. Fast In-Memory Telemetry & Excel Data Pipeline (Real-time environment active by default!)
  const [pipeline, setPipeline] = useState(() => createInitialDataPipeline());
  const [liveStreaming, setLiveStreaming] = useState(true);

  // Selected 3D Asset
  const [selectedAssetId, setSelectedAssetId] = useState('ASSET-003');

  const selectedAsset = useMemo(
    () =>
      pipeline.assets.find((a) => a.asset_id === selectedAssetId) ||
      pipeline.assets[0],
    [pipeline.assets, selectedAssetId]
  );

  // Feature 1: "Dumb Scan -> Semantic World" Lens + AI Laser Sweep Wave (100% Clean CAD Default = ZERO white dots!)
  const [semanticBlend, setSemanticBlend] = useState(100);
  const [laserSweepTrigger, setLaserSweepTrigger] = useState(0);
  const [showStructuralBoxes, setShowStructuralBoxes] = useState(true);
  const [showContourModels, setShowContourModels] = useState(true);
  const [pointSize, setPointSize] = useState(0.055);

  // Feature 2: Centerline Waypoint 'Rails', Smooth vs. Zig-Zag & Multi-Agent Fleet
  const [activeProfile, setActiveProfile] = useState('robot');
  const [railMode, setRailMode] = useState('smooth_rail');
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(true);
  const [showDualComparison, setShowDualComparison] = useState(true);
  const [hazardNodes, setHazardNodes] = useState([]);
  const [simPlaying, setSimPlaying] = useState(true);
  const [simProgress, setSimProgress] = useState(0.18);
  const [proximityRadius, setProximityRadius] = useState(1.75);
  const [nearbyAssets, setNearbyAssets] = useState([]);

  // Feature 4: Main AR Functionality
  const [arFirstPersonMode, setArFirstPersonMode] = useState(false);
  const [isArHudOpen, setIsArHudOpen] = useState(false);
  const [checkedLotoSteps, setCheckedLotoSteps] = useState({});
  const [draftedWoBanner, setDraftedWoBanner] = useState(null);

  // Interactive Game Campaign & Challenge Briefing Mission Director
  const [activeStageId, setActiveStageId] = useState(1);
  const [showMissionBar, setShowMissionBar] = useState(true);

  const activeMission = useMemo(
    () =>
      CHALLENGE_BRIEF_MISSIONS.find((m) => m.stageId === activeStageId) ||
      CHALLENGE_BRIEF_MISSIONS[0],
    [activeStageId]
  );

  // Left Sidebar Filter
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Active 3D Room PLY Selector ('equipment_room' = Equipment Room.ply, 'boiler_room' = Industrial Boiler Room (1).ply)
  const [activeRoomScene, setActiveRoomScene] = useState('equipment_room');

  const fileInputRef = useRef(null);
  const [customPlyBuffer, setCustomPlyBuffer] = useState(null);
  const [sceneStats, setSceneStats] = useState({
    sourceFile: 'Equipment Room.ply',
    rawVertices: 1676481,
    activeSplats: 269219,
    anchoredAssets: 30,
    structuralFrames: pipeline.structuralObjects.length
  });

  useEffect(() => {
    if (!liveStreaming) return;
    const timer = setInterval(() => {
      setPipeline((prev) => simulateLiveTelemetryTick(prev));
    }, 1800);
    return () => clearInterval(timer);
  }, [liveStreaming]);

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

  // Interactive Mission Action Executor (executes each Challenge Briefing stage when clicked!)
  const handleExecuteMissionStage = (stage) => {
    setActiveStageId(stage.stageId);
    if (stage.targetAssetId) {
      setSelectedAssetId(stage.targetAssetId);
    }

    if (stage.stageId === 1) {
      // Trigger the Purple/Blue AI Semantic Laser Wave across the boiler room!
      setArFirstPersonMode(false);
      setShowContourModels(true);
      setLaserSweepTrigger((t) => t + 1);
    } else if (stage.stageId === 2) {
      // Engage Centerline Rail Walk & Proximity Radar
      setArFirstPersonMode(false);
      setRailMode('smooth_rail');
      setSimPlaying(true);
      setProximityRadius(1.9);
    } else if (stage.stageId === 3) {
      // Focus P-002 -> CV-003 spatial coupling & start live telemetry stream
      setArFirstPersonMode(false);
      setLiveStreaming(true);
    } else if (stage.stageId === 4) {
      // Enable Multi-Robot Fleet R1, R2, H1 & drop dynamic floor hazard
      setArFirstPersonMode(false);
      setMultiAgentEnabled(true);
      setHazardNodes(['N-S-EAST1', 'N-M-WEST1']);
      setSimPlaying(true);
    } else if (stage.stageId === 5) {
      // Enter First-Person AR Visor Mode
      setArFirstPersonMode(true);
      setSimPlaying(true);
    }
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
                Interactive Challenge Walkthrough
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
              <span>{sceneStats.activeSplats.toLocaleString()} Splats</span>
              <span>•</span>
              <span className="text-sky-300">30 Reconstructed 3D Meshes</span>
              <span>•</span>
              <span className="text-emerald-300">WASD + Centerline Rails</span>
            </div>
          </div>
        </div>

        {/* Center Feature 1: 1-Click PLY Room Switcher + AI Laser Scan Wave + MovingAtoms Pipeline */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800">
          {/* Instant 1-Click Switcher between Equipment Room.ply and Industrial Boiler Room.ply */}
          <div className="flex items-center rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-[11px] font-mono">
            <button
              onClick={() => {
                setCustomPlyBuffer(null);
                setActiveRoomScene('equipment_room');
              }}
              className={`px-2 py-0.5 rounded transition ${
                activeRoomScene === 'equipment_room'
                  ? 'bg-emerald-500 text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Switch to Equipment Room.ply (269,219 splats — matches the MovingAtoms demo video!)"
            >
              Equipment Room.ply
            </button>
            <button
              onClick={() => {
                setCustomPlyBuffer(null);
                setActiveRoomScene('boiler_room');
              }}
              className={`px-2 py-0.5 rounded transition ${
                activeRoomScene === 'boiler_room'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Switch to Industrial Boiler Room (1).ply (121,537 splats)"
            >
              Boiler Room.ply
            </button>
          </div>

          <button
            onClick={() => setLaserSweepTrigger((t) => t + 1)}
            className="px-2.5 py-1 rounded-lg bg-purple-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-1 shadow transition"
            title="Run MovingAtoms-style AI Semantic Extraction Laser across the active PLY room"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>MovingAtoms Laser</span>
          </button>

          <input
            type="range"
            min="0"
            max="100"
            value={semanticBlend}
            onChange={(e) => setSemanticBlend(Number(e.target.value))}
            className="w-20 accent-emerald-400 cursor-pointer"
          />
          <span className="text-xs font-mono text-emerald-300 font-semibold">
            {semanticBlend}%
          </span>

          <a
            href="https://movingatoms.ai/"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-sky-300"
            title="Open MovingAtoms.ai (PLY Semantic 3D Mesh Extractor recommended by organizers)"
          >
            movingatoms.ai ↗
          </a>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMissionBar((b) => !b)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition ${
              showMissionBar
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-bold'
                : 'bg-slate-950 border-slate-800 text-slate-300'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>Challenge Guide</span>
          </button>

          <button
            onClick={() =>
              setRailMode((m) => (m === 'smooth_rail' ? 'zigzag_grid' : 'smooth_rail'))
            }
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition ${
              railMode === 'smooth_rail'
                ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-semibold'
                : 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold'
            }`}
          >
            <GitMerge className="w-3.5 h-3.5" />
            <span>{railMode === 'smooth_rail' ? 'Rail: Smooth' : 'Path: Zig-Zag'}</span>
          </button>

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

          <button
            onClick={() => setIsArHudOpen(true)}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 shadow"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>AR Scanner</span>
          </button>

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
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span>.PLY</span>
          </button>
        </div>
      </header>

      {/* ==================== INTERACTIVE CHALLENGE BRIEFING & MISSION CAMPAIGN BAR ==================== */}
      {showMissionBar && (
        <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex flex-col gap-2 select-none">
          {/* 5-Stage Progress Stepper */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {CHALLENGE_BRIEF_MISSIONS.map((m) => {
                const isActive = m.stageId === activeStageId;
                return (
                  <button
                    key={m.stageId}
                    onClick={() => handleExecuteMissionStage(m)}
                    className={`px-2.5 py-1 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition ${
                      isActive
                        ? 'bg-sky-500/20 border-sky-400 text-white font-bold shadow'
                        : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-sky-300 text-[10px]">
                      {m.criterionWeight}
                    </span>
                    <span>{m.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => {
                const nextId = (activeStageId % CHALLENGE_BRIEF_MISSIONS.length) + 1;
                const nextMission = CHALLENGE_BRIEF_MISSIONS.find((m) => m.stageId === nextId);
                if (nextMission) handleExecuteMissionStage(nextMission);
              }}
              className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-1 shrink-0"
            >
              <span>Next Challenge Stage</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Active Stage Details & Reference to Official Challenge Brief */}
          <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-xs font-bold text-white">
                  {activeMission.criterionTitle}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {activeMission.criterionWeight}
                </span>
              </div>
              <div className="text-xs text-slate-200">
                <strong>Interactive Walkthrough Action:</strong> {activeMission.missionGoal}
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                📄 {activeMission.referenceText}
              </div>
            </div>

            <button
              onClick={() => handleExecuteMissionStage(activeMission)}
              className="px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-mono font-bold text-xs shrink-0 shadow-lg"
            >
              {activeMission.actionButtonLabel}
            </button>
          </div>
        </div>
      )}

      {/* ==================== MAIN 3-COLUMN WORKSPACE ==================== */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR */}
        <aside className="w-80 shrink-0 h-full bg-slate-900/95 border-r border-slate-800 flex flex-col overflow-hidden select-none">
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

            {/* Multi-Robot Fleet */}
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

          {/* Search & Filter */}
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

          {/* Scrollable List of 30 Valmet Assets */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
            {filteredAssets.map((asset) => {
              const isSelected = selectedAsset?.asset_id === asset.asset_id;
              const isNear = nearbyAssets.some((n) => n.asset_id === asset.asset_id);
              const assignedAgent = multiAgentEnabled
                ? fleetAssignments.find((f) => f.targetAsset?.asset_id === asset.asset_id)
                : null;

              return (
                <button
                  key={asset.asset_id}
                  onClick={() => handleSelectAsset(asset)}
                  className={`w-full p-2.5 rounded-xl border text-left transition flex items-start justify-between gap-2 ${
                    isSelected
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
              activeRoomScene={activeRoomScene}
              assets={pipeline.assets}
              selectedAsset={selectedAsset}
              onSelectAsset={handleSelectAsset}
              semanticBlend={semanticBlend}
              onSemanticBlendChange={setSemanticBlend}
              laserSweepTrigger={laserSweepTrigger}
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
              onSimPlayingChange={setSimPlaying}
              simProgress={simProgress}
              onSimProgressChange={setSimProgress}
              proximityRadius={proximityRadius}
              onNearbyAssetsChange={setNearbyAssets}
              pointSize={pointSize}
              arFirstPersonMode={arFirstPersonMode}
              onToggleArFirstPerson={setArFirstPersonMode}
              onQuickMutateTelemetry={handleMutateTelemetry}
              onOpenArHud={() => setIsArHudOpen(true)}
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

        {/* RIGHT SIDEBAR */}
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
