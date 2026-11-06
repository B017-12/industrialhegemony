import { VALMET_ASSETS, VALMET_RAG_DOCS } from '../data/valmetDataset';

export const PRESET_COPILOT_QUERIES = [
  'Which assets require immediate attention in the Boiler Room?',
  'Explain why CV-003 and P-002 are failing together (Spatial + Root Cause).',
  'Compare Human Technician vs. Wheeled Robot route to Selected Asset.',
  'Generate safe LOTO & calibration procedure for selected asset.',
  'Are there any telemetry data quality or connectivity anomalies?'
];

export function runEdgeCopilotQuery(queryText, selectedAsset, humanPath, robotPath, nearbyAssets = []) {
  const q = queryText.toLowerCase();

  const criticalAssets = VALMET_ASSETS.filter(
    (a) => a.health_status === 'attention_required' || a.health_status === 'degraded'
  );
  const watchAssets = VALMET_ASSETS.filter((a) => a.health_status === 'watch');

  if (q.includes('immediate attention') || q.includes('which assets') || q.includes('failing') && !q.includes('cv-003')) {
    return {
      title: 'Plant-Wide Anomaly Triage (30 Anchored Assets)',
      confidence: 0.96,
      citations: ['ASSET-017', 'ASSET-014', 'ASSET-024', 'ASSET-003', 'DOC-FIELD-SAFETY'],
      answer: `Out of **30 anchored assets** in the Boiler Room scan, **${criticalAssets.length} require urgent intervention** and **${watchAssets.length} are on Watch**:

1. **P-005 (ASSET-017 | Health 44/100 — ATTENTION REQUIRED)**: Impeller scale fouling causing **6.53 mm/s** vibration, **63.4 A** motor current, and **76.6°C** bearing temp (\`WO-000189\`).
2. **P-002 (ASSET-014 | Health 45/100 — ATTENTION REQUIRED)**: Cavitation risk at Main Pump Skid; discharge pressure dropped to **3.11 bar** with **6.45 mm/s** broadband vibration (\`WO-000142\`).
3. **M-006 (ASSET-024 | Health 45/100 — ATTENTION REQUIRED)**: Drive-end bearing overheating at **82.6°C** in Auxiliary Loop North (\`WO-000215\`).
4. **CV-003 (ASSET-003 | Health 52/100 — DEGRADED)**: **9.3% position deviation** (SP 68.4% vs PV 59.1%, stiction 0.56) directly downstream of cavitating pump P-002 (\`WO-000118\`).
5. **VS-002 (ASSET-029 | Health 58/100)** & **CV-009 (ASSET-009 | Health 59/100)**: Loose piezo mounting stud & feedback linkage play.`
    };
  }

  if (q.includes('cv-003') || q.includes('p-002') || q.includes('together') || q.includes('coupled')) {
    return {
      title: 'Spatial & Process Coupling Analysis: P-002 → CV-003 → PT-002',
      confidence: 0.95,
      citations: ['ASSET-014', 'ASSET-003', 'ASSET-026', 'EVT-000501', 'EVT-000412', 'DOC-CONTROL_VALVE-CORE', 'DOC-PROCESS_PUMP-CORE'],
      answer: `**Spatial-Process Correlation Detected across Line-1 / Line-2 Feedwater Train:**

* **Upstream Trigger — P-002 (\`ASSET-014\`, [2.12, -0.35, 3.16])**: Suction strainer fouling (\`EVT-000501\`) starved the impeller eye, dropping discharge pressure to **3.11 bar** and exciting **6.45 mm/s** vibration (which also loosened adjacent sensor **VS-002** \`ASSET-029\`).
* **Downstream Propagation — CV-003 (\`ASSET-003\`, [-2.00, -0.42, 1.10])**: Pressure pulsations from P-002 combined with a **4.8 bar** instrument air droop caused the over-torqued stem packing on **CV-003** to stick at **59.1%** while the controller demanded **68.4%** (\`EVT-000412\`, Stiction Index **0.56**).
* **Instrumentation Offset — PT-002 (\`ASSET-026\`, [-1.10, 0.26, 3.48])**: Located 1.2m downstream of CV-003, showing **0.22 bar** downward drift due to magnetite sediment in the impulse tap.
* **Recommended Execution Order**: Transfer load to standby pump **P-001** (\`ASSET-013\`) first, isolate **P-002 + CV-003** under a unified LOTO permit (\`DOC-FIELD-SAFETY\`), clean STR-102 strainer, and stroke-calibrate CV-003.`
    };
  }

  if (q.includes('route') || q.includes('human') || q.includes('robot') || q.includes('path')) {
    return {
      title: `Dual-Profile Kinematic Routing to ${selectedAsset.tag} (${selectedAsset.asset_id})`,
      confidence: 0.98,
      citations: [selectedAsset.asset_id, selectedAsset.anchor_id, 'DOC-FIELD-SAFETY'],
      answer: `**Obstacle-Aware 3D A* Navigation Comparison to ${selectedAsset.tag}:**

* **Human Technician Route (Cyan Tube)**: **${humanPath.distanceMeters}m** (${humanPath.nodeIds.length} waypoints, computed in ${humanPath.computeTimeMs}ms). ${
        humanPath.usedStairs
          ? 'Traverses the central **Elevated Catwalk Step (`N-M-STEP`)** and 0.72m pipe alley shortcut.'
          : 'Uses direct walkable floor clearance.'
      }
* **Wheeled Inspection Robot / AMR Route (Orange Tube)**: **${robotPath.distanceMeters}m** (${robotPath.nodeIds.length} waypoints, computed in ${robotPath.computeTimeMs}ms). Rejects edges with \`has_stairs = true\` and \`min_width < 1.1m\`, automatically routing around the perimeter wide corridor.
* **Proximity Radar**: Currently detecting **${nearbyAssets.length} framed assets** within the avatar's 1.6m inspection radius.`
    };
  }

  if (q.includes('loto') || q.includes('procedure') || q.includes('calibration') || q.includes('safe')) {
    const steps = selectedAsset.loto_checklist.map((s, idx) => `${idx + 1}. ${s}`).join('\n');
    return {
      title: `Grounded LOTO & Field SOP for ${selectedAsset.tag} (${selectedAsset.service_description})`,
      confidence: 0.97,
      citations: [selectedAsset.asset_id, selectedAsset.qr_id, ...selectedAsset.doc_refs],
      answer: `**Mandatory Safe Verification Checklist for \`${selectedAsset.tag}\` (QR Anchor: \`${selectedAsset.qr_id}\`):**

${steps}

* **Referenced Standards**: ${selectedAsset.doc_refs.join(', ')}
* **Work Order Reference**: ${selectedAsset.work_order ? `${selectedAsset.work_order.wo_id} (${selectedAsset.work_order.priority}) — ${selectedAsset.work_order.summary}` : 'No open corrective WO; log under routine PM round.'}`
    };
  }

  if (q.includes('quality') || q.includes('connectivity') || q.includes('intermittent') || q.includes('dq')) {
    return {
      title: 'Telemetry Data Quality & Edge Connectivity Audit',
      confidence: 0.94,
      citations: ['ASSET-024', 'ASSET-029', 'ASSET-026', 'ASSET-011', 'DOC-VIBRATION_SENSOR-CORE'],
      answer: `**Data Quality & Connectivity Findings from Builder Pack:**

1. **Intermittent Wireless Zones (\`connectivity_profile: intermittent\`)**: **M-006** (\`ASSET-024\`), **VS-002** (\`ASSET-029\`), **CV-005** (\`ASSET-005\`), **CV-008** (\`ASSET-008\`), and **P-004** (\`ASSET-016\`) experience packet buffering due to heavy steel boiler drum RF shadowing.
2. **Sensor Mounting Artifact (\`DQ-0029\`)**: **VS-002** shows high-frequency rattle (noise floor **0.48g**) from a loose M8 stud rather than pure bearing spalling.
3. **Impulse Line Drift (\`DQ-0026\`)**: **PT-002** exhibits a **-0.22 bar** static bias relative to header pressure.
4. **Manual Round Assets (\`connectivity_profile: manual_round\`)**: **CV-011**, **M-004**, and **PT-003** require QR scan (\`QR-SYN-0011/0022/0027\`) via the Mobile AR Field HUD during patrol.`
    };
  }

  // Default contextual response grounded in selectedAsset
  return {
    title: `Contextual Diagnostic Brief: ${selectedAsset.tag} (${selectedAsset.asset_id})`,
    confidence: 0.93,
    citations: [selectedAsset.asset_id, selectedAsset.anchor_id, ...selectedAsset.doc_refs],
    answer: `**${selectedAsset.tag}** (*${selectedAsset.service_description}*) in **${selectedAsset.area_name}** currently has a health score of **${selectedAsset.health_score}/100** (\`${selectedAsset.health_status.toUpperCase()}\`).

* **Primary Finding**: ${selectedAsset.decision_tree[0]?.title} — ${selectedAsset.decision_tree[0]?.detail}
* **Spatial Context**: ${selectedAsset.decision_tree[1]?.detail}
* **Root Cause**: ${selectedAsset.decision_tree[2]?.detail}
* **Recommended Action**: ${selectedAsset.decision_tree[3]?.detail}`
  };
}
