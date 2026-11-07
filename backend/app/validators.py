from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from typing import Any

CLAIM_SECTIONS = ("observations", "hypotheses")
TEXT_LIST_SECTIONS = ("next_safe_checks", "caveats")

ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?")
IDENTIFIER = re.compile(r"\b[A-Za-z][A-Za-z0-9_]*(?:[-:][A-Za-z0-9_]+)+\b")
NUMBER = re.compile(r"(?<![\w.\-+])[+-]?\d+(?:\.\d+)?(?!\w|\.\d)")


def citation_errors(response: dict[str, Any], evidence: list[dict[str, Any]]) -> list[str]:
    known = {item["id"] for item in evidence}
    errors = []
    for section in CLAIM_SECTIONS:
        for i, item in enumerate(response.get(section, [])):
            if not item.get("evidence_ids"):
                errors.append(f"{section}[{i}] cites no evidence IDs")
            missing = [eid for eid in item.get("evidence_ids", []) if eid not in known]
            if missing:
                errors.append(f"{section}[{i}] cites unknown evidence IDs {missing}")
    return errors


def validate_citations(response: dict[str, Any]) -> None:
    errors = citation_errors(response, response["evidence"])
    if errors:
        raise ValueError("; ".join(errors))


def _texts(response: dict[str, Any]) -> Iterator[tuple[str, str]]:
    yield "summary", str(response.get("summary") or "")
    for section in CLAIM_SECTIONS:
        for i, item in enumerate(response.get(section, [])):
            yield f"{section}[{i}]", str(item.get("text") or "")
    for section in TEXT_LIST_SECTIONS:
        for i, text in enumerate(response.get(section, [])):
            yield f"{section}[{i}]", str(text)


def _strip(text: str) -> str:
    text = ISO_DATE.sub(" ", text)
    return IDENTIFIER.sub(" ", text)


def extract_numbers(text: str) -> list[str]:
    """Standalone numbers in prose, ignoring dates and identifiers such as P-002, ASSET-014 or 3D."""
    return NUMBER.findall(_strip(text))


def _numeric_leaves(value: Any) -> Iterator[float]:
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        yield float(value)
    elif isinstance(value, dict):
        for v in value.values():
            yield from _numeric_leaves(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _numeric_leaves(v)


def allowed_numbers(evidence: list[dict[str, Any]], extra: Iterable[float] = ()) -> set[float]:
    allowed = {abs(float(n)) for item in evidence for n in extract_numbers(item.get("text") or "")}
    allowed.update(abs(v) for item in evidence for v in _numeric_leaves(item.get("values")))
    allowed.update(abs(float(v)) for v in extra)
    return allowed


def _tolerance(token: str) -> float:
    digits = token.split(".", 1)[1] if "." in token else ""
    return max(0.5 * 10 ** -len(digits), 0.01 * abs(float(token)))


def number_matches(token: str, allowed: set[float]) -> bool:
    value = abs(float(token))
    tol = _tolerance(token)
    return any(abs(value - a) <= tol for a in allowed)


def number_errors(response: dict[str, Any], evidence: list[dict[str, Any]], extra: Iterable[float] = ()) -> list[str]:
    allowed = allowed_numbers(evidence, extra)
    errors = []
    for where, text in _texts(response):
        unsupported = [n for n in extract_numbers(text) if not number_matches(n, allowed)]
        if unsupported:
            errors.append(f"{where} uses numbers not found in the evidence: {unsupported}")
    return errors


def mention_errors(response: dict[str, Any], evidence: list[dict[str, Any]]) -> list[str]:
    """Evidence-like IDs written in the prose must exist in the bundle."""
    known = {item["id"] for item in evidence}
    prefixes = {re.split(r"[-:]", eid, maxsplit=1)[0] for eid in known}
    corpus = " ".join(item.get("text") or "" for item in evidence)
    errors = []
    for where, text in _texts(response):
        unknown = [
            tok for tok in IDENTIFIER.findall(ISO_DATE.sub(" ", text))
            if re.split(r"[-:]", tok, maxsplit=1)[0] in prefixes and tok not in known and tok not in corpus
        ]
        if unknown:
            errors.append(f"{where} mentions unknown IDs {unknown}")
    return errors


def validate(response: dict[str, Any], evidence: list[dict[str, Any]], extra_numbers: Iterable[float] = ()) -> dict[str, Any]:
    errors = [
        *citation_errors(response, evidence),
        *mention_errors(response, evidence),
        *number_errors(response, evidence, extra_numbers),
    ]
    return {"ok": not errors, "errors": errors}
