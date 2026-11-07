import { ClipboardList } from "lucide-react";
import { Badge, EmptyState, ErrorState, IdChip, SectionTitle, SkeletonRows } from "../primitives.jsx";
import { fmt, fmtDate, humanize } from "../status.js";

const PRIORITY_TONE = { high: "critical", medium: "watch", low: "offline" };

export function WorkOrdersTab({ detail }) {
  if (detail.error) return <ErrorState error={detail.error} />;
  if (detail.loading) return <SkeletonRows rows={5} />;
  const orders = [...(detail.data.work_orders ?? [])].sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  if (!orders.length) return <EmptyState icon={ClipboardList} title="No maintenance history" />;

  const hours = orders.reduce((n, o) => n + (o.duration_h || 0), 0);
  const downtime = orders.reduce((n, o) => n + (o.downtime_h || 0), 0);

  return (
    <div className="grid grid-cols-1 gap-3">
      <SectionTitle action={<span className="tabular text-2xs text-fg-subtle">{fmt(hours, 1)} h work · {fmt(downtime, 1)} h downtime</span>}>
        Maintenance_History · {orders.length} work orders
      </SectionTitle>
      <ol className="m-0 grid list-none gap-1.5 p-0">
        {orders.map((o) => (
          <li key={o.work_order_id} className="rounded-md border border-line bg-surface-2/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-fg first-letter:uppercase">{o.action}</span>
              <Badge tone={PRIORITY_TONE[o.priority] ?? "offline"} className="ml-auto">
                {humanize(o.priority)}
              </Badge>
            </div>
            <div className="mt-0.5 text-xs text-fg-muted">
              {humanize(o.maintenance_type)} · result {humanize(o.result).toLowerCase()} · {humanize(o.role).toLowerCase()}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-2xs text-fg-subtle">
              <IdChip>{o.work_order_id}</IdChip>
              <span className="tabular">
                {fmt(o.duration_h, 1)} h{o.downtime_h ? ` · ${fmt(o.downtime_h, 1)} h downtime` : ""}
              </span>
              <span className="tabular ml-auto">{fmtDate(o.opened_at, false)}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
