import { ReportCard } from "../copilot/ReportCard.jsx";

export { GenerationBadge } from "../copilot/ReportCard.jsx";

// Copilot answer slot (props kept from Tab 5): the full report card.
export function CopilotSlot({ answer, onEvidence, activeId, onDraft }) {
  return <ReportCard answer={answer} onEvidence={onEvidence} activeId={activeId} onDraft={onDraft} />;
}
