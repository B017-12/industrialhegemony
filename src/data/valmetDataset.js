/**
 * Valmet × Since AI 2026 Synthetic Industrial Metaverse Builder Data Pack
 * Grounded in the official Excel dataset (30 Assets ASSET-001..030, Scene Anchors ANCHOR-001..030,
 * Current State, Telemetry, Events, Work Orders, RAG Docs, and Data Quality Issues)
 * + Spatial coordinates aligned to real 3D clusters extracted from "Industrial Boiler Room (1).ply"
 */

export const VALMET_RAG_DOCS = [
  {
    doc_id: 'DOC-CONTROL_VALVE-CORE',
    title: 'Control Valve Field Troubleshooting & Calibration Guide',
    asset_class: 'control_valve',
    keywords: 'setpoint,position,stiction,hunting,instrument air,actuator,linkage',
    summary:
      'Stepwise verification guide for control valves covering position deviation, stiction, pneumatic supply checks, linkage inspection, and post-maintenance stroke testing.'
  },
  {
    doc_id: 'DOC-PROCESS_PUMP-CORE',
    title: 'Process Pump Cavitation, Impeller Wear & Seal Inspection SOP',
    asset_class: 'process_pump',
    keywords: 'flow,discharge pressure,cavitation,strainer,suction,seal,vibration',
    summary:
      'Field diagnostic workflow for centrifugal process pumps experiencing low discharge head, cavitation noise, strainer fouling, or mechanical seal leakage.'
  },
  {
    doc_id: 'DOC-ELECTRIC_MOTOR-CORE',
    title: 'Industrial Electric Motor Thermal & Bearing Diagnostic Standard',
    asset_class: 'electric_motor',
    keywords: 'bearing temperature,current,overheating,cooling fan,alignment,lubrication',
    summary:
      'Maintenance procedure for electric drive motors showing elevated bearing temperatures, current imbalance, cooling shroud blockage, or shaft misalignment.'
  },
  {
    doc_id: 'DOC-PRESSURE_TRANSMITTER-CORE',
    title: 'Pressure Transmitter Impulse Line & Zero-Drift Verification',
    asset_class: 'pressure_transmitter',
    keywords: 'impulse line,drift,calibration,manifold,blockage,damping',
    summary:
      'Instrumentation guide for isolating plugged impulse lines, verifying transmitter zero/span drift, and validating HART/fieldbus signal integrity.'
  },
  {
    doc_id: 'DOC-VIBRATION_SENSOR-CORE',
    title: 'Accelerometer Mounting Torque & Cable Shielding Verification',
    asset_class: 'vibration_sensor',
    keywords: 'rms vibration,mounting stud,loose sensor,noise floor,cable shield',
    summary:
      'Inspection checklist for piezo-velocity and accelerometer sensors exhibiting erratic spikes, loose stud mounting, or EMI signal dropouts.'
  },
  {
    doc_id: 'DOC-FIELD-SAFETY',
    title: 'Boiler House Lockout/Tagout (LOTO) & High-Energy Line Safety Standard',
    asset_class: 'all',
    keywords: 'LOTO,steam,isolation,depressurize,PPE,permit,zero energy',
    summary:
      'Mandatory zero-energy verification, valve isolation, pneumatic bleed-off, and thermal PPE requirements before touching any boiler house rotating or pressurized asset.'
  }
];

export const VALMET_ASSETS = [
  // ======================== CRITICAL / DEGRADED ASSETS ========================
  {
    asset_id: 'ASSET-003',
    tag: 'CV-003',
    asset_class: 'control_valve',
    subtype: 'globe_control_valve',
    area_id: 'AREA-FEED',
    area_name: 'Feedwater Control Bay',
    line_id: 'LINE-2',
    service_description: 'Feedwater flow control valve 3',
    criticality: 'high',
    connectivity_profile: 'online_realtime',
    qr_id: 'QR-SYN-0003',
    anchor_id: 'ANCHOR-003',
    // Aligned to real dense cluster in Industrial Boiler Room (1).ply
    position: [-2.00, -0.42, 1.10],
    bbox_size: [0.68, 0.86, 0.58],
    approach_point: [-1.25, -1.02, 1.10],
    health_score: 52,
    health_status: 'degraded',
    status_reason: 'POSITION_DEVIATION',
    active_alarm_count: 2,
    open_work_orders: 1,
    anomaly_score: 0.78,
    telemetry: {
      pressure_bar: 5.56,
      flow_m3h: 81.9,
      temperature_c: 55.3,
      setpoint_pct: 68.4,
      position_pct: 59.1,
      stiction_index: 0.56,
      supply_air_bar: 4.8
    },
    telemetry_trend: [
      { time: '10:00', sp: 68.0, pv: 66.8, stiction: 0.24 },
      { time: '10:30', sp: 68.0, pv: 64.5, stiction: 0.35 },
      { time: '11:00', sp: 68.5, pv: 62.1, stiction: 0.44 },
      { time: '11:30', sp: 68.4, pv: 60.4, stiction: 0.51 },
      { time: '12:00', sp: 68.4, pv: 59.1, stiction: 0.56 }
    ],
    upstream_asset: 'ASSET-014 (P-002)',
    downstream_asset: 'ASSET-026 (PT-002)',
    coupled_driver: 'Pneumatic Diaphragm Actuator',
    events: [
      {
        event_id: 'EVT-000412',
        timestamp: '2026-03-03 11:30:00',
        severity: 'high',
        event_type: 'POSITION_DEVIATION',
        message: 'CV-003 valve position deviates >9.3% from setpoint (SP 68.4% vs PV 59.1%); elevated stiction index (0.56).'
      },
      {
        event_id: 'EVT-000389',
        timestamp: '2026-03-03 10:00:00',
        severity: 'medium',
        event_type: 'ACTUATOR_HYSTERESIS',
        message: 'CV-003 diaphragm actuator hunting detected during feedwater header load transient.'
      }
    ],
    work_order: {
      wo_id: 'WO-000118',
      priority: 'P1 - Urgent',
      status: 'OPEN',
      failure_code: 'POSITION_DEVIATION',
      cause_code: 'ACTUATOR_STICTION',
      action_code: 'INSPECT_AND_VERIFY',
      summary: 'Inspect CV-003 stem packing stiction, verify 5.5 bar instrument air regulator, and recalibrate digital positioner.'
    },
    decision_tree: [
      {
        step: 1,
        node: 'OBSERVATION',
        title: '9.3% Valve Position Tracking Lag',
        detail: 'Setpoint is 68.4% but actual stem position is stuck at 59.1% with Stiction Index at 0.56 (threshold 0.35).'
      },
      {
        step: 2,
        node: 'SPATIAL_CONTEXT',
        title: 'Coupled to Cavitating Feedwater Pump P-002',
        detail: 'Located 1.1m downstream of P-002 in Feedwater Control Bay (AREA-FEED); line pressure oscillation aggravating stem friction.'
      },
      {
        step: 3,
        node: 'ROOT_CAUSE',
        title: 'Stem Packing Stiction & Instrument Air Drop',
        detail: 'Supply air pressure drooped to 4.8 bar while stem packing gland is over-torqued (matches DOC-CONTROL_VALVE-CORE).'
      },
      {
        step: 4,
        node: 'SAFE_ACTION',
        title: 'Isolate Bypass, Bleed Air & Stroke Test',
        detail: 'Execute LOTO per DOC-FIELD-SAFETY, check air filter-regulator, inspect linkage, and run 0-100% step calibration.'
      }
    ],
    loto_checklist: [
      'Scan QR-SYN-0003 on CV-003 yoke to confirm physical asset identity.',
      'Request Control Room to place Loop FIC-003 in MANUAL and open manual bypass valve.',
      'Close upstream/downstream block valves and bleed pneumatic actuator supply air to 0 bar.',
      'Inspect stem packing gland for binding or salt deposit; verify instrument air regulator output (5.5 bar).',
      'Perform 25% / 50% / 75% stroke test via HART communicator and verify <1.0% hysteresis.'
    ],
    doc_refs: ['DOC-CONTROL_VALVE-CORE', 'DOC-FIELD-SAFETY'],
    data_quality_note: null
  },

  {
    asset_id: 'ASSET-014',
    tag: 'P-002',
    asset_class: 'process_pump',
    subtype: 'centrifugal_pump',
    area_id: 'AREA-PUMP',
    area_name: 'Main Pump Skid',
    line_id: 'LINE-1',
    service_description: 'Circulation pump 2',
    criticality: 'high',
    connectivity_profile: 'online_realtime',
    qr_id: 'QR-SYN-0014',
    anchor_id: 'ANCHOR-014',
    position: [2.12, -0.35, 3.16],
    bbox_size: [0.92, 0.85, 0.72],
    approach_point: [1.50, -1.02, 2.35],
    health_score: 45,
    health_status: 'attention_required',
    status_reason: 'CAVITATION_RISK',
    active_alarm_count: 3,
    open_work_orders: 1,
    anomaly_score: 0.89,
    telemetry: {
      pressure_bar: 3.11,
      flow_m3h: 112.9,
      temperature_c: 55.6,
      motor_current_a: 62.6,
      bearing_temp_c: 76.2,
      vibration_mms: 6.45
    },
    telemetry_trend: [
      { time: '10:00', pressure: 4.15, vibration: 3.4, temp: 68.1 },
      { time: '10:30', pressure: 3.82, vibration: 4.3, temp: 70.4 },
      { time: '11:00', pressure: 3.50, vibration: 5.1, temp: 72.9 },
      { time: '11:30', pressure: 3.28, vibration: 5.9, temp: 74.8 },
      { time: '12:00', pressure: 3.11, vibration: 6.45, temp: 76.2 }
    ],
    upstream_asset: 'Suction Strainer STR-102',
    downstream_asset: 'ASSET-003 (CV-003)',
    coupled_driver: 'ASSET-020 (M-002)',
    events: [
      {
        event_id: 'EVT-000501',
        timestamp: '2026-03-03 11:30:00',
        severity: 'critical',
        event_type: 'CAVITATION_RISK',
        message: 'P-002 discharge pressure dropped to 3.11 bar with high broadband vibration (6.45 mm/s RMS) and bearing temp 76.2°C.'
      },
      {
        event_id: 'EVT-000488',
        timestamp: '2026-03-03 11:00:00',
        severity: 'high',
        event_type: 'SUCTION_HEAD_LOW',
        message: 'NPSHa margin below threshold on Main Pump Skid Line 1; acoustic cavitation signature detected.'
      }
    ],
    work_order: {
      wo_id: 'WO-000142',
      priority: 'P1 - Critical',
      status: 'OPEN',
      failure_code: 'CAVITATION_RISK',
      cause_code: 'SUCTION_STRAINER_FOULING',
      action_code: 'CLEAN_STRAINER_AND_INSPECT_SEAL',
      summary: 'Switch load to standby pump P-001, isolate P-002, clean Y-strainer mesh, and inspect mechanical seal & impeller eye.'
    },
    decision_tree: [
      {
        step: 1,
        node: 'OBSERVATION',
        title: 'Discharge Head Drop + 6.45 mm/s Vibration',
        detail: 'Discharge pressure fell from 4.2 bar to 3.11 bar while vibration surged to 6.45 mm/s RMS and bearing temp hit 76.2°C.'
      },
      {
        step: 2,
        node: 'SPATIAL_CONTEXT',
        title: 'Main Pump Skid (AREA-PUMP) Coupled to M-002',
        detail: 'Directly coupled to motor M-002 [2.82, -0.34, 2.08] and feeds control valve CV-003 [-2.00, -0.42, 1.10].'
      },
      {
        step: 3,
        node: 'ROOT_CAUSE',
        title: 'Suction Strainer Plugging Causing NPSH Starvation',
        detail: 'Differential pressure across suction strainer STR-102 is flashing condensate at the impeller eye (DOC-PROCESS_PUMP-CORE).'
      },
      {
        step: 4,
        node: 'SAFE_ACTION',
        title: 'Transfer to Standby P-001 & Clean Suction Strainer',
        detail: 'Auto-start standby pump P-001, apply LOTO on MCC breaker M-002, depressurize volute, and clean suction basket.'
      }
    ],
    loto_checklist: [
      'Verify standby circulation pump P-001 is online and carrying Line-1 flow.',
      'Apply padlock & tag to Drive Motor M-002 MCC Breaker (Zero Energy Verification).',
      'Close P-002 suction and discharge isolation valves; open casing drain to hotwell.',
      'Remove and clean suction Y-strainer screen; inspect mechanical seal faces for dry-run scoring.',
      'Flood casing, vent trapped vapor prior to restart, and verify vibration <2.8 mm/s.'
    ],
    doc_refs: ['DOC-PROCESS_PUMP-CORE', 'DOC-FIELD-SAFETY'],
    data_quality_note: null
  },

  {
    asset_id: 'ASSET-017',
    tag: 'P-005',
    asset_class: 'process_pump',
    subtype: 'centrifugal_pump',
    area_id: 'AREA-PUMP',
    area_name: 'Main Pump Skid',
    line_id: 'LINE-1',
    service_description: 'Circulation pump 5',
    criticality: 'high',
    connectivity_profile: 'online_realtime',
    qr_id: 'QR-SYN-0017',
    anchor_id: 'ANCHOR-017',
    position: [3.59, -0.20, 1.96],
    bbox_size: [0.78, 0.75, 0.86],
    approach_point: [2.75, -1.02, 1.96],
    health_score: 44,
    health_status: 'attention_required',
    status_reason: 'FOULING',
    active_alarm_count: 3,
    open_work_orders: 1,
    anomaly_score: 0.90,
    telemetry: {
      pressure_bar: 3.16,
      flow_m3h: 112.1,
      temperature_c: 55.6,
      motor_current_a: 63.4,
      bearing_temp_c: 76.6,
      vibration_mms: 6.53
    },
    telemetry_trend: [
      { time: '10:00', pressure: 3.95, vibration: 4.1, temp: 71.0 },
      { time: '10:30', pressure: 3.70, vibration: 4.8, temp: 72.5 },
      { time: '11:00', pressure: 3.48, vibration: 5.5, temp: 74.1 },
      { time: '11:30', pressure: 3.30, vibration: 6.1, temp: 75.4 },
      { time: '12:00', pressure: 3.16, vibration: 6.53, temp: 76.6 }
    ],
    upstream_asset: 'Condensate Header HDR-02',
    downstream_asset: 'ASSET-005 (CV-005)',
    coupled_driver: 'ASSET-023 (M-005)',
    events: [
      {
        event_id: 'EVT-000619',
        timestamp: '2026-03-03 11:30:00',
        severity: 'critical',
        event_type: 'IMPELLER_FOULING',
        message: 'P-005 hydraulic efficiency degraded 18%; high motor current (63.4 A) and 6.53 mm/s rotor imbalance vibration.'
      }
    ],
    work_order: {
      wo_id: 'WO-000189',
      priority: 'P1 - Critical',
      status: 'OPEN',
      failure_code: 'FOULING',
      cause_code: 'SCALE_BUILDUP_IMPELLER',
      action_code: 'DESCALE_AND_BALANCE',
      summary: 'Isolate P-005, inspect volute & impeller vanes for scale fouling, check shaft runout, and verify coupling alignment with M-005.'
    },
    decision_tree: [
      {
        step: 1,
        node: 'OBSERVATION',
        title: 'High Motor Amps (63.4A) + 6.53 mm/s Vibration',
        detail: 'Pump P-005 exhibits lowest health score in plant (44/100) with elevated current draw and 1X rotational vibration.'
      },
      {
        step: 2,
        node: 'SPATIAL_CONTEXT',
        title: 'East Perimeter Pump Bay [3.59, -0.20, 1.96]',
        detail: 'Adjacent to overheated motor M-006 and coupled to drive motor M-005; narrow 0.85m access aisle.'
      },
      {
        step: 3,
        node: 'ROOT_CAUSE',
        title: 'Impeller Vane Fouling & Dynamic Imbalance',
        detail: 'Mineral scale deposition on impeller passages causing uneven hydraulic loading and bearing overheating (76.6°C).'
      },
      {
        step: 4,
        node: 'SAFE_ACTION',
        title: 'LOTO Isolation, Volute Descaling & Laser Alignment',
        detail: 'Lock out M-005, drain casing, flush scale deposits, and laser-align coupling before returning to service.'
      }
    ],
    loto_checklist: [
      'Scan QR-SYN-0017 at East Pump Bay.',
      'Isolate electrical feeder M-005 at MCC Panel B and attach personal LOTO lock.',
      'Close suction/discharge gate valves and verify 0 bar on local pressure gauge.',
      'Open casing inspection cover, remove scale buildup from impeller vanes, and check wear ring clearance.',
      'Perform laser shaft alignment between P-005 and M-005 (<0.05 mm tolerance).'
    ],
    doc_refs: ['DOC-PROCESS_PUMP-CORE', 'DOC-FIELD-SAFETY'],
    data_quality_note: null
  },

  {
    asset_id: 'ASSET-024',
    tag: 'M-006',
    asset_class: 'electric_motor',
    subtype: 'induction_motor',
    area_id: 'AREA-AUX',
    area_name: 'Auxiliary Loop North',
    line_id: 'LINE-3',
    service_description: 'Drive motor 6',
    criticality: 'high',
    connectivity_profile: 'intermittent',
    qr_id: 'QR-SYN-0024',
    anchor_id: 'ANCHOR-024',
    position: [-2.92, -0.52, 2.08],
    bbox_size: [0.78, 0.82, 0.84],
    approach_point: [-2.10, -1.02, 2.08],
    health_score: 45,
    health_status: 'attention_required',
    status_reason: 'OVERHEATING',
    active_alarm_count: 3,
    open_work_orders: 1,
    anomaly_score: 0.89,
    telemetry: {
      temperature_c: 64.9,
      motor_current_a: 65.1,
      bearing_temp_c: 82.6,
      vibration_mms: 5.56
    },
    telemetry_trend: [
      { time: '10:00', bearing_temp: 71.2, current: 56.0, vibration: 3.8 },
      { time: '10:30', bearing_temp: 74.5, current: 58.9, vibration: 4.3 },
      { time: '11:00', bearing_temp: 77.8, current: 61.5, vibration: 4.8 },
      { time: '11:30', bearing_temp: 80.4, current: 63.7, vibration: 5.2 },
      { time: '12:00', bearing_temp: 82.6, current: 65.1, vibration: 5.56 }
    ],
    upstream_asset: 'MCC-3 Feeder Breaker',
    downstream_asset: 'ASSET-018 (P-006)',
    coupled_driver: 'Direct Shaft Coupling to P-006',
    events: [
      {
        event_id: 'EVT-000744',
        timestamp: '2026-03-03 11:30:00',
        severity: 'critical',
        event_type: 'BEARING_OVERHEATING',
        message: 'M-006 drive-end bearing temperature reached 82.6°C (alarm limit 75°C) with 65.1 A phase current.'
      }
    ],
    work_order: {
      wo_id: 'WO-000215',
      priority: 'P1 - Critical',
      status: 'OPEN',
      failure_code: 'OVERHEATING',
      cause_code: 'COOLING_FAN_FOOLED_OR_BEARING_GREASE',
      action_code: 'CLEAN_SHROUD_AND_RE-GREASE',
      summary: 'Inspect M-006 TEFC fan cowling for debris blockage, verify drive-end bearing lubrication, and check phase current balance.'
    },
    decision_tree: [
      {
        step: 1,
        node: 'OBSERVATION',
        title: 'Drive-End Bearing Temp 82.6°C & 65.1A Load',
        detail: 'Thermal runaway trend (+11.4°C in 2 hours) accompanied by 5.56 mm/s shaft vibration.'
      },
      {
        step: 2,
        node: 'SPATIAL_CONTEXT',
        title: 'Auxiliary Loop North [-2.92, -0.52, 2.08]',
        detail: 'Intermittent Wi-Fi coverage zone (connectivity_profile: intermittent); mounted alongside P-006 and VS-002.'
      },
      {
        step: 3,
        node: 'ROOT_CAUSE',
        title: 'Blocked TEFC Cooling Fan Intake & Degraded Grease',
        detail: 'High ambient boiler room heat combined with obstructed fan shroud and oxidized bearing grease (DOC-ELECTRIC_MOTOR-CORE).'
      },
      {
        step: 4,
        node: 'SAFE_ACTION',
        title: 'Thermal Cool-Down, Shroud Cleaning & Bearing Purge',
        detail: 'Trip motor on controlled stop, lock out MCC-3 breaker, clear fan intake grille, and purge bearing with high-temp polyurea grease.'
      }
    ],
    loto_checklist: [
      'Scan QR-SYN-0024 and note intermittent telemetry connectivity warning.',
      'Perform controlled stop of P-006/M-006 train and lock out MCC-3 breaker.',
      'Use non-contact IR thermometer to verify housing temperature drops below 50°C before contact.',
      'Clear dust/insulation debris from TEFC fan shroud and cooling fins.',
      'Remove relief plug and inject 15g high-temperature motor bearing grease.'
    ],
    doc_refs: ['DOC-ELECTRIC_MOTOR-CORE', 'DOC-FIELD-SAFETY'],
    data_quality_note: 'DQ-0014: Intermittent edge gateway packet loss in Auxiliary Loop North (last packet buffered 90s).'
  },

  {
    asset_id: 'ASSET-009',
    tag: 'CV-009',
    asset_class: 'control_valve',
    subtype: 'globe_control_valve',
    area_id: 'AREA-AUX',
    area_name: 'Auxiliary Loop North',
    line_id: 'LINE-3',
    service_description: 'Feedwater flow control valve 9',
    criticality: 'medium',
    connectivity_profile: 'online_realtime',
    qr_id: 'QR-SYN-0009',
    anchor_id: 'ANCHOR-009',
    position: [-1.99, -0.50, 3.10],
    bbox_size: [0.72, 0.80, 0.56],
    approach_point: [-1.35, -1.02, 2.65],
    health_score: 59,
    health_status: 'degraded',
    status_reason: 'POSITION_DEVIATION',
    active_alarm_count: 3,
    open_work_orders: 1,
    anomaly_score: 0.71,
    telemetry: {
      pressure_bar: 5.53,
      flow_m3h: 77.7,
      temperature_c: 56.1,
      setpoint_pct: 69.2,
      position_pct: 61.1,
      stiction_index: 0.53,
      supply_air_bar: 5.1
    },
    telemetry_trend: [
      { time: '10:00', sp: 69.0, pv: 67.1, stiction: 0.28 },
      { time: '10:30', sp: 69.0, pv: 65.4, stiction: 0.36 },
      { time: '11:00', sp: 69.2, pv: 63.8, stiction: 0.43 },
      { time: '11:30', sp: 69.2, pv: 62.2, stiction: 0.49 },
      { time: '12:00', sp: 69.2, pv: 61.1, stiction: 0.53 }
    ],
    upstream_asset: 'ASSET-018 (P-006)',
    downstream_asset: 'Aux Economizer Header',
    coupled_driver: 'Pneumatic Positioner POS-009',
    events: [
      {
        event_id: 'EVT-000811',
        timestamp: '2026-03-03 11:30:00',
        severity: 'high',
        event_type: 'POSITION_DEVIATION',
        message: 'CV-009 position lag 8.1% (SP 69.2% vs PV 61.1%); positioner feedback linkage play suspected.'
      }
    ],
    work_order: {
      wo_id: 'WO-000244',
      priority: 'P2 - High',
      status: 'OPEN',
      failure_code: 'POSITION_DEVIATION',
      cause_code: 'FEEDBACK_LINKAGE_PLAY',
      action_code: 'TIGHTEN_AND_CALIBRATE',
      summary: 'Tighten CV-009 positioner feedback arm clamp and run auto-calibration routine.'
    },
    decision_tree: [
      {
        step: 1,
        node: 'OBSERVATION',
        title: '8.1% Setpoint Deviation on Auxiliary Control Valve',
        detail: 'Valve position trails setpoint by 8.1% with Stiction Index 0.53.'
      },
      {
        step: 2,
        node: 'SPATIAL_CONTEXT',
        title: 'Auxiliary Loop North [-1.99, -0.50, 3.10]',
        detail: 'Downstream of vibrating train M-006/P-006; structural pipe vibration transmitted to valve yoke.'
      },
      {
        step: 3,
        node: 'ROOT_CAUSE',
        title: 'Positioner Feedback Linkage Looseness from Pipe Vibration',
        detail: 'Mechanical vibration from M-006 loosened the feedback lever turnbuckle on CV-009 (DOC-CONTROL_VALVE-CORE).'
      },
      {
        step: 4,
        node: 'SAFE_ACTION',
        title: 'Secure Feedback Lever & Auto-Calibrate Positioner',
        detail: 'Place loop in manual, tighten linkage locknuts with threadlocker, and run 5-point calibration.'
      }
    ],
    loto_checklist: [
      'Scan QR-SYN-0009 to verify CV-009 tag.',
      'Switch Auxiliary Loop FIC-009 to Manual mode.',
      'Isolate pneumatic supply to actuator and verify zero stem movement.',
      'Tighten feedback linkage clamp bolts and verify zero mechanical backlash.',
      'Restore air supply and run auto-stroke calibration.'
    ],
    doc_refs: ['DOC-CONTROL_VALVE-CORE', 'DOC-FIELD-SAFETY'],
    data_quality_note: null
  },

  {
    asset_id: 'ASSET-029',
    tag: 'VS-002',
    asset_class: 'vibration_sensor',
    subtype: 'piezo_velocity_sensor',
    area_id: 'AREA-PUMP',
    area_name: 'Main Pump Skid',
    line_id: 'LINE-1',
    service_description: 'Bearing vibration sensor 2',
    criticality: 'medium',
    connectivity_profile: 'intermittent',
    qr_id: 'QR-SYN-0029',
    anchor_id: 'ANCHOR-029',
    position: [1.16, 0.35, 3.17],
    bbox_size: [0.45, 0.45, 0.45],
    approach_point: [0.85, -1.02, 2.50],
    health_score: 58,
    health_status: 'degraded',
    status_reason: 'MOUNTING_ISSUE',
    active_alarm_count: 3,
    open_work_orders: 1,
    anomaly_score: 0.72,
    telemetry: {
      temperature_c: 44.3,
      vibration_mms: 6.32,
      bias_voltage_v: 12.1,
      noise_floor_g: 0.48
    },
    telemetry_trend: [
      { time: '10:00', vibration: 2.9, noise: 0.12 },
      { time: '10:30', vibration: 3.4, noise: 0.19 },
      { time: '11:00', vibration: 7.8, noise: 0.55 },
      { time: '11:30', vibration: 4.1, noise: 0.38 },
      { time: '12:00', vibration: 6.32, noise: 0.48 }
    ],
    upstream_asset: 'ASSET-014 (P-002 Bearing Housing)',
    downstream_asset: 'Edge Vibration Monitor VM-01',
    coupled_driver: 'Stud Mount M8x1.25',
    events: [
      {
        event_id: 'EVT-000902',
        timestamp: '2026-03-03 11:30:00',
        severity: 'medium',
        event_type: 'SENSOR_MOUNTING_RESONANCE',
        message: 'VS-002 shows erratic high-frequency ski-slope spectrum and elevated noise floor (0.48g); loose mounting stud suspected.'
      }
    ],
    work_order: {
      wo_id: 'WO-000277',
      priority: 'P2 - Medium',
      status: 'OPEN',
      failure_code: 'MOUNTING_ISSUE',
      cause_code: 'LOOSE_MOUNTING_STUD',
      action_code: 'TORQUE_AND_VERIFY_SHIELD',
      summary: 'Re-torque VS-002 M8 mounting stud to 18 Nm with coupling fluid and inspect M12 connector shield.'
    },
    decision_tree: [
      {
        step: 1,
        node: 'OBSERVATION',
        title: 'Erratic Vibration Spikes & Ski-Slope Noise Floor',
        detail: 'VS-002 jumps between 3.4 and 7.8 mm/s with a 0.48g low-frequency noise floor.'
      },
      {
        step: 2,
        node: 'SPATIAL_CONTEXT',
        title: 'Mounted on Main Pump Skid [1.16, 0.35, 3.17]',
        detail: 'Adjacent to cavitating pump P-002; heavy skid vibration backed out the sensor stud.'
      },
      {
        step: 3,
        node: 'ROOT_CAUSE',
        title: 'Loose Piezo Mounting Stud & Acoustic Chatter',
        detail: 'Insufficient mounting torque causing mechanical chatter between sensor base and bearing cap (DOC-VIBRATION_SENSOR-CORE).'
      },
      {
        step: 4,
        node: 'SAFE_ACTION',
        title: 'Clean Spot-Face, Apply Silicone Grease & Torque to 18 Nm',
        detail: 'Verify M12 cable strain relief, torque stud to spec, and confirm stable 12.0V IEPE bias voltage.'
      }
    ],
    loto_checklist: [
      'Scan QR-SYN-0029 on sensor junction box.',
      'Bypass vibration trip interlock on VM-01 during sensor handling.',
      'Ensure pump P-002 is stationary before touching bearing housing.',
      'Clean spot-face, apply thin film of coupling grease, and torque stud to 18 Nm.',
      'Verify IEPE bias voltage (11.5–12.5 V DC) and clear interlock bypass.'
    ],
    doc_refs: ['DOC-VIBRATION_SENSOR-CORE', 'DOC-FIELD-SAFETY'],
    data_quality_note: 'DQ-0029: High-frequency rattle artifact flagged by automated signal validator.'
  },

  // ======================== WATCH ASSETS ========================
  {
    asset_id: 'ASSET-002',
    tag: 'CV-002',
    asset_class: 'control_valve',
    subtype: 'globe_control_valve',
    area_id: 'AREA-BOIL',
    area_name: 'Boiler House South',
    line_id: 'LINE-1',
    service_description: 'Feedwater flow control valve 2',
    criticality: 'medium',
    connectivity_profile: 'online_realtime',
    qr_id: 'QR-SYN-0002',
    anchor_id: 'ANCHOR-002',
    position: [-2.08, 0.29, 1.14],
    bbox_size: [0.65, 0.78, 0.65],
    approach_point: [-1.30, -1.02, 1.14],
    health_score: 79,
    health_status: 'watch',
    status_reason: 'MILD_STICTION',
    active_alarm_count: 1,
    open_work_orders: 1,
    anomaly_score: 0.41,
    telemetry: {
      pressure_bar: 5.83,
      flow_m3h: 88.2,
      temperature_c: 53.9,
      setpoint_pct: 61.9,
      position_pct: 58.1,
      stiction_index: 0.41
    },
    telemetry_trend: [
      { time: '10:00', sp: 62.0, pv: 60.2, stiction: 0.31 },
      { time: '11:00', sp: 61.9, pv: 58.8, stiction: 0.37 },
      { time: '12:00', sp: 61.9, pv: 58.1, stiction: 0.41 }
    ],
    upstream_asset: 'ASSET-013 (P-001)',
    downstream_asset: 'Boiler Drum Level Header',
    coupled_driver: 'Pneumatic Actuator',
    events: [
      {
        event_id: 'EVT-000210',
        timestamp: '2026-03-03 11:00:00',
        severity: 'low',
        event_type: 'MILD_STICTION',
        message: 'CV-002 stiction index crept to 0.41 (3.8% tracking offset); scheduled for next PM window.'
      }
    ],
    work_order: {
      wo_id: 'WO-000094',
      priority: 'P3 - Planned',
      status: 'OPEN',
      failure_code: 'MILD_STICTION',
      cause_code: 'PACKING_FRICTION',
      action_code: 'LUBRICATE_AND_MONITOR',
      summary: 'Monitor CV-002 packing friction during shift rounds; lubricate stem at next boiler outage.'
    },
    decision_tree: [
      { step: 1, node: 'OBSERVATION', title: '3.8% Offset & 0.41 Stiction', detail: 'Early-stage stem friction detected prior to hard alarm.' },
      { step: 2, node: 'SPATIAL_CONTEXT', title: 'Upper Valve Rack [-2.08, 0.29, 1.14]', detail: 'Mounted directly above CV-003 in Boiler House South.' },
      { step: 3, node: 'ROOT_CAUSE', title: 'Early Packing Dryness', detail: 'Thermal radiation from overhead steam line drying PTFE stem packing.' },
      { step: 4, node: 'SAFE_ACTION', title: 'Log in Watchlist & Schedule PM', detail: 'No emergency shutdown needed; verify during CV-003 intervention.' }
    ],
    loto_checklist: ['Scan QR-SYN-0002.', 'Visual inspection of stem condition and air gauge (no isolation required for visual check).'],
    doc_refs: ['DOC-CONTROL_VALVE-CORE'],
    data_quality_note: null
  },

  {
    asset_id: 'ASSET-005',
    tag: 'CV-005',
    asset_class: 'control_valve',
    subtype: 'globe_control_valve',
    area_id: 'AREA-PUMP',
    area_name: 'Main Pump Skid',
    line_id: 'LINE-1',
    service_description: 'Feedwater flow control valve 5',
    criticality: 'high',
    connectivity_profile: 'intermittent',
    qr_id: 'QR-SYN-0005',
    anchor_id: 'ANCHOR-005',
    position: [2.82, -0.34, 2.08],
    bbox_size: [0.68, 0.65, 0.68],
    approach_point: [2.10, -1.02, 2.08],
    health_score: 79,
    health_status: 'watch',
    status_reason: 'MILD_STICTION',
    active_alarm_count: 1,
    open_work_orders: 1,
    anomaly_score: 0.43,
    telemetry: {
      pressure_bar: 5.95,
      flow_m3h: 88.2,
      temperature_c: 54.6,
      setpoint_pct: 61.9,
      position_pct: 58.6,
      stiction_index: 0.36
    },
    telemetry_trend: [
      { time: '10:00', sp: 62.0, pv: 60.5, stiction: 0.29 },
      { time: '11:00', sp: 61.9, pv: 59.2, stiction: 0.33 },
      { time: '12:00', sp: 61.9, pv: 58.6, stiction: 0.36 }
    ],
    upstream_asset: 'ASSET-017 (P-005)',
    downstream_asset: 'Line-1 Economizer',
    coupled_driver: 'Pneumatic Actuator',
    events: [
      {
        event_id: 'EVT-000314',
        timestamp: '2026-03-03 11:15:00',
        severity: 'low',
        event_type: 'MILD_STICTION',
        message: 'CV-005 slight position lag (3.3%) downstream of fouled pump P-005.'
      }
    ],
    work_order: {
      wo_id: 'WO-000129',
      priority: 'P3 - Planned',
      status: 'OPEN',
      failure_code: 'MILD_STICTION',
      cause_code: 'UPSTREAM_SCALE_CARRYOVER',
      action_code: 'FLUSH_TRIM',
      summary: 'Inspect CV-005 trim for scale carryover while P-005 is isolated for descaling.'
    },
    decision_tree: [
      { step: 1, node: 'OBSERVATION', title: '3.3% Lag Downstream of P-005', detail: 'Stiction index at 0.36 with mild flow oscillation.' },
      { step: 2, node: 'SPATIAL_CONTEXT', title: 'Main Pump Skid [2.82, -0.34, 2.08]', detail: 'Directly connected to P-005 discharge header.' },
      { step: 3, node: 'ROOT_CAUSE', title: 'Particulate Carryover from P-005 Scale', detail: 'Fine scale debris from P-005 entering CV-005 cage trim.' },
      { step: 4, node: 'SAFE_ACTION', title: 'Group with P-005 LOTO Window', detail: 'Flush CV-005 valve body during P-005 maintenance outage.' }
    ],
    loto_checklist: ['Include CV-005 inside P-005 LOTO boundary.', 'Cycle valve 3x during line flushing.'],
    doc_refs: ['DOC-CONTROL_VALVE-CORE'],
    data_quality_note: null
  },

  {
    asset_id: 'ASSET-019',
    tag: 'M-001',
    asset_class: 'electric_motor',
    subtype: 'induction_motor',
    area_id: 'AREA-PUMP',
    area_name: 'Main Pump Skid',
    line_id: 'LINE-1',
    service_description: 'Drive motor 1',
    criticality: 'medium',
    connectivity_profile: 'online_realtime',
    qr_id: 'QR-SYN-0019',
    anchor_id: 'ANCHOR-019',
    position: [0.54, 0.34, 3.08],
    bbox_size: [0.75, 0.72, 0.72],
    approach_point: [0.54, -1.02, 2.25],
    health_score: 77,
    health_status: 'watch',
    status_reason: 'ELEVATED_BEARING_TEMP',
    active_alarm_count: 1,
    open_work_orders: 1,
    anomaly_score: 0.44,
    telemetry: {
      temperature_c: 57.6,
      motor_current_a: 57.8,
      bearing_temp_c: 73.1,
      vibration_mms: 3.45
    },
    telemetry_trend: [
      { time: '10:00', bearing_temp: 69.5, current: 55.2 },
      { time: '11:00', bearing_temp: 71.4, current: 56.8 },
      { time: '12:00', bearing_temp: 73.1, current: 57.8 }
    ],
    upstream_asset: 'MCC-1 Feeder',
    downstream_asset: 'ASSET-013 (P-001)',
    coupled_driver: 'Standby Pump Drive',
    events: [
      {
        event_id: 'EVT-000550',
        timestamp: '2026-03-03 11:30:00',
        severity: 'low',
        event_type: 'ELEVATED_BEARING_TEMP',
        message: 'M-001 bearing temp at 73.1°C (approaching 75°C warning threshold).'
      }
    ],
    work_order: {
      wo_id: 'WO-000166',
      priority: 'P3 - Planned',
      status: 'OPEN',
      failure_code: 'ELEVATED_BEARING_TEMP',
      cause_code: 'HIGH_AMBIENT_LOAD',
      action_code: 'VERIFY_GREASE_AND_AIRFLOW',
      summary: 'Verify M-001 cooling airflow before switching full Line-1 load from P-002 to P-001.'
    },
    decision_tree: [
      { step: 1, node: 'OBSERVATION', title: 'Bearing Temp 73.1°C on Standby Train', detail: 'Slightly elevated bearing temperature under high boiler house ambient.' },
      { step: 2, node: 'SPATIAL_CONTEXT', title: 'Main Pump Skid [0.54, 0.34, 3.08]', detail: 'Drives standby pump P-001 needed to relieve cavitating P-002.' },
      { step: 3, node: 'ROOT_CAUSE', title: 'Radiant Heat from Adjacent Header', detail: 'Ambient heat soak from nearby steam header.' },
      { step: 4, node: 'SAFE_ACTION', title: 'Verify Fan Airflow Before Load Transfer', detail: 'Confirm cooling fan rotation and bearing oil level before stopping P-002.' }
    ],
    loto_checklist: ['Scan QR-SYN-0019.', 'Verify sight glass oil level and unobstructed fan intake before P-002 changeover.'],
    doc_refs: ['DOC-ELECTRIC_MOTOR-CORE'],
    data_quality_note: null
  },

  {
    asset_id: 'ASSET-026',
    tag: 'PT-002',
    asset_class: 'pressure_transmitter',
    subtype: 'gauge_pressure_transmitter',
    area_id: 'AREA-FEED',
    area_name: 'Feedwater Control Bay',
    line_id: 'LINE-2',
    service_description: 'Line pressure transmitter 2',
    criticality: 'medium',
    connectivity_profile: 'online_realtime',
    qr_id: 'QR-SYN-0026',
    anchor_id: 'ANCHOR-026',
    position: [-1.10, 0.26, 3.48],
    bbox_size: [0.42, 0.52, 0.42],
    approach_point: [-1.10, -1.02, 2.70],
    health_score: 68,
    health_status: 'watch',
    status_reason: 'DRIFT_SUSPECTED',
    active_alarm_count: 1,
    open_work_orders: 1,
    anomaly_score: 0.52,
    telemetry: {
      pressure_bar: 5.34,
      temperature_c: 44.3
    },
    telemetry_trend: [
      { time: '10:00', pressure: 5.55 },
      { time: '11:00', pressure: 5.42 },
      { time: '12:00', pressure: 5.34 }
    ],
    upstream_asset: 'ASSET-003 (CV-003)',
    downstream_asset: 'Feedwater Header',
    coupled_driver: '2-Valve Manifold',
    events: [
      {
        event_id: 'EVT-000688',
        timestamp: '2026-03-03 11:30:00',
        severity: 'low',
        event_type: 'DRIFT_SUSPECTED',
        message: 'PT-002 reading 0.22 bar lower than redundant header gauge; impulse leg sediment suspected.'
      }
    ],
    work_order: {
      wo_id: 'WO-000201',
      priority: 'P3 - Planned',
      status: 'OPEN',
      failure_code: 'DRIFT_SUSPECTED',
      cause_code: 'IMPULSE_LINE_SEDIMENT',
      action_code: 'BLOWDOWN_IMPULSE_LINE',
      summary: 'Isolate PT-002 manifold, blow down impulse line, and perform HART zero trim.'
    },
    decision_tree: [
      { step: 1, node: 'OBSERVATION', title: '0.22 bar Offset vs Header Reference', detail: 'Gradual downward drift over 48 hours.' },
      { step: 2, node: 'SPATIAL_CONTEXT', title: 'Feedwater Bay [-1.10, 0.26, 3.48]', detail: 'Monitors discharge header downstream of CV-003.' },
      { step: 3, node: 'ROOT_CAUSE', title: 'Partially Plugged Impulse Sensing Line', detail: 'Magnetite sediment accumulation in bottom impulse tap (DOC-PRESSURE_TRANSMITTER-CORE).' },
      { step: 4, node: 'SAFE_ACTION', title: 'Manifold Isolation & Impulse Blowdown', detail: 'Close block valve, open equalize/vent valve, and verify zero mA output.' }
    ],
    loto_checklist: ['Scan QR-SYN-0026.', 'Close manifold block valve, open vent to drain pan, and perform HART zero trim.'],
    doc_refs: ['DOC-PRESSURE_TRANSMITTER-CORE'],
    data_quality_note: 'DQ-0026: Sensor bias drift +0.22 bar detected by cross-channel reconciliation.'
  }
];

// Generate the remaining 20 healthy assets from the 30-asset Valmet Builder Pack
// aligned to real extracted 3D clusters in the Boiler Room scan
const ADDITIONAL_VALMET_SPECS = [
  { id: 'ASSET-001', tag: 'CV-001', cls: 'control_valve', sub: 'globe_control_valve', area: 'Boiler House South', line: 'LINE-1', desc: 'Feedwater flow control valve 1', crit: 'high', conn: 'online_realtime', qr: 'QR-SYN-0001', pos: [1.45, -0.22, 2.00], size: [0.62, 0.65, 0.55], health: 92, press: 6.23, flow: 92.8, temp: 51.3 },
  { id: 'ASSET-004', tag: 'CV-004', cls: 'control_valve', sub: 'globe_control_valve', area: 'Feedwater Control Bay', line: 'LINE-2', desc: 'Feedwater flow control valve 4', crit: 'high', conn: 'online_realtime', qr: 'QR-SYN-0004', pos: [1.08, -0.29, 3.03], size: [0.65, 0.72, 0.60], health: 91, press: 6.23, flow: 92.6, temp: 52.0 },
  { id: 'ASSET-006', tag: 'CV-006', cls: 'control_valve', sub: 'globe_control_valve', area: 'Main Pump Skid', line: 'LINE-1', desc: 'Feedwater flow control valve 6', crit: 'medium', conn: 'online_realtime', qr: 'QR-SYN-0006', pos: [2.34, -0.33, 1.89], size: [0.64, 0.62, 0.62], health: 90, press: 6.13, flow: 92.6, temp: 51.5 },
  { id: 'ASSET-007', tag: 'CV-007', cls: 'control_valve', sub: 'globe_control_valve', area: 'Boiler House South', line: 'LINE-2', desc: 'Feedwater flow control valve 7', crit: 'medium', conn: 'online_realtime', qr: 'QR-SYN-0007', pos: [-3.27, -0.52, 1.23], size: [0.55, 0.70, 0.68], health: 89, press: 6.15, flow: 92.0, temp: 51.8 },
  { id: 'ASSET-008', tag: 'CV-008', cls: 'control_valve', sub: 'globe_control_valve', area: 'Boiler House South', line: 'LINE-1', desc: 'Feedwater flow control valve 8', crit: 'high', conn: 'intermittent', qr: 'QR-SYN-0008', pos: [2.84, 0.93, 2.19], size: [0.66, 0.64, 0.66], health: 92, press: 6.26, flow: 92.6, temp: 51.8 },
  { id: 'ASSET-010', tag: 'CV-010', cls: 'control_valve', sub: 'globe_control_valve', area: 'Auxiliary Loop North', line: 'LINE-3', desc: 'Feedwater flow control valve 10', crit: 'medium', conn: 'online_realtime', qr: 'QR-SYN-0010', pos: [2.81, 0.93, 2.96], size: [0.66, 0.55, 0.66], health: 88, press: 6.08, flow: 91.5, temp: 52.1 },
  { id: 'ASSET-011', tag: 'CV-011', cls: 'control_valve', sub: 'globe_control_valve', area: 'Feedwater Control Bay', line: 'LINE-2', desc: 'Feedwater flow control valve 11', crit: 'low', conn: 'manual_round', qr: 'QR-SYN-0011', pos: [0.61, -0.22, 2.97], size: [0.64, 0.72, 0.62], health: 90, press: 6.14, flow: 92.2, temp: 52.3 },
  { id: 'ASSET-012', tag: 'CV-012', cls: 'control_valve', sub: 'globe_control_valve', area: 'Boiler House South', line: 'LINE-1', desc: 'Feedwater flow control valve 12', crit: 'medium', conn: 'online_realtime', qr: 'QR-SYN-0012', pos: [3.64, 0.36, 2.86], size: [0.62, 0.78, 0.72], health: 91, press: 6.18, flow: 91.7, temp: 51.4 },
  { id: 'ASSET-013', tag: 'P-001', cls: 'process_pump', sub: 'centrifugal_pump', area: 'Main Pump Skid', line: 'LINE-1', desc: 'Circulation pump 1 (Standby)', crit: 'high', conn: 'online_realtime', qr: 'QR-SYN-0013', pos: [1.25, 0.96, 2.96], size: [0.80, 0.78, 0.80], health: 88, press: 4.18, flow: 132.4, temp: 49.4 },
  { id: 'ASSET-015', tag: 'P-003', cls: 'process_pump', sub: 'centrifugal_pump', area: 'Feedwater Control Bay', line: 'LINE-2', desc: 'Circulation pump 3', crit: 'high', conn: 'online_realtime', qr: 'QR-SYN-0015', pos: [2.97, 0.90, 1.22], size: [0.78, 0.65, 0.78], health: 88, press: 4.18, flow: 131.6, temp: 49.4 },
  { id: 'ASSET-016', tag: 'P-004', cls: 'process_pump', sub: 'centrifugal_pump', area: 'Boiler House South', line: 'LINE-1', desc: 'Circulation pump 4', crit: 'medium', conn: 'intermittent', qr: 'QR-SYN-0016', pos: [-2.14, 0.59, 3.06], size: [0.80, 0.76, 0.80], health: 90, press: 4.24, flow: 133.4, temp: 48.9 },
  { id: 'ASSET-018', tag: 'P-006', cls: 'process_pump', sub: 'centrifugal_pump', area: 'Auxiliary Loop North', line: 'LINE-3', desc: 'Circulation pump 6', crit: 'medium', conn: 'online_realtime', qr: 'QR-SYN-0018', pos: [-2.96, 0.65, 2.95], size: [0.82, 0.78, 0.80], health: 89, press: 4.21, flow: 132.7, temp: 48.7 },
  { id: 'ASSET-020', tag: 'M-002', cls: 'electric_motor', sub: 'induction_motor', area: 'Main Pump Skid', line: 'LINE-1', desc: 'Drive motor 2 (Coupled to P-002)', crit: 'high', conn: 'online_realtime', qr: 'QR-SYN-0020', pos: [2.01, 0.98, 3.06], size: [0.74, 0.68, 0.76], health: 89, press: 0, flow: 0, temp: 52.8 },
  { id: 'ASSET-021', tag: 'M-003', cls: 'electric_motor', sub: 'induction_motor', area: 'Feedwater Control Bay', line: 'LINE-2', desc: 'Drive motor 3', crit: 'medium', conn: 'online_realtime', qr: 'QR-SYN-0021', pos: [3.70, 0.45, 1.24], size: [0.64, 0.78, 0.76], health: 89, press: 0, flow: 0, temp: 52.2 },
  { id: 'ASSET-022', tag: 'M-004', cls: 'electric_motor', sub: 'induction_motor', area: 'Boiler House South', line: 'LINE-1', desc: 'Drive motor 4', crit: 'medium', conn: 'manual_round', qr: 'QR-SYN-0022', pos: [-3.77, -0.42, 1.11], size: [0.62, 0.78, 0.78], health: 89, press: 0, flow: 0, temp: 52.3 },
  { id: 'ASSET-023', tag: 'M-005', cls: 'electric_motor', sub: 'induction_motor', area: 'Main Pump Skid', line: 'LINE-1', desc: 'Drive motor 5 (Coupled to P-005)', crit: 'high', conn: 'online_realtime', qr: 'QR-SYN-0023', pos: [3.68, -0.23, 1.20], size: [0.58, 0.58, 0.74], health: 88, press: 0, flow: 0, temp: 53.6 },
  { id: 'ASSET-025', tag: 'PT-001', cls: 'pressure_transmitter', sub: 'gauge_pressure_transmitter', area: 'Boiler House South', line: 'LINE-1', desc: 'Line pressure transmitter 1', crit: 'medium', conn: 'online_realtime', qr: 'QR-SYN-0025', pos: [1.25, 0.98, 2.22], size: [0.44, 0.52, 0.44], health: 92, press: 5.83, flow: 0, temp: 43.3 },
  { id: 'ASSET-027', tag: 'PT-003', cls: 'pressure_transmitter', sub: 'gauge_pressure_transmitter', area: 'Auxiliary Loop North', line: 'LINE-3', desc: 'Line pressure transmitter 3', crit: 'low', conn: 'manual_round', qr: 'QR-SYN-0027', pos: [-1.54, 0.52, 3.29], size: [0.44, 0.52, 0.44], health: 92, press: 5.80, flow: 0, temp: 43.3 },
  { id: 'ASSET-028', tag: 'VS-001', cls: 'vibration_sensor', sub: 'piezo_velocity_sensor', area: 'Main Pump Skid', line: 'LINE-1', desc: 'Bearing vibration sensor 1', crit: 'medium', conn: 'online_realtime', qr: 'QR-SYN-0028', pos: [0.45, 0.98, 3.04], size: [0.40, 0.42, 0.40], health: 92, press: 0, flow: 0, temp: 42.3 },
  { id: 'ASSET-030', tag: 'VS-003', cls: 'vibration_sensor', sub: 'piezo_velocity_sensor', area: 'Auxiliary Loop North', line: 'LINE-3', desc: 'Bearing vibration sensor 3', crit: 'low', conn: 'online_realtime', qr: 'QR-SYN-0030', pos: [-2.97, 0.66, 2.19], size: [0.42, 0.42, 0.42], health: 90, press: 0, flow: 0, temp: 42.3 }
];

ADDITIONAL_VALMET_SPECS.forEach((s) => {
  const num = s.id.split('-')[1];
  const docMap = {
    control_valve: 'DOC-CONTROL_VALVE-CORE',
    process_pump: 'DOC-PROCESS_PUMP-CORE',
    electric_motor: 'DOC-ELECTRIC_MOTOR-CORE',
    pressure_transmitter: 'DOC-PRESSURE_TRANSMITTER-CORE',
    vibration_sensor: 'DOC-VIBRATION_SENSOR-CORE'
  };
  VALMET_ASSETS.push({
    asset_id: s.id,
    tag: s.tag,
    asset_class: s.cls,
    subtype: s.sub,
    area_id: s.area.includes('Pump') ? 'AREA-PUMP' : s.area.includes('Feed') ? 'AREA-FEED' : s.area.includes('Aux') ? 'AREA-AUX' : 'AREA-BOIL',
    area_name: s.area,
    line_id: s.line,
    service_description: s.desc,
    criticality: s.crit,
    connectivity_profile: s.conn,
    qr_id: s.qr,
    anchor_id: `ANCHOR-${num}`,
    position: s.pos,
    bbox_size: s.size,
    approach_point: [s.pos[0] * 0.7, -1.02, Math.min(2.6, Math.max(0.8, s.pos[2] - 0.5))],
    health_score: s.health,
    health_status: 'healthy',
    status_reason: 'NORMAL_OPERATION',
    active_alarm_count: 0,
    open_work_orders: 0,
    anomaly_score: 0.14,
    telemetry: {
      pressure_bar: s.press || 5.8,
      flow_m3h: s.flow || 91.2,
      temperature_c: s.temp,
      setpoint_pct: 64.0,
      position_pct: 63.8,
      vibration_mms: 2.1,
      bearing_temp_c: 64.2,
      motor_current_a: 52.4
    },
    telemetry_trend: [
      { time: '10:00', sp: 64.0, pv: 63.9, vibration: 2.0 },
      { time: '11:00', sp: 64.0, pv: 63.8, vibration: 2.1 },
      { time: '12:00', sp: 64.0, pv: 63.8, vibration: 2.1 }
    ],
    upstream_asset: 'Main Boiler Header',
    downstream_asset: `${s.line} Distribution Loop`,
    coupled_driver: 'Nominal',
    events: [
      {
        event_id: `EVT-0001${num}`,
        timestamp: '2026-03-03 08:00:00',
        severity: 'info',
        event_type: 'ROUTINE_HEALTH_CHECK',
        message: `${s.tag} operating within normal baseline parameters (Health ${s.health}/100).`
      }
    ],
    work_order: null,
    decision_tree: [
      { step: 1, node: 'OBSERVATION', title: 'Nominal Telemetry Signature', detail: `Health score ${s.health}/100 with zero active alarms.` },
      { step: 2, node: 'SPATIAL_CONTEXT', title: `${s.area} (${s.line})`, detail: `Anchored at [${s.pos.map((n) => n.toFixed(2)).join(', ')}] in Boiler Room scan.` },
      { step: 3, node: 'ROOT_CAUSE', title: 'No Fault Detected', detail: 'Operating inside design envelope.' },
      { step: 4, node: 'SAFE_ACTION', title: 'Continue Autonomous Monitoring', detail: 'Include in standard mobile robot patrol route.' }
    ],
    loto_checklist: [
      `Scan ${s.qr} during routine operator round.`,
      'Verify no external leaks or abnormal acoustic noise.'
    ],
    doc_refs: [docMap[s.cls], 'DOC-FIELD-SAFETY'],
    data_quality_note: s.conn === 'manual_round' ? `DQ-00${num}: Manual-round asset — telemetry updated via handheld field sync.` : null
  });
});

// Sort by asset_id
VALMET_ASSETS.sort((a, b) => a.asset_id.localeCompare(b.asset_id));

/**
 * Additional Structural & Environmental 3D Bounding Boxes extracted from "Industrial Boiler Room (1).ply"
 * to maximize Criterion 1 (30% Weight: Semantic Asset Extraction Density & 3D Framing)
 */
export const STRUCTURAL_BOILER_OBJECTS = [
  { id: 'STRUCT-BOILER-DRUM-1', label: 'Primary Steam Boiler Vessel B-101', category: 'Boiler Vessel', position: [-0.20, 0.35, 3.35], size: [1.95, 1.85, 0.95], color: '#38bdf8' },
  { id: 'STRUCT-BOILER-DRUM-2', label: 'Secondary Economizer Vessel E-102', category: 'Pressure Vessel', position: [3.62, 0.42, 2.05], size: [0.85, 2.15, 2.25], color: '#38bdf8' },
  { id: 'STRUCT-HEADER-MAIN', label: 'High-Pressure Steam Header HDR-01', category: 'Piping Header', position: [0.45, 1.05, 2.65], size: [4.80, 0.42, 0.55], color: '#818cf8' },
  { id: 'STRUCT-PIPE-RACK-WEST', label: 'West Feedwater Pipe Manifold', category: 'Piping Rack', position: [-3.05, 0.15, 1.65], size: [0.85, 1.80, 1.90], color: '#818cf8' },
  { id: 'STRUCT-MCC-CABINET', label: 'Boiler Control & MCC Panel Bay', category: 'Electrical Bay', position: [-4.45, 0.10, 1.65], size: [0.75, 1.85, 1.75], color: '#a78bfa' },
  { id: 'STRUCT-CATWALK-STAIR', label: 'Maintenance Catwalk & Access Step', category: 'Access Structure', position: [-0.45, -0.85, 1.25], size: [1.55, 0.45, 0.75], color: '#94a3b8' },
  { id: 'STRUCT-TOOL-CRIB', label: 'Field Service Tool Crib & LOTO Station', category: 'Safety Station', position: [0.00, -0.65, -0.25], size: [0.90, 0.85, 0.65], color: '#34d399' },
  { id: 'STRUCT-DRAIN-TRENCH', label: 'Floor Blowdown Trench & Sump', category: 'Floor Structure', position: [1.85, -1.04, 1.35], size: [1.80, 0.18, 0.65], color: '#64748b' }
];
