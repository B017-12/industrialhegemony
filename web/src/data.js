import { useEffect, useState } from "react";
import { useStore } from "./store.js";

export const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const TARGET_ASSET = "ASSET-014";
const SNAPSHOT = "/data/api";
const HEALTH_INTERVAL_MS = 15000;
const REQUEST_TIMEOUT_MS = 4000;

export async function getJson(apiPath, localPath) {
  try {
    const response = await fetch(`${API}${apiPath}`);
    if (response.ok) return await response.json();
  } catch {
    // Backend is optional for static demo mode.
  }
  const fallback = await fetch(localPath);
  if (!fallback.ok) throw new Error(`Unable to load ${apiPath} or ${localPath}`);
  return fallback.json();
}

export async function postJson(apiPath, body) {
  const response = await fetch(`${API}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 4),
  });
  if (!response.ok) throw Object.assign(new Error(await response.text()), { status: response.status });
  return response.json();
}

// Vite answers unknown paths with index.html, so check the content type.
export async function getOptionalJson(path) {
  try {
    const response = await fetch(path);
    const type = response.headers.get("content-type") || "";
    return response.ok && type.includes("json") ? response.json() : null;
  } catch {
    return null;
  }
}

// Backend first, then the snapshot written by scripts/snapshot-api.mjs.
// When the health poll has marked the backend down, go straight to the snapshot.
async function apiOrSnapshot(apiPath, snapshotFile) {
  if (useStore.getState().backend !== "static") {
    const response = await fetch(`${API}${apiPath}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => null);
    if (response?.ok) return { data: await response.json(), source: "api" };
    if (response && response.status < 500) throw new Error(`${response.status}: ${await response.text()}`);
  }
  if (snapshotFile) {
    const data = await getOptionalJson(`${SNAPSHOT}/${snapshotFile}`);
    if (data) return { data, source: "snapshot" };
  }
  throw new Error(`Backend unreachable and no snapshot for ${apiPath}`);
}

const data = (promise) => promise.then((r) => r.data);

export const fetchAssets = () => data(apiOrSnapshot("/api/assets", "assets.json"));
export const fetchAsset = (id) => data(apiOrSnapshot(`/api/assets/${id}`, `assets/${id}.json`));
export const fetchTelemetry = (id) => data(apiOrSnapshot(`/api/assets/${id}/telemetry`, `telemetry/${id}.json`));
export const fetchEvents = (id) => data(apiOrSnapshot(`/api/assets/${id}/events?limit=500`, `events/${id}.json`));
export const fetchAnchors = () => data(apiOrSnapshot("/api/scene/anchors", "anchors.json"));

export async function fetchOpenEventCounts(assetIds) {
  if (useStore.getState().backend !== "static") {
    try {
      const totals = await Promise.all(
        assetIds.map(async (id) => {
          const r = await fetch(`${API}/api/assets/${id}/events?status=open&limit=1`, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (!r.ok) throw new Error(String(r.status));
          return [id, (await r.json()).total];
        }),
      );
      return Object.fromEntries(totals);
    } catch {
      // fall through to the snapshot
    }
  }
  const snapshot = await getOptionalJson(`${SNAPSHOT}/open_events.json`);
  if (!snapshot) throw new Error("Open-event counts unavailable");
  return snapshot.by_asset;
}

// Copilot answers; the snapshot holds the deterministic (no-key) answers.
export async function fetchCopilot(assetId, mode) {
  if (useStore.getState().backend !== "static") {
    try {
      return { ...(await postJson("/api/copilot/query", { asset_id: assetId, mode })), snapshot: false };
    } catch (error) {
      if (error.status && error.status < 500) throw error;
    }
  }
  const snapshot = await getOptionalJson(`${SNAPSHOT}/copilot/${assetId}.${mode}.json`);
  if (!snapshot) throw new Error("Copilot unavailable: backend offline and no snapshot");
  return { ...snapshot, snapshot: true };
}

export const fetchBuilderQuestions = () => data(apiOrSnapshot("/api/workbook/builder-questions", "builder_questions.json"));

async function snapshotOr(file, message) {
  const snapshot = await getOptionalJson(`${SNAPSHOT}/${file}`);
  if (!snapshot) throw Object.assign(new Error(message), { offline: true });
  return { ...snapshot, snapshot: true };
}

// Work-order draft (display only; the backend writes nothing).
export async function fetchWorkOrderDraft(assetId) {
  if (useStore.getState().backend !== "static") {
    try {
      return { ...(await postJson("/api/work-orders/draft", { asset_id: assetId })), snapshot: false };
    } catch (error) {
      if (error.status && error.status < 500) throw error;
    }
  }
  return snapshotOr(`work_orders/${assetId}.draft.json`, "Drafting needs the live API; no offline draft for this asset.");
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: data.length ? JSON.parse(data.join("\n")) : null };
}

// Copilot answer over POST /api/copilot/stream. EventSource is GET-only, so
// read the body with a stream reader. Deltas are word chunks of the already
// validated summary; the `answer` event carries the full response.
// `snapshotKey` names the offline answer file used when the backend is down.
export async function streamCopilot({ assetId, mode, question, snapshotKey }, { onMeta, onDelta, signal } = {}) {
  if (useStore.getState().backend !== "static") {
    let response = null;
    try {
      response = await fetch(`${API}/api/copilot/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ asset_id: assetId, mode, question }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    if (response && !response.ok && response.status < 500) {
      throw Object.assign(new Error(`${response.status}: ${await response.text()}`), { status: response.status });
    }
    if (response?.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let cut = buffer.indexOf("\n\n");
        while (cut >= 0) {
          const { event, data: payload } = parseSseBlock(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 2);
          if (event === "meta") onMeta?.(payload);
          else if (event === "delta") onDelta?.(payload.text);
          else if (event === "answer") answer = payload;
          cut = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (!answer) throw new Error("Stream ended without an answer");
      return { ...answer, snapshot: false };
    }
  }
  if (!snapshotKey) {
    throw Object.assign(new Error("Chat needs the live API; this question has no offline answer."), { offline: true });
  }
  return snapshotOr(`copilot/${assetId}.${snapshotKey}.json`, "Chat needs the live API; this question has no offline answer.");
}

export async function searchApi(query) {
  if (useStore.getState().backend !== "online") return null;
  const r = await fetch(`${API}/api/search?q=${encodeURIComponent(query)}&limit=12`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return r.ok ? r.json() : null;
}

export async function checkHealth() {
  try {
    const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (r.ok && (await r.json()).ok) return "online";
  } catch {
    // backend down
  }
  return (await getOptionalJson(`${SNAPSHOT}/manifest.json`)) ? "static" : "offline";
}

export function startHealthPoll() {
  let stopped = false;
  const tick = async () => {
    const status = await checkHealth();
    if (stopped) return;
    const { backend, setBackend } = useStore.getState();
    if (status !== backend) setBackend(status);
  };
  tick();
  const id = setInterval(tick, HEALTH_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

const cache = new Map();

// Cached async resource. The cache key includes the data epoch, which the
// store bumps when the backend comes back online, so panels refetch live data.
export function useResource(key, load) {
  const epoch = useStore((s) => s.dataEpoch);
  const ready = useStore((s) => s.backend !== "checking");
  const fullKey = key && ready ? `${epoch}:${key}` : null;
  const [state, setState] = useState(() => snapshotState(fullKey));

  useEffect(() => {
    if (!fullKey) {
      setState({ loading: Boolean(key), data: null, error: null });
      return undefined;
    }
    let entry = cache.get(fullKey);
    if (!entry) {
      entry = { promise: load() };
      entry.promise.then(
        (value) => Object.assign(entry, { data: value, done: true }),
        (error) => {
          Object.assign(entry, { error, done: true });
          cache.delete(fullKey);
        },
      );
      cache.set(fullKey, entry);
    }
    if (entry.done && !entry.error) {
      setState({ loading: false, data: entry.data, error: null });
      return undefined;
    }
    let alive = true;
    setState({ loading: true, data: null, error: null });
    entry.promise.then(
      (value) => alive && setState({ loading: false, data: value, error: null }),
      (error) => alive && setState({ loading: false, data: null, error }),
    );
    return () => {
      alive = false;
    };
    // `load` is expected to change with `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey]);

  return state;
}

// Imperative counterpart of useResource on the same cache, so the 3D layer can
// prefetch what a panel will show (for example the arrival diagnosis).
export function cachedResource(key, load) {
  const fullKey = `${useStore.getState().dataEpoch}:${key}`;
  let entry = cache.get(fullKey);
  if (!entry) {
    entry = { promise: load() };
    entry.promise.then(
      (value) => Object.assign(entry, { data: value, done: true }),
      () => cache.delete(fullKey),
    );
    cache.set(fullKey, entry);
  }
  return entry.promise;
}

function snapshotState(fullKey) {
  const entry = fullKey && cache.get(fullKey);
  if (entry?.done && !entry.error) return { loading: false, data: entry.data, error: null };
  return { loading: true, data: null, error: null };
}

export { applyOverrides } from "./review/overrides.js";

const EMPTY_OVERRIDES = { schema_version: "1.0", overrides: {} };

// Live overrides from the backend (they change while reviewing), else the static copy.
export async function fetchOverrides() {
  try {
    const response = await fetch(`${API}/api/labels/overrides`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.ok) return { data: await response.json(), source: "api" };
  } catch {
    // fall through to the static copy
  }
  return { data: (await getOptionalJson("/data/derived/labels_override.json")) ?? EMPTY_OVERRIDES, source: "static" };
}

export async function loadSceneData() {
  const [objects, nav, overrides] = await Promise.all([
    getJson("/api/scene/objects", "/data/derived/scene_objects.json"),
    getJson(`/api/scene/nav?target=${TARGET_ASSET}`, "/data/derived/nav.json"),
    fetchOverrides(),
  ]);
  return { baseSceneObjects: objects, labelOverrides: overrides.data, nav };
}

async function sendJson(method, apiPath, body) {
  const response = await fetch(`${API}${apiPath}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 4),
  });
  if (!response.ok) {
    let detail = await response.text();
    try {
      const parsed = JSON.parse(detail).detail;
      detail = Array.isArray(parsed) ? parsed.map((d) => d.msg).join("; ") : parsed;
    } catch {
      // keep the raw text
    }
    throw Object.assign(new Error(detail || `${response.status}`), { status: response.status });
  }
  return response.json();
}

// Label review (Tab 8). Writes need the live backend; there is no snapshot.
export const patchOverride = (objectId, body) => sendJson("PATCH", `/api/labels/overrides/${objectId}`, body);
export const restoreOverrides = (reviewer, entries) => sendJson("POST", "/api/labels/restore", { reviewer, entries });
export const uploadCrop = (objectId, payload) => sendJson("POST", `/api/labels/crops/${objectId}`, payload);
export const fetchLabelSummary = () => sendJson("GET", "/api/labels/summary");
export const fetchCrops = () => sendJson("GET", "/api/labels/crops").catch(() => ({ crops: {} }));
export const fetchVlmLabels = () => sendJson("GET", "/api/labels/vlm").catch(() => null);
export const cropUrl = (objectId, version) => `${API}/api/labels/crops/${objectId}.png?v=${encodeURIComponent(version ?? "")}`;

// Static files from scripts/sync-public.mjs, so dispatch and the minimap work offline.
export const loadNavTargets = () => getOptionalJson("/data/derived/nav_targets.json");

export async function loadNavMap() {
  const [yamlResponse, pgmResponse] = await Promise.all([
    fetch("/data/derived/nav_map.yaml"),
    fetch("/data/derived/nav_map.pgm"),
  ]);
  if (!yamlResponse.ok || !pgmResponse.ok) return null;
  const yaml = await yamlResponse.text();
  const number = (key) => Number(yaml.match(new RegExp(`^${key}:\\s*([-\\d.e]+)`, "m"))?.[1]);
  const origin = yaml.match(/^origin:\s*\[([^\]]+)\]/m)?.[1].split(",").map(Number) ?? [0, 0, 0];
  const bytes = new Uint8Array(await pgmResponse.arrayBuffer());
  // P5 header: magic, width, height, maxval, each separated by whitespace.
  const fields = [];
  let i = 0;
  while (fields.length < 4) {
    while (/\s/.test(String.fromCharCode(bytes[i]))) i += 1;
    let token = "";
    while (!/\s/.test(String.fromCharCode(bytes[i]))) token += String.fromCharCode(bytes[i++]);
    fields.push(token);
  }
  if (fields[0] !== "P5") return null;
  const width = Number(fields[1]);
  const height = Number(fields[2]);
  return { width, height, resolution: number("resolution"), origin, pixels: bytes.subarray(i + 1, i + 1 + width * height) };
}
