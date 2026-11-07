import { Bell, ChevronDown, ListFilter, MapPinOff, PanelLeftClose, Search, ServerOff, X } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store.js";
import { Button, cx, EmptyState, IconButton, Kbd, Skeleton, StatusIcon, Tooltip } from "./primitives.jsx";
import { sortAssets, useAnchorIndex } from "./selectors.js";
import { assetClassOf, CONDITION_ORDER, CONDITIONS, conditionOf, fmt, humanize, TONES } from "./status.js";

export function AssetRail() {
  const assets = useStore((s) => s.assets);
  const ui = useStore((s) => s.ui);
  const setUi = useStore((s) => s.setUi);
  const openEvents = useStore((s) => s.openEvents);
  const selectedAssetId = useStore((s) => s.selectedAssetId);
  const backend = useStore((s) => s.backend);
  const anchorIndex = useAnchorIndex();
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const [collapsed, setCollapsed] = useState({});

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("rail:focus-search", focus);
    return () => window.removeEventListener("rail:focus-search", focus);
  }, []);

  const counts = useMemo(() => {
    const c = { all: assets.length };
    for (const a of assets) c[a.condition_state] = (c[a.condition_state] || 0) + 1;
    return c;
  }, [assets]);

  const groups = useMemo(() => {
    const q = ui.railQuery.trim().toLowerCase();
    const filtered = assets.filter((a) => {
      if (ui.railStatus !== "all" && a.condition_state !== ui.railStatus) return false;
      if (!q) return true;
      return [a.tag, a.asset_id, a.asset_class, a.area_name, a.issue_code, a.issue_summary]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    const keyOf = ui.railGroup === "class" ? (a) => a.asset_class : (a) => a.condition_state;
    const map = new Map();
    for (const a of sortAssets(filtered)) {
      const k = keyOf(a);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(a);
    }
    const keys = [...map.keys()];
    if (ui.railGroup === "status") keys.sort((x, y) => conditionOf(x).rank - conditionOf(y).rank);
    else keys.sort((x, y) => conditionOf(map.get(x)[0].condition_state).rank - conditionOf(map.get(y)[0].condition_state).rank || x.localeCompare(y));
    return keys.map((k) => ({ key: k, items: map.get(k) }));
  }, [assets, ui.railQuery, ui.railStatus, ui.railGroup]);

  const visible = groups.reduce((n, g) => n + g.items.length, 0);

  // Roving tabindex: the tree is one Tab stop (the selected row, else the
  // first row); arrow keys move within it.
  const expandedIds = groups
    .filter((g) => !collapsed[`${ui.railGroup}:${g.key}`])
    .flatMap((g) => g.items.map((a) => a.asset_id));
  const tabStopId = expandedIds.includes(selectedAssetId) ? selectedAssetId : expandedIds[0];

  function onListKey(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = [...listRef.current.querySelectorAll("[data-rail-row]")];
    if (!rows.length) return;
    event.preventDefault();
    const i = rows.indexOf(document.activeElement);
    let next = 0;
    if (event.key === "ArrowDown") next = i < 0 ? 0 : Math.min(rows.length - 1, i + 1);
    if (event.key === "ArrowUp") next = i < 0 ? 0 : Math.max(0, i - 1);
    if (event.key === "End") next = rows.length - 1;
    rows[next].focus();
  }

  return (
    <aside className="rail flex min-h-0 flex-col border-r border-line bg-surface-1" aria-label="Asset tree">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="m-0 text-sm font-semibold">Assets</h2>
        <span className="tabular text-xs text-fg-subtle">{assets.length || ""}</span>
        <ToggleGroup.Root
          type="single"
          value={ui.railGroup}
          onValueChange={(v) => v && setUi({ railGroup: v })}
          aria-label="Group assets by"
          className="ml-auto flex rounded-md border border-line bg-surface-2 p-0.5"
        >
          {[
            ["status", "Status"],
            ["class", "Class"],
          ].map(([v, label]) => (
            <ToggleGroup.Item
              key={v}
              value={v}
              className="h-5 rounded-sm px-2 text-2xs text-fg-subtle data-[state=on]:bg-surface-4 data-[state=on]:text-fg"
            >
              {label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
        <IconButton label="Collapse asset tree" shortcut="[" onClick={() => setUi({ railOpen: false })}>
          <PanelLeftClose />
        </IconButton>
      </div>

      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface-0 px-2.5 focus-within:border-accent/60">
          <Search aria-hidden className="size-3.5 text-fg-subtle" />
          <input
            ref={searchRef}
            value={ui.railQuery}
            onChange={(e) => setUi({ railQuery: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setUi({ railQuery: "" });
                e.currentTarget.blur();
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                listRef.current?.querySelector("[data-rail-row]")?.focus();
              }
            }}
            placeholder="Filter by tag, class, area, issue"
            aria-label="Filter assets"
            className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
          />
          {ui.railQuery ? (
            <button type="button" aria-label="Clear filter" onClick={() => setUi({ railQuery: "" })} className="text-fg-subtle hover:text-fg">
              <X className="size-3.5" />
            </button>
          ) : (
            <Kbd>/</Kbd>
          )}
        </label>
      </div>

      <ToggleGroup.Root
        type="single"
        value={ui.railStatus}
        onValueChange={(v) => setUi({ railStatus: v || "all" })}
        aria-label="Filter by condition"
        className="flex flex-wrap gap-1 px-3 pb-2.5"
      >
        <FilterChip value="all" label="All" count={counts.all} />
        {CONDITION_ORDER.map((state) => (
          <FilterChip key={state} value={state} state={state} label={CONDITIONS[state].label} count={counts[state] || 0} />
        ))}
      </ToggleGroup.Root>

      <div
        ref={listRef}
        onKeyDown={onListKey}
        className="min-h-0 flex-1 overflow-y-auto border-t border-line px-1.5 pt-1 pb-3"
        role="tree"
        aria-label="Assets"
      >
        {!assets.length && backend === "offline" ? (
          <EmptyState icon={ServerOff} title="No asset data">
            Start the backend on port 8000, or run <code className="font-mono">npm run snapshot</code> once for offline mode.
          </EmptyState>
        ) : !assets.length ? (
          <div className="grid gap-3 p-2">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="size-4 rounded-full" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-2.5 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : visible === 0 ? (
          <EmptyState icon={ListFilter} title="No assets match">
            <Button size="xs" variant="outline" className="mt-2" onClick={() => setUi({ railQuery: "", railStatus: "all" })}>
              Clear filters
            </Button>
          </EmptyState>
        ) : (
          groups.map((group) => {
            const open = !collapsed[`${ui.railGroup}:${group.key}`];
            const heading = ui.railGroup === "class" ? assetClassOf(group.key) : null;
            const HeadingIcon = heading?.icon;
            return (
              <div key={group.key} role="group" className="mt-1">
                <button
                  type="button"
                  data-rail-row
                  tabIndex={tabStopId ? -1 : 0}
                  aria-expanded={open}
                  onClick={() => setCollapsed((c) => ({ ...c, [`${ui.railGroup}:${group.key}`]: open }))}
                  className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-2xs font-semibold tracking-[0.06em] text-fg-subtle uppercase hover:text-fg-muted"
                >
                  <ChevronDown aria-hidden className={cx("size-3 transition-transform", !open && "-rotate-90")} />
                  {HeadingIcon ? <HeadingIcon aria-hidden className="size-3" /> : <StatusIcon state={group.key} className="size-3" />}
                  <span className="truncate">{heading ? heading.plural : conditionOf(group.key).long}</span>
                  <span className="tabular ml-auto font-normal tracking-normal">{group.items.length}</span>
                </button>
                {open &&
                  group.items.map((asset) => (
                    <AssetRow
                      key={asset.asset_id}
                      asset={asset}
                      selected={asset.asset_id === selectedAssetId}
                      tabbable={asset.asset_id === tabStopId}
                      openEvents={openEvents?.[asset.asset_id]}
                      anchor={anchorIndex[asset.asset_id]}
                      showClass={ui.railGroup === "status"}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-2xs text-fg-subtle">
        <span className="hatch inline-block h-3 w-4 rounded-xs border border-dashed border-status-procedural/60" />
        Scene bindings are procedural until verified on site.
      </div>
    </aside>
  );
}

function FilterChip({ value, label, count, state }) {
  return (
    <ToggleGroup.Item
      value={value}
      aria-label={`${label}: ${count}`}
      className={cx(
        "flex h-6 items-center gap-1 rounded-full border border-line px-2 text-2xs text-fg-muted hover:border-line-strong hover:text-fg",
        "data-[state=on]:border-accent/50 data-[state=on]:bg-accent-soft data-[state=on]:text-fg",
      )}
    >
      {state && <StatusIcon state={state} className="size-3" />}
      {label}
      <span className="tabular text-fg-subtle">{count}</span>
    </ToggleGroup.Item>
  );
}

function AssetRow({ asset, selected, tabbable, openEvents, anchor, showClass }) {
  const selectAsset = useStore((s) => s.selectAsset);
  const condition = conditionOf(asset.condition_state);
  const tone = TONES[condition.tone];
  const unreachable = anchor && anchor.reachable === false;
  const abnormal = asset.condition_state !== "healthy";

  return (
    <button
      type="button"
      data-rail-row
      tabIndex={tabbable ? 0 : -1}
      role="treeitem"
      aria-selected={selected}
      onClick={() => selectAsset(asset.asset_id)}
      className={cx(
        "group relative flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2 pl-2.5 text-left transition-colors duration-[var(--dur-fast)]",
        selected ? "bg-surface-3" : "hover:bg-surface-2",
      )}
    >
      {selected && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent" />}
      <StatusIcon state={asset.condition_state} />
      <span className="grid min-w-0 flex-1 gap-px">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-xs font-semibold whitespace-nowrap text-fg">{asset.tag}</span>
          {abnormal && asset.issue_code !== "NORMAL" && (
            <span className={cx("truncate text-2xs", tone.text)}>{humanize(asset.issue_code)}</span>
          )}
        </span>
        <span className="truncate text-2xs text-fg-subtle">
          {showClass ? `${assetClassOf(asset.asset_class).label} · ` : ""}
          {asset.area_name}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {openEvents > 0 && (
          <Tooltip content={`${openEvents} open events`}>
            <span className="tabular flex items-center gap-0.5 text-2xs text-fg-subtle">
              <Bell aria-hidden className="size-3" />
              {openEvents}
            </span>
          </Tooltip>
        )}
        {unreachable && (
          <Tooltip content={`Outside scanned floor (${fmt(anchor.distance_to_walkable_m, 2)} m away): no robot route`}>
            <MapPinOff aria-label="Unreachable" className="size-3 text-fg-faint" />
          </Tooltip>
        )}
        <HealthScore value={asset.health_score} tone={condition.tone} />
      </span>
    </button>
  );
}

function HealthScore({ value, tone }) {
  return (
    <span className="grid w-8 justify-items-end gap-0.5" aria-label={`Health ${fmt(value, 0)}`}>
      <span className={cx("tabular text-xs font-semibold", tone === "normal" ? "text-fg-muted" : TONES[tone].text)}>
        {fmt(value, 0)}
      </span>
      <span className="h-0.5 w-full overflow-hidden rounded-full bg-surface-4">
        <span className={cx("block h-full", TONES[tone].dot)} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
      </span>
    </span>
  );
}
