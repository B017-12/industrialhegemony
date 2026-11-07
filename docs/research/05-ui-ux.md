# 05 UI/UX research and design spec (Tab 5)

## Corrections to the handoff prompt

- WCAG 2.4.11 is **Focus Not Obscured (Minimum)**, level AA. **Focus Appearance** is 2.4.13, level AAA ([WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/?versions=2.2&levels=aa)).
- Material 3's easing and duration tokens are no longer maintained, because M3 now uses springs. The cubic-bezier values are still fine for CSS ([M3 tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)).

## 1. Industrial digital-twin and 3D product UIs

- **NavVis IVION.** Search, site structure and sharing are in the top bar. The POI panel opens on the right, and the inactive 2D/3D view appears as a small preview in the bottom-right corner. Gaussian splats are a tab in the 3D dropdown. POIs have a category, an icon and a "significance" level, and can be shown or hidden by group. Sources: [interface](https://knowledge.navvis.com/docs/navvis-ivion-interface), [exploring a site](https://knowledge.navvis.com/docs/exploring-a-site-3), [POIs](https://knowledge.navvis.com/docs/points-of-interest-1).
- **Matterport.** Tags are anchored in 3D. A tag's content can dock in a sidebar, and previous/next arrows fly the camera from tag to tag. Data Layers switch groups of annotations on and off. Sources: [Tags](https://support.matterport.com/s/article/Create-a-Mattertag-Post?language=en_US), [blog](https://matterport.com/blog/elevate-your-experience-with-customization).
- **Cognite Data Fusion and Atlas AI.**
  - A search result opens a preview in a right sidebar. The tree greys out non-matching ancestors but keeps them clickable.
  - The 3D toolbar includes a tree, crop, measure, POIs, a minimap and "ghost mode", which fades unselected objects. A selected object gets a preview card with its work orders and sensors.
  - Every Atlas AI answer cites its source records automatically, with a reasoning trace you can expand. Users can tag assets in the chat.
  - Sources: [Search](https://docs.cognite.com/cdf/explore/search), [Browse 3D](https://docs.cognite.com/cdf/explore/navigate_3d), [Atlas debugging](https://docs.cognite.com/cdf/atlas_ai/concepts/atlas_ai_agent_debugging), [Sep 2026 release](https://www.cognite.com/en/resources/blog/cognite-september-2026-release).
- **Bentley iTwin AppUI.** The viewport sits in the centre with up to four docked widget panels and a status bar along the bottom. Properties dock on the right, content tools sit top-left and navigation tools top-right. Default panel sizes are left 300 px, right 200 px and bottom 180 px. Sources: [Frontstage](https://www.itwinjs.org/ui/appui/configure-frontstage/), [AppUI](https://www.itwinjs.org/ui/appui/).
- **NVIDIA Omniverse.** Stage (the USD tree), Viewport and Property panels are all dockable, and the timeline is under Window → Animation. No convention for asset health was found. Source: [Window menu](https://docs.omniverse.nvidia.com/composer/latest/menu_window.html).
- **Siemens Insights Hub.** Status colours are red for error, yellow for warning, blue for info and green for OK, with grey when there is no rule. The worst status rolls up to the parent, and the asset tree has quick filters. Sources: [FAQ](https://docs.industrial-operations-x.siemens.cloud/r/en-us/insights-hub-monitor/faqs/faqs/assets), [health display](https://docs.industrial-operations-x.siemens.cloud/r/en-us/insights-hub-monitor/assets/assets-overview/assets/asset-health-status-display).
- **Autodesk Tandem.** Status pins combine colour and icon: a green check, a yellow exclamation and a red exclamation. Tools sit in the header at top-right, data-visualisation controls in the footer at left, and the Properties toggle in the footer at right. Time Navigation replays history. Sources: [Mar 2024 release](https://intandem.autodesk.com/resource/march-2024-four-new-features-in-autodesk-tandem/), [UI refresh](https://forums.autodesk.com/t5/tandem-forum/feature-enhancement-release-simplified-interface-in-facilities/td-p/13074588).

## 2. Design systems

- **Linear.** Themes are generated in LCH from three inputs: base colour, accent and contrast. Headings use Inter Display and body text uses Inter. Cmd+K opens a command menu grouped by context, with shortcuts shown. Sources: [redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), [guide](https://linear.app/enablement/guides/navigating-linear.md).
- **Vercel Geist.** Colour scales run 100–1000:
  - 100–300 are backgrounds;
  - 400–600 are borders;
  - 700–800 are fills;
  - 900–1000 are text.

  Labels are 12–16 px with tabular figures. Radii are 6 px for controls and 12 px for menus and modals. Sources: [Colors](https://vercel.com/geist/colors), [Typography](https://vercel.com/geist/typography), [Materials](https://vercel.com/geist/materials).
- **Radix Colors.** Each scale has 12 steps:
  - 1–2: app background;
  - 3–5: component background (normal, hover, pressed);
  - 6–8: borders and focus;
  - 9–10: solid fills;
  - 11–12: text, which reaches APCA Lc 60 and Lc 90 on step 2.

  Source: [scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale).

## 3. Motion

- **Material 3.** Short durations are 50–200 ms, medium 250–400 ms and long 450–600 ms. Easing: standard `cubic-bezier(0.2,0,0,1)`, emphasised-decelerate `(0.05,0.7,0.1,1)` and emphasised-accelerate `(0.3,0,0.8,0.15)`.
- **Apple HIG.** Motion should be purposeful and brief, frequent interactions shouldn't animate, and motion should never be the only signal ([mirror](https://appguidelines.com/human-interface-guidelines/version/32/motion/)).
- **`prefers-reduced-motion`.** Replace scaling and panning with a dissolve ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)).

## 4. Density, status colour and accessibility

- **ISA-101 high-performance HMI.** Use a grey baseline and reserve colour for abnormal states. Alarm colours are used for nothing else, and alarms are coded redundantly by colour, shape and text. Only unacknowledged alarms flash, there is no decorative animation, and trends are embedded in the display ([ISA overview PDF](https://www.isa.org/getmedia/06130a38-f7af-4b35-8c9c-2c34f25c1977/The-High-Performance-HMI-Overview-v2-01.pdf)).
- **WCAG 2.2.**

  | Criterion | Requirement |
  |---|---|
  | 1.4.1 Use of Color | Colour is never the only signal |
  | 1.4.3 Contrast (Minimum) | Text 4.5:1, large text 3:1 |
  | 1.4.11 Non-text Contrast | UI parts and graphics 3:1 |
  | 2.4.11 Focus Not Obscured (AA) | The focused element is not fully hidden |
  | 2.4.13 Focus Appearance (AAA) | A 2 px perimeter with 3:1 change |

  Source: [Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html).
- **Tufte sparklines.** Word-sized, with no frame, a grey band for the normal range and a dot on the last value tied to the printed number. Flags should be modest, not stoplights ([Tufte](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/)).

## 5. Stack

- **Tailwind v4.** Install `tailwindcss @tailwindcss/vite`, add the Vite plugin and `@import "tailwindcss"`. Tokens in `@theme` generate utilities and CSS variables ([Vite guide](https://tailwindcss.com/docs/installation/using-vite), [Theme](https://tailwindcss.com/docs/theme)).
- **Radix.** The unified `radix-ui` package exports every primitive, for example `import { Tabs } from "radix-ui"` ([getting started](https://www.radix-ui.com/primitives/docs/overview/getting-started)).
- **cmdk 1.1.1.** Supports React 18 and 19. `Command.Dialog` is built on Radix Dialog, you bind ⌘K yourself, and styling goes through `[cmdk-*]` attributes ([npm](https://www.npmjs.com/package/cmdk)).

Why this stack over shadcn: the app is plain JSX with no path aliases. Radix gives accessible behaviour, Tailwind tokens give a consistent look, and nothing needs a generator or TypeScript setup.

## 6. Design spec (as built in `web/src/styles.css`)

**Layout**

| Region | Size | Contents |
|---|---|---|
| Top bar | 56 px | Brand, KPI strip, search (⌘K), mission chip, backend chip |
| Left rail | 288 px (312 px at ≥1800 px) | Asset tree |
| Centre | Fills the rest | Viewer, with a legend and fps chip on top |
| Right inspector | 392 px (440 px at ≥1800 px) | Tabbed asset details |
| Bottom dock | 76 px, under the viewer only | Mission controls and timeline |

Below 1280 px, the rail and inspector float over the viewer as drawers. Full-screen mode hides every panel.

**Colour**
- Surfaces: `surface-0` #07090d, `surface-1` #0d1117, `surface-2` #141a22, `surface-3` #1b232e, `surface-4` #232d3a.
- Lines: `line` #1f2833, `line-strong` #2d3a49.
- Text: `fg` #e6edf3, `fg-muted` #9fadbd, `fg-subtle` #7b8a9c. `fg-faint` #6b788a is for icons, borders and dots only, never text.
- Accent: #4cc2ff, which is deliberately not a status hue.

**Status.** Each workbook `condition_state` maps to a tone and icon; the last two rows are not workbook states.

| `condition_state` | Tone | Colour | Icon |
|---|---|---|---|
| `healthy` | normal | #3fb950 | CircleCheck (shown muted, per ISA-101) |
| `watch` | watch | #e3b341 | Eye |
| `degraded` | degraded | #f0883e | TriangleAlert |
| `attention_required` | critical | #ff6b61 | OctagonAlert |
| no data | offline | #8b96a5 | CircleOff |
| procedural mapping | procedural | #b49cff | dashed border with a hatch pattern |

Each tone has a `-soft` background. Status always appears as icon plus text, never colour alone.

**Type, radius, elevation and motion**
- Inter Variable, bundled through Fontsource so it works offline. Sizes are 11, 12, 13, 14, 16, 20 and 24 px. Numbers use tabular figures; IDs and tags use the system monospace.
- Spacing is the Tailwind 4 px scale. Radii are 3, 5, 7, 10 and 14 px.
- Elevation: `--shadow-panel` and `--shadow-float`. Panels next to the canvas are solid, with no backdrop blur, to protect the GPU.
- Motion: 120 ms (`--dur-fast`), 200 ms (`--dur-base`) and 320 ms (`--dur-slow`). Easing tokens are `--ease-standard` (0.2,0,0,1), `--ease-emphasized` (0.05,0.7,0.1,1) and `--ease-exit` (0.3,0,1,1).
- Only an active mission pulses. Reduced motion collapses all animation.

**Contrast**

WCAG ratios for text and accent, computed with the WCAG formula:

| Token | surface-0 | surface-1 | surface-2 | surface-3 |
|---|---|---|---|---|
| `fg` #e6edf3 | 16.9 | 16.0 | 14.8 | 13.4 |
| `fg-muted` #9fadbd | 8.7 | 8.3 | 7.7 | 6.9 |
| `fg-subtle` #7b8a9c | 5.7 | 5.4 | 5.0 | 4.5 |
| `fg-faint` #6b788a (non-text only) | 4.4 | 4.2 | 3.9 | 3.5 |
| `accent` #4cc2ff | 9.9 | 9.4 | 8.7 | 7.9 |

Status tones:

| Tone | On its `-soft` background | On `surface-1` |
|---|---|---|
| normal | 6.3 | 7.4 |
| watch | 8.0 | 9.7 |
| degraded | 6.4 | 7.5 |
| critical | 6.0 | 6.8 |
| offline | 5.3 | 6.3 |
| procedural | 7.1 | 8.2 |

The primary button's text on the accent fill is 9.6.

**Fixed: `fg-faint`.** The original #566273 reached only 2.6 to 3.2:1, so it failed as text, and on `surface-2` and `surface-3` it was below 3:1 even for non-text. Two changes fixed it:
- every text use (timeline end labels, the telemetry "healthy" line, open-event counts, group counts, evidence sources, the filter placeholder, palette IDs) moved to `fg-subtle`;
- the token was lightened to #6b788a, so the remaining icon, border and dot uses reach 3.5:1 or better on every surface (WCAG 1.4.11).

## Decisions this drove

1. The layout is rail, viewport, inspector and dock, as in iTwin, Tandem and Cognite.
2. The theme is grey first. Red, amber and green appear only for health, and the accent is cyan.
3. Status is coded redundantly with colour, icon and text, using one shared token set for the tree, the inspector and (in Tab 6) the 3D boxes.
4. Nothing animates for decoration. Tab 6 should pulse only the faulty pump and draw the robot trail.
5. **Copilot (Tab 7):** citation chips that open their source record and fly the camera to the asset, plus a collapsible reasoning and validation trace. This follows Cognite.
6. **Possible later features:** previous/next anomaly stepping (Matterport style) and ghost mode (fade unselected objects).
7. Sparklines are word-sized, with a grey-green normal band and a last-value dot next to the printed tabular number.
8. A ⌘K palette offers "go to asset", search and commands. Tab 6 can add "Send robot to…" and Tab 7 "Ask copilot".
