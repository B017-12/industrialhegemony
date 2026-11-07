# 08 Label review and VLM labelling: research

Time-boxed to about 20 minutes on 2026-11-07. The question was how to turn ~101 geometric boxes with heuristic classes into trustworthy labels: render crops, ask a vision-language model (VLM) for a class, and let a human confirm quickly with the keyboard.

## 1. Geometry proposes, 2D model names

All three papers use the same split: a 3D step proposes class-agnostic instances, and a 2D model looks at the best views of each instance and names it.

**OpenMask3D (Takmaz et al., NeurIPS 2023)**
- View choice: for each instance it counts the fraction of the instance's 3D points that project inside a frame and pass a depth occlusion check, then keeps the top-k frames (`k_view = 5`). An appendix figure shows the rejected view is the one where the object is mostly occluded.
- Cropping: a tight box from projected points was too noisy because of outliers, so they prompt SAM with sampled projected points to get a clean 2D mask. From that mask they take `L = 3` crops: the tight box, then boxes grown by `k_exp * l` of the box size on each side (`k_exp = 0.1`, so roughly +10% and +20% per side). The extra context helps.
- Aggregation: each crop goes through CLIP, and the features are averaged over crops and views. The ablation shows both multi-scale crops and the SAM-refined box improve AP.

**Open-YOLO 3D (Boudjoghra et al., 2024)**
- View choice: the same visibility idea (in-frame and not occluded, using depth), but computed for all instances and frames at once as tensor operations.
- Cropping: none. YOLO-World runs on whole frames and paints its labelled boxes into a coarse "label map", larger boxes first so smaller (usually nearer) objects overwrite them. Replacing boxes with SAM masks made results slightly worse and about 5 times slower.
- Aggregation: each visible projected point of the instance reads the label under it in each of the top-k label maps, and the most frequent class wins. Using one view gave 16.3 mAP; 10 views gave 22.8 and 40 views 24.7, because the detector is wrong in some views and right in others.

**ConceptGraphs (Gu et al., 2023)**
- View choice: up to 10 "most informative" views per object, ranked by how many noise-free points each view contributed to the object during mapping.
- Captioning: each crop goes to LLaVA with the prompt "describe the central object in this image". GPT-4 then summarises the 10 captions into one tag and may declare the object invalid.
- Result: human raters judged about 70% of node labels correct, and most errors came from the VLM. The paper also notes duplicates and missed thin objects, so a review step is still needed.

**What this means for us.** We render synthetic views from a splat, so we can place the camera where visibility is best instead of searching recorded frames. Agreement across views is the most useful signal in Open-YOLO 3D, and moderate context padding helps in OpenMask3D. Shtedritski et al. (ICCV 2023) found that drawing a marker (a red circle) on the image steered a VLM better than cropping, because context is kept; Set-of-Mark prompting showed GPT-4V reads box and mask overlays well. So we should keep context and draw the box outline thinly.

## 2. OpenAI Structured Outputs with image inputs

- Structured Outputs guarantees the reply matches the supplied JSON Schema, so the model cannot omit a key or invent an enum value. Safety refusals come back as a separate, detectable field.
- Strict mode rules: every property must be listed in `required`, and every object needs `"additionalProperties": false`. Optional fields are emulated with a union with `null`.
- Supported keywords include `enum`, and for numbers `minimum` and `maximum`, so `confidence` can be pinned to 0..1. For strings only `pattern` and `format` are listed, so we should enforce the length of `short_description` in the prompt and truncate it in code.
- In the Responses API the schema goes in `text.format` as `{ "type": "json_schema", "name": "crop_label", "strict": true, "schema": {...} }`. The image is a content part `{ "type": "input_image", "image_url": "data:image/jpeg;base64,<...>", "detail": "low" }`. In Chat Completions it is `response_format: { type: "json_schema", json_schema: {...} }` with `{ "type": "image_url", "image_url": { "url": "data:..." } }`.
- `detail: "low"` fits the image within 512 x 512 for most models, which suits object crops and keeps cost predictable. Several images can go in one request.
- Calibration caveat: Xiong et al. (ICLR 2024) found that verbalised LLM confidence is overconfident, mostly 80-100% and in multiples of 5. Agreement across several samples predicted failures better than the stated number. Groot and Valdenegro-Toro (2024) found GPT-4V and Gemini Pro Vision overconfident on image tasks. A 2025 VLM study reports ECE above 0.25 for most instruct models, with visual reasoning models such as o3 calibrated better.
- Using 0.6 honestly: treat it as a routing knob, not as "60% likely correct". Self-reported confidence will cluster high, so on its own it will send few objects to review. Combine it with signals we can measure: the VLM disagrees with the heuristic class, two views disagree, or the class is `other`. After review, report the actual accuracy per confidence band on our ~101 objects and move the threshold if needed.

## 3. Keyboard-first review UX

- CVAT: `F` and `D` go to the next and previous frame, `Ctrl+0..9` changes the label of the active object (the first ten labels get 1..0 by default), `M` toggles merge mode, `Del` deletes, `Ctrl+Z` undoes and `Ctrl+Shift+Z` or `Ctrl+Y` redoes, and `F1` lists all shortcuts. Review mode has no accept or reject keys; issues are raised with the mouse, which is slower than we want.
- Label Studio: `Ctrl+Enter` submits, `Ctrl+Space` skips, `Ctrl+Z` undoes and `Ctrl+Shift+Z` redoes, `Backspace` deletes a region and `Alt+.` cycles regions. Each `Choice` can have its own `hotkey`, and all hotkeys can be remapped in the settings or with `EDITOR_KEYMAP`.
- Queue ordering: Label Studio's uncertainty sampling shows tasks with the lowest prediction score first. Settles' survey describes least-confident, margin (gap between the top two classes) and entropy sampling. With one model and ~101 items, "most doubtful first" is the useful part; we do not retrain anything.
- Undo: both tools keep an undo and redo stack for object actions. For us, merge and delete are the risky actions, so undo must restore the original boxes, labels and asset bindings.
- Provenance: Label Studio exports `completed_by` (user), `created_at`, `lead_time` (seconds spent) and `was_cancelled` (skipped) for each annotation. We should record at least reviewer, timestamp and label source per decision.

## Decisions for Tab 8

- **Views.** The crop tour renders 3 candidate views per object (facing the largest box face, plus about 35 degrees to each side), scores each by the fraction of box sample points in frame and not occluded, and keeps the best 2. The VLM gets both in one request.
- **Crop.** Each crop is a square around the 8 projected box corners, padded by 20% per side (between the second and third OpenMask3D levels), at least 256 px, sent at `detail: "low"`.
- **Outline.** Draw the projected oriented box as a thin 2 px high-contrast outline, and say in the prompt "classify the object inside the outline". The review UI shows the same crop and can toggle the outline off.
- **Schema.** Strict mode with `class` as an enum of the 12 fixed labels, `confidence` as a number from 0 to 1, and `short_description` as a string limited to 12 words in the prompt and truncated in code. Store the model name, prompt version and crop hash with every answer.
- **Threshold.** An object goes to the review queue if confidence is below 0.6, the VLM class differs from the heuristic class, or the class is `other`. The UI labels the number "model's self-reported confidence", never as a percentage chance of being right.
- **Ordering.** The queue lists disagreements first, then the lowest confidence, then everything else. Objects above the threshold stay as "VLM, unreviewed" and are never shown as human-accepted.
- **Keys.** `Enter` accepts; `1`-`9`, `0`, `-` and `=` set the 12 classes in list order, with the mapping shown on screen; `R` renames, `M` merges with the nearest neighbour (`Tab` cycles neighbours), `X` or `Delete` rejects, `B` binds and `Shift+B` unbinds an Excel asset, `S` skips, `J`/`K` or the arrow keys go to the next and previous object, `Cmd/Ctrl+Z` and `Shift+Cmd/Ctrl+Z` undo and redo, and `?` opens help. Keys are ignored while a text field has focus so they do not clash with typing or viewer navigation.
- **Provenance.** Every action appends an event `{object_id, action, before, after, source: heuristic | vlm | human, reviewer, timestamp (ISO 8601), duration_s}`. Undo appends an inverse event instead of deleting history, so the export can show who decided each label and when.

## Sources

- OpenMask3D, Takmaz et al. 2023: https://arxiv.org/abs/2306.13631
- Open-YOLO 3D, Boudjoghra et al. 2024: https://arxiv.org/abs/2406.02548
- ConceptGraphs, Gu et al. 2023: https://arxiv.org/abs/2309.16650
- What does CLIP know about a red circle?, Shtedritski et al. ICCV 2023: https://arxiv.org/abs/2304.06712
- Set-of-Mark prompting for GPT-4V, Yang et al. 2023: https://arxiv.org/abs/2310.11441
- OpenAI Structured Outputs guide: https://platform.openai.com/docs/guides/structured-outputs
- OpenAI images and vision guide: https://platform.openai.com/docs/guides/images-vision
- Can LLMs Express Their Uncertainty?, Xiong et al. ICLR 2024: https://arxiv.org/abs/2306.13063
- Overconfidence is Key, Groot and Valdenegro-Toro 2024: https://arxiv.org/abs/2405.02917
- Seeing is Believing, but How Much? (VLM verbalised calibration) 2025: https://arxiv.org/abs/2505.20236
- CVAT shortcuts: https://zhiltsov-max.github.io/cvat/docs/manual/advanced/shortcuts/
- CVAT objects sidebar (label hotkeys): https://docs.cvat.ai/docs/annotation/annotation-editor/objects-sidebar/
- CVAT manual QA and review: https://docs.cvat.ai/docs/qa-analytics/manual-qa/
- Label Studio hotkeys: https://labelstud.io/guide/hotkeys and https://labelstud.io/guide/labeling.html
- Label Studio Choice tag: https://labelstud.io/tags/choice
- Label Studio active learning and task ordering: https://docs.humansignal.com/guide/active_learning
- Label Studio export format (completed_by, created_at, lead_time): https://labelstud.io/guide/export
- Settles, Active Learning Literature Survey: https://burrsettles.com/pub/settles.activelearning.pdf
