import { ChevronRight, ClipboardList, Microscope, ShieldAlert, Sparkles } from "lucide-react";
import { fetchTelemetry, useResource } from "../../data.js";
import { Badge, Button, cx, Meter, SectionTitle, Skeleton, Tooltip } from "../primitives.jsx";
import { fmt, fmtSigned, TONES } from "../status.js";
import { EvidenceChip, registerEvidence } from "./evidence.jsx";
import { isOutsideBand, TelemetryChart, unitOf } from "./TelemetryChart.jsx";

const GENERATION = {
  llm: { label: "LLM · validated", tone: "normal", tip: "Model answer that passed the evidence-ID and number validator." },
  deterministic: { label: "Deterministic", tone: "offline", tip: "Template answer built only from the evidence bundle (no LLM key set)." },
  cached: { label: "Cached answer", tone: "watch", tip: "The LLM failed, so this is the last validated answer from the backend cache." },
  deterministic_fallback: {
    label: "Deterministic answer",
    tone: "degraded",
    tip: "The LLM answer failed validation twice, so the validated template answer is shown instead.",
  },
};

export function GenerationBadge({ answer }) {
  const g = GENERATION[answer.generation] ?? { label: answer.generation, tone: "offline" };
  return (
    <>
      <Tooltip content={g.tip}>
        <span>
          <Badge tone={g.tone}>{g.label}</Badge>
        </span>
      </Tooltip>
      {answer.snapshot && (
        <Tooltip content="Backend offline: served from the static snapshot of the same validated answer.">
          <span>
            <Badge tone="watch">Snapshot · offline</Badge>
          </span>
        </Tooltip>
      )}
    </>
  );
}

function confidenceBand(score) {
  if (score == null) return { label: "Unknown", tone: "offline" };
  if (score < 0.4) return { label: "Low · verify before acting", tone: "critical" };
  if (score < 0.7) return { label: "Moderate · verify on site", tone: "watch" };
  return { label: "High", tone: "normal" };
}

const MODE_TITLE = { arrival_diagnosis: "Arrival diagnosis", status_line: "Status", question: "Answer" };

// Full diagnosis report: headline, cavitation-style signature strip, the
// computed confidence, observations vs hypotheses with evidence chips, the
// safety guardrail and a validation trace.
export function ReportCard({ answer, onEvidence, activeId, onDraft }) {
  registerEvidence(answer);
  const safetyDoc = answer.evidence?.find((e) => e.id === "DOC-FIELD-SAFETY");
  const cited = new Set([...(answer.observations ?? []), ...(answer.hypotheses ?? [])].flatMap((c) => c.evidence_ids));

  return (
    <article
      aria-label={`${MODE_TITLE[answer.mode] ?? "Copilot"} for ${answer.asset_id}`}
      className="grid grid-cols-1 gap-3.5 rounded-lg border border-accent/25 bg-accent-soft/30 p-3 [overflow-wrap:anywhere]"
    >
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Sparkles aria-hidden className="size-4 text-accent" />
          <span className="text-2xs font-semibold tracking-[0.08em] text-accent uppercase">{MODE_TITLE[answer.mode] ?? "Copilot"}</span>
          <span className="ml-auto flex flex-wrap justify-end gap-1">
            <GenerationBadge answer={answer} />
          </span>
        </div>
        <p className="m-0 text-sm leading-snug font-medium text-fg">{answer.summary}</p>
      </header>

      {answer.mode === "arrival_diagnosis" && <SignatureStrip answer={answer} onEvidence={onEvidence} activeId={activeId} />}

      <ConfidenceBlock confidence={answer.confidence} />

      <ClaimSection
        title="Observations"
        subtitle="What the data shows"
        items={answer.observations}
        onEvidence={onEvidence}
        activeId={activeId}
      />
      <ClaimSection
        title="Hypotheses"
        subtitle="Possible cause, to verify on site"
        items={answer.hypotheses}
        onEvidence={onEvidence}
        activeId={activeId}
        dashed
      />

      {answer.next_safe_checks?.length > 0 && (
        <SafetyCallout checks={answer.next_safe_checks} doc={safetyDoc} onEvidence={onEvidence} activeId={activeId} />
      )}

      {answer.caveats?.length > 0 && (
        <ul className="m-0 grid list-none gap-1 border-t border-line pt-2.5 pl-0 text-2xs text-fg-subtle">
          {answer.caveats.map((c) => (
            <li key={c} className="flex gap-1.5">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-status-procedural" />
              {c}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {onDraft && (
          <Button size="sm" variant="default" onClick={onDraft}>
            <ClipboardList /> Draft work order
          </Button>
        )}
        <Trace answer={answer} citedCount={cited.size} />
      </div>
    </article>
  );
}

// Compact answer for chat replies: same claims and chips, no signature strip.
export function AnswerCard({ answer, onEvidence, activeId }) {
  registerEvidence(answer);
  return (
    <div className="grid grid-cols-1 gap-2.5 [overflow-wrap:anywhere]">
      <p className="m-0 text-xs leading-snug text-fg">{answer.summary}</p>
      <ClaimSection title="Observations" items={answer.observations} onEvidence={onEvidence} activeId={activeId} small />
      <ClaimSection title="Hypotheses" subtitle="to verify" items={answer.hypotheses} onEvidence={onEvidence} activeId={activeId} dashed small />
      <div className="flex flex-wrap items-center gap-1">
        <GenerationBadge answer={answer} />
        {answer.confidence && (
          <Badge tone={confidenceBand(answer.confidence.score).tone}>Confidence {fmt(answer.confidence.score, 2)}</Badge>
        )}
        <Badge tone={answer.validation?.ok ? "normal" : "critical"}>{answer.validation?.ok ? "Validated" : "Validation failed"}</Badge>
      </div>
    </div>
  );
}

function SignatureStrip({ answer, onEvidence, activeId }) {
  const telemetry = useResource(`telemetry:${answer.asset_id}`, () => fetchTelemetry(answer.asset_id));
  const metrics = [
    ...new Set(
      (answer.observations ?? []).flatMap((o) => o.evidence_ids.filter((id) => id.startsWith("TEL:")).map((id) => id.split(":")[2])),
    ),
  ].slice(0, 3);
  if (!metrics.length) return null;

  return (
    <section aria-label="Telemetry signature">
      <SectionTitle className="mb-1.5" action={<span className="text-2xs text-fg-subtle">first day → last day, healthy band</span>}>
        Signature
      </SectionTitle>
      <div className="grid grid-cols-3 gap-1.5">
        {metrics.map((metric) => {
          if (telemetry.loading || telemetry.error || !telemetry.data) {
            return <Skeleton key={metric} className="h-[86px] rounded-md" />;
          }
          const data = telemetry.data;
          const trend = data.trends[metric];
          const base = data.baselines[metric];
          const label = data.metrics.find((m) => m.metric === metric)?.label ?? metric;
          const outside = isOutsideBand(trend, base);
          const tone = outside ? "critical" : "accent";
          const id = `TEL:${answer.asset_id}:${metric}`;
          return (
            <button
              key={metric}
              type="button"
              onClick={() => onEvidence?.(id)}
              aria-label={`${label}: open evidence ${id}`}
              className={cx(
                "grid min-w-0 gap-1 rounded-md border bg-surface-1/70 p-1.5 text-left transition-colors hover:bg-surface-2",
                activeId === id ? "border-accent/60" : outside ? TONES[tone].border : "border-line",
              )}
            >
              <span className="truncate text-2xs text-fg-subtle">{label}</span>
              <span className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="tabular text-sm font-semibold text-fg">{fmt(trend?.last_day_mean, 2)}</span>
                <span className="truncate text-2xs text-fg-subtle">{unitOf(trend?.unit)}</span>
              </span>
              <span className={cx("tabular text-2xs font-medium", outside ? TONES[tone].text : "text-fg-subtle")}>
                {fmtSigned(trend?.delta_pct, 1)}%
              </span>
              <TelemetryChart telemetry={data} metric={metric} tone={tone} height={34} compact />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ConfidenceBlock({ confidence }) {
  if (!confidence) return null;
  const band = confidenceBand(confidence.score);
  const capped = confidence.reasons.find((r) => /^Capped/i.test(r));
  return (
    <details className="group rounded-md border border-line bg-surface-1/60 px-2.5 py-2">
      <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        <ChevronRight aria-hidden className="size-3 text-fg-subtle transition-transform group-open:rotate-90" />
        <span className="text-xs text-fg-muted">
          Confidence <span className={cx("ml-1 text-2xs", TONES[band.tone].text)}>{band.label}</span>
        </span>
        <span className="tabular text-sm font-semibold text-fg">{fmt(confidence.score, 2)}</span>
        <span />
        <Meter value={confidence.score} cap={capped ? 0.5 : undefined} tone={band.tone} className="col-span-2" label="Confidence" />
      </summary>
      <ol className="m-0 mt-2 grid gap-1 pl-5 text-2xs text-fg-muted">
        {confidence.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ol>
      <p className="m-0 mt-1.5 pl-5 text-2xs text-fg-subtle">Computed in code by the backend, never by the model.</p>
    </details>
  );
}

function ClaimSection({ title, subtitle, items, onEvidence, activeId, dashed, small }) {
  if (!items?.length) return null;
  return (
    <section aria-label={title}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className={cx("m-0 text-2xs font-semibold tracking-[0.08em] uppercase", dashed ? "text-fg-subtle" : "text-accent")}>
          {title}
        </h3>
        {subtitle && <span className="text-2xs text-fg-subtle">{subtitle}</span>}
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {items.map((item) => (
          <li
            key={item.text}
            className={cx("border-l-2 pl-2.5", dashed ? "border-dashed border-fg-faint" : "border-accent/60")}
          >
            <p className={cx("m-0 text-fg", small ? "text-2xs" : "text-xs", dashed && "text-fg-muted italic")}>{item.text}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {item.evidence_ids.map((id) => (
                <EvidenceChip key={id} id={id} onOpen={onEvidence} active={activeId === id} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SafetyCallout({ checks, doc, onEvidence, activeId }) {
  return (
    <section
      aria-label="Safety"
      className="grid gap-2 rounded-md border border-status-watch/45 bg-status-watch-soft/70 p-2.5"
    >
      <div className="flex items-center gap-1.5">
        <ShieldAlert aria-hidden className="size-4 shrink-0 text-status-watch" />
        <span className="text-xs font-semibold text-fg">Next safe checks · follow site procedures</span>
        <EvidenceChip id="DOC-FIELD-SAFETY" onOpen={onEvidence} active={activeId === "DOC-FIELD-SAFETY"} className="ml-auto" />
      </div>
      <ol className="m-0 grid gap-1 pl-4 text-xs text-fg-muted">
        {checks.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      {doc && <p className="m-0 text-2xs text-fg-subtle">“{doc.record?.content ?? doc.text}”</p>}
    </section>
  );
}

function Trace({ answer, citedCount }) {
  const v = answer.validation;
  return (
    <details className="group ml-auto text-2xs text-fg-subtle">
      <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-fg-muted">
        <Microscope aria-hidden className="size-3" />
        Trace
        <span className={v?.ok ? "text-status-normal" : "text-status-critical"}>· validation {v?.ok ? "passed" : "failed"}</span>
      </summary>
      <dl className="m-0 mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md border border-line bg-surface-1 p-2">
        <dt>Generation</dt>
        <dd className="m-0 font-mono text-fg-muted">{answer.generation}</dd>
        <dt>Model</dt>
        <dd className="m-0 font-mono text-fg-muted">{answer.model ?? "none (no API key)"}</dd>
        <dt>LLM attempts</dt>
        <dd className="m-0 tabular text-fg-muted">{v?.attempts ?? 0}</dd>
        <dt>Evidence</dt>
        <dd className="m-0 tabular text-fg-muted">
          {answer.evidence?.length ?? 0} items, {citedCount} cited
        </dd>
        <dt>Errors</dt>
        <dd className="m-0 text-fg-muted">
          {v?.errors?.length ? (
            <ul className="m-0 grid gap-0.5 pl-3">
              {v.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            "none"
          )}
        </dd>
      </dl>
    </details>
  );
}
