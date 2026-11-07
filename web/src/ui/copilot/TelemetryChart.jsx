import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "../primitives.jsx";
import { fmt, fmtDate, fmtSigned, TONES } from "../status.js";

export const UNIT_LABEL = { degC: "°C" };
export const unitOf = (unit) => UNIT_LABEL[unit] ?? unit ?? "";

// Last-day mean outside the healthy p10-p90 band.
export function isOutsideBand(trend, base) {
  return Boolean(base && trend && (trend.last_day_mean > base.p90 || trend.last_day_mean < base.p10));
}

function useWidth(ref, fallback) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setWidth(Math.max(80, Math.floor(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function niceTicks(lo, hi, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function dayRange(timestamps, day) {
  let first = -1;
  let last = -1;
  timestamps.forEach((t, i) => {
    if (t.slice(0, 10) === day) {
      if (first < 0) first = i;
      last = i;
    }
  });
  return first < 0 ? null : [first, last];
}

// Time-series detail chart: healthy-peer band, day boundaries, first-day and
// last-day means with the delta annotation, and a hover read-out. Every number
// drawn comes from the telemetry response (series, trends, baselines).
export function TelemetryChart({ telemetry, metric, tone = "accent", height = 168, compact = false, className }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, compact ? 110 : 340);
  const [hover, setHover] = useState(null);

  const values = telemetry.series[metric] ?? [];
  const ts = telemetry.timestamps;
  const trend = telemetry.trends[metric];
  const base = telemetry.baselines[metric];
  const info = telemetry.metrics.find((m) => m.metric === metric);
  const unit = unitOf(info?.unit ?? trend?.unit);
  const t = TONES[tone];

  const pad = compact ? { l: 2, r: 2, t: 4, b: 4 } : { l: 36, r: 10, t: 22, b: 20 };

  const g = useMemo(() => {
    const finite = values.filter((v) => v != null && Number.isFinite(v));
    if (!finite.length) return null;
    let lo = Math.min(...finite);
    let hi = Math.max(...finite);
    if (base) [lo, hi] = [Math.min(lo, base.p10), Math.max(hi, base.p90)];
    const span = hi - lo || Math.abs(hi) || 1;
    lo -= span * 0.08;
    hi += span * 0.08;
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const x = (i) => pad.l + (values.length < 2 ? iw / 2 : (i / (values.length - 1)) * iw);
    const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    const days = [];
    for (let i = 1; i < ts.length; i += 1) if (ts[i].slice(0, 10) !== ts[i - 1].slice(0, 10)) days.push(i);
    const firstDay = trend && dayRange(ts, trend.first_day);
    const lastDay = trend && dayRange(ts, trend.last_day);
    return { x, y, d, lo, hi, iw, ih, days, firstDay, lastDay, ticks: compact ? [] : niceTicks(lo, hi, 4) };
  }, [values, ts, trend, base, width, height, compact, pad.l, pad.r, pad.t, pad.b]);

  if (!g) {
    return (
      <div ref={wrapRef} style={{ height }} className={cx("grid place-items-center text-2xs text-fg-subtle", className)}>
        No readings for this metric
      </div>
    );
  }

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const i = Math.round(((px - pad.l) / g.iw) * (values.length - 1));
    if (i < 0 || i >= values.length) return setHover(null);
    setHover(i);
  };

  const hoverValue = hover != null ? values[hover] : null;
  const label = `${info?.label ?? metric} over ${ts.length} samples${trend ? `, first-day mean ${trend.first_day_mean}, last-day mean ${trend.last_day_mean} ${unit}` : ""}`;

  return (
    <div ref={wrapRef} className={cx("relative w-full", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        className="block overflow-visible select-none"
        onPointerMove={compact ? undefined : onMove}
        onPointerLeave={compact ? undefined : () => setHover(null)}
      >
        {base && (
          <rect
            x={pad.l}
            width={g.iw}
            y={g.y(base.p90)}
            height={Math.max(1, g.y(base.p10) - g.y(base.p90))}
            className="fill-status-normal/14"
          />
        )}
        {base && !compact && (
          <line x1={pad.l} x2={pad.l + g.iw} y1={g.y(base.mean)} y2={g.y(base.mean)} className="stroke-status-normal/60" strokeDasharray="1 3" />
        )}
        {g.ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={pad.l + g.iw} y1={g.y(v)} y2={g.y(v)} className="stroke-line" />
            <text x={pad.l - 6} y={g.y(v)} dy="0.32em" textAnchor="end" className="fill-fg-subtle text-[10px] tabular">
              {fmt(v, 2)}
            </text>
          </g>
        ))}
        {g.days.map((i) => (
          <line key={i} x1={g.x(i)} x2={g.x(i)} y1={pad.t} y2={pad.t + g.ih} className="stroke-line-strong" strokeDasharray="2 3" />
        ))}
        {!compact &&
          [0, ...g.days].map((i) => (
            <text key={`d${i}`} x={g.x(i) + 4} y={height - 6} className="fill-fg-subtle text-[10px]">
              {fmtDate(ts[i], false)}
            </text>
          ))}

        {trend && g.firstDay && (
          <line
            x1={g.x(g.firstDay[0])}
            x2={g.x(g.firstDay[1])}
            y1={g.y(trend.first_day_mean)}
            y2={g.y(trend.first_day_mean)}
            className="stroke-fg-muted"
            strokeWidth={compact ? 1.2 : 1.6}
            strokeDasharray="4 3"
          />
        )}
        {trend && g.lastDay && (
          <line
            x1={g.x(g.lastDay[0])}
            x2={g.x(g.lastDay[1])}
            y1={g.y(trend.last_day_mean)}
            y2={g.y(trend.last_day_mean)}
            className={t.stroke}
            strokeWidth={compact ? 1.4 : 2}
          />
        )}

        <path d={g.d} fill="none" strokeWidth={compact ? 1.1 : 1.3} strokeLinejoin="round" strokeLinecap="round" className={cx(t.stroke, "opacity-80")} />

        {!compact && trend && g.lastDay && (
          <text x={pad.l + g.iw} y={12} textAnchor="end" className={cx("text-[11px] font-semibold tabular", t.fill)}>
            {fmtSigned(trend.delta, 2)} {unit} ({fmtSigned(trend.delta_pct, 1)}%) first day → last day
          </text>
        )}

        {hover != null && hoverValue != null && Number.isFinite(hoverValue) && (
          <g pointerEvents="none">
            <line x1={g.x(hover)} x2={g.x(hover)} y1={pad.t} y2={pad.t + g.ih} className="stroke-fg-muted" />
            <circle cx={g.x(hover)} cy={g.y(hoverValue)} r={3} className={t.fill} />
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-5 z-10 rounded-sm border border-line-strong bg-surface-3 px-1.5 py-0.5 text-2xs whitespace-nowrap text-fg shadow-[var(--shadow-float)]"
          style={{ left: Math.min(Math.max(g.x(hover) + 8, 0), width - 130) }}
        >
          <span className="tabular font-semibold">{hoverValue == null ? "no reading" : `${fmt(hoverValue, 2)} ${unit}`}</span>
          <span className="ml-1.5 text-fg-subtle">{fmtDate(ts[hover])}</span>
        </div>
      )}
    </div>
  );
}

export function ChartLegend({ tone = "accent", base }) {
  const t = TONES[tone];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-subtle">
      <span className="flex items-center gap-1">
        <span aria-hidden className={cx("h-0.5 w-3 rounded-full", t.dot)} /> readings
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden className="h-0 w-3 border-t border-dashed border-fg-muted" /> first-day mean
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden className={cx("h-0.5 w-3 rounded-full", t.dot)} /> last-day mean
      </span>
      {base && (
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-2 w-3 rounded-[2px] bg-status-normal/25" /> healthy p10–p90
        </span>
      )}
    </div>
  );
}
