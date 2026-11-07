"""Grounded copilot: Pydantic AI agent over the evidence pack, with deterministic confidence and
citation validation. Model is configured by env LLM_MODEL (e.g. "google:<model id from AI Studio>");
without a model/key, or on any LLM error, the deterministic fallback answers instead.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

from pydantic_ai import Agent, ModelRetry, RunContext

from backend.ai.evidence import build_evidence, evidence_ids_in
from backend.ai.fallback import fallback_draft
from backend.ai.schema import Claim, CopilotAnswer, CopilotDraft
from pipeline.excel import PackStore

log = logging.getLogger(__name__)

INSTRUCTIONS = """You are a field-service copilot for an industrial plant (synthetic Valmet builder data).
Follow the evidence-grounded response contract (DOC-RAG-GUIDE):
- name the asset; cite exact evidence IDs (EVT-, WO-, CASE-, DQ-, DOC-, ASSET-, TELEMETRY:<signal>) on every claim;
- observations = facts read from the evidence; hypotheses = possible explanations, phrased as evidence, not proof;
- propose only inspection / verification steps. Never instruct control actions, never replace lockout/tagout,
  permits, OEM instructions or qualified personnel (DOC-FIELD-SAFETY);
- the 3D object-to-asset mapping is procedural: say identity must be confirmed on site (DOC-3D-MAPPING);
- use only IDs present in the evidence pack or returned by tools. Do not invent numbers.
Keep it short: <= 5 observations, <= 3 hypotheses, <= 6 checks."""


@dataclass
class Deps:
    store: PackStore
    pack: dict
    registry: dict


def _check(ctx: RunContext[Deps], asset_id: str) -> None:
    if asset_id not in ctx.deps.store.asset_ids():
        raise ModelRetry(f"Unknown asset_id {asset_id!r}; use find_asset first (IDs look like ASSET-017).")


def _make_agent(model: str) -> Agent[Deps, CopilotDraft]:
    agent = Agent(model, deps_type=Deps, output_type=CopilotDraft, instructions=INSTRUCTIONS, retries=2)

    @agent.tool
    def find_asset(ctx: RunContext[Deps], query: str) -> list[dict]:
        """Find assets by ID, tag or class substring (e.g. 'P-005', 'pump')."""
        q = query.lower()
        return [c for c in ctx.deps.store.asset_cards()
                if q in c["asset_id"].lower() or q in c["tag"].lower() or q in c["asset_class"].lower()][:10]

    @agent.tool
    def get_state(ctx: RunContext[Deps], asset_id: str) -> dict:
        """Current_State row for an asset."""
        _check(ctx, asset_id)
        return ctx.deps.store.asset(asset_id)["state"]

    @agent.tool
    def get_telemetry(ctx: RunContext[Deps], asset_id: str, last_n: int = 12) -> list[dict]:
        """Most recent telemetry rows (30-min interval) for an asset."""
        _check(ctx, asset_id)
        df = ctx.deps.store.telemetry(asset_id, last_n=min(last_n, 48))
        return json.loads(df.to_json(orient="records", date_format="iso"))

    @agent.tool
    def get_events(ctx: RunContext[Deps], asset_id: str, event_code: str | None = None, limit: int = 10) -> list[dict]:
        """Recent alarms/events for an asset, optionally filtered by event_code."""
        _check(ctx, asset_id)
        df = ctx.deps.store.events(asset_id)
        if event_code:
            df = df[df["event_code"] == event_code]
        return json.loads(df.head(limit).to_json(orient="records", date_format="iso"))

    @agent.tool
    def search_docs(ctx: RunContext[Deps], query: str) -> list[dict]:
        """Keyword search over Knowledge_Docs and Historical_Service_Cases."""
        words = [w for w in query.lower().split() if len(w) > 2]
        hits = []
        for d in ctx.deps.store.tables["Knowledge_Docs"].to_dict(orient="records"):
            text = f"{d['title']} {d['content']} {d['scope']}".lower()
            if any(w in text for w in words):
                hits.append({"doc_id": d["doc_id"], "title": d["title"], "content": d["content"]})
        for c in ctx.deps.store.tables["Historical_Service_Cases"].to_dict(orient="records"):
            text = f"{c['historical_issue_code']} {c['historical_interpretation']} {c['asset_class']}".lower()
            if any(w in text for w in words):
                hits.append({k: c[k] for k in ("case_id", "asset_class", "historical_issue_code",
                                               "historical_interpretation", "recommended_next_check")})
        return hits[:12]

    @agent.tool
    def route_between(ctx: RunContext[Deps], asset_id: str) -> dict:
        """Walking route summary (rail-following, collision-checked) from the entrance to the asset's 3D object."""
        reg = ctx.deps.registry
        entry = next((e for e in reg.get("entries", []) if e["asset_id"] == asset_id), None)
        if not entry:
            return {"error": f"{asset_id} is not bound to a 3D object"}
        if reg.get("target", {}).get("asset_id") == asset_id and reg.get("path"):
            p = reg["path"]
            return {"object_id": entry["object_id"], "length_m": p["length_m"], "checks": p["checks"],
                    "binding_lr_imbalance_m": p["metrics"]["binding_lr_imbalance_m"]}
        return {"object_id": entry["object_id"], "note": "route is computed on demand for the target only in v0"}

    return agent


def configured_model() -> str | None:
    model = os.getenv("LLM_MODEL", "").strip()
    if not model:
        return None
    if model.startswith("google") and not (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")):
        return None
    return model


def answer(store: PackStore, asset_id: str, question: str | None, registry: dict, mapping: dict | None) -> CopilotAnswer:
    pack = build_evidence(store, asset_id, mapping)
    valid = store.evidence_ids() | evidence_ids_in(pack)
    model = configured_model()
    draft, mode = None, "fallback"
    if model:
        try:
            prompt = (f"Question: {question or 'Diagnose this asset and recommend the next safe inspection steps.'}\n\n"
                      f"Evidence pack (JSON):\n{json.dumps(pack, default=str)}")
            result = _make_agent(model).run_sync(prompt, deps=Deps(store, pack, registry))
            draft, mode = result.output, "llm"
        except Exception as exc:  # noqa: BLE001 — any LLM failure falls back to the deterministic answer
            log.warning("LLM copilot failed, using fallback: %s", exc)
    if draft is None:
        draft = fallback_draft(pack, question)
    draft, removed = _validate_citations(draft, valid)
    cited = sorted({i for c in draft.observations + draft.hypotheses for i in c.evidence_ids})
    safety = next((d["content"] for d in pack["documents"] if d["doc_id"] == "DOC-FIELD-SAFETY"), "")
    return CopilotAnswer(
        **draft.model_dump(),
        asset_id=asset_id,
        tag=pack["asset"]["tag"],
        confidence=pack["confidence"],
        confidence_rationale=pack["confidence_rationale"],
        safety_note=f"{safety} (DOC-FIELD-SAFETY)",
        citations=cited,
        removed_citations=removed,
        mode=mode,
        model=model if mode == "llm" else None,
    )


def _validate_citations(draft: CopilotDraft, valid: set[str]) -> tuple[CopilotDraft, list[str]]:
    removed: set[str] = set()

    def clean(claims: list[Claim]) -> list[Claim]:
        out = []
        for c in claims:
            keep = [i for i in c.evidence_ids if i in valid]
            removed.update(set(c.evidence_ids) - set(keep))
            out.append(Claim(text=c.text, evidence_ids=keep))
        return out

    return draft.model_copy(update={"observations": clean(draft.observations),
                                    "hypotheses": clean(draft.hypotheses)}), sorted(removed)
