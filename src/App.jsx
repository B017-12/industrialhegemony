import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  X,
  Bell,
  Camera,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Eye,
  Move,
  List,
  MessageSquare,
  Navigation,
  Pause,
  Play,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  Sliders,
  Trash2,
  Upload,
  Wrench,
  Zap
} from 'lucide-react';
import {
  createInitialDataPipeline,
  updateAssetTelemetryInMemory,
  simulateLiveTelemetryTick
} from './utils/dataPipeline.js';
import {
  computeAStarPath,
  INITIAL_FLEET_AGENTS,
  coordinateMultiAgentFleet,
  buildCollisionBoxes,
  setCvNavigationData
} from './utils/pathfinding.js';
import {
  createInitialExerciseWorkers,
  addExerciseWorker,
  removeExerciseWorker,
  assignWorkerToAsset,
  beginRepair,
  recallWorker,
  stepExerciseSimulation
} from './utils/exerciseEngine.js';
import { answer as runDiagnosticQuery, diagnose } from './utils/diagnosticEngine.js';
import {
  fetchCvSceneBundle,
  applyCvOverrides,
  syncAssetsWithCvObjects,
  saveStoredOverrides,
  clearStoredOverrides
} from './utils/cvEngine.js';
import { CHALLENGE_BRIEF_MISSIONS } from './data/challengeBriefMissions.js';
import { statusOf, humanize, sortBySeverity } from './ui/status.js';
import BoilerRoomViewport from './components/BoilerRoomViewport.jsx';
import AssetInspectorPanel from './components/AssetInspectorPanel.jsx';
import CvReviewPanel from './components/CvReviewPanel.jsx';
import SceneInspectorPanel from './components/SceneInspectorPanel.jsx';
import SceneEditPanel from './components/SceneEditPanel.jsx';
import { useSceneEdits, mergeEditOverrides } from './sceneEdit/useSceneEdits.js';
import { useSplatMover } from './sceneEdit/useSplatMover.js';
import { EdgeCopilotDrawer, MobileArFieldHudModal } from './components/EdgeCopilotAndArHud.jsx';

export default function App() {
  const [pipeline, setPipeline] = useState(() => createInitialDataPipeline());
  const [liveStreaming, setLiveStreaming] = useState(true);

  const [selectedAssetId, setSelectedAssetId] = useState('ASSET-014'); // Default to P-002 (Video-evidence bound pump)
  const [activeNav, setActiveNav] = useState('alerts'); // 'alerts' | 'assets' | 'cv_review' | 'vision' | 'scene_edit' | 'navigate' | 'workorders' | 'copilot' | 'settings'

  // Application Mode: 'consumer' (Matterport-style clean twin) | 'technician' (Siemens-style engineering twin)
  const [appMode, setAppMode] = useState('technician');
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  // Computer Vision & 3DGS state (from ahmad_branch)
  const [viewMode, setViewMode] = useState('splat'); // 'splat' | 'hybrid' | 'cad' (Defaults to Photoreal 3DGS .spz!)
  const [ceilingCutaway, setCeilingCutaway] = useState(true);
  const [showAllCvDetections, setShowAllCvDetections] = useState(false); // Defaults to 30 bound OBBs only
  const [baseCvSceneObjects, setBaseCvSceneObjects] = useState(null);
  const [fileCvOverrides, setFileCvOverrides] = useState({});
  const [cvOverridesMap, setCvOverridesMap] = useState({});
  const [evidenceFrames, setEvidenceFrames] = useState({});
  const [cvMetrics, setCvMetrics] = useState(null);
  const [navTargets, setNavTargets] = useState(null);
  const [navData, setNavData] = useState(null);
  const [selectedCvObjectId, setSelectedCvObjectId] = useState('OBJ-0185');

  // Scene editing (backend/scene_edit): moved objects, rebuilt equal-clearance rails and replanned routes
  const [sceneCtx, setSceneCtx] = useState(null);
  const [useRailRoutes, setUseRailRoutes] = useState(true);
  const [navVersion, setNavVersion] = useState(0);
  const sceneEdit = useSceneEdits(selectedAssetId);
  // only hand-verified whole objects (chairs, pallet truck) move; their volumes cover the entire object
  const splatMover = useSplatMover(sceneCtx, sceneEdit.edits, sceneEdit.movablesBaseById);

  // User-moved CV objects: { [object_id]: { dx, dz } } display-frame offsets from the scanned position
  const [objectMoves, setObjectMoves] = useState({});

  const cvSceneObjects = useMemo(() => {
    const merged = applyCvOverrides(
      baseCvSceneObjects,
      mergeEditOverrides(cvOverridesMap, sceneEdit.overrides)
    );
    const ids = Object.keys(objectMoves);
    if (!ids.length || !merged?.objects?.length) return merged;
    const identity = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
    const moved = merged.objects.map((o) => {
      const mv = objectMoves[o.object_id];
      if (!mv || (Math.abs(mv.dx) < 1e-4 && Math.abs(mv.dz) < 1e-4)) return o;
      const rdx = mv.dx;
      const rdz = -mv.dz;
      const shift = (v) => (Array.isArray(v) ? [v[0] + rdx, v[1], v[2] + rdz] : v);
      const origObb = o._origObb
        ? o._origObb
        : o.obb
        ? { center: o.obb.center, extent: o.obb.extent, rotation: o.obb.rotation || identity }
        : {
            center: o.center,
            extent: (o.aabb_max || [0.5, 0.5, 0.5]).map((v, i) =>
              Math.abs(v - (o.aabb_min?.[i] ?? 0))
            ),
            rotation: identity
          };
      return {
        ...o,
        _moved: mv,
        _origObb: origObb,
        center: shift(o.center),
        aabb_min: shift(o.aabb_min),
        aabb_max: shift(o.aabb_max),
        obb: o.obb ? { ...o.obb, center: shift(o.obb.center) } : o.obb
      };
    });
    return { ...merged, objects: moved };
  }, [baseCvSceneObjects, cvOverridesMap, sceneEdit.overrides, objectMoves]);

  const handleMoveCvObject = (objectId, dxOrMove, dz = 0) => {
    const mv =
      typeof dxOrMove === 'object' && dxOrMove !== null
        ? { dx: Number(dxOrMove.dx) || 0, dz: Number(dxOrMove.dz) || 0 }
        : { dx: Number(dxOrMove) || 0, dz: Number(dz) || 0 };
    setObjectMoves((prev) => ({ ...prev, [objectId]: mv }));
  };
  const handleResetCvMoves = () => setObjectMoves({});

  // Load CV 3D OBB segmentation & video evidence bundle on startup
  useEffect(() => {
    let alive = true;
    fetchCvSceneBundle()
      .then((bundle) => {
        if (!alive) return;
        setBaseCvSceneObjects(bundle.baseSceneObjects);
        setFileCvOverrides(bundle.fileOverrides);
        setCvOverridesMap(bundle.overridesMap);
        setEvidenceFrames(bundle.evidenceFrames);
        setCvMetrics(bundle.segmentationMetrics);
        setNavTargets(bundle.navTargets);
        setNavData(bundle.navData);
      })
      .catch((err) => {
        console.warn('Could not load CV scene bundle:', err);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Synchronize the 30 Valmet assets with their bound 3D CV OBBs & ESDF navigation whenever CV overrides change
  useEffect(() => {
    if (!cvSceneObjects?.objects?.length) return;
    setCvNavigationData(cvSceneObjects, navTargets, navData);
    setPipeline((prev) => {
      const syncedAssets = syncAssetsWithCvObjects(
        prev.assets,
        cvSceneObjects,
        evidenceFrames,
        navTargets
      );
      setExerciseWorkers((prevWorkers) => {
        let nextW = prevWorkers;
        for (const w of prevWorkers) {
          if (w.state === 'WALKING_TO_FAULT' && w.targetAssetId) {
            const targetAsset = syncedAssets.find((a) => a.asset_id === w.targetAssetId);
            if (targetAsset) {
              nextW = assignWorkerToAsset(nextW, w.id, targetAsset, hazardNodes, railMode, {
                holdAtTarget: Boolean(w.holdAtTarget)
              });
            }
          }
        }
        return nextW;
      });
      return {
        ...prev,
        assets: syncedAssets
      };
    });
  }, [cvSceneObjects, evidenceFrames, navTargets, navData]);

  // Avatar routes: equal-clearance rail routes from the backend replan (default) or Ahmad's precomputed ESDF paths
  useEffect(() => {
    if (!cvSceneObjects?.objects?.length) return;
    const railTargets = useRailRoutes && sceneEdit.replan?.targets?.length ? sceneEdit.replan : null;
    setCvNavigationData(cvSceneObjects, railTargets || navTargets, navData);
    setNavVersion((v) => v + 1);
  }, [cvSceneObjects, sceneEdit.replan, useRailRoutes, navTargets, navData]);

  const handlePatchCvOverride = (patchMap) => {
    setCvOverridesMap((prev) => {
      const next = { ...prev };
      Object.entries(patchMap).forEach(([objId, fields]) => {
        next[objId] = { ...(next[objId] || {}), ...fields };
      });
      saveStoredOverrides(next);
      return next;
    });
  };

  const handleResetCvOverrides = () => {
    clearStoredOverrides();
    setCvOverridesMap(fileCvOverrides);
  };

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

  // Simulation Exercise Mode (Workers permanently in exercise mode: line up at staging station, walk to injected faults, fix & return)
  const exerciseMode = true;
  const setExerciseMode = () => {};
  const [exercisePaused, setExercisePaused] = useState(false);
  const [exerciseWorkers, setExerciseWorkers] = useState(() => createInitialExerciseWorkers(4));
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [autoDispatch, setAutoDispatch] = useState(false);
  const [manualAssignMap, setManualAssignMap] = useState({});
  const [arTrafficSignal, setArTrafficSignal] = useState(null);

  // Diagnostic Assistant (Local RAG over the Excel pack) + guided inspection run
  const [copilotTab, setCopilotTab] = useState('diagnostics'); // 'diagnostics' | 'scene'
  const [diagResponse, setDiagResponse] = useState(() =>
    runDiagnosticQuery('Which assets need attention first?')
  );
  // { assetId, tag, workerId, phase: 'walking' | 'arrived' | 'repairing', follow, passed: [] }
  const [guidedRun, setGuidedRun] = useState(null);
  const [cutawayRequest, setCutawayRequest] = useState(null);

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
    sourceFile: 'Equipment Room.ply (.spz)',
    rawVertices: 1676481,
    activeSplats: 820511,
    anchoredAssets: 30,
    structuralFrames: 441
  });

  const simContextRef = useRef({
    assets: pipeline.assets,
    hazardNodes,
    railMode,
    autoDispatch,
    exercisePaused
  });

  useEffect(() => {
    simContextRef.current = {
      assets: pipeline.assets,
      hazardNodes,
      railMode,
      autoDispatch,
      exercisePaused
    };
  }, [pipeline.assets, hazardNodes, railMode, autoDispatch, exercisePaused]);

  useEffect(() => {
    if (!liveStreaming || exercisePaused) return;
    const timer = setInterval(() => {
      setPipeline((prev) => simulateLiveTelemetryTick(prev));
    }, 2200);
    return () => clearInterval(timer);
  }, [liveStreaming, exercisePaused]);

  // Simulation Exercise Engine Tick (60ms)
  useEffect(() => {
    if (!exerciseMode) return;
    const tick = setInterval(() => {
      const ctx = simContextRef.current;
      if (ctx.exercisePaused) return;
      const obstacles = buildCollisionBoxes(ctx.assets);
      let newlyFixedIds = [];

      setExerciseWorkers((prevWorkers) => {
        const res = stepExerciseSimulation(
          prevWorkers,
          ctx.assets,
          0.06,
          obstacles,
          ctx.hazardNodes,
          ctx.railMode,
          ctx.autoDispatch
        );
        newlyFixedIds = res.completedAssetIds;
        return res.workers;
      });

      if (newlyFixedIds.length > 0) {
        setPipeline((prevPipe) => {
          let nextPipe = prevPipe;
          newlyFixedIds.forEach((assetId) => {
            const target = nextPipe.assets.find((a) => a.asset_id === assetId);
            nextPipe = updateAssetTelemetryInMemory(
              nextPipe,
              assetId,
              {
                vibration_mms: 1.5,
                bearing_temp_c: 53.0,
                stiction_index: 0.1,
                position_pct: target?.telemetry?.setpoint_pct || 64.0
              },
              'NORMAL_OPERATION'
            );
          });
          return nextPipe;
        });
      }
    }, 60);
    return () => clearInterval(tick);
  }, [exerciseMode]);

  const humanPath = useMemo(
    () =>
      computeAStarPath(
        'N-ENTRY',
        selectedAsset?.position || selectedAsset?.approach_point || [0, -1.02, 1.5],
        'human',
        hazardNodes,
        railMode
      ),
    [selectedAsset, hazardNodes, railMode, navVersion]
  );

  const robotPath = useMemo(
    () =>
      computeAStarPath(
        'N-ENTRY',
        selectedAsset?.position || selectedAsset?.approach_point || [0, -1.02, 1.5],
        'robot',
        hazardNodes,
        railMode
      ),
    [selectedAsset, hazardNodes, railMode, navVersion]
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
    [pipeline.assets, hazardNodes, railMode, selectedAsset, navVersion]
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

  const allFaultedAndWatchAssets = useMemo(
    () =>
      sortBySeverity(
        pipeline.assets.filter((a) => a.health_status !== 'healthy')
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
          a.status_reason.toLowerCase().includes(q) ||
          (a.cvObject?.object_id || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
    return sortBySeverity(list);
  }, [pipeline.assets, statusFilter, searchQuery]);

  const handleToggleLeftTab = (navKey) => {
    if (isLeftPanelOpen && activeNav === navKey) {
      setIsLeftPanelOpen(false);
    } else {
      setActiveNav(navKey);
      setIsLeftPanelOpen(true);
    }
  };

  const handleSelectAsset = (assetOrId) => {
    if (!assetOrId) return;
    if (typeof assetOrId === 'string') {
      const found = pipeline.assets.find(
        (a) => a.asset_id === assetOrId || a.tag === assetOrId
      );
      if (found) {
        setSelectedAssetId(found.asset_id);
        if (found.cvObject?.object_id) {
          setSelectedCvObjectId(found.cvObject.object_id);
        }
      }
      return;
    }
    if (assetOrId.asset_id) {
      setSelectedAssetId(assetOrId.asset_id);
      if (assetOrId.cvObject?.object_id) {
        setSelectedCvObjectId(assetOrId.cvObject.object_id);
      }
    }
  };

  const handleMutateTelemetry = (assetId, patch, customReason = null) => {
    setPipeline((prev) => {
      const next = updateAssetTelemetryInMemory(prev, assetId, patch, customReason);
      if (exerciseMode && customReason && customReason !== 'NORMAL_OPERATION') {
        const updatedAsset = next.assets.find((a) => a.asset_id === assetId);
        if (updatedAsset) {
          setExerciseWorkers((prevW) => {
            const alreadyAssigned = prevW.some((w) => w.targetAssetId === assetId && w.state !== 'RETURNING');
            if (alreadyAssigned) return prevW;
            const idleWorker = prevW.find((w) => w.state === 'STANDBY');
            if (!idleWorker) return prevW;
            return assignWorkerToAsset(prevW, idleWorker.id, updatedAsset, hazardNodes, railMode);
          });
        }
      }
      return next;
    });
  };

  const handleAddWorker = (type = 'human') => {
    setExerciseWorkers((prev) => addExerciseWorker(prev, type));
  };

  const handleDeleteWorker = (workerId) => {
    if (!workerId) return;
    setExerciseWorkers((prev) => removeExerciseWorker(prev, workerId));
    setSelectedWorkerId((prevId) => (prevId === workerId ? null : prevId));
  };

  const handleAssignWorkerToFault = (workerId, asset) => {
    if (!workerId || !asset) return;
    setExerciseMode(true);
    setExerciseWorkers((prev) =>
      assignWorkerToAsset(prev, workerId, asset, hazardNodes, railMode)
    );
  };

  // ---- Guided inspection run (Diagnostic Assistant) ----
  const startGuidedInspection = (assetId) => {
    const asset = pipeline.assets.find((a) => a.asset_id === assetId);
    if (!asset) return `Asset ${assetId} is not mapped in the 3D scene.`;
    const current =
      guidedRun &&
      exerciseWorkers.find(
        (w) => w.id === guidedRun.workerId && (w.state === 'WALKING_TO_FAULT' || w.state === 'INSPECTING')
      );
    const worker =
      current ||
      exerciseWorkers.find((w) => w.state === 'STANDBY' && !w.manualControl) ||
      exerciseWorkers.find((w) => w.state === 'RETURNING' && !w.manualControl);
    if (!worker) return 'No technician is free — wait for a repair to finish or add a worker.';
    setExerciseWorkers((prev) =>
      assignWorkerToAsset(prev, worker.id, asset, hazardNodes, railMode, { holdAtTarget: true })
    );
    setSelectedWorkerId(worker.id);
    setSelectedAssetId(asset.asset_id);
    setGuidedRun({
      assetId: asset.asset_id,
      tag: asset.tag,
      workerId: worker.id,
      workerLabel: worker.label,
      phase: 'walking',
      follow: true,
      passed: []
    });
    return null;
  };

  const handleDiagnosticQuery = (query) => {
    let res = runDiagnosticQuery(query, {
      selectedAsset,
      nearbyAssets,
      sceneAssets: pipeline.assets,
      passed: guidedRun?.passed,
      guidedAssetId: guidedRun?.assetId,
      arrived: guidedRun?.phase === 'arrived'
    });
    if (res.kind === 'guide') {
      const err = startGuidedInspection(res.assetId);
      if (err) res = { ...res, headline: err, failed: true };
    }
    if (res.modelCatalogMatch) {
      handleSelectAsset(res.modelCatalogMatch.asset_id);
      setCutawayRequest({ ...res.modelCatalogMatch, ts: Date.now() });
    }
    setDiagResponse({ ...res, query });
  };

  const handleProceedRepair = () => {
    if (!guidedRun) return;
    setExerciseWorkers((prev) => beginRepair(prev, guidedRun.workerId));
    setGuidedRun((prev) => (prev ? { ...prev, phase: 'repairing', follow: false } : prev));
  };

  const handleCancelGuidedRun = () => {
    if (!guidedRun) return;
    setExerciseWorkers((prev) => recallWorker(prev, guidedRun.workerId));
    setGuidedRun(null);
  };

  // Record every asset the guided technician passes (proximity radius) on the way to the target
  useEffect(() => {
    if (!guidedRun || guidedRun.phase !== 'walking' || !nearbyAssets.length) return;
    const known = new Set(guidedRun.passed.map((p) => p.asset_id));
    const fresh = nearbyAssets.filter((n) => n.asset_id !== guidedRun.assetId && !known.has(n.asset_id));
    if (!fresh.length) return;
    setGuidedRun((prev) =>
      prev
        ? {
            ...prev,
            passed: [
              ...prev.passed,
              ...fresh.map((n) => ({ asset_id: n.asset_id, tag: n.tag, distance: n.distanceToAvatar }))
            ]
          }
        : prev
    );
  }, [nearbyAssets, guidedRun]);

  // Arrival → auto-diagnose; repair finished → end the run
  useEffect(() => {
    if (!guidedRun) return;
    const w = exerciseWorkers.find((x) => x.id === guidedRun.workerId);
    if (!w) {
      setGuidedRun(null);
      return;
    }
    if (guidedRun.phase === 'walking' && w.state === 'INSPECTING') {
      const report = diagnose(guidedRun.assetId, {
        sceneAssets: pipeline.assets,
        nearbyAssets,
        passed: guidedRun.passed,
        routeLength: w.pathLength,
        arrived: true
      });
      setGuidedRun((prev) => (prev ? { ...prev, phase: 'arrived' } : prev));
      setDiagResponse({ ...report, query: `Arrived at ${guidedRun.tag} — automatic diagnosis` });
      setCopilotTab('diagnostics');
      setActiveNav('copilot');
      setIsLeftPanelOpen(true);
    } else if (guidedRun.phase === 'walking' && w.state !== 'WALKING_TO_FAULT') {
      setGuidedRun(null); // worker was re-tasked or driven manually
    } else if (guidedRun.phase === 'repairing' && (w.state === 'RETURNING' || w.state === 'STANDBY')) {
      setGuidedRun(null);
    }
  }, [exerciseWorkers, guidedRun]);

  const handleManualUpdateWorkerPose = (workerId, nextX, nextZ, nextAngle, manualControl = true) => {
    if (!workerId) return;
    setExerciseWorkers((prev) =>
      prev.map((w) => {
        if (w.id !== workerId) return w;
        if (!manualControl) {
          return {
            ...w,
            manualControl: false
          };
        }
        return {
          ...w,
          manualControl: true,
          pos: [nextX, -1.02, nextZ],
          position: [nextX, -1.02, nextZ],
          angle: nextAngle
        };
      })
    );
  };

  const handleInjectRandomFault = () => {
    const healthyCandidates = pipeline.assets.filter((a) => a.health_status === 'healthy');
    const pool = healthyCandidates.length > 0 ? healthyCandidates : pipeline.assets;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!pick) return;
    setSelectedAssetId(pick.asset_id);
    handleMutateTelemetry(
      pick.asset_id,
      {
        vibration_mms: 8.1,
        bearing_temp_c: 87.5,
        stiction_index: 0.68
      },
      'CRITICAL_FAULT_INJECTED'
    );
  };

  const handleRestoreAllNominal = () => {
    setPipeline((prev) => {
      let next = prev;
      prev.assets.forEach((a) => {
        if (a.health_status !== 'healthy') {
          next = updateAssetTelemetryInMemory(
            next,
            a.asset_id,
            {
              vibration_mms: 1.5,
              bearing_temp_c: 53.0,
              stiction_index: 0.1,
              position_pct: a.telemetry?.setpoint_pct || 64.0
            },
            'NORMAL_OPERATION'
          );
        }
      });
      return next;
    });
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
          <span className="brand-product">DNA SpatialSense · 3D Digital Twin</span>
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
            <option value="equipment_room">Area 01 — Equipment Room (.spz)</option>
            <option value="boiler_room">Area 02 — Boiler House (.spz)</option>
          </select>
        </nav>

        {/* Mode Switcher Segmented Pill */}
        <div className="mode-switcher" role="radiogroup" aria-label="Application Mode">
          <button
            className={`mode-btn ${appMode === 'consumer' ? 'active consumer' : ''}`}
            onClick={() => setAppMode('consumer')}
            title="Consumer Mode — Clean, surface-level spatial overview"
          >
            <Eye size={13} />
            <span>Consumer Mode</span>
          </button>
          <button
            className={`mode-btn ${appMode === 'technician' ? 'active technician' : ''}`}
            onClick={() => setAppMode('technician')}
            title="Technical Mode — In-depth database telemetry, dispatch & CV diagnostics"
          >
            <Wrench size={13} />
            <span>Technical Console</span>
          </button>
        </div>

        <div className="topbar-right">
          {/* Permanent Upload .PLY file button available in both modes at all times */}
          <button
            className="topbar-upload-ply"
            onClick={() =>
              handleDiagnosticQuery('Find the pump on the boiler feedwater line and show me the seal.')
            }
            title="Demo: Find P-002 Generic Centrifugal Pump on Boiler Feedwater Line, slide casing open & inspect Mechanical Seal"
            style={{ borderColor: '#00f2ff', color: '#ecfeff' }}
          >
            <span>🔬 Pump Seal Cutaway (P-002)</span>
          </button>

          <button
            className="topbar-upload-ply"
            onClick={() => fileInputRef.current?.click()}
            title="Upload custom .PLY / Point Cloud scan file"
          >
            <Upload size={13} />
            <span>Upload .PLY</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".ply"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Technical Mode Specific Quick Controls */}
          {appMode === 'technician' && (
            <>
              <div className="alarm-counter" title="Open Alerts & Fault Dispatch">
                <button
                  onClick={() => {
                    setActiveNav('alerts');
                    setIsLeftPanelOpen(true);
                  }}
                >
                  <span className="sq" style={{ background: 'var(--critical)' }} />
                  <span className="mono">{counts.critical}</span>
                  <span>Alarm</span>
                </button>
                <button
                  onClick={() => {
                    setActiveNav('alerts');
                    setIsLeftPanelOpen(true);
                  }}
                >
                  <span className="sq" style={{ background: 'var(--high)' }} />
                  <span className="mono">{counts.high}</span>
                  <span>Degraded</span>
                </button>
                <button
                  onClick={() => {
                    setActiveNav('alerts');
                    setIsLeftPanelOpen(true);
                  }}
                >
                  <span className="sq" style={{ background: 'var(--medium)' }} />
                  <span className="mono">{counts.medium}</span>
                  <span>Watch</span>
                </button>
              </div>

              <button
                className="live-toggle"
                onClick={() => {
                  setActiveNav('cv_review');
                  setIsLeftPanelOpen(true);
                }}
                title="Open Computer Vision 3D Object Detection & Label Review (441 OBBs)"
              >
                <Camera size={13} />
                <span>CV Detections ({cvSceneObjects?.objects?.length || 441})</span>
              </button>

              <button
                className="live-toggle"
                onClick={() => setLiveStreaming((s) => !s)}
                title="Toggle historian live polling"
              >
                <span className={`live-dot ${liveStreaming ? 'on' : ''}`} />
                <span>{liveStreaming ? 'Live telemetry' : 'Polling paused'}</span>
              </button>

              <button
                className="live-toggle"
                onClick={() => setIsArHudOpen(true)}
                title="Open mobile field verification dialog"
              >
                <QrCode size={13} />
                <span>Field Verify</span>
              </button>
            </>
          )}

          <a
            href="/viewer.html"
            className="topbar-meta"
            style={{ color: 'var(--topbar-text)' }}
            title="Open standalone 1M-splat Gaussian viewer"
          >
            <span>Splat Viewer</span>
            <ExternalLink size={12} />
          </a>

          <div className="user-chip">
            <span className="avatar">MV</span>
            <span>M. Virtanen</span>
          </div>
        </div>
      </header>

      {/* ==================== WORKSPACE ==================== */}
      <div
        className={`workspace ${
          appMode === 'consumer' ? 'consumer-mode' : 'technical-mode'
        }`}
      >
        {/* Floating Horizontal Navigation Tabs Bar (Technical Mode) */}
        {appMode === 'technician' && (
          <div className="tech-horizontal-nav" role="tablist" aria-label="Technical console modules">
            <button
              type="button"
              className={`tech-nav-pill ${isLeftPanelOpen && activeNav === 'alerts' ? 'active' : ''}`}
              onClick={() => handleToggleLeftTab('alerts')}
              title="Alerts, Fault Injection & Line Dispatch"
            >
              <Bell size={13} />
              <span>Alerts &amp; Faults</span>
              {allFaultedAndWatchAssets.length > 0 && (
                <span className="tech-badge alert">{allFaultedAndWatchAssets.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`tech-nav-pill ${isLeftPanelOpen && activeNav === 'assets' ? 'active' : ''}`}
              onClick={() => handleToggleLeftTab('assets')}
              title="Asset Register"
            >
              <List size={13} />
              <span>Assets</span>
              <span className="tech-badge">{pipeline.assets.length}</span>
            </button>
            <button
              type="button"
              className={`tech-nav-pill ${isLeftPanelOpen && activeNav === 'cv_review' ? 'active' : ''}`}
              onClick={() => handleToggleLeftTab('cv_review')}
              title="Computer Vision 3D OBB Review"
            >
              <Camera size={13} />
              <span>CV Review</span>
              <span className="tech-badge">{cvSceneObjects?.objects?.length || 441}</span>
            </button>
            <button
              type="button"
              className={`tech-nav-pill ${isLeftPanelOpen && activeNav === 'vision' ? 'active' : ''}`}
              onClick={() => handleToggleLeftTab('vision')}
              title="Visual Inspection: AI reads real photos (valve state, gauges, identity) with cited evidence"
            >
              <Eye size={13} />
              <span>Visual AI</span>
            </button>
            <button
              type="button"
              className={`tech-nav-pill ${isLeftPanelOpen && activeNav === 'scene_edit' ? 'active' : ''}`}
              onClick={() => handleToggleLeftTab('scene_edit')}
              title="Scene Editing & AI Object Movement"
            >
              <Move size={13} />
              <span>Move Objects</span>
            </button>
            <button
              type="button"
              className={`tech-nav-pill ${isLeftPanelOpen && activeNav === 'navigate' ? 'active' : ''}`}
              onClick={() => handleToggleLeftTab('navigate')}
              title="Mobility & Fleet Routing"
            >
              <Navigation size={13} />
              <span>Routing</span>
            </button>
            <button
              type="button"
              className={`tech-nav-pill ${isLeftPanelOpen && activeNav === 'workorders' ? 'active' : ''}`}
              onClick={() => handleToggleLeftTab('workorders')}
              title="SAP PM Work Orders & Scenarios"
            >
              <ClipboardList size={13} />
              <span>Orders</span>
              {workOrderAssets.length > 0 && (
                <span className="tech-badge order">{workOrderAssets.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`tech-nav-pill ${isLeftPanelOpen && activeNav === 'copilot' ? 'active' : ''}`}
              onClick={() => handleToggleLeftTab('copilot')}
              title="Edge AI Diagnostic & Scene Command Copilot"
            >
              <MessageSquare size={13} />
              <span>Copilot</span>
            </button>
            <button
              type="button"
              className={`tech-nav-pill ${isLeftPanelOpen && activeNav === 'settings' ? 'active' : ''}`}
              onClick={() => handleToggleLeftTab('settings')}
              title="Scene & Display Settings"
            >
              <Sliders size={13} />
              <span>Settings</span>
            </button>

            <div className="tech-nav-divider" />

            <button
              type="button"
              className={`tech-nav-pill ${isRightPanelOpen ? 'active' : ''}`}
              onClick={() => setIsRightPanelOpen((open) => !open)}
              title="Toggle Asset Telemetry Inspector"
            >
              <Activity size={13} />
              <span>Inspector {selectedAsset ? `(${selectedAsset.tag})` : ''}</span>
            </button>
          </div>
        )}

        {/* 1. LEFT TECHNICAL CONSOLE (COLLAPSIBLE SLIDE-OUT DRAWER) */}
        {appMode === 'technician' && isLeftPanelOpen && (
          <aside className="sidepanel tech-sidepanel">
            <div className="tech-panel-header">
              <div className="tech-panel-header-info">
                <span className="tech-panel-title">
                  {activeNav === 'alerts' && 'System Alerts & Dispatch'}
                  {activeNav === 'assets' && 'Asset Register'}
                  {activeNav === 'cv_review' && 'CV 3D Detections & Crops'}
                  {activeNav === 'vision' && 'Visual Inspection (Gemini)'}
                  {activeNav === 'scene_edit' && 'Move Objects & Rebuild Rails'}
                  {activeNav === 'navigate' && 'Mobility & Fleet Routing'}
                  {activeNav === 'workorders' && 'Work Orders & Scenarios'}
                  {activeNav === 'copilot' && 'Edge AI Copilot & Scene Commands'}
                  {activeNav === 'settings' && 'Scene & Display Settings'}
                </span>
                <span className="tech-panel-count">
                  {activeNav === 'alerts' && `${allFaultedAndWatchAssets.length} active`}
                  {activeNav === 'assets' && `${filteredAssets.length} of ${pipeline.assets.length}`}
                  {activeNav === 'cv_review' && `${cvSceneObjects?.objects?.length || 441} OBBs`}
                  {activeNav === 'vision' && 'AI Vision'}
                  {activeNav === 'scene_edit' && `${sceneEdit.movables?.length || 10} movables`}
                  {activeNav === 'navigate' && 'Multi-Agent Fleet'}
                  {activeNav === 'workorders' && `${workOrderAssets.length} open`}
                  {activeNav === 'copilot' && 'Online'}
                  {activeNav === 'settings' && '3DGS + CAD'}
                </span>
              </div>
              <button
                type="button"
                className="tech-panel-close"
                onClick={() => setIsLeftPanelOpen(false)}
                title="Collapse panel"
                aria-label="Collapse panel"
              >
                <X size={15} />
              </button>
            </div>
          {activeNav === 'alerts' && (
            <>
              <div className="panel-toolbar stack" style={{ gap: '8px' }}>
                <div className="row" style={{ gap: '6px' }}>
                  <button
                    className={`btn btn-sm ${exercisePaused ? 'btn-primary' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => setExercisePaused((p) => !p)}
                    title="Freeze time to inject multiple faults at once before workers walk out"
                  >
                    {exercisePaused ? <Play size={12} /> : <Pause size={12} />}
                    <span>{exercisePaused ? 'Resume Time' : 'Pause Time'}</span>
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={handleRestoreAllNominal}
                    title="Reset all components to healthy nominal state"
                  >
                    <CheckCircle2 size={12} />
                    <span>Clear All</span>
                  </button>
                </div>

                <div className="row" style={{ gap: '6px' }}>
                  <button
                    className="btn btn-sm btn-danger"
                    style={{ flex: 1 }}
                    onClick={() => {
                      if (!selectedAsset) return;
                      handleMutateTelemetry(
                        selectedAsset.asset_id,
                        {
                          vibration_mms: 8.2,
                          bearing_temp_c: 88.0,
                          stiction_index: 0.66
                        },
                        'CRITICAL_FAULT_INJECTED'
                      );
                    }}
                  >
                    <Zap size={12} />
                    <span>Fault {selectedAsset?.tag}</span>
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    style={{ flex: 1 }}
                    onClick={handleInjectRandomFault}
                  >
                    <Zap size={12} />
                    <span>Random Fault</span>
                  </button>
                </div>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={autoDispatch}
                    onChange={(e) => setAutoDispatch(e.target.checked)}
                  />
                  <span>Auto-dispatch standby workers to all active faults</span>
                </label>
              </div>

              <div className="panel-body">
                {/* WORKER STAGING LINE ROSTER */}
                <div className="section stack">
                  <div className="section-title">
                    <span>Staging Line Roster ({exerciseWorkers.length} Units)</span>
                    <span className="mono">
                      {exerciseWorkers.filter((w) => w.state === 'STANDBY').length} Standby
                    </span>
                  </div>

                  <div className="row" style={{ gap: '6px' }}>
                    <button
                      className="btn btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => handleAddWorker('human')}
                    >
                      <Plus size={12} />
                      <span>Add Technician</span>
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => handleAddWorker('robot')}
                    >
                      <Plus size={12} />
                      <span>Add AMR</span>
                    </button>
                  </div>

                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: '56px' }}>Unit</th>
                        <th>State / Traffic</th>
                        <th className="right" style={{ width: '36px' }}>
                          Del
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {exerciseWorkers.map((w) => {
                        const isSel = selectedWorkerId === w.id;
                        return (
                          <tr
                            key={w.id}
                            className={isSel ? 'selected' : ''}
                            onClick={() => setSelectedWorkerId(isSel ? null : w.id)}
                          >
                            <td className="mono" style={{ fontWeight: 600 }}>
                              <span
                                className="legend-swatch"
                                style={{ backgroundColor: w.color }}
                              />
                              {w.id}
                            </td>
                            <td className="mono" style={{ fontSize: '11px' }}>
                              {w.state === 'STANDBY' && (
                                <span className="muted">STANDBY (Line Slot)</span>
                              )}
                              {w.state === 'WALKING_TO_FAULT' && (
                                <span style={{ color: 'var(--info)' }}>
                                  EN ROUTE → {w.targetTag}
                                  {w.trafficStatus === 'YIELDING'
                                    ? ' [YIELD]'
                                    : w.trafficStatus === 'PASSING_RIGHT'
                                    ? ' [LANE R]'
                                    : ''}
                                </span>
                              )}
                              {w.state === 'REPAIRING' && (
                                <span style={{ color: 'var(--brand)', fontWeight: 600 }}>
                                  FIXING {w.targetTag} ({Math.round(w.repairProgress)}%)
                                </span>
                              )}
                              {w.state === 'RETURNING' && (
                                <span className="text-2">
                                  RETURNING → Line
                                  {w.trafficStatus === 'YIELDING' ? ' [YIELD]' : ''}
                                </span>
                              )}
                            </td>
                            <td className="right">
                              <button
                                className="btn btn-sm btn-icon"
                                title={`Delete ${w.id} (or click in 3D + press Delete)`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteWorker(w.id);
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ACTIVE FAULTS & MANUAL WORKER ASSIGNMENT */}
                <div className="section" style={{ padding: 0 }}>
                  <div className="section-title" style={{ padding: '10px 12px 4px' }}>
                    <span>Active Faults ({allFaultedAndWatchAssets.length})</span>
                    <span className="mono">Manual / Auto Dispatch</span>
                  </div>

                  {allFaultedAndWatchAssets.length === 0 ? (
                    <div style={{ padding: '16px 12px', color: 'var(--text-3)', fontSize: '12px' }}>
                      All 30 components are operating nominally. Click <strong>Random Fault</strong>{' '}
                      above or click any equipment in the 3D viewport to inject a fault.
                    </div>
                  ) : (
                    allFaultedAndWatchAssets.map((asset) => {
                      const st = statusOf(asset);
                      const isSelected = selectedAsset?.asset_id === asset.asset_id;
                      const assignedWorker = exerciseWorkers.find(
                        (w) => w.targetAssetId === asset.asset_id && w.state !== 'RETURNING'
                      );
                      const standbyWorkers = exerciseWorkers.filter((w) => w.state === 'STANDBY');
                      const chosenWorkerId =
                        manualAssignMap[asset.asset_id] ||
                        standbyWorkers[0]?.id ||
                        exerciseWorkers[0]?.id ||
                        '';

                      return (
                        <div
                          key={asset.asset_id}
                          className={`alert-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSelectAsset(asset)}
                        >
                          <div className="row" style={{ gap: '6px' }}>
                            <span className={`sdot ${st.cls}`} />
                            <span className="mono" style={{ fontWeight: 600 }}>
                              {asset.tag}
                            </span>
                            <span className="mono muted">{asset.asset_id}</span>
                            {asset.cvObject?.object_id && (
                              <span className="mono muted" style={{ fontSize: '10.5px' }}>
                                · {asset.cvObject.object_id}
                              </span>
                            )}
                            <span className="spacer" />
                            <span className={`status ${st.cls}`}>
                              {st.label} · {asset.health_score}%
                            </span>
                          </div>

                          <div className="text-2" style={{ fontSize: '12px' }}>
                            {asset.service_description} —{' '}
                            <strong style={{ color: 'var(--text)' }}>
                              {humanize(asset.status_reason)}
                            </strong>
                          </div>

                          {assignedWorker ? (
                            <div
                              style={{
                                background: 'var(--bg-subtle)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius)',
                                padding: '6px 8px',
                                marginTop: '2px'
                              }}
                            >
                              <div className="row" style={{ gap: '6px', fontSize: '11px' }}>
                                <Wrench
                                  size={12}
                                  className={assignedWorker.state === 'REPAIRING' ? 'tool-spin' : ''}
                                />
                                <span className="mono" style={{ fontWeight: 600 }}>
                                  {assignedWorker.id}
                                </span>
                                <span>
                                  {assignedWorker.state === 'REPAIRING'
                                    ? `Repairing component (${Math.round(
                                        assignedWorker.repairProgress
                                      )}%)`
                                    : `Walking to ${asset.tag}...`}
                                </span>
                              </div>
                              {assignedWorker.state === 'REPAIRING' && (
                                <div className="repair-bar" style={{ marginTop: '5px' }}>
                                  <div
                                    style={{
                                      width: `${Math.round(assignedWorker.repairProgress)}%`
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div
                              className="alert-assign-row"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <select
                                className="select"
                                style={{ height: '24px', fontSize: '11px', padding: '0 6px' }}
                                value={chosenWorkerId}
                                onChange={(e) =>
                                  setManualAssignMap((prev) => ({
                                    ...prev,
                                    [asset.asset_id]: e.target.value
                                  }))
                                }
                              >
                                {exerciseWorkers.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.id} ({w.type === 'human' ? 'Tech' : 'AMR'} · {w.state})
                                  </option>
                                ))}
                              </select>
                              <button
                                className="btn btn-sm btn-primary"
                                disabled={!chosenWorkerId}
                                onClick={() =>
                                  handleAssignWorkerToFault(chosenWorkerId, asset)
                                }
                              >
                                <Wrench size={11} />
                                <span>Assign &amp; Fix</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}

          {activeNav === 'assets' && (
            <>
              <div className="panel-toolbar">
                <div className="input-wrap">
                  <Search size={14} />
                  <input
                    type="text"
                    className="input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by tag, OBJ-ID, service, or area..."
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

          {activeNav === 'cv_review' && (
            <CvReviewPanel
              cvSceneObjects={cvSceneObjects}
              cvMetrics={cvMetrics}
              evidenceFrames={evidenceFrames}
              assets={pipeline.assets}
              selectedCvObjectId={selectedCvObjectId}
              onSelectCvObject={(obj) => {
                if (obj?.object_id) setSelectedCvObjectId(obj.object_id);
              }}
              onSelectAsset={handleSelectAsset}
              showAllCvDetections={showAllCvDetections}
              onToggleShowAllCvDetections={setShowAllCvDetections}
              onPatchCvOverride={handlePatchCvOverride}
              onResetCvOverrides={handleResetCvOverrides}
            />
          )}

          {activeNav === 'vision' && (
            <SceneInspectorPanel selectedCvObjectId={selectedCvObjectId} selectedAsset={selectedAsset} />
          )}

          {activeNav === 'scene_edit' && (
            <SceneEditPanel
              cvSceneObjects={cvSceneObjects}
              selectedCvObjectId={selectedCvObjectId}
              selectedAsset={selectedAsset}
              sceneEdit={sceneEdit}
              splatMover={splatMover}
              onSelectCvObject={(id) => id && setSelectedCvObjectId(id)}
              useRailRoutes={useRailRoutes}
              onToggleRailRoutes={setUseRailRoutes}
            />
          )}

          {activeNav === 'navigate' && (
            <>
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
              nearbyAssets={nearbyAssets}
              tab={copilotTab}
              onTabChange={setCopilotTab}
              response={diagResponse}
              onAsk={handleDiagnosticQuery}
              guidedRun={guidedRun}
              onStartGuidedRun={(assetId) => {
                const err = startGuidedInspection(assetId);
                if (err) setDiagResponse({ kind: 'guide', failed: true, headline: err, citations: [] });
              }}
              onProceedRepair={handleProceedRepair}
              onCancelGuidedRun={handleCancelGuidedRun}
              onToggleFollow={() =>
                setGuidedRun((prev) => (prev ? { ...prev, follow: !prev.follow } : prev))
              }
              sceneEdit={sceneEdit}
              splatMover={splatMover}
              selectedCvObjectId={selectedCvObjectId}
              onOpen3dCutaway={(m) => {
                handleSelectAsset(m.asset_id);
                setCutawayRequest({ ...m, ts: Date.now() });
              }}
            />
          )}

          {activeNav === 'settings' && (
            <>
              <div className="panel-body">
                <div className="section stack">
                  <div className="section-title">
                    <span>3D Capture Source (.spz / .ply)</span>
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
                        Area 01 — Equipment Room (.spz · 1.67M raw splats)
                      </option>
                      <option value="boiler_room">
                        Area 02 — Boiler House (.spz · 1.50M raw splats)
                      </option>
                    </select>
                  </div>

                  <div>
                    <div className="field-label">
                      <span>3D Rendering Mode</span>
                    </div>
                    <div className="seg">
                      <button
                        className={viewMode === 'splat' ? 'active' : ''}
                        onClick={() => setViewMode('splat')}
                      >
                        3DGS (.spz)
                      </button>
                      <button
                        className={viewMode === 'hybrid' ? 'active' : ''}
                        onClick={() => setViewMode('hybrid')}
                      >
                        Hybrid
                      </button>
                      <button
                        className={viewMode === 'cad' ? 'active' : ''}
                        onClick={() => setViewMode('cad')}
                      >
                        Clean CAD
                      </button>
                    </div>
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
                    <span>Computer Vision &amp; Layers</span>
                  </div>

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={ceilingCutaway}
                      onChange={(e) => setCeilingCutaway(e.target.checked)}
                    />
                    <span>Automatic ceiling cutaway when orbiting from above</span>
                  </label>

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={showAllCvDetections}
                      onChange={(e) => setShowAllCvDetections(e.target.checked)}
                    />
                    <span>Show all 441 CV-detected OBBs (off = 30 bound only)</span>
                  </label>

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

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={arFirstPersonMode}
                      onChange={(e) => setArFirstPersonMode(e.target.checked)}
                    />
                    <span>1st-Person Technician AR Visor &amp; Drive Pad</span>
                  </label>
                </div>
              </div>
            </>
          )}
          </aside>
        )}

        {/* 2. CENTER 3D VIEWPORT */}
        <BoilerRoomViewport
          appMode={appMode}
          showWorkers={appMode === 'technician'}
          onSwitchToTechnicianMode={(asset) => {
            if (asset) handleSelectAsset(asset);
            setAppMode('technician');
            setIsRightPanelOpen(true);
          }}
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
          exerciseMode={exerciseMode}
          onToggleExerciseMode={setExerciseMode}
          exercisePaused={exercisePaused}
          onToggleExercisePaused={setExercisePaused}
          exerciseWorkers={exerciseWorkers}
          selectedWorkerId={selectedWorkerId}
          onSelectWorker={setSelectedWorkerId}
          onAddWorker={handleAddWorker}
          onDeleteWorker={handleDeleteWorker}
          onAssignWorkerToFault={handleAssignWorkerToFault}
          onManualUpdateWorkerPose={handleManualUpdateWorkerPose}
          onInjectRandomFault={handleInjectRandomFault}
          autoDispatch={autoDispatch}
          onToggleAutoDispatch={setAutoDispatch}
          onArTrafficSignalChange={setArTrafficSignal}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          ceilingCutaway={ceilingCutaway}
          onToggleCeilingCutaway={setCeilingCutaway}
          cvSceneObjects={cvSceneObjects}
          showAllCvDetections={showAllCvDetections}
          onToggleShowAllCvDetections={setShowAllCvDetections}
          objectMoves={objectMoves}
          onMoveCvObject={handleMoveCvObject}
          onResetCvMoves={handleResetCvMoves}
          selectedCvObjectId={selectedCvObjectId}
          onSelectCvObject={(obj) => {
            if (obj?.object_id) setSelectedCvObjectId(obj.object_id);
          }}
          onSceneReady={setSceneCtx}
          guidedRun={guidedRun}
          cutawayRequest={cutawayRequest}
        />

        {/* 3. RIGHT ASSET INSPECTOR (COLLAPSIBLE SLIDE-OUT DRAWER) */}
        {appMode === 'technician' && isRightPanelOpen && (
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
            onOpenCvReview={(objId) => {
              if (objId) setSelectedCvObjectId(objId);
              setActiveNav('cv_review');
              setIsLeftPanelOpen(true);
            }}
            onClose={() => setIsRightPanelOpen(false)}
          />
        )}
      </div>

      {/* ==================== BOTTOM STATUS BAR ==================== */}
      <footer className={`statusbar ${appMode === 'consumer' ? 'consumer-statusbar' : ''}`}>
        <span>
          <span className="conn-dot" />
          <span>Valmet DNA Historian &amp; 3DGS Engine: Online</span>
        </span>
        {appMode === 'technician' ? (
          <>
            <span className="mono">
              Scene: {sceneStats.sourceFile} ({sceneStats.activeSplats.toLocaleString()} splats)
            </span>
            <span className="mono">
              CV OBBs: {cvSceneObjects?.objects?.length || 441} ({pipeline.assets.length} bound)
            </span>
            <span className="mono">
              Rev. {pipeline.version} ({pipeline.lastUpdated})
            </span>
            <span className="right mono">
              Selected: {selectedAsset?.tag}{' '}
              {selectedAsset?.cvObject?.object_id ? `(${selectedAsset.cvObject.object_id})` : ''} [
              {selectedAsset?.position.map((v) => v.toFixed(2)).join(', ')} m]
            </span>
          </>
        ) : (
          <span className="right mono">
            {selectedAsset
              ? `Selected: ${selectedAsset.tag} — ${selectedAsset.service_description}`
              : 'Click any equipment in the 3D twin to inspect'}
          </span>
        )}
      </footer>

      <MobileArFieldHudModal
        isOpen={isArHudOpen}
        onClose={() => setIsArHudOpen(false)}
        selectedAsset={selectedAsset}
        checkedLotoSteps={checkedLotoSteps}
        onToggleLotoStep={handleToggleLotoStep}
        humanPath={humanPath}
        arTrafficSignal={arTrafficSignal}
      />
    </div>
  );
}
