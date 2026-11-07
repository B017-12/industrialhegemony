import { create } from "zustand";
import { applyOverrides } from "./review/overrides.js";
import { missionDuration, navForTarget } from "./scene/mission.js";

export const CAMERA_MODES = ["overview", "mission", "free"];

const IDLE_MISSION = { state: "idle", t: 0, feed: [], diagnosisAt: null };

export const MISSION_STATES = ["idle", "dispatched", "en_route", "approaching", "arrived", "diagnosing", "report"];

// Shared app state. The 3D layer reads it with getState()/subscribe inside
// useFrame and effects, so HUD updates never re-render the scene graph.
export const useStore = create((set, get) => ({
  // sceneObjects is baseSceneObjects (pipeline output) with labelOverrides
  // merged in and rejected/merged objects removed; see review/overrides.js.
  sceneObjects: null,
  baseSceneObjects: null,
  labelOverrides: null,
  // Active mission route. baseNav is the default (nav.json); dispatching to
  // another asset swaps nav for its nav_targets.json mission.
  nav: null,
  baseNav: null,
  navTargets: null,
  assets: [],
  // asset_id -> one-sentence copilot status_line, fetched as assets come in range.
  statusLines: {},
  dataStatus: "Loading scene...",

  selectedId: null,
  // Derived from selectedId through the object's asset_id; set directly only
  // for assets that have no scene object.
  selectedAssetId: null,
  running: true,
  nearby: [],

  splat: {
    state: "idle", // idle | loading | decoding | ready | error
    mode: "spark", // spark | fallback | none
    url: null,
    loadedBytes: 0,
    totalBytes: 0,
    splatCount: null,
    loadMs: null,
    fallbackReason: null,
  },

  perf: { fps: null, frameMs: null },
  viewRequest: 0,

  // checking | online (FastAPI reachable) | static (snapshot files) | offline (neither)
  backend: "checking",
  dataEpoch: 0,
  anchors: null,
  openEvents: null,

  ui: {
    railOpen: true,
    inspectorOpen: true,
    fullscreen: false,
    inspectorTab: "overview",
    railGroup: "status", // status | class
    railStatus: "all",
    railQuery: "",
    paletteOpen: false,
    cameraMode: "overview", // one of CAMERA_MODES; dragging the view switches to free
    evidenceId: null, // evidence ID open in the inspector's evidence drawer
    mode: "operate", // operate | review (label review replaces the inspector)
  },

  // Label review (Tab 8). The object under review is selectedId; tour is the
  // crop tour's progress, written by scene/CropTour.jsx.
  review: {
    tour: { state: "idle", done: 0, total: 0, failed: 0, objectIds: [] }, // idle | running | cancelling
    cropsVersion: 0,
  },

  // Search matches lit up in 3D: {query, assetIds} or null.
  highlight: null,
  // Bumped to fly the camera to the selected object even if it is already selected.
  flyRequest: 0,

  // scene/MissionDriver.jsx owns the state machine: it writes state and t
  // (10 Hz) and the feed. The timeline slider writes t to scrub.
  mission: {
    ...IDLE_MISSION,
    duration: null, // last nav sample t
    speed: 1, // playback multiplier, 0.5 | 1 | 2
    targetAssetId: null,
    runId: 0, // bumped on every dispatch so the driver resets its clock
  },

  setSceneData: (patch) =>
    set((s) => {
      const next = { ...patch };
      const base = patch.baseSceneObjects ?? s.baseSceneObjects;
      if (base && (patch.baseSceneObjects || patch.labelOverrides)) {
        next.sceneObjects = applyOverrides(base, patch.labelOverrides ?? s.labelOverrides);
      }
      if (patch.nav) {
        next.baseNav = patch.nav;
        if (s.mission.duration == null) {
          next.mission = {
            ...s.mission,
            duration: missionDuration(patch.nav.samples ?? []) || patch.nav.stats?.duration_s || null,
            targetAssetId: patch.nav.target_asset_id ?? null,
          };
        }
      }
      return next;
    }),

  // Returns false when the asset has no reachable approach pose.
  dispatchMission: (assetId) => {
    const s = get();
    const targetId = assetId ?? s.mission.targetAssetId ?? s.baseNav?.target_asset_id;
    const nav = navForTarget(s.baseNav, s.navTargets, targetId);
    if (!nav?.samples?.length) return false;
    const tag = s.assets.find((a) => a.asset_id === targetId)?.tag ?? targetId;
    set({
      nav,
      running: true,
      mission: {
        ...s.mission,
        ...IDLE_MISSION,
        state: "dispatched",
        duration: missionDuration(nav.samples),
        targetAssetId: targetId,
        runId: s.mission.runId + 1,
        feed: [{ id: "dispatch", t: 0, kind: "dispatch", assetId: targetId, text: `Dispatched to ${tag}` }],
      },
      ui: { ...s.ui, cameraMode: "mission" },
    });
    return true;
  },
  restartMission: () =>
    set((s) => ({
      running: true,
      mission: { ...s.mission, ...IDLE_MISSION, runId: s.mission.runId + 1 },
      ui: { ...s.ui, cameraMode: "overview" },
      viewRequest: s.viewRequest + 1,
    })),
  pushFeed: (entry) =>
    set((s) =>
      s.mission.feed.some((e) => e.id === entry.id) ? {} : { mission: { ...s.mission, feed: [...s.mission.feed, entry] } },
    ),
  setStatusLine: (assetId, line) => set((s) => ({ statusLines: { ...s.statusLines, [assetId]: line } })),
  setCameraMode: (cameraMode) => set((s) => ({ ui: { ...s.ui, cameraMode } })),
  setSelectedId: (selectedId) => {
    const object = selectedId ? get().sceneObjects?.objects.find((o) => o.object_id === selectedId) : null;
    const selectedAssetId = object?.asset_id ?? null;
    set((s) => ({
      selectedId,
      selectedAssetId,
      ui: selectedAssetId === s.selectedAssetId ? s.ui : { ...s.ui, evidenceId: null },
    }));
  },
  selectAsset: (assetId) => {
    if (!assetId) {
      set((s) => ({ selectedId: null, selectedAssetId: null, ui: { ...s.ui, evidenceId: null } }));
      return;
    }
    const asset = get().assets.find((a) => a.asset_id === assetId);
    const objectId =
      asset?.scene_object_id ?? get().sceneObjects?.objects.find((o) => o.asset_id === assetId)?.object_id ?? null;
    set((s) => ({
      selectedId: objectId,
      selectedAssetId: assetId,
      ui: { ...s.ui, inspectorOpen: true, evidenceId: assetId === s.selectedAssetId ? s.ui.evidenceId : null },
    }));
  },
  // Select an asset and fly the camera to it, even when it is already selected.
  focusAsset: (assetId) => {
    get().selectAsset(assetId);
    set((s) => ({ flyRequest: s.flyRequest + 1 }));
  },
  openEvidence: (evidenceId) => set((s) => ({ ui: { ...s.ui, evidenceId, inspectorOpen: true } })),
  closeEvidence: () => set((s) => ({ ui: { ...s.ui, evidenceId: null } })),
  setHighlight: (highlight) => set({ highlight: highlight?.assetIds?.length ? highlight : null }),
  toggleRunning: () => set((s) => ({ running: !s.running })),
  setNearby: (nearby) => set({ nearby }),
  setSplat: (patch) => set((s) => ({ splat: { ...s.splat, ...patch } })),
  setPerf: (perf) => set({ perf }),
  requestFitView: () => set((s) => ({ viewRequest: s.viewRequest + 1 })),

  setBackend: (backend) =>
    set((s) => ({
      backend,
      dataEpoch: backend === "online" && s.backend !== "checking" ? s.dataEpoch + 1 : s.dataEpoch,
    })),
  // Swap in a new labels_override.json (after a review write or a refetch) without reloading the scene.
  setLabelOverrides: (labelOverrides) =>
    set((s) => {
      if (!s.baseSceneObjects) return { labelOverrides };
      const sceneObjects = applyOverrides(s.baseSceneObjects, labelOverrides);
      const object = s.selectedId ? sceneObjects.objects.find((o) => o.object_id === s.selectedId) : null;
      // An asset with no scene object stays selected; otherwise follow the object's (possibly new) binding.
      const selectedAssetId = object ? (object.asset_id ?? null) : s.selectedId ? null : s.selectedAssetId;
      return { labelOverrides, sceneObjects, selectedId: object ? s.selectedId : null, selectedAssetId };
    }),
  setReviewMode: (on) =>
    set((s) => ({
      ui: { ...s.ui, mode: on ? "review" : "operate", inspectorOpen: on ? true : s.ui.inspectorOpen, evidenceId: null },
      highlight: on ? null : s.highlight,
    })),
  setReview: (patch) => set((s) => ({ review: { ...s.review, ...patch } })),
  setTour: (patch) => set((s) => ({ review: { ...s.review, tour: { ...s.review.tour, ...patch } } })),
  setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
  toggleUi: (key) => set((s) => ({ ui: { ...s.ui, [key]: !s.ui[key] } })),
  setMission: (patch) => set((s) => ({ mission: { ...s.mission, ...patch } })),
}));

if (import.meta.env.DEV) window.__store = useStore;
