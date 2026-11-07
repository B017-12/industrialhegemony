import { useEffect, useMemo, useRef, useState } from "react";
import { loadNavMap } from "../data.js";
import { runtime } from "../scene/missionRuntime.js";
import { useStore } from "../store.js";
import { STATUS_HEX, statusHexOf } from "./status.js";

const WIDTH = 216;
const MARGIN_CELLS = 6;
const REDRAW_HZ = 15;
const PICK_RADIUS = 9;
// PGM values written by navigation.write_ros_map.
const OBSTACLE = 0;
const FLOOR = 254;

// Top-down occupancy inset: x to the right, raw +z up (the PGM is already
// flipped that way). Map metres / metres_per_unit = raw PLY units.
function buildMap(map, mpu) {
  const { width, height, pixels } = map;
  let [minI, minR, maxI, maxR] = [width, height, -1, -1];
  for (let r = 0; r < height; r += 1) {
    for (let i = 0; i < width; i += 1) {
      if (pixels[r * width + i] === 205) continue;
      minI = Math.min(minI, i);
      maxI = Math.max(maxI, i);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
  }
  if (maxI < 0) return null;
  minI = Math.max(0, minI - MARGIN_CELLS);
  minR = Math.max(0, minR - MARGIN_CELLS);
  maxI = Math.min(width - 1, maxI + MARGIN_CELLS);
  maxR = Math.min(height - 1, maxR + MARGIN_CELLS);
  const cw = maxI - minI + 1;
  const ch = maxR - minR + 1;

  const image = document.createElement("canvas");
  image.width = cw;
  image.height = ch;
  const ctx = image.getContext("2d");
  const data = ctx.createImageData(cw, ch);
  for (let r = 0; r < ch; r += 1) {
    for (let i = 0; i < cw; i += 1) {
      const v = pixels[(r + minR) * width + (i + minI)];
      const o = (r * cw + i) * 4;
      const [cr, cg, cb, ca] = v === OBSTACLE ? [74, 88, 108, 255] : v === FLOOR ? [32, 42, 55, 255] : [0, 0, 0, 0];
      data.data.set([cr, cg, cb, ca], o);
    }
  }
  ctx.putImageData(data, 0, 0);

  const cell = map.resolution / mpu;
  const x0 = map.origin[0] / mpu;
  const z0 = map.origin[1] / mpu;
  const scale = WIDTH / cw;
  return {
    image,
    width: WIDTH,
    height: Math.round(ch * scale),
    pxPerMetre: scale / map.resolution,
    // Raw (x, z) to inset pixels.
    toPx: (x, z) => [((x - x0) / cell - minI) * scale, (height - (z - z0) / cell - minR) * scale],
  };
}

export function Minimap() {
  const sceneObjects = useStore((s) => s.sceneObjects);
  const fullscreen = useStore((s) => s.ui.fullscreen);
  const canvasRef = useRef(null);
  const [map, setMap] = useState(null);

  useEffect(() => {
    let alive = true;
    loadNavMap()
      .then((m) => alive && setMap(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const view = useMemo(
    () => (map && sceneObjects ? buildMap(map, sceneObjects.metres_per_unit ?? 1) : null),
    [map, sceneObjects],
  );
  const bound = useMemo(() => sceneObjects?.objects.filter((o) => o.asset_id) ?? [], [sceneObjects]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!view || !canvas) return undefined;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = view.width * dpr;
    canvas.height = view.height * dpr;
    const ctx = canvas.getContext("2d");
    let frame = 0;
    let last = 0;

    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / REDRAW_HZ) return;
      last = now;
      const s = useStore.getState();
      const statusOf = new Map(s.assets.map((a) => [a.asset_id, a.condition_state]));
      const active = new Set(runtime.active);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, view.width, view.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(view.image, 0, 0, view.width, view.height);

      const samples = s.nav?.samples;
      if (samples?.length) {
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = `${STATUS_HEX.accent}88`;
        ctx.beginPath();
        samples.forEach((p, i) => ctx[i ? "lineTo" : "moveTo"](...view.toPx(p.pos[0], p.pos[2])));
        ctx.stroke();
        ctx.setLineDash([]);
        if (runtime.state !== "idle" && runtime.state !== "dispatched") {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = STATUS_HEX.accent;
          ctx.beginPath();
          for (let i = 0; i <= runtime.pose.index; i += 1) ctx[i ? "lineTo" : "moveTo"](...view.toPx(samples[i].pos[0], samples[i].pos[2]));
          ctx.lineTo(...view.toPx(runtime.pose.pos[0], runtime.pose.pos[2]));
          ctx.stroke();
        }
      }

      for (const o of bound) {
        const [x, y] = view.toPx(o.center[0], o.center[2]);
        if (x < -4 || y < -4 || x > view.width + 4 || y > view.height + 4) continue;
        const isTarget = o.asset_id === s.mission.targetAssetId;
        const selected = o.object_id === s.selectedId;
        ctx.fillStyle = statusHexOf(statusOf.get(o.asset_id));
        ctx.beginPath();
        ctx.arc(x, y, active.has(o.object_id) || isTarget ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (selected || isTarget) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = selected ? STATUS_HEX.accent : "#e6edf3";
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const [rx, ry] = view.toPx(runtime.pose.pos[0], runtime.pose.pos[2]);
      // Raw forward (sin yaw, cos yaw) in x-z; screen y points to -z.
      const fx = Math.sin(runtime.pose.yaw);
      const fy = -Math.cos(runtime.pose.yaw);
      ctx.fillStyle = STATUS_HEX.accent;
      ctx.strokeStyle = "#07090d";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rx + fx * 8, ry + fy * 8);
      ctx.lineTo(rx - fx * 4 - fy * 5, ry - fy * 4 + fx * 5);
      ctx.lineTo(rx - fx * 4 + fy * 5, ry - fy * 4 - fx * 5);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [view, bound]);

  if (!view || fullscreen) return null;

  const onClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let best = null;
    let bestD = PICK_RADIUS;
    for (const o of bound) {
      const [x, y] = view.toPx(o.center[0], o.center[2]);
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) [best, bestD] = [o, d];
    }
    if (best) useStore.getState().selectAsset(best.asset_id);
  };

  return (
    <figure data-label-occluder="" className="m-0 overflow-hidden rounded-md border border-line bg-surface-1/90 shadow-[var(--shadow-panel)]">
      <figcaption className="flex items-center justify-between px-2 pt-1.5 pb-1 text-2xs text-fg-subtle">
        <span className="font-medium tracking-[0.06em] uppercase">Floor map</span>
        <ScaleBar pxPerMetre={view.pxPerMetre} />
      </figcaption>
      <canvas
        ref={canvasRef}
        onClick={onClick}
        role="img"
        aria-label="Top-down floor map with the robot route, robot position and asset dots"
        style={{ width: view.width, height: view.height }}
        className="block cursor-pointer"
      />
    </figure>
  );
}

function ScaleBar({ pxPerMetre }) {
  return (
    <span className="flex items-center gap-1">
      <span aria-hidden className="h-1 border-x border-b border-fg-subtle" style={{ width: pxPerMetre }} />1 m
    </span>
  );
}
