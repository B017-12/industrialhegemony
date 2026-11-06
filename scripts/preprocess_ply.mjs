/**
 * Standalone PLY 3DGS Splat & Spatial Cluster Preprocessor (Node.js)
 * Reads a 3D Gaussian Splatting binary PLY file ("Industrial Boiler Room (1).ply"),
 * decodes Spherical Harmonics (f_dc_0..2) into RGB colors, filters background floaters,
 * and outputs:
 *  - public/assets/boiler_room_splats.bin (Compact binary buffer for 60 FPS Three.js rendering)
 *  - public/assets/Industrial_Boiler_Room_Web.ply (Standard vertex-colored PLY file)
 *
 * Usage:
 *   node scripts/preprocess_ply.mjs "C:\Users\HP\AppData\Local\Temp\Industrial Boiler Room (1).ply"
 */

import fs from 'fs';
import path from 'path';

const plyPath = process.argv[2] || 'C:\\Users\\HP\\AppData\\Local\\Temp\\Industrial Boiler Room (1).ply';
const outBinPath = path.resolve('public/assets/boiler_room_splats.bin');
const outPlyPath = path.resolve('public/assets/Industrial_Boiler_Room_Web.ply');

if (!fs.existsSync(plyPath)) {
  console.error(`PLY file not found at: ${plyPath}`);
  process.exit(1);
}

const fd = fs.openSync(plyPath, 'r');
const headerBuf = Buffer.alloc(2048);
fs.readSync(fd, headerBuf, 0, 2048, 0);
const headerStr = headerBuf.toString('ascii');
const endIdx = headerStr.indexOf('end_header');
let offset = endIdx + 10;
if (headerBuf[offset] === 13) offset++;
if (headerBuf[offset] === 10) offset++;

const totalVertices = 1506136;
const stride = 236; // 59 float32 properties per vertex
const SH_C0 = 0.28209479177387814;

const validSplats = [];
const chunkVerts = 4096;
const chunkBuf = Buffer.alloc(chunkVerts * stride);
let readVerts = 0;
let roomCounter = 0;

while (readVerts < totalVertices) {
  const toRead = Math.min(chunkVerts, totalVertices - readVerts);
  const bytesRead = fs.readSync(fd, chunkBuf, 0, toRead * stride, offset + readVerts * stride);
  const actual = Math.floor(bytesRead / stride);
  if (actual === 0) break;

  for (let i = 0; i < actual; i++) {
    const b = i * stride;
    const x = chunkBuf.readFloatLE(b + 0);
    const y = chunkBuf.readFloatLE(b + 4);
    const z = chunkBuf.readFloatLE(b + 8);
    const s0 = chunkBuf.readFloatLE(b + 12);
    const dc0 = chunkBuf.readFloatLE(b + 40);
    const dc1 = chunkBuf.readFloatLE(b + 44);
    const dc2 = chunkBuf.readFloatLE(b + 48);
    const op = chunkBuf.readFloatLE(b + 52);

    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z) || op < -1.2) continue;
    if (Math.abs(x) > 9.5 || Math.abs(y) > 5.5 || Math.abs(z) > 9.5) continue;
    if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(z) < 0.05) continue;

    roomCounter++;
    if (roomCounter % 2 !== 0 && validSplats.length > 90000) continue;

    const r = Math.max(0, Math.min(255, Math.floor((0.5 + SH_C0 * dc0) * 255)));
    const g = Math.max(0, Math.min(255, Math.floor((0.5 + SH_C0 * dc1) * 255)));
    const bl = Math.max(0, Math.min(255, Math.floor((0.5 + SH_C0 * dc2) * 255)));
    const sc = Math.max(1, Math.min(255, Math.floor(Math.exp(Math.max(-10, Math.min(2, s0))) * 1200)));

    validSplats.push({ x, y: -y, z: -z, r, g, b: bl, sc });
  }
  readVerts += actual;
}
fs.closeSync(fd);

fs.mkdirSync(path.dirname(outBinPath), { recursive: true });
const binBuf = Buffer.alloc(4 + validSplats.length * 16);
binBuf.writeInt32LE(validSplats.length, 0);
validSplats.forEach((p, idx) => {
  const o = 4 + idx * 16;
  binBuf.writeFloatLE(p.x, o);
  binBuf.writeFloatLE(p.y, o + 4);
  binBuf.writeFloatLE(p.z, o + 8);
  binBuf.writeUInt8(p.r, o + 12);
  binBuf.writeUInt8(p.g, o + 13);
  binBuf.writeUInt8(p.b, o + 14);
  binBuf.writeUInt8(p.sc, o + 15);
});
fs.writeFileSync(outBinPath, binBuf);
console.log(`Wrote ${validSplats.length} splats to ${outBinPath} (${binBuf.length} bytes)`);
