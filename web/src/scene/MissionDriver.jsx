import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { cachedResource, fetchCopilot } from "../data.js";
import { useStore } from "../store.js";
import { activeAt, driveEnd, missionDuration, sampleAt, simulateMission, stateAt, TIMING } from "./mission.js";
import { runtime } from "./missionRuntime.js";

const STORE_HZ = 10;
const ARRIVED_HOLD_S = 0.5;
const POST_ARRIVAL = new Set(["arrived", "diagnosing", "report"]);

function prepare(nav, sceneObjects) {
  const bound = sceneObjects.objects.filter((o) => o.asset_id);
  runtime.nav = nav;
  runtime.duration = missionDuration(nav.samples);
  runtime.approachStart = driveEnd(nav.samples) - TIMING.approachS;
  runtime.events = simulateMission(nav.samples, bound, sceneObjects.metres_per_unit ?? 1);
}

function tagOf(s, assetId) {
  return s.assets.find((a) => a.asset_id === assetId)?.tag ?? assetId;
}

function requestStatusLines(s, objectIds) {
  for (const id of objectIds) {
    const assetId = s.sceneObjects.objects.find((o) => o.object_id === id)?.asset_id;
    if (!assetId || s.statusLines[assetId]) continue;
    cachedResource(`copilot:${assetId}:status_line`, () => fetchCopilot(assetId, "status_line"))
      .then((answer) => answer?.summary && useStore.getState().setStatusLine(assetId, answer.summary))
      .catch(() => {});
  }
}

// Mission state machine. Owns the exact clock in `runtime`, writes the store
// at 10 Hz, and treats any other change of store.mission.t as a slider scrub.
export function MissionDriver() {
  const local = useRef({
    runId: -1,
    lastWritten: 0,
    sinceWrite: 0,
    preRoll: 0,
    hold: 0, // seconds played since arriving; pausing holds it
    diagnosis: null, // { assetId, elapsed, answer, error }
    nearbyKey: "",
  });

  useFrame((_, delta) => {
    const s = useStore.getState();
    const { nav, mission, sceneObjects } = s;
    if (!nav?.samples?.length || !sceneObjects) return;
    const l = local.current;
    const dt = Math.min(delta, 0.1);
    if (nav !== runtime.nav) prepare(nav, sceneObjects);

    let state = mission.state;
    const logArrival = () =>
      s.pushFeed({
        id: "arrived",
        t: runtime.duration,
        kind: "arrived",
        assetId: mission.targetAssetId,
        text: `Arrived at ${tagOf(s, mission.targetAssetId)} approach pose`,
      });
    const setState = (next, patch = {}) => {
      state = next;
      runtime.state = next;
      runtime.version += 1;
      l.lastWritten = patch.t ?? mission.t;
      s.setMission({ state: next, ...patch });
    };

    if (mission.runId !== l.runId) {
      Object.assign(l, { runId: mission.runId, lastWritten: 0, sinceWrite: 0, preRoll: 0, hold: 0, diagnosis: null });
      runtime.t = 0;
      runtime.state = state;
      runtime.version += 1;
    } else if (state !== "idle" && mission.t !== l.lastWritten) {
      // Slider scrub.
      runtime.t = Math.min(Math.max(mission.t, 0), runtime.duration);
      l.lastWritten = mission.t;
      if (runtime.t < runtime.duration) {
        l.diagnosis = null;
        setState(stateAt(runtime.t, runtime.duration, runtime.approachStart), { t: mission.t });
      } else if (!POST_ARRIVAL.has(state)) {
        setState("arrived", { t: mission.t });
        l.hold = 0;
      }
      s.setMission({ feed: mission.feed.filter((e) => e.kind === "dispatch" || e.t <= runtime.t) });
      if (state === "arrived") logArrival();
    }

    const playing = s.running;
    if (state === "dispatched") {
      if (playing) l.preRoll += dt;
      if (l.preRoll >= TIMING.preRollS) setState("en_route", { t: 0 });
    } else if (state === "en_route" || state === "approaching") {
      if (playing) runtime.t = Math.min(runtime.duration, runtime.t + dt * mission.speed);
      const next = stateAt(runtime.t, runtime.duration, runtime.approachStart);
      if (next !== state) {
        setState(next, { t: runtime.t });
        if (next === "arrived") {
          l.hold = 0;
          logArrival();
        }
      }
    } else if (state === "arrived") {
      if (playing) l.hold += dt;
    }
    if (state === "arrived" && l.hold >= ARRIVED_HOLD_S) {
      const assetId = mission.targetAssetId;
      const d = { assetId, elapsed: 0, answer: null, error: null };
      l.diagnosis = d;
      cachedResource(`copilot:${assetId}:arrival_diagnosis`, () => fetchCopilot(assetId, "arrival_diagnosis")).then(
        (answer) => (d.answer = answer),
        (error) => (d.error = error),
      );
      setState("diagnosing");
      s.pushFeed({ id: "diagnosing", t: runtime.duration, kind: "diagnosing", assetId, text: "Running grounded diagnosis" });
    } else if (state === "diagnosing") {
      const d = l.diagnosis;
      if (d && playing) d.elapsed += dt;
      if (!d) {
        l.hold = 0;
        setState("arrived");
      } else if ((d.answer || d.error) && d.elapsed >= TIMING.minDiagnosisS) {
        const confidence = d.answer?.confidence?.score;
        s.pushFeed({
          id: "report",
          t: runtime.duration,
          kind: d.error ? "error" : "report",
          assetId: d.assetId,
          text: d.error
            ? "Diagnosis unavailable (backend offline, no snapshot)"
            : `Diagnosis ready${confidence != null ? `, confidence ${Math.round(confidence * 100)}%` : ""}${d.answer.snapshot ? " (snapshot)" : ""}`,
        });
        setState("report", { diagnosisAt: Date.now() });
        s.selectAsset(d.assetId);
        s.setUi({ inspectorOpen: true, inspectorTab: "evidence", fullscreen: false });
      }
    } else if (state === "idle") {
      runtime.t = 0;
    }

    sampleAt(nav.samples, runtime.t, runtime.pose);
    if (runtime.state !== state) {
      runtime.state = state;
      runtime.version += 1;
    }

    l.sinceWrite += dt;
    if (l.sinceWrite < 1 / STORE_HZ) return;
    l.sinceWrite = 0;

    if (state !== "idle" && state !== "dispatched" && Math.abs(runtime.t - l.lastWritten) > 1e-6) {
      const t = Math.round(runtime.t * 100) / 100;
      l.lastWritten = t;
      s.setMission({ t });
    }

    const active = state === "idle" || state === "dispatched" ? [] : activeAt(runtime.events, runtime.t);
    const key = active.join(",");
    if (key !== l.nearbyKey) {
      const entered = active.filter((id) => !runtime.active.includes(id));
      l.nearbyKey = key;
      runtime.active = active;
      runtime.version += 1;
      const byId = new Map(sceneObjects.objects.map((o) => [o.object_id, o]));
      s.setNearby(active.map((id) => byId.get(id)).filter(Boolean));
      requestStatusLines(s, entered);
    }

    if (state !== "idle" && state !== "dispatched") {
      const feedIds = new Set(useStore.getState().mission.feed.map((e) => e.id));
      for (const e of runtime.events) {
        if (e.t > runtime.t) break;
        if (e.type !== "scanned" || feedIds.has(`scan:${e.objectId}`)) continue;
        const assetId = sceneObjects.objects.find((o) => o.object_id === e.objectId)?.asset_id;
        s.pushFeed({
          id: `scan:${e.objectId}`,
          t: e.t,
          kind: "scanned",
          assetId,
          objectId: e.objectId,
          text: `Scanned ${tagOf(s, assetId)} at ${e.distanceM.toFixed(1)} m`,
        });
      }
    }
  });

  return null;
}
