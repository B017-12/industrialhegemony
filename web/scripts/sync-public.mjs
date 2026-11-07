import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

// The compressed splat (public/assets/equipment_room.spz + splat-manifest.json)
// is written by scripts/compress-splat.mjs and is not managed here.
const root = resolve("..");
const copies = [
  ["Equipment Room.ply", "public/assets/equipment_room.ply"],
  ["data/derived/scene_objects.json", "public/data/derived/scene_objects.json"],
  ["data/derived/labels_override.json", "public/data/derived/labels_override.json"],
  ["data/derived/nav.json", "public/data/derived/nav.json"],
  ["data/derived/nav_targets.json", "public/data/derived/nav_targets.json"],
  ["data/derived/nav_map.pgm", "public/data/derived/nav_map.pgm"],
  ["data/derived/nav_map.yaml", "public/data/derived/nav_map.yaml"],
  ["data/derived/floor_occ.png", "public/data/derived/floor_occ.png"],
];

function unchanged(src, dest) {
  if (!existsSync(dest)) return false;
  const a = statSync(src);
  const b = statSync(dest);
  return a.size === b.size && a.mtimeMs <= b.mtimeMs;
}

for (const [from, to] of copies) {
  const src = resolve(root, from);
  const dest = resolve(to);
  if (!existsSync(src) || unchanged(src, dest)) continue;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
