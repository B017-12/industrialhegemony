"""Pick the sharpest frame in each window of a video for SfM / 3DGS.

Usage: python3 _analysis/extract_sharp_frames.py VIDEO OUT_DIR [--every 10] [--width 1600] [--score-only]
Sharpness is the variance of the Laplacian on a 480 px grayscale copy.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("out_dir")
ap.add_argument("--every", type=int, default=10, help="window length in frames; one frame is kept per window")
ap.add_argument("--width", type=int, default=1600)
ap.add_argument("--score-only", action="store_true")
args = ap.parse_args()

out = Path(args.out_dir)
out.mkdir(parents=True, exist_ok=True)
cap = cv2.VideoCapture(args.video)
scores, best, kept = [], None, []
i = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    small = cv2.resize(frame, (480, int(frame.shape[0] * 480 / frame.shape[1])), interpolation=cv2.INTER_AREA)
    s = float(cv2.Laplacian(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
    scores.append(s)
    if best is None or s > best[0]:
        best = (s, i, frame)
    if (i + 1) % args.every == 0:
        kept.append(best[:2])
        if not args.score_only:
            f = best[2]
            h = int(f.shape[0] * args.width / f.shape[1])
            cv2.imwrite(str(out / f"frame_{len(kept):05d}.jpg"), cv2.resize(f, (args.width, h), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 95])
        best = None
    i += 1

s = np.array(scores)
k = np.array([x[0] for x in kept])
report = {
    "frames_read": i,
    "frames_kept": len(kept),
    "all_frames_laplacian_var": {"p10": float(np.percentile(s, 10)), "median": float(np.median(s)), "p90": float(np.percentile(s, 90))},
    "kept_frames_laplacian_var": {"p10": float(np.percentile(k, 10)), "median": float(np.median(k)), "min": float(k.min())},
    "blurry_kept_below_half_median": int((k < 0.5 * np.median(s)).sum()),
}
(out / "sharpness_report.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
