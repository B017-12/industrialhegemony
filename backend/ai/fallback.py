"""Deterministic copilot answer built only from the evidence pack (used without an LLM key or on LLM failure)."""

from __future__ import annotations

from backend.ai.schema import Claim, CopilotDraft

PRETTY = {
    "process_flow_pct": "process flow", "process_pressure_bar": "process pressure", "motor_current_a": "motor current",
    "vibration_mm_s": "vibration", "bearing_temp_c": "bearing temperature", "speed_rpm": "speed",
    "position_actual_pct": "valve position", "position_setpoint_pct": "position setpoint",
    "pneumatic_supply_bar": "pneumatic supply", "stiction_index": "stiction index",
    "load_for_opening_pct": "load for opening", "signal_quality_pct": "signal quality", "sensor_bias": "sensor bias",
}


def fallback_draft(pack: dict, question: str | None = None) -> CopilotDraft:
    a, s = pack["asset"], pack["state"]
    obs: list[Claim] = [Claim(
        text=f"Current_State reports health {s['health_score']}/100, condition '{s['condition_state']}', "
             f"issue {s['issue_code']} ({s['issue_summary']}), urgency {s['urgency']}.",
        evidence_ids=[a["asset_id"]],
    )]
    for t in pack["telemetry_trends"][:3]:
        if abs(t["change_pct"]) < 2:
            continue
        peer = f"; healthy peers average {t['healthy_peer_last_day_mean']}" if t["healthy_peer_last_day_mean"] is not None else ""
        direction = "rose" if t["change_pct"] > 0 else "fell"
        obs.append(Claim(
            text=f"{PRETTY.get(t['signal'], t['signal'])} {direction} from {t['first_day_mean']} to {t['last_day_mean']} "
                 f"({t['change_pct']:+.1f}%) between the first and last day of the 3-day sample{peer}.",
            evidence_ids=[f"TELEMETRY:{t['signal']}"],
        ))
    issue_events = [e for e in pack["events"] if e["event_code"] == s["issue_code"]]
    if issue_events:
        n = pack["event_counts"].get(s["issue_code"], len(issue_events))
        obs.append(Claim(
            text=f"{n} {s['issue_code']} events are logged; most recent: "
                 + ", ".join(f"{e['event_id']} ({e['severity']}, {e['timestamp'][:10]})" for e in issue_events[:3]) + ".",
            evidence_ids=[e["event_id"] for e in issue_events[:3]],
        ))
    if pack["work_orders"]:
        w = pack["work_orders"][:3]
        obs.append(Claim(
            text="Recent work orders: " + "; ".join(f"{x['work_order_id']} {x['action']} → {x['result']}" for x in w) + ".",
            evidence_ids=[x["work_order_id"] for x in w],
        ))

    hyps: list[Claim] = []
    if pack["historical_cases"]:
        c = pack["historical_cases"]
        hyps.append(Claim(
            text=f"Historical cases with the same issue code interpret this pattern as "
                 f"'{c[0]['historical_interpretation']}' (evidence, not proof).",
            evidence_ids=[x["case_id"] for x in c[:3]],
        ))
    core = next((d for d in pack["documents"] if d["doc_id"] == s["knowledge_doc_id"]), None)
    if core:
        hyps.append(Claim(text=f"Class guidance: {core['content']}", evidence_ids=[core["doc_id"]]))
    if pack["data_quality"]:
        hyps.append(Claim(
            text="Part of the signal may be a data artefact: open data-quality issues "
                 + ", ".join(f"{d['issue_id']} ({d['issue_type']})" for d in pack["data_quality"][:4]) + ".",
            evidence_ids=[d["issue_id"] for d in pack["data_quality"][:4]],
        ))

    checks = ["Confirm the asset identity on site (QR/NFC tag) before any work — the 3D mapping is procedural."]
    checks.append(f"{s['recommended_next_check'].capitalize()} (Current_State recommendation).")
    if pack["historical_cases"]:
        hc = pack["historical_cases"][0]["recommended_next_check"]
        if hc != s["recommended_next_check"]:
            checks.append(f"{hc.capitalize()} (historical case {pack['historical_cases'][0]['case_id']}).")
        checks += [step.strip().capitalize() + "." for step in
                   pack["historical_cases"][0]["safe_evidence_workflow"].rstrip(".").split(";")[1:]]
    if any(d["recommended_handling"] in ("request_user_confirmation", "flag_for_review") for d in pack["data_quality"]):
        checks.append("Review the flagged data-quality issues before trusting the trend.")

    return CopilotDraft(
        headline=f"{a['tag']} ({a['asset_id']}, {a['asset_class']}) is {s['condition_state']} "
                 f"with health {s['health_score']}/100 — {s['issue_summary'].lower()}.",
        observations=obs,
        hypotheses=hyps,
        safe_next_checks=checks,
    )
