/**
 * ASSUMED process topology for the 30 Excel-pack assets.
 *
 * The Excel builder pack has NO upstream/downstream links. This table is authored for the PoC so
 * the diagnostic assistant can name the previous and subsequent processes to check. It only uses
 * real tags, areas (area_id) and process_context values from the pack; the links themselves are
 * an engineering assumption and every answer that uses them labels them as such.
 *
 * relation:
 *   feeds     – process flow from `from` to `to`
 *   drives    – motor shaft drives the machine
 *   supplies  – utility / auxiliary supply (water, cooling, agitated chest → suction)
 *   measures  – instrument on `from` measures `to` (not a process step; listed as "instruments")
 */

export const TOPOLOGY_DISCLAIMER =
  'Process links are an assumed PoC topology (the Excel pack contains no P&ID); verify against site P&ID before acting.';

export const PROCESS_EDGES = [
  // AREA-05 Water Treatment → AREA-03 Utility Island
  { from: 'PT-001', to: 'P-001', relation: 'measures', note: 'Treated-water discharge pressure' },
  { from: 'P-001', to: 'P-005', relation: 'feeds', note: 'Treated make-up water into the utility header pump suction' },

  // AREA-03 Utility Island
  { from: 'M-002', to: 'P-005', relation: 'drives', note: 'Utility header pump drive' },
  { from: 'PT-002', to: 'P-005', relation: 'measures', note: 'Utility header discharge pressure' },
  { from: 'P-005', to: 'CV-001', relation: 'feeds', note: 'Main utility header control' },
  { from: 'CV-001', to: 'CV-006', relation: 'feeds', note: 'Cooling-water branch' },
  { from: 'CV-001', to: 'CV-009', relation: 'feeds', note: 'Process-water branch to Chemical Preparation' },
  { from: 'CV-006', to: 'M-006', relation: 'supplies', note: 'Cooling water to Stock Preparation agitator drive' },
  { from: 'CV-009', to: 'P-002', relation: 'supplies', note: 'Process water to chemical make-down pump suction' },

  // AREA-04 Chemical Preparation
  { from: 'M-003', to: 'P-002', relation: 'drives', note: 'Chemical make-down pump drive' },
  { from: 'VS-001', to: 'M-003', relation: 'measures', note: 'Drive-end vibration on M-003' },
  { from: 'VS-002', to: 'P-002', relation: 'measures', note: 'Pump-bearing vibration on P-002' },
  { from: 'P-002', to: 'CV-003', relation: 'feeds', note: 'Chemical feed flow control' },
  { from: 'PT-003', to: 'CV-003', relation: 'measures', note: 'Pressure downstream of CV-003' },
  { from: 'CV-003', to: 'P-004', relation: 'feeds', note: 'Dosing booster pump suction' },
  { from: 'VS-003', to: 'P-004', relation: 'measures', note: 'Pump-bearing vibration on P-004' },
  { from: 'P-004', to: 'CV-011', relation: 'feeds', note: 'Dosing control to Stock Preparation' },
  { from: 'CV-011', to: 'CV-007', relation: 'feeds', note: 'Chemical dosing into the stock line' },

  // AREA-01 Stock Preparation
  { from: 'M-006', to: 'P-003', relation: 'supplies', note: 'Agitated chest drive keeps P-003 suction homogeneous' },
  { from: 'M-004', to: 'P-003', relation: 'drives', note: 'Stock pump drive' },
  { from: 'P-003', to: 'CV-002', relation: 'feeds', note: 'Stock flow control' },
  { from: 'CV-007', to: 'CV-002', relation: 'feeds', note: 'Dosed chemical joins stock line' },
  { from: 'CV-002', to: 'CV-012', relation: 'feeds', note: 'Stock transfer to Machine Hall' },
  { from: 'CV-012', to: 'P-006', relation: 'feeds', note: 'Approach-flow pump suction' },

  // AREA-02 Machine Hall
  { from: 'M-001', to: 'P-006', relation: 'drives', note: 'Approach-flow (fan) pump drive' },
  { from: 'P-006', to: 'CV-004', relation: 'feeds', note: 'Headbox feed control' },
  { from: 'CV-004', to: 'CV-008', relation: 'feeds', note: 'Headbox consistency trim' },
  { from: 'P-006', to: 'CV-005', relation: 'feeds', note: 'Short-circulation branch' },
  { from: 'M-005', to: 'CV-005', relation: 'supplies', note: 'Secondary approach-flow stage drive (pump not in pack)' },
  { from: 'CV-005', to: 'CV-010', relation: 'feeds', note: 'White-water return control' }
].map((e) => ({ ...e, assumed: true }));

/** Shared utilities that are not assets in the pack but are always worth checking. */
export const UTILITY_DEPENDENCIES = {
  CONTROL_VALVE: [
    { id: 'UTIL-INSTRUMENT-AIR', name: 'Instrument-air header', check: 'Confirm supply pressure at the positioner (compare pneumatic_supply_bar with class baseline) and check the filter-regulator for water/oil.' },
    { id: 'UTIL-DCS-IO', name: 'DCS output / positioner signal', check: 'Compare controller output with the positioner setpoint; check HART/FF diagnostics for alerts.' }
  ],
  PROCESS_PUMP: [
    { id: 'UTIL-MCC', name: 'Motor feeder (MCC / VFD)', check: 'Confirm drive speed and current are stable; no trips or derating on the feeder.' }
  ],
  ELECTRIC_MOTOR: [
    { id: 'UTIL-MCC', name: 'Motor feeder (MCC / VFD)', check: 'Check phase voltages/currents, terminal tightness and VFD fault log.' },
    { id: 'UTIL-VENTILATION', name: 'Motor ventilation / cooling', check: 'Check fan cowl, cooling fins and ambient temperature around the motor.' }
  ],
  PRESSURE_TRANSMITTER: [
    { id: 'UTIL-DCS-IO', name: 'Loop power & DCS input', check: 'Check loop supply, cable and junction box; compare DCS value with local indication.' }
  ],
  VIBRATION_SENSOR: [
    { id: 'UTIL-CM-SYSTEM', name: 'Condition-monitoring gateway', check: 'Confirm the gateway receives continuous data and the channel configuration is unchanged.' }
  ]
};

const flowEdges = PROCESS_EDGES.filter((e) => e.relation !== 'measures');

function walk(tag, depth, next) {
  const out = [];
  const seen = new Set([tag]);
  let frontier = [{ tag, via: null }];
  for (let hop = 1; hop <= depth; hop++) {
    const nextFrontier = [];
    for (const node of frontier) {
      for (const { other, edge } of next(node.tag)) {
        if (seen.has(other)) continue;
        seen.add(other);
        out.push({ tag: other, relation: edge.relation, note: edge.note, hops: hop, via: node.tag, assumed: true });
        nextFrontier.push({ tag: other });
      }
    }
    frontier = nextFrontier;
  }
  return out;
}

/** Previous processes (sources, drives, supplies) feeding `tag`, nearest first. */
export function upstreamOf(tag, depth = 2) {
  return walk(tag, depth, (t) => flowEdges.filter((e) => e.to === t).map((edge) => ({ other: edge.from, edge })));
}

/** Subsequent processes fed by `tag`, nearest first. */
export function downstreamOf(tag, depth = 2) {
  return walk(tag, depth, (t) => flowEdges.filter((e) => e.from === t).map((edge) => ({ other: edge.to, edge })));
}

/** Instruments measuring `tag`, or the equipment `tag` measures if it is an instrument. */
export function instrumentsOf(tag) {
  return PROCESS_EDGES.filter((e) => e.relation === 'measures' && (e.to === tag || e.from === tag)).map((e) => ({
    tag: e.from === tag ? e.to : e.from,
    relation: e.from === tag ? 'measured asset' : 'instrument',
    note: e.note,
    assumed: true
  }));
}
