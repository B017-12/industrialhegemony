# Backend

FastAPI and SQLite service for the Excel assets, scene objects, navigation and the grounded copilot. The routes are documented in `../docs/contracts.md`, and interactive docs are at http://localhost:8000/docs.

## Run

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 -m app.importer                                  # imports the workbook only if data/valmet.db is missing or older
python3 -m uvicorn app.main:app --reload --port 8000
```

- `python3 -m app.importer --force` re-imports the workbook.
- The app also runs the same check at startup, in its `lifespan` handler.

## Copilot and the LLM

- **Without a key** (the default and the demo mode), the copilot uses deterministic templates. Every answer is still validated and cited.
- **With `OPENAI_API_KEY` set**, it calls OpenAI Structured Outputs. Every answer is validated, a failure is retried once, then the cache or the template is used. No route fails because of the LLM.
- **Offline cache.** `backend/cache/ASSET-014_arrival_diagnosis.json` is pre-generated so the demo works offline. Each validated LLM arrival diagnosis overwrites it. To regenerate it from the template, run `python3 -m app.cache --warm ASSET-014`. Several asset IDs can be given.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | unset | Enables the LLM path |
| `OPENAI_MODEL` | `gpt-6.1-terra` | Model for `responses.parse`. Terra is about $0.01 per diagnosis; `gpt-6-luna` is about 10x cheaper; `gpt-6-astra` is about 10x dearer |
| `OPENAI_TIMEOUT_S` | `30` | Per-call timeout |
| `VALMET_WORKBOOK` | the `.xlsx` in the repo root | Workbook to import |
| `VALMET_DB` | `data/valmet.db` | SQLite database |
| `VALMET_CACHE_DIR` | `backend/cache` | Copilot answer cache |

## Tests

```bash
cd backend
python3 -m pytest                                        # 93 tests, about 10 s, no network
python3 -W error::DeprecationWarning -m pytest -p no:asyncio
```

- The tests never call OpenAI; the LLM path is exercised with a monkeypatched `llm.generate`.
- They write the cache only to a temporary directory.
- `-p no:asyncio` is only needed if the `pytest-asyncio` plugin is installed: that plugin raises its own deprecation warning.
