from __future__ import annotations

import re
from collections import Counter
from typing import Any

from . import cache, confidence, llm
from .evidence import NO_ISSUE_CODES, evidence_bundle
from .models import CopilotQuery
from .telemetry import METRICS
from .validators import validate

KEY_METRICS = ("vibration_mm_s", "process_flow_pct", "process_pressure_bar")
SAFETY_CHECK = (
    "Follow site procedures, lockout/tagout and permits; the copilot does not replace qualified personnel (DOC-FIELD-SAFETY)."
)
URGENCY_PRIORITY = {"high": "high", "medium": "medium", "routine": "low"}
DEFAULT_ROLE = "field_technician"
DRAFT_NOTE = "Draft only, no control action. A qualified person must review it and release it in the maintenance system."
MAX_LLM_ATTEMPTS = 2

QUESTION_TOPICS: dict[str, tuple[str, ...]] = {
    "events": ("event", "alarm", "alert", "open", "incident"),
    "telemetry": (
        "telemetry", "trend", "sensor", "reading", "metric", "vibration", "flow", "pressure", "temperature",
        "current", "speed", "position", "pneumatic", "stiction", "signal", "bias", "load",
    ),
    "cases": ("case", "history", "historical", "similar", "cause", "why", "root"),
    "work_orders": ("work order", "maintenance", "service", "serviced", "repair", "wo"),
    "data_quality": ("quality", "stale", "trust", "reliab", "confidence", "jitter", "missing"),
    "mapping": ("where", "location", "locate", "3d", "scene", "map", "binding", "object"),
    "safety": ("safe", "safety", "lockout", "permit", "procedure"),
}


# Shared pieces

def _has_issue(current: dict[str, Any]) -> bool:
    return str(current.get("issue_code") or "").upper() not in NO_ISSUE_CODES


def _unit(metric: str) -> str:
    unit = METRICS[metric]["unit"]
    return f" {unit}" if unit else ""


def _key_metrics(trends: dict[str, Any]) -> list[str]:
    chosen = [m for m in KEY_METRICS if m in trends]
    if chosen:
        return chosen
    ranked = sorted(trends, key=lambda m: abs(trends[m]["delta_pct"] or 0), reverse=True)
    return ranked[:3]


def _trend_observation(asset_id: str, asset_class: str, trend: dict[str, Any], baseline: dict[str, Any] | None) -> dict[str, Any]:
    meta = METRICS[trend["metric"]]
    unit = _unit(trend["metric"])
    verb = "rose" if trend["delta"] > 0 else "fell" if trend["delta"] < 0 else "held"
    text = f"{meta['label']} daily mean {verb} from {trend['first_day_mean']} to {trend['last_day_mean']}{unit}"
    ids = [f"TEL:{asset_id}:{trend['metric']}"]
    if baseline:
        text += f", against a healthy {asset_class} average of {baseline['mean']}{unit}"
        ids.append(f"BASELINE:{asset_class}:{trend['metric']}")
    return {"text": text + ".", "evidence_ids": ids}


def _mapping_caveat(bundle: dict[str, Any]) -> str:
    binding = bundle["binding"]
    if binding is None:
        return "No scene object is bound to this asset, so its 3D location is unknown."
    return (
        f"The 3D binding to scene object {binding['object_id']} is {binding['mapping_method']} and must be verified on site; "
        "the Excel scene coordinates are placeholders."
    )


def _caveats(bundle: dict[str, Any]) -> list[str]:
    dq_ids = [d["issue_id"] for d in bundle["data_quality"]]
    return [_mapping_caveat(bundle), *([f"Data-quality issues present: {', '.join(dq_ids)}."] if dq_ids else [])]


def _next_checks(current: dict[str, Any]) -> list[str]:
    check = str(current.get("recommended_next_check") or "inspect process conditions")
    if _has_issue(current):
        first = f"{check.capitalize()} before any physical intervention."
    else:
        first = f"Continue routine monitoring; {check}."
    return [first, SAFETY_CHECK]


def _issue_hypothesis(bundle: dict[str, Any], metrics: list[str]) -> dict[str, Any]:
    asset_id = bundle["asset"]["asset_id"]
    asset_class = str(bundle["asset"].get("asset_class") or "")
    current = bundle["current"]
    issue_code = current.get("issue_code")
    case_ids = [c["case_id"] for c in bundle["cases"][:3]]
    tel_ids = [f"TEL:{asset_id}:{m}" for m in metrics]
    if case_ids:
        return {
            "text": (
                f"The combined trend matches historical {asset_class} cases recorded as {issue_code} "
                f"({current.get('issue_summary')}), supporting a {issue_code} hypothesis rather than a confirmed fault."
            ),
            "evidence_ids": tel_ids + case_ids,
        }
    return {
        "text": (
            f"The trend is consistent with the recorded {issue_code} issue ({current.get('issue_summary')}), but no matching "
            "historical case was found, so it remains an unconfirmed hypothesis."
        ),
        "evidence_ids": [f"STATE:{asset_id}", *tel_ids],
    }


# Deterministic templates, one per mode

def _arrival(bundle: dict[str, Any]) -> dict[str, Any]:
    asset, current = bundle["asset"], bundle["current"]
    asset_id = asset["asset_id"]
    tag = asset.get("tag") or asset_id
    asset_class = str(asset.get("asset_class") or "")
    issue_code = current.get("issue_code")
    trends, baselines = bundle["trends"], bundle["baselines"]
    metrics = _key_metrics(trends)
    has_issue = _has_issue(current)

    observations = [_trend_observation(asset_id, asset_class, trends[m], baselines.get(m)) for m in metrics]
    open_matching = [e for e in bundle["events"] if e.get("status") == "open" and e.get("event_code") == issue_code][:2]
    if has_issue and open_matching:
        ids = [e["event_id"] for e in open_matching]
        observations.append({
            "text": f"Open {issue_code} events {' and '.join(ids)} are still unresolved.",
            "evidence_ids": [*ids, f"EVENTS:{asset_id}:summary"],
        })
    elif bundle["events"]:
        open_count = sum(1 for e in bundle["events"] if e.get("status") == "open")
        observations.append({
            "text": f"{tag} has {open_count} open events out of {len(bundle['events'])} recorded.",
            "evidence_ids": [f"EVENTS:{asset_id}:summary"],
        })
    if bundle["data_quality"]:
        issues = [f"{d['issue_id']} ({d.get('severity')} {d.get('issue_type')})" for d in bundle["data_quality"]]
        observations.append({
            "text": f"Data-quality issues {' and '.join(issues)} lower confidence in this diagnosis.",
            "evidence_ids": [d["issue_id"] for d in bundle["data_quality"]],
        })

    if has_issue:
        binding_note = (
            f"The 3D binding ({bundle['binding'].get('mapping_method')}) is unverified and must be checked on site."
            if bundle["binding"] else "No 3D binding exists for this asset."
        )
        summary = f"{tag} is flagged {current.get('condition_state')} with {issue_code}: {current.get('issue_summary')}. {binding_note}"
        hypotheses = [_issue_hypothesis(bundle, metrics)]
    else:
        summary = (
            f"{tag} is {current.get('condition_state') or 'in an unknown state'} with no active issue code "
            f"(health score {current.get('health_score')}); no fault hypothesis is raised."
        )
        hypotheses = []

    return {
        "summary": summary,
        "observations": observations,
        "hypotheses": hypotheses,
        "next_safe_checks": _next_checks(current),
        "caveats": _caveats(bundle),
    }


def _status_line(bundle: dict[str, Any]) -> dict[str, Any]:
    asset, current = bundle["asset"], bundle["current"]
    asset_id = asset["asset_id"]
    tag = asset.get("tag") or asset_id
    asset_class = str(asset.get("asset_class") or "")
    trends, baselines = bundle["trends"], bundle["baselines"]
    metrics = _key_metrics(trends)
    state = str(current.get("condition_state") or "unknown")
    condition = "attention" if state == "attention_required" else state.replace("_", " ")
    issue = str(current.get("issue_code")).lower().replace("_", " ") if _has_issue(current) else "no active issue"

    ids = [f"STATE:{asset_id}"] if current else [f"ASSET:{asset_id}"]
    reading = ""
    if metrics:
        metric = next((m for m in metrics if m in baselines), metrics[0])
        trend = trends[metric]
        reading = f" {METRICS[metric]['label'].lower()} {trend['last_day_mean']}{_unit(metric)}"
        ids.append(f"TEL:{asset_id}:{metric}")
        if metric in baselines:
            reading += f" vs {baselines[metric]['mean']} healthy"
            ids.append(f"BASELINE:{asset_class}:{metric}")
        reading += ","
    summary = f"{tag} {condition}:{reading} {issue}."
    return {
        "summary": summary,
        "observations": [{"text": summary, "evidence_ids": ids}],
        "hypotheses": [],
        "next_safe_checks": _next_checks(current),
        "caveats": [_mapping_caveat(bundle)],
    }


def _question_topics(question: str) -> list[str]:
    q = question.lower()
    return [
        topic for topic, words in QUESTION_TOPICS.items()
        if any(re.search(rf"\b{re.escape(w)}", q) for w in words)
    ]


def _question_metrics(question: str, trends: dict[str, Any]) -> list[str]:
    q = question.lower()
    named = [
        m for m in trends
        if METRICS[m]["label"].lower() in q or any(re.search(rf"\b{w}", q) for w in m.split("_")[:1])
    ]
    return named or _key_metrics(trends)


def _question(bundle: dict[str, Any], question: str) -> dict[str, Any]:
    asset, current = bundle["asset"], bundle["current"]
    asset_id = asset["asset_id"]
    tag = asset.get("tag") or asset_id
    asset_class = str(asset.get("asset_class") or "")
    issue_code = current.get("issue_code")
    evidence_ids = {item["id"] for item in bundle["evidence"]}
    topics = _question_topics(question)

    if not topics:
        report = _arrival(bundle)
        report["summary"] = (
            f"The question did not match a specific evidence topic, so this is the current diagnosis. {report['summary']}"
        )
        return report

    observations: list[dict[str, Any]] = []
    hypotheses: list[dict[str, Any]] = []
    summary_id = f"EVENTS:{asset_id}:summary"
    for topic in topics:
        if topic == "events":
            if summary_id in evidence_ids:
                counts = next(i["values"] for i in bundle["evidence"] if i["id"] == summary_id)
                observations.append({
                    "text": (
                        f"{tag} has {counts['total']} events, {counts['open']} of them open; "
                        f"{counts['matching_open']} open events carry the current issue code {issue_code}."
                    ),
                    "evidence_ids": [summary_id],
                })
            for event in bundle["events"][:3]:
                observations.append({
                    "text": (
                        f"{event['event_id']} is {event.get('status')} {event.get('severity')} {event.get('event_code')}: "
                        f"{event.get('description')}"
                    ),
                    "evidence_ids": [event["event_id"]],
                })
        elif topic == "telemetry":
            for metric in _question_metrics(question, bundle["trends"]):
                observations.append(_trend_observation(asset_id, asset_class, bundle["trends"][metric], bundle["baselines"].get(metric)))
        elif topic == "cases":
            for case in bundle["cases"][:3]:
                observations.append({
                    "text": (
                        f"{case['case_id']} ({case.get('severity')} {case.get('historical_issue_code')}) recorded "
                        f"{case.get('historical_interpretation')}; recommended check: {case.get('recommended_next_check')}."
                    ),
                    "evidence_ids": [case["case_id"]],
                })
            if _has_issue(current):
                hypotheses.append(_issue_hypothesis(bundle, _key_metrics(bundle["trends"])))
        elif topic == "work_orders":
            for wo in bundle["work_orders"][:3]:
                observations.append({
                    "text": f"{wo['work_order_id']} ({wo.get('maintenance_type')}): {wo.get('action')} -> {wo.get('result')}.",
                    "evidence_ids": [wo["work_order_id"]],
                })
            if not bundle["work_orders"]:
                observations.append({"text": f"No work orders are recorded for {tag}.", "evidence_ids": [f"ASSET:{asset_id}"]})
        elif topic == "data_quality":
            for issue in bundle["data_quality"]:
                observations.append({
                    "text": (
                        f"{issue['issue_id']} is a {issue.get('severity')} {issue.get('issue_type')} issue in "
                        f"{issue.get('source_sheet')}; recommended handling: {issue.get('recommended_handling')}."
                    ),
                    "evidence_ids": [issue["issue_id"]],
                })
            if not bundle["data_quality"]:
                observations.append({"text": f"No data-quality issues are recorded for {tag}.", "evidence_ids": [f"ASSET:{asset_id}"]})
        elif topic == "mapping":
            binding = bundle["binding"]
            text = (
                f"{tag} is bound to scene object {binding['object_id']} by {binding['mapping_method']} with mapping "
                f"confidence {binding['mapping_confidence']}; identity is not visually verified."
                if binding else f"No scene object is bound to {tag}, so its 3D location is unknown."
            )
            observations.append({"text": text, "evidence_ids": [f"MAP:{asset_id}"]})
        elif topic == "safety" and "DOC-FIELD-SAFETY" in evidence_ids:
            observations.append({
                "text": (
                    "Site procedures, lockout/tagout, permits, OEM instructions and qualified personnel take precedence; "
                    "the copilot recommends verification and escalation only."
                ),
                "evidence_ids": ["DOC-FIELD-SAFETY"],
            })

    if not observations:
        return _question(bundle, "")
    lead = " ".join(o["text"] for o in observations[:2])
    return {
        "summary": f"For {tag}: {lead}",
        "observations": observations,
        "hypotheses": hypotheses,
        "next_safe_checks": _next_checks(current),
        "caveats": _caveats(bundle),
    }


def _deterministic_answer(query: CopilotQuery, bundle: dict[str, Any]) -> dict[str, Any]:
    if query.mode == "status_line":
        return _status_line(bundle)
    if query.mode == "question":
        return _question(bundle, query.question or "")
    return _arrival(bundle)


# Orchestration: LLM with validation, retry, cache, deterministic fallback

def _confidence(bundle: dict[str, Any]) -> dict[str, Any]:
    return confidence.compute(bundle["current"], bundle["data_quality"], bundle["binding"])


def _check(answer: dict[str, Any], bundle: dict[str, Any], conf: dict[str, Any]) -> dict[str, Any]:
    return validate(answer, bundle["evidence"], extra_numbers=[conf["score"]])


def _assemble(
    query: CopilotQuery, bundle: dict[str, Any], answer: dict[str, Any], conf: dict[str, Any],
    generation: str, validation: dict[str, Any], model: str | None = None,
) -> dict[str, Any]:
    return {
        "asset_id": query.asset_id,
        "mode": query.mode,
        "question": query.question,
        **{k: answer[k] for k in cache.ANSWER_FIELDS},
        "confidence": conf,
        "generation": generation,
        "cached": generation == "cached",
        "model": model,
        "validation": validation,
        "evidence": bundle["evidence"],
    }


def deterministic_response(
    query: CopilotQuery, bundle: dict[str, Any] | None = None, generation: str = "deterministic",
    prior_errors: list[str] | None = None, attempts: int = 0,
) -> dict[str, Any]:
    bundle = bundle or evidence_bundle(query.asset_id)
    conf = _confidence(bundle)
    answer = _deterministic_answer(query, bundle)
    result = _check(answer, bundle, conf)
    validation = {"ok": result["ok"], "errors": [*(prior_errors or []), *result["errors"]], "attempts": attempts}
    return _assemble(query, bundle, answer, conf, generation, validation)


def _respond(query: CopilotQuery, bundle: dict[str, Any]) -> dict[str, Any]:
    if not llm.enabled():
        return deterministic_response(query, bundle)

    conf = _confidence(bundle)
    history: list[str] = []
    last_errors: list[str] | None = None
    attempts = 0
    while attempts < MAX_LLM_ATTEMPTS:
        attempts += 1
        parsed = llm.generate(bundle, query.mode, query.question, last_errors)
        if parsed is None:
            history.append(f"attempt {attempts}: the model returned no structured answer")
            break
        answer = parsed.model_dump()
        result = _check(answer, bundle, conf)
        if result["ok"]:
            validation = {"ok": True, "errors": history, "attempts": attempts}
            response = _assemble(query, bundle, answer, conf, "llm", validation, model=llm.model_name())
            cache.save(query.asset_id, query.mode, response)
            return response
        last_errors = result["errors"]
        history.extend(f"attempt {attempts}: {e}" for e in last_errors)

    entry = cache.load(query.asset_id, query.mode)
    if entry and _check(entry["answer"], bundle, conf)["ok"]:
        validation = {"ok": True, "errors": history, "attempts": attempts}
        return _assemble(query, bundle, entry["answer"], conf, "cached", validation, model=entry.get("model"))
    return deterministic_response(query, bundle, "deterministic_fallback", history, attempts)


def answer(query: CopilotQuery) -> dict[str, Any]:
    return _respond(query, evidence_bundle(query.asset_id))


def work_order_draft(query: CopilotQuery) -> dict[str, Any]:
    bundle = evidence_bundle(query.asset_id)
    diagnosis = _respond(CopilotQuery(asset_id=query.asset_id, mode="arrival_diagnosis"), bundle)
    asset, current = bundle["asset"], bundle["current"]
    tag = str(asset.get("tag") or query.asset_id)
    issue_code = current.get("issue_code")
    roles = Counter(wo.get("role") for wo in bundle["work_orders"] if wo.get("role"))
    cited = [eid for section in ("observations", "hypotheses") for item in diagnosis[section] for eid in item["evidence_ids"]]
    title = (
        f"Inspect {tag} ({query.asset_id}) for {issue_code}" if _has_issue(current)
        else f"Routine check of {tag} ({query.asset_id})"
    )
    return {
        "asset_id": query.asset_id,
        "draft": {
            "asset_id": query.asset_id,
            "tag": tag,
            "area_name": asset.get("area_name"),
            "action": diagnosis["next_safe_checks"][0],
            "maintenance_type": "predictive",
            "priority": URGENCY_PRIORITY.get(str(current.get("urgency")).lower(), "medium"),
            "role": roles.most_common(1)[0][0] if roles else DEFAULT_ROLE,
            "knowledge_doc_id": current.get("knowledge_doc_id"),
            "status": "draft",
            "note": DRAFT_NOTE,
            "title": title,
            "summary": diagnosis["summary"],
            "safe_checks": diagnosis["next_safe_checks"],
            "evidence_ids": list(dict.fromkeys(cited)),
        },
        "generation": diagnosis["generation"],
        "confidence": diagnosis["confidence"],
    }
