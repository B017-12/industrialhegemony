# 07 Copilot UX research (Tab 7)

Time-boxed to about 20 minutes on 2026-11-07. The question was how to make a grounded diagnosis look and feel trustworthy in a 392 px inspector, without inventing anything the backend has not validated.

## Sources and the decision each drove

| Source | What it shows | Decision for our UI |
|---|---|---|
| Cognite Atlas AI, "About debugging and tracing agents" (https://docs.cognite.com/cdf/atlas_ai/concepts/atlas_ai_agent_debugging) | Every response has automatic citations to the data behind it, plus an expandable reasoning trace with tool inputs and outputs. Citations are for users; the trace is for checking the reasoning. | Two layers. Evidence chips on every claim for the operator, and a collapsed "Trace" disclosure with `generation`, `model`, `validation.errors` and `attempts` for the sceptic. |
| Cognite September 2026 release blog (https://www.cognite.com/en/resources/blog/cognite-september-2026-release) | Conversations are anchored to tagged assets, equipment or telemetry; citations are clickable for insights, charts and tables. | The chat is scoped to the selected asset and says so in its header. Asset IDs in evidence become chips that select the asset and fly the 3D camera to it. Telemetry evidence opens a chart, not just text. |
| Cognite Hub Atlas AI feedback thread (https://hub.cognite.com/product-ideas-492/atlas-ai-feedback-and-suggestions-5659) | Users liked sample questions, loading feedback and visible reasoning. Clicking a follow-up suggestion fills the prompt rather than sending it. | Suggested questions from `Builder_Questions`. A click sends straight away, because the demo needs one-click answers; the text then stays visible as the user's message so the question is never hidden. Loading shows a "validating against evidence" indicator. |
| Perplexity citation teardowns (https://aiuxplayground.com/teardowns/perplexity/citations, https://www.925studios.co/blog/perplexity-design-breakdown) | Citations sit inline at the claim, not in a footer. Chips show the source type first. The full source list is collapsed by default: "never forces verification, but always offers it". | Chips sit directly under each claim and show a kind icon (event, case, telemetry, document) plus the ID. The full 40-item evidence bundle is collapsed under the report. |
| GodUI "Anatomy of source citations" (https://godui.design/docs/lab/ai/source-citations/learn) | Every citation pill needs an accessible name; keyboard focus must open the same preview as hover. | Chips are real buttons with `aria-label="Open evidence <id>: <source>"`. They open the drawer on click or Enter, so keyboard and mouse behave the same. |
| GitHub Copilot chat, "Used n references" (https://learn.microsoft.com/en-us/visualstudio/ide/copilot-chat-context-references, https://github.com/microsoft/vscode/issues/195814) | A collapsible references list sits under each answer. An accessibility bug was that the toggle did not announce expanded or collapsed. | Each chat answer has a "N evidence items" disclosure built on `<details>`, which announces its state natively. |
| Microsoft HAX Toolkit, Guideline 2 and Pattern 10C (https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-how-well-the-system-can-do-what-it-can-do/, https://www.microsoft.com/en-us/haxtoolkit/pattern/g10-c-fall-back-to-other-strategies/) | Match the precision of the UI to the system's real performance; give low-performance alerts. When the system falls back, tell the user if the difference is noticeable. | Confidence is a meter with the 0.5 procedural cap drawn on it and a plain-language band ("low, verify on site"). The reasons are listed step by step from the backend. Fallbacks get explicit badges: "Deterministic answer", "Cached answer", "Snapshot". |
| Siemens Maintenance Copilot help (https://help.assetmanagement.siemens.com/help/Content/Documentation/Maintenance/Asset%20Essentials/EnterpriseFeatures/AI-Driven%20Capabilities/Maintenance%20Copilot.htm) and Teamcenter SLM blog (https://blogs.sw.siemens.com/service-lifecycle-management/2026/01/12/ai-driven-service-plan-creation-in-teamcenter-slm/) | Copilot output is copied into work-order notes, where it stays editable. AI creates a draft; humans review, refine and approve. | The work-order draft is an editable form labelled "Draft, not submitted". The only actions are Copy and Download JSON. There is no Submit button, because the backend writes nothing. |
| Siemens Industrial Copilot case study (https://www.tumasyan.com/work/siemens-industrial-copilot/) | Make the copilot's context visible; make every generated result reviewable before it lands. | The chat header names the asset in scope. Drafts and answers are always reviewable before any action. |
| Workbook `DOC-FIELD-SAFETY` and `DOC-RAG-GUIDE` | The assistant must not replace site procedures, lockout/tagout, permits, OEM instructions or qualified personnel. Answers must separate observation from hypothesis and propose the next safe verification step. | A prominent safety callout under the report quotes the rule and links `DOC-FIELD-SAFETY`. Observations and hypotheses are separate sections with different visual weight. |

## Design rules applied

1. **Observation vs hypothesis.** Observations ("What the data shows") use a solid accent rule. Hypotheses ("Possible cause, to verify") use a dashed rule and a muted label. The hypothesis heading never says "cause" without "possible".
2. **Chips.** Each shows a kind icon and the ID. A click opens the evidence drawer over the inspector body, with a back button; the 3D view stays visible. The drawer renders the source record by kind: a field table for events, cases, work orders and data quality; full text for documents; a chart for telemetry and baselines.
3. **Signature at a glance.** The report shows vibration, flow and pressure charts side by side with the healthy band. The cavitation signature (vibration up, flow and pressure down) is visible without reading.
4. **Numbers only from the backend.** The UI formats numbers from `trends`, `baselines` and `evidence.values`; it never computes new claims. Chart annotations reuse the same `delta` and `delta_pct` the validated text cites.
5. **Streaming honesty.** The backend streams only validated text, so the UI says "validating against evidence" while waiting and then streams the summary words. The final card replaces the stream with the full validated answer.
6. **States are explicit.** Skeletons while loading; error with retry; badges for snapshot, cached and deterministic answers; "needs the live API" when offline chat has no snapshot answer.

## Builder_Questions to suggested questions

The sheet holds capability statements, not user questions. The UI maps the relevant ones to concrete questions that the backend's keyword router answers offline, and shows the Q-ID as provenance:

| Q-ID | Capability focus | Suggested question |
|---|---|---|
| Q-02 | anomaly detection | How have vibration, flow and pressure trended? |
| Q-03 | explainability + RAG | Why is this asset flagged, and which historical cases match? |
| Q-06 | trustworthy AI | How much should I trust this diagnosis given data quality? |
| Q-04 | maintenance prioritization | Which events are open right now? |
| Q-05 | field workflow | What maintenance has been done on this asset? |
| Q-01 | 3D mapping + UX | Where is this asset in the 3D scene, and how sure is the mapping? |
| (safety) | DOC-FIELD-SAFETY | What safety steps apply before any physical check? |
