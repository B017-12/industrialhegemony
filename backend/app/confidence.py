from __future__ import annotations

from typing import Any

DEFAULT_MODEL_CONFIDENCE = 0.5
HIGH_DQ_PENALTY = 0.08
MAX_HIGH_DQ_PENALTIES = 2
MEDIUM_DQ_PENALTY = 0.03
MAPPING_CAPS = {
    "procedural_demo_target": 0.5,
    "procedural_class_match": 0.5,
    "procedural_fallback": 0.25,
    "human_assigned": 0.5,
    "video_evidence": 0.5,
}
UNBOUND_CAP = 0.2
FLOOR = 0.05


def compute(current: dict[str, Any], data_quality: list[dict[str, Any]], binding: dict[str, Any] | None) -> dict[str, Any]:
    """Confidence computed in code from workbook confidence, data quality and the 3D mapping, with one reason per step."""
    raw = current.get("model_confidence")
    if raw is None:
        score = DEFAULT_MODEL_CONFIDENCE
        reasons = [f"No workbook model confidence; starting from {score}."]
    else:
        score = float(raw)
        reasons = [f"Starting from workbook model confidence {score} (Current_State)."]

    high = [d for d in data_quality if str(d.get("severity")).lower() == "high"]
    medium = [d for d in data_quality if str(d.get("severity")).lower() == "medium"]
    for issue in high[:MAX_HIGH_DQ_PENALTIES]:
        score -= HIGH_DQ_PENALTY
        reasons.append(f"-{HIGH_DQ_PENALTY} for high-severity data-quality issue {issue['issue_id']} ({issue.get('issue_type')}).")
    for issue in medium:
        score -= MEDIUM_DQ_PENALTY
        reasons.append(f"-{MEDIUM_DQ_PENALTY} for medium-severity data-quality issue {issue['issue_id']} ({issue.get('issue_type')}).")

    if binding is None:
        cap, why = UNBOUND_CAP, "the asset is not bound to any scene object"
    else:
        method = str(binding.get("mapping_method") or "")
        cap = MAPPING_CAPS.get(method)
        if method == "human_assigned":
            why = "the 3D binding was chosen by a reviewer but the asset identity is not verified on site"
        elif method == "video_evidence":
            why = "the 3D binding was matched to equipment in the video frames but the asset identity is not verified on site"
        else:
            why = f"the 3D binding is {method} and not visually verified"
    if cap is not None and score > cap:
        reasons.append(f"Capped at {cap} because {why}.")
        score = cap

    score = max(FLOOR, round(score, 2))
    return {"score": score, "reasons": reasons}
