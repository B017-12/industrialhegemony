import clsx from "clsx";
import { CircleAlert, Inbox, RotateCw } from "lucide-react";
import { forwardRef, useMemo } from "react";
import { Tooltip as RadixTooltip } from "radix-ui";
import { conditionOf, mappingOf, TONES } from "./status.js";

export const cx = clsx;

const BUTTON_VARIANTS = {
  default: "bg-surface-3 text-fg hover:bg-surface-4 border border-line-strong",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-3 border border-transparent",
  primary: "bg-accent text-accent-fg hover:bg-[#7dd3ff] border border-accent font-semibold",
  outline: "text-fg-muted hover:text-fg border border-line-strong hover:border-fg-faint bg-transparent",
};
const BUTTON_SIZES = {
  xs: "h-6 px-2 text-2xs gap-1",
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
  icon: "h-7 w-7 justify-center",
  "icon-sm": "h-6 w-6 justify-center",
};

export const Button = forwardRef(function Button(
  { variant = "default", size = "md", className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center rounded-md whitespace-nowrap transition-colors duration-[var(--dur-fast)] select-none",
        "disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function IconButton({ label, shortcut, children, side = "bottom", ...props }) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={side}>
      <Button variant="ghost" size="icon" aria-label={label} {...props}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function TooltipProvider({ children }) {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({ content, shortcut, side = "bottom", children }) {
  if (!content) return children;
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] flex max-w-72 items-center gap-2 rounded-md border border-line-strong bg-surface-3 px-2 py-1 text-xs text-fg shadow-[var(--shadow-float)] animate-fade-in"
        >
          <span>{content}</span>
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export function Kbd({ children, className }) {
  return <kbd className={cx("kbd", className)}>{children}</kbd>;
}

export function StatusDot({ state, className, pulse }) {
  const tone = TONES[conditionOf(state).tone];
  return (
    <span
      aria-hidden
      className={cx("inline-block size-2 shrink-0 rounded-full", tone.dot, pulse && "animate-pulse-soft", className)}
    />
  );
}

export function StatusIcon({ state, className }) {
  const condition = conditionOf(state);
  const Icon = condition.icon;
  return <Icon aria-label={condition.long} className={cx("size-3.5 shrink-0", TONES[condition.tone].text, className)} />;
}

export function StatusPill({ state, size = "sm", long = false, className }) {
  const condition = conditionOf(state);
  const tone = TONES[condition.tone];
  const Icon = condition.icon;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-xs",
        tone.bg,
        tone.border,
        tone.text,
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {long ? condition.long : condition.label}
    </span>
  );
}

export function Badge({ tone = "offline", children, className, dashed, icon: Icon }) {
  const t = TONES[tone];
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-2xs font-medium whitespace-nowrap",
        dashed ? "border-dashed" : "",
        t.bg,
        t.border,
        t.text,
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3" />}
      {children}
    </span>
  );
}

export function MappingBadge({ method, className }) {
  const mapping = mappingOf(method);
  if (mapping.unbound) return <Badge className={className}>Unbound</Badge>;
  return (
    <Badge tone={mapping.procedural ? "procedural" : "normal"} dashed={mapping.procedural} className={className}>
      {mapping.badge ?? (mapping.procedural ? `Procedural · ${mapping.label}` : mapping.label)}
    </Badge>
  );
}

export function IdChip({ children, className, ...props }) {
  return (
    <span
      className={cx(
        "inline-block h-5 max-w-full truncate rounded-xs border border-line-strong bg-surface-2 px-1.5 align-middle font-mono text-2xs leading-[18px] text-fg-muted",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function SectionTitle({ children, action, className }) {
  return (
    <div className={cx("mb-2 flex items-center justify-between gap-2", className)}>
      <h3 className="text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase">{children}</h3>
      {action}
    </div>
  );
}

export function Card({ className, children, ...props }) {
  return (
    <div className={cx("rounded-lg border border-line bg-surface-2/60 p-3", className)} {...props}>
      {children}
    </div>
  );
}

export function Field({ label, children, mono, className }) {
  return (
    <div className={cx("min-w-0", className)}>
      <dt className="text-2xs text-fg-subtle">{label}</dt>
      <dd className={cx("m-0 truncate text-sm text-fg", mono && "font-mono text-xs")}>{children ?? "--"}</dd>
    </div>
  );
}

export function Skeleton({ className }) {
  return <div aria-hidden className={cx("skeleton h-4", className)} />;
}

export function SkeletonRows({ rows = 4, className }) {
  return (
    <div role="status" aria-label="Loading" className={cx("grid gap-2.5", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid gap-1.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className={i % 2 ? "h-4 w-4/5" : "h-4 w-full"} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, className }) {
  return (
    <div className={cx("grid place-items-center gap-1.5 px-4 py-8 text-center", className)}>
      <Icon aria-hidden className="size-5 text-fg-faint" />
      <p className="m-0 text-sm font-medium text-fg-muted">{title}</p>
      {children && <p className="m-0 max-w-64 text-xs text-fg-subtle">{children}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }) {
  return (
    <div
      role="alert"
      className={cx(
        "flex items-start gap-2.5 rounded-md border border-status-critical/40 bg-status-critical-soft p-3 text-xs text-fg",
        className,
      )}
    >
      <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-status-critical" />
      <div className="grid min-w-0 gap-1">
        <span className="font-medium">Could not load this data</span>
        <span className="break-words text-fg-muted">{String(error?.message ?? error)}</span>
      </div>
      {onRetry && (
        <Button size="xs" variant="outline" className="ml-auto" onClick={onRetry}>
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  );
}

export function Meter({ value, max = 1, cap, tone = "accent", className, label }) {
  const pct = Math.max(0, Math.min(1, (value ?? 0) / max)) * 100;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value ?? 0}
      aria-label={label}
      className={cx("relative h-1.5 overflow-hidden rounded-full bg-surface-4", className)}
    >
      <div className={cx("h-full rounded-full", TONES[tone].dot)} style={{ width: `${pct}%` }} />
      {cap != null && (
        <div
          title={`Cap ${cap}`}
          className="absolute top-0 h-full w-px bg-fg-muted"
          style={{ left: `${(cap / max) * 100}%` }}
        />
      )}
    </div>
  );
}

// Word-sized trend line with the healthy-peer p10-p90 band behind it and a
// marker on the last reading. Gaps (null readings) break the line.
export function Sparkline({ values, band, tone = "accent", width = 148, height = 34, dayTicks, label }) {
  const geometry = useMemo(() => {
    const finite = values.filter((v) => v != null && Number.isFinite(v));
    if (!finite.length) return null;
    let lo = Math.min(...finite);
    let hi = Math.max(...finite);
    if (band) {
      lo = Math.min(lo, band[0]);
      hi = Math.max(hi, band[1]);
    }
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
    lo -= pad;
    hi += pad;
    const x = (i) => (values.length < 2 ? width / 2 : (i / (values.length - 1)) * (width - 4) + 2);
    const y = (v) => height - 2 - ((v - lo) / (hi - lo)) * (height - 4);
    let d = "";
    let pen = false;
    let last = null;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
      last = [x(i), y(v)];
    });
    const bandRect = band ? { y: y(band[1]), h: Math.max(1, y(band[0]) - y(band[1])) } : null;
    const ticks = (dayTicks ?? []).map((i) => x(i));
    return { d, last, bandRect, ticks };
  }, [values, band, width, height, dayTicks]);

  if (!geometry) return <div style={{ width, height }} className="grid place-items-center text-2xs text-fg-subtle">no data</div>;
  const t = TONES[tone];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block overflow-visible">
      {geometry.ticks.map((tx) => (
        <line key={tx} x1={tx} x2={tx} y1={0} y2={height} className="stroke-line-strong" strokeDasharray="2 3" />
      ))}
      {geometry.bandRect && (
        <rect x={0} width={width} y={geometry.bandRect.y} height={geometry.bandRect.h} className="fill-status-normal/12" />
      )}
      <path d={geometry.d} fill="none" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" className={t.stroke} />
      {geometry.last && <circle cx={geometry.last[0]} cy={geometry.last[1]} r={2.6} className={t.fill} />}
    </svg>
  );
}
