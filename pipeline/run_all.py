"""Run the whole pipeline: raw PLY + Excel -> objects, rails, registry, route, timeline (+ overview render)."""

from __future__ import annotations

import argparse
import time

from pipeline import clean, excel, export_splat, label, map as mapping, navigate, orient, overview, rails, segment

STAGES = [
    ("clean", clean.main),
    ("orient", orient.main),
    ("export_splat", export_splat.main),
    ("excel", excel.main),
    ("segment", segment.main),
    ("label", label.main),
    ("rails", rails.main),
    ("map", mapping.main),
    ("navigate", navigate.main),
    ("overview", overview.main),
]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--from", dest="start", choices=[s for s, _ in STAGES], help="resume from this stage")
    args = ap.parse_args()
    names = [s for s, _ in STAGES]
    first = names.index(args.start) if args.start else 0
    import sys

    sys.argv = sys.argv[:1]  # stage mains parse their own (empty) args
    t0 = time.time()
    for name, fn in STAGES[first:]:
        t = time.time()
        fn()
        print(f"  [{name} {time.time() - t:.1f}s]")
    print(f"pipeline done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
