import { Check, ClipboardList, Copy, Download, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchWorkOrderDraft, useResource } from "../../data.js";
import { Badge, Button, cx, ErrorState, IconButton, SkeletonRows } from "../primitives.jsx";
import { fmt, humanize } from "../status.js";
import { GenerationBadge } from "./ReportCard.jsx";
import { EvidenceChip } from "./evidence.jsx";

const PRIORITIES = ["high", "medium", "low"];

function toForm(draft) {
  return {
    title: draft.title ?? "",
    action: draft.action ?? "",
    priority: draft.priority ?? "medium",
    role: draft.role ?? "",
    maintenance_type: draft.maintenance_type ?? "",
    summary: draft.summary ?? "",
    safe_checks: (draft.safe_checks ?? []).join("\n"),
    notes: "",
  };
}

function exportDraft(draft, form) {
  return {
    ...draft,
    title: form.title,
    action: form.action,
    priority: form.priority,
    role: form.role,
    summary: form.summary,
    safe_checks: form.safe_checks.split("\n").map((s) => s.trim()).filter(Boolean),
    reviewer_notes: form.notes || null,
    status: "draft",
  };
}

function asText(d) {
  return [
    `${d.title}  [DRAFT, not submitted]`,
    `Asset: ${d.tag} (${d.asset_id}), ${d.area_name}`,
    `Action: ${d.action}`,
    `Type: ${d.maintenance_type} · Priority: ${d.priority} · Role: ${d.role}`,
    `Knowledge doc: ${d.knowledge_doc_id}`,
    "",
    d.summary,
    "",
    "Safe checks:",
    ...d.safe_checks.map((c, i) => `${i + 1}. ${c}`),
    "",
    `Evidence: ${d.evidence_ids.join(", ")}`,
    d.reviewer_notes ? `Reviewer notes: ${d.reviewer_notes}` : null,
    d.note,
  ]
    .filter((line) => line != null)
    .join("\n");
}

// Editable draft built by POST /api/work-orders/draft. It is never submitted:
// the only outputs are copy and download.
export function WorkOrderDraft({ assetId, onClose, onEvidence, activeId }) {
  const draft = useResource(`work_order_draft:${assetId}`, () => fetchWorkOrderDraft(assetId));
  const [form, setForm] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (draft.data) setForm(toForm(draft.data.draft));
  }, [draft.data]);

  return (
    <section
      aria-label="Work-order draft"
      className="grid grid-cols-1 gap-3 rounded-lg border border-line-strong bg-surface-2/60 p-3 animate-pop-in"
    >
      <div className="flex items-center gap-1.5">
        <ClipboardList aria-hidden className="size-4 text-fg-muted" />
        <span className="text-xs font-semibold text-fg">Work-order draft</span>
        <Badge tone="watch" dashed>
          Draft · not submitted
        </Badge>
        <span className="ml-auto">
          <IconButton label="Close draft" onClick={onClose}>
            <X />
          </IconButton>
        </span>
      </div>

      {draft.loading && <SkeletonRows rows={5} />}
      {draft.error &&
        (draft.error.offline ? (
          <p className="m-0 text-xs text-fg-muted">{draft.error.message}</p>
        ) : (
          <ErrorState error={draft.error} />
        ))}

      {draft.data && form && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <GenerationBadge answer={draft.data} />
            {draft.data.confidence && <Badge>Confidence {fmt(draft.data.confidence.score, 2)}</Badge>}
            <Badge>{humanize(draft.data.draft.maintenance_type)}</Badge>
            <span className="font-mono text-2xs text-fg-subtle">{draft.data.draft.knowledge_doc_id}</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            <FormField label="Title">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} />
            </FormField>
            <FormField label="Action">
              <input value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className={inputCls} />
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Priority (from urgency)">
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={inputCls}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {humanize(p)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Role">
                <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={cx(inputCls, "font-mono")} />
              </FormField>
            </div>
            <FormField label="Summary">
              <textarea
                rows={3}
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
                className={cx(inputCls, "h-auto py-1.5")}
              />
            </FormField>
            <FormField label="Safe checks (one per line)">
              <textarea
                rows={3}
                value={form.safe_checks}
                onChange={(e) => setForm({ ...form, safe_checks: e.target.value })}
                className={cx(inputCls, "h-auto py-1.5")}
              />
            </FormField>
            <FormField label="Reviewer notes">
              <textarea
                rows={2}
                value={form.notes}
                placeholder="Site checks, permits, who reviewed…"
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className={cx(inputCls, "h-auto py-1.5")}
              />
            </FormField>
            <div>
              <div className="mb-1 text-2xs text-fg-subtle">Evidence cited by the diagnosis (read-only)</div>
              <div className="flex flex-wrap gap-1">
                {draft.data.draft.evidence_ids.map((id) => (
                  <EvidenceChip key={id} id={id} onOpen={onEvidence} active={activeId === id} />
                ))}
              </div>
            </div>
          </div>

          <p className="m-0 rounded-md border border-status-watch/35 bg-status-watch-soft/60 px-2.5 py-1.5 text-2xs text-fg-muted">
            {draft.data.draft.note}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="default"
              onClick={async () => {
                await navigator.clipboard?.writeText(asText(exportDraft(draft.data.draft, form)));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                const blob = new Blob([JSON.stringify(exportDraft(draft.data.draft, form), null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = Object.assign(document.createElement("a"), { href: url, download: `${assetId}-work-order-draft.json` });
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download /> Download JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(toForm(draft.data.draft))}>
              <RotateCcw /> Reset
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

const inputCls =
  "h-8 w-full min-w-0 rounded-md border border-line-strong bg-surface-0 px-2.5 text-xs text-fg placeholder:text-fg-subtle focus:border-accent/60";

function FormField({ label, children }) {
  return (
    <label className="grid gap-1">
      <span className="text-2xs text-fg-subtle">{label}</span>
      {children}
    </label>
  );
}
