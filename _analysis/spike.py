"""Feasibility spike: clean splats -> remove structure planes -> DBSCAN objects -> occupancy grid -> path."""
import time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.spatial import cKDTree
from scipy import ndimage
from sklearn.cluster import DBSCAN
from skimage.graph import route_through_array

PLY = "../Industrial Boiler Room (1).ply"
HEADER, N_VALID, STRIDE_F = 1503, 502482, 59
t0 = time.time()

raw = np.asarray(np.memmap(PLY, dtype="<f4", mode="r", offset=HEADER, shape=(N_VALID, STRIDE_F)), dtype=np.float64)
raw = raw[np.all(np.isfinite(raw), 1)]
xyz = raw[:, :3]
op = 1 / (1 + np.exp(-raw[:, 13]))
smax = np.exp(raw[:, 3:6]).max(1)
rgb = np.clip(0.5 + 0.28209479177387814 * raw[:, 10:13], 0, 1)

keep = (op > 0.3) & (smax < 0.08)
p, c = xyz[keep], rgb[keep]
d, _ = cKDTree(p).query(p, k=9)
md = d[:, 1:].mean(1)
inl = md < np.percentile(md, 95)
p, c = p[inl], c[inl]
print(f"after opacity/scale/outlier filter: {len(p)} splats ({time.time()-t0:.1f}s)")


def ransac_plane(pts, thresh, iters=400, normal_hint=None, hint_tol=0.9, rng=np.random.default_rng(0)):
    best, best_n = None, -1
    for _ in range(iters):
        s = pts[rng.choice(len(pts), 3, replace=False)]
        n = np.cross(s[1] - s[0], s[2] - s[0])
        if np.linalg.norm(n) < 1e-9:
            continue
        n /= np.linalg.norm(n)
        if normal_hint is not None and abs(n @ normal_hint) < hint_tol:
            continue
        dd = -n @ s[0]
        cnt = (np.abs(pts @ n + dd) < thresh).sum()
        if cnt > best_n:
            best, best_n = (n, dd), cnt
    return best


UP = np.array([0, -1.0, 0])  # scene is y-down
structure = np.zeros(len(p), bool)
planes = []
# floor + ceiling (horizontal), then up to 4 dominant vertical walls
for label, hint, tol, region in [
    ("floor", UP, 0.95, p[:, 1] > 0.9),
    ("ceiling", UP, 0.95, p[:, 1] < -0.7),
]:
    n, dd = ransac_plane(p[region], 0.03, normal_hint=hint, hint_tol=tol)
    m = np.abs(p @ n + dd) < 0.04
    structure |= m
    planes.append((label, n, dd, int(m.sum())))
for k in range(4):
    rest = p[~structure]
    n, dd = ransac_plane(rest, 0.025, normal_hint=UP, hint_tol=0.0)
    if abs(n @ UP) > 0.1:
        continue
    m = (np.abs(p @ n + dd) < 0.03) & ~structure
    if m.sum() < 0.03 * len(p):
        break
    structure |= m
    planes.append((f"wall{k}", n, dd, int(m.sum())))
for pl in planes:
    print(f"  plane {pl[0]}: normal={np.round(pl[1],3)} d={pl[2]:.3f} inliers={pl[3]}")
floor_n, floor_d = planes[0][1], planes[0][2]
floor_y = -floor_d / floor_n[1]
print(f"floor y ≈ {floor_y:.3f} (y-down)")

obj = p[~structure]
objc = c[~structure]
# voxel downsample 2 cm-units
vox = np.floor(obj / 0.02).astype(np.int64)
_, first = np.unique(vox, axis=0, return_index=True)
obj_ds, objc_ds = obj[first], objc[first]
print(f"object candidates after plane removal + voxel: {len(obj_ds)} ({time.time()-t0:.1f}s)")

lab = DBSCAN(eps=0.045, min_samples=12, n_jobs=-1).fit_predict(obj_ds)
ids, counts = np.unique(lab[lab >= 0], return_counts=True)
print(f"DBSCAN clusters: {len(ids)}; noise frac {np.mean(lab<0):.2f}")
order = np.argsort(-counts)
print("largest 8 cluster sizes:", counts[order[:8]].tolist(), "largest frac of clustered:", round(counts.max() / counts.sum(), 3))
boxes = []
for i in ids[counts >= 60]:
    q = obj_ds[lab == i]
    lo, hi = np.percentile(q, 2, 0), np.percentile(q, 98, 0)
    ext = hi - lo
    if ext.max() > 3.0 or ext.max() < 0.06:
        continue
    boxes.append((i, lo, hi, len(q)))
print(f"framable clusters (60+ pts, 0.06-3.0 unit extent): {len(boxes)}")

# occupancy grid on floor plane (x,z), obstacle band = 0.1..1.6 units above floor
cell = 0.05
xmin, zmin = p[:, 0].min(), p[:, 2].min()
W = int((p[:, 0].max() - xmin) / cell) + 1
H = int((p[:, 2].max() - zmin) / cell) + 1
height = floor_y - p[:, 1]
gi = ((p[:, 0] - xmin) / cell).astype(int)
gj = ((p[:, 2] - zmin) / cell).astype(int)
occ = np.zeros((H, W), int)
np.add.at(occ, (gj[(height > 0.12) & (height < 1.6)], gi[(height > 0.12) & (height < 1.6)]), 1)
sup = np.zeros((H, W), int)
fm = np.abs(height) < 0.05
np.add.at(sup, (gj[fm], gi[fm]), 1)
blocked = occ >= 3
support = ndimage.binary_closing(sup >= 2, iterations=2)
free = support & ~ndimage.binary_dilation(blocked, iterations=4)  # ~0.2 unit clearance
lbl, nl = ndimage.label(free)
big = lbl == (np.argmax(np.bincount(lbl.ravel())[1:]) + 1)
fy, fx = np.nonzero(big)
a = (fy[np.argmin(fx)], fx[np.argmin(fx)])
b = (fy[np.argmax(fx)], fx[np.argmax(fx)])
cost = np.where(big, 1.0, np.inf)
dist = ndimage.distance_transform_edt(big)
cost = np.where(big, 1.0 + 3.0 / (1 + dist), 1e6)
path, pc = route_through_array(cost, a, b, fully_connected=True, geometric=True)
path = np.array(path)
print(f"free floor cells: {big.sum()} ({big.sum()*cell*cell:.2f} unit^2); path cells {len(path)}, length ≈ {len(path)*cell:.2f} units ({time.time()-t0:.1f}s)")

fig, ax = plt.subplots(1, 2, figsize=(22, 8))
ax[0].imshow(np.where(blocked, 2, np.where(big, 1, 0)), origin="lower", cmap="gray_r",
             extent=[xmin, xmin + W * cell, zmin, zmin + H * cell])
ax[0].plot(xmin + path[:, 1] * cell, zmin + path[:, 0] * cell, "r-", lw=2)
ax[0].set_title("occupancy (black=obstacle, grey=walkable w/ clearance) + A*/MCP path")
cmap = plt.get_cmap("tab20")
o = np.argsort(obj_ds[:, 2])
cols = np.array([cmap(l % 20)[:3] if l >= 0 else (0.85, 0.85, 0.85) for l in lab])
ax[1].scatter(obj_ds[o, 0], -obj_ds[o, 1], c=cols[o], s=0.6)
for i, lo, hi, n in boxes:
    ax[1].add_patch(plt.Rectangle((lo[0], -hi[1]), hi[0] - lo[0], hi[1] - lo[1], fill=False, ec="r", lw=0.6))
ax[1].set_aspect("equal")
ax[1].set_title(f"front view: {len(boxes)} framable DBSCAN clusters (red boxes)")
plt.tight_layout()
plt.savefig("spike_result.png", dpi=70)
print(f"done {time.time()-t0:.1f}s")
