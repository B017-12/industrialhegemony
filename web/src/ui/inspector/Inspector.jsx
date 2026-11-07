import { ClipboardCheck, PanelRightClose, Sparkles, X } from "lucide-react";
import { ReviewPanel } from "../../review/ReviewPanel.jsx";
import { EvidenceDrawer } from "../copilot/EvidenceDrawer.jsx";
import { Tabs } from "radix-ui";
import { fetchAsset, fetchEvents, useResource } from "../../data.js";
import { useStore } from "../../store.js";
import { cx, IconButton, Meter, Skeleton, StatusPill } from "../primitives.jsx";
import { useAssetIndex } from "../selectors.js";
import { assetClassOf, conditionOf, fmt, humanize, TONES } from "../status.js";
import { EventsTab } from "./EventsTab.jsx";
import { EvidenceTab } from "./EvidenceTab.jsx";
import { ObjectCard } from "./ObjectCard.jsx";
import { OverviewTab } from "./OverviewTab.jsx";
import { PlantOverview } from "./PlantOverview.jsx";
import { TelemetryTab } from "./TelemetryTab.jsx";
import { WorkOrdersTab } from "./WorkOrdersTab.jsx";

export const INSPECTOR_TABS = [
  ["overview", "Overview"],
  ["telemetry", "Telemetry"],
  ["events", "Events"],
  ["work_orders", "Work orders"],
  // Id kept as "evidence": the mission driver opens it on arrival.
  ["evidence", "Copilot"],
];

export function Inspector() {
  const mode = useStore((s) => s.ui.mode);
  return mode === "review" ? <ReviewInspector /> : <AssetOrObjectInspector />;
}

function ReviewInspector() {
  const setUi = useStore((s) => s.setUi);
  return (
    <aside className="inspector flex min-h-0 flex-col border-l border-line bg-surface-1" aria-label="Label review">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <ClipboardCheck aria-hidden className="size-3.5 text-accent" />
        <h2 className="m-0 text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase">Label review</h2>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Exit label review" shortcut="L" onClick={() => useStore.getState().setReviewMode(false)}>
            <X />
          </IconButton>
          <IconButton label="Collapse inspector" shortcut="]" onClick={() => setUi({ inspectorOpen: false })}>
            <PanelRightClose />
          </IconButton>
        </div>
      </div>
      <ReviewPanel />
    </aside>
  );
}

function AssetOrObjectInspector() {
  const selectedId = useStore((s) => s.selectedId);
  const selectedAssetId = useStore((s) => s.selectedAssetId);
  const sceneObjects = useStore((s) => s.sceneObjects);
  const setUi = useStore((s) => s.setUi);
  const object = selectedId ? sceneObjects?.objects.find((o) => o.object_id === selectedId) : null;

  let body;
  if (selectedAssetId) body = <AssetInspector assetId={selectedAssetId} />;
  else if (object) body = <ObjectCard object={object} />;
  else body = <PlantOverview />;

  return (
    <aside className="inspector flex min-h-0 flex-col border-l border-line bg-surface-1" aria-label="Inspector">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="m-0 text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase">
          {selectedAssetId ? "Asset" : object ? "Scene object" : "Plant overview"}
        </h2>
        <div className="ml-auto flex items-center gap-0.5">
          {(selectedAssetId || object) && (
            <IconButton label="Clear selection" shortcut="Esc" onClick={() => useStore.getState().selectAsset(null)}>
              <X />
            </IconButton>
          )}
          <IconButton label="Collapse inspector" shortcut="]" onClick={() => setUi({ inspectorOpen: false })}>
            <PanelRightClose />
          </IconButton>
        </div>
      </div>
      {body}
    </aside>
  );
}

function AssetInspector({ assetId }) {
  const asset = useAssetIndex()[assetId];
  const tab = useStore((s) => s.ui.inspectorTab);
  const setUi = useStore((s) => s.setUi);
  const openEvents = useStore((s) => s.openEvents?.[assetId]);
  const detail = useResource(`asset:${assetId}`, () => fetchAsset(assetId));
  const events = useResource(`events:${assetId}`, () => fetchEvents(assetId));
  const current = detail.data?.current ?? asset;
  const klass = assetClassOf(asset?.asset_class ?? detail.data?.master?.asset_class);
  const ClassIcon = klass.icon;
  const condition = conditionOf(current?.condition_state);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface-2">
            <ClassIcon aria-hidden className="size-5 text-fg-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xl font-semibold tracking-tight">{asset?.tag ?? <Skeleton className="h-6 w-16" />}</span>
              {current && <StatusPill state={current.condition_state} long size="md" />}
            </div>
            <div className="truncate text-xs text-fg-subtle">
              {klass.label} · {asset?.area_name ?? "--"} · <span className="font-mono">{assetId}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <HeaderStat label="Health score" value={fmt(current?.health_score, 0)} tone={condition.tone}>
            <Meter value={current?.health_score} max={100} tone={condition.tone} label="Health score" className="mt-1" />
          </HeaderStat>
          <HeaderStat label="Urgency" value={humanize(current?.urgency)} />
          <HeaderStat label="Criticality" value={asset?.criticality?.split(" - ")[0] ?? "--"} sub={asset?.criticality?.split(" - ")[1]} />
        </div>
      </div>

      <Tabs.Root value={tab} onValueChange={(v) => setUi({ inspectorTab: v })} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List aria-label="Asset details" className="flex shrink-0 border-b border-line px-1.5">
          {INSPECTOR_TABS.map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className={cx(
                "relative flex h-9 flex-auto items-center justify-center gap-1 px-1.5 text-xs whitespace-nowrap text-fg-subtle hover:text-fg-muted",
                "data-[state=active]:text-fg data-[state=active]:after:absolute data-[state=active]:after:inset-x-1.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-accent",
              )}
            >
              {value === "evidence" && <Sparkles aria-hidden className="size-3 text-accent" />}
              {label}
              {value === "events" && openEvents > 0 && <Count label={`${openEvents} open`}>{openEvents}</Count>}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <EvidenceDrawer assetId={assetId} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Tabs.Content value="overview" className="p-4 outline-none">
              <OverviewTab assetId={assetId} detail={detail} />
            </Tabs.Content>
            <Tabs.Content value="telemetry" className="p-4 outline-none">
              <TelemetryTab assetId={assetId} condition={current?.condition_state} />
            </Tabs.Content>
            <Tabs.Content value="events" className="p-4 outline-none">
              <EventsTab events={events} />
            </Tabs.Content>
            <Tabs.Content value="work_orders" className="p-4 outline-none">
              <WorkOrdersTab detail={detail} />
            </Tabs.Content>
            <Tabs.Content value="evidence" className="p-4 outline-none">
              <EvidenceTab assetId={assetId} />
            </Tabs.Content>
          </div>
        </div>
      </Tabs.Root>
    </div>
  );
}

function Count({ children, label }) {
  return (
    <span aria-label={label} className="tabular rounded-full bg-status-critical-soft px-1.5 text-2xs leading-4 text-status-critical">
      {children}
    </span>
  );
}

function HeaderStat({ label, value, sub, tone, children }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-surface-2/60 px-2.5 py-1.5">
      <div className="text-2xs text-fg-subtle">{label}</div>
      <div className={cx("tabular truncate text-sm font-semibold", tone && tone !== "normal" ? TONES[tone].text : "text-fg")}>
        {value}
        {sub && <span className="ml-1 text-2xs font-normal text-fg-subtle">{sub}</span>}
      </div>
      {children}
    </div>
  );
}
