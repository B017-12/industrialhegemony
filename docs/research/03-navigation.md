# 03 Navigation research (floor grid to timed robot mission)

This is a time-boxed pass for the Python navigation step in `pipeline/navigation.py`.

The scene:

- Valid PLY slice, y-down. The floor is at y = 1.07191 and the ceiling at y = -0.8714.
- Scale is 1.2865 m/unit, an assumption from the room-height prior written by Tab 2 into `scene_objects.json`.
- The walkable floor is about x -3.0 to 0.5 and z -3.6 to -0.8 (units).

The stack is numpy, scipy and scikit-image. Grid distances below are in units unless marked metres.

## 1. Euclidean distance transform and ESDF

Sources:
- scipy `distance_transform_edt`: https://docs.scipy.org/doc/scipy/reference/generated/scipy.ndimage.distance_transform_edt.html. It gives the exact Euclidean distance to the nearest zero (background) element, and the `sampling` argument sets the cell size.
- Oleynikova et al. 2017, "Voxblox: Incremental 3D Euclidean Signed Distance Fields for On-Board MAV Planning", IROS. https://arxiv.org/abs/1611.03631. Planners query the ESDF for both collision (d > robot radius) and a cost gradient (prefer large d). Collision checking a point is O(1).
- Nav2 / costmap_2d inflation layer: https://docs.nav2.org/configuration/packages/costmap-plugins/inflation.html and http://wiki.ros.org/costmap_2d/hydro/inflation.
  - The cost is `253 * exp(-k * (d - r_inscribed))` for cells outside the inscribed radius. Cells inside it are lethal.
  - The default `cost_scaling_factor` k = 10 /m and `inflation_radius` = 0.55 m.

Decisions:

- **Collision test.** Run the EDT on the raw obstacle mask, with `sampling = cell`. A cell is collision-free for a disc robot of radius r when `d_obstacle > r`. This replaces the old `binary_dilation(iterations=4)`: four 4-connected dilations give a diamond, not a disc, and 4 cells is a fixed 0.2 units = 0.26 m that is unrelated to the robot size.
- **ESDF and its sign.** The ESDF is stored in metres. Only free space matters for planning, so the "signed" part is just `-distance` inside obstacles, which isn't needed for the cost.
- **Clearance cost.** `c = 1 + w * exp(-d / sigma)`, with d in metres from the raw obstacle mask. This is the Nav2 decay, with the lethal part done by the inflated mask instead of a cost value.
  - We start with w = 4 and sigma = 0.15 m, which is about Nav2's k = 1/sigma ≈ 6.7 /m. That is a slightly gentler decay than the default 10 /m, so the robot prefers the corridor centre in a cramped room.
  - At the robot radius (0.3 m) the extra cost is 4 * e^-2 ≈ 0.54. At 0.6 m it is ≈ 0.07.
- **Floor support.** A cell must have floor splats in it, or nearby after closing. Unknown (unscanned) floor is not walkable, the same as `inflate_unknown = false` plus treating unknown as non-traversable.

## 2. Grid search: A*, octile heuristic, Theta*, Lazy Theta*

Sources:
- Hart, Nilsson, Raphael 1968, "A Formal Basis for the Heuristic Determination of Minimum Cost Paths", IEEE TSSC 4(2). https://doi.org/10.1109/TSSC.1968.300136
- Amit Patel, "Heuristics" (octile distance for 8-connected grids): http://theory.stanford.edu/~amitp/GameProgramming/Heuristics.html.
  - The heuristic is `h = D * (dx + dy) + (D2 - 2D) * min(dx, dy)`, with D = 1 and D2 = sqrt(2).
  - It is admissible and consistent when every step costs at least its Euclidean length.
- Nash, Daniel, Koenig, Felner 2007, "Theta*: Any-Angle Path Planning on Grids", AAAI. Journal version: Daniel, Nash, Koenig, Felner 2010, JAIR 39, 533-579, https://doi.org/10.1613/jair.2994.
  - Basic Theta* is A* with one change: when expanding s' from s, if `parent(s)` has line of sight to s', s' takes `parent(s)` as its parent with cost `g(parent(s)) + c(parent(s), s')`.
  - Paths are not constrained to 45-degree headings. They are shorter than A* plus post-smoothing at similar runtime.
  - Section 6 of the journal version extends this to non-uniform cell costs, where an edge costs its length times the cost of the cells crossed.
- Nash, Koenig, Tovey 2010, "Lazy Theta*: Any-Angle Path Planning and Path Length Analysis in 3D", AAAI. https://ojs.aaai.org/index.php/AAAI/article/view/7566. It delays the line-of-sight check until the vertex is expanded, which mainly pays off in 3D.

Decisions:

- **Planner.** Basic Theta* on the 8-connected inflated grid, using the octile heuristic in metres. The heuristic stays admissible because every cell cost is at least 1.
- **Edge cost.** `|segment| * mean(c over the supercover cells of the segment)`, the non-uniform-cost variant.
- **Comparison.** Plain A* with the same costs is kept for comparison.
- **Lazy Theta*.** Not used. The grid is about 180 x 100 cells in 2D, so eager line-of-sight checks are cheap.

## 3. Line of sight on a grid

Source: Amanatides and Woo 1987, "A Fast Voxel Traversal Algorithm for Ray Tracing", Eurographics. http://www.cse.yorku.ca/~amana/research/grid.pdf

Decision: line of sight checks every cell the segment passes through (a supercover), not just Bresenham cells. Otherwise a segment could clip the corner of an inflated obstacle. It's implemented by dense sampling at a quarter cell plus checking both neighbours at exact corner crossings. At about 40 cells per segment this is simpler than the incremental Amanatides-Woo traversal, and it is conservative.

## 4. Path smoothing

Sources:
- Geraerts and Overmars 2007, "Creating High-quality Paths for Motion Planning", IJRR 26(8). https://doi.org/10.1177/0278364907079280. Shortcutting: remove intermediate vertices while the straight segment stays collision-free. Greedy "farthest visible vertex" is the deterministic version.
- Yuksel, Schaefer, Keyser 2011, "Parameterization and applications of Catmull-Rom curves", Computer-Aided Design 43(7), 747-755. https://doi.org/10.1016/j.cad.2010.08.008. Also https://www.cemyuksel.com/research/catmullrom_param/.
  - Knots are spaced as `t_{i+1} = t_i + |P_{i+1} - P_i|^alpha`.
  - With alpha = 0.5 (centripetal), the curve has no cusps or self-intersections within a segment, and it stays closer to the control polygon than uniform (alpha = 0) or chordal (alpha = 1).
  - The curve interpolates the control points, so it passes through the planner's waypoints exactly.
- Barry and Goldman 1988, the pyramidal formulation used for evaluation; see the Yuksel paper.

Decisions:

- **Pipeline.** Theta* output, then greedy shortcut, then a centripetal Catmull-Rom spline through the shortcut vertices.
- **Endpoints.** Use phantom end points `P_-1 = 2 P_0 - P_1` and `P_n+1 = 2 P_n - P_n-1`.
- **Sampling.** Sample densely, at about a quarter cell, then **re-check every sample** against the inflated grid. Any hit means we use the shortcut polyline and record `smoothing_fallback: true`.
- **Short routes.** With 2 control points the spline is just the segment.

## 5. Time parameterisation

Sources:
- Lynch and Park 2017, "Modern Robotics: Mechanics, Planning, and Control", ch. 9 (time scaling, trapezoidal profiles). http://hades.mech.northwestern.edu/index.php/Modern_Robotics
  - A trapezoidal profile with v_max and a_max reaches v_max after t_a = v_max / a_max, covering a distance of v_max² / (2 a_max).
  - If the path is shorter than v_max² / a_max, the profile becomes triangular with peak speed sqrt(L * a_max).
- Arc-length reparameterisation (standard differential geometry; for example Wang, Kearney, Atkinson 2002, "Arc-length parameterized spline curves for real-time simulation"): tabulate the cumulative chord length s_i over a dense sampling, and invert by interpolation, so the position at distance s is `interp(s, s_i, P_i)`.
- Curvature speed limit: lateral acceleration is `a_lat = v² * kappa`, so `v ≤ sqrt(a_lat_max / kappa)`. A forward/backward pass then enforces |dv/ds| ≤ a_max / v. This is the standard "velocity limit curve" from time-optimal path parameterisation, for example Bobrow, Dubowsky, Gibson 1985, IJRR 4(3).

Decisions:

- **Speed profile.** The route is reparameterised by arc length (uniform s).
  - The speed limit is `min(v_max, sqrt(a_lat / kappa))`.
  - A forward pass enforces `v_i ≤ sqrt(v_{i-1}² + 2 a ds)` and a backward pass does the same from the goal. On a straight path this gives an exact trapezoid or triangle.
  - Time is the integral of `ds / v`, using the mean speed of each step.
  - Sampling is resampled to dt = 0.1 s.
- **Speeds.** v_max = 0.35 m/s and a_max = 0.25 m/s², slow enough to read the labels in a demo. a_lat = 0.3 m/s².
- **Final turn.** After stopping, the robot turns in place to the approach heading at 60 deg/s, with a short angular accel/decel (exported as extra samples with speed 0).

## 6. Approach pose (goal selection)

There's no single paper for this. It's common practice in mobile manipulation and inspection to put a "pre-grasp" or "inspection pose" at a standoff from the object, facing it (for example the MoveIt / Nav2 "approach pose" and the Spot "go to waypoint facing object" patterns).

Decision:

- Candidates are free reachable cells whose distance to the OBB footprint (the yaw-rotated rectangle in x-z) is within the standoff, 0.5 m ± 0.15 m.
- Score: `clearance + facing bonus`. The facing bonus favours the side of the object the room is on (for wall-mounted assets, the opposite of the wall normal).
- Heading: `atan2(dx, dz)` towards the OBB centre.
- If no candidate exists, use the nearest reachable cell and record `standoff_ok: false`. If the object is in a different floor component, record `reachable: false`.

## 7. Map export (bonus)

Source: ROS map_server format, http://wiki.ros.org/map_server.

- The map is a PGM image: 254 = free, 0 = occupied, 205 = unknown.
- A YAML file sits beside it with `image, resolution, origin [x, y, yaw], negate, occupied_thresh, free_thresh`.
- Row 0 of the image is the top, which is the maximum y in map coordinates.

Decision: write `data/derived/nav_map.pgm` and `nav_map.yaml`, with the map x = PLY x and map y = PLY z. The `resolution` is given in metres (cell × mpu), as ROS expects, and the origin is in metres. This is a bonus only; nothing in the demo reads it.

## 8. Proximity spec for the viewer (summary; the full formulas are in the KT note)

- Range query: with about 100 objects, brute force over OBB centres (or the closest point on the OBB) every frame costs well under 0.1 ms in JS. A KD-tree is only worth it above roughly 10^4 objects.
- Field of view: an asset is "seen" if `dot(forward, normalize(p - robot)) ≥ cos(fov / 2)` and it is within range.
- Hysteresis: enter at 1.2 m and exit at 1.5 m, so an asset near the boundary doesn't flicker on and off.

## As implemented

These are the final values (`PARAMS` in `pipeline/navigation.py`). Measured numbers are in `docs/kt/03-navigation.md`.

- **Grid and obstacles.**
  - Cell size 0.05 units.
  - Obstacle band 0.12 to 1.8 m above the floor, with at least 3 splats per cell.
  - Floor support: at least 2 splats within ±0.05 units of the floor, then a binary closing (2 iterations).
- **Inflation.** A cell is walkable when its ESDF > 0.30 m + 0.5 cell (0.332 m) and it is in the largest **4-connected** component. The planner forbids diagonal corner cutting, so 8-connected labelling left some diagonal-only cells unreachable.
- **Cost.** `c = 1 + 4 exp(-d / 0.15 m)`.
- **Start.** The walkable cell with the most clearance within 0.15 units of the front (maximum z) edge.
- **Approach pose.**
  - Candidates lie within 0.5 ± 0.15 m of the OBB footprint and within a maximum reach of 1.0 m.
  - Candidates that allow a straight-in drive come first: a walkable cell 0.25 m behind the pose with line of sight to it.
  - Score: `min(ESDF, 0.6) + 0.3 * facing - 0.5 * occluded - |d - standoff|`.
  - The drive-in rule was added after the first run. Without it, the P-002 route reached its pose sideways and needed a 72° turn in place.
- **Shortcut.** Accepted only when its cost is at most the cost of the replaced subpath, so shortcutting can't cancel the clearance preference.
- **Smoothing.** Spline sampled at 0.01 units. Each sample is checked for being walkable and having exact clearance > 0.3 m, with a polyline fallback.
- **Motion.** v_max 0.35 m/s, a_max 0.25 m/s², a_lat 0.3 m/s², turn 60 deg/s with 120 deg/s². Samples every 0.1 s.
- **Not implemented.** Lazy Theta* (not needed at this grid size), S-curve (jerk-limited) profiles, and a dynamic window or local planner.
