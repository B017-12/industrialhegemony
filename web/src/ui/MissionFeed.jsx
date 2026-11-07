import { BrainCircuit, CircleAlert, FileCheck2, MapPinCheck, Radar, Send } from "lucide-react";
import { useStore } from "../store.js";
import { cx } from "./primitives.jsx";
import { fmt } from "./status.js";

const KIND = {
  dispatch: { icon: Send, tone: "text-accent" },
  scanned: { icon: Radar, tone: "text-fg-muted" },
  arrived: { icon: MapPinCheck, tone: "text-accent" },
  diagnosing: { icon: BrainCircuit, tone: "text-status-procedural" },
  report: { icon: FileCheck2, tone: "text-status-normal" },
  error: { icon: CircleAlert, tone: "text-status-critical" },
};
const VISIBLE = 6;

// Floating log of the current mission, newest last.
export function MissionFeed() {
  const feed = useStore((s) => s.mission.feed);
  const state = useStore((s) => s.mission.state);
  const selectAsset = useStore((s) => s.selectAsset);
  if (state === "idle" || feed.length === 0) return null;
  const shown = feed.slice(-VISIBLE);

  return (
    <section
      aria-label="Mission feed"
      data-label-occluder=""
      className="w-64 overflow-hidden rounded-md border border-line bg-surface-1/90 shadow-[var(--shadow-panel)] animate-fade-in"
    >
      <h2 className="m-0 px-2.5 pt-1.5 pb-1 text-2xs font-medium tracking-[0.06em] text-fg-subtle uppercase">Mission feed</h2>
      <ol role="log" aria-live="polite" className="m-0 grid list-none gap-px p-0 pb-1">
        {shown.map((e) => {
          const kind = KIND[e.kind] ?? KIND.scanned;
          const Icon = kind.icon;
          return (
            <li key={e.id} className="flex items-center gap-2 px-2.5 py-0.5 text-xs animate-fade-in">
              <span className="tabular w-9 shrink-0 text-right font-mono text-2xs text-fg-subtle">{fmt(e.t, 1)} s</span>
              <Icon aria-hidden className={cx("size-3.5 shrink-0", kind.tone)} />
              {e.assetId && e.kind === "scanned" ? (
                <button type="button" onClick={() => selectAsset(e.assetId)} className="truncate text-left text-fg hover:text-accent">
                  {e.text}
                </button>
              ) : (
                <span className="truncate text-fg">{e.text}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
