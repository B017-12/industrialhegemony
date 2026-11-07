import { Box } from "lucide-react";
import { Badge, Card, Field, Meter, SectionTitle } from "../primitives.jsx";
import { fmt, humanize } from "../status.js";

export function ObjectCard({ object }) {
  const dims = object.features?.dims_m;
  const height = object.height_above_floor_m;
  const pipes = (object.relations ?? []).filter((r) => r.type === "connected_pipe");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-dashed border-line-strong bg-surface-2">
            <Box aria-hidden className="size-5 text-fg-subtle" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{object.display_label}</div>
            <div className="text-xs text-fg-subtle">
              <span className="font-mono">{object.object_id}</span> · {humanize(object.class)} · not bound to an Excel asset
            </div>
          </div>
        </div>

        <Card className="grid gap-3">
          <div>
            <div className="mb-1 flex justify-between text-2xs text-fg-subtle">
              <span>Class confidence ({object.label_source})</span>
              <span className="tabular text-fg-muted">{fmt(object.class_confidence, 2)}</span>
            </div>
            <Meter value={object.class_confidence} tone="offline" label="Class confidence" />
          </div>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Field label="Segmentation">{humanize(object.source)}</Field>
            <Field label="Splats">{fmt(object.splat_count, 0)}</Field>
            {dims && (
              <Field label="Size (W × D × H)">
                {fmt(dims.width, 2)} × {fmt(dims.depth, 2)} × {fmt(dims.height, 2)} m
              </Field>
            )}
            {height && (
              <Field label="Height above floor">
                {fmt(height.bottom, 2)}–{fmt(height.top, 2)} m
              </Field>
            )}
            {object.obb?.yaw_deg != null && <Field label="Box yaw">{fmt(object.obb.yaw_deg, 1)}°</Field>}
            <Field label="Connected pipes">{pipes.length || "none"}</Field>
          </dl>
          {object.segmentation_notes?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {object.segmentation_notes.map((n) => (
                <Badge key={n}>{n}</Badge>
              ))}
            </div>
          )}
        </Card>

        <section>
          <SectionTitle>Why it has no asset data</SectionTitle>
          <p className="m-0 text-xs text-fg-muted">
            This object was framed by the geometry pipeline but is not bound to any asset in the workbook, so there is no telemetry, events or
            work orders to show.{" "}
            {object.label_source === "human"
              ? "Its label was confirmed by a person."
              : `Its label comes from the ${object.label_source} labeller and is unconfirmed.`}
          </p>
        </section>
      </div>
    </div>
  );
}
