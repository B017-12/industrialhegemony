from __future__ import annotations

from pathlib import Path

import numpy as np


def read_ply_header(path: Path) -> tuple[bytes, int, list[str]]:
    header = b""
    with path.open("rb") as f:
        while not header.endswith(b"end_header\n"):
            line = f.readline()
            if not line:
                raise ValueError(f"{path} has no complete PLY header")
            header += line
    lines = header.decode("utf-8", errors="replace").splitlines()
    vertex_count = int(next(line for line in lines if line.startswith("element vertex")).split()[-1])
    props = [line.split()[-1] for line in lines if line.startswith("property")]
    if len(props) < 14:
        raise ValueError(f"{path} has too few PLY properties: {len(props)}")
    return header, vertex_count, props


def load_splats(path: Path, max_rows: int | None) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    header, count, props = read_ply_header(path)
    if max_rows is not None:
        count = min(count, max_rows)
    data = np.asarray(
        np.memmap(path, dtype="<f4", mode="r", offset=len(header), shape=(count, len(props))),
        dtype=np.float64,
    )
    data = data[np.all(np.isfinite(data), axis=1)]
    col = {name: i for i, name in enumerate(props)}
    rgb_cols = [col.get(f"f_dc_{i}", 10 + i) for i in range(3)]
    rgb = np.clip(0.5 + 0.28209479177387814 * data[:, rgb_cols], 0, 1)
    return data, rgb, col
