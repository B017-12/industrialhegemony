import { useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { useEffect, useState } from "react";
import { getOptionalJson } from "../data.js";
import { useStore } from "../store.js";
import { loadPointCloud } from "./PointCloudFallback.js";

const PLY_URL = "/assets/equipment_room.ply";
const MANIFEST_URL = "/assets/splat-manifest.json";

// Spark level of detail is opt-in (?lod=on, budget via ?splats=250000): on the
// Radeon Pro 5300M it was slower than drawing all 466K splats.
const params = new URLSearchParams(window.location.search);
export const SPLAT_QUALITY = {
  lod: params.get("lod") === "on",
  lodSplatCount: Number(params.get("splats")) || 250000,
};

// Module-level singletons: the splat is fetched and decoded once per page load,
// whatever React does with the component tree.
let splatPromise = null;
const sparkByRenderer = new WeakMap();

function getSparkRenderer(gl) {
  if (!sparkByRenderer.has(gl)) {
    sparkByRenderer.set(
      gl,
      new SparkRenderer({ renderer: gl, enableLod: SPLAT_QUALITY.lod, lodSplatCount: SPLAT_QUALITY.lodSplatCount }),
    );
  }
  return sparkByRenderer.get(gl);
}

async function loadSplatMesh(url, fileType) {
  const { setSplat } = useStore.getState();
  setSplat({ state: "loading", url, loadedBytes: 0, totalBytes: 0 });
  const mesh = new SplatMesh({
    url,
    fileType,
    lod: SPLAT_QUALITY.lod,
    onProgress: (event) => {
      const done = event.total > 0 && event.loaded >= event.total;
      setSplat({
        state: done ? "decoding" : "loading",
        loadedBytes: event.loaded,
        totalBytes: event.total,
      });
    },
  });
  await mesh.initialized;
  return mesh;
}

async function loadOnce() {
  const { setSplat } = useStore.getState();
  const started = performance.now();
  const manifest = await getOptionalJson(MANIFEST_URL);
  const sources = manifest?.url
    ? [
        { url: manifest.url, fileType: manifest.fileType },
        { url: PLY_URL, fileType: "ply" },
      ]
    : [{ url: PLY_URL, fileType: "ply" }];

  let lastError = null;
  for (const source of sources) {
    try {
      const mesh = await loadSplatMesh(source.url, source.fileType);
      setSplat({
        state: "ready",
        mode: "spark",
        splatCount: mesh.packedSplats?.numSplats ?? null,
        loadMs: Math.round(performance.now() - started),
      });
      return mesh;
    } catch (error) {
      console.warn(`Spark could not load ${source.url}`, error);
      lastError = error;
    }
  }

  const reason = `Spark failed to render the splat (${lastError?.message || lastError}). Showing a sampled point cloud instead.`;
  setSplat({ state: "loading", mode: "fallback", url: PLY_URL, fallbackReason: reason });
  const cloud = await loadPointCloud(PLY_URL, (loaded, total) =>
    setSplat({ loadedBytes: loaded, totalBytes: total }),
  );
  setSplat({ state: "ready", splatCount: cloud.count, loadMs: Math.round(performance.now() - started) });
  return cloud.object;
}

export function getSplat() {
  if (!splatPromise) {
    splatPromise = loadOnce().catch((error) => {
      useStore.getState().setSplat({
        state: "error",
        mode: "none",
        fallbackReason: `Unable to load the scene: ${error?.message || error}`,
      });
      return null;
    });
  }
  return splatPromise;
}

// Mounted at the scene root. SparkRenderer must be in the scene for any
// SplatMesh to draw.
export function SparkLayer() {
  const gl = useThree((state) => state.gl);
  return <primitive object={getSparkRenderer(gl)} />;
}

// Mounted inside the display-frame group so it shares the overlay transform.
export function Splat() {
  const [object, setObject] = useState(null);
  useEffect(() => {
    let alive = true;
    getSplat().then((loaded) => alive && setObject(loaded));
    return () => {
      alive = false;
    };
  }, []);
  return object ? <primitive object={object} /> : null;
}
