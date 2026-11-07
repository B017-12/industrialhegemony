// Writes a compressed, cropped copy of the supplied full-room splat for the viewer.
// Usage: node scripts/compress-splat.mjs   (from web/)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("..");
const input = resolve(root, "Equipment Room.ply");
const outDir = resolve("public/assets");
const outName = "equipment_room.spz";
const output = resolve(outDir, outName);

// Raw PLY frame (y-down). The 0.5-99.5 percentile splat bounds plus 0.3 units:
// keeps the whole room (99.1% of splats) and drops the far floaters.
const cropBox = [-5.2, -1.7, -4.2, 4.5, 1.7, 3.8];
const minOpacity = 0.01;

if (!existsSync(input)) {
  console.error(`Missing ${input}.`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const args = [
  "--yes",
  "@playcanvas/splat-transform",
  "-w",
  input,
  "--filter-nan",
  "--filter-box",
  cropBox.join(","),
  "--filter-value",
  `opacity,gte,${minOpacity}`,
  output,
];
const started = Date.now();
const result = spawnSync("npx", args, { stdio: "inherit" });
if (result.status !== 0) {
  console.error("splat-transform failed; the viewer will keep using the raw PLY.");
  process.exit(result.status ?? 1);
}

const manifest = {
  url: `/assets/${outName}`,
  fileType: "spz",
  fallbackUrl: "/assets/equipment_room.ply",
  sourceBytes: statSync(input).size,
  bytes: statSync(output).size,
  cropBox,
  minOpacity,
  seconds: Math.round((Date.now() - started) / 100) / 10,
  generatedAt: new Date().toISOString(),
};
writeFileSync(resolve(outDir, "splat-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(manifest);
