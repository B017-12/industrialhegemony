import { Command } from "cmdk";
import {
  ClipboardCheck,
  Crosshair,
  FileText,
  Hand,
  Highlighter,
  Map as MapIcon,
  Maximize2,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  RotateCcw,
  Search,
  Send,
  Siren,
  TriangleAlert,
  Video,
  X,
} from "lucide-react";
import { Dialog, VisuallyHidden } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchApi } from "../data.js";
import { useStore } from "../store.js";
import { cx, Kbd, StatusIcon } from "./primitives.jsx";
import { sortAssets } from "./selectors.js";
import { assetClassOf, humanize } from "./status.js";
import { INSPECTOR_TABS } from "./inspector/Inspector.jsx";

const RESULT_ICON = { issue: TriangleAlert, event: Siren, document: FileText };
const RESULT_TAB = { issue: "overview", event: "events", document: "overview" };

// Same stop words and plural rule as backend/app/routes/search.py, so local
// (offline) matching agrees with /api/search.
const STOPWORDS = new Set(
  "a an and are all any for in is of on or the to with show find list which what that need needs needing me my".split(" "),
);
function tokenise(text) {
  const tokens = (text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
    .filter((t) => !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
  return [...new Set(tokens)];
}
function assetHaystack(a) {
  return [a.tag, a.asset_id, a.asset_class, assetClassOf(a.asset_class).label, a.area_name, a.issue_code, a.condition_state]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/_/g, " ");
}

export function CommandPalette() {
  const open = useStore((s) => s.ui.paletteOpen);
  const setUi = useStore((s) => s.setUi);
  const assets = useStore((s) => s.assets);
  const backend = useStore((s) => s.backend);
  const running = useStore((s) => s.running);
  const selectedAssetId = useStore((s) => s.selectedAssetId);
  const navTargets = useStore((s) => s.navTargets);
  const targetAssetId = useStore((s) => s.mission.targetAssetId);
  const missionLive = useStore((s) => s.mission.state !== "idle");
  const highlight = useStore((s) => s.highlight);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setRemote(null);
      return undefined;
    }
    let alive = true;
    const id = setTimeout(() => {
      searchApi(q)
        .then((r) => alive && setRemote(r))
        .catch(() => alive && setRemote(null));
    }, 160);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query, open]);

  const q = query.trim().toLowerCase();
  const allMatches = useMemo(() => {
    const sorted = sortAssets(assets);
    if (!q) return sorted.filter((a) => a.condition_state !== "healthy");
    const tokens = tokenise(q);
    const remoteIds = new Set(remote?.asset_ids ?? []);
    return sorted.filter(
      (a) => remoteIds.has(a.asset_id) || (tokens.length > 0 && tokens.every((t) => assetHaystack(a).includes(t))),
    );
  }, [assets, q, remote]);
  const assetMatches = allMatches.slice(0, q ? 10 : 6);
  // Assets to light up in 3D: the backend's best asset matches, else local matches.
  const highlightIds = q.length >= 2 ? (remote?.asset_ids?.length ? remote.asset_ids : allMatches.map((a) => a.asset_id)) : [];
  const tagOf = (id) => assets.find((a) => a.asset_id === id)?.tag ?? id;

  const otherResults = (remote?.results ?? []).filter((r) => r.type !== "asset").slice(0, 8);

  // "Send robot to ..." for every asset with an approach pose.
  const dispatchTargets = useMemo(() => {
    const byId = Object.fromEntries(assets.map((a) => [a.asset_id, a]));
    return (navTargets?.targets ?? [])
      .filter((t) => t.reachable)
      .map((t) => ({ ...t, asset: byId[t.asset_id] }))
      .filter((t) => {
        if (!q) return t.asset_id === targetAssetId || t.asset?.condition_state !== "healthy";
        const hay = `send robot dispatch ${t.asset?.tag ?? ""} ${t.asset_id} ${assetClassOf(t.asset?.asset_class).label}`.toLowerCase();
        return q.split(/\s+/).every((tok) => hay.includes(tok));
      })
      .slice(0, 6);
  }, [navTargets, assets, q, targetAssetId]);

  const close = () => setUi({ paletteOpen: false });
  const run = (fn) => () => {
    fn();
    close();
  };
  const st = useStore.getState;

  const reviewing = st().ui.mode === "review";
  const actions = [
    ...(highlight ? [{ id: "unhighlight", label: `Clear 3D highlight (${highlight.query})`, icon: X, run: () => st().setHighlight(null) }] : []),
    {
      id: "review",
      label: reviewing ? "Exit label review" : "Review labels (crop tour and review queue)",
      icon: ClipboardCheck,
      shortcut: "L",
      run: () => st().setReviewMode(!reviewing),
    },
    ...(missionLive ? [{ id: "reset", label: "Reset mission", icon: RotateCcw, run: () => st().restartMission() }] : []),
    { id: "cam-overview", label: "Camera: overview", icon: MapIcon, run: () => st().setCameraMode("overview") },
    { id: "cam-mission", label: "Camera: follow the robot", icon: Video, run: () => st().setCameraMode("mission") },
    { id: "cam-free", label: "Camera: free", icon: Hand, run: () => st().setCameraMode("free") },
    { id: "fit", label: "Fit view to room", icon: Crosshair, run: () => st().requestFitView() },
    { id: "full", label: "Full-screen 3D", icon: Maximize2, shortcut: "F", run: () => st().setUi({ fullscreen: true }) },
    { id: "rail", label: "Toggle asset tree", icon: PanelLeft, shortcut: "[", run: () => st().toggleUi("railOpen") },
    { id: "insp", label: "Toggle inspector", icon: PanelRight, shortcut: "]", run: () => st().toggleUi("inspectorOpen") },
    ...(missionLive
      ? [{ id: "run", label: running ? "Pause mission" : "Resume mission", icon: running ? Pause : Play, shortcut: "Space", run: () => st().toggleRunning() }]
      : []),
    ...(selectedAssetId
      ? [
          { id: "clear", label: "Clear selection", icon: X, shortcut: "Esc", run: () => st().selectAsset(null) },
          ...INSPECTOR_TABS.map(([tab, label]) => ({
            id: `tab-${tab}`,
            label: `Open ${label} tab`,
            icon: PanelRight,
            run: () => st().setUi({ inspectorTab: tab, inspectorOpen: true }),
          })),
        ]
      : []),
  ].filter((a) => !q || a.label.toLowerCase().includes(q));

  return (
    <PaletteDialog
      open={open}
      onOpenChange={(v) => setUi({ paletteOpen: v })}
      label="Command palette"
      shouldFilter={false}
      loop
    >
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-fg-subtle" />
        <Command.Input value={query} onValueChange={setQuery} placeholder="Search assets, issues, events, documents, or run a command" />
      </div>
      <Command.List>
        <Command.Empty>No matches{backend !== "online" ? " (full-text search needs the live API)" : ""}.</Command.Empty>

        {highlightIds.length > 0 && (
          <Command.Group heading="Search in 3D">
            <Command.Item
              value="highlight-3d"
              onSelect={run(() => st().setHighlight({ query: query.trim(), assetIds: highlightIds }))}
            >
              <Highlighter aria-hidden className="size-3.5 shrink-0 text-accent" />
              <span className="text-fg">
                Highlight {highlightIds.length} matching {highlightIds.length === 1 ? "asset" : "assets"} in 3D
              </span>
              <span className="ml-auto truncate font-mono text-2xs text-fg-subtle">{highlightIds.slice(0, 6).map(tagOf).join(" ")}</span>
            </Command.Item>
          </Command.Group>
        )}

        {assetMatches.length > 0 && (
          <Command.Group heading={q ? "Assets" : "Assets needing attention"}>
            {assetMatches.map((a) => (
              <Command.Item key={a.asset_id} value={`asset-${a.asset_id}`} onSelect={run(() => st().selectAsset(a.asset_id))}>
                <StatusIcon state={a.condition_state} />
                <span className="font-mono text-xs font-semibold text-fg">{a.tag}</span>
                <span className="truncate">
                  {assetClassOf(a.asset_class).label} · {a.area_name}
                </span>
                <span className="ml-auto truncate text-2xs text-fg-subtle">{humanize(a.issue_code)}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {otherResults.length > 0 && (
          <Command.Group heading="Issues, events and documents">
            {otherResults.map((r) => {
              const Icon = RESULT_ICON[r.type] ?? FileText;
              return (
                <Command.Item
                  key={`${r.type}-${r.id}`}
                  value={`${r.type}-${r.id}`}
                  onSelect={run(() => {
                    if (r.asset_id) {
                      st().selectAsset(r.asset_id);
                      st().setUi({ inspectorTab: RESULT_TAB[r.type] ?? "overview" });
                    }
                  })}
                >
                  <Icon aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
                  <span className="truncate text-fg">{r.title}</span>
                  <span className="truncate text-2xs text-fg-subtle">{r.subtitle}</span>
                  <span className="ml-auto shrink-0 font-mono text-2xs text-fg-subtle">{r.id}</span>
                </Command.Item>
              );
            })}
          </Command.Group>
        )}

        {dispatchTargets.length > 0 && (
          <Command.Group heading="Send robot to">
            {dispatchTargets.map((t) => (
              <Command.Item key={t.asset_id} value={`dispatch-${t.asset_id}`} onSelect={run(() => st().dispatchMission(t.asset_id))}>
                <Send aria-hidden className="size-3.5 shrink-0 text-accent" />
                <span className="font-mono text-xs font-semibold text-fg">{t.asset?.tag ?? t.asset_id}</span>
                <StatusIcon state={t.asset?.condition_state} />
                <span className="truncate">{assetClassOf(t.asset?.asset_class).label}</span>
                <span className="tabular ml-auto shrink-0 text-2xs text-fg-subtle">
                  {t.mission?.stats?.path_length_m?.toFixed(2)} m · {t.mission?.stats?.duration_s?.toFixed(1)} s
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {actions.length > 0 && (
          <Command.Group heading="Commands">
            {actions.map((a) => (
              <Command.Item key={a.id} value={`action-${a.id}`} onSelect={run(a.run)}>
                <a.icon aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
                <span>{a.label}</span>
                {a.shortcut && <Kbd className="ml-auto">{a.shortcut}</Kbd>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
      <div className={cx("flex items-center gap-3 border-t border-line px-3 py-2 text-2xs text-fg-subtle")}>
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> close
        </span>
        <span className="ml-auto">{backend === "online" ? "Full-text search via /api/search" : "Local asset search (API offline)"}</span>
      </div>
    </PaletteDialog>
  );
}

// Same shape as cmdk's Command.Dialog, plus an accessible title and focus
// return. The palette opens from the store (shortcut or button), so there is
// no Dialog.Trigger for Radix to restore focus to.
function PaletteDialog({ open, onOpenChange, label, children, ...props }) {
  const returnFocus = useRef(null);
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.ui.paletteOpen && !prev.ui.paletteOpen) returnFocus.current = document.activeElement;
      }),
    [],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay cmdk-overlay="" />
        <Dialog.Content
          cmdk-dialog=""
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            const el = returnFocus.current;
            if (el instanceof HTMLElement && el.isConnected && el !== document.body) {
              event.preventDefault();
              el.focus();
            }
          }}
        >
          <VisuallyHidden.Root asChild>
            <Dialog.Title>{label}</Dialog.Title>
          </VisuallyHidden.Root>
          <Command label={label} {...props}>
            {children}
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
