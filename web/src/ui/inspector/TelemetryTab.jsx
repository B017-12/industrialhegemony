import { ArrowDownRight, ArrowUpRight, ChevronRight, LineChart, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchTelemetry, useResource } from "../../data.js";
import { ChartLegend, isOutsideBand, TelemetryChart, unitOf } from "../copilot/TelemetryChart.jsx";
import { cx, EmptyState, ErrorState, SectionTitle, SkeletonRows, Sparkline, Tooltip } from "../primitives.jsx";
import { conditionOf, fmt, fmtDate, fmtSigned, TONES } from "../status.js";

const defaultDetail = (metric, data, tone) => (
  <div className="grid gap-1.5 pt-1">
    <TelemetryChart telemetry={data} metric={metric} tone={tone} />
    <ChartLegend tone={tone} base={data.baselines[metric]} />
  </div>
);

// Each row expands to a detail chart; `renderDetail(metric, data, tone)` can
// replace it.
export function TelemetryTab({ assetId, condition, renderDetail = defaultDetail }) {
  const telemetry = useResource(`telemetry:${assetId}`, () => fetchTelemetry(assetId));
  const [open, setOpen] = useState(() => new Set());

  const dayTicks = useMemo(() => {
    const ts = telemetry.data?.timestamps ?? [];
    const ticks = [];
    for (let i = 1; i < ts.length; i += 1) if (ts[i].slice(0, 10) !== ts[i - 1].slice(0, 10)) ticks.push(i);
    return ticks;
  }, [telemetry.data]);

  // Open the first out-of-band metric by default.
  useEffect(() => {
    const data = telemetry.data;
    if (!data) return;
    const first = data.metrics.find(({ metric }) => isOutsideBand(data.trends[metric], data.baselines[metric]));
    setOpen(new Set(first ? [first.metric] : []));
  }, [telemetry.data]);

  if (telemetry.error) return <ErrorState error={telemetry.error} />;
  if (telemetry.loading) return <SkeletonRows rows={7} />;
  const data = telemetry.data;
  if (!data.metrics.length) return <EmptyState icon={LineChart} title="No telemetry for this asset" />;

  const ts = data.timestamps;
  const peers = Object.values(data.baselines)[0];
  const abnormalTone = conditionOf(condition).tone === "normal" ? "watch" : conditionOf(condition).tone;
  const toggle = (metric) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });

  return (
    <div className="grid grid-cols-1 gap-3">
      <SectionTitle
        action={
          <span className="tabular text-2xs text-fg-subtle">
            {fmtDate(ts[0], false)} to {fmtDate(ts[ts.length - 1], false)} · {ts.length} samples
          </span>
        }
      >
        Telemetry_Sample_3d
      </SectionTitle>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-1 text-2xs text-fg-subtle">
        <span>Metric · last-day mean vs first day</span>
        <span className="w-[136px] text-right">3-day trend, healthy band</span>
      </div>

      <ul className="m-0 grid list-none gap-1 p-0">
        {data.metrics.map(({ metric, label, unit }) => {
          const trend = data.trends[metric];
          const base = data.baselines[metric];
          const u = unitOf(unit);
          const outside = isOutsideBand(trend, base);
          const tone = outside ? abnormalTone : "accent";
          const Arrow = (trend?.delta ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;
          const expanded = open.has(metric);
          return (
            <li
              key={metric}
              className={cx(
                "rounded-md border",
                outside ? cx(TONES[tone].border, "bg-surface-2/70") : expanded ? "border-line bg-surface-2/40" : "border-transparent hover:bg-surface-2",
              )}
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${label}: ${expanded ? "hide" : "show"} detail chart`}
                onClick={() => toggle(metric)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-2 text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 truncate text-xs text-fg-muted">
                    <ChevronRight aria-hidden className={cx("size-3 shrink-0 transition-transform", expanded && "rotate-90")} />
                    {outside && (
                      <Tooltip content="Last-day mean is outside the healthy-peer p10–p90 band">
                        <TriangleAlert aria-label="Outside healthy band" className={cx("size-3 shrink-0", TONES[tone].text)} />
                      </Tooltip>
                    )}
                    {label}
                  </div>
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="tabular text-lg font-semibold text-fg">{fmt(trend?.last_day_mean, 2)}</span>
                    <span className="text-2xs text-fg-subtle">{u}</span>
                    {trend && (
                      <Tooltip
                        content={`First-day mean ${fmt(trend.first_day_mean, 2)} ${u} (${trend.first_day}) → last-day mean ${fmt(trend.last_day_mean, 2)} ${u} (${trend.last_day}), ${fmtSigned(trend.delta, 2)} ${u}`}
                      >
                        <span className={cx("tabular flex items-center text-2xs", outside ? TONES[tone].text : "text-fg-subtle")}>
                          <Arrow aria-hidden className="size-3" />
                          {fmtSigned(trend.delta_pct, 1)}%
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  {base && (
                    <div className="tabular truncate text-2xs text-fg-subtle">
                      healthy {fmt(base.mean, 2)} ({fmt(base.p10, 2)}–{fmt(base.p90, 2)})
                    </div>
                  )}
                </div>
                <Sparkline
                  width={136}
                  values={data.series[metric]}
                  band={base ? [base.p10, base.p90] : null}
                  tone={tone}
                  dayTicks={dayTicks}
                  label={`${label} trend`}
                />
              </button>
              {expanded && <div className="px-2.5 pb-2.5">{renderDetail(metric, data, tone)}</div>}
            </li>
          );
        })}
      </ul>

      {peers && (
        <p className="m-0 px-1 text-2xs text-fg-subtle">
          Green band: 10th–90th percentile of healthy {peers.asset_class} peers ({peers.peer_asset_ids.join(", ")}). Dashed lines mark day
          boundaries. Click a metric for the detail chart.
        </p>
      )}
    </div>
  );
}
