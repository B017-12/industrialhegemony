import { BellOff } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { useMemo, useState } from "react";
import { Badge, cx, EmptyState, ErrorState, IdChip, SkeletonRows } from "../primitives.jsx";
import { fmtDate, humanize, TONES } from "../status.js";

const SEVERITY_TONE = { high: "critical", medium: "watch", low: "offline" };
const STATUS_TONE = { open: "critical", acknowledged: "watch", closed: "offline" };
const FILTERS = ["all", "open", "acknowledged", "closed"];

export function EventsTab({ events }) {
  const [filter, setFilter] = useState("all");
  const list = events.data?.events ?? [];
  const counts = useMemo(() => {
    const c = { all: list.length };
    for (const e of list) c[e.status] = (c[e.status] || 0) + 1;
    return c;
  }, [list]);

  if (events.error) return <ErrorState error={events.error} />;
  if (events.loading) return <SkeletonRows rows={6} />;
  const shown = filter === "all" ? list : list.filter((e) => e.status === filter);

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex items-center justify-between gap-2">
        <ToggleGroup.Root
          type="single"
          value={filter}
          onValueChange={(v) => setFilter(v || "all")}
          aria-label="Filter events by status"
          className="flex gap-1"
        >
          {FILTERS.map((f) => (
            <ToggleGroup.Item
              key={f}
              value={f}
              className="flex h-6 items-center gap-1 rounded-full border border-line px-2 text-2xs text-fg-muted hover:text-fg data-[state=on]:border-accent/50 data-[state=on]:bg-accent-soft data-[state=on]:text-fg"
            >
              {humanize(f)}
              <span className="tabular text-fg-subtle">{counts[f] || 0}</span>
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
        <span className="text-2xs text-fg-subtle">Priority order</span>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={BellOff} title={`No ${filter === "all" ? "" : filter} events`} />
      ) : (
        <ol className="m-0 grid list-none gap-1.5 p-0">
          {shown.map((e) => {
            const sev = TONES[SEVERITY_TONE[e.severity] ?? "offline"];
            return (
              <li key={e.event_id} className="relative rounded-md border border-line bg-surface-2/50 py-2 pr-2.5 pl-3.5">
                <span aria-hidden className={cx("absolute top-2 bottom-2 left-1.5 w-0.5 rounded-full", sev.dot)} />
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-semibold text-fg">{humanize(e.event_code)}</span>
                  <Badge tone={STATUS_TONE[e.status] ?? "offline"} className="ml-auto">
                    {humanize(e.status)}
                  </Badge>
                </div>
                <div className="mt-0.5 text-xs text-fg-muted">{e.description}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-subtle">
                  <IdChip>{e.event_id}</IdChip>
                  <span className={sev.text}>{humanize(e.severity)} severity</span>
                  <span>·</span>
                  <span>{humanize(e.event_type)}</span>
                  <span>·</span>
                  <span>{humanize(e.source)}</span>
                  <span className="tabular ml-auto">{fmtDate(e.timestamp)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
