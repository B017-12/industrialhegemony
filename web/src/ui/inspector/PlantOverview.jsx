import { Crosshair, Route } from "lucide-react";
import { useMemo } from "react";
import { useStore } from "../../store.js";
import { Button, Card, cx, SectionTitle, SkeletonRows, StatusIcon } from "../primitives.jsx";
import { sortAssets, useAssetIndex, usePlantKpis } from "../selectors.js";
import { assetClassOf, CONDITION_ORDER, CONDITIONS, fmt, humanize, TONES } from "../status.js";

export function PlantOverview() {
  const assets = useStore((s) => s.assets);
  const openEvents = useStore((s) => s.openEvents);
  const selectAsset = useStore((s) => s.selectAsset);
  const k = usePlantKpis();
  const target = useAssetIndex()[k.targetAssetId];

  const flagged = useMemo(() => sortAssets(assets.filter((a) => a.condition_state !== "healthy")), [assets]);
  const byClass = useMemo(() => {
    const rows = new Map();
    for (const a of assets) {
      const r = rows.get(a.asset_class) ?? { klass: a.asset_class, n: 0, health: 0, below70: 0 };
      r.n += 1;
      r.health += a.health_score ?? 0;
      if ((a.health_score ?? 100) < 70) r.below70 += 1;
      rows.set(a.asset_class, r);
    }
    return [...rows.values()].sort((x, y) => x.health / x.n - y.health / y.n);
  }, [assets]);

  if (!assets.length) return <SkeletonRows rows={8} className="p-4" />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 gap-4">
        {target && (
          <Card className="grid gap-2.5 border-status-critical/40">
            <div className="flex items-center gap-2">
              <Route aria-hidden className="size-4 text-accent" />
              <span className="text-2xs font-semibold tracking-[0.08em] text-accent uppercase">Demo mission target</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon state={target.condition_state} />
              <span className="font-mono text-base font-semibold">{target.tag}</span>
              <span className="truncate text-xs text-fg-muted">
                {assetClassOf(target.asset_class).label} · {humanize(target.issue_code)}
              </span>
            </div>
            <p className="m-0 text-xs text-fg-muted">{target.issue_summary}</p>
            <div className="flex items-center gap-2">
              <span className="tabular text-2xs text-fg-subtle">
                Route {fmt(k.pathLengthM, 2)} m · {fmt(k.durationS, 1)} s · min clearance {fmt(k.minClearanceM, 2)} m
              </span>
              <Button size="xs" className="ml-auto" onClick={() => selectAsset(target.asset_id)}>
                <Crosshair /> Inspect
              </Button>
            </div>
          </Card>
        )}

        <section>
          <SectionTitle>Condition</SectionTitle>
          <div className="flex h-2 overflow-hidden rounded-full bg-surface-4" role="img" aria-label="Assets by condition">
            {CONDITION_ORDER.map((state) => {
              const n = k.byCondition[state] || 0;
              return n ? <span key={state} className={TONES[CONDITIONS[state].tone].dot} style={{ width: `${(n / k.assets) * 100}%` }} /> : null;
            })}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {CONDITION_ORDER.map((state) => (
              <div key={state} className="flex items-center gap-1.5 text-2xs text-fg-muted">
                <StatusIcon state={state} className="size-3" />
                {CONDITIONS[state].label}
                <span className="tabular ml-auto font-semibold text-fg">{k.byCondition[state] || 0}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle action={<span className="tabular text-2xs text-fg-subtle">{flagged.length}</span>}>Needs a look</SectionTitle>
          <ul className="m-0 grid list-none gap-1 p-0">
            {flagged.map((a) => (
              <li key={a.asset_id}>
                <button
                  type="button"
                  onClick={() => selectAsset(a.asset_id)}
                  className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                >
                  <StatusIcon state={a.condition_state} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{a.tag}</span>
                      <span className="truncate text-2xs text-fg-subtle">{humanize(a.issue_code)}</span>
                    </span>
                    <span className="block truncate text-2xs text-fg-muted">{a.issue_summary}</span>
                  </span>
                  <span className="grid shrink-0 justify-items-end">
                    <span className="tabular text-xs font-semibold text-fg-muted">{fmt(a.health_score, 0)}</span>
                    {openEvents?.[a.asset_id] > 0 && (
                      <span className="tabular text-2xs text-fg-subtle">{openEvents[a.asset_id]} open</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionTitle>By asset class</SectionTitle>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-2xs text-fg-subtle">
                <th className="pb-1.5 font-normal">Class</th>
                <th className="pb-1.5 text-right font-normal">Assets</th>
                <th className="pb-1.5 text-right font-normal">Avg health</th>
                <th className="pb-1.5 text-right font-normal">Below 70</th>
              </tr>
            </thead>
            <tbody>
              {byClass.map((r) => (
                <tr key={r.klass} className="border-t border-line">
                  <td className="py-1.5 text-fg">{assetClassOf(r.klass).label}</td>
                  <td className="tabular py-1.5 text-right text-fg-muted">{r.n}</td>
                  <td className="tabular py-1.5 text-right text-fg-muted">{fmt(r.health / r.n, 1)}</td>
                  <td className={cx("tabular py-1.5 text-right", r.below70 ? "text-status-degraded" : "text-fg-subtle")}>{r.below70}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
