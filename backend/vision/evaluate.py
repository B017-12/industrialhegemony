"""Agreement between cached model findings and human ground-truth labels (labelled_by != claude*)."""

from __future__ import annotations

from collections import defaultdict

from backend.vision import cache, manifest


def evaluate() -> dict:
    gt = {}
    for f in manifest.merged_frames():
        for r in f["regions"]:
            g = r.get("gt")
            if g and not str(g.get("labelled_by", "")).lower().startswith("claude"):
                gt[r["region_id"]] = (r["kind"], g)
    latest = {}
    for f in cache.all_findings():
        if f.get("question") is None and f.get("region_id") in gt:
            if f["region_id"] not in latest or f["created_at"] > latest[f["region_id"]]["created_at"]:
                latest[f["region_id"]] = f
    per = defaultdict(lambda: {"n": 0, "state_agree": 0, "model_unknown": 0, "gauge_n": 0, "gauge_abs_err": []})
    rows = []
    for rid, (kind, g) in gt.items():
        f = latest.get(rid)
        if not f:
            continue
        p = per[kind]
        p["n"] += 1
        row = {"region_id": rid, "kind": kind, "gt_state": g.get("state"), "model_state": f["state"],
               "confidence": f["confidence"], "finding_id": f["finding_id"]}
        if g.get("state"):
            p["state_agree"] += int(f["state"] == g["state"])
            p["model_unknown"] += int(f["state"] == "unknown" and g["state"] != "unknown")
        gauge = (f.get("draft") or {}).get("gauge") or {}
        if g.get("gauge_value") is not None and gauge.get("value") is not None:
            p["gauge_n"] += 1
            p["gauge_abs_err"].append(abs(gauge["value"] - g["gauge_value"]))
            row["gauge"] = {"gt": g["gauge_value"], "model": gauge["value"]}
        rows.append(row)
    summary = {k: {"n": v["n"], "state_accuracy": round(v["state_agree"] / v["n"], 2) if v["n"] else None,
                   "abstained": v["model_unknown"],
                   "gauge_mae": round(sum(v["gauge_abs_err"]) / v["gauge_n"], 2) if v["gauge_n"] else None}
               for k, v in per.items()}
    return {"labelled_regions": len(gt), "evaluated": len(rows), "per_kind": summary, "rows": rows,
            "note": "Ground truth is human-labelled only; drafts by Claude are excluded."}
