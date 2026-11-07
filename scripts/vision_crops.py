"""Write a contact sheet of every hand-drawn region (for checking boxes and labelling ground truth).

Usage: uv run python scripts/vision_crops.py   -> data/derived/frames/crops_sheet.jpg
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

M = json.loads(Path("public/assets/vision/frames.json").read_text())
TILE, COLS = 256, 6
regions = [(f, r) for f in M["frames"] for r in f["regions"]]
rows = (len(regions) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * TILE, rows * (TILE + 18)), "black")
d = ImageDraw.Draw(sheet)
for k, (f, r) in enumerate(regions):
    img = Image.open("public" + f["file"])
    x1, y1, x2, y2 = r["bbox_px"]
    pad = 0.25 * max(x2 - x1, y2 - y1)
    crop = img.crop((max(0, x1 - pad), max(0, y1 - pad), min(img.width, x2 + pad), min(img.height, y2 + pad)))
    crop.thumbnail((TILE, TILE))
    cx, cy = (k % COLS) * TILE, (k // COLS) * (TILE + 18)
    sheet.paste(crop, (cx, cy + 18))
    sx = crop.width / (min(img.width, x2 + pad) - max(0, x1 - pad))
    ox, oy = max(0, x1 - pad), max(0, y1 - pad)
    d.rectangle([cx + (x1 - ox) * sx, cy + 18 + (y1 - oy) * sx, cx + (x2 - ox) * sx, cy + 18 + (y2 - oy) * sx],
                outline=(255, 255, 0), width=2)
    d.text((cx + 2, cy + 3), f"{r['region_id']} {r['kind']}", fill=(255, 255, 255))
out = Path("data/derived/frames/crops_sheet.jpg")
sheet.save(out, quality=85)
print(out, sheet.size)
