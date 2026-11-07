import { Activity, Box, ClipboardList, FileText, HeartPulse, History, LineChart, ListChecks, ShieldAlert, Siren, Tag } from "lucide-react";
import { cx } from "../primitives.jsx";

// Evidence kinds from docs/contracts.md "Evidence IDs (copilot)", in display order.
export const EVIDENCE_KINDS = {
  state: { label: "Current state", short: "State", icon: HeartPulse },
  telemetry: { label: "Telemetry trend", short: "Telemetry", icon: LineChart },
  baseline: { label: "Healthy baseline", short: "Baseline", icon: Activity },
  event_summary: { label: "Event summary", short: "Events", icon: ListChecks },
  event: { label: "Event", short: "Event", icon: Siren },
  case: { label: "Historical service case", short: "Case", icon: History },
  work_order: { label: "Work order", short: "Work order", icon: ClipboardList },
  data_quality: { label: "Data-quality issue", short: "Data quality", icon: ShieldAlert },
  mapping: { label: "Scene mapping", short: "Mapping", icon: Box },
  asset: { label: "Asset record", short: "Asset", icon: Tag },
  document: { label: "Knowledge document", short: "Document", icon: FileText },
};

const PREFIX_KIND = [
  [/^TEL:/, "telemetry"],
  [/^BASELINE:/, "baseline"],
  [/^EVENTS:/, "event_summary"],
  [/^EVT-/, "event"],
  [/^CASE-/, "case"],
  [/^WO-/, "work_order"],
  [/^DQ-/, "data_quality"],
  [/^MAP:/, "mapping"],
  [/^STATE:/, "state"],
  [/^ASSET:/, "asset"],
  [/^DOC-/, "document"],
];

export function kindOfId(id) {
  return PREFIX_KIND.find(([re]) => re.test(id))?.[1] ?? "asset";
}

export function kindMeta(kind) {
  return EVIDENCE_KINDS[kind] ?? { label: kind, short: kind, icon: FileText };
}

export const ASSET_ID_RE = /\bASSET-\d{3}\b/g;

// Every answer for an asset carries evidence items with stable IDs, so the
// drawer can resolve a chip from any answer (report or chat) by asset + id.
const registry = new Map();

export function registerEvidence(answer) {
  if (!answer?.evidence) return;
  for (const item of answer.evidence) registry.set(`${answer.asset_id}|${item.id}`, item);
}

export function lookupEvidence(assetId, id) {
  return registry.get(`${assetId}|${id}`) ?? null;
}

export function EvidenceChip({ id, onOpen, active, className }) {
  const kind = kindOfId(id);
  const meta = kindMeta(kind);
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(id)}
      aria-label={`Open evidence ${id} (${meta.label})`}
      className={cx(
        "inline-flex h-5 max-w-full items-center gap-1 rounded-xs border px-1.5 font-mono text-2xs leading-none transition-colors duration-[var(--dur-fast)]",
        active
          ? "border-accent/60 bg-accent-soft text-fg"
          : "border-line-strong bg-surface-2 text-fg-muted hover:border-accent/50 hover:bg-surface-3 hover:text-fg",
        className,
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0 text-fg-subtle" />
      <span className="truncate">{id}</span>
    </button>
  );
}
