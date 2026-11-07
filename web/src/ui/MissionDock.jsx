import { ChevronDown, Crosshair, Hand, Maximize2, Pause, Play, Radar, RotateCcw, Send, Video, Map as MapIcon } from "lucide-react";
import { DropdownMenu, ToggleGroup } from "radix-ui";
import { useMemo } from "react";
import { navForTarget } from "../scene/mission.js";
import { MISSION_STATES, useStore } from "../store.js";
import { Button, cx, IconButton, StatusIcon, Tooltip } from "./primitives.jsx";
import { useAssetIndex, usePlantKpis } from "./selectors.js";
import { conditionOf, fmt, humanize, TONES } from "./status.js";

const SPEEDS = [0.5, 1, 2];
const CAMERA_MODES = [
  ["overview", "Overview camera", MapIcon],
  ["mission", "Follow the robot", Video],
  ["free", "Free camera", Hand],
];
const SCRUBBABLE = new Set(["en_route", "approaching", "arrived", "diagnosing", "report"]);

export function MissionDock() {
  const mission = useStore((s) => s.mission);
  const running = useStore((s) => s.running);
  const cameraMode = useStore((s) => s.ui.cameraMode);
  const toggleRunning = useStore((s) => s.toggleRunning);
  const setMission = useStore((s) => s.setMission);
  const dispatchMission = useStore((s) => s.dispatchMission);
  const restartMission = useStore((s) => s.restartMission);
  const setCameraMode = useStore((s) => s.setCameraMode);
  const requestFitView = useStore((s) => s.requestFitView);
  const setUi = useStore((s) => s.setUi);
  const selectedAssetId = useStore((s) => s.selectedAssetId);
  const baseNav = useStore((s) => s.baseNav);
  const navTargets = useStore((s) => s.navTargets);
  const k = usePlantKpis();
  const assetIndex = useAssetIndex();
  const target = assetIndex[mission.targetAssetId];
  const dispatchId = selectedAssetId ?? mission.targetAssetId;
  const dispatchTarget = assetIndex[dispatchId];
  const routable = Boolean(navForTarget(baseNav, navTargets, dispatchId)?.samples?.length);
  const live = mission.state !== "idle";
  const redispatch = live && dispatchId === mission.targetAssetId;
  const canScrub = SCRUBBABLE.has(mission.state);
  const progress = mission.duration ? Math.min(1, (mission.t ?? 0) / mission.duration) : 0;
  const ready = Boolean(mission.duration);
  const dispatchHint = !routable
    ? `${dispatchTarget?.tag ?? "This asset"} has no walkable approach in the scan`
    : redispatch
      ? "Start the mission again from the entry"
      : `Send the robot to ${dispatchTarget?.tag ?? "the target asset"}`;

  return (
    <section aria-label="Mission" className="dock flex min-w-0 flex-col justify-center gap-1.5 border-t border-line bg-surface-1 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex">
          <Tooltip content={dispatchHint} side="top">
            <span className="inline-flex">
              <Button
                size="sm"
                variant="primary"
                disabled={!ready || !routable}
                onClick={() => dispatchMission(dispatchId)}
                className="rounded-r-none"
              >
                <Send /> {redispatch ? "Re-dispatch" : "Dispatch"}
                {dispatchTarget ? ` to ${dispatchTarget.tag}` : ""}
              </Button>
            </span>
          </Tooltip>
          <TargetMenu />
        </div>
        <IconButton
          label={running ? "Pause mission" : "Resume mission"}
          shortcut="Space"
          onClick={toggleRunning}
          side="top"
          disabled={!live}
        >
          {running ? <Pause /> : <Play />}
        </IconButton>
        <IconButton label="Reset mission" side="top" disabled={!live} onClick={restartMission}>
          <RotateCcw />
        </IconButton>
        <ToggleGroup.Root
          type="single"
          value={String(mission.speed)}
          onValueChange={(v) => v && setMission({ speed: Number(v) })}
          aria-label="Playback speed"
          className="flex rounded-md border border-line bg-surface-2 p-0.5"
        >
          {SPEEDS.map((s) => (
            <ToggleGroup.Item
              key={s}
              value={String(s)}
              className="tabular h-5 rounded-sm px-1.5 text-2xs text-fg-subtle data-[state=on]:bg-surface-4 data-[state=on]:text-fg"
            >
              {s}×
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>

        <Stepper state={mission.state} />

        <div className="ml-auto flex items-center gap-1.5">
          <ToggleGroup.Root
            type="single"
            value={cameraMode}
            onValueChange={(v) => v && setCameraMode(v)}
            aria-label="Camera"
            className="flex rounded-md border border-line bg-surface-2 p-0.5"
          >
            {CAMERA_MODES.map(([mode, label, Icon]) => (
              <Tooltip key={mode} content={label} side="top">
                <ToggleGroup.Item
                  value={mode}
                  aria-label={label}
                  className="flex h-5 items-center gap-1 rounded-sm px-1.5 text-2xs text-fg-subtle capitalize data-[state=on]:bg-surface-4 data-[state=on]:text-fg [&_svg]:size-3"
                >
                  <Icon aria-hidden />
                  <span className="hidden xl:inline">{mode}</span>
                </ToggleGroup.Item>
              </Tooltip>
            ))}
          </ToggleGroup.Root>
          <IconButton label="Fit view" side="top" onClick={requestFitView}>
            <Crosshair />
          </IconButton>
          <IconButton label="Full-screen 3D" shortcut="F" side="top" onClick={() => setUi({ fullscreen: true })}>
            <Maximize2 />
          </IconButton>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <span className="tabular w-11 shrink-0 text-right font-mono text-2xs text-fg-muted">{fmt(mission.t ?? 0, 1)} s</span>
        <div className="relative h-5 min-w-24 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-4" />
          <div
            className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-accent"
            style={{ width: `${progress * 100}%` }}
          />
          <input
            type="range"
            min={0}
            max={mission.duration ?? 1}
            step={0.05}
            value={mission.t ?? 0}
            disabled={!canScrub}
            onChange={(e) => setMission({ t: Number(e.target.value) })}
            aria-label="Mission timeline"
            aria-valuetext={`${fmt(mission.t ?? 0, 1)} of ${fmt(mission.duration, 1)} seconds, ${humanize(mission.state)}`}
            className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-default"
          />
          <span
            aria-hidden
            className={cx("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-1", live ? "bg-accent" : "bg-fg-faint")}
            style={{ left: `${progress * 100}%` }}
          />
          <span className="absolute -bottom-2.5 left-0 text-[10px] leading-none text-fg-subtle">Front entry</span>
          <span className="absolute right-0 -bottom-2.5 text-[10px] leading-none text-fg-subtle">
            Approach {target?.tag ?? ""}
          </span>
        </div>
        <span className="tabular w-11 shrink-0 font-mono text-2xs text-fg-subtle">{fmt(mission.duration, 1)} s</span>
        <span className="hidden shrink-0 text-2xs text-fg-subtle 2xl:inline">
          {fmt(k.pathLengthM, 2)} m · clearance ≥ {fmt(k.minClearanceM, 2)} m
        </span>
        <Nearby />
      </div>
    </section>
  );
}

// Dispatch target menu: the 13 assets with an approach pose, then the rest,
// disabled with their distance from the scanned floor.
function TargetMenu() {
  const navTargets = useStore((s) => s.navTargets);
  const current = useStore((s) => s.mission.targetAssetId);
  const dispatchMission = useStore((s) => s.dispatchMission);
  const assetIndex = useAssetIndex();

  const [reachable, unreachable] = useMemo(() => {
    const list = navTargets?.targets ?? [];
    const byTag = (a, b) => (assetIndex[a.asset_id]?.tag ?? a.asset_id).localeCompare(assetIndex[b.asset_id]?.tag ?? b.asset_id);
    return [
      list.filter((t) => t.reachable).sort(byTag),
      list.filter((t) => !t.reachable).sort((a, b) => a.distance_to_walkable_m - b.distance_to_walkable_m),
    ];
  }, [navTargets, assetIndex]);

  const row = (t, disabled) => {
    const asset = assetIndex[t.asset_id];
    return (
      <DropdownMenu.Item
        key={t.asset_id}
        disabled={disabled}
        onSelect={() => dispatchMission(t.asset_id)}
        className={cx(
          "flex h-7 cursor-pointer items-center gap-2 rounded-sm px-2 text-xs text-fg-muted outline-none select-none",
          "data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg data-[disabled]:cursor-default data-[disabled]:text-fg-subtle",
        )}
      >
        <StatusIcon state={asset?.condition_state} className={disabled ? "opacity-60" : ""} />
        <span className={cx("w-14 font-mono font-semibold", disabled ? "" : "text-fg")}>{asset?.tag ?? t.asset_id}</span>
        <span className="truncate">{disabled ? `outside scanned floor (${fmt(t.distance_to_walkable_m, 1)} m)` : humanize(asset?.asset_class)}</span>
        {!disabled && (
          <span className="tabular ml-auto pl-2 text-2xs text-fg-subtle">
            {fmt(t.mission?.stats?.path_length_m, 2)} m · {fmt(t.mission?.stats?.duration_s, 1)} s
          </span>
        )}
        {t.asset_id === current && <span className="ml-1 text-2xs text-accent">target</span>}
      </DropdownMenu.Item>
    );
  };

  return (
    <DropdownMenu.Root>
      <Tooltip content="Choose dispatch target" side="top">
        <DropdownMenu.Trigger asChild>
          <Button size="sm" variant="primary" aria-label="Choose dispatch target" disabled={!navTargets} className="rounded-l-none border-l-accent-fg/30 px-1.5">
            <ChevronDown />
          </Button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] max-h-[min(70vh,520px)] w-[22rem] overflow-y-auto rounded-lg border border-line-strong bg-surface-2 p-1 shadow-[var(--shadow-float)] animate-fade-in"
        >
          <DropdownMenu.Label className="px-2 pt-1 pb-1 text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase">
            Reachable ({reachable.length})
          </DropdownMenu.Label>
          {reachable.map((t) => row(t, false))}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className="px-2 pt-1 pb-1 text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase">
            No approach pose ({unreachable.length})
          </DropdownMenu.Label>
          {unreachable.map((t) => row(t, true))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Stepper({ state }) {
  const current = MISSION_STATES.indexOf(state);
  return (
    <ol aria-label="Mission progress" className="ml-2 hidden min-w-0 items-center gap-1 lg:flex">
      {MISSION_STATES.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center gap-1" aria-current={active ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={cx("h-px w-2.5", done || active ? "bg-accent/60" : "bg-line-strong")} />}
            <Tooltip content={humanize(s)} side="top">
              <span className="flex items-center gap-1">
                <span
                  className={cx(
                    "size-1.5 rounded-full",
                    active ? "bg-accent ring-2 ring-accent/25" : done ? "bg-accent/60" : "bg-surface-4",
                  )}
                />
                {active && <span className="text-2xs font-medium whitespace-nowrap text-fg">{humanize(s)}</span>}
              </span>
            </Tooltip>
          </li>
        );
      })}
    </ol>
  );
}

function Nearby() {
  const nearby = useStore((s) => s.nearby);
  const selectAsset = useStore((s) => s.selectAsset);
  const assetIndex = useAssetIndex();
  return (
    <div className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden" aria-live="polite">
      <Radar aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
      <span className="shrink-0 text-2xs text-fg-subtle">In range</span>
      {nearby.length === 0 ? (
        <span className="text-2xs text-fg-subtle">none</span>
      ) : (
        nearby.map((o) => {
          const a = assetIndex[o.asset_id];
          const tone = TONES[conditionOf(a?.condition_state).tone];
          return (
            <button
              key={o.object_id}
              type="button"
              onClick={() => selectAsset(o.asset_id)}
              className={cx("flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 font-mono text-2xs text-fg hover:bg-surface-3", tone.border)}
            >
              <span className={cx("size-1.5 rounded-full", tone.dot)} />
              {a?.tag ?? o.asset_id}
            </button>
          );
        })
      )}
    </div>
  );
}
