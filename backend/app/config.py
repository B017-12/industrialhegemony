from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"

WORKBOOK = Path(
    os.environ.get(
        "VALMET_WORKBOOK",
        ROOT / "Valmet_SinceAI_2026_Synthetic_Industrial_Metaverse_Builder_Pack (1) (2) (1).xlsx",
    )
)
DB_PATH = Path(os.environ.get("VALMET_DB", ROOT / "data" / "valmet.db"))

DERIVED = ROOT / "data" / "derived"
SCENE_OBJECTS = DERIVED / "scene_objects.json"
NAV = DERIVED / "nav.json"
NAV_TARGETS = DERIVED / "nav_targets.json"
LABELS_OVERRIDE = DERIVED / "labels_override.json"
CROPS_DIR = DERIVED / "crops"
VLM_LABELS = DERIVED / "vlm_labels.json"

CACHE_DIR = Path(os.environ.get("VALMET_CACHE_DIR", BACKEND_DIR / "cache"))

TARGET_ASSET_ID = "ASSET-014"
