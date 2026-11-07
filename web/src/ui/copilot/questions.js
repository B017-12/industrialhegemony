// Suggested chat questions. Builder_Questions rows are capability statements,
// so each maps to a concrete question the backend keyword router answers
// offline. `source` is the Builder_Questions id (or the workbook doc) shown as
// provenance. scripts/snapshot-api.mjs imports this list to snapshot answers.
export const SUGGESTED_QUESTIONS = [
  { id: "Q-02", source: "Q-02", text: "What do the telemetry trends show?" },
  { id: "Q-03", source: "Q-03", text: "Why is this asset flagged, and which historical cases match?" },
  { id: "Q-06", source: "Q-06", text: "How much should I trust this diagnosis given data quality?" },
  { id: "Q-04", source: "Q-04", text: "Which events are open right now?" },
  { id: "Q-05", source: "Q-05", text: "What maintenance has been done on this asset?" },
  { id: "Q-01", source: "Q-01", text: "Where is this asset in the 3D scene, and how sure is the mapping?" },
  { id: "safety", source: "DOC-FIELD-SAFETY", text: "What safety steps apply before any physical check?" },
];

// Assets whose suggested-question answers and work-order draft are snapshotted.
export const SNAPSHOT_CHAT_ASSETS = ["ASSET-014"];

export function suggestionFor(text) {
  const t = text.trim().toLowerCase();
  return SUGGESTED_QUESTIONS.find((q) => q.text.toLowerCase() === t) ?? null;
}
