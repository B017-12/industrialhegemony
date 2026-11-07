from __future__ import annotations

import logging
import os
from typing import Any

from pydantic import BaseModel, ConfigDict

log = logging.getLogger("valmet.llm")

DEFAULT_MODEL = "gpt-6.1-terra"

SYSTEM_PROMPT = """You are the grounded maintenance copilot for an industrial plant digital twin.

Rules (DOC-RAG-GUIDE): name the asset, cite telemetry, event and document IDs, distinguish observation from hypothesis, and propose the next safe verification step.
Rules (DOC-FIELD-SAFETY): never replace site procedures, lockout/tagout, permits, OEM instructions or qualified personnel. Recommend verification and escalation, never autonomous physical action or control changes.

Grounding:
- Use only the evidence lines given. Cite only the evidence IDs given, exactly as written.
- Every observation and hypothesis must list the evidence_ids that support it.
- Use only numbers that appear in the evidence. Do not compute new numbers, percentages or counts.
- Observations are what the data shows. Hypotheses are possible causes, worded as hypotheses, not confirmed faults.
- Do not state a confidence score; it is computed separately.
- next_safe_checks must be verification steps; include one that cites DOC-FIELD-SAFETY in its text.
"""

MODE_INSTRUCTIONS = {
    "arrival_diagnosis": "Write a full arrival diagnosis for a technician who has just reached the asset.",
    "status_line": "Write the summary as ONE short sentence for a HUD card (under 20 words). Keep at most one observation and no hypotheses.",
    "question": "Answer the user's question about this asset from the evidence. If the evidence does not answer it, say so in the summary.",
}


class LlmClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    evidence_ids: list[str]


class LlmAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    observations: list[LlmClaim]
    hypotheses: list[LlmClaim]
    next_safe_checks: list[str]
    caveats: list[str]


def enabled() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def model_name() -> str:
    return os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL


def build_input(bundle: dict[str, Any], mode: str, question: str | None, errors: list[str] | None) -> list[dict[str, str]]:
    lines = [f"[{item['id']}] {item['text']}" for item in bundle["evidence"]]
    parts = [
        f"Mode: {mode}. {MODE_INSTRUCTIONS[mode]}",
        f"Asset: {bundle['asset'].get('tag')} ({bundle['asset'].get('asset_id')})",
    ]
    if question:
        parts.append(f"Question: {question}")
    parts.append("Evidence:\n" + "\n".join(lines))
    if errors:
        parts.append(
            "Your previous answer failed validation. Fix every error below and answer again:\n"
            + "\n".join(f"- {e}" for e in errors)
        )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


def generate(bundle: dict[str, Any], mode: str, question: str | None = None, errors: list[str] | None = None) -> LlmAnswer | None:
    """Structured answer from the model, or None when no key is set or anything goes wrong."""
    if not enabled():
        return None
    try:
        from openai import OpenAI

        client = OpenAI(timeout=float(os.environ.get("OPENAI_TIMEOUT_S", "30")), max_retries=1)
        response = client.responses.parse(
            model=model_name(),
            input=build_input(bundle, mode, question, errors),
            text_format=LlmAnswer,
        )
        parsed = response.output_parsed
        if parsed is None:
            log.warning("LLM returned no parsed output (refusal or truncation)")
        return parsed
    except Exception as exc:  # noqa: BLE001 - the LLM must never break a route
        log.warning("LLM call failed: %s", exc)
        return None
