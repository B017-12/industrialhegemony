import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList,
  ExternalLink,
  List,
  MessageSquare,
  Navigation,
  Pause,
  Play,
  QrCode,
  RotateCcw,
  Search,
  Sliders,
  Upload
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
import { statusOf, humanize, sortBySeverity } from './ui/status.js';
import BoilerRoomViewport from './components/BoilerRoomViewport.jsx';
import AssetInspectorPanel from './components/AssetInspectorPanel.jsx';
import { EdgeCopilotDrawer, MobileArFieldHudModal } from './components/EdgeCopilotAndArHud.jsx';

export default function App() {
  const [pipeline, setPipeline] = useState(() => createInitialDataPipeline());
  const [liveStreaming, setLiveStreaming] = useState(true);

  const [selectedAssetId, setSelectedAssetId] = useState('ASSET-003');
  const [activeNav, setActiveNav] = useState('assets'); // 'assets' | 'navigate' | 'workorders' | 'copilot' | 'settings'

  const selectedAsset = useMemo(
    () =>
      pipeline.assets.find((a) => a.asset_id === selectedAssetId) ||
      pipeline.assets[0],
    [pipeline.assets, selectedAssetId]
  );

  // Scene & CAD display settings
  const [semanticBlend, setSemanticBlend] = useState(100);
  const [laserSweepTrigger, setLaserSweepTrigger] = useState(0);
  const [showStructuralBoxes, setShowStructuralBoxes] = useState(false);
  const [showContourModels, setShowContourModels] = useState(true);
  const [pointSize, setPointSize] = useState(0.05);

  // Navigation & Fleet state
  const [activeProfile, setActiveProfile] = useState('robot');
  const [railMode, setRailMode] = useState('smooth_rail');
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(true);
  const [showDualComparison, setShowDualComparison] = useState(true);
  const [hazardNodes, setHazardNodes] = useState([]);
  const [simPlaying, setSimPlaying] = useState(true);
  const [simProgress, setSimProgress] = useState(0.18);
  const [proximityRadius, setProximityRadius] = useState(1.75);
  const [nearbyAssets, setNearbyAssets] = useState([]);

  // Field verification / LOTO state
  const [arFirstPersonMode, setArFirstPersonMode] = useState(false);
  const [isArHudOpen, setIsArHudOpen] = useState(false);
  const [checkedLotoSteps, setCheckedLotoSteps] = useState({});
  const [draftedWoBanner, setDraftedWoBanner] = useState(null);

  // Scenario preset state
  const [activeStageId, setActiveStageId] = useState(null);

  // Asset Register filter & search
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'abnormal' | 'watch' | 'healthy'
  const [searchQuery, setSearchQuery] = useState('');

  // Active 3D room capture
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
    }, 2200);
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

  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, normal: 0, abnormal: 0 };
    pipeline.assets.forEach((a) => {
      if (a.health_status === 'attention_required') {
        c.critical++;
        c.abnormal++;
      } else if (a.health_status === 'degraded') {
        c.high++;
        c.abnormal++;
      } else if (a.health_status === 'watch') {
        c.medium++;
      } else {
        c.normal++;
      }
    });
    return c;
  }, [pipeline.assets]);

  const activeAlarms = useMemo(
    () =>
      sortBySeverity(
        pipeline.assets.filter(
          (a) => a.health_status === 'attention_required' || a.health_status === 'degraded'
        )
      ),
    [pipeline.assets]
  );

  const workOrderAssets = useMemo(
    () => sortBySeverity(pipeline.assets.filter((a) => Boolean(a.work_order))),
    [pipeline.assets]
  );

  const filteredAssets = useMemo(() => {
    const list = pipeline.assets.filter((a) => {
      if (statusFilter === 'abnormal') {
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
    return sortBySeverity(list);
  }, [pipeline.assets, statusFilter, searchQuery]);

  const handleSelectAsset = (assetOrId) => {
    if (!assetOrId) return;
    if (typeof assetOrId === 'string') {
      const found = pipeline.assets.find(
        (a) => a.asset_id === assetOrId || a.tag === assetOrId
      );
      if (found) setSelectedAssetId(found.asset_id);
      return;
    }
    if (assetOrId.asset_id) {
      setSelectedAssetId(assetOrId.asset_id);
    }
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
      message: `Work order ${newId} queued in SAP PM for ${asset.tag} (${asset.service_description}). Referenced documents: ${asset.doc_refs.join(', ')}.`
    });
  };

  const handleExecuteMissionStage = (stage) => {
    setActiveStageId(stage.stageId);
    if (stage.targetAssetId) {
      setSelectedAssetId(stage.targetAssetId);
    }

    if (stage.stageId === 1) {
      setArFirstPersonMode(false);
      setShowContourModels(true);
      setLaserSweepTrigger((t) => t + 1);
    } else if (stage.stageId === 2) {
      setArFirstPersonMode(false);
      setRailMode('smooth_rail');
      setSimPlaying(true);
      setProximityRadius(1.9);
      setActiveNav('navigate');
    } else if (stage.stageId === 3) {
      setArFirstPersonMode(false);
      setLiveStreaming(true);
    } else if (stage.stageId === 4) {
      setArFirstPersonMode(false);
      setMultiAgentEnabled(true);
      setHazardNodes(['N-S-EAST1', 'N-M-WEST1']);
      setSimPlaying(true);
      setActiveNav('navigate');
    } else if (stage.stageId === 5) {
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

  return (
    <div className="app">
      {/* ==================== TOP APPLICATION BAR ==================== */}
      <header className="topbar">
        <div className="brand">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 5L12 19L20 5H15.5L12 11.5L8.5 5H4Z" fill="#49A942" />
            <path d="M12 14.5L16.5 6.5H19L12 19L5 6.5H7.5L12 14.5Z" fill="#7CD476" fillOpacity="0.65" />
          </svg>
          <span className="brand-word">VALMET</span>
          <span className="brand-product">DNA SpatialSense</span>
        </div>

        <nav className="breadcrumb" aria-label="Plant hierarchy">
          <span>Kemi Mill</span>
          <span>›</span>
          <span>Recovery &amp; Power</span>
          <span>›</span>
          <select
            aria-label="Select 3D capture area"
            value={activeRoomScene}
            onChange={(e) => {
              setCustomPlyBuffer(null);
              setActiveRoomScene(e.target.value);
            }}
          >
            <option value="equipment_room">Area 01 — Equipment Room</option>
            <option value="boiler_room">Area 02 — Boiler House</option>
          </select>
        </nav>

        <div className="topbar-right">
          <div className="alarm-counter" title="Filter asset register by alarm priority">
            <button
              onClick={() => {
                setActiveNav('assets');
                setStatusFilter('abnormal');
              }}
            >
              <span className="sq" style={{ background: 'var(--critical)' }} />
              <span className="mono">{counts.critical}</span>
              <span>Alarm</span>
            </button>
            <button
              onClick={() => {
                setActiveNav('assets');
                setStatusFilter('abnormal');
              }}
            >
              <span className="sq" style={{ background: 'var(--high)' }} />
              <span className="mono">{counts.high}</span>
              <span>Degraded</span>
            </button>
            <button
              onClick={() => {
                setActiveNav('assets');
                setStatusFilter('watch');
              }}
            >
              <span className="sq" style={{ background: 'var(--medium)' }} />
              <span className="mono">{counts.medium}</span>
              <span>Watch</span>
            </button>
          </div>

          <button
            className="live-toggle"
            onClick={() => setLiveStreaming((s) => !s)}
            title="Toggle historian live polling"
          >
            <span className={`live-dot ${liveStreaming ? 'on' : ''}`} />
            <span>{liveStreaming ? 'Live telemetry' : 'Polling paused'}</span>
          </button>

          <a
            href="/viewer.html"
            className="topbar-meta"
            style={{ color: 'var(--topbar-text)' }}
            title="Open standalone 1M-splat Gaussian viewer"
          >
            <span>Splat Viewer</span>
            <ExternalLink size={12} />
          </a>

          <button
            className="live-toggle"
            onClick={() => setIsArHudOpen(true)}
            title="Open mobile field verification dialog"
          >
            <QrCode size={13} />
            <span>Field Verify</span>
          </button>

          <div className="user-chip">
            <span className="avatar">MV</span>
            <span>M. Virtanen</span>
          </div>
        </div>
      </header>

      {/* ==================== ISA-101 ACTIVE ALARM STRIP ==================== */}
      <div className="alarm-strip" role="region" aria-label="Active process alarms">
        <div className="alarm-strip-label">
          <span className="sdot critical" />
          <span>Active Alarms ({activeAlarms.length})</span>
        </div>
        <div className="alarm-items">
          {activeAlarms.map((alarm) => {
            const st = statusOf(alarm);
            return (
              <button
                key={alarm.asset_id}
                className="alarm-item"
                onClick={() => handleSelectAsset(alarm)}
                title={`${alarm.tag} — ${alarm.service_description}`}
              >
                <span className={`sdot ${st.cls}`} />
                <span className="tag">{alarm.tag}</span>
                <span className="desc">{humanize(alarm.status_reason)}</span>
                <span className={`health ${st.cls} mono`}>{alarm.health_score}%</span>
              </button>
            );
          })}
        </div>
        <button
          className="view-all"
          onClick={() => {
            setActiveNav('assets');
            setStatusFilter('abnormal');
          }}
        >
          Show in register
        </button>
      </div>

      {/* ==================== 4-COLUMN WORKSPACE ==================== */}
      <div className="workspace">
        {/* 1. LEFT ICON NAVIGATION RAIL */}
        <nav className="navrail" aria-label="Primary tools">
          <button
            className={activeNav === 'assets' ? 'active' : ''}
            onClick={() => setActiveNav('assets')}
            title="Asset Register"
          >
            <List size={18} />
          </button>

          <button
            className={activeNav === 'navigate' ? 'active' : ''}
            onClick={() => setActiveNav('navigate')}
            title="Routing & Autonomous Fleet"
          >
            <Navigation size={18} />
          </button>

          <button
            className={activeNav === 'workorders' ? 'active' : ''}
            onClick={() => setActiveNav('workorders')}
            title="Work Orders & Evaluation Scenarios"
          >
            <ClipboardList size={18} />
            {workOrderAssets.length > 0 && (
              <span className="badge-dot">{workOrderAssets.length}</span>
            )}
          </button>

          <button
            className={activeNav === 'copilot' ? 'active' : ''}
            onClick={() => setActiveNav('copilot')}
            title="Diagnostic Assistant"
          >
            <MessageSquare size={18} />
          </button>

          <button
            className={`rail-bottom ${activeNav === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveNav('settings')}
            title="Scene & Display Settings"
          >
            <Sliders size={18} />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".ply"
            onChange={handleFileUpload}
            className="hidden"
          />
        </nav>

        {/* 2. MODE-BASED LEFT SIDE PANEL */}
        <aside className="sidepanel">
          {activeNav === 'assets' && (
            <>
              <div className="panel-header">
                <span className="panel-title">Asset Register</span>
                <span className="panel-count">
                  {filteredAssets.length} of {pipeline.assets.length}
                </span>
              </div>

              <div className="panel-toolbar">
                <div className="input-wrap">
                  <Search size={14} />
                  <input
                    type="text"
                    className="input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by tag, service, or area..."
                  />
                </div>

                <div className="seg" role="tablist" aria-label="Filter assets by condition">
                  {[
                    { key: 'all', label: 'All', count: pipeline.assets.length },
                    { key: 'abnormal', label: 'Abnormal', count: counts.abnormal },
                    { key: 'watch', label: 'Watch', count: counts.medium },
                    { key: 'healthy', label: 'Normal', count: counts.normal }
                  ].map((t) => (
                    <button
                      key={t.key}
                      className={statusFilter === t.key ? 'active' : ''}
                      onClick={() => setStatusFilter(t.key)}
                    >
                      <span>{t.label}</span>
                      <span className="count">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel-body">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: '28px' }}>St.</th>
                      <th style={{ width: '74px' }}>Tag</th>
                      <th>Description</th>
                      <th className="right" style={{ width: '54px' }}>
                        Health
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.map((asset) => {
                      const st = statusOf(asset);
                      const isSelected = selectedAsset?.asset_id === asset.asset_id;
                      const isNear = nearbyAssets.some((n) => n.asset_id === asset.asset_id);
                      return (
                        <tr
                          key={asset.asset_id}
                          className={`${isSelected ? 'selected' : ''} ${isNear ? 'near' : ''}`}
                          onClick={() => handleSelectAsset(asset)}
                        >
                          <td>
                            <span className={`sdot ${st.cls}`} title={st.label} />
                          </td>
                          <td className="tag">{asset.tag}</td>
                          <td title={asset.service_description}>{asset.service_description}</td>
                          <td className={`right health ${st.cls}`}>{asset.health_score}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeNav === 'navigate' && (
            <>
              <div className="panel-header">
                <span className="panel-title">Navigation &amp; Fleet</span>
              </div>

              <div className="panel-body">
                <div className="section stack">
                  <div className="section-title">
                    <span>Route to {selectedAsset?.tag}</span>
                    <span className="mono">
                      {activeProfile === 'robot'
                        ? `${robotPath.distanceMeters} m`
                        : `${humanPath.distanceMeters} m`}
                    </span>
                  </div>

                  <div>
                    <div className="field-label">
                      <span>Mobility profile</span>
                    </div>
                    <div className="seg">
                      <button
                        className={activeProfile === 'human' ? 'active' : ''}
                        onClick={() => setActiveProfile('human')}
                      >
                        Operator ({humanPath.distanceMeters} m)
                      </button>
                      <button
                        className={activeProfile === 'robot' ? 'active' : ''}
                        onClick={() => setActiveProfile('robot')}
                      >
                        Wheeled AMR ({robotPath.distanceMeters} m)
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="field-label">
                      <span>Path solver</span>
                    </div>
                    <div className="seg">
                      <button
                        className={railMode === 'smooth_rail' ? 'active' : ''}
                        onClick={() => setRailMode('smooth_rail')}
                      >
                        Centerline rail
                      </button>
                      <button
                        className={railMode === 'zigzag_grid' ? 'active' : ''}
                        onClick={() => setRailMode('zigzag_grid')}
                      >
                        Grid A*
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="field-label">
                      <span>Patrol simulation</span>
                      <span className="mono">{Math.round(simProgress * 100)}%</span>
                    </div>
                    <div className="row">
                      <button
                        className="btn btn-sm"
                        onClick={() => setSimPlaying((p) => !p)}
                      >
                        {simPlaying ? <Pause size={13} /> : <Play size={13} />}
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
                      />
                    </div>
                  </div>

                  <div>
                    <div className="field-label">
                      <span>Proximity scan radius</span>
                      <span className="mono">{proximityRadius.toFixed(2)} m</span>
                    </div>
                    <input
                      type="range"
                      min="1.0"
                      max="3.0"
                      step="0.05"
                      value={proximityRadius}
                      onChange={(e) => setProximityRadius(Number(e.target.value))}
                    />
                  </div>

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={showDualComparison}
                      onChange={(e) => setShowDualComparison(e.target.checked)}
                    />
                    <span>Overlay both Operator &amp; AMR paths</span>
                  </label>
                </div>

                <div className="section stack">
                  <div className="section-title">
                    <span>Aisle Obstructions</span>
                    <span className="mono">{hazardNodes.length} blocked</span>
                  </div>
                  <p className="help">
                    Click any floor waypoint node in the 3D scene to toggle a temporary aisle
                    blockage, or test dynamic rerouting below.
                  </p>
                  <div className="row">
                    <button
                      className={`btn btn-block ${hazardNodes.length > 0 ? 'btn-danger' : ''}`}
                      onClick={handleDropDemoHazard}
                    >
                      {hazardNodes.length > 0
                        ? `Clear blocked aisles (${hazardNodes.join(', ')})`
                        : 'Simulate East/West aisle blockage'}
                    </button>
                  </div>
                </div>

                <div className="section stack">
                  <div className="section-title">
                    <span>Fleet Dispatch</span>
                    <span className="mono">{multiAgentEnabled ? '3 active' : 'Off'}</span>
                  </div>

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={multiAgentEnabled}
                      onChange={(e) => setMultiAgentEnabled(e.target.checked)}
                    />
                    <span>Coordinate multi-unit dispatch (R1, R2, H1)</span>
                  </label>

                  {multiAgentEnabled && (
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: '48px' }}>Unit</th>
                          <th style={{ width: '72px' }}>Target</th>
                          <th>Role</th>
                          <th className="right" style={{ width: '58px' }}>
                            Dist.
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {fleetAssignments.map((assign) => (
                          <tr
                            key={assign.agent_id}
                            onClick={() => handleSelectAsset(assign.targetAsset)}
                          >
                            <td className="mono">
                              <span
                                className="legend-swatch"
                                style={{ backgroundColor: assign.color }}
                              />
                              {assign.agent_id}
                            </td>
                            <td className="tag">{assign.targetAsset?.tag}</td>
                            <td className="text-2">{assign.role}</td>
                            <td className="right mono">{assign.path?.distanceMeters} m</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}

          {activeNav === 'workorders' && (
            <>
              <div className="panel-header">
                <span className="panel-title">Work Orders &amp; Scenarios</span>
                <span className="panel-count">{workOrderAssets.length} open</span>
              </div>

              <div className="panel-body">
                <div className="section" style={{ padding: 0 }}>
                  <div className="section-title" style={{ padding: '10px 12px 0' }}>
                    <span>Open Maintenance Orders</span>
                  </div>
                  {workOrderAssets.map((asset) => {
                    const wo = asset.work_order;
                    const st = statusOf(asset);
                    const isSelected = selectedAsset?.asset_id === asset.asset_id;
                    return (
                      <button
                        key={wo.wo_id}
                        className={`list-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelectAsset(asset)}
                      >
                        <div className="top">
                          <span className={`sdot ${st.cls}`} />
                          <span className="mono" style={{ fontWeight: 600 }}>
                            {wo.wo_id}
                          </span>
                          <span className="mono text-2">• {asset.tag}</span>
                          <span className="spacer" />
                          <span className={`status ${st.cls}`}>{wo.priority}</span>
                        </div>
                        <div className="title">{wo.summary}</div>
                        <div className="sub mono">
                          Failure mode: {humanize(wo.failure_code)}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="section" style={{ padding: 0 }}>
                  <div className="section-title" style={{ padding: '12px 12px 4px' }}>
                    <span>Verification Scenarios</span>
                  </div>
                  {CHALLENGE_BRIEF_MISSIONS.map((m) => {
                    const isActive = m.stageId === activeStageId;
                    return (
                      <button
                        key={m.stageId}
                        className={`list-item ${isActive ? 'selected' : ''}`}
                        onClick={() => handleExecuteMissionStage(m)}
                      >
                        <div className="top">
                          <span className="mono" style={{ fontWeight: 600 }}>
                            0{m.stageId}
                          </span>
                          <span style={{ fontWeight: 600 }}>{m.shortLabel}</span>
                          <span className="spacer" />
                          <span className="mono muted">{m.targetAssetId}</span>
                        </div>
                        <div className="title">{m.criterionTitle}</div>
                        <div className="sub">{m.missionGoal}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {activeNav === 'copilot' && (
            <EdgeCopilotDrawer
              assets={pipeline.assets}
              selectedAsset={selectedAsset}
              onSelectAsset={handleSelectAsset}
              humanPath={humanPath}
              robotPath={robotPath}
              nearbyAssets={nearbyAssets}
            />
          )}

          {activeNav === 'settings' && (
            <>
              <div className="panel-header">
                <span className="panel-title">Scene &amp; Display</span>
              </div>

              <div className="panel-body">
                <div className="section stack">
                  <div className="section-title">
                    <span>3D Capture Source</span>
                  </div>

                  <div>
                    <div className="field-label">
                      <span>Active room scan</span>
                    </div>
                    <select
                      className="select"
                      value={activeRoomScene}
                      onChange={(e) => {
                        setCustomPlyBuffer(null);
                        setActiveRoomScene(e.target.value);
                      }}
                    >
                      <option value="equipment_room">
                        Area 01 — Equipment Room (269,219 splats)
                      </option>
                      <option value="boiler_room">
                        Area 02 — Boiler House (121,537 splats)
                      </option>
                    </select>
                  </div>

                  <div className="row">
                    <button
                      className="btn btn-block"
                      onClick={() => setLaserSweepTrigger((t) => t + 1)}
                    >
                      <RotateCcw size={13} />
                      <span>Run segmentation sweep</span>
                    </button>
                  </div>

                  <div className="row">
                    <button
                      className="btn btn-block"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={13} />
                      <span>Import custom .PLY scan...</span>
                    </button>
                  </div>
                </div>

                <div className="section stack">
                  <div className="section-title">
                    <span>Reconstruction Layers</span>
                  </div>

                  <div>
                    <div className="field-label">
                      <span>CAD / Point-cloud blend</span>
                      <span className="mono">{semanticBlend}% CAD</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={semanticBlend}
                      onChange={(e) => setSemanticBlend(Number(e.target.value))}
                    />
                    <div className="help" style={{ marginTop: '4px' }}>
                      0% shows raw LiDAR/Gaussian point cloud; 100% shows extracted CAD
                      geometry.
                    </div>
                  </div>

                  <div>
                    <div className="field-label">
                      <span>Point cloud splat size</span>
                      <span className="mono">{pointSize.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.015"
                      max="0.09"
                      step="0.005"
                      value={pointSize}
                      onChange={(e) => setPointSize(Number(e.target.value))}
                    />
                  </div>

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={showContourModels}
                      onChange={(e) => setShowContourModels(e.target.checked)}
                    />
                    <span>Show attachment seam vertices &amp; datum plane</span>
                  </label>

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={showStructuralBoxes}
                      onChange={(e) => setShowStructuralBoxes(e.target.checked)}
                    />
                    <span>Show structural bay wireframes</span>
                  </label>
                </div>
              </div>
            </>
          )}
        </aside>

        {/* 3. CENTER 3D VIEWPORT */}
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

        {/* 4. RIGHT ASSET INSPECTOR */}
        <AssetInspectorPanel
          assets={pipeline.assets}
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

      {/* ==================== BOTTOM STATUS BAR ==================== */}
      <footer className="statusbar">
        <span>
          <span className="conn-dot" />
          <span>Valmet DNA Historian: Online</span>
        </span>
        <span className="mono">
          Scene: {sceneStats.sourceFile} ({sceneStats.activeSplats.toLocaleString()} pts)
        </span>
        <span className="mono">Assets: {pipeline.assets.length} anchored</span>
        <span className="mono">
          Rev. {pipeline.version} ({pipeline.lastUpdated})
        </span>
        <span className="right mono">
          Selected: {selectedAsset?.tag} [{selectedAsset?.position.map((v) => v.toFixed(2)).join(', ')} m]
        </span>
      </footer>

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
