# 02 Segmentation research (splats to framed objects)

Time-boxed literature pass for the Python segmentation pipeline. Scene: ~500K splats, ~9 x 3.3 x 5 units, y-down (floor y ~ +1.086, ceiling y ~ -0.87). Stack: numpy, scipy, scikit-image, scikit-learn 1.7. No Open3D. All distances below are in scene units; the current voxel size is 0.02.

## 1. Efficient RANSAC (Schnabel, Wahl, Klein 2007)

Source: https://doi.org/10.1111/j.1467-8659.2007.01016.x (Computer Graphics Forum 26(2), 214-226). Author PDF: https://cg.cs.uni-bonn.de/backend/v2/files/publications/schnabel-2007-efficient/pdf/schnabel_2007_efficient_310a84c162.pdf

- Uses per-point normals so each sample fixes 3 parameters; a plane or cylinder candidate needs only 2-3 samples, and the extra sample is used to reject bad candidates immediately.
- Cylinder from two oriented points: axis direction a = n1 x n2; project both points and normal lines onto the plane orthogonal to a; the intersection of the two normal lines is the axis point, the distance to it is the radius.
- A point supports a shape only if distance < epsilon AND the normal deviation < alpha. Extracted shapes are refit by least squares on all compatible points within 3*epsilon.
- Localised sampling (octree cells) makes it find small shapes such as pipes in large scenes; the score is the largest connected component of inliers, not the raw count.

Decision for our pipeline: keep plane RANSAC for floor/ceiling/walls with epsilon = 0.02-0.03 and alpha = 20 deg, then refine each plane by SVD on its inliers. Add a numpy cylinder RANSAC restricted to high-linearity points (section 4): 2-point normal sampling, epsilon = 0.015, alpha = 20 deg, radius in [0.015, 0.25], at least 150 inliers, axis length >= 0.3, connected-component check along the axis with gap <= 0.05.

## 2. Region growing with smoothness constraint (Rabbani, van den Heuvel, Vosselman 2006)

Source: https://www.isprs.org/proceedings/XXXVI/part5/paper/RABB_639.pdf (ISPRS Commission V Symposium, Dresden, pp. 248-253; record: https://research.tudelft.nl/en/publications/segmentation-of-point-clouds-using-smoothness-constraint/)

- Two intuitive parameters: normal-angle threshold theta_th and plane-fit residual threshold r_th. Seeds are taken in order of lowest residual (flattest first).
- Their industrial-site results used theta_th = 15 deg, k = 30 neighbours, and r_th = 98th percentile of the plane-fit residuals.
- Smoothly connected surfaces stay together (a whole U-shaped pipe becomes one segment), which is good for pipes but merges equipment touching a wall at a soft edge.

Decision for our pipeline: not the primary segmenter (splat normals are noisy). Use it as a split tool inside oversized HDBSCAN clusters: k = 20, theta_th = 15 deg, r_th = 98th percentile of residuals. Normals come from local PCA (section 4), or from the splat's smallest covariance axis when the splat is flat (section 6).

## 3. HDBSCAN (Campello, Moulavi, Sander 2013) and scikit-learn HDBSCAN

Sources: https://doi.org/10.1007/978-3-642-37456-2_14 (PAKDD 2013, LNAI 7819, 160-172); https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html

- Builds the full DBSCAN hierarchy over all eps values using mutual-reachability distance, condenses it with min_cluster_size, and picks the most stable clusters. Handles varying density, which a single eps (our 0.045) cannot.
- Parameters: `min_cluster_size` (smallest object kept); `min_samples` (k for core distance, includes the point itself in sklearn, so it is 1 larger than in the hdbscan contrib library; defaults to min_cluster_size); `cluster_selection_epsilon` (clusters closer than this are not split further, which stops fragmentation of dense objects); `cluster_selection_method` `eom` (most persistent, larger clusters, default) vs `leaf` (finest homogeneous clusters, tends to over-segment).
- Outputs `labels_` (-1 = noise) and `probabilities_` (membership strength); useful as a per-point weight for boxes.
- Complexity: sklearn 1.7 uses KD-tree core distances plus an exact Prim minimum spanning tree (`_hdbscan_prims`), so time is roughly O(n^2) with O(n) memory. Measured locally on 6-D data: 20K points 2.9 s, 40K 12 s, 80K 52 s. 100K would be about 80 s.

Decision for our pipeline: run HDBSCAN on the non-structure points only, voxel-downsampled to at most ~60K points (raise voxel to 0.03 if needed). Features [x, y, z, wL*L, wa*a, wb*b] with Lab scaled so that delta E = 10 equals 0.03 units (wa = wb = 0.003, wL = 0.0015 to down-weight lighting). Start with min_cluster_size = 60, min_samples = 10, cluster_selection_epsilon = 0.04, method = `eom`; try `leaf` only for small-part views. Drop points with probability < 0.2 before fitting boxes.

## 4. Eigenvalue features from local PCA (Weinmann, Jutzi, Hinz, Mallet 2015)

Sources: https://doi.org/10.1016/j.isprsjprs.2015.01.016 (ISPRS J. Photogramm. Remote Sens. 105, 286-304); formulas also in https://doi.org/10.5194/isprsannals-II-3-W4-271-2015

- From eigenvalues l1 >= l2 >= l3 of the neighbourhood covariance: linearity (l1-l2)/l1, planarity (l2-l3)/l1, scattering l3/l1; they sum to 1. Also verticality from the normal (eigenvector of l3).
- Optimal per-point neighbourhood: choose k in [10, 100] (step 1) minimising eigenentropy E = -sum(e_i ln e_i), with e_i = l_i / sum(l).
- Individually optimised neighbourhoods measurably improve feature distinctiveness over a fixed k.

Decision for our pipeline: compute features with a vectorised cKDTree query and batched `np.linalg.eigh`. Use fixed k = 20 by default; optionally eigenentropy over k in {10, 15, 20, 30, 40, 60} (coarse grid for speed). Labels: linearity > 0.7 = pipe/rail candidate; planarity > 0.6 = surface; scattering > 0.3 = clutter or equipment detail. Normal = smallest eigenvector.

## 5. Graph-based segmentation (Felzenszwalb and Huttenlocher 2004)

Source: https://doi.org/10.1023/B:VISI.0000022288.19776.77 (IJCV 59(2), 167-181)

- Sort graph edges by weight; merge two components if the edge weight <= min(Int(C1) + k/|C1|, Int(C2) + k/|C2|), where Int is the largest MST edge inside a component. O(m log m) for m edges.
- Works on any graph, so it applies to a kNN graph of points with edge weight = combined position, colour and normal distance.
- k sets the scale (larger k gives larger segments); a min-size post-merge removes tiny segments. `skimage.segmentation.felzenszwalb` is image-only, so a point version needs a small union-find.

Decision for our pipeline: keep it as a fallback if HDBSCAN is too slow or fragments. kNN graph k = 10, weight = ||dp|| / 0.03 + dE / 15 + (1 - |n_i . n_j|), scale k = 1.0-3.0 in those units, min size 60.

## 6. Gaussian-splat specifics

Sources: Kerbl et al. 2023 https://doi.org/10.1145/3592433 (arXiv https://arxiv.org/abs/2308.04079); SuGaR https://arxiv.org/abs/2311.12775; 2DGS https://arxiv.org/abs/2403.17888; Gaussian Grouping https://arxiv.org/abs/2312.00732; SAGA https://arxiv.org/abs/2312.00860; Feature 3DGS https://arxiv.org/abs/2312.03203; splat-transform floater filter https://api.playcanvas.com/splat-transform/types/FilterFloaters.html and https://github.com/playcanvas/splat-transform

- Covariance Sigma = R S S^T R^T with S = diag(exp(scale_0..2)) and R from the normalised quaternion (rot_0 = w, rot_1..3 = x, y, z; read by name). Opacity = sigmoid(opacity_logit). Base colour = 0.5 + 0.28209479 * f_dc, clipped to [0, 1].
- A splat is only a good surface sample when it is opaque and small. Very large or low-opacity splats are typically background fill or floaters. For flat splats (s_min / s_mid < 0.3) the axis of the smallest scale is a usable surface normal; SuGaR and 2DGS both rely on this flattening.
- Floater practice: splat-transform `filterFloaters` voxelises at 0.05, treats voxels with opacity >= 0.1 as solid, and drops Gaussians contributing < 1/255 to every solid voxel. Point-cloud style SOR (section 9) is the CPU equivalent we can run.
- Gaussian Grouping, SAGA and Feature 3DGS give instance segmentation by training per-Gaussian identity or affinity features from SAM masks. They need the training images, cameras and a GPU training run, so they are out of scope for this hackathon.

Decision for our pipeline: keep sigmoid(opacity) > 0.3; drop splats whose max axis exp(max scale) > 0.08 units or above the 99th percentile, whichever is smaller; weight centroids, PCA and box percentiles by opacity. Use the smallest-axis normal for flat splats and the PCA normal otherwise.

## 7. Gravity-aligned oriented bounding boxes (rotating calipers)

Sources: Freeman and Shapira 1975 https://doi.org/10.1145/360881.360919 (CACM 18(7), 409-413); Toussaint 1983 http://jeff.cs.mcgill.ca/~godfried/publications/calipers.pdf (IEEE MELECON '83)

- Theorem (Freeman and Shapira): the minimum-area rectangle enclosing a convex polygon has one side collinear with a hull edge. Trying each edge is O(h^2); Toussaint's rotating calipers make it O(h).
- Applies to any point set via its convex hull, since the hull's minimum rectangle is the set's minimum rectangle.

Decision for our pipeline: yaw-only OBB. Project the cluster to the floor plane (x, z), trim to the 1st-99th percentile radius from the centroid, take `scipy.spatial.ConvexHull`, and test every hull-edge angle with vectorised numpy (h is small, so O(h^2) is fine). Height = 1st-99th percentile of y. Snap the yaw to the room's wall direction if the snapped area is within 5% of the optimum, which keeps boxes stable across reruns.

## 8. CIELAB colour

Sources: https://en.wikipedia.org/wiki/CIELAB_color_space; sRGB (IEC 61966-2-1) summary https://www.w3.org/Graphics/Color/srgb

- sRGB to linear: c_lin = c / 12.92 if c <= 0.04045, else ((c + 0.055) / 1.055)^2.4.
- Linear to XYZ (D65): X = 0.4124 R + 0.3576 G + 0.1805 B; Y = 0.2126 R + 0.7152 G + 0.0722 B; Z = 0.0193 R + 0.1192 G + 0.9505 B. White Xn, Yn, Zn = 0.950489, 1.0, 1.088840.
- Lab: f(t) = t^(1/3) if t > (6/29)^3, else t / (3 (6/29)^2) + 4/29; L = 116 f(Y/Yn) - 16; a = 500 (f(X/Xn) - f(Y/Yn)); b = 200 (f(Y/Yn) - f(Z/Zn)).
- Euclidean distance in Lab (delta E 1976) approximates perceived difference, unlike RGB where equal steps are perceptually uneven. Separating L from a, b lets us down-weight shading and baked lighting, which mostly change L. Weak spot: blue hues are less uniform.

Decision for our pipeline: convert SH DC colour to Lab once at load (or call `skimage.color.rgb2lab`, which uses the same D65 formulas). Use delta E thresholds: < 8 same surface, > 15 different objects. Weight L at half of a, b in all clustering distances.

## 9. Statistical outlier removal (PCL)

Source: https://pointclouds.org/documentation/tutorials/statistical_outlier.html

- For each point compute the mean distance d_i to its k nearest neighbours; with global mean mu and standard deviation sigma of d_i, drop points with d_i > mu + alpha * sigma.
- The tutorial uses k = 50, alpha = 1.0 and removes about 7% of a laser scan; that is aggressive for splats, which have uneven density.

Decision for our pipeline: `cKDTree(pos).query(pos, k=21, workers=-1)` (k = 20 plus self), alpha = 2.0, run after the opacity and scale filters and before voxelisation. Log the removed fraction; it should stay under 5%.

## 10. Stable IDs across reruns (3D IoU plus Hungarian assignment)

Source: https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.linear_sum_assignment.html

- `linear_sum_assignment(cost)` solves minimum-cost bipartite matching (modified Jonker-Volgenant) and accepts rectangular matrices, so the number of old and new objects can differ.
- For yaw-only boxes, 3D IoU = (area of the xz rectangle intersection) x (y overlap) / union volume. The rectangle intersection is a convex polygon clip (Sutherland-Hodgman, about 20 lines of numpy). A simpler alternative is voxel-set IoU on the cluster's occupied voxels.

Decision for our pipeline: cost = 1 - IoU; after assignment accept only pairs with IoU >= 0.3 (and the same class, or class confidence < 0.5); unmatched new objects get fresh IDs from a persisted counter so old IDs are never reused. Store the previous run's boxes and IDs in the output JSON.

## Chosen approach

1. Load splats by attribute name; build Sigma, opacity, Lab colour.
2. Filter: sigmoid(opacity) > 0.3; max covariance axis < min(0.08, 99th percentile); SOR with k = 20, alpha = 2.0.
3. Colour: SH DC to sRGB to linear to XYZ (D65) to Lab; L weighted at half.
4. Structure: plane RANSAC (epsilon 0.025, alpha 20 deg) for floor, ceiling and walls, refit by SVD; remove inliers within 0.03 of each plane from the object pool.
5. Voxelise the remainder at 0.02 (0.03 if over ~60K points), opacity-weighted means.
6. PCA features with k = 20: linearity, planarity, scattering, normals.
7. Pipes: points with linearity > 0.7 go to cylinder RANSAC (epsilon 0.015, radius 0.015-0.25, at least 150 inliers, length >= 0.3); accepted cylinders become pipe objects and leave the pool.
8. HDBSCAN on [xyz, scaled Lab] (min_cluster_size 60, min_samples 10, cluster_selection_epsilon 0.04, `eom`).
9. Merge/split: merge clusters with gap < 0.04 and delta E < 12; split clusters larger than 2.5 units on any axis, or with bimodal colour, by region growing (15 deg, k = 20).
10. Yaw-only OBB per cluster via hull plus calipers, percentile-trimmed, snapped to the wall direction when within 5% area.
11. Quality filter: at least 80 points, smallest side >= 0.05, largest side <= 4.0, planar fraction < 0.9 (else structure), mean HDBSCAN probability >= 0.3.
12. Heuristic classes from size, aspect, linearity, height above floor and Lab colour.
13. Stable IDs: 3D IoU against the previous run, Hungarian matching, IoU >= 0.3, fresh IDs for the rest.

## As implemented (deviations from the plan above, with the measurement behind each)

- Opacity: soft cut at 0.1 plus opacity-weighted voxel aggregation (keep 2 cm voxels with summed opacity >= 0.3), not a hard 0.3 cut. Measured: opacity > 0.3 keeps only 18.8% of splats and the median opacity is 0.124, so the hard cut discarded most real surfaces.
- Covariance: drop splats with max sigma > 0.05 units (19,358 splats, 3.9%). Splat normals from the smallest-scale axis were checked on the floor (median |n_y| = 0.85), which also confirms the rot_0 = w reading.
- SOR: k = 16, alpha = 2.0 removed 9,871 splats (3.7% of the post-filter set), under the 5% budget.
- Walls: RANSAC alone accepted pipe rows and equipment fronts as walls (two tilted 7-9 deg, one mid-room). Added two tests: the plane must be on the room boundary (at most 4% of voxels behind it) and at least 20% filled on a 5 cm in-plane grid. 5 of 7 vertical candidates were rejected.
- Pipes: cylinder RANSAC from splat normals was replaced by axis-aligned linear seeds (linearity > 0.75, axis alignment > 0.92), DBSCAN on axis-stretched coordinates, then a PCA axis plus least-squares radius fit. Seeds lying inside another cluster's box are absorbed back into it as object edges (7 of 28), because cage posts and frames look exactly like thin pipes.
- HDBSCAN: min_cluster_size 30, min_samples 8, `eom`, max_cluster_size 3000, Lab weight 0.0015 (L at half). Measured on 32.7K candidate voxels: plain `eom` gives one 10K-voxel cluster (30% of points); `leaf` leaves 47% as noise; the capped `eom` was the best trade-off.
- Merge: gap 5 cm (in metres via metres_per_unit), delta E < 15, merged size <= 1.2 units, then a colour-blind assembly pass (gap 8 cm, merged size <= 0.7 m) for multi-coloured devices.
- Splitting: oversized or sparse clusters are re-clustered with HDBSCAN `leaf` rather than region growing.
- Stable IDs: IoU threshold 0.2 rather than 0.3, because small objects (valves, fittings) rarely reach 0.3 between reruns with percentile-trimmed boxes.
- Not implemented: eigenentropy-optimal neighbourhoods, Felzenszwalb graph cut, and snapping the yaw to the wall direction.
