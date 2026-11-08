/**
 * Valmet SpatialSense 3D Equipment & Internal Component Catalog
 *
 * Maps scene equipment tags (e.g., P-002 / ASSET-014 "Generic centrifugal pump" on the
 * Boiler Feedwater Line) and natural-language aliases to approved 3D GLB assemblies
 * and their internal part nodes.
 *
 * 3D Model Credit:
 *   Centrifugal Pump (31 named parts, 2.1 MB GLB)
 *   Published by Engine-X by Parth Parmar (https://engx3d.com/3d-models/centrifugal-pump)
 *   License: Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0)
 */

export const CENTRIFUGAL_PUMP_MODEL_ID = 'MODEL-CENTRIFUGAL-PUMP-ENGX';

/**
 * Exact 31 named mesh nodes inside `/assets/models/pump.glb`
 * Local coordinates in the GLB are in millimeters:
 *   Shaft axis runs along X (from Motor at X = -275 mm to Suction Flange at X = +142 mm)
 *   at centerline Y = 170 mm, Z = 0 mm.
 *   `casingSlide` (dx, dy, dz in mm) defines where the part moves when "Open Pump (Slide Casing Forward)" is active.
 *   `explodeVec` (dx, dy, dz in mm) defines where the part moves when the "Explode" slider is dragged 0% -> 100%.
 */
export const PUMP_GLB_PARTS = [
  // --- Mechanical Seal Assembly (3 parts) — where the shaft exits the bearing housing into the wet casing ---
  {
    nodeName: 'Mechanical seal (rotating ring)',
    partId: 'mechanical_seal',
    group: 'mechanical_seal',
    groupLabel: 'Mechanical Seal',
    role: 'Primary rotating silicon-carbide seal face keyed to the pump shaft at the housing exit (X = +17..25 mm).',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [38, 34, 0],
    baseColor: 0x38bdf8
  },
  {
    nodeName: 'Mechanical seal seat',
    partId: 'mechanical_seal',
    group: 'mechanical_seal',
    groupLabel: 'Mechanical Seal',
    role: 'Stationary lapped seal seat pressed into the seal gland; forms the primary liquid film barrier.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [18, 42, 0],
    baseColor: 0x0ea5e9
  },
  {
    nodeName: 'Seal gland',
    partId: 'mechanical_seal',
    group: 'mechanical_seal',
    groupLabel: 'Mechanical Seal',
    role: 'Bolted gland follower plate that retains the stationary seal seat where the shaft exits the bearing housing.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [-8, 52, 0],
    baseColor: 0x0284c7
  },

  // --- Shaft & Coupling (2 parts) ---
  {
    nodeName: 'Pump shaft',
    partId: 'shaft_coupling',
    group: 'shaft_coupling',
    groupLabel: 'Shaft & Coupling',
    role: 'Main stainless-steel rotor shaft (X = -95..+55 mm, Ø30 mm) carrying the impeller, bearings, and mechanical seal.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [0, 0, 0],
    baseColor: 0xe2e8f0
  },
  {
    nodeName: 'Flexible coupling',
    partId: 'shaft_coupling',
    group: 'shaft_coupling',
    groupLabel: 'Shaft & Coupling',
    role: 'Elastomeric jaw coupling connecting the electric drive motor shaft to the pump shaft while damping misalignment.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [-65, 0, 0],
    baseColor: 0x94a3b8
  },

  // --- Impeller Assembly (8 parts) ---
  {
    nodeName: 'Impeller hub',
    partId: 'impeller',
    group: 'impeller',
    groupLabel: 'Impeller (8 parts)',
    role: 'Central bronze/steel impeller hub keyed to the pump shaft nose inside the volute chamber.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [95, 0, 0],
    baseColor: 0xf59e0b
  },
  {
    nodeName: 'Impeller front shroud',
    partId: 'impeller',
    group: 'impeller',
    groupLabel: 'Impeller (8 parts)',
    role: 'Front shroud plate guiding boiler feedwater from the suction eye into the 6 radial impeller passages.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [130, 0, 0],
    baseColor: 0xfbbf24
  },
  {
    nodeName: 'Impeller blade 1',
    partId: 'impeller',
    group: 'impeller',
    groupLabel: 'Impeller (8 parts)',
    role: 'Backward-curved centrifugal vane #1 imparting velocity head to the feedwater.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [110, 26, 15],
    baseColor: 0xd97706
  },
  {
    nodeName: 'Impeller blade 2',
    partId: 'impeller',
    group: 'impeller',
    groupLabel: 'Impeller (8 parts)',
    role: 'Backward-curved centrifugal vane #2 imparting velocity head to the feedwater.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [110, 0, 30],
    baseColor: 0xd97706
  },
  {
    nodeName: 'Impeller blade 3',
    partId: 'impeller',
    group: 'impeller',
    groupLabel: 'Impeller (8 parts)',
    role: 'Backward-curved centrifugal vane #3 imparting velocity head to the feedwater.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [110, -26, 15],
    baseColor: 0xd97706
  },
  {
    nodeName: 'Impeller blade 4',
    partId: 'impeller',
    group: 'impeller',
    groupLabel: 'Impeller (8 parts)',
    role: 'Backward-curved centrifugal vane #4 imparting velocity head to the feedwater.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [110, -26, -15],
    baseColor: 0xd97706
  },
  {
    nodeName: 'Impeller blade 5',
    partId: 'impeller',
    group: 'impeller',
    groupLabel: 'Impeller (8 parts)',
    role: 'Backward-curved centrifugal vane #5 imparting velocity head to the feedwater.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [110, 0, -30],
    baseColor: 0xd97706
  },
  {
    nodeName: 'Impeller blade 6',
    partId: 'impeller',
    group: 'impeller',
    groupLabel: 'Impeller (8 parts)',
    role: 'Backward-curved centrifugal vane #6 imparting velocity head to the feedwater.',
    isRotating: true,
    casingSlide: [0, 0, 0],
    explodeVec: [110, 26, -15],
    baseColor: 0xd97706
  },

  // --- Bearings & Bearing Housing (3 parts) ---
  {
    nodeName: 'Bearing (inboard)',
    partId: 'bearings',
    group: 'bearings',
    groupLabel: 'Bearings & Housing',
    role: 'Inboard (coupling-side) deep-groove ball bearing carrying radial shaft loads.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [-42, 48, 0],
    baseColor: 0xa855f7
  },
  {
    nodeName: 'Bearing (outboard)',
    partId: 'bearings',
    group: 'bearings',
    groupLabel: 'Bearings & Housing',
    role: 'Outboard (impeller-side) angular-contact bearing supporting hydraulic axial thrust and radial load.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [8, 48, 0],
    baseColor: 0xc084fc
  },
  {
    nodeName: 'Bearing housing',
    partId: 'bearings',
    group: 'bearings',
    groupLabel: 'Bearings & Housing',
    role: 'Cast-iron bearing frame & oil sump supporting the inboard/outboard bearings and seal gland.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [-18, -32, 55],
    baseColor: 0x475569
  },

  // --- Volute Casing, Flanges, Wear Ring & Casing Bolts (9 parts) — slide forward when "Open Pump" is active ---
  {
    nodeName: 'Volute casing',
    partId: 'volute_casing',
    group: 'volute_casing',
    groupLabel: 'Volute Casing (9 parts)',
    role: 'Spiral volute pressure casing. Slides forward along +X during inspection to reveal the impeller, shaft, and mechanical seal.',
    isRotating: false,
    casingSlide: [195, 0, 0],
    explodeVec: [220, 0, 0],
    baseColor: 0x1e3a5f
  },
  {
    nodeName: 'Suction flange',
    partId: 'volute_casing',
    group: 'volute_casing',
    groupLabel: 'Volute Casing (9 parts)',
    role: 'Axial end-suction inlet nozzle flange bolted to the boiler feedwater suction header.',
    isRotating: false,
    casingSlide: [235, 0, 0],
    explodeVec: [295, 0, 0],
    baseColor: 0x2563eb
  },
  {
    nodeName: 'Discharge flange',
    partId: 'volute_casing',
    group: 'volute_casing',
    groupLabel: 'Volute Casing (9 parts)',
    role: 'Top radial discharge nozzle flange delivering pressurized feedwater to downstream control valves.',
    isRotating: false,
    casingSlide: [195, 42, 0],
    explodeVec: [220, 95, 0],
    baseColor: 0x2563eb
  },
  {
    nodeName: 'Wear ring',
    partId: 'volute_casing',
    group: 'volute_casing',
    groupLabel: 'Volute Casing (9 parts)',
    role: 'Replaceable casing wear ring minimizing internal recirculation between high-pressure volute and suction eye.',
    isRotating: false,
    casingSlide: [155, 0, 0],
    explodeVec: [165, 0, 0],
    baseColor: 0x10b981
  },
  {
    nodeName: 'Casing joint bolt 1',
    partId: 'volute_casing',
    group: 'volute_casing',
    groupLabel: 'Volute Casing (9 parts)',
    role: 'High-tensile casing parting-flange fastener #1.',
    isRotating: false,
    casingSlide: [168, 18, 18],
    explodeVec: [185, 55, 55],
    baseColor: 0x94a3b8
  },
  {
    nodeName: 'Casing joint bolt 2',
    partId: 'volute_casing',
    group: 'volute_casing',
    groupLabel: 'Volute Casing (9 parts)',
    role: 'High-tensile casing parting-flange fastener #2.',
    isRotating: false,
    casingSlide: [168, 18, -18],
    explodeVec: [185, 55, -55],
    baseColor: 0x94a3b8
  },
  {
    nodeName: 'Casing joint bolt 3',
    partId: 'volute_casing',
    group: 'volute_casing',
    groupLabel: 'Volute Casing (9 parts)',
    role: 'High-tensile casing parting-flange fastener #3.',
    isRotating: false,
    casingSlide: [168, -18, 18],
    explodeVec: [185, -55, 55],
    baseColor: 0x94a3b8
  },
  {
    nodeName: 'Casing joint bolt 4',
    partId: 'volute_casing',
    group: 'volute_casing',
    groupLabel: 'Volute Casing (9 parts)',
    role: 'High-tensile casing parting-flange fastener #4.',
    isRotating: false,
    casingSlide: [168, -18, -18],
    explodeVec: [185, -55, -55],
    baseColor: 0x94a3b8
  },
  {
    nodeName: 'Casing support foot',
    partId: 'volute_casing',
    group: 'volute_casing',
    groupLabel: 'Volute Casing (9 parts)',
    role: 'Pedestal support foot anchoring the volute casing to the structural steel baseplate.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [70, -45, 0],
    baseColor: 0x334155
  },

  // --- Drive Motor, Baseplate & Mounting Bolts (6 parts) ---
  {
    nodeName: 'Motor',
    partId: 'motor_frame',
    group: 'motor_frame',
    groupLabel: 'Motor & Baseplate',
    role: 'TEFC 3-phase squirrel-cage induction drive motor coupled to the pump shaft.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [-145, 0, 0],
    baseColor: 0x1e293b
  },
  {
    nodeName: 'Baseplate (Centrifugal pump — Engine-X)',
    partId: 'motor_frame',
    group: 'motor_frame',
    groupLabel: 'Motor & Baseplate',
    role: 'Heavy fabricated steel skid baseplate supporting the pump casing pedestal and drive motor.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [0, -85, 0],
    baseColor: 0x0f172a
  },
  {
    nodeName: 'Motor mounting bolt 1',
    partId: 'motor_frame',
    group: 'motor_frame',
    groupLabel: 'Motor & Baseplate',
    role: 'Motor foot hold-down bolt #1 (check alignment & shims before tightening).',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [-145, -55, 40],
    baseColor: 0x64748b
  },
  {
    nodeName: 'Motor mounting bolt 2',
    partId: 'motor_frame',
    group: 'motor_frame',
    groupLabel: 'Motor & Baseplate',
    role: 'Motor foot hold-down bolt #2.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [-145, -55, -40],
    baseColor: 0x64748b
  },
  {
    nodeName: 'Motor mounting bolt 3',
    partId: 'motor_frame',
    group: 'motor_frame',
    groupLabel: 'Motor & Baseplate',
    role: 'Motor foot hold-down bolt #3.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [-195, -55, 40],
    baseColor: 0x64748b
  },
  {
    nodeName: 'Motor mounting bolt 4',
    partId: 'motor_frame',
    group: 'motor_frame',
    groupLabel: 'Motor & Baseplate',
    role: 'Motor foot hold-down bolt #4.',
    isRotating: false,
    casingSlide: [0, 0, 0],
    explodeVec: [-195, -55, -40],
    baseColor: 0x64748b
  }
];

export const PUMP_PART_BY_NODE_NAME = Object.fromEntries(
  PUMP_GLB_PARTS.map((p) => [p.nodeName, p])
);

export const PUMP_PART_GROUPS = [
  {
    id: 'mechanical_seal',
    label: 'Mechanical Seal (3)',
    shortLabel: 'Mechanical Seal',
    color: '#38bdf8',
    nodes: ['Mechanical seal (rotating ring)', 'Mechanical seal seat', 'Seal gland'],
    summary: 'Shaft exit seal assembly (rotating SiC ring + stationary seat + bolted seal gland).'
  },
  {
    id: 'impeller',
    label: 'Impeller & Vanes (8)',
    shortLabel: 'Impeller',
    color: '#f59e0b',
    nodes: [
      'Impeller hub',
      'Impeller front shroud',
      'Impeller blade 1',
      'Impeller blade 2',
      'Impeller blade 3',
      'Impeller blade 4',
      'Impeller blade 5',
      'Impeller blade 6'
    ],
    summary: 'Closed 6-vane centrifugal impeller keyed to the shaft nose inside the volute.'
  },
  {
    id: 'shaft_coupling',
    label: 'Shaft & Coupling (2)',
    shortLabel: 'Shaft & Coupling',
    color: '#e2e8f0',
    nodes: ['Pump shaft', 'Flexible coupling'],
    summary: 'Main rotor shaft and elastomeric flexible coupling.'
  },
  {
    id: 'bearings',
    label: 'Bearings & Housing (3)',
    shortLabel: 'Bearings',
    color: '#c084fc',
    nodes: ['Bearing (inboard)', 'Bearing (outboard)', 'Bearing housing'],
    summary: 'Inboard/outboard rolling-element bearings and cast-iron bearing housing.'
  },
  {
    id: 'volute_casing',
    label: 'Volute Casing & Nozzles (9)',
    shortLabel: 'Volute Casing',
    color: '#3b82f6',
    nodes: [
      'Volute casing',
      'Suction flange',
      'Discharge flange',
      'Wear ring',
      'Casing joint bolt 1',
      'Casing joint bolt 2',
      'Casing joint bolt 3',
      'Casing joint bolt 4',
      'Casing support foot'
    ],
    summary: 'Pressure casing, suction/discharge flanges, replaceable wear ring, and parting bolts.'
  },
  {
    id: 'motor_frame',
    label: 'Motor & Baseplate (6)',
    shortLabel: 'Motor & Skid',
    color: '#64748b',
    nodes: [
      'Motor',
      'Baseplate (Centrifugal pump — Engine-X)',
      'Motor mounting bolt 1',
      'Motor mounting bolt 2',
      'Motor mounting bolt 3',
      'Motor mounting bolt 4'
    ],
    summary: 'Drive motor, fabricated steel baseplate, and hold-down bolts.'
  }
];

export const PUMP_FAULT_SCENARIOS = {
  nominal: {
    id: 'nominal',
    label: 'Nominal Operation',
    badge: null,
    targetGroupId: null,
    pulseColorHex: null,
    summary: 'All 31 internal components operating within nominal clearance, temperature, and sealing limits.'
  },
  mechanical_seal_leak: {
    id: 'mechanical_seal_leak',
    label: 'Mechanical seal leak',
    badge: 'Illustrative fault scenario',
    targetGroupId: 'mechanical_seal',
    pulseColorHex: 0xef4444,
    dropletOriginMm: [15, 170, 0],
    summary:
      'Illustrative fault scenario: Thermal distortion and abrasive wear across the Mechanical seal (rotating ring) and Mechanical seal seat allow feedwater droplets to leak past the Seal gland where the shaft exits the housing.'
  },
  impeller_cavitation: {
    id: 'impeller_cavitation',
    label: 'Impeller Cavitation',
    badge: 'Illustrative fault scenario',
    targetGroupId: 'impeller',
    pulseColorHex: 0xf97316,
    summary:
      'Illustrative fault scenario: Vapor bubble collapse at the impeller eye erodes Impeller blades 1–6 and increases Wear ring clearance.'
  },
  bearing_overheat: {
    id: 'bearing_overheat',
    label: 'Bearing Wear & Overheat',
    badge: 'Illustrative fault scenario',
    targetGroupId: 'bearings',
    pulseColorHex: 0xeab308,
    summary:
      'Illustrative fault scenario: Elevated axial thrust and oil film degradation overheat Bearing (outboard) and Bearing (inboard).'
  }
};

export const MODEL_CATALOG = {
  [CENTRIFUGAL_PUMP_MODEL_ID]: {
    model_id: CENTRIFUGAL_PUMP_MODEL_ID,
    name: 'Generic centrifugal pump',
    service_circuit: 'Boiler Feedwater Line (Main Pump Skid)',
    glb_path: '/assets/models/pump.glb',
    file_size_mb: 2.1,
    part_count: 31,
    license: 'CC BY-NC 4.0',
    attribution: 'Engine-X by Parth Parmar (engx3d.com)',
    source_url: 'https://engx3d.com/3d-models/centrifugal-pump',
    primary_asset_id: 'ASSET-014',
    primary_tag: 'P-002',
    bound_tags: ['P-002', 'P-001', 'P-003', 'P-004', 'P-005', 'P-006'],
    bound_asset_ids: ['ASSET-014', 'ASSET-013', 'ASSET-015', 'ASSET-016', 'ASSET-017', 'ASSET-018'],
    aliases: [
      'boiler feedwater line',
      'boiler feedwater',
      'feedwater pump',
      'feedwater line',
      'generic centrifugal pump',
      'centrifugal pump',
      'main pump skid',
      'pump on the boiler feedwater line'
    ],
    parts: PUMP_GLB_PARTS,
    partGroups: PUMP_PART_GROUPS,
    faultScenarios: PUMP_FAULT_SCENARIOS
  }
};

/**
 * Checks whether an asset has the 31-part 3D Centrifugal Pump GLB catalog entry bound.
 */
export function hasCentrifugalPumpGlb(asset) {
  if (!asset) return false;
  const tag = String(asset.tag || '').toUpperCase();
  const id = String(asset.asset_id || '').toUpperCase();
  const cls = String(asset.asset_class || asset.excelClass || asset.class || '').toUpperCase();
  const entry = MODEL_CATALOG[CENTRIFUGAL_PUMP_MODEL_ID];
  return (
    entry.bound_tags.includes(tag) ||
    entry.bound_asset_ids.includes(id) ||
    cls.includes('PUMP')
  );
}

/**
 * Resolves a natural-language query (e.g., "Find the pump on the boiler feedwater line and show me the seal.")
 * to `{ model_id, asset_id, tag, part_id, part_label, matched_nodes, open_casing, fault_scenario }`.
 */
export function resolveCatalogModelAndPart(query, fallbackAsset = null) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;

  const entry = MODEL_CATALOG[CENTRIFUGAL_PUMP_MODEL_ID];

  const mentionsFeedwaterOrPump =
    /feedwater|centrifugal|boiler.*pump|pump.*boiler|pump.*line|find the pump|open the pump|show me the seal|mechanical seal|impeller|volute|explode/.test(
      q
    );
  const explicitPumpMatch = q.match(/\b(p-?00[1-6]|asset-01[3-8])\b/i);
  const mentionsInternalPart =
    /\b(seal|impeller|vane|blade|shroud|shaft|coupling|bearing|volute|casing|wear ring|cutaway|inside|internal|explode|leak)\b/.test(
      q
    );

  if (!mentionsFeedwaterOrPump && !(explicitPumpMatch && mentionsInternalPart)) {
    return null;
  }

  // Resolve target equipment tag & asset_id
  let tag = entry.primary_tag; // P-002 ("Generic centrifugal pump" on the Boiler Feedwater Line)
  let assetId = entry.primary_asset_id; // ASSET-014
  if (explicitPumpMatch) {
    const raw = explicitPumpMatch[1].toUpperCase();
    const tagMap = {
      'P-001': 'ASSET-013',
      P001: 'ASSET-013',
      'P-002': 'ASSET-014',
      P002: 'ASSET-014',
      'P-003': 'ASSET-015',
      P003: 'ASSET-015',
      'P-004': 'ASSET-016',
      P004: 'ASSET-016',
      'P-005': 'ASSET-017',
      P005: 'ASSET-017',
      'P-006': 'ASSET-018',
      P006: 'ASSET-018',
      'ASSET-013': 'ASSET-013',
      'ASSET-014': 'ASSET-014',
      'ASSET-015': 'ASSET-015',
      'ASSET-016': 'ASSET-016',
      'ASSET-017': 'ASSET-017',
      'ASSET-018': 'ASSET-018'
    };
    const idToTag = {
      'ASSET-013': 'P-001',
      'ASSET-014': 'P-002',
      'ASSET-015': 'P-003',
      'ASSET-016': 'P-004',
      'ASSET-017': 'P-005',
      'ASSET-018': 'P-006'
    };
    if (tagMap[raw]) {
      assetId = tagMap[raw];
      tag = idToTag[assetId];
    }
  } else if (
    fallbackAsset &&
    entry.bound_asset_ids.includes(fallbackAsset.asset_id) &&
    !/feedwater|p-?002/.test(q)
  ) {
    assetId = fallbackAsset.asset_id;
    tag = fallbackAsset.tag;
  }

  // Resolve requested internal part_id
  let partId = 'mechanical_seal';
  if (/\b(impeller|vane|blade|shroud|cavitation)\b/.test(q)) {
    partId = 'impeller';
  } else if (/\b(bearing|inboard|outboard)\b/.test(q)) {
    partId = 'bearings';
  } else if (/\b(shaft|coupling|rotor)\b/.test(q) && !/\bseal\b/.test(q)) {
    partId = 'shaft_coupling';
  } else if (/\b(volute|flange|wear ring)\b/.test(q) && !/\b(seal|impeller)\b/.test(q)) {
    partId = 'volute_casing';
  } else if (/\b(motor|baseplate)\b/.test(q)) {
    partId = 'motor_frame';
  }

  const groupObj =
    PUMP_PART_GROUPS.find((g) => g.id === partId) || PUMP_PART_GROUPS[0];

  // Determine fault scenario
  let faultScenario = 'mechanical_seal_leak';
  if (partId === 'impeller') faultScenario = 'impeller_cavitation';
  else if (partId === 'bearings') faultScenario = 'bearing_overheat';

  return {
    model_id: entry.model_id,
    model_name: entry.name,
    service_circuit: entry.service_circuit,
    glb_path: entry.glb_path,
    part_count: entry.part_count,
    attribution: entry.attribution,
    license: entry.license,
    asset_id: assetId,
    tag,
    part_id: partId,
    part_label: groupObj.label,
    matched_nodes: groupObj.nodes,
    open_casing: true,
    explode_pct: /\bexplode\b/.test(q) ? 55 : 0,
    fault_scenario: faultScenario
  };
}
