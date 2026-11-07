from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", str(Path(".cache/matplotlib").resolve()))

import numpy as np

UP = np.array([0.0, -1.0, 0.0])
METRES_PER_UNIT = 1.25
SCHEMA_VERSION = "1.0"
TARGET_ASSET_ID = "ASSET-014"
