# 01 Rendering research (Tab 1)

Time-boxed research for the render foundation. Each item ends with the decision it drove.

## Spark 2.4 (`@sparkjsdev/spark`)

Sources:
- Local README: `web/node_modules/@sparkjsdev/spark/README.md`
- Type definitions: `web/node_modules/@sparkjsdev/spark/dist/types/SparkRenderer.d.ts`, `SplatMesh.d.ts`, `defines.d.ts`
- https://sparkjs.dev/docs/spark-renderer/
- https://sparkjs.dev/docs/on-demand-rendering/

Findings:
- A `SparkRenderer` must be created with the app's `WebGLRenderer` and **added to the scene**. Without it, `SplatMesh` objects are collected by nobody and nothing draws. This is the root cause of the empty viewer (root cause 1 in `docs/KT_HANDOFF.md`).
- The renderer should be created with `antialias: false`. MSAA does not improve splats and "significantly reduces performance".
- `SplatMesh({ url, onProgress, onLoad })` streams and decodes in a web worker. `mesh.initialized` is a promise that resolves when the splats are ready. Supported file types (`SplatFileType`): `ply`, `spz`, `splat`, `ksplat`, `pcsogs` (SOG `meta.json`), `pcsogszip` (bundled `.sog`), `rad` (pre-built LoD).
- Splats render in the **transparent pass** with `depthTest: true` and `depthWrite: false` by default. Opaque meshes (boxes, robot) write depth and occlude splats correctly. Line overlays drawn after splats can be hidden by them, so overlay materials should set `depthTest` deliberately.
- Sorting runs in a worker. `sortRadial: true` (default) is the most stable under rotation. `minSortIntervalMs` can throttle sorting if the CPU is the bottleneck.
- LoD: `lod: true` on `SplatMesh` builds an LoD tree at load time; `paged: true` streams a pre-built `.rad`. For a 502k-splat scene, the desktop LoD budget (2.5M) is never reached, so LoD is unnecessary.
- `SparkRenderer.onDirty` can drive on-demand rendering. We animate a robot continuously, so we use the normal continuous loop.

Decisions:
- Create one `SparkRenderer` from R3F's `gl`, add it under the scene root, and keep `antialias: false` on the canvas.
- Load the splat once through a module-level promise and attach the resulting `SplatMesh` with `<primitive>`, so React re-renders, StrictMode double mounts and HUD changes can never trigger a second download.
- No LoD or paging for now (scene is far below the budget).

## React Three Fiber + drei + Spark

Sources:
- https://github.com/sparkjsdev/spark-react-r3f (official example: R3F + drei `CameraControls` + Spark via `extend`)
- https://sparkjs.dev/docs/on-demand-rendering/ (R3F section; warns that R3F recreates elements whenever `args` changes)
- https://r3f.docs.pmnd.rs/ (v9 targets React 19)

Findings:
- The Spark team ships an R3F example, so the stack is supported upstream rather than a hack.
- R3F recreates an element when an entry in `args` changes. Passing fresh option objects inline would rebuild the `SplatMesh` and reload the file. Memoising or holding the instance outside React avoids this.
- drei `CameraControls` wraps `camera-controls`, which has damping (`smoothTime`), distance and polar limits, `setBoundary`, and `fitToSphere` / `setLookAt` transitions that Tab 6 will need for fly-to.
- zustand lets the 3D layer read state through `useStore.getState()` or `subscribe` inside `useFrame` without React re-rendering the scene graph.

Decision: React Three Fiber 9 + drei 10 + zustand 5, with Spark held as an imperative singleton and mounted with `<primitive>`. Plain three.js would also work, but the later UI tabs (5 to 8) are React-heavy, and R3F gives them declarative overlays, `Html` labels and pointer events for free.

## PlayCanvas splat-transform

Source: https://developer.playcanvas.com/user-manual/splat-transform/cli-reference/

Findings:
- `splat-transform input.ply output.spz` (or `.sog`, `.compressed.ply`). Format is chosen from the extension.
- `-H, --filter-harmonics <0..3>` drops spherical-harmonic bands, which is most of the bytes in a PLY.
- `-N, --filter-nan` drops unrenderable splats. `-B, --filter-box` crops to a box. `-V, --filter-value` keeps splats by opacity or scale.
- `--filter-floaters` and `--filter-cluster` need WebGPU. SOG writing uses the GPU for SH k-means but runs on CPU with `-g cpu`.

Decision: produce SPZ (Spark's best-supported compressed format and a single file) with `--filter-nan` plus a box crop to the room bounds, keep the raw PLY as fallback. Sizes and timings are recorded in `docs/kt/01-render-foundation.md`.

## Camera fit

For a bounding sphere of radius r and vertical field of view f, the camera distance that keeps the sphere inside the vertical frustum is d = r / sin(f / 2). With a narrow viewport the horizontal field of view is smaller, so we use min(f_vertical, f_horizontal). `camera-controls` exposes the same idea through `fitToSphere`.
