import { useFrame } from "@react-three/fiber";
import { CircleDashed } from "lucide-react";
import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { useStore } from "../store.js";
import { assetClassOf, conditionOf, fmt, mappingOf, TONES } from "../ui/status.js";
import { rawToDisplay } from "./frame.js";
import { runtime } from "./missionRuntime.js";

const UPDATE_HZ = 30;
const NEAR_UNITS = 3.2; // every asset shows its tag inside this camera distance
const PAD = 4;
const EDGE = 6;
const STEM = 10;
const POST_ARRIVAL = new Set(["arrived", "diagnosing", "report"]);
const ABNORMAL = new Set(["attention_required", "degraded"]);

// object_id -> { el, body, sizes: { tag, card } }. Filled by LabelLayer (DOM,
// outside the Canvas) and positioned by LabelProjector (inside the Canvas).
const labelNodes = new Map();

function anchorOf(object) {
  const obb = object.obb;
  const half = obb ? obb.extent[1] / 2 : (object.aabb_max[1] - object.aabb_min[1]) / 2;
  const centre = obb?.center ?? object.center;
  // Raw frame is y-down: the top of the box is centre.y - half.
  return rawToDisplay([centre[0], centre[1] - half, centre[2]]);
}

function overlaps(a, list) {
  for (const b of list) {
    if (a[0] < b[0] + b[2] + PAD && a[0] + a[2] + PAD > b[0] && a[1] < b[1] + b[3] + PAD && a[1] + a[3] + PAD > b[1]) return true;
  }
  return false;
}

// Horizontal shift that keeps a label body inside the viewer.
function edgeShift(x, w, width) {
  const left = x - w / 2;
  if (left < EDGE) return EDGE - left;
  if (left + w > width - EDGE) return width - EDGE - (left + w);
  return 0;
}

function rectFor(lod, x, y, size, width) {
  if (lod === "dot") return [x - 5, y - 5, 10, 10];
  return [x - size[0] / 2 + edgeShift(x, size[0], width), y - STEM - size[1], size[0], size[1]];
}

// Inside the Canvas: projects the top of each bound OBB, picks a level of
// detail and places labels greedily by priority so they never overlap.
export function LabelProjector({ objects }) {
  const since = useRef(0);
  const items = useMemo(
    () =>
      objects
        .filter((o) => o.asset_id)
        .map((o) => ({ object: o, anchor: anchorOf(o), state: { x: NaN, y: NaN, lod: "", visible: null } })),
    [objects],
  );
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, size, gl }, delta) => {
    since.current += delta;
    if (since.current < 1 / UPDATE_HZ) return;
    since.current = 0;

    const s = useStore.getState();
    const statusOf = new Map(s.assets.map((a) => [a.asset_id, a.condition_state]));
    const active = new Set(runtime.active);
    const lit = new Set(s.highlight?.assetIds ?? []);
    const missionLive = runtime.state !== "idle";
    const arrived = POST_ARRIVAL.has(runtime.state);
    const candidates = [];

    for (const item of items) {
      const node = labelNodes.get(item.object.object_id);
      if (!node) continue;
      const { asset_id: assetId, object_id: id } = item.object;
      v.copy(item.anchor).project(camera);
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      if (!onScreen) {
        candidates.push({ item, node, hidden: true });
        continue;
      }
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      const dist = camera.position.distanceTo(item.anchor);
      const abnormal = ABNORMAL.has(statusOf.get(assetId));
      const isTarget = assetId === s.mission.targetAssetId;

      let lod = "dot";
      let priority = 6;
      if (assetId === s.selectedAssetId) [lod, priority] = ["card", 0];
      else if (isTarget && arrived) [lod, priority] = ["card", 1];
      else if (missionLive && active.has(id)) [lod, priority] = ["card", 2];
      else if (lit.has(assetId)) [lod, priority] = ["tag", 2];
      else if (isTarget) [lod, priority] = ["tag", 3];
      else if (abnormal) [lod, priority] = ["tag", 4];
      else if (dist < NEAR_UNITS) [lod, priority] = ["tag", 5];
      candidates.push({ item, node, x, y, lod, priority, dist });
    }

    candidates.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || (a.dist ?? 0) - (b.dist ?? 0));
    // Viewer chrome (feed, minimap, legend) counts as already placed.
    const origin = gl.domElement.getBoundingClientRect();
    const placed = [...document.querySelectorAll("[data-label-occluder]")].map((el) => {
      const r = el.getBoundingClientRect();
      return [r.left - origin.left, r.top - origin.top, r.width, r.height];
    });
    for (const c of candidates) {
      let lod = c.hidden ? null : c.lod;
      while (lod) {
        if (lod !== "dot" && !c.node.sizes[lod]) {
          // Measure once per level of detail; layout is read only here.
          c.node.el.dataset.lod = lod;
          c.node.sizes[lod] = [c.node.body.offsetWidth, c.node.body.offsetHeight];
        }
        const rect = rectFor(lod, c.x, c.y, c.node.sizes[lod], size.width);
        if (!overlaps(rect, placed)) {
          placed.push(rect);
          break;
        }
        lod = lod === "card" ? "tag" : lod === "tag" ? "dot" : null;
      }
      const st = c.item.state;
      const visible = Boolean(lod);
      if (visible !== st.visible) {
        st.visible = visible;
        c.node.el.dataset.visible = String(visible);
      }
      if (!visible) continue;
      if (lod !== st.lod || c.node.el.dataset.lod !== lod) {
        st.lod = lod;
        c.node.el.dataset.lod = lod;
      }
      const x = Math.round(c.x);
      const y = Math.round(c.y);
      if (x !== st.x || y !== st.y) {
        st.x = x;
        st.y = y;
        c.node.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      const shift = lod === "dot" ? 0 : Math.round(edgeShift(c.x, c.node.sizes[lod][0], size.width));
      if (shift !== st.shift) {
        st.shift = shift;
        c.node.body.style.setProperty("--shift", `${shift}px`);
      }
    }
  });

  return null;
}

// Outside the Canvas, inside .viewer: the DOM for every bound asset's label.
// React re-renders it only when asset data or status lines change.
export const LabelLayer = memo(function LabelLayer() {
  const sceneObjects = useStore((s) => s.sceneObjects);
  const assets = useStore((s) => s.assets);
  const statusLines = useStore((s) => s.statusLines);
  const selectAsset = useStore((s) => s.selectAsset);
  const assetIndex = useMemo(() => Object.fromEntries(assets.map((a) => [a.asset_id, a])), [assets]);
  const bound = useMemo(() => sceneObjects?.objects.filter((o) => o.asset_id) ?? [], [sceneObjects]);

  return (
    <div className="labels3d" aria-hidden="true">
      {bound.map((object) => {
        const asset = assetIndex[object.asset_id];
        const condition = conditionOf(asset?.condition_state);
        const tone = TONES[condition.tone];
        const StatusIcon = condition.icon;
        const mapping = mappingOf(object.mapping_method);
        const tag = asset?.tag ?? object.display_label?.split(" ")[0] ?? object.asset_id;
        const line = statusLines[object.asset_id];
        return (
          <div
            key={object.object_id}
            className="label3d"
            data-lod="dot"
            data-visible="false"
            ref={(el) => {
              if (el) labelNodes.set(object.object_id, { el, body: el.querySelector(".label3d-body"), sizes: {} });
              else labelNodes.delete(object.object_id);
            }}
          >
            <span className={`label3d-dot ${tone.dot}`} />
            <span className="label3d-stem" />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => selectAsset(object.asset_id)}
              className={`label3d-body ${tone.border}`}
            >
              <span className="label3d-head">
                <span className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} />
                <span className="font-mono font-medium text-fg">{tag}</span>
                <StatusIcon className={`size-3 shrink-0 ${tone.text}`} />
                <span className="label3d-class text-fg-muted">{assetClassOf(asset?.asset_class).label}</span>
              </span>
              <span className="label3d-card">
                <span className={`font-medium ${tone.text}`}>{condition.long}</span>
                {line && <span className="label3d-line text-fg-muted">{line}</span>}
                {mapping.procedural && (
                  <span className="flex items-center gap-1 text-status-procedural">
                    <CircleDashed className="size-3" /> {mapping.long}
                    {object.mapping_confidence != null && ` · ${fmt(object.mapping_confidence * 100, 0)}%`}
                  </span>
                )}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});
