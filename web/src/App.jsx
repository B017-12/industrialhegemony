import { Highlighter, Maximize2, Minimize2, PanelLeftOpen, PanelRightOpen, X } from "lucide-react";
import { useEffect } from "react";
import { fetchAnchors, fetchAssets, fetchOpenEventCounts, loadNavTargets, loadSceneData, startHealthPoll } from "./data.js";
import { LabelLayer } from "./scene/Labels.jsx";
import { Viewer } from "./scene/Viewer.jsx";
import { useStore } from "./store.js";
import { AssetRail } from "./ui/AssetRail.jsx";
import { CommandPalette } from "./ui/CommandPalette.jsx";
import { Inspector } from "./ui/inspector/Inspector.jsx";
import { Minimap } from "./ui/Minimap.jsx";
import { MissionDock } from "./ui/MissionDock.jsx";
import { MissionFeed } from "./ui/MissionFeed.jsx";
import { Button, IconButton, Kbd, StatusIcon, TooltipProvider } from "./ui/primitives.jsx";
import { STATUS_HEX } from "./ui/status.js";
import { FpsChip, TopBar } from "./ui/TopBar.jsx";

export function App() {
  const ui = useStore((s) => s.ui);
  useAppData();
  useShortcuts();

  // The viewer cell keeps the same position in the tree in every layout, so
  // collapsing panels or going full screen never remounts the WebGL canvas.
  return (
    <TooltipProvider>
      <div
        className="shell"
        data-rail={ui.railOpen ? "open" : "closed"}
        data-inspector={ui.inspectorOpen ? "open" : "closed"}
        data-fullscreen={ui.fullscreen ? "true" : "false"}
      >
        <TopBar />
        <AssetRail />
        <main className="viewer" aria-label="3D scene">
          <Viewer />
          <LabelLayer />
          <SplatStatus />
          <ViewerChrome />
        </main>
        <Inspector />
        <MissionDock />
      </div>
      <CommandPalette />
    </TooltipProvider>
  );
}

function useAppData() {
  const backend = useStore((s) => s.backend);
  const epoch = useStore((s) => s.dataEpoch);

  useEffect(() => startHealthPoll(), []);

  useEffect(() => {
    const { setSceneData } = useStore.getState();
    loadSceneData()
      .then(({ baseSceneObjects, labelOverrides, nav }) => {
        setSceneData({ baseSceneObjects, labelOverrides, nav, dataStatus: `${baseSceneObjects.objects.length} scene objects` });
        return loadNavTargets().then((navTargets) => navTargets && setSceneData({ navTargets }));
      })
      .catch((error) => setSceneData({ dataStatus: error.message }));
  }, []);

  useEffect(() => {
    if (backend === "checking" || backend === "offline") return;
    const { setSceneData } = useStore.getState();
    let alive = true;
    fetchAssets()
      .then((assets) => {
        if (!alive) return;
        setSceneData({ assets });
        const { selectedId, setSelectedId } = useStore.getState();
        if (selectedId) setSelectedId(selectedId);
        return fetchOpenEventCounts(assets.map((a) => a.asset_id)).then((openEvents) => alive && setSceneData({ openEvents }));
      })
      .catch((error) => console.warn("Asset data unavailable", error));
    fetchAnchors()
      .then((anchors) => alive && setSceneData({ anchors }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [backend === "checking" || backend === "offline", epoch]);
}

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (event) => {
      const s = useStore.getState();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        s.setUi({ paletteOpen: !s.ui.paletteOpen });
        return;
      }
      if (s.ui.paletteOpen || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      // Ignore keys inside open Radix popovers/menus.
      if (event.target instanceof HTMLElement && event.target.closest("[role=dialog]")) return;

      if (event.key === "[") s.toggleUi("railOpen");
      else if (event.key === "]") s.toggleUi("inspectorOpen");
      else if (event.key === "f" || event.key === "F") s.toggleUi("fullscreen");
      else if (event.key === "l" || event.key === "L") s.setReviewMode(s.ui.mode !== "review");
      else if (event.key === "/") {
        event.preventDefault();
        if (s.ui.fullscreen) s.setUi({ fullscreen: false });
        s.setUi({ railOpen: true });
        requestAnimationFrame(() => window.dispatchEvent(new Event("rail:focus-search")));
      } else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        s.toggleRunning();
      } else if (event.key === "Escape") {
        if (s.ui.evidenceId) s.closeEvidence();
        else if (s.ui.fullscreen) s.setUi({ fullscreen: false });
        else if (s.highlight) s.setHighlight(null);
        else if (s.selectedId || s.selectedAssetId) s.selectAsset(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function ViewerChrome() {
  const ui = useStore((s) => s.ui);
  const setUi = useStore((s) => s.setUi);

  if (ui.fullscreen) {
    return (
      <>
        <div className="absolute top-3 right-3 z-10 animate-fade-in">
          <Button size="sm" variant="default" onClick={() => setUi({ fullscreen: false })} className="bg-surface-1/90">
            <Minimize2 /> Exit full screen <Kbd className="ml-1">Esc</Kbd>
          </Button>
        </div>
        <div className="absolute top-3 left-3 z-10">
          <MissionFeed />
        </div>
        <HighlightChip />
      </>
    );
  }
  return (
    <>
      <div className="absolute top-3 left-3 z-10 flex items-start gap-2">
        {!ui.railOpen && (
          <ChromeButton label="Show asset tree" shortcut="[" onClick={() => setUi({ railOpen: true })}>
            <PanelLeftOpen />
          </ChromeButton>
        )}
        <MissionFeed />
      </div>
      <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
        <div className="flex gap-1">
          <ChromeButton label="Full-screen 3D" shortcut="F" onClick={() => setUi({ fullscreen: true })}>
            <Maximize2 />
          </ChromeButton>
          {!ui.inspectorOpen && (
            <ChromeButton label="Show inspector" shortcut="]" onClick={() => setUi({ inspectorOpen: true })}>
              <PanelRightOpen />
            </ChromeButton>
          )}
        </div>
        <Minimap />
      </div>
      <HighlightChip />
      <Legend />
      <div className="absolute right-3 bottom-3 z-10">
        <FpsChip />
      </div>
    </>
  );
}

// Search matches lit up in 3D (set from the command palette).
function HighlightChip() {
  const highlight = useStore((s) => s.highlight);
  const assets = useStore((s) => s.assets);
  const selectAsset = useStore((s) => s.selectAsset);
  const setHighlight = useStore((s) => s.setHighlight);
  if (!highlight) return null;
  const byId = Object.fromEntries(assets.map((a) => [a.asset_id, a]));
  return (
    <div
      data-label-occluder=""
      role="status"
      className="absolute bottom-12 left-1/2 z-10 flex max-w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-full border border-accent/40 bg-surface-1/92 py-1 pr-1 pl-3 text-xs shadow-[var(--shadow-float)] animate-pop-in"
    >
      <Highlighter aria-hidden className="size-3.5 shrink-0 text-accent" />
      <span className="shrink-0 text-fg-muted">
        Highlighting <span className="text-fg">“{highlight.query}”</span> · {highlight.assetIds.length}
      </span>
      <span className="flex min-w-0 gap-1 overflow-hidden">
        {highlight.assetIds.slice(0, 5).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => selectAsset(id)}
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-line-strong bg-surface-2 px-1.5 font-mono text-2xs text-fg-muted hover:text-fg"
          >
            <StatusIcon state={byId[id]?.condition_state} className="size-3" />
            {byId[id]?.tag ?? id}
          </button>
        ))}
      </span>
      <IconButton label="Clear highlight" shortcut="Esc" onClick={() => setHighlight(null)}>
        <X />
      </IconButton>
    </div>
  );
}

function ChromeButton(props) {
  return <IconButton {...props} className="border-line-strong bg-surface-1/90 text-fg-muted hover:bg-surface-3" />;
}

// Same STATUS_HEX values that scene/Overlays.jsx and Robot.jsx draw with.
const LEGEND = [
  ["Attention", STATUS_HEX.critical, "box"],
  ["Degraded", STATUS_HEX.degraded, "box"],
  ["Watch", STATUS_HEX.watch, "box"],
  ["Healthy", STATUS_HEX.normal, "box"],
  ["Unbound object", STATUS_HEX.unbound, "dashed"],
  ["Selected", STATUS_HEX.accent, "box"],
  ["Robot route", STATUS_HEX.accent, "line"],
];

function Legend() {
  return (
    <ul data-label-occluder="" className="pointer-events-none absolute bottom-3 left-3 z-10 m-0 flex max-w-[calc(100%-7rem)] list-none flex-wrap gap-x-3 gap-y-1 rounded-md border border-line bg-surface-1/85 px-2.5 py-1.5 text-2xs text-fg-muted">
      {LEGEND.map(([label, colour, kind]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={
              kind === "line" ? "h-0.5 w-3 rounded-full" : `size-2.5 rounded-[2px] border ${kind === "dashed" ? "border-dashed" : ""}`
            }
            style={kind === "line" ? { background: colour } : { borderColor: colour, background: `${colour}26` }}
          />
          {label}
        </li>
      ))}
      <li className="flex items-center gap-1.5 text-status-procedural">All bindings unverified</li>
    </ul>
  );
}

function formatMb(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function SplatStatus() {
  const splat = useStore((s) => s.splat);
  const loading = splat.state === "idle" || splat.state === "loading" || splat.state === "decoding";
  const pct = splat.totalBytes ? Math.min(100, Math.round((splat.loadedBytes / splat.totalBytes) * 100)) : 0;

  return (
    <>
      {loading && (
        <div className="splat-loading" role="status">
          <strong className="font-medium">{splat.state === "decoding" ? "Decoding splats..." : "Loading boiler room scan..."}</strong>
          <div className="progress">
            <div style={{ width: `${splat.state === "decoding" ? 100 : pct}%` }} />
          </div>
          <small>
            {splat.totalBytes ? `${formatMb(splat.loadedBytes)} of ${formatMb(splat.totalBytes)}` : "Starting download"}
            {splat.url ? ` · ${splat.url.split("/").pop()}` : ""}
          </small>
        </div>
      )}
      {splat.fallbackReason && (
        <div className={`splat-banner ${splat.state === "error" ? "error" : ""}`} role="alert">
          {splat.fallbackReason}
        </div>
      )}
    </>
  );
}
