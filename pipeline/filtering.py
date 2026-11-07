from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.spatial import cKDTree

SH_C0 = 0.28209479177387814


@dataclass
class SplatCloud:
    xyz: np.ndarray
    opacity: np.ndarray
    scales: np.ndarray
    normal: np.ndarray
    rgb: np.ndarray
    lab: np.ndarray

    def __len__(self) -> int:
        return len(self.xyz)

    def subset(self, mask: np.ndarray) -> "SplatCloud":
        return SplatCloud(*(getattr(self, name)[mask] for name in ("xyz", "opacity", "scales", "normal", "rgb", "lab")))


@dataclass
class VoxelCloud:
    xyz: np.ndarray
    lab: np.ndarray
    rgb: np.ndarray
    weight: np.ndarray
    count: np.ndarray
    voxel: float
    stats: dict[str, Any] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.xyz)

    def subset(self, mask: np.ndarray) -> "VoxelCloud":
        return VoxelCloud(self.xyz[mask], self.lab[mask], self.rgb[mask], self.weight[mask], self.count[mask], self.voxel, self.stats)


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m = np.array(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ]
    )
    xyz = linear @ m.T / np.array([0.95047, 1.0, 1.08883])
    eps, kappa = 216 / 24389, 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16) / 116)
    return np.column_stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])])


def quaternion_to_matrix(q: np.ndarray) -> np.ndarray:
    q = q / np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)
    w, x, y, z = q.T
    return np.stack(
        [
            np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], axis=-1),
            np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], axis=-1),
            np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], axis=-1),
        ],
        axis=1,
    )


def splat_cloud(data: np.ndarray, col: dict[str, int]) -> SplatCloud:
    xyz = data[:, [col["x"], col["y"], col["z"]]]
    opacity = 1 / (1 + np.exp(-data[:, col["opacity"]]))
    scales = np.exp(data[:, [col["scale_0"], col["scale_1"], col["scale_2"]]])
    rotation = quaternion_to_matrix(data[:, [col["rot_0"], col["rot_1"], col["rot_2"], col["rot_3"]]])
    # Sigma = R S S^T R^T: eigenvalues are scales**2, eigenvectors are the columns of R,
    # so the splat's surface normal is the column of R along its smallest scale.
    smallest = scales.argmin(axis=1)
    normal = rotation[np.arange(len(data)), :, smallest]
    rgb = np.clip(0.5 + SH_C0 * data[:, [col["f_dc_0"], col["f_dc_1"], col["f_dc_2"]]], 0, 1)
    return SplatCloud(xyz, opacity, scales, normal, rgb, srgb_to_lab(rgb))


def clean_splats(
    cloud: SplatCloud,
    min_opacity: float = 0.1,
    max_sigma: float = 0.05,
    sor_k: int = 16,
    sor_alpha: float = 2.0,
) -> tuple[SplatCloud, dict[str, Any]]:
    stats: dict[str, Any] = {"input": len(cloud)}
    plausible = np.all(np.abs(cloud.xyz) < 1e3, axis=1)
    opaque = cloud.opacity >= min_opacity
    compact = cloud.scales.max(axis=1) <= max_sigma
    keep = plausible & opaque & compact
    stats["dropped_low_opacity"] = int((plausible & ~opaque).sum())
    stats["dropped_large_covariance"] = int((plausible & opaque & ~compact).sum())
    cloud = cloud.subset(keep)

    distances, _ = cKDTree(cloud.xyz).query(cloud.xyz, k=sor_k + 1)
    mean_distance = distances[:, 1:].mean(axis=1)
    limit = float(mean_distance.mean() + sor_alpha * mean_distance.std())
    inlier = mean_distance <= limit
    stats["dropped_sor_outliers"] = int((~inlier).sum())
    stats["sor_limit"] = round(limit, 5)
    cloud = cloud.subset(inlier)
    stats["kept"] = len(cloud)
    stats["params"] = {"min_opacity": min_opacity, "max_sigma": max_sigma, "sor_k": sor_k, "sor_alpha": sor_alpha}
    return cloud, stats


def voxel_aggregate(cloud: SplatCloud, voxel: float = 0.02, min_weight: float = 0.3) -> VoxelCloud:
    keys = np.floor(cloud.xyz / voxel).astype(np.int64)
    _, inverse, count = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.ravel()
    w = cloud.opacity
    weight = np.bincount(inverse, weights=w)

    def weighted_mean(values: np.ndarray) -> np.ndarray:
        return np.column_stack([np.bincount(inverse, weights=w * values[:, i]) for i in range(values.shape[1])]) / weight[:, None]

    voxels = VoxelCloud(weighted_mean(cloud.xyz), weighted_mean(cloud.lab), weighted_mean(cloud.rgb), weight, count, voxel)
    dense = weight >= min_weight
    voxels = voxels.subset(dense)
    voxels.stats = {"voxel": voxel, "min_weight": min_weight, "voxels": int(dense.sum()), "dropped_sparse_voxels": int((~dense).sum())}
    return voxels
