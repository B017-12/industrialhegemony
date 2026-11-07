import { FileText, MapPin, MapPinOff, Send, Sparkles, Wrench } from "lucide-react";
import { fetchCopilot, useResource } from "../../data.js";
import { useStore } from "../../store.js";
import {
  Badge,
  Button,
  Card,
  cx,
  ErrorState,
  Field,
  IdChip,
  MappingBadge,
  Meter,
  SectionTitle,
  Skeleton,
  SkeletonRows,
} from "../primitives.jsx";
import { useAnchorIndex } from "../selectors.js";
import { conditionOf, fmt, fmtDate, humanize, mappingOf, TONES } from "../status.js";
import { GenerationBadge } from "./CopilotSlot.jsx";

export function OverviewTab({ assetId, detail }) {
  if (detail.error) return <ErrorState error={detail.error} />;
  if (detail.loading || !detail.data) return <SkeletonRows rows={6} />;
  const { master, current, scene, documents } = detail.data;
  const tone = conditionOf(current?.condition_state).tone;

  return (
    <div className="grid grid-cols-1 gap-4">
      <StatusLine assetId={assetId} />

      <section>
        <SectionTitle>Current state</SectionTitle>
        <Card className={cx(tone !== "normal" && TONES[tone].border, "grid gap-3")}>
          <div>
            <div className={cx("text-xs font-semibold", TONES[tone].text)}>{humanize(current.issue_code)}</div>
            <p className="m-0 mt-0.5 text-sm text-fg">{current.issue_summary}</p>
          </div>
          {current.recommended_next_check && (
            <div className="flex gap-2 rounded-md bg-surface-0/60 p-2.5">
              <Wrench aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
              <div>
                <div className="text-2xs text-fg-subtle">Recommended next check</div>
                <div className="text-sm text-fg first-letter:uppercase">{current.recommended_next_check}</div>
              </div>
            </div>
          )}
          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label="Urgency">{humanize(current.urgency)}</Field>
            <Field label="Model confidence">{fmt(current.model_confidence, 2)}</Field>
            <Field label="Issue code" mono>
              {current.issue_code}
            </Field>
            <Field label="Last updated">{fmtDate(current.last_updated)}</Field>
            <Field label="Knowledge doc" mono className="col-span-2">
              {current.knowledge_doc_id}
            </Field>
          </dl>
        </Card>
      </section>

      <SceneBinding assetId={assetId} scene={scene} />

      <section>
        <SectionTitle>Identity</SectionTitle>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5">
          <Field label="Asset class">{humanize(master.asset_class)}</Field>
          <Field label="Area">
            {master.area_name} <span className="text-fg-subtle">({master.area_id})</span>
          </Field>
          <Field label="Process context">{humanize(master.process_context)}</Field>
          <Field label="Criticality">{master.criticality}</Field>
          <Field label="Installed">{fmtDate(master.installation_date, false)}</Field>
          <Field label="Last service">{fmtDate(master.last_service_date, false)}</Field>
          <Field label="Service interval">{master.service_interval_days} days</Field>
          <Field label="Connectivity">{master.connectivity_profile}</Field>
          <Field label="QR / NFC" mono>
            {master.qr_id} · {master.nfc_id}
          </Field>
          <Field label="Data">{master.data_classification}</Field>
        </dl>
      </section>

      <section>
        <SectionTitle>Documents</SectionTitle>
        <ul className="m-0 grid list-none gap-1 p-0">
          {documents.map((doc) => (
            <li key={doc.doc_id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
              <FileText aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{doc.title}</div>
                <div className="truncate text-2xs text-fg-subtle">
                  {humanize(doc.document_role)} · {humanize(doc.scope)}
                </div>
              </div>
              {doc.content_available ? <IdChip>{doc.doc_id}</IdChip> : <Badge>No content</Badge>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatusLine({ assetId }) {
  const line = useResource(`copilot:${assetId}:status_line`, () => fetchCopilot(assetId, "status_line"));
  return (
    <div className="flex gap-2.5 rounded-lg border border-accent/25 bg-accent-soft/50 p-3">
      <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-2xs font-semibold tracking-[0.08em] text-accent uppercase">Copilot status</span>
          {line.data && <GenerationBadge answer={line.data} />}
        </div>
        {line.loading ? (
          <Skeleton className="h-4 w-11/12" />
        ) : line.error ? (
          <span className="text-xs text-fg-subtle">Status line unavailable: {String(line.error.message)}</span>
        ) : (
          <p className="m-0 text-sm text-fg">{line.data.summary}</p>
        )}
      </div>
    </div>
  );
}

function SceneBinding({ assetId, scene }) {
  const anchor = useAnchorIndex()[assetId];
  const nav = useStore((s) => s.nav);
  if (!scene) {
    return (
      <section>
        <SectionTitle>Scene binding</SectionTitle>
        <Card className="text-sm text-fg-subtle">Not bound to any scene object.</Card>
      </section>
    );
  }
  const procedural = mappingOf(scene.mapping_method).procedural;
  const reviewerAssigned = scene.mapping_method === "human_assigned";
  const isTarget = nav?.target_asset_id === assetId;
  return (
    <section>
      <SectionTitle action={<MappingBadge method={scene.mapping_method} />}>Scene binding</SectionTitle>
      <Card className={cx("grid gap-3", procedural && "border-dashed border-status-procedural/40")}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-fg">{scene.display_label}</div>
            <div className="text-2xs text-fg-subtle">
              <span className="font-mono">{scene.object_id}</span> · scene class {scene.class} ({fmt(scene.class_confidence, 2)}) ·
              label {scene.label_source}
            </div>
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-2xs text-fg-subtle">
            <span>Mapping confidence</span>
            <span className="tabular text-fg-muted">
              {fmt(scene.mapping_confidence, 2)} <span className="text-fg-subtle">/ cap 0.5</span>
            </span>
          </div>
          <Meter value={scene.mapping_confidence} cap={0.5} tone="procedural" label="Mapping confidence" />
        </div>
        {scene.mapping_notes && <p className="m-0 text-xs text-fg-muted">{scene.mapping_notes}</p>}
        {anchor && (
          <div className="flex items-center gap-2 text-xs">
            {anchor.reachable ? (
              <>
                <MapPin aria-hidden className="size-3.5 text-status-normal" />
                <span className="text-fg-muted">
                  Robot can reach an approach pose{isTarget && nav?.stats ? `: ${fmt(nav.stats.path_length_m, 2)} m route, ${fmt(nav.stats.duration_s, 1)} s` : ""}
                </span>
                <Button size="xs" variant="outline" className="ml-auto" onClick={() => useStore.getState().dispatchMission(assetId)}>
                  <Send /> Send robot
                </Button>
              </>
            ) : (
              <>
                <MapPinOff aria-hidden className="size-3.5 text-fg-faint" />
                <span className="text-fg-muted">
                  Outside scanned floor ({fmt(anchor.distance_to_walkable_m, 2)} m away), so no robot route
                </span>
              </>
            )}
          </div>
        )}
        {procedural && (
          <p className="hatch m-0 rounded-md border border-dashed border-status-procedural/40 px-2.5 py-1.5 text-2xs text-fg-muted">
            {reviewerAssigned
              ? "Reviewer-assigned mapping: a person chose this object, but the asset identity is not verified against a nameplate. The workbook's scene coordinates are placeholders."
              : "Procedural mapping: the asset identity of this object is not visually verified. The workbook's scene coordinates are placeholders."}
          </p>
        )}
      </Card>
    </section>
  );
}
