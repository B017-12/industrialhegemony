# 04 Backend and grounded copilot (Tab 4)

**Status: Done (Phases 1-3).** `python3 -m pytest` passes 93 tests in about 10 s with no network. Without a key, the ASSET-014 diagnosis cites `EVT-00893`, `EVT-00136`, `CASE-022`, `CASE-026`, `CASE-049`, `DQ-0098` and `DQ-0064`, passes validation and has confidence 0.5.

## 1. Outcome

- **Backend structure.** The backend is a package of modules with a `lifespan` startup handler and Pydantic response models on every route.
  - Every `API_Contract` route is implemented, plus telemetry, events, documents, search, scene anchors, nav `?target=` and `POST /api/copilot/stream`.
- **Evidence.** Events are ordered open first, then by matching the current issue code, then newest first. Evidence IDs are stable (`TEL:ASSET-014:vibration_mm_s`, `BASELINE:PROCESS_PUMP:vibration_mm_s`, `MAP:ASSET-014`, and so on), and the numbers are carried in `values`.
- **Three copilot modes**, each with a deterministic template:
  - `arrival_diagnosis`;
  - `status_line`, for example "P-002 attention: vibration 4.57 mm/s vs 2.08 healthy, cavitation risk.";
  - `question`, which routes by keyword over events, telemetry, cases, work orders, data quality, mapping and safety.
- **Optional LLM path.** It uses OpenAI Structured Outputs through `client.responses.parse(text_format=LlmAnswer)`, with the model from `OPENAI_MODEL` (the default was `gpt-6-astra`; Tab 7 changed it to the cheaper `gpt-6.1-terra`). It is inactive until `OPENAI_API_KEY` is set and never breaks a route.
- **Validator.** It checks three things:
  - every cited ID is in the bundle;
  - evidence-like IDs mentioned in the prose are in the bundle;
  - every number in the prose matches an evidence number within half a unit of its last decimal, or within 1%.
  - On failure, the LLM is retried once with the errors appended. After that the cache is used, then the template.
- **Confidence** is computed in code with one reason per step. ASSET-014: 0.68 - 0.08 (DQ-0098 high) - 0.03 (DQ-0064 medium) = 0.57, capped to 0.5 by `procedural_demo_target`.
- **Metadata.** Every response carries `generation` (`llm`, `deterministic`, `deterministic_fallback` or `cached`), `cached`, `model` and `validation {ok, errors, attempts}`.
- **Offline cache.** `backend/cache/ASSET-014_arrival_diagnosis.json` is pre-generated, so the demo works offline even when a key is configured but the network is down.
- **SSE.** `POST /api/copilot/stream` emits `meta`, then `delta` events (word chunks of the validated summary), then `answer` and `done`. Nothing unvalidated is streamed.
- **Work-order draft.** It maps to Maintenance_History columns, with `status: "draft"`, `maintenance_type: "predictive"` and priority taken from urgency.

## 2. Changes

Phase 3 (this session):
- `backend/app/llm.py` (new):
  - `LlmClaim` and `LlmAnswer` (strict schema, all fields required, `extra="forbid"`);
  - `enabled()`, `model_name()`, `build_input()`;
  - `generate()`, which imports `openai` lazily and returns None on a missing key, an exception, a refusal or an empty parse.
  - The system prompt holds the DOC-RAG-GUIDE and DOC-FIELD-SAFETY rules plus "cite only given IDs; use only numbers present in evidence".
- `backend/app/validators.py`: adds `citation_errors`, `mention_errors`, `number_errors`, `extract_numbers`, `allowed_numbers` and `validate()`, which returns `{ok, errors}`. `validate_citations` is kept.
- `backend/app/confidence.py` (new): `compute(current, data_quality, binding)`.
- `backend/app/cache.py` (new): `load`, `save` (atomic write), `warm` and a CLI, `python3 -m app.cache --warm ASSET-014`.
- `backend/app/copilot.py` (rewritten):
  - the templates `_arrival`, `_status_line` and `_question`;
  - `deterministic_response()`;
  - `_respond()`, which runs the LLM, validation, retry, cache and fallback;
  - `answer()`;
  - `work_order_draft()`, which is now mapped.
  - The arrival template adds a data-quality observation that cites the `DQ-*` IDs, and wording for healthy assets: "CV-001 is healthy with no active issue code (health score 96); no fault hypothesis is raised."
- `backend/app/models.py`:
  - `CopilotQuery.mode` is a `Literal` of the 3 modes;
  - `question` mode without a question returns 422;
  - `CopilotResponse` adds `question`, `generation`, `cached`, `model` and `validation`;
  - there are new `Validation` and `WorkOrderDraft` models;
  - `WorkOrderDraftResponse` adds `generation` and `confidence`.
- `backend/app/routes/copilot.py`: adds `POST /api/copilot/stream` (`fastapi.sse.EventSourceResponse`). A `known_asset` dependency returns 404 before the stream starts.
- `backend/cache/ASSET-014_arrival_diagnosis.json` (new, generated). The workspace is not a git repo, so the file is on disk only.
- `backend/tests/` (new): `conftest.py`, `test_importer.py`, `test_routes.py`, `test_evidence.py`, `test_validators.py`, `test_copilot.py`. Also new: `backend/pytest.ini`.
- `backend/requirements.txt`: adds `openai`, `pytest` and `httpx`. `openai` 3.46.0 is installed in pyenv 3.10.13.
- `backend/README.md`: run, environment variables, cache and tests.
- `docs/contracts.md`: the copilot section is rewritten (modes, `generation`, `validation`, confidence, the stream, the draft shape), and the route table adds the stream.
- `docs/research/04-copilot.md`: the SSE decision is updated so deltas are validated word chunks in both modes.

Phases 1-2 (earlier sessions):
- `main.py` (lifespan, 404 handlers, health);
- the new modules `config.py`, `importer.py`, `db.py`, `errors.py`, `artifacts.py`, `scene_index.py`, `telemetry.py` and `evidence.py`;
- `routes/` (`assets`, `scene`, `search`, `copilot`, `work_orders`);
- the Backend API section of `docs/contracts.md`.

## 3. How to run and verify

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 -m app.importer                                  # "up to date: .../data/valmet.db"
python3 -m uvicorn app.main:app --reload --port 8000     # http://localhost:8000/docs
python3 -m pytest                                        # 93 passed
```

Expected results:

- **Arrival diagnosis.** Run `curl -X POST localhost:8000/api/copilot/query -H 'content-type: application/json' -d '{"asset_id":"ASSET-014"}'`. It returns:
  - `generation: "deterministic"`;
  - `validation: {ok: true, errors: [], attempts: 0}`;
  - `confidence.score: 0.5` with 4 reasons;
  - 5 observations: vibration, flow and pressure trends against the healthy baseline; open events `EVT-00893` and `EVT-00136`; and `DQ-0098`/`DQ-0064`;
  - 1 hypothesis citing `CASE-026`, `CASE-049` and `CASE-022`.
- **Status line.** `... -d '{"asset_id":"ASSET-014","mode":"status_line"}'` has the summary "P-002 attention: vibration 4.57 mm/s vs 2.08 healthy, cavitation risk."
- **Question.** `... -d '{"asset_id":"ASSET-014","mode":"question","question":"which events are open?"}'` cites `EVENTS:ASSET-014:summary` and the top 3 events. Without `question`, it returns 422.
- **Stream.** `curl -N -X POST localhost:8000/api/copilot/stream -H 'content-type: application/json' -d '{"asset_id":"ASSET-014","mode":"status_line"}'` prints `event: meta`, 10 `event: delta` lines, `event: answer` and `event: done`.
- **Fallback with a key.** With `OPENAI_API_KEY=sk-fake` and no network, the arrival diagnosis returns `generation: "cached"`, `cached: true` in about 2 s, and `status_line` returns `deterministic_fallback`.
- **Earlier routes.** The checks from Phases 1-2 still hold: events, telemetry, nav `?target=`, anchors and search all return the same results as before.

If running `uvicorn` from an agent sandbox, `pkill` is blocked. Stop the server with the PID from its "Started server process [PID]" log line.

## 4. Contract changes

All are in `docs/contracts.md`, under Backend API.

- **New route:** `POST /api/copilot/stream`.
- **Copilot requests:**
  - `mode` is now validated. An unknown mode returns 422 (before, it silently returned the diagnosis).
  - `question` mode requires `question`.
  - The web app only sends `arrival_diagnosis`, so it is unaffected.
- **Copilot responses** add `question`, `generation`, `cached`, `model` and `validation`.
  - The confidence formula changed: ASSET-014 goes from 0.42 to 0.5, and the reasons are per step.
  - `caveats` now names the bound object and mapping method.
- **Work-order draft:**
  - `draft` adds `asset_id`, `tag`, `area_name`, `action`, `maintenance_type`, `role`, `knowledge_doc_id`, `status` and `note`;
  - `priority` is now derived from urgency (`high`/`medium`/`low`);
  - the response adds `generation` and `confidence`;
  - `title`, `summary`, `safe_checks` and `evidence_ids` are kept.
- **Phases 1-2 (unchanged):**
  - the additive asset and health fields;
  - the telemetry, events, documents, anchors and search routes;
  - nav `?target=`;
  - the stable evidence IDs.

## 5. Research used

The full notes are in `docs/research/04-copilot.md`.

| Source | Decision |
|---|---|
| Workbook DOC-RAG-GUIDE, DOC-FIELD-SAFETY, DOC-3D-MAPPING; Builder_Questions Q-03 and Q-06 | Observations and hypotheses are kept separate and every claim cites IDs. Each answer has a safety check citing DOC-FIELD-SAFETY and a `MAP:` evidence item. Confidence is computed in code and lowered for data quality and mapping. |
| Cognite Atlas AI docs (citations on every response, reasoning trace) | Closed-world evidence IDs, with `generation` and `validation` as the trace. |
| ALCE / attributed-QA pattern | A post-hoc deterministic checker (IDs plus numbers) instead of LLM self-checking; retry once, then fall back. |
| OpenAI Structured Outputs guide (fetched 2026-11-07) | `responses.parse(text_format=LlmAnswer)`, then `output_parsed`. In strict mode all fields are required and `additionalProperties` is false; `to_strict_json_schema(LlmAnswer)` was verified offline. Refusal or an empty parse is treated as a failure. |
| FastAPI SSE docs (0.135+, installed 0.135.1) | `fastapi.sse.EventSourceResponse` / `ServerSentEvent` from a sync generator on a POST route; no `sse-starlette`. |

## 6. Evidence

- **pytest: 93 passed in about 8-10 s.** They cover:
  - the importer: a fresh temp DB gets 16 sheets, and the live DB has 16 tables;
  - 13 GET routes;
  - the 3 copilot modes, the stream and the draft;
  - 8 cases that return 404 and 8 that return 422;
  - ASSET-014 evidence selection and citations;
  - validator acceptance and rejection: a fake ID in `evidence_ids` and in the prose, a claim with no citation, 9.99 mm/s rejected, the rounding rule (4.6 accepted, 4.8 rejected), and IDs and dates ignored;
  - the deterministic templates for 9 queries on each of the 30 assets, all of which pass the validator;
  - the LLM paths with a monkeypatched `generate`: a valid answer gives `llm` and writes the cache; invalid then valid gives `llm` with `attempts: 2`; invalid twice gives `deterministic_fallback`; invalid twice or unavailable with a cache file gives `cached`; `status_line` is never cached;
  - the confidence caps and penalties;
  - the committed cache file still validating against the current evidence.
- **Deprecations.** `python3 -W error::DeprecationWarning -m pytest -p no:asyncio` passes.
- **Real SDK failure path.** With `OPENAI_API_KEY=sk-fake` and no network, the client logs "LLM call failed: Connection error." and the routes return the cached or fallback answer.
- **ASSET-014 evidence: 40 items.**
  - `ASSET`, `STATE`, `MAP`;
  - 7 `TEL:` and 7 `BASELINE:` items;
  - `EVENTS:summary` and 8 events;
  - 5 work orders and 3 cases;
  - 2 data-quality issues;
  - 4 documents.
  - The partial note said 41; the correct count is 40.
- **Key numbers:**
  - vibration 2.42 to 4.57 mm/s, against a healthy average of 2.08 (band 1.83 to 2.34);
  - flow 83.06% to 76.17%, against 83.9%;
  - pressure 4.52 to 4.04 bar, against 4.6.
- **Copilot timings** (TestClient, warm, no key): query 59-66 ms, stream 72 ms, draft 58 ms.

## 7. Known issues and limitations

- **The LLM path has never been called against the real API**, because no key was available. It is covered by fakes, offline strict-schema conversion and the real SDK's connection-error path.
  - The first live run should check that `gpt-6-astra` accepts the schema.
  - It should also check how often the number validator rejects good paraphrases. For example, the model may compute a new percentage; the prompt forbids this.
- **What the number validator does not catch:**
  - it skips ordinals and alphanumeric tokens (`10th`, `3D`);
  - it compares absolute values, so a wrong sign ("fell by 4.57") is not caught;
  - small integers match loosely, since 3 matches anything from 2.5 to 3.5.
- **Cache behaviour:**
  - only validated **LLM** arrival diagnoses overwrite the cache; no-key requests never write it, so a good LLM answer is not replaced by the template;
  - the cache is validated against the current evidence before it is served, so a stale file falls through to the template;
  - only ASSET-014 is pre-warmed.
- **No LLM token streaming.** The stream sends validated word chunks after the full answer exists, so with a key the first chunk arrives after the LLM call (seconds). This was chosen on purpose.
- **`question` mode is keyword-only without a key.** Plant-wide questions still need an `asset_id`. A question that matches no topic returns the arrival diagnosis with a note.
- **Asset cards are empty.** The 30 asset cards (`DOC-ASSET-*`) have no content in the workbook.
- **Search is keyword-only.**
- **pytest-asyncio.** The pyenv has `pytest-asyncio` installed, which raises its own deprecation warning under `-W error`; hence `-p no:asyncio`.

## 8. Notes for the next tabs

### Tab 5 and Tab 7 (UI)
- **Asset data.** Use `/api/assets` (it includes `scene_object_id` and `mapping_method`), `/api/assets/{id}`, `/api/assets/{id}/telemetry` (`series`, `trends`, and `baselines.p10`/`p90` for the band) and `/api/assets/{id}/events`.
- **HUD cards.** `POST /api/copilot/query` with `mode: "status_line"` gives one sentence in `summary`, about 60 ms each without a key. Fetch it per asset as the robot passes, and cache it client-side.
- **Arrival.** `mode: "arrival_diagnosis"` (or the stream) gives the full report.
  - Show `confidence.score` with `confidence.reasons`.
  - Badge `generation` when it is `cached` or `deterministic_fallback`.
  - `validation.errors` can go in a "trace" disclosure.
- **Chat.** `POST /api/copilot/stream` with `mode: "question"`. Read it with `fetch()` and a stream reader (`EventSource` is GET-only). Append the `delta` text, then replace it with the `answer` event.
  - Suggested questions can come from `Builder_Questions`.
  - Keyword topics that work offline: events/alarms, vibration/flow/pressure/trend, cases/why/cause, maintenance/service, data quality/trust, where/3D/scene, safety.
- **Evidence chips.** They resolve any ID through the response's `evidence[]` (`text`, `record`, `values`).
- **Work orders.** The draft route is display-only (`status: "draft"`); never present it as submitted.

### Tab 6 (mission)
- "Dispatch to [asset]" can call `/api/scene/nav?target=<asset>`.
- Disable the dispatch button when `reachable` is false and show `distance_to_walkable_m`.

### Tab 8 (labels)
- The backend already merges `labels_override.json` into bindings (`scene_index.py`). A `PATCH` route for overrides is not built yet; add it in `backend/app/routes/scene.py` if needed.
- After relabelling, the copilot picks up the new binding automatically: `MAP:` evidence and the confidence cap follow `mapping_method`.

### Turning the LLM on
- Run `export OPENAI_API_KEY=...`, and optionally `OPENAI_MODEL=...`, then restart uvicorn.
- Check `generation: "llm"` on ASSET-014. Each validated arrival diagnosis overwrites `backend/cache/ASSET-014_arrival_diagnosis.json`; the file's `source_generation` field shows `llm`.
