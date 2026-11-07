/**
 * Shared status + formatting helpers (ISA-101 style: colour only for abnormal states).
 */

export const STATUS = {
  attention_required: { label: 'Alarm', cls: 'critical', rank: 0 },
  degraded: { label: 'Degraded', cls: 'high', rank: 1 },
  watch: { label: 'Watch', cls: 'medium', rank: 2 },
  healthy: { label: 'Normal', cls: 'normal', rank: 3 }
};

export const statusOf = (asset) => STATUS[asset?.health_status] || STATUS.healthy;

export const isAbnormal = (asset) => asset && asset.health_status !== 'healthy';

/** "POSITION_DEVIATION" -> "Position deviation" */
export function humanize(value) {
  if (value === null || value === undefined) return '—';
  const s = String(value).replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Strip markdown emphasis / inline code from copilot answers. */
export function cleanMarkdown(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*\*\s+/gm, '• ');
}

const TELEMETRY_META = {
  pressure_bar: ['Pressure', 'bar'],
  flow_m3h: ['Flow', 'm³/h'],
  temperature_c: ['Temperature', '°C'],
  setpoint_pct: ['Setpoint', '%'],
  position_pct: ['Position', '%'],
  stiction_index: ['Stiction index', ''],
  supply_air_bar: ['Supply air', 'bar'],
  vibration_mms: ['Vibration', 'mm/s'],
  bearing_temp_c: ['Bearing temp.', '°C'],
  current_a: ['Motor current', 'A'],
  motor_current_a: ['Motor current', 'A'],
  discharge_pressure_bar: ['Discharge pressure', 'bar'],
  suction_pressure_bar: ['Suction pressure', 'bar'],
  speed_rpm: ['Speed', 'rpm'],
  signal_quality_pct: ['Signal quality', '%']
};

export function telemetryLabel(key) {
  return TELEMETRY_META[key]?.[0] || humanize(key);
}

export function telemetryUnit(key) {
  return TELEMETRY_META[key]?.[1] ?? '';
}

export function sortBySeverity(assets) {
  return [...assets].sort((a, b) => {
    const r = statusOf(a).rank - statusOf(b).rank;
    if (r !== 0) return r;
    return a.health_score - b.health_score;
  });
}
