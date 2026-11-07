"""Computed confidence for a vision finding. The model's self-reported confidence is only one factor; image
evidence quality (box size, sharpness, visibility) and multi-view agreement scale it down. Below GATE a valve
state is reported as 'unknown' (DOC-3D-MAPPING: never a silent guess)."""

from __future__ import annotations

import numpy as np

from backend.vision.schema import STATEFUL, ConfidenceFactor, VisionDraft

GATE = 0.5
VISIBILITY = {"clear": 1.0, "partial": 0.75, "poor": 0.45}


def size_factor(bbox: list[int]) -> ConfidenceFactor:
    x1, y1, x2, y2 = bbox
    side = min(x2 - x1, y2 - y1)
    v = float(np.clip((side - 20) / (80 - 20), 0.4, 1.0))
    return ConfidenceFactor(name="box_size", value=round(v, 2), note=f"smallest box side {side}px in a 1280px frame")


def sharpness_factor(lap_var: float) -> ConfidenceFactor:
    v = float(np.clip(lap_var / 600, 0.5, 1.0))
    return ConfidenceFactor(name="sharpness", value=round(v, 2), note=f"Laplacian variance {lap_var:.0f} (motion blur)")


def score(draft: VisionDraft, bbox: list[int], lap_var: float,
          other_states: list[str] | None = None) -> tuple[float, list[ConfidenceFactor], str, str | None]:
    """Return (confidence, factors, final_state, gate_note)."""
    factors = [
        ConfidenceFactor(name="model", value=round(draft.model_confidence, 2), note="model self-report"),
        size_factor(bbox),
        sharpness_factor(lap_var),
        ConfidenceFactor(name="visibility", value=VISIBILITY[draft.visibility], note=f"model says '{draft.visibility}'"),
    ]
    state, note = draft.state, None
    others = [s for s in (other_states or []) if s in STATEFUL]
    if state in STATEFUL and others:
        agree = all(s == state for s in others)
        factors.append(ConfidenceFactor(name="multi_view", value=1.0 if agree else 0.5,
                                        note=f"{len(others)} other view(s): {', '.join(others)}"))
        if not agree:
            state, note = "unknown", f"views disagree ({draft.state} here vs {', '.join(others)})"
    conf = float(np.prod([f.value for f in factors]))
    if state in STATEFUL and conf < GATE:
        note = f"model said '{draft.state}' but confidence {conf:.2f} < {GATE}: reported as unknown"
        state = "unknown"
    return round(conf, 2), factors, state, note
