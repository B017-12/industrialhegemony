import {
  Activity,
  CircleCheck,
  CircleDashed,
  CircleOff,
  Cog,
  Droplets,
  Eye,
  Gauge,
  OctagonAlert,
  Shapes,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";

// Tailwind only generates classes it can see as literal strings, so every
// tone spells out its classes here.
export const TONES = {
  normal: {
    text: "text-status-normal",
    bg: "bg-status-normal-soft",
    dot: "bg-status-normal",
    border: "border-status-normal/35",
    stroke: "stroke-status-normal",
    fill: "fill-status-normal",
  },
  watch: {
    text: "text-status-watch",
    bg: "bg-status-watch-soft",
    dot: "bg-status-watch",
    border: "border-status-watch/40",
    stroke: "stroke-status-watch",
    fill: "fill-status-watch",
  },
  degraded: {
    text: "text-status-degraded",
    bg: "bg-status-degraded-soft",
    dot: "bg-status-degraded",
    border: "border-status-degraded/40",
    stroke: "stroke-status-degraded",
    fill: "fill-status-degraded",
  },
  critical: {
    text: "text-status-critical",
    bg: "bg-status-critical-soft",
    dot: "bg-status-critical",
    border: "border-status-critical/45",
    stroke: "stroke-status-critical",
    fill: "fill-status-critical",
  },
  offline: {
    text: "text-status-offline",
    bg: "bg-status-offline-soft",
    dot: "bg-status-offline",
    border: "border-status-offline/35",
    stroke: "stroke-status-offline",
    fill: "fill-status-offline",
  },
  procedural: {
    text: "text-status-procedural",
    bg: "bg-status-procedural-soft",
    dot: "bg-status-procedural",
    border: "border-status-procedural/40",
    stroke: "stroke-status-procedural",
    fill: "fill-status-procedural",
  },
  accent: {
    text: "text-accent",
    bg: "bg-accent-soft",
    dot: "bg-accent",
    border: "border-accent/40",
    stroke: "stroke-accent",
    fill: "fill-accent",
  },
};

// Hex values of the --color-status-* and --color-accent tokens in styles.css,
// for WebGL and canvas drawing. Keep them in sync with the tokens.
export const STATUS_HEX = {
  normal: "#3fb950",
  watch: "#e3b341",
  degraded: "#f0883e",
  critical: "#ff6b61",
  offline: "#8b96a5",
  procedural: "#b49cff",
  accent: "#4cc2ff",
  unbound: "#6b788a",
};

export function statusHexOf(conditionState) {
  return STATUS_HEX[conditionOf(conditionState).tone];
}

// Workbook Current_State.condition_state values, worst first. Each status has
// a distinct icon so state never depends on colour alone (WCAG 1.4.1).
export const CONDITIONS = {
  attention_required: { label: "Attention", long: "Attention required", tone: "critical", icon: OctagonAlert, rank: 0 },
  degraded: { label: "Degraded", long: "Degraded", tone: "degraded", icon: TriangleAlert, rank: 1 },
  watch: { label: "Watch", long: "Watch", tone: "watch", icon: Eye, rank: 2 },
  healthy: { label: "Healthy", long: "Healthy", tone: "normal", icon: CircleCheck, rank: 3 },
};
const NO_DATA = { label: "No data", long: "No current state", tone: "offline", icon: CircleOff, rank: 4 };

export const CONDITION_ORDER = Object.keys(CONDITIONS);

export function conditionOf(state) {
  return CONDITIONS[state] ?? NO_DATA;
}

export const MAPPING = {
  procedural_demo_target: { label: "Demo target", long: "Procedural demo target", procedural: true },
  procedural_class_match: { label: "Class match", long: "Procedural class match", procedural: true },
  procedural_fallback: { label: "Fallback", long: "Procedural fallback", procedural: true },
  manual: { label: "Manual", long: "Manually bound", procedural: false },
  // A reviewer picked the object, but the asset identity is still unverified,
  // so it keeps the dashed "unverified" styling.
  human_assigned: { label: "Reviewer-assigned", long: "Reviewer-assigned, unverified", procedural: true, badge: "Unverified · Reviewer-assigned" },
  video_evidence: { label: "Video evidence", long: "Matched in the video frames, unverified", procedural: true, badge: "Unverified · Video evidence" },
};

export function mappingOf(method) {
  if (!method) return { label: "Unbound", long: "No scene binding", procedural: false, unbound: true };
  return MAPPING[method] ?? { label: method, long: method, procedural: method.startsWith("procedural") };
}

export const ASSET_CLASSES = {
  PROCESS_PUMP: { label: "Process pump", plural: "Process pumps", icon: Droplets },
  ELECTRIC_MOTOR: { label: "Electric motor", plural: "Electric motors", icon: Cog },
  CONTROL_VALVE: { label: "Control valve", plural: "Control valves", icon: SlidersHorizontal },
  PRESSURE_TRANSMITTER: { label: "Pressure transmitter", plural: "Pressure transmitters", icon: Gauge },
  VIBRATION_SENSOR: { label: "Vibration sensor", plural: "Vibration sensors", icon: Activity },
};

export function assetClassOf(name) {
  return ASSET_CLASSES[name] ?? { label: humanize(name), plural: humanize(name), icon: Shapes };
}

export const UnboundIcon = CircleDashed;

export function humanize(value) {
  if (value == null) return "";
  const text = String(value).replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function fmt(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "--";
  if (typeof value !== "number") return String(value);
  return value.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtSigned(value, digits = 1) {
  if (value == null) return "--";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt(Math.abs(value), digits)}`;
}

export function fmtDate(iso, withTime = true) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}
