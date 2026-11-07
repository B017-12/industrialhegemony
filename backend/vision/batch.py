"""Inspect every hand-drawn region once (warms the findings cache so the demo replays offline), then print a
table and write public/assets/vision/eval.json (agreement with human labels).

    uv run python -m backend.vision.batch                 # all regions
    uv run python -m backend.vision.batch --kinds manual_valve gauge --force
"""
from __future__ import annotations

import argparse
import json

from dotenv import load_dotenv

from backend.vision import agent, manifest
from backend.vision.evaluate import evaluate
from pipeline.common import ROOT


def main() -> None:
    load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser()
    ap.add_argument("--kinds", nargs="*")
    ap.add_argument("--force", action="store_true", help="ignore the cache")
    args = ap.parse_args()
    model = agent.configured_model()
    print(f"model: {model or 'NONE (fallback only: set VISION_MODEL and GEMINI_API_KEY in .env)'}")
    for f in manifest.merged_frames():
        for r in f["regions"]:
            if args.kinds and r["kind"] not in args.kinds:
                continue
            x = agent.inspect(f["frame_id"], r["bbox_px"], r, None, args.force)
            g = (x.draft.gauge.value if x.draft.gauge and x.draft.gauge.readable else "")
            print(f"{r['region_id']:<14} {r['kind']:<14} {x.mode:<8} {x.state:<15} conf {x.confidence:.2f} "
                  f"{g!s:<6} {x.draft.object_seen[:40]}" + (f"  [{x.gate_note}]" if x.gate_note else ""))
    ev = evaluate()
    (manifest.VISION / "eval.json").write_text(json.dumps(ev, indent=1))
    print(json.dumps({k: v for k, v in ev.items() if k != "rows"}, indent=1))


if __name__ == "__main__":
    main()
