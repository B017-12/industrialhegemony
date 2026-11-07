import { CornerDownLeft, LoaderCircle, MessageSquare, Square, User } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { fetchBuilderQuestions, streamCopilot, useResource } from "../../data.js";
import { useStore } from "../../store.js";
import { Badge, Button, cx, ErrorState, IconButton, SectionTitle, Tooltip } from "../primitives.jsx";
import { AnswerCard } from "./ReportCard.jsx";
import { EvidenceChip } from "./evidence.jsx";
import { SNAPSHOT_CHAT_ASSETS, SUGGESTED_QUESTIONS, suggestionFor } from "./questions.js";

// Deterministic answers arrive in one burst; reveal the validated chunks at a
// readable pace instead of all at once.
const REVEAL_MS = 28;

// Per-asset chat history, kept for the session across asset switches.
const histories = new Map();
let nextId = 1;

export function CopilotChat({ assetId, tag, onEvidence, activeId }) {
  const [, rerender] = useReducer((x) => x + 1, 0);
  const [draft, setDraft] = useState("");
  const backend = useStore((s) => s.backend);
  const builder = useResource("builder_questions", fetchBuilderQuestions);
  const abortRef = useRef(null);
  const endRef = useRef(null);
  if (!histories.has(assetId)) histories.set(assetId, []);
  const messages = histories.get(assetId);
  const busy = messages.some((m) => m.status === "streaming");
  const offline = backend === "static" || backend === "offline";
  const offlineCapable = SNAPSHOT_CHAT_ASSETS.includes(assetId);

  useEffect(() => () => abortRef.current?.abort(), [assetId]);

  const builderById = Object.fromEntries((builder.data?.questions ?? []).map((q) => [q.question_id, q]));
  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.text.toLowerCase()));
  const suggestions = SUGGESTED_QUESTIONS.filter((q) => !asked.has(q.text.toLowerCase()));

  async function ask(text) {
    const question = text.trim();
    if (!question || busy) return;
    const suggestion = suggestionFor(question);
    const list = histories.get(assetId);
    list.push({ id: nextId++, role: "user", text: question, source: suggestion?.source });
    const reply = { id: nextId++, role: "assistant", status: "streaming", shown: "", queue: [], meta: null, answer: null, error: null };
    list.push(reply);
    setDraft("");
    rerender();

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setInterval(() => {
      if (!reply.queue.length) return;
      reply.shown += reply.queue.shift();
      rerender();
    }, REVEAL_MS);
    try {
      const answer = await streamCopilot(
        { assetId, mode: "question", question, snapshotKey: suggestion ? `question.${suggestion.id}` : null },
        {
          signal: controller.signal,
          onMeta: (meta) => {
            reply.meta = meta;
            rerender();
          },
          onDelta: (chunk) => reply.queue.push(chunk),
        },
      );
      while (reply.queue.length) await new Promise((r) => setTimeout(r, REVEAL_MS));
      reply.answer = answer;
      reply.status = "done";
    } catch (error) {
      reply.status = controller.signal.aborted ? "stopped" : "error";
      reply.error = controller.signal.aborted ? null : error;
    } finally {
      clearInterval(timer);
      abortRef.current = null;
      rerender();
    }
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, messages.at(-1)?.status]);

  return (
    <section aria-label={`Ask the copilot about ${tag ?? assetId}`} className="grid grid-cols-1 gap-2.5">
      <SectionTitle
        action={
          <span className="flex items-center gap-1">
            <Badge tone="accent">Scope: {tag ?? assetId}</Badge>
            {offline && <Badge tone="watch">Offline</Badge>}
          </span>
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare aria-hidden className="size-3" /> Ask the copilot
        </span>
      </SectionTitle>

      {messages.length > 0 && (
        <ol aria-live="polite" className="m-0 grid list-none gap-2.5 p-0">
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex items-start justify-end gap-1.5">
                <p className="m-0 max-w-[85%] rounded-lg rounded-tr-xs bg-surface-3 px-2.5 py-1.5 text-xs text-fg">
                  {m.text}
                  {m.source && <span className="ml-1.5 font-mono text-2xs text-fg-subtle">{m.source}</span>}
                </p>
                <User aria-hidden className="mt-1 size-3.5 shrink-0 text-fg-subtle" />
              </li>
            ) : (
              <li key={m.id} className="rounded-lg border border-line bg-surface-2/50 p-2.5">
                <Reply message={m} onEvidence={onEvidence} activeId={activeId} />
              </li>
            ),
          )}
          <li ref={endRef} aria-hidden />
        </ol>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Suggested questions">
          {suggestions.map((q) => {
            const bq = builderById[q.source];
            const unavailable = offline && !offlineCapable;
            return (
              <Tooltip
                key={q.id}
                content={
                  bq
                    ? `${bq.question_id} · ${bq.capability_focus} (${bq.priority}): ${bq.builder_question}`
                    : q.source === "DOC-FIELD-SAFETY"
                      ? "From the workbook field-safety guardrail (DOC-FIELD-SAFETY)"
                      : q.source
                }
              >
                <button
                  type="button"
                  disabled={busy || unavailable}
                  onClick={() => ask(q.text)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 text-left text-2xs text-fg-muted transition-colors hover:border-accent/50 hover:text-fg disabled:opacity-45"
                >
                  <span className="shrink-0 font-mono text-fg-subtle">{q.source === "DOC-FIELD-SAFETY" ? "SAFETY" : q.source}</span>
                  <span className="truncate">{q.text}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}

      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={offline ? "Offline: suggested questions only" : `Ask about ${tag ?? assetId}…`}
          aria-label={`Question about ${tag ?? assetId}`}
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-0 px-2.5 text-xs text-fg placeholder:text-fg-subtle focus:border-accent/60"
        />
        {busy ? (
          <IconButton label="Stop" onClick={() => abortRef.current?.abort()}>
            <Square />
          </IconButton>
        ) : (
          <Button size="sm" type="submit" variant="primary" disabled={!draft.trim()} aria-label="Send question">
            <CornerDownLeft /> Ask
          </Button>
        )}
      </form>
      <p className="m-0 text-2xs text-fg-subtle">
        Answers use only this asset&apos;s evidence bundle and pass the ID and number validator before any text is shown.
      </p>
    </section>
  );
}

function Reply({ message, onEvidence, activeId }) {
  if (message.status === "error") {
    return message.error?.offline ? (
      <p className="m-0 text-xs text-fg-muted">{message.error.message}</p>
    ) : (
      <ErrorState error={message.error} />
    );
  }
  if (message.status === "stopped") return <p className="m-0 text-xs text-fg-subtle">Stopped.</p>;
  if (message.answer) {
    return (
      <div className="grid gap-2">
        <AnswerCard answer={message.answer} onEvidence={onEvidence} activeId={activeId} />
        <details className="group text-2xs text-fg-subtle">
          <summary className="cursor-pointer list-none hover:text-fg-muted">
            Evidence bundle · {message.answer.evidence?.length ?? 0} items
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(message.answer.evidence ?? []).map((e) => (
              <EvidenceChip key={e.id} id={e.id} onOpen={onEvidence} active={activeId === e.id} />
            ))}
          </div>
        </details>
      </div>
    );
  }
  return (
    <div className="grid gap-1.5" role="status">
      {message.shown ? (
        <p className="m-0 text-xs text-fg">
          {message.shown}
          <span aria-hidden className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse-soft bg-accent" />
        </p>
      ) : (
        <span className={cx("flex items-center gap-1.5 text-xs text-fg-muted")}>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin text-accent" />
          Validating against {message.meta?.evidence_count ?? "the"} evidence items…
        </span>
      )}
    </div>
  );
}
