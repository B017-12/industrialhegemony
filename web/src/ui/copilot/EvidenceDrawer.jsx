import { ArrowLeft, Crosshair, Quote } from "lucide-react";
import { useEffect, useRef } from "react";
import { fetchCopilot, fetchTelemetry, useResource } from "../../data.js";
import { useStore } from "../../store.js";
import { Badge, Button, cx, EmptyState, ErrorState, IdChip, SectionTitle, SkeletonRows, StatusIcon } from "../primitives.jsx";
import { useAssetIndex } from "../selectors.js";
import { fmt, humanize } from "../status.js";
import { ASSET_ID_RE, kindMeta, kindOfId, lookupEvidence } from "./evidence.jsx";
import { ChartLegend, isOutsideBand, TelemetryChart } from "./TelemetryChart.jsx";

// Field order for record tables; unlisted fields follow in record order.
const SKIP = new Set(["synthetic_record"]);
const VALUE_LABELS = {
  first_day_mean: "First-day mean",
  last_day_mean: "Last-day mean",
  delta_pct: "Delta %",
  p10: "10th percentile",
  p90: "90th percentile",
  peer_asset_ids: "Healthy peers",
  matching_issue_code: "Carry issue code",
  matching_open: "Open with issue code",
};

// Source record behind one evidence ID, shown over the inspector body.
export function EvidenceDrawer({ assetId }) {
  const evidenceId = useStore((s) => s.ui.evidenceId);
  const closeEvidence = useStore((s) => s.closeEvidence);
  const report = useResource(`copilot:${assetId}:arrival_diagnosis`, () => fetchCopilot(assetId, "arrival_diagnosis"));
  const panelRef = useRef(null);

  useEffect(() => {
    if (evidenceId) panelRef.current?.focus({ preventScroll: true });
  }, [evidenceId]);

  if (!evidenceId) return null;
  const item = lookupEvidence(assetId, evidenceId) ?? report.data?.evidence.find((e) => e.id === evidenceId) ?? null;
  const kind = item?.kind ?? kindOfId(evidenceId);
  const meta = kindMeta(kind);
  const Icon = meta.icon;
  const citedBy = report.data
    ? [...report.data.observations.map((c) => ["Observation", c]), ...report.data.hypotheses.map((c) => ["Hypothesis", c])].filter(
        ([, c]) => c.evidence_ids.includes(evidenceId),
      )
    : [];

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label={`Evidence ${evidenceId}`}
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-surface-1 outline-none animate-slide-in"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closeEvidence();
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2">
        <Button size="sm" variant="ghost" onClick={closeEvidence} aria-label="Back to the copilot report">
          <ArrowLeft /> Back
        </Button>
        <Icon aria-hidden className="size-3.5 text-fg-subtle" />
        <span className="truncate text-xs text-fg-muted">{meta.label}</span>
        <span className="ml-auto truncate font-mono text-2xs text-fg-subtle">{item?.source}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!item && report.loading && <SkeletonRows rows={5} />}
        {!item && report.error && <ErrorState error={report.error} />}
        {!item && !report.loading && !report.error && (
          <EmptyState title="Evidence not in this bundle">{evidenceId} is not part of the evidence the backend returned.</EmptyState>
        )}
        {item && (
          <div className="grid grid-cols-1 gap-4 [overflow-wrap:anywhere]">
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <IdChip className="text-xs text-fg">{item.id}</IdChip>
                {item.record?.synthetic_record === 1 && <Badge>Synthetic workbook record</Badge>}
                {citedBy.length > 0 && <Badge tone="accent">Cited {citedBy.length}×</Badge>}
              </div>
              <p className="m-0 text-sm text-fg">
                <LinkedText text={item.text} />
              </p>
            </div>

            <KindBody item={item} kind={kind} assetId={assetId} />

            {citedBy.length > 0 && (
              <section>
                <SectionTitle>Cited by</SectionTitle>
                <ul className="m-0 grid list-none gap-1.5 p-0">
                  {citedBy.map(([label, claim]) => (
                    <li key={claim.text} className="rounded-md border border-line bg-surface-2/60 px-2.5 py-1.5 text-xs text-fg-muted">
                      <span className="mr-1.5 text-2xs font-semibold tracking-[0.06em] text-fg-subtle uppercase">{label}</span>
                      {claim.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function KindBody({ item, kind, assetId }) {
  if (kind === "telemetry" || kind === "baseline") return <MetricBody item={item} kind={kind} assetId={assetId} />;
  if (kind === "document") {
    const r = item.record ?? {};
    return (
      <section className="grid gap-2">
        <SectionTitle>{r.title ?? "Document"}</SectionTitle>
        <blockquote className="m-0 flex gap-2 rounded-md border border-line bg-surface-2/60 p-3 text-sm text-fg">
          <Quote aria-hidden className="size-4 shrink-0 text-fg-faint" />
          <span>{r.content ?? item.text}</span>
        </blockquote>
        <RecordTable record={r} omit={["content", "title"]} />
      </section>
    );
  }
  const recordAsset = item.record?.asset_id ?? (kind === "mapping" || kind === "asset" || kind === "state" ? assetId : null);
  return (
    <section className="grid gap-2">
      {recordAsset && <ShowInScene assetId={recordAsset} />}
      {item.record && (
        <>
          <SectionTitle>Source record</SectionTitle>
          <RecordTable record={item.record} />
        </>
      )}
      {item.values && (
        <>
          <SectionTitle>Computed values</SectionTitle>
          <RecordTable record={item.values} />
        </>
      )}
    </section>
  );
}

function MetricBody({ item, kind, assetId }) {
  const metric = item.id.split(":")[2];
  const telemetry = useResource(`telemetry:${assetId}`, () => fetchTelemetry(assetId));
  const data = telemetry.data;
  const trend = data?.trends[metric];
  const base = data?.baselines[metric];
  const tone = isOutsideBand(trend, base) ? "critical" : "accent";
  return (
    <section className="grid gap-2">
      <SectionTitle>
        {kind === "baseline" ? `This asset against the healthy band` : "Readings, Telemetry_Sample_3d"}
      </SectionTitle>
      {telemetry.loading && <SkeletonRows rows={3} />}
      {telemetry.error && <ErrorState error={telemetry.error} />}
      {data && (
        <div className="grid gap-2 rounded-md border border-line bg-surface-2/40 p-2">
          <TelemetryChart telemetry={data} metric={metric} tone={tone} />
          <ChartLegend tone={tone} base={base} />
        </div>
      )}
      <SectionTitle className="mt-1">Computed values</SectionTitle>
      <RecordTable record={item.values ?? {}} />
    </section>
  );
}

function ShowInScene({ assetId }) {
  const asset = useAssetIndex()[assetId];
  const focusAsset = useStore((s) => s.focusAsset);
  if (!asset?.scene_object_id) return null;
  return (
    <Button size="sm" variant="outline" className="justify-self-start" onClick={() => focusAsset(assetId)}>
      <Crosshair /> Show {asset.tag} in 3D
    </Button>
  );
}

function RecordTable({ record, omit = [] }) {
  const entries = Object.entries(record).filter(([k, v]) => !SKIP.has(k) && !omit.includes(k) && v != null && v !== "");
  if (!entries.length) return null;
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1 rounded-md border border-line bg-surface-2/40 p-2.5 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="truncate text-fg-subtle">{VALUE_LABELS[key] ?? humanize(key)}</dt>
          <dd className="m-0 min-w-0 text-fg-muted">
            <Value name={key} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Value({ name, value }) {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" && /^ASSET-\d{3}$/.test(v))) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((id) => (
            <AssetLink key={id} assetId={id} />
          ))}
        </span>
      );
    }
    return <span className="tabular font-mono text-2xs">{value.map((v) => (typeof v === "number" ? fmt(v, 3) : JSON.stringify(v))).join(", ")}</span>;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value)
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => `${k} ${fmt(v, 2)}`);
    return <span className="font-mono text-2xs">{parts.length ? parts.join(" · ") : "{…}"}</span>;
  }
  if (typeof value === "string" && /^ASSET-\d{3}$/.test(value)) return <AssetLink assetId={value} />;
  if (typeof value === "number") return <span className="tabular">{fmt(value, 3)}</span>;
  if (/_at$|timestamp|last_updated/.test(name)) return <span className="tabular">{String(value).replace("T", " ")}</span>;
  return <span className="font-mono text-2xs">{String(value)}</span>;
}

// Asset IDs in prose become chips that select the asset and fly the camera to it.
function LinkedText({ text }) {
  if (!text) return null;
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(ASSET_ID_RE)) {
    parts.push(text.slice(last, match.index));
    parts.push(<AssetLink key={`${match.index}`} assetId={match[0]} />);
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

export function AssetLink({ assetId, className }) {
  const asset = useAssetIndex()[assetId];
  const focusAsset = useStore((s) => s.focusAsset);
  return (
    <button
      type="button"
      onClick={() => focusAsset(assetId)}
      aria-label={`Fly to ${asset?.tag ?? assetId} in 3D`}
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-xs border border-line-strong bg-surface-2 px-1.5 align-middle font-mono text-2xs leading-none text-fg-muted hover:border-accent/50 hover:text-fg",
        className,
      )}
    >
      {asset && <StatusIcon state={asset.condition_state} className="size-3" />}
      {asset?.tag ?? assetId}
      <Crosshair aria-hidden className="size-3 text-fg-subtle" />
    </button>
  );
}
