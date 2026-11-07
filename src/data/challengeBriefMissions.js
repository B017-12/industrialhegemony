/**
 * Valmet × Since AI 2026 — Interactive Game Campaign & Challenge Briefing Reference
 *
 * Maps the 5 official judging criteria from "Valmet_x_SinceAI_2026_Challenge_Brief_FINAL_updated.docx"
 * to interactive in-game missions that the user can play through step-by-step (or explore freely with WASD!).
 */

export const CHALLENGE_BRIEF_MISSIONS = [
  {
    stageId: 1,
    criterionWeight: '30% Weight',
    criterionTitle: 'Criterion 1: Semantic Asset Extraction Density & 3D Mesh Reconstruction',
    shortLabel: 'Stage 1: AI Laser Scan',
    missionGoal:
      'Trigger the AI Semantic Laser Wave across Industrial Boiler Room (1).ply to convert the raw 3D scan into clean 3D equipment meshes, contour outlines, and floating triangle-count callout cards.',
    referenceText:
      'Challenge Brief Sec 4.1 (30%): Extract and 3D-frame as many industrial objects as possible from the raw capture, reconstructing contoured 3D meshes with planar occluded backs and mapping them to the 30 Valmet Builder Pack assets.',
    actionButtonLabel: 'Trigger AI Semantic Laser Sweep',
    targetAssetId: 'ASSET-003'
  },
  {
    stageId: 2,
    criterionWeight: '25% Weight',
    criterionTitle: 'Criterion 2: Playable WASD Walkthrough, Centerline Rails & Proximity Radar',
    shortLabel: 'Stage 2: Walk & Rails',
    missionGoal:
      'Walk around the Boiler Room using W, A, S, D (or Arrow Keys) or watch the articulated Robot/Human rigs glide along equidistant Centerline Rails while the Proximity Radar highlights nearby assets.',
    referenceText:
      'Challenge Brief Sec 4.2 (25%): Realistic obstacle-aware navigation along walkable floor space (maintaining equal clearance between walls and pipes), plus dynamic proximity-based asset highlighting.',
    actionButtonLabel: 'Engage Playable WASD Walk & Rail Patrol',
    targetAssetId: 'ASSET-014'
  },
  {
    stageId: 3,
    criterionWeight: '20% Weight',
    criterionTitle: 'Criterion 3: AI Diagnostics, Spatial Coupling & Grounded Explainability',
    shortLabel: 'Stage 3: Diagnostics & Why',
    missionGoal:
      'Inspect how Cavitating Pump P-002 (Health 45%) propagates line vibration to Control Valve CV-003 (Health 52%) and Sensor VS-002, and test live in-memory telemetry mutations.',
    referenceText:
      'Challenge Brief Sec 4.3 (20%): Grounded diagnostics explaining WHY an asset is degraded using spatial topology, 30-min telemetry trends, plant events (EVT-*), work orders (WO-*), and RAG SOPs (DOC-*).',
    actionButtonLabel: 'Inspect P-002 → CV-003 Spatial Coupling',
    targetAssetId: 'ASSET-014'
  },
  {
    stageId: 4,
    criterionWeight: '15% Weight',
    criterionTitle: 'Criterion 4: Multi-Robot Fleet Coordination & Dynamic Hazard Avoidance',
    shortLabel: 'Stage 4: Multi-Robot Fleet',
    missionGoal:
      'Drop a dynamic floor hazard and watch the Fleet Coordinator assign R1 (Orange AMR), R2 (Purple AMR), and H1 (Cyan Tech) to separate emergency assets with zero path conflict.',
    referenceText:
      'Challenge Brief Sec 4.4 (15%): Operational realism, dynamic obstacle rerouting, and multi-agent coordination (assigning the closest robot/human to each emergency object).',
    actionButtonLabel: 'Dispatch R1 + R2 + H1 & Drop Floor Hazard',
    targetAssetId: 'ASSET-024'
  },
  {
    stageId: 5,
    criterionWeight: '10% Weight',
    criterionTitle: 'Criterion 5: Field Technician AR Visor POV & QR LOTO Execution',
    shortLabel: 'Stage 5: AR Visor & LOTO',
    missionGoal:
      'Enter First-Person AR Visor POV (or scan QR-SYN-0003 in the Mobile AR HUD), verify the Zero-Energy LOTO checklist, and dispatch a grounded Work Order packet.',
    referenceText:
      'Challenge Brief Sec 4.5 (10%): End-to-end field usability — bridging the 3D control-room digital twin with an on-site AR Field HUD anchored by physical QR markers.',
    actionButtonLabel: 'Enter AR First-Person Visor & Complete LOTO',
    targetAssetId: 'ASSET-003'
  }
];
