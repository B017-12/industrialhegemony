import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchCopilot, useResource } from "../../data.js";
import { useStore } from "../../store.js";
import { CopilotChat } from "../copilot/CopilotChat.jsx";
import { kindMeta } from "../copilot/evidence.jsx";
import { WorkOrderDraft } from "../copilot/WorkOrderDraft.jsx";
import { Badge, cx, ErrorState, Skeleton, SkeletonRows } from "../primitives.jsx";
import { useAssetIndex } from "../selectors.js";
import { CopilotSlot } from "./CopilotSlot.jsx";

const KIND_ORDER = ["state", "telemetry", "baseline", "event_summary", "event", "case", "work_order", "data_quality", "mapping", "asset", "document"];

// Copilot tab (id "evidence"): the arrival report, the work-order draft, chat,
// and the full evidence bundle. Chips open the evidence drawer (Inspector.jsx).
export function EvidenceTab({ assetId }) {
  // A failed load is dropped from the resource cache, so remounting refetches.
  const [attempt, setAttempt] = useState(0);
  return <CopilotTab key={attempt} assetId={assetId} onRetry={() => setAttempt((n) => n + 1)} />;
}

function CopilotTab({ assetId, onRetry }) {
  const answer = useResource(`copilot:${assetId}:arrival_diagnosis`, () => fetchCopilot(assetId, "arrival_diagnosis"));
  const activeId = useStore((s) => s.ui.evidenceId);
  const openEvidence = useStore((s) => s.openEvidence);
  const tag = useAssetIndex()[assetId]?.tag;
  const [drafting, setDrafting] = useState(false);

  useEffect(() => setDrafting(false), [assetId]);

  const { groups, cited } = useMemo(() => {
    const data = answer.data;
    if (!data) return { groups: [], cited: new Set() };
    const citedIds = new Set([...data.observations, ...data.hypotheses].flatMap((c) => c.evidence_ids));
    const byKind = new Map();
    for (const e of data.evidence) {
      if (!byKind.has(e.kind)) byKind.set(e.kind, []);
      byKind.get(e.kind).push(e);
    }
    const kinds = [...KIND_ORDER, ...[...byKind.keys()].filter((k) => !KIND_ORDER.includes(k))];
    return { groups: kinds.filter((k) => byKind.has(k)).map((k) => ({ kind: k, items: byKind.get(k) })), cited: citedIds };
  }, [answer.data]);

  if (answer.error) return <ErrorState error={answer.error} onRetry={onRetry} />;
  if (answer.loading) return <ReportSkeleton />;

  return (
    <div className="grid grid-cols-1 gap-4">
      <CopilotSlot answer={answer.data} onEvidence={openEvidence} activeId={activeId} onDraft={drafting ? null : () => setDrafting(true)} />

      {drafting && <WorkOrderDraft assetId={assetId} onClose={() => setDrafting(false)} onEvidence={openEvidence} activeId={activeId} />}

      <CopilotChat assetId={assetId} tag={tag} onEvidence={openEvidence} activeId={activeId} />

      <details className="group rounded-md border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs text-fg-muted hover:text-fg">
          <ChevronRight aria-hidden className="size-3 transition-transform group-open:rotate-90" />
          Evidence bundle
          <span className="tabular text-2xs text-fg-subtle">
            {answer.data.evidence.length} items · {cited.size} cited
          </span>
          <span className={cx("ml-auto text-2xs", answer.data.validation?.ok ? "text-status-normal" : "text-status-critical")}>
            validation {answer.data.validation?.ok ? "passed" : "failed"}
          </span>
        </summary>
        <div className="grid gap-3 border-t border-line p-2.5">
          {groups.map((group) => {
            const meta = kindMeta(group.kind);
            return (
              <section key={group.kind}>
                <h3 className="m-0 mb-1 flex items-center gap-1.5 text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase">
                  <meta.icon aria-hidden className="size-3" />
                  {meta.label}
                  <span className="tabular font-normal">{group.items.length}</span>
                </h3>
                <ul className="m-0 grid list-none gap-0.5 p-0">
                  {group.items.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => openEvidence(e.id)}
                        className={cx(
                          "grid w-full gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                          activeId === e.id ? "border-accent/60 bg-accent-soft/40" : "border-transparent hover:bg-surface-2",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-2xs text-fg">{e.id}</span>
                          {cited.has(e.id) && (
                            <Badge tone="accent" className="ml-auto">
                              Cited
                            </Badge>
                          )}
                        </span>
                        <span className="line-clamp-2 text-2xs text-fg-muted">{e.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div role="status" aria-label="Loading diagnosis" className="grid gap-3 rounded-lg border border-line p-3">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-5 w-full" />
      <div className="grid grid-cols-3 gap-1.5">
        <Skeleton className="h-[86px]" />
        <Skeleton className="h-[86px]" />
        <Skeleton className="h-[86px]" />
      </div>
      <SkeletonRows rows={4} />
    </div>
  );
}