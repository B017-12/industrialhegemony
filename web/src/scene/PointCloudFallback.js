import * as THREE from "three";

const SH_C0 = 0.28209479177387814;
const MAX_POINTS = 130000;

// Sampled point cloud read straight from the PLY. Only used when Spark fails.
export async function loadPointCloud(url, onProgress) {
  const buffer = await fetchWithProgress(url, onProgress);
  const bytes = new Uint8Array(buffer);
  const marker = new TextEncoder().encode("end_header\n");
  const headerEnd = indexOf(bytes, marker);
  if (headerEnd < 0) throw new Error("PLY header not found");

  const header = new TextDecoder().decode(buffer.slice(0, headerEnd));
  const count = Number(header.match(/element vertex\s+(\d+)/)?.[1] ?? 0);
  const props = [...header.matchAll(/^property\s+\w+\s+(\S+)/gm)].map((m) => m[1]);
  const col = Object.fromEntries(props.map((name, index) => [name, index]));
  const stride = props.length * 4;
  const step = Math.max(1, Math.ceil(count / MAX_POINTS));
  const positions = new Float32Array(Math.ceil(count / step) * 3);
  const colours = new Float32Array(positions.length);
  const view = new DataView(buffer, headerEnd);

  let out = 0;
  for (let i = 0; i < count; i += step) {
    const base = i * stride;
    const x = view.getFloat32(base + col.x * 4, true);
    const y = view.getFloat32(base + col.y * 4, true);
    const z = view.getFloat32(base + col.z * 4, true);
    if (!Number.isFinite(x + y + z)) continue;
    positions.set([x, y, z], out * 3);
    for (let c = 0; c < 3; c += 1) {
      const dc = view.getFloat32(base + col[`f_dc_${c}`] * 4, true);
      colours[out * 3 + c] = Math.max(0, Math.min(1, 0.5 + SH_C0 * dc));
    }
    out += 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions.slice(0, out * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours.slice(0, out * 3), 3));
  const cloud = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.018, vertexColors: true }));
  cloud.name = "Sampled PLY fallback";
  return { object: cloud, count: out };
}

async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Unable to fetch ${url}`);
  const total = Number(response.headers.get("content-length") || 0);
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.buffer;
}

function indexOf(bytes, marker) {
  outer: for (let i = 0; i <= bytes.length - marker.length; i += 1) {
    for (let j = 0; j < marker.length; j += 1) {
      if (bytes[i + j] !== marker[j]) continue outer;
    }
    return i + marker.length;
  }
  return -1;
}
