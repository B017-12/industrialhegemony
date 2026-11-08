/**
 * In-browser diagnostic assistant ("Local RAG") over the Excel builder pack.
 *
 * - Corpus: src/data/excelKnowledgePack.js (generated from builder_pack.xlsx) + the assumed
 *   process topology + illustrative service playbooks.
 * - Retrieval: BM25 over chunks that each carry a citable source id.
 * - Spatial context: nearby assets around the technician, assets passed on the guided route and
 *   3D distances between the target and its upstream/downstream neighbours.
 *
 * Every statement in a report cites pack ids (asset, case, doc, work order, event, DQ issue) or a
 * telemetry pseudo-id `TEL:<tag>:<signal>`. Nothing calls a network service.
 */

import { PACK } from '../data/excelKnowledgePack.js';
import {
  PROCESS_EDGES,
  TOPOLOGY_DISCLAIMER,
  UTILITY_DEPENDENCIES,
  downstreamOf,
  instrumentsOf,
  upstreamOf
} from '../data/processTopology.js';
import { ISSUE_PLAYBOOKS, PLAYBOOK_DISCLAIMER, getPlaybook } from '../data/issuePlaybooks.js';
import { getPartVisualSpec } from '../data/excelPartCatalog.js';

export const PRESET_QUERIES = [
  'Diagnose P-002',
  'Guide me to P-005',
  "What's around me?",
  'What upstream and downstream checks for CV-003?',
  'Which assets need attention first?'
];

const ASSETS = Object.values(PACK.assets);
const BY_TAG = Object.fromEntries(ASSETS.map((a) => [a.tag, a]));
const URGENCY_RANK = { high: 0, medium: 1, routine: 2, low: 3 };
const DEV_THRESHOLD = 8; // % deviation from healthy-class baseline counted as abnormal
const TREND_THRESHOLD = 3; // % of baseline change over 3 days counted as a trend

/** Maps each issue code to the Maintenance_History action used for effort / outcome priors. */
const ISSUE_ACTION = {
  CAVITATION_RISK: 'condition inspection',
  FOULING: 'planned pump service',
  SEAL_DEGRADATION: 'seal inspection',
  MISALIGNMENT: 'alignment check',
  CURRENT_IMBALANCE: 'electrical condition check',
  OVERHEATING: 'cooling inspection',
  POSITION_DEVIATION: 'actuator inspection',
  CALIBRATION_DRIFT: 'calibration verification',
  ACTUATOR_FRICTION: 'actuator inspection',
  STICTION_TREND: 'diagnostic review',
  SUPPLY_PRESSURE_LOW: 'actuator inspection',
  SEAT_LEAKAGE_SUSPECTED: 'planned valve service',
  BEARING_WEAR: 'bearing inspection',
  SENSOR_DRIFT: 'reference comparison',
  SIGNAL_DROPOUT: 'signal verification',
  CALIBRATION_DUE: 'calibration verification',
  MOUNTING_ISSUE: 'mounting inspection'
};

const SIGNAL_LABEL = {
  process_pressure_bar: ['Process pressure', 'bar'],
  process_flow_pct: ['Process flow', '%'],
  position_setpoint_pct: ['Position setpoint', '%'],
  position_actual_pct: ['Position actual', '%'],
  position_error_pct: ['Position error |actual − setpoint|', '%'],
  pneumatic_supply_bar: ['Pneumatic supply', 'bar'],
  stiction_index: ['Stiction index', ''],
  load_for_opening_pct: ['Load for opening', '%'],
  vibration_mm_s: ['Vibration', 'mm/s'],
  bearing_temp_c: ['Bearing temperature', '°C'],
  motor_current_a: ['Motor current', 'A'],
  speed_rpm: ['Speed', 'rpm'],
  signal_quality_pct: ['Signal quality', '%'],
  sensor_bias: ['Sensor bias', '']
};

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

/** Resolve a tag ("P-002", "p002"), asset id ("ASSET-014") or scene asset object to a pack asset. */
export function findAsset(ref) {
  if (!ref) return null;
  if (typeof ref === 'object') return PACK.assets[ref.asset_id] || BY_TAG[ref.tag] || null;
  const s = String(ref).trim().toUpperCase();
  if (PACK.assets[s]) return PACK.assets[s];
  const m = s.match(/^(CV|PT|VS|P|M)-?(\d{1,3})$/);
  return m ? BY_TAG[`${m[1]}-${m[2].padStart(3, '0')}`] || null : null;
}

const isUnhealthy = (a) => a && a.condition_state !== 'healthy';
const itemName = (a) => `${a.tag} · ${humanClass(a.asset_class)} (${a.area_name})`;
const humanClass = (c) => String(c || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
const fmt = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));
const signed = (v, d = 0) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(d)}`);
const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : '—');

/** Compact metadata for proximity cards in the 3D view. */
export function assetCard(ref) {
  const a = findAsset(ref);
  if (!a) return null;
  return {
    asset_id: a.asset_id,
    tag: a.tag,
    name: itemName(a),
    asset_class: a.asset_class,
    area_name: a.area_name,
    criticality: a.criticality,
    health_score: a.health_score,
    condition_state: a.condition_state,
    issue_code: a.issue_code,
    urgency: a.urgency,
    last_service_date: dateOnly(a.last_service_date),
    recommended_next_check: a.recommended_next_check
  };
}

// ---------------------------------------------------------------------------------------------
// Retrieval (BM25 over pack chunks)
// ---------------------------------------------------------------------------------------------

const STOP = new Set('the a an and or of to for in on at is are be it this that with what which how why me my i do does about from by as can should'.split(' '));

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b(cv|pt|vs|p|m)-?(\d{3})\b/g, '$1-$2')
    .split(/[^a-z0-9_-]+/)
    .flatMap((t) => (t.includes('_') ? [t, ...t.split('_')] : [t]))
    .filter((t) => t && !STOP.has(t));
}

function buildChunks() {
  const chunks = [];
  const add = (id, title, text, extra = {}) => chunks.push({ id, title, text, ...extra });
  for (const d of PACK.docs) add(d.doc_id, d.title, `${d.scope} ${d.content}`);
  for (const c of PACK.cases)
    add(c.case_id, `${humanClass(c.asset_class)} · ${c.historical_issue_code}`,
      `${c.asset_class} ${c.historical_issue_code} ${c.historical_interpretation}. Next check: ${c.recommended_next_check}. ${c.safe_evidence_workflow} Severity ${c.severity}.`);
  for (const a of ASSETS)
    add(a.asset_id, itemName(a),
      `${a.tag} ${a.asset_class} ${a.area_name} ${a.process_context} ${a.criticality}. Health ${a.health_score}, ${a.condition_state}, ${a.issue_code}: ${a.issue_summary}. Urgency ${a.urgency}. Next check: ${a.recommended_next_check}.`,
      { assetId: a.asset_id });
  for (const [aid, wos] of Object.entries(PACK.workOrders))
    for (const w of wos)
      add(w.work_order_id, `${w.tag} · ${w.action}`,
        `${w.tag} ${w.action} ${w.maintenance_type} priority ${w.priority} result ${w.result} ${w.duration_h} h, downtime ${w.downtime_h} h, ${w.role}, opened ${dateOnly(w.opened_at)}.`,
        { assetId: aid });
  for (const [aid, ev] of Object.entries(PACK.events))
    for (const e of ev.recent)
      add(e.event_id, `${e.tag} · ${e.event_type}`,
        `${e.tag} ${e.event_type} ${e.event_code} severity ${e.severity} ${e.status} ${dateOnly(e.timestamp)}. ${e.description}`,
        { assetId: aid });
  for (const [aid, dq] of Object.entries(PACK.dataQuality))
    for (const q of dq)
      add(q.issue_id, `${q.tag} · data quality`, `${q.tag} ${q.issue_type} severity ${q.severity} in ${q.source_sheet}; handling ${q.recommended_handling}.`, { assetId: aid });
  for (const [code, pb] of Object.entries(ISSUE_PLAYBOOKS))
    add(`PLAYBOOK:${code}`, `Service playbook · ${code}`,
      `${code} ${[...pb.inspect, ...pb.service, ...pb.verify].join(' ')} upstream ${pb.upstreamCheck} downstream ${pb.downstreamCheck}`);
  for (const e of PROCESS_EDGES)
    add(`TOPO:${e.from}>${e.to}`, `${e.from} ${e.relation} ${e.to} (assumed)`, `${e.from} ${e.relation} ${e.to} upstream downstream ${e.note}`);
  return chunks;
}

let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  const chunks = buildChunks();
  const df = new Map();
  const docs = chunks.map((c) => {
    const toks = tokenize(`${c.title} ${c.text}`);
    const tf = new Map();
    toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1));
    return { chunk: c, tf, len: toks.length };
  });
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length;
  INDEX = { docs, df, avg, n: docs.length, byId: new Map(chunks.map((c) => [c.id, c])) };
  return INDEX;
}

export function retrieve(query, k = 5) {
  const { docs, df, avg, n } = index();
  const q = [...new Set(tokenize(query))];
  const k1 = 1.2;
  const b = 0.75;
  return docs
    .map((d) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (n - df.get(t) + 0.5) / (df.get(t) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
      }
      return { ...d.chunk, score };
    })
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}

/** Title + text for a citation id (used by the Sources list). */
export function lookupSource(id) {
  if (id.startsWith('TEL:')) {
    const [, tag, sig] = id.split(':');
    const a = BY_TAG[tag];
    const s = a && PACK.telemetry[a.asset_id]?.signals[sig];
    if (!s) return null;
    const w = PACK.telemetry[a.asset_id].window;
    return {
      title: `Telemetry_Sample_3d · ${tag} · ${sig}`,
      text: `Last 6 h mean ${s.last} (min ${s.min}, max ${s.max}) over ${dateOnly(w.from)} → ${dateOnly(w.to)}; healthy-class median ${s.baseline}; deviation ${signed(s.dev_pct)}%; 3-day trend ${signed(s.trend, 2)}.`
    };
  }
  const c = index().byId.get(id);
  return c ? { title: c.title, text: c.text } : null;
}

// ---------------------------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------------------------

function evaluateSignals(asset, playbook) {
  const sigs = PACK.telemetry[asset.asset_id]?.signals || {};
  const findings = [];
  const used = new Set();
  for (const { signal, expect, why } of playbook.signals) {
    const s = sigs[signal];
    if (!s) continue;
    used.add(signal);
    const trendPct = s.baseline ? (s.trend / Math.abs(s.baseline)) * 100 : 0;
    const hit =
      expect === 'high' ? s.dev_pct >= DEV_THRESHOLD
      : expect === 'low' ? s.dev_pct <= -DEV_THRESHOLD
      : expect === 'up' ? trendPct >= TREND_THRESHOLD
      : trendPct <= -TREND_THRESHOLD;
    const [label, unit] = SIGNAL_LABEL[signal] || [signal, ''];
    findings.push({
      signal,
      supports: hit,
      text: `${label} ${fmt(s.last, 2)} ${unit} vs healthy baseline ${fmt(s.baseline, 2)} (${signed(s.dev_pct)}%, 3-day trend ${signed(s.trend, 2)}) — ${hit ? 'consistent with' : 'does not show'} ${why}.`,
      evidence: [`TEL:${asset.tag}:${signal}`],
      spark: s.spark
    });
  }
  // Other strongly abnormal signals the playbook did not anticipate.
  for (const [signal, s] of Object.entries(sigs)) {
    if (used.has(signal) || s.dev_pct == null || Math.abs(s.dev_pct) < 25) continue;
    if (signal === 'position_setpoint_pct' || signal === 'position_actual_pct') continue;
    const [label, unit] = SIGNAL_LABEL[signal] || [signal, ''];
    findings.push({
      signal,
      supports: null,
      text: `Also abnormal: ${label} ${fmt(s.last, 2)} ${unit} (${signed(s.dev_pct)}% vs baseline).`,
      evidence: [`TEL:${asset.tag}:${signal}`],
      spark: s.spark
    });
  }
  return findings;
}

function sceneDistance(tagA, tagB, sceneAssets) {
  const pa = sceneAssets?.find((s) => s.tag === tagA)?.position;
  const pb = sceneAssets?.find((s) => s.tag === tagB)?.position;
  if (!pa || !pb) return null;
  return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]);
}

function neighbourEntries(list, role, playbook, target, sceneAssets) {
  return list.map((n) => {
    const a = BY_TAG[n.tag];
    const unhealthy = isUnhealthy(a);
    const dist = sceneDistance(target.tag, n.tag, sceneAssets);
    const roleCheck =
      n.relation === 'drives' && role === 'upstream'
        ? 'Confirm the drive is not the cause: stable current and speed, coupling and alignment OK'
        : n.relation === 'drives'
        ? 'Check the driven machine’s load — extra torque demand shows up on this motor'
        : role === 'upstream'
        ? playbook.upstreamCheck
        : playbook.downstreamCheck;
    return {
      tag: n.tag,
      asset_id: a?.asset_id,
      relation: n.relation,
      hops: n.hops,
      via: n.via,
      note: n.note,
      health_score: a?.health_score,
      condition_state: a?.condition_state,
      issue_code: a?.issue_code,
      flag: unhealthy ? (role === 'upstream' ? 'possible cause' : 'may be affected') : 'ok',
      check: unhealthy
        ? `${a.tag} itself shows ${a.issue_code} (health ${a.health_score}) — ${a.recommended_next_check}; rule it in/out as ${role === 'upstream' ? 'a contributor' : 'a consequence'}.`
        : `${roleCheck} (${a ? humanClass(a.asset_class) : n.tag} currently healthy in pack.)`,
      distance_m: dist == null ? null : Number(dist.toFixed(1)),
      evidence: a ? [a.asset_id, role === 'upstream' ? `TOPO:${n.tag}>${n.via}` : `TOPO:${n.via}>${n.tag}`] : []
    };
  });
}

function serviceDue(asset) {
  if (!asset.last_service_date || !asset.service_interval_days) return null;
  const last = new Date(asset.last_service_date);
  const due = new Date(last.getTime() + asset.service_interval_days * 86400000);
  const ref = new Date(PACK.telemetry[asset.asset_id]?.window?.to || Date.now());
  const days = Math.round((due - ref) / 86400000);
  return { last: dateOnly(asset.last_service_date), intervalDays: asset.service_interval_days, due: dateOnly(due.toISOString()), daysUntilDue: days };
}

/**
 * Full diagnosis for one asset.
 * ctx: { sceneAssets, nearbyAssets, passed: [{asset_id, tag, distance}], routeLength, arrived }
 */
export function diagnose(ref, ctx = {}) {
  const asset = findAsset(ref);
  if (!asset) return null;
  const playbook = getPlaybook(asset.issue_code);
  const spec = getPartVisualSpec(asset);
  const cases = PACK.cases.filter((c) => c.asset_class === asset.asset_class && c.historical_issue_code === asset.issue_code);
  const findings = evaluateSignals(asset, playbook);
  const supporting = findings.filter((f) => f.supports === true).length;
  const tested = findings.filter((f) => f.supports !== null).length;

  // Process context
  const upstream = neighbourEntries(upstreamOf(asset.tag, 2), 'upstream', playbook, asset, ctx.sceneAssets);
  const downstream = neighbourEntries(downstreamOf(asset.tag, 2), 'downstream', playbook, asset, ctx.sceneAssets);
  const instruments = instrumentsOf(asset.tag).map((i) => {
    const a = BY_TAG[i.tag];
    return { ...i, asset_id: a?.asset_id, health_score: a?.health_score, condition_state: a?.condition_state, issue_code: a?.issue_code };
  });
  const utilities = UTILITY_DEPENDENCIES[asset.asset_class] || [];

  // Confidence
  const dq = PACK.dataQuality[asset.asset_id] || [];
  const reasons = [`Pack model_confidence ${asset.model_confidence}`];
  let conf = asset.model_confidence;
  const dqReduce = dq.filter((q) => q.recommended_handling === 'reduce_model_confidence');
  if (dqReduce.length) {
    conf -= 0.04 * dqReduce.length;
    reasons.push(`−${(0.04 * dqReduce.length).toFixed(2)} for ${dqReduce.length} data-quality issue(s) (${dqReduce.map((q) => q.issue_id).join(', ')})`);
  }
  const badInstr = instruments.filter((i) => i.relation === 'instrument' && isUnhealthy(BY_TAG[i.tag]));
  if (badInstr.length) {
    conf -= 0.05;
    reasons.push(`−0.05: instrument ${badInstr.map((i) => `${i.tag} (${i.issue_code})`).join(', ')} on this asset is itself degraded`);
  }
  if (tested) {
    const adj = (supporting / tested - 0.5) * 0.1;
    conf += adj;
    reasons.push(`${signed(adj, 2)}: ${supporting}/${tested} expected telemetry signatures present`);
  }
  if (asset.anchor?.mapping_confidence < 0.7)
    reasons.push(`3D identity mapping confidence ${asset.anchor.mapping_confidence} — confirm asset by QR ${asset.qr_id} / NFC ${asset.nfc_id} on site (DOC-3D-MAPPING)`);
  conf = Math.max(0.05, Math.min(0.99, conf));

  // History
  const stats = PACK.workOrderStats[asset.asset_id];
  const recentWos = PACK.workOrders[asset.asset_id] || [];
  const action = ISSUE_ACTION[asset.issue_code];
  const prior = action ? PACK.actionOutcomes[asset.asset_class]?.[action] : null;
  const ev = PACK.events[asset.asset_id];
  const due = serviceDue(asset);

  // Steps (instructions)
  const steps = [
    {
      phase: 'Prepare',
      items: [
        `Confirm identity on site: scan QR ${asset.qr_id} / NFC ${asset.nfc_id} (scene anchor ${asset.anchor?.scene_anchor_id}).`,
        `Obtain work permit; criticality ${asset.criticality} — coordinate with operations before any intervention.`,
        prior
          ? `Plan ~${prior.avg_duration_h} h for "${action}" (fleet avg, ${prior.n} past jobs on ${humanClass(asset.asset_class)}s; usual role: ${Object.keys(prior.roles).sort((x, y) => prior.roles[y] - prior.roles[x])[0]?.replace(/_/g, ' ')}).`
          : 'Review recent work orders for this asset before going to the field.'
      ],
      evidence: [asset.asset_id, asset.anchor?.scene_anchor_id, 'DOC-3D-MAPPING'].filter(Boolean)
    },
    { phase: 'Inspect (no isolation needed)', items: playbook.inspect, evidence: [asset.knowledge_doc_id, ...cases.map((c) => c.case_id)] },
    {
      phase: 'Isolate — illustrative LOTO',
      items: asset.issue_code === 'NORMAL' ? ['Not required — no intervention planned.'] : spec.lotoSteps,
      evidence: ['DOC-FIELD-SAFETY'],
      illustrative: true
    },
    { phase: 'Service', items: playbook.service, evidence: [asset.knowledge_doc_id] },
    {
      phase: 'Verify & restore',
      items: [
        ...playbook.verify,
        'Remove locks only per site LOTO; restart with operations; watch the trend for one shift.',
        'Close the work order with as-found / as-left values so the next diagnosis has evidence.'
      ],
      evidence: ['DOC-RAG-GUIDE']
    }
  ];

  // Spatial
  const passed = (ctx.passed || []).filter((p) => p.asset_id !== asset.asset_id);
  const nearbyNow = (ctx.nearbyAssets || [])
    .filter((n) => n.asset_id !== asset.asset_id)
    .map((n) => ({ ...assetCard(n), distance_m: n.distanceToAvatar }))
    .filter((n) => n.tag);
  const processTags = new Set([...upstream, ...downstream].map((n) => n.tag));
  const spatialNotes = [];
  passed.filter((p) => isUnhealthy(BY_TAG[p.tag])).forEach((p) => {
    const a = BY_TAG[p.tag];
    spatialNotes.push(
      `Passed ${p.tag} on the way (${a.issue_code}, health ${a.health_score})${processTags.has(p.tag) ? ' — it is in this asset\'s process chain' : ''}.`
    );
  });
  [...upstream, ...downstream].filter((n) => n.distance_m != null && n.distance_m < 4).forEach((n) =>
    spatialNotes.push(`${n.tag} (${n.flag === 'ok' ? 'healthy' : n.issue_code}) is ${n.distance_m} m away — check it in the same visit.`)
  );

  const urgentNeighbours = [...upstream, ...downstream].filter((n) => n.flag !== 'ok' && n.hops === 1);
  const headline = asset.issue_code === 'NORMAL'
    ? `${asset.tag} is healthy (health ${asset.health_score}) — no service needed now`
    : `${asset.tag}: ${asset.issue_summary} (${asset.issue_code}) — health ${asset.health_score}, urgency ${asset.urgency}`;
  const summary = [
    `${itemName(asset)}, ${asset.criticality}.`,
    asset.issue_code === 'NORMAL'
      ? 'Current_State reports no significant deviation.'
      : `Observation: ${supporting}/${tested || 0} expected telemetry signatures for ${asset.issue_code} are present. Hypothesis (CASE ${cases.map((c) => c.case_id).join(', ') || 'none'}): ${cases[0]?.historical_interpretation || asset.issue_summary}.`,
    asset.issue_code === 'NORMAL' ? '' : `Recommended next check: ${asset.recommended_next_check}.`,
    urgentNeighbours.length
      ? `Directly connected ${urgentNeighbours.map((n) => `${n.tag} (${n.issue_code})`).join(', ')} also abnormal — check before closing.`
      : ''
  ].filter(Boolean).join(' ');

  const citations = new Set([
    asset.asset_id,
    asset.knowledge_doc_id,
    'DOC-FIELD-SAFETY',
    ...cases.map((c) => c.case_id),
    ...findings.flatMap((f) => f.evidence),
    ...dq.map((q) => q.issue_id),
    ...recentWos.slice(0, 3).map((w) => w.work_order_id),
    ...(ev?.recent || []).slice(0, 3).map((e) => e.event_id),
    ...[...upstream, ...downstream].filter((n) => n.asset_id).map((n) => n.asset_id)
  ]);

  return {
    kind: 'diagnosis',
    asset: assetCard(asset),
    headline,
    summary,
    confidence: { value: Number(conf.toFixed(2)), reasons },
    findings,
    cases: cases.map((c) => ({ case_id: c.case_id, interpretation: c.historical_interpretation, next_check: c.recommended_next_check, severity: c.severity })),
    steps,
    upstream,
    downstream,
    instruments,
    utilities,
    history: {
      stats,
      recent: recentWos.slice(0, 4),
      prior: prior ? { action, ...prior } : null,
      serviceDue: due,
      events: ev ? { open: ev.open, bySeverity: ev.by_severity, recent: ev.recent.slice(0, 3) } : null
    },
    spatial: { arrived: Boolean(ctx.arrived), routeLength: ctx.routeLength ?? null, passed, nearbyNow, notes: spatialNotes },
    caveats: [TOPOLOGY_DISCLAIMER, PLAYBOOK_DISCLAIMER, ...dq.map((q) => `${q.issue_id}: ${q.issue_type.replace(/_/g, ' ')} (${q.severity}) — ${q.recommended_handling.replace(/_/g, ' ')}.`)],
    citations: [...citations].filter(Boolean)
  };
}

// ---------------------------------------------------------------------------------------------
// Query routing
// ---------------------------------------------------------------------------------------------

const TAG_RE = /\b(cv|pt|vs|p|m)-?(\d{1,3})\b|\basset-\d{3}\b/gi;

function extractAssets(q) {
  return [...new Set((q.match(TAG_RE) || []).map((t) => findAsset(t)?.asset_id).filter(Boolean))];
}

function triage() {
  const list = ASSETS.filter(isUnhealthy).sort(
    (a, b) =>
      (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9) ||
      a.criticality.localeCompare(b.criticality) ||
      a.health_score - b.health_score
  );
  return {
    kind: 'triage',
    headline: `${list.length} of ${ASSETS.length} assets need attention`,
    items: list.map((a) => ({ ...assetCard(a), why: a.issue_summary })),
    citations: list.map((a) => a.asset_id)
  };
}

function nearby(ctx) {
  const items = (ctx.nearbyAssets || [])
    .map((n) => ({ ...assetCard(n), distance_m: n.distanceToAvatar }))
    .filter((n) => n.tag)
    .sort((a, b) => (a.distance_m ?? 99) - (b.distance_m ?? 99));
  return {
    kind: 'nearby',
    headline: items.length
      ? `${items.length} asset(s) within range of the technician`
      : 'No mapped assets in range — walk closer or start a guided run',
    items,
    citations: items.map((i) => i.asset_id)
  };
}

/**
 * Route a free-text question.
 * ctx: { selectedAsset, nearbyAssets, sceneAssets, passed, routeLength, arrived, guidedAssetId }
 * Returns one of: diagnosis (with `focus`), guide, nearby, triage, search.
 */
export function answer(query, ctx = {}) {
  const q = String(query || '').trim();
  const lq = q.toLowerCase();
  const mentioned = extractAssets(q);
  const fallbackId = ctx.guidedAssetId || findAsset(ctx.selectedAsset)?.asset_id;
  const targetId = mentioned[0] || fallbackId;

  if (/^(inspect|guide|go|walk|take|navigate|send|dispatch|route)\b|guide me|take me|walk me|go to|bring me/.test(lq)) {
    if (!targetId) return { kind: 'search', headline: 'Which asset? e.g. "guide me to P-005"', results: [], citations: [] };
    const a = PACK.assets[targetId];
    return { kind: 'guide', assetId: targetId, tag: a.tag, headline: `Dispatching a technician to ${a.tag} — assets along the route will be highlighted`, citations: [targetId] };
  }
  if (/around me|nearby|near me|in range|close to me|what('s| is) here|surround/.test(lq)) return nearby(ctx);
  if (!mentioned.length && /attention|priorit|worst|which assets|faulty|overview|triage|first\b/.test(lq)) return triage();

  let focus = null;
  if (/upstream|downstream|previous|subsequent|before and after|process chain|feeds|connected|related process/.test(lq)) focus = 'process';
  else if (/loto|lockout|lock out|isolat|tag ?out|safe|safety|procedure|instruction|steps|how (do|to)/.test(lq)) focus = 'steps';
  else if (/history|work order|last service|maintenance|previous repair|wo-/.test(lq)) focus = 'history';
  else if (/telemetry|signal|trend|evidence|why/.test(lq)) focus = 'findings';

  const diagIntent = /diagnos|repair|fix|fault|issue|problem|wrong|status|health|next|recommend|service|check/.test(lq);
  if (targetId && (mentioned.length || focus || diagIntent)) {
    const rep = diagnose(targetId, { ...ctx, arrived: ctx.arrived && targetId === ctx.guidedAssetId });
    return { ...rep, focus };
  }

  const results = retrieve(q, 5);
  return {
    kind: 'search',
    headline: results.length ? `Top ${results.length} matches in the Excel pack` : 'No match in the Excel pack — try a tag (P-002) or an issue (cavitation)',
    results: results.map((r) => ({ id: r.id, title: r.title, text: r.text, assetId: r.assetId })),
    citations: results.map((r) => r.id)
  };
}
