"""Minimal numpy readers for COLMAP binary models (cameras.bin, images.bin, points3D.bin).

COLMAP 4.x keeps these three files in the legacy layout and adds rigs.bin/frames.bin,
which are not needed for single-camera video.
"""
from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

CAMERA_PARAMS = {0: ("SIMPLE_PINHOLE", 3), 1: ("PINHOLE", 4), 2: ("SIMPLE_RADIAL", 4), 3: ("RADIAL", 5), 4: ("OPENCV", 8)}


def read_cameras(path: Path) -> dict[int, dict]:
    cams = {}
    with open(path, "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        for _ in range(n):
            cid, model, w, h = struct.unpack("<iiQQ", f.read(24))
            name, k = CAMERA_PARAMS[model]
            params = np.frombuffer(f.read(8 * k), dtype="<f8")
            cams[cid] = {"model": name, "width": w, "height": h, "params": params}
    return cams


def qvec_to_rot(q: np.ndarray) -> np.ndarray:
    w, x, y, z = q / np.linalg.norm(q)
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ]
    )


def read_images(path: Path) -> dict[int, dict]:
    """World-to-camera poses: x_cam = R @ X + t."""
    images = {}
    with open(path, "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        for _ in range(n):
            iid = struct.unpack("<i", f.read(4))[0]
            q = np.array(struct.unpack("<4d", f.read(32)))
            t = np.array(struct.unpack("<3d", f.read(24)))
            cid = struct.unpack("<i", f.read(4))[0]
            name = b""
            while (c := f.read(1)) != b"\x00":
                name += c
            (npts,) = struct.unpack("<Q", f.read(8))
            obs = np.frombuffer(f.read(24 * npts), dtype=np.dtype([("xy", "<f8", 2), ("pid", "<i8")]))
            images[iid] = {"name": name.decode(), "camera_id": cid, "R": qvec_to_rot(q), "t": t, "xy": obs["xy"], "pid": obs["pid"]}
    return images


def read_points3d(path: Path) -> dict[str, np.ndarray]:
    ids, xyz, rgb, err, track = [], [], [], [], []
    with open(path, "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        for _ in range(n):
            pid = struct.unpack("<Q", f.read(8))[0]
            p = struct.unpack("<3d", f.read(24))
            c = struct.unpack("<3B", f.read(3))
            e = struct.unpack("<d", f.read(8))[0]
            (tl,) = struct.unpack("<Q", f.read(8))
            f.read(8 * tl)
            ids.append(pid)
            xyz.append(p)
            rgb.append(c)
            err.append(e)
            track.append(tl)
    return {"id": np.array(ids), "xyz": np.array(xyz), "rgb": np.array(rgb, dtype=np.uint8), "error": np.array(err), "track": np.array(track)}


def camera_centres(images: dict[int, dict]) -> tuple[list[str], np.ndarray, np.ndarray]:
    """Names (sorted), camera centres C = -R^T t, and camera-to-world rotations R^T."""
    order = sorted(images, key=lambda i: images[i]["name"])
    names = [images[i]["name"] for i in order]
    centres = np.array([-images[i]["R"].T @ images[i]["t"] for i in order])
    c2w = np.array([images[i]["R"].T for i in order])
    return names, centres, c2w
