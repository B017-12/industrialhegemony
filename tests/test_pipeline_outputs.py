"""Invariants on the generated scene files (run `uv run python -m pipeline.run_all` first)."""

import json

import numpy as np
import pytest

from pipeline.common import WEB_ASSETS
from pipeline.navigate import Nav, box_footprint_distance

pytestmark = pytest.mark.skipif(not (WEB_ASSETS / "path.json").exists(), reason="pipeline outputs not generated")


def load(name):
    return json.loads((WEB_ASSETS / f"{name}.json").read_text())


def test_many_objects_with_labels_and_confidence():
    objs = load("objects")["objects"]
    assert len(objs) >= 100
    for o in objs:
        assert len(o["center"]) == 3 and all(e > 0 for e in o["extents"])
        assert 0 < o["label_confidence"] <= 1 and o["label_source"]


def test_all_excel_assets_bound_with_explicit_confidence():
    reg = load("registry")
    assert len({e["asset_id"] for e in reg["entries"]}) == 30
    assert len({e["object_id"] for e in reg["entries"]}) == 30  # one asset per object
    assert all(0 < e["mapping_confidence"] <= 1 and e["mapping_method"] for e in reg["entries"])
    assert reg["target"]["asset_id"] == "ASSET-017"


def test_route_is_collision_free_and_reaches_target():
    path = load("path")
    assert path["checks"]["collision_free"]
    nav = Nav()
    xz = np.array([[p[0], p[2]] for p in path["points"]])
    assert all(nav.walkable[nav.to_cell(p)] for p in xz)
    target = next(o for o in load("objects")["objects"] if o["object_id"] == path["target"]["object_id"])
    assert box_footprint_distance(xz[-1:], target)[0] <= 0.8  # arm's reach; pipe-mounted pumps sit behind piping


def test_route_follows_equal_clearance_rule():
    m = load("path")["metrics"]
    assert m["binding_lr_imbalance_m"]["median"] <= 0.10
    assert all(v > 0 for v in m["min_body_clearance_m_per_band"].values())


def test_timeline_covers_route():
    tl, path = load("timeline"), load("path")
    assert len(tl["frames"]) == len(path["points"])
    assert any(f["nearby"] for f in tl["frames"])
