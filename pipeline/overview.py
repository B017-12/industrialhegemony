"""Overview render: point cloud + object boxes (colour = mapped/target/scene) + route, for checks and slides."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from pipeline.common import DERIVED, WEB_ASSETS, read_json
from pipeline import render

PX_PER_M = 80.0


def overview() -> None:
    tf = read_json(DERIVED / "transform.json")
    data = np.load(DERIVED / "splats_clean.npz")
    xyz, rgb = data["xyz"], data["rgb"]
    objects = read_json(WEB_ASSETS / "objects.json")["objects"]
    path = read_json(WEB_ASSETS / "path.json")
    rails = read_json(WEB_ASSETS / "rails.json")
    fx0, fx1, fz0, fz1 = tf["floor_extent_xz"]
    bounds = (fx0 - 0.3, fx1 + 0.3, fz0 - 0.3, fz1 + 0.3)
    below = xyz[:, 1] < tf["ceiling_y"] - 0.15
    img = render.render_top(xyz[below], rgb[below] * 0.55, bounds, PX_PER_M).convert("RGB")
    draw = ImageDraw.Draw(img)

    def px(x, z):
        return ((x - bounds[0]) * PX_PER_M, (z - bounds[2]) * PX_PER_M)

    target_id = path["target"]["object_id"]
    for o in objects:
        if o["height_above_floor"][0] > 1.6:
            continue  # ceiling items clutter the top view
        cx, cz = o["center"][0], o["center"][2]
        w, d = o["extents"][0] / 2, o["extents"][2] / 2
        ca, sa = np.cos(o["yaw"]), np.sin(o["yaw"])
        corners = [(cx + ca * u - sa * v, cz + sa * u + ca * v) for u, v in ((-w, -d), (w, -d), (w, d), (-w, d))]
        colour = (255, 60, 60) if o["object_id"] == target_id else (80, 200, 255) if o.get("asset") else (170, 170, 170)
        draw.polygon([px(*c) for c in corners], outline=colour, width=3 if colour != (170, 170, 170) else 1)
    for r in rails["rails"]:
        draw.line([px(p[0], p[2]) for p in r["points"]], fill=(240, 220, 60), width=1)
    draw.line([px(p[0], p[2]) for p in path["points"]], fill=(60, 255, 120), width=4)
    s = path["points"][0]
    draw.ellipse([px(s[0], s[2])[0] - 7, px(s[0], s[2])[1] - 7, px(s[0], s[2])[0] + 7, px(s[0], s[2])[1] + 7],
                 fill=(60, 255, 120))
    img.save(DERIVED / "renders" / "overview_top.png")


def main() -> None:
    overview()
    print("overview: data/derived/renders/overview_top.png")


if __name__ == "__main__":
    main()
