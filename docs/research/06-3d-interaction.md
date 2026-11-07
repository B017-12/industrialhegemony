# 06 3D interaction research (Tab 6)

Time-boxed research for overlays, labels, camera choreography and splat compositing. Each item ends with the decision it drove.

## Selection highlighting: outline pass vs instanced fills

Sources:
- pmndrs postprocessing `OutlineEffect` / `SelectiveBloomEffect`: https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/OutlineEffect.js~OutlineEffect.html
- @react-three/postprocessing `Outline` and `Selection`: https://docs.pmnd.rs/react-postprocessing/effects/outline
- three.js `InstancedMesh.setColorAt`: https://threejs.org/docs/#api/en/objects/InstancedMesh
- Cognite Reveal node styling ("ghosted" appearance for everything outside the selection): https://cognitedata.github.io/reveal-docs/docs/examples/cad-styling
- Tab 1 measurement: the splat pass costs about 19 ms GPU time per frame (`docs/kt/01-render-foundation.md`).

Findings:
- The outline effect renders the selected objects into a mask (one extra scene render), then runs edge detection and blur passes at full resolution. The EffectComposer also moves the whole scene into an offscreen render target. On this GPU the splat already uses most of a 16.7 ms frame, so even 2–4 ms more costs visible fps.
- Spark composites through the normal transparent pass. Running it inside an EffectComposer works, but it adds a full-screen copy and changes the alpha/premultiply path, which risks halos around splats.
- An `InstancedMesh` with per-instance colour draws all 101 boxes in one call. Edge recolouring through a vertex `color` attribute costs nothing per frame. "Ghosting" the non-selected objects (dimming their colour and opacity) gives the same focus effect that Cognite uses, without a post pass.

Decision: no post-processing. Draw three things: an instanced fill (soft volume, low opacity, also used for picking), solid edges for bound objects and dashed edges for unbound ones. Hover, selection, ghosting and the target pulse are all colour/opacity writes into existing buffers.

## 3D-anchored labels and decluttering

Sources:
- drei `Html`: https://drei.docs.pmnd.rs/misc/html (each instance runs its own projection and React render in `useFrame`; `occlude` raycasts per frame)
- three.js `CSS2DRenderer`: https://threejs.org/docs/#examples/en/renderers/CSS2DRenderer (projects every object every render and walks the scene graph; no collision handling)
- Mapbox GL symbol placement and collision detection (greedy, priority-ordered placement in screen space with a collision grid): https://blog.mapbox.com/placing-labels-on-maps-ce0ad2e1d7c1
- Been, Daiches, Yap 2006, "Dynamic Map Labeling", IEEE TVCG (greedy placement by priority with hysteresis is the practical approximation of the NP-hard optimum).

Findings:
- drei `Html` is simple, but 30 independent components each recompute their transform every frame, and decluttering across labels would need shared state anyway.
- `CSS2DRenderer` has no collision handling and updates every label every frame.
- Map engines all use the same approach: sort labels by priority, then place each one only if its screen rectangle does not overlap anything already placed. With 30 labels a brute-force rectangle test (at most 435 pairs) is trivial.
- Updating DOM with `transform: translate3d()` and opacity only (no layout properties) keeps the work on the compositor.

Decision: a custom label layer. One DOM node per bound asset, created once. At about 30 Hz: project the top of each OBB, choose level of detail by camera distance (card, tag + dot, dot only), sort by priority (selected, mission target, in range, abnormal status, nearest), then place greedily and hide any label that overlaps one already placed. React only renders the label content when data changes, never per frame.

## Camera choreography

Sources:
- camera-controls 3.1.2 (`web/node_modules/camera-controls/dist/index.d.ts`): `fitToBox(box3, enableTransition, {paddingTop, paddingBottom, paddingLeft, paddingRight, cover})`, `setLookAt(px, py, pz, tx, ty, tz, enableTransition)`, `smoothTime`, events `controlstart` / `controlend`.
- https://github.com/yomotsu/camera-controls#readme
- Rory Driscoll, "Frame rate independent damping using lerp": https://www.rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/
- Freya Holmér, "Lerp smoothing is broken" (same derivation, exponential decay form): https://www.youtube.com/watch?v=LSNQuFEDOyQ

Findings:
- `fitToBox` fits an axis-aligned `Box3`. The robot and labels live in raw PLY frame under a 180° X rotation, so the OBB's 8 corners must be transformed into display space first, and then the Box3 built from them.
- `fitToBox` keeps the current azimuth and polar angle, which avoids disorienting flips when jumping between nearby assets.
- Naive `x = lerp(x, target, k)` per frame depends on frame rate. The frame-rate-independent form is `x += (target - x) * (1 - exp(-lambda * dt))`, with half-life `ln 2 / lambda`. With lambda = 4 /s the follow cam lags about 0.17 s at half-life, smooth at 30 or 60 fps.
- camera-controls applies its own `smoothTime` damping to `setLookAt(..., true)`. Calling it every frame with `enableTransition = false` on an already-damped target avoids two dampers fighting.
- `controlstart` only fires for pointer/touch input, not wheel. To leave follow mode, listen for `controlstart` plus a `wheel` listener on the canvas.

Decision: selection does a fly-to with `fitToBox(..., true, padding)`. The Mission camera computes a chase pose (behind and above the robot along its heading), damps it with the exponential form, and pushes it with `setLookAt(..., false)`. Any user drag or wheel switches the mode to `free`. On arrival, the camera frames the target and the robot from the robot's side with a transition.

## Splat and mesh compositing in Spark

Sources:
- `web/node_modules/@sparkjsdev/spark/dist/spark.module.js`: the `SparkRenderer` material uses `transparent: true`, `depthTest: true`, `depthWrite: false` and premultiplied alpha.
- three.js render order: opaque objects first (front to back), then transparent objects sorted by `renderOrder`, then distance: https://threejs.org/docs/#api/en/core/Object3D.renderOrder

Findings:
- Splats never write depth, so opaque meshes (the robot) always occlude splats correctly, and splats in front of an opaque mesh still blend over it.
- Transparent overlays (fills, edges, trail) are sorted against the single `SparkRenderer` mesh. With `renderOrder` above zero they draw after the splats, and with `depthTest` on they are clipped by opaque meshes only, so in practice they always draw on top of the splat. That reads as an X-ray overlay, which helps legibility in a busy scan.
- Fills must use `depthWrite: false`, or a box drawn first would cut holes in boxes behind it.

Decision: robot meshes are opaque (`renderOrder` 0). Overlays are transparent with `depthWrite: false` and `renderOrder` 10–12: fill, then edges, then trail and scan sector. Labels are DOM and need no compositing.

## Proximity and mission timing (inherited from Tab 3)

Source: `docs/kt/03-navigation.md` section 8.

Decision: horizontal footprint distance in metres, a 90° field-of-view cone used only for the "scanned" log, hysteresis with entry at 1.6 m and exit at 2.0 m, polled at 10 Hz by brute force. `scripts/check-mission.mjs` must reproduce Tab 3's simulated order.
