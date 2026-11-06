import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  Bot,
  Box,
  Eye,
  Footprints,
  Layers,
  Pause,
  Play,
  QrCode,
  Radar,
  RotateCcw,
  Search,
  ShieldAlert,
  Sliders,
  Upload
} from 'lucide-react';
import { VALMET_ASSETS, STRUCTURAL_BOILER_OBJECTS } from './data/valmetDataset';
import { computeAStarPath } from './utils/pathfinding';
import BoilerRoomViewport from './components/BoilerRoomViewport';
import AssetInspectorPanel from './components/AssetInspectorPanel';
import { EdgeCopilotDrawer, MobileArFieldHudModal } from './components/EdgeCopilotAndArHud';

export default function App() {
  // Default selected asset: CV-003 (Faulty Feedwater Control Valve) or P-002 (Cavitating Pump)
  const [selectedAsset, setSelectedAsset] = useState(
    () => VALMET_ASSETS.find((a) => a.tag === 'CV-003') || VALMET_ASSETS[0]
  );

  // Feature 1: "Dumb Scan -> Semantic World" Lens Slider (0% = Raw Point Cloud, 100% = Full 3D Semantic World)
  const [semanticBlend, setSemanticBlend] = useState(90);
  const [showStructuralBoxes, setShowStructuralBoxes] = useState(true);
  const [pointSize, setPointSize] = useState(0.055);

  // Feature 2: Dual-Profile Obstacle-Aware 3D Pathfinding & Autonomous Robot Simulation
  const [activeProfile, setActiveProfile] = useState('robot'); // 'robot' | 'human'
  const [showDualComparison, setShowDualComparison] = useState(true);
  const [hazardNodes, setHazardNodes] = useState([]); // Dynamic floor hazards
  const [simPlaying, setSimPlaying] = useState(true);
  const [simProgress, setSimProgress] = useState(0.15);
  const [proximityRadius, setProximityRadius] = useState(1.75);
  const [nearbyAssets, setNearbyAssets] = useState([]);

  // Asset Directory Filter & Search (Left Sidebar)
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'critical' | 'watch' | 'healthy'
  const [searchQuery, setSearchQuery] = useState('');

  // Feature 3 & 4: Synced LOTO Checklist, Drafted Work Orders, Mobile AR HUD Modal
  const [checkedLotoSteps, setCheckedLotoSteps] = useState({});
  const [isArHudOpen, setIsArHudOpen] = useState(false);
  const [draftedWoBanner, setDraftedWoBanner] = useState(null);

  // Custom PLY File Upload Support + Scene Stats
  const fileInputRef = useRef(null);
  const [customPlyBuffer, setCustomPlyBuffer] = useState(null);
  const [sceneStats, setSceneStats] = useState({
    sourceFile: 'Industrial Boiler Room (1).ply',
    rawVertices: 1506136,
    activeSplats: 121537,
    anchoredAssets: 30,
    structuralFrames: STRUCTURAL_BOILER_OBJECTS.length
  });

  // Compute real-time A* paths for both Human Technician and Wheeled Robot (AMR)
  const humanPath = useMemo(
    () =>
      computeAStarPath(
        'N-ENTRY',
        selectedAsset?.approach_point || [0, -1.02, 1.5],
        'human',
        hazardNodes
      ),
    [selectedAsset, hazardNodes]
  );

  const robotPath = useMemo(
    () =>
      computeAStarPath(
        'N-ENTRY',
        selectedAsset?.approach_point || [0, -1.02, 1.5],
        'robot',
        hazardNodes
      ),
    [selectedAsset, hazardNodes]
  );

  // Filtered Asset List for Left Sidebar
  const filteredAssets = useMemo(() => {
    return VALMET_ASSETS.filter((a) => {
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
  }, [statusFilter, searchQuery]);

  const handleToggleHazardNode = (nodeId) => {
    setHazardNodes((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  };

  const handleDropDemoHazard = () => {
    // Drops or clears a dynamic forklift/steam hazard on the primary corridor node
    setHazardNodes((prev) =>
      prev.length > 0 ? [] : ['N-S-EAST1', 'N-M-WEST1']
    );
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
      <header className="h-14 shrink-0 px-4 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between gap-4 select-none">
        {/* Brand & Loaded PLY Status */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-sky-500 flex items-center justify-center text-slate-950 font-black text-base shadow-lg shadow-emerald-500/20">
            V
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm tracking-tight text-white">
                Valmet SpatialSense
              </h1>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Since AI 2026 Prototype
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
              <span>PLY: {sceneStats.sourceFile}</span>
              <span>•</span>
              <span className="text-sky-300">
                {sceneStats.activeSplats.toLocaleString()} 3DGS Splats
              </span>
              <span>•</span>
              <span className="text-emerald-300">
                {sceneStats.anchoredAssets} Valmet Assets + {sceneStats.structuralFrames} Structural Frames
              </span>
            </div>
          </div>
        </div>

        {/* Center Feature 1 Control: "Dumb Scan -> Semantic World" Lens Slider */}
        <div className="flex items-center gap-3 px-3.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800">
          <button
            onClick={() => setSemanticBlend(0)}
            className={`text-xs font-mono px-2 py-0.5 rounded transition ${
              semanticBlend < 15
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Raw 3D Scan
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={semanticBlend}
            onChange={(e) => setSemanticBlend(Number(e.target.value))}
            className="w-28 accent-emerald-400 cursor-pointer"
            title="Slide between Raw Unindexed Point Cloud (0%) and Full Semantic AI World (100%)"
          />
          <button
            onClick={() => setSemanticBlend(100)}
            className={`text-xs font-mono px-2 py-0.5 rounded transition ${
              semanticBlend >= 85
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Semantic World ({semanticBlend}%)
          </button>
        </div>

        {/* Right Controls: Dual-Profile Routing Toggle, Hazard Dropper, Custom PLY Upload */}
        <div className="flex items-center gap-2">
          {/* Human vs Robot Profile Selector */}
          <div className="flex items-center rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setActiveProfile('human')}
              className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition ${
                activeProfile === 'human'
                  ? 'bg-cyan-500 text-slate-950 font-bold'
                  : 'text-cyan-300 hover:bg-slate-900'
              }`}
              title="Human Technician Profile: Can climb catwalk steps & traverse 0.7m pipe alleys"
            >
              <Footprints className="w-3.5 h-3.5" />
              <span>Human ({humanPath.distanceMeters}m)</span>
            </button>
            <button
              onClick={() => setActiveProfile('robot')}
              className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition ${
                activeProfile === 'robot'
                  ? 'bg-orange-500 text-slate-950 font-bold'
                  : 'text-orange-300 hover:bg-slate-900'
              }`}
              title="Wheeled AMR Robot Profile: Rejects stairs, requires >=1.1m flat aisle clearance"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>AMR Robot ({robotPath.distanceMeters}m)</span>
            </button>
          </div>

          {/* Dynamic Floor Hazard Button */}
          <button
            onClick={handleDropDemoHazard}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition ${
              hazardNodes.length > 0
                ? 'bg-red-500/20 border-red-500/50 text-red-300 font-semibold'
                : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
            title="Drop or Clear Dynamic Floor Obstruction to test real-time A* rerouting"
          >
            <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
            <span>
              {hazardNodes.length > 0
                ? `Clear Hazards (${hazardNodes.length})`
                : 'Drop Floor Hazard'}
            </span>
          </button>

          {/* Load Custom PLY File */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".ply"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-1.5"
            title="Load any local .ply file directly from disk"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span>Load .PLY</span>
          </button>
        </div>
      </header>

      {/* ==================== MAIN 3-COLUMN WORKSPACE ==================== */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR: 30 Valmet Anchored Assets + Simulation & Proximity Controls */}
        <aside className="w-80 shrink-0 h-full bg-slate-900/95 border-r border-slate-800 flex flex-col overflow-hidden select-none">
          {/* Autonomous Navigation & Proximity Radar Controller */}
          <div className="p-3.5 border-b border-slate-800 bg-slate-950/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Radar className="w-3.5 h-3.5 text-emerald-400" />
                <span>Robot Patrol & Proximity</span>
              </span>
              <span className="text-[11px] font-mono text-emerald-400">
                A* {activeProfile === 'human' ? humanPath.computeTimeMs : robotPath.computeTimeMs}ms
              </span>
            </div>

            {/* Play / Pause / Scrub Path Simulation */}
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
                title="Scrub Avatar / Robot position along the collision-free 3D path"
              />
              <span className="font-mono text-[11px] text-slate-300 w-9 text-right">
                {Math.round(simProgress * 100)}%
              </span>
            </div>

            {/* Proximity Radius & Visual Layer Toggles */}
            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Proximity Radius</span>
                  <span className="font-mono text-emerald-300">{proximityRadius.toFixed(1)}m</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="3.2"
                  step="0.1"
                  value={proximityRadius}
                  onChange={(e) => setProximityRadius(Number(e.target.value))}
                  className="w-full accent-emerald-400 cursor-pointer"
                />
              </div>

              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Splat Size</span>
                  <span className="font-mono text-sky-300">{pointSize.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.020"
                  max="0.110"
                  step="0.005"
                  value={pointSize}
                  onChange={(e) => setPointSize(Number(e.target.value))}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px]">
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDualComparison}
                  onChange={(e) => setShowDualComparison(e.target.checked)}
                  className="accent-sky-400"
                />
                <span>Show Dual Paths</span>
              </label>
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showStructuralBoxes}
                  onChange={(e) => setShowStructuralBoxes(e.target.checked)}
                  className="accent-sky-400"
                />
                <span>Structural 3D Frames</span>
              </label>
            </div>
          </div>

          {/* Filter & Search Bar for the 30 Valmet Builder Pack Assets */}
          <div className="p-3 border-b border-slate-800 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter 30 Valmet assets (e.g. CV-003, P-002)..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="grid grid-cols-4 gap-1 text-[11px] font-mono">
              {[
                { key: 'all', label: 'All (30)' },
                { key: 'critical', label: 'Fault (6)' },
                { key: 'watch', label: 'Watch (4)' },
                { key: 'healthy', label: 'OK (20)' }
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
              return (
                <button
                  key={asset.asset_id}
                  onClick={() => setSelectedAsset(asset)}
                  className={`w-full p-2.5 rounded-xl border text-left transition flex items-start justify-between gap-2 ${
                    isSelected
                      ? 'bg-sky-500/15 border-sky-400 shadow-md shadow-sky-500/10'
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
                      {isNear && (
                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[9px]">
                          IN RADAR
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-300 truncate mt-0.5">
                      {asset.service_description}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                      {asset.area_name} • {asset.status_reason}
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
              assets={VALMET_ASSETS}
              selectedAsset={selectedAsset}
              onSelectAsset={setSelectedAsset}
              semanticBlend={semanticBlend}
              showStructuralBoxes={showStructuralBoxes}
              activeProfile={activeProfile}
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
              customPlyBuffer={customPlyBuffer}
              onLoadStats={setSceneStats}
            />
          </div>

          {/* Bottom Grounded Offline Edge AI Copilot Drawer */}
          <EdgeCopilotDrawer
            selectedAsset={selectedAsset}
            humanPath={humanPath}
            robotPath={robotPath}
            nearbyAssets={nearbyAssets}
          />
        </main>

        {/* RIGHT SIDEBAR: Context-Aware Maintenance "Why" & Valmet Dataset Inspector */}
        <AssetInspectorPanel
          selectedAsset={selectedAsset}
          nearbyAssets={nearbyAssets}
          onSelectAsset={setSelectedAsset}
          checkedLotoSteps={checkedLotoSteps}
          onToggleLotoStep={handleToggleLotoStep}
          onOpenArHud={() => setIsArHudOpen(true)}
          onDraftWorkOrder={handleDraftWorkOrder}
          draftedWoBanner={draftedWoBanner}
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
