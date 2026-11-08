/**
 * Service playbooks per Excel issue code (Current_State.issue_code / Historical_Service_Cases).
 *
 * The pack gives the issue code, its interpretation and the recommended next check; it gives no
 * step-by-step procedures. The steps below are ILLUSTRATIVE guidance for the PoC and are always
 * shown together with DOC-FIELD-SAFETY: they never replace site procedures, LOTO, permits or OEM
 * instructions.
 *
 * signals[].expect: how the signal behaves when the issue is real —
 *   'high' / 'low' = deviation from the healthy-class baseline, 'up' / 'down' = 3-day trend.
 */

export const PLAYBOOK_DISCLAIMER =
  'Steps are illustrative PoC guidance. Follow site procedures, LOTO, permits and OEM instructions (DOC-FIELD-SAFETY).';

export const ISSUE_PLAYBOOKS = {
  CAVITATION_RISK: {
    signals: [
      { signal: 'process_flow_pct', expect: 'low', why: 'reduced throughput when suction head is insufficient' },
      { signal: 'process_pressure_bar', expect: 'low', why: 'unstable / low discharge pressure' },
      { signal: 'vibration_mm_s', expect: 'high', why: 'broadband vibration from collapsing vapour bubbles' }
    ],
    inspect: [
      'Listen at the casing for gravel-like crackling noise (classic cavitation sound).',
      'Read suction pressure locally and compare with required NPSH on the pump datasheet.',
      'Check suction strainer differential pressure and whether the suction valve is fully open.',
      'Check liquid level / supply pressure of the source feeding the suction.'
    ],
    service: [
      'Clean the suction strainer if ΔP is high.',
      'Restore suction supply (open valve fully, correct source level/pressure) before touching the pump.',
      'If cavitation persisted, plan impeller inspection for pitting at next window.'
    ],
    verify: [
      'Flow and discharge pressure back near baseline.',
      'Vibration trend falling back toward class baseline within the next shift.'
    ],
    upstreamCheck: 'Anything that starves the suction: supply valve position, source level/pressure, strainer, drive speed.',
    downstreamCheck: 'Downstream control valves compensating for low flow (opening further) and pressure at the next instrument.'
  },
  FOULING: {
    signals: [
      { signal: 'process_flow_pct', expect: 'low', why: 'hydraulic path restriction reduces flow' },
      { signal: 'motor_current_a', expect: 'high', why: 'more power needed for the same duty' },
      { signal: 'bearing_temp_c', expect: 'up', why: 'higher load raises bearing temperature' }
    ],
    inspect: [
      'Compare current pump duty point (flow vs pressure) against the pump curve.',
      'Check suction strainer and discharge line for deposits.',
      'Check upstream water quality / treatment status (deposits originate upstream).'
    ],
    service: [
      'Clean strainer / flush hydraulic path under permit.',
      'Inspect impeller and volute for deposits at the next opportunity; clean if fouled.'
    ],
    verify: [
      'Motor current back toward baseline at the same flow.',
      'Flow recovered; record before/after values in the work order.'
    ],
    upstreamCheck: 'Source of deposits: water treatment / make-up quality and the pump feeding this one.',
    downstreamCheck: 'Header pressure and the valves fed by this pump (reduced supply to consumers).'
  },
  SEAL_DEGRADATION: {
    signals: [
      { signal: 'process_pressure_bar', expect: 'low', why: 'internal / external leakage reduces pressure' },
      { signal: 'process_flow_pct', expect: 'low', why: 'recirculation or leakage loss' },
      { signal: 'bearing_temp_c', expect: 'high', why: 'seal friction and heat near the bearing housing' }
    ],
    inspect: [
      'Visually inspect the mechanical seal area and drain for leakage (from a safe distance, guards on).',
      'Check seal flush / quench supply is flowing.',
      'Check bearing housing temperature with a handheld IR thermometer.'
    ],
    service: [
      'Plan seal replacement if leakage is confirmed; prepare spare seal kit.',
      'Restore seal flush if it was interrupted.'
    ],
    verify: ['No visible leakage after restart.', 'Pressure and flow back near baseline.'],
    upstreamCheck: 'Seal flush source and suction conditions (dry running damages seals).',
    downstreamCheck: 'Downstream pressure / dosing accuracy affected by lost flow.'
  },
  MISALIGNMENT: {
    signals: [
      { signal: 'vibration_mm_s', expect: 'high', why: 'shaft misalignment raises 1x/2x running-speed vibration' },
      { signal: 'bearing_temp_c', expect: 'up', why: 'extra bearing load' },
      { signal: 'motor_current_a', expect: 'high', why: 'additional mechanical losses' }
    ],
    inspect: [
      'Check coupling guard, coupling element wear and baseplate bolts.',
      'Take vibration readings in axial and radial directions on both machines (axial high = misalignment).',
      'Check for soft foot / pipe strain on the casing.'
    ],
    service: [
      'Perform laser shaft alignment with the drive isolated.',
      'Replace worn coupling element; correct soft foot.'
    ],
    verify: ['Vibration back under class baseline after restart.', 'Bearing temperature stable.'],
    upstreamCheck: 'The coupled drive / driven machine (misalignment is shared by both shafts).',
    downstreamCheck: 'The machine on the other side of the coupling and its bearing condition.'
  },
  CURRENT_IMBALANCE: {
    signals: [
      { signal: 'motor_current_a', expect: 'high', why: 'imbalanced phases raise current on at least one phase' },
      { signal: 'bearing_temp_c', expect: 'up', why: 'extra heating from negative-sequence currents' }
    ],
    inspect: [
      'Measure all three phase currents and voltages at the MCC / VFD (qualified electrician).',
      'Thermal-image the terminal box and feeder connections.',
      'Check the driven load for mechanical binding.'
    ],
    service: [
      'Tighten / repair loose or burnt connections.',
      'If voltage is balanced but current is not, schedule winding insulation test.'
    ],
    verify: ['Phase currents within site tolerance.', 'Motor current back toward baseline.'],
    upstreamCheck: 'Electrical feeder: MCC bucket, breaker, VFD and supply voltage balance.',
    downstreamCheck: 'Driven pump / machine load: is it demanding more torque?'
  },
  OVERHEATING: {
    signals: [
      { signal: 'bearing_temp_c', expect: 'high', why: 'bearing / frame temperature above baseline' },
      { signal: 'motor_current_a', expect: 'high', why: 'overload is one cause of heating' }
    ],
    inspect: [
      'Check cooling fan, fan cowl and cooling fins for blockage or dirt.',
      'Check cooling-water / ambient supply if the drive is water- or air-cooled.',
      'Check bearing lubrication condition and grease interval.'
    ],
    service: [
      'Clean cooling path; restore cooling supply.',
      'Re-lubricate bearing per OEM quantity; replace bearing if damaged.'
    ],
    verify: ['Temperature trending down toward baseline within hours.', 'No overload trips.'],
    upstreamCheck: 'Cooling supply and electrical feeder (overload / voltage).',
    downstreamCheck: 'Driven equipment load — increased demand overheats the motor.'
  },
  POSITION_DEVIATION: {
    signals: [
      { signal: 'position_error_pct', expect: 'high', why: 'actual position does not follow setpoint' },
      { signal: 'process_flow_pct', expect: 'low', why: 'flow not matching the commanded opening' },
      { signal: 'pneumatic_supply_bar', expect: 'low', why: 'low air supply is a common cause' },
      { signal: 'stiction_index', expect: 'high', why: 'friction makes the stem stick and jump' }
    ],
    inspect: [
      'Compare controller output, positioner setpoint and local stem indicator.',
      'Check instrument-air supply pressure at the positioner.',
      'Check positioner diagnostics (HART/FF) for travel deviation alerts.',
      'Inspect stem packing and linkage for looseness or binding.'
    ],
    service: [
      'Re-run positioner auto-calibration / travel calibration.',
      'Adjust or replace packing if friction is confirmed; fix linkage play.'
    ],
    verify: ['Step test: actual follows setpoint within tolerance.', 'Loop flow back on target.'],
    upstreamCheck: 'Instrument air, DCS output and the process feeding the valve (pressure drop across it).',
    downstreamCheck: 'Equipment fed by this valve: flow-starved pumps, downstream pressure instruments.'
  },
  CALIBRATION_DRIFT: {
    signals: [
      { signal: 'position_error_pct', expect: 'high', why: 'zero/span drift creates a steady offset' },
      { signal: 'process_flow_pct', expect: 'low', why: 'offset changes delivered flow' }
    ],
    inspect: [
      'Check zero and span at 0 / 50 / 100 % with a calibrator.',
      'Compare with last calibration record.'
    ],
    service: ['Recalibrate positioner zero/span.', 'Update calibration record and interval.'],
    verify: ['As-left error within tolerance at all test points.'],
    upstreamCheck: 'DCS output signal and analog-output card calibration.',
    downstreamCheck: 'Flow or pressure loops controlled by this valve.'
  },
  ACTUATOR_FRICTION: {
    signals: [
      { signal: 'stiction_index', expect: 'high', why: 'higher friction in actuator / packing' },
      { signal: 'load_for_opening_pct', expect: 'high', why: 'more force needed to open' }
    ],
    inspect: ['Run a valve signature test.', 'Inspect packing, stem finish and actuator diaphragm/spring.'],
    service: ['Adjust packing load; replace packing or actuator soft parts if worn.'],
    verify: ['Friction / load back near baseline in signature test.'],
    upstreamCheck: 'Instrument-air quality (moisture/oil causes actuator wear).',
    downstreamCheck: 'Control loop oscillation in the fed process.'
  },
  STICTION_TREND: {
    signals: [{ signal: 'stiction_index', expect: 'up', why: 'friction increasing over time' }],
    inspect: ['Review stiction trend and loop oscillation.', 'Inspect packing.'],
    service: ['Plan packing service before loop performance degrades.'],
    verify: ['Stiction index stable.'],
    upstreamCheck: 'Instrument air quality.',
    downstreamCheck: 'Oscillation in downstream flow / pressure.'
  },
  SUPPLY_PRESSURE_LOW: {
    signals: [{ signal: 'pneumatic_supply_bar', expect: 'low', why: 'instrument-air pressure below normal' }],
    inspect: ['Read supply gauge at the filter-regulator.', 'Check for air leaks on tubing and fittings.'],
    service: ['Fix leaks; adjust or replace filter-regulator.'],
    verify: ['Supply pressure at baseline; valve strokes fully.'],
    upstreamCheck: 'Instrument-air header and compressor / dryer.',
    downstreamCheck: 'Valve travel and the loop it controls.'
  },
  SEAT_LEAKAGE_SUSPECTED: {
    signals: [{ signal: 'process_flow_pct', expect: 'high', why: 'flow passes even when commanded closed' }],
    inspect: ['Check flow / pressure with valve commanded closed.', 'Acoustic leak check across the seat.'],
    service: ['Plan trim (plug/seat) inspection at the next shutdown.'],
    verify: ['No flow at closed position.'],
    upstreamCheck: 'Upstream pressure (high ΔP accelerates seat erosion).',
    downstreamCheck: 'Downstream equipment receiving unwanted flow.'
  },
  BEARING_WEAR: {
    signals: [
      { signal: 'vibration_mm_s', expect: 'high', why: 'bearing defect frequencies raise vibration' },
      { signal: 'bearing_temp_c', expect: 'high', why: 'friction in damaged bearing' }
    ],
    inspect: ['Take envelope / high-frequency vibration readings.', 'Check lubrication and listen for noise.'],
    service: ['Re-lubricate; plan bearing replacement if defect frequencies confirmed.'],
    verify: ['Vibration and temperature back to baseline.'],
    upstreamCheck: 'Coupled drive and alignment.',
    downstreamCheck: 'Driven equipment (shared shaft load).'
  },
  SENSOR_DRIFT: {
    signals: [
      { signal: 'sensor_bias', expect: 'high', why: 'measurement offset growing' },
      { signal: 'process_pressure_bar', expect: 'up', why: 'reading drifting without process cause' }
    ],
    inspect: ['Compare with a reference gauge / redundant measurement.', 'Check impulse lines for plugging.'],
    service: ['Recalibrate or replace the transmitter.'],
    verify: ['Reading matches reference within tolerance.'],
    upstreamCheck: 'Process equipment the instrument measures — confirm the process really changed.',
    downstreamCheck: 'Control loops and alarms that use this measurement.'
  },
  SIGNAL_DROPOUT: {
    signals: [{ signal: 'signal_quality_pct', expect: 'low', why: 'intermittent communication / signal loss' }],
    inspect: ['Check cable, glands and junction box for moisture or damage.', 'Check loop power.'],
    service: ['Repair wiring / connector; replace device if intermittent internally.'],
    verify: ['Signal quality at 99%+ for a full shift.'],
    upstreamCheck: 'Loop power and I/O card.',
    downstreamCheck: 'Control logic / interlocks using the signal.'
  },
  CALIBRATION_DUE: {
    signals: [],
    inspect: ['Confirm calibration interval from the service record.'],
    service: ['Schedule calibration against a reference.'],
    verify: ['Calibration record updated.'],
    upstreamCheck: 'Process measured by the instrument.',
    downstreamCheck: 'Loops / alarms using the measurement.'
  },
  MOUNTING_ISSUE: {
    signals: [
      { signal: 'vibration_mm_s', expect: 'high', why: 'loose mount amplifies or distorts readings' },
      { signal: 'signal_quality_pct', expect: 'low', why: 'noisy / intermittent signal' }
    ],
    inspect: [
      'Check the sensor mounting stud / magnet base torque and surface contact.',
      'Compare with a handheld vibration reading at the same point.'
    ],
    service: ['Re-mount on a clean, flat surface with correct torque; replace cable if damaged.'],
    verify: ['Sensor reading matches the handheld reference.'],
    upstreamCheck: 'Condition-monitoring gateway and cabling.',
    downstreamCheck: 'The machine this sensor monitors — its vibration evidence is unreliable until fixed.'
  },
  NORMAL: {
    signals: [],
    inspect: ['No abnormal condition in the pack. Routine visual check during the round.'],
    service: ['No service needed now; follow the service interval.'],
    verify: [],
    upstreamCheck: 'No action required.',
    downstreamCheck: 'No action required.'
  }
};

export function getPlaybook(issueCode) {
  return ISSUE_PLAYBOOKS[issueCode] || ISSUE_PLAYBOOKS.NORMAL;
}
