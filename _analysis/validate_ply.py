"""Check a 3DGS PLY for corrupt rows. Usage: python3 validate_ply.py "Industrial Boiler Room.ply" [--write-clean out.ply]"""
import hashlib
import sys
import numpy as np

path = sys.argv[1]
with open(path, "rb") as f:
    header = b""
    while not header.endswith(b"end_header\n"):
        header += f.readline()
lines = header.decode().splitlines()
n = int(next(l for l in lines if l.startswith("element vertex")).split()[-1])
props = [l.split()[-1] for l in lines if l.startswith("property")]
print("header comment:", [l for l in lines if l.startswith("comment")])
print(f"vertices={n} properties={len(props)} -> {props[:14]} ... ({len(props)-14} more)")
print("label/instance-like properties:", [p for p in props if any(k in p.lower() for k in ("label", "class", "instance", "segment", "object", "semantic"))] or "none")

a = np.memmap(path, dtype="<f4", mode="r", offset=len(header), shape=(n, len(props)))
col = {p: i for i, p in enumerate(props)}
with np.errstate(all="ignore"):
    A = np.asarray(a, dtype=np.float64)
    xyz = A[:, :3]
    scale = A[:, [col["scale_0"], col["scale_1"], col["scale_2"]]]
    quat = A[:, [col["rot_0"], col["rot_1"], col["rot_2"], col["rot_3"]]]
    qn = np.linalg.norm(quat, axis=1)
    sh = A[:, col["f_dc_0"]:]
    ok = (
        np.all(np.isfinite(A), 1)
        & np.all(np.abs(xyz) < 1e3, 1)
        & np.all((scale > -30) & (scale < 10), 1)
        & (qn > 1e-3) & (qn < 1e3)
        & np.all(np.abs(sh) < 100, 1)
    )
print(f"plausible rows: {ok.sum()} / {n} ({ok.mean():.1%}); NaN/Inf rows: {(~np.all(np.isfinite(A), 1)).sum()}")
if not ok.all():
    bad = np.where(~ok)[0]
    print(f"first implausible row: {bad[0]}; implausible rows after it: {(~ok[bad[0]:]).mean():.1%}")
h = hashlib.sha256()
with open(path, "rb") as f:
    for chunk in iter(lambda: f.read(1 << 24), b""):
        h.update(chunk)
print("sha256:", h.hexdigest())

if "--write-clean" in sys.argv:
    out = sys.argv[sys.argv.index("--write-clean") + 1]
    good = np.asarray(a[ok])
    new_header = header.decode().replace(f"element vertex {n}", f"element vertex {len(good)}").encode()
    with open(out, "wb") as f:
        f.write(new_header)
        f.write(good.astype("<f4").tobytes())
    print(f"wrote {len(good)} rows to {out}")
