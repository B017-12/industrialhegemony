import { useMemo } from "react";
import { useStore } from "../store.js";
import { conditionOf } from "./status.js";

export function useAssetIndex() {
  const assets = useStore((s) => s.assets);
  return useMemo(() => Object.fromEntries(assets.map((a) => [a.asset_id, a])), [assets]);
}

export function useAnchorIndex() {
  const anchors = useStore((s) => s.anchors);
  return useMemo(() => Object.fromEntries((anchors?.anchors ?? []).map((a) => [a.asset_id, a])), [anchors]);
}

export function sortAssets(list) {
  return [...list].sort(
    (a, b) =>
      conditionOf(a.condition_state).rank - conditionOf(b.condition_state).rank ||
      (a.health_score ?? 999) - (b.health_score ?? 999) ||
      a.tag.localeCompare(b.tag),
  );
}

export function usePlantKpis() {
  const sceneObjects = useStore((s) => s.sceneObjects);
  const assets = useStore((s) => s.assets);
  const openEvents = useStore((s) => s.openEvents);
  const nav = useStore((s) => s.nav);
  const anchors = useStore((s) => s.anchors);

  return useMemo(() => {
    const objects = sceneObjects?.objects ?? [];
    const framed = objects.filter((o) => o.source !== "structure_plane");
    const byCondition = {};
    for (const a of assets) byCondition[a.condition_state] = (byCondition[a.condition_state] || 0) + 1;
    const byMapping = {};
    for (const a of assets) if (a.mapping_method) byMapping[a.mapping_method] = (byMapping[a.mapping_method] || 0) + 1;
    const bound = assets.filter((a) => a.scene_object_id).length;
    return {
      framed: sceneObjects ? framed.length : null,
      structure: objects.length - framed.length,
      pipes: framed.filter((o) => o.class === "pipe").length,
      equipment: framed.filter((o) => o.class !== "pipe").length,
      assets: assets.length,
      bound,
      procedural: assets.filter((a) => a.mapping_method?.startsWith("procedural")).length,
      byMapping,
      byCondition,
      attention: (byCondition.attention_required || 0) + (byCondition.degraded || 0),
      openEvents: openEvents ? Object.values(openEvents).reduce((x, y) => x + y, 0) : null,
      reachable: anchors?.summary?.reachable ?? null,
      pathLengthM: nav?.stats?.path_length_m ?? nav?.path_length_m ?? null,
      durationS: nav?.stats?.duration_s ?? null,
      minClearanceM: nav?.stats?.min_clearance_m ?? null,
      targetAssetId: nav?.target_asset_id ?? null,
    };
  }, [sceneObjects, assets, openEvents, nav, anchors]);
}
