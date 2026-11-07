// Snapshot the backend routes the UI shell reads into public/data/api/, so the
// app shows the same real workbook data when FastAPI is not running.
// Usage: start the backend on :8000, then `npm run snapshot` (or API_URL=... node scripts/snapshot-api.mjs).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SNAPSHOT_CHAT_ASSETS, SUGGESTED_QUESTIONS } from "../src/ui/copilot/questions.js";

const API = process.env.API_URL || "http://localhost:8000";
const OUT = resolve("public/data/api");

async function get(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function post(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

let bytes = 0;
function write(file, value) {
  const path = resolve(OUT, file);
  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(value);
  bytes += text.length;
  writeFileSync(path, text);
}

const health = await get("/api/health").catch((error) => {
  console.error(`Backend not reachable at ${API}. Start it first:\n  cd backend && python3 -m uvicorn app.main:app --port 8000`);
  console.error(String(error));
  process.exit(1);
});
if (!health.ok) throw new Error("Backend health is not ok");

rmSync(OUT, { recursive: true, force: true });
const assets = await get("/api/assets");
write("assets.json", assets);
write("anchors.json", await get("/api/scene/anchors"));

const openByAsset = {};
const generations = {};
for (const { asset_id: id } of assets) {
  write(`assets/${id}.json`, await get(`/api/assets/${id}`));
  write(`telemetry/${id}.json`, await get(`/api/assets/${id}/telemetry`));
  write(`events/${id}.json`, await get(`/api/assets/${id}/events?limit=500`));
  openByAsset[id] = (await get(`/api/assets/${id}/events?status=open&limit=1`)).total;
  for (const mode of ["status_line", "arrival_diagnosis"]) {
    const answer = await post("/api/copilot/query", { asset_id: id, mode });
    generations[answer.generation] = (generations[answer.generation] || 0) + 1;
    write(`copilot/${id}.${mode}.json`, answer);
  }
}
write("builder_questions.json", await get("/api/workbook/builder-questions"));
for (const id of SNAPSHOT_CHAT_ASSETS) {
  for (const q of SUGGESTED_QUESTIONS) {
    const answer = await post("/api/copilot/query", { asset_id: id, mode: "question", question: q.text });
    generations[answer.generation] = (generations[answer.generation] || 0) + 1;
    write(`copilot/${id}.question.${q.id}.json`, answer);
  }
  write(`work_orders/${id}.draft.json`, await post("/api/work-orders/draft", { asset_id: id }));
}

const totalOpen = Object.values(openByAsset).reduce((a, b) => a + b, 0);
write("open_events.json", { by_asset: openByAsset, total: totalOpen });
write("manifest.json", {
  generated_at: new Date().toISOString(),
  api: API,
  assets: assets.length,
  open_events: totalOpen,
  copilot_generation: generations,
  chat_assets: SNAPSHOT_CHAT_ASSETS,
  note: "Verbatim backend responses for offline mode. Regenerate after the workbook or pipeline changes.",
});

console.log(`Wrote ${assets.length} assets, ${totalOpen} open events, copilot ${JSON.stringify(generations)}`);
console.log(`${(bytes / 1e6).toFixed(2)} MB in ${OUT}`);
