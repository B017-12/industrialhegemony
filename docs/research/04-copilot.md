# 04 Copilot research (Tab 4)

These are the time-boxed research notes for the backend and the grounded copilot. Each section ends with the decision it drove.

## 1. The workbook's own rules

The rules come from `data/valmet.db`, summarised with a short sqlite query; the full sheets were never loaded.

| Source | Rule (verbatim or near-verbatim) | Decision |
|---|---|---|
| `Knowledge_Docs` DOC-RAG-GUIDE | "Name the asset, cite telemetry/events/doc IDs, state confidence, distinguish observation from hypothesis, and propose the next safe verification step." | The response schema keeps `observations` and `hypotheses` separate, and every line carries `evidence_ids`. `confidence` is always present, and `next_safe_checks` is required. |
| `Knowledge_Docs` DOC-FIELD-SAFETY | "The assistant must not replace site procedures, lockout/tagout, permits, OEM instructions or qualified personnel. Recommend verification and escalation rather than autonomous physical action." | Every answer gets a safety check line that cites DOC-FIELD-SAFETY. The system prompt forbids instructions for physical action. Work orders are drafts only. |
| `Knowledge_Docs` DOC-3D-MAPPING | "Map visible objects to stable asset IDs with explicit confidence ... Never silently guess identity." | A `MAP:<asset>` evidence item carries the scene binding (`object_id`, `mapping_method`, `mapping_confidence`). Confidence is capped by mapping method, and a caveat always names the procedural binding. |
| `API_Contract` | 8 routes: `GET /api/assets`, `/api/assets/{id}`, `/api/assets/{id}/telemetry`, `/api/assets/{id}/events`, `/api/assets/{id}/documents` (RAG_Corpus_Index), `/api/scene/anchors`, `POST /api/copilot/query`, `POST /api/work-orders/draft` ("Draft only; no real control actions") | All 8 are implemented, plus health, scene objects, nav, search and the SSE stream. |
| `Builder_Questions` | Q-03 "Explain every diagnosis with exact evidence IDs and confidence" (P0). Q-06 "Reduce confidence when sensor or mapping quality is poor" (P0). Q-01 and Q-05 (device to evidence to case to work order) are P0. | The validators enforce the IDs, and the confidence is computed in code with listed reasons. Data-quality issues and mapping method lower it. The routes cover the Q-05 chain. |

Data shapes that matter for ASSET-014 / P-002:

- **Current state.** `Current_State` has `model_confidence 0.68`, `issue_code CAVITATION_RISK`, `recommended_next_check "inspect process conditions"` and `knowledge_doc_id DOC-PROCESS_PUMP-CORE`.
- **Events.** `Alarms_Events` has 39 events for ASSET-014, 14 of them `open`. The three newest are `EVT-00425` (closed), `EVT-00893` (open) and `EVT-00900` (closed). The old code cited exactly those three, so it missed `EVT-00136`.
  - Ordering by status (open, then acknowledged, then closed), then by matching the current `issue_code`, then newest first gives `EVT-00893` and then `EVT-00136`. Both are open `CAVITATION_RISK` events on 2026-10-05.
- **Data quality.** `Data_Quality` has `DQ-0064` (medium, timestamp_jitter) and `DQ-0098` (high, stale_document_link, "request_user_confirmation").
- **Telemetry.** `Telemetry_Sample_3d` holds 144 samples per asset, every 30 minutes from 2026-10-05 to 2026-10-07.
- **Documents.** `RAG_Corpus_Index` has 38 rows: asset cards plus class documents.

## 2. Grounded generation and citation validation

- **Cognite Atlas AI** (https://www.cognite.com/en/product/atlas, https://docs.cognite.com/cdf/atlas_ai/concepts/atlas_ai_agent_debugging): "Agents cite the exact data behind every response, so your teams can verify every answer before acting on it." Citations are built into every response, and a reasoning trace shows which tools ran. Cognite also states that safety-critical decisions are "not suitable for a fully autonomous agent".
  - Decision: every claim carries explicit evidence IDs that resolve to a record in the `evidence` array. The response also carries `generation` metadata (`llm`, `deterministic`, `deterministic_fallback` or `cached`) and the validator report, which act as our trace.
- **Attribution in RAG.** The common pattern (ALCE / attributed QA) has the model cite source IDs and a post-hoc checker that rejects unsupported citations. Pure LLM self-checking is unreliable, so we use a cheap deterministic check:
  1. Every cited ID must exist in the evidence bundle given to the model. This is a closed-world check.
  2. Every number in the answer text must appear in the bundle within rounding tolerance. This catches the most dangerous hallucination in maintenance answers: invented readings.
  - Decision: on validation failure, retry once with the validator errors appended, then fall back to the deterministic template. The fallback is labelled `deterministic_fallback`, so the UI can show a badge.
- **Confidence.** It is computed in code, not by the model, so it can't be talked up. The steps:
  - start from the workbook's `model_confidence`;
  - subtract 0.08 for each high-severity data-quality issue on the asset (at most 2) and 0.03 for each medium one;
  - cap at 0.5 for `procedural_demo_target` or `procedural_class_match`, and 0.25 for `procedural_fallback`, from the Tab 2 mapping methods;
  - list every adjustment as a reason. This follows Builder_Questions Q-06.

## 3. OpenAI Structured Outputs

Source: https://developers.openai.com/api/docs/guides/structured-outputs (fetched 2026-11-07).

- **Python SDK.** Pass a Pydantic model and read the parsed result:

  ```python
  client.responses.parse(model=..., input=[...], text_format=Model)
  response.output_parsed
  ```
- **Strict schemas** require these rules:
  - `additionalProperties: false` on every object;
  - every field must be required (optional fields are emulated with a union with `null`);
  - the root must be an object, not `anyOf`;
  - nesting depth and size are limited.
- **Refusals** are programmatically detectable. A refusal or a `max_output_tokens` cutoff leaves `output_parsed` empty, which must be handled.
- **Models.** The current docs' examples use `gpt-6-astra`. Structured Outputs with `json_schema` works on `gpt-4o-mini`, `gpt-4o-2024-08-06` and later.
- **Decisions:**
  - The model is set by `OPENAI_MODEL`. The default is `gpt-6.1-terra`; it was `gpt-6-astra` until Tab 7.
    - The OpenAI pricing page (fetched 2026-11-07, https://developers.openai.com/api/docs/pricing) lists astra at $10 / $50 per 1M input/output tokens, terra at $1 / $5 and luna at $0.10 / $0.50.
    - A diagnosis prompt is about 6k tokens in and 1k out, so terra costs about $0.01 per call, against about $0.11 for astra.
    - Terra is the mid tier of the current generation, which balances cost and quality for a citation-heavy, number-checked answer. Set `OPENAI_MODEL=gpt-6-luna` for the cheapest option.
    - A model that rejects the strict schema only causes the cached or template fallback.
  - The schema is a flat Pydantic model: {summary, observations[{text, evidence_ids}], hypotheses[{text, evidence_ids}], next_safe_checks[], caveats[]}. Every field is required, which meets the strict-mode rules.
  - `openai` is imported lazily inside `llm.py`. If the package is missing, `OPENAI_API_KEY` is unset, or the call raises (network, refusal, timeout), the copilot uses the deterministic template. No route fails because of the LLM.
  - Gemini was considered (response schema support is similar). OpenAI was chosen because the handoff names it first and its strict mode guarantees schema adherence.

## 4. Streaming with FastAPI

Sources: https://fastapi.tiangolo.com/tutorial/server-sent-events/, https://fastapi.tiangolo.com/reference/sse/ and https://github.com/fastapi/fastapi/pull/15030.

- FastAPI 0.135.0 and later (we have 0.135.1) has built-in SSE support: `from fastapi.sse import EventSourceResponse, ServerSentEvent`.
  - A path operation that uses `yield` with `response_class=EventSourceResponse` works for both GET and POST.
  - It sends keep-alive pings and `Cache-Control: no-cache` automatically.
  - `ServerSentEvent(data=..., event=...)` sets named events; `raw_data` sends values without JSON encoding.
- The browser's `EventSource` only supports GET. For a POST chat stream the frontend reads `fetch().body` with a stream reader (the same wire format).
- **Decisions:**
  - `POST /api/copilot/stream` emits named events: `meta` (mode and generation), `delta` (text chunks), then `answer` (the full validated response JSON), then `done`.
  - The final answer is only sent after validation, so the UI never shows an unvalidated answer as final.
  - The `delta` events carry word chunks of the validated summary in both LLM and no-key modes. Live Structured Outputs tokens would be raw JSON fragments that can't be validated until the answer is complete. This costs a short wait before the first chunk (decided 2026-11-07, Phase 3).
  - No `sse-starlette` dependency is needed.

## 5. Other decisions

- **Startup.** `@app.on_event("startup")` is deprecated, so the app uses a `lifespan` async context manager. It imports the workbook only if the database is missing or older than the workbook, instead of on every start. A forced re-import is `python3 -m app.importer --force`.
- **Offline demo.** The ASSET-014 arrival diagnosis is written to `backend/cache/ASSET-014_arrival_diagnosis.json` after every successful validated generation. If a live LLM call fails, the cached answer is served with `cached: true`.
