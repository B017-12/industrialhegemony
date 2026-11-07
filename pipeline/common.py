"""Shared paths, PLY access and JSON helpers for the pipeline stages.

World frame used everywhere (same as the web prototype): x right, y up, z = -z_ply.
The raw 3DGS file is y-down, so world = (x, -y, -z) — a 180° rotation about x.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
DERIVED = ROOT / "data" / "derived"
WEB_ASSETS = ROOT / "public" / "assets"

PLY_PATH = RAW / "equipment_room.ply"
XLSX_PATH = RAW / "builder_pack.xlsx"

SH_C0 = 0.28209479177387814
PLY_TO_WORLD = np.array([1.0, -1.0, -1.0], dtype=np.float32)


def read_ply_header(path: Path) -> tuple[int, list[str], int]:
    """Return (vertex_count, property_names, header_bytes) for a binary little-endian float PLY."""
    with open(path, "rb") as f:
        header = b""
        while not header.endswith(b"end_header\n"):
            chunk = f.read(1)
            if not chunk:
                raise ValueError(f"{path}: no end_header found")
            header += chunk
    lines = header.decode("ascii").splitlines()
    if "format binary_little_endian 1.0" not in lines:
        raise ValueError(f"{path}: expected binary_little_endian PLY")
    props = []
    for line in lines:
        if line.startswith("property"):
            _, dtype, name = line.split()
            if dtype != "float":
                raise ValueError(f"{path}: property {name} is {dtype}, expected float")
            props.append(name)
    count = int(next(l for l in lines if l.startswith("element vertex")).split()[-1])
    return count, props, len(header)


def open_ply(path: Path = PLY_PATH) -> tuple[np.memmap, dict[str, int]]:
    """Memory-map the splat table (never loads the 400 MB file eagerly)."""
    count, props, offset = read_ply_header(path)
    expected = offset + count * len(props) * 4
    actual = path.stat().st_size
    if expected != actual:
        raise ValueError(f"{path}: size {actual} != header-implied {expected}")
    table = np.memmap(path, dtype="<f4", mode="r", offset=offset, shape=(count, len(props)))
    return table, {name: i for i, name in enumerate(props)}


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=_json_default))


def read_json(path: Path):
    return json.loads(path.read_text())


def _json_default(o):
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"not JSON serialisable: {type(o)}")
