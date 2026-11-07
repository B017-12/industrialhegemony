import { Boxes, ClipboardCheck, Command, Link2, ScanLine, Search, Siren, Timer, TriangleAlert } from "lucide-react";
import { API } from "../data.js";
import { useStore } from "../store.js";
import { cx, Kbd, Skeleton, Tooltip } from "./primitives.jsx";
import { useAssetIndex, usePlantKpis } from "./selectors.js";
import { fmt, humanize, TONES } from "./status.js";

const BACKEND = {
  checking: { label: "Connecting", tone: "offline", detail: `Checking ${API}` },
  online: { label: "Live API", tone: "normal", detail: `FastAPI at ${API}` },
  static: { label: "Snapshot", tone: "watch", detail: "Backend unreachable: showing the saved API snapshot (web/public/data/api)" },
  offline: { label: "Offline", tone: "critical", detail: "Backend unreachable and no snapshot found" },
};

export function TopBar() {
  return (
    <header className="topbar flex min-w-0 items-center gap-4 border-b border-line bg-surface-1 px-3">
      <Brand />
      <div className="h-7 w-px bg-line" />
      <KpiStrip />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <ReviewToggle />
        <SearchTrigger />
        <MissionChip />
        <BackendChip />
      </div>
    </header>
  );
}

function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <div className="grid size-8 place-items-center rounded-md border border-accent/40 bg-accent-soft">
        <ScanLine aria-hidden className="size-4 text-accent" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-fg">Valmet Industrial Metaverse</div>
        <div className="text-2xs text-fg-subtle max-xl:hidden">Boiler room scan · synthetic data pack</div>
      </div>
    </div>
  );
}

function KpiStrip() {
  const k = usePlantKpis();
  const assetIndex = useAssetIndex();
  const t = useStore((s) => s.mission.t);
  const target = assetIndex[k.targetAssetId];
  const remaining = k.durationS != null ? Math.max(0, k.durationS - (t ?? 0)) : null;

  return (
    <dl className="m-0 flex min-w-0 items-stretch gap-1 overflow-hidden">
      <Kpi
        icon={Boxes}
        label="Objects framed"
        value={k.framed}
        sub={k.framed != null ? `${k.equipment} equipment · ${k.pipes} pipe` : null}
        hint={`${k.framed} segmented scene objects with oriented boxes, plus ${k.structure} structure planes`}
      />
      <Kpi
        icon={Link2}
        label="Assets bound"
        value={k.assets ? `${k.bound}/${k.assets}` : null}
        sub={k.assets ? `${k.procedural} procedural` : null}
        subTone={k.procedural ? "procedural" : null}
        hint={Object.entries(k.byMapping)
          .map(([m, n]) => `${n} ${humanize(m.replace("procedural_", ""))}`)
          .join(" · ")}
      />
      <Kpi
        icon={TriangleAlert}
        label="Need attention"
        value={k.assets ? k.attention : null}
        valueTone={k.attention ? "critical" : null}
        sub={k.assets ? `${k.byCondition.attention_required || 0} attention · ${k.byCondition.degraded || 0} degraded` : null}
        hint={`${k.byCondition.watch || 0} more on watch, ${k.byCondition.healthy || 0} healthy (Current_State)`}
      />
      <Kpi
        icon={Siren}
        label="Open events"
        value={k.openEvents}
        sub={k.openEvents != null ? `across ${k.assets} assets` : null}
        hint="Alarms_Events with status open"
      />
      <Kpi
        icon={Timer}
        label="Mission ETA"
        value={remaining != null ? `${fmt(remaining, 1)} s` : null}
        sub={k.pathLengthM != null ? `${fmt(k.pathLengthM, 2)} m to ${target?.tag ?? k.targetAssetId}` : null}
        hint={k.minClearanceM != null ? `Planned route, minimum clearance ${fmt(k.minClearanceM, 2)} m` : null}
      />
    </dl>
  );
}

function Kpi({ icon: Icon, label, value, sub, hint, valueTone, subTone }) {
  const body = (
    <div className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 whitespace-nowrap hover:bg-surface-2">
      <Icon aria-hidden className="size-4 shrink-0 text-fg-faint" />
      <div className="min-w-0 leading-tight">
        <dt className="text-2xs whitespace-nowrap text-fg-subtle">{label}</dt>
        <dd className="m-0 flex items-baseline gap-1.5">
          {value == null ? (
            <Skeleton className="mt-0.5 h-4 w-12" />
          ) : (
            <span className={cx("tabular text-lg font-semibold", valueTone ? TONES[valueTone].text : "text-fg")}>{value}</span>
          )}
        </dd>
        {sub && (
          <div className={cx("text-2xs whitespace-nowrap max-xl:hidden", subTone ? TONES[subTone].text : "text-fg-subtle")}>{sub}</div>
        )}
      </div>
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

function ReviewToggle() {
  const active = useStore((s) => s.ui.mode === "review");
  const reviewed = useStore((s) =>
    Object.values(s.labelOverrides?.overrides ?? {}).filter((e) => e.label_source === "human").length,
  );
  return (
    <Tooltip content={active ? "Exit label review" : `Review object labels (${reviewed} person-confirmed so far)`} shortcut="L">
      <button
        type="button"
        aria-pressed={active}
        onClick={() => useStore.getState().setReviewMode(!active)}
        className={cx(
          "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs whitespace-nowrap",
          active ? "border-accent/50 bg-accent-soft text-fg" : "border-line-strong bg-surface-2 text-fg-muted hover:text-fg",
        )}
      >
        <ClipboardCheck aria-hidden className={cx("size-3.5", active && "text-accent")} />
        <span className="max-[1279px]:hidden">Review labels</span>
        <span className="tabular text-2xs text-fg-subtle">{reviewed}</span>
      </button>
    </Tooltip>
  );
}

function SearchTrigger() {
  const setUi = useStore((s) => s.setUi);
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={() => setUi({ paletteOpen: true })}
      aria-label="Search assets, events and documents"
      className="flex h-8 w-40 items-center gap-2 rounded-md border border-line-strong bg-surface-2 px-2.5 text-left text-xs text-fg-subtle hover:border-fg-faint hover:text-fg-muted min-[1600px]:w-60"
    >
      <Search aria-hidden className="size-3.5" />
      <span className="flex-1 truncate">
        Search<span className="hidden min-[1600px]:inline"> assets, events, docs</span>
      </span>
      <span className="flex gap-0.5">
        <Kbd>{mac ? <Command className="size-3" /> : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

function MissionChip() {
  const state = useStore((s) => s.mission.state);
  const running = useStore((s) => s.running);
  const tone = state === "idle" ? "offline" : state === "report" ? "normal" : "accent";
  const paused = !running && state !== "idle" && state !== "report";
  return (
    <Tooltip content={`Mission state: ${humanize(state)}${state === "idle" ? " (robot parked at the front entry)" : paused ? " (paused)" : ""}`}>
      <span className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 text-xs text-fg-muted">
        <span className={cx("size-1.5 rounded-full", TONES[tone].dot, state !== "idle" && "animate-pulse-soft")} />
        <span className="hidden text-fg-subtle min-[1600px]:inline">Mission</span>
        <span className="font-medium whitespace-nowrap text-fg">{humanize(state)}</span>
      </span>
    </Tooltip>
  );
}

function BackendChip() {
  const backend = useStore((s) => s.backend);
  const info = BACKEND[backend];
  return (
    <Tooltip content={info.detail}>
      <span
        role="status"
        className={cx(
          "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
          TONES[info.tone].border,
          TONES[info.tone].bg,
          TONES[info.tone].text,
        )}
      >
        <span className={cx("size-1.5 rounded-full", TONES[info.tone].dot, backend === "checking" && "animate-pulse-soft")} />
        {info.label}
      </span>
    </Tooltip>
  );
}

export function FpsChip() {
  const perf = useStore((s) => s.perf);
  const splat = useStore((s) => s.splat);
  return (
    <Tooltip
      content={`Rolling average over 0.5 s${splat.state === "ready" && splat.loadMs != null ? ` · scan loaded in ${(splat.loadMs / 1000).toFixed(1)} s` : ""}`}
    >
      <span className="tabular flex h-6 items-center rounded-md border border-line bg-surface-1/85 px-2 font-mono text-2xs text-fg-subtle">
        {perf.fps ?? "--"} fps · {perf.frameMs ?? "--"} ms
      </span>
    </Tooltip>
  );
}
