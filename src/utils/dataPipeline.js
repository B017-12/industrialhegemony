/**
 * Fast In-Memory Telemetry & Excel Data Pipeline Engine
 *
 * Features:
 * 1. Maintains typed in-memory arrays & O(1) lookup maps for all 30 Valmet Builder Pack assets,
 *    time-series telemetry buffers, plant events, and work orders.
 * 2. Enriches every asset with its exact Excel workbook row (`EXCEL_ASSET_RECORDS`) and
 *    part-specific visual/LOTO specification (`getPartVisualSpec`).
 * 3. Supports real-time telemetry mutation (`updateAssetTelemetryInMemory`) & live streaming simulation ticks.
 */

import { VALMET_ASSETS, VALMET_RAG_DOCS, STRUCTURAL_BOILER_OBJECTS } from '../data/valmetDataset.js';
import { EXCEL_ASSET_RECORDS, getPartVisualSpec } from '../data/excelPartCatalog.js';

/**
 * Generates an attachment contour polygon (12 points around the base/wall attachment perimeter)
 * and back-plane metadata for an asset.
 */
export function buildAssetContourModel(asset) {
  const [cx, cy, cz] = asset.position;
  const [sx, sy, sz] = asset.bbox_size;
  const hx = sx * 0.5;
  const hy = sy * 0.5;
  const hz = sz * 0.5;

  const isFloorMounted =
    asset.asset_class === 'process_pump' ||
    asset.asset_class === 'electric_motor' ||
    cy < -0.25;

  const contourPoints = [];
  if (isFloorMounted) {
    const baseY = cy - hy;
    const pts2D = [
      [-hx, -hz * 0.85],
      [-hx * 0.5, -hz],
      [0, -hz],
      [hx * 0.5, -hz],
      [hx, -hz * 0.85],
      [hx, 0],
      [hx, hz * 0.85],
      [hx * 0.5, hz],
      [0, hz],
      [-hx * 0.5, hz],
      [-hx, hz * 0.85],
      [-hx, 0]
    ];
    pts2D.forEach(([dx, dz]) => {
      contourPoints.push([Number((cx + dx).toFixed(3)), Number(baseY.toFixed(3)), Number((cz + dz).toFixed(3))]);
    });
  } else {
    const backZ = cz + hz;
    const pts2D = [
      [-hx * 0.85, -hy],
      [0, -hy],
      [hx * 0.85, -hy],
      [hx, -hy * 0.5],
      [hx, 0],
      [hx, hy * 0.5],
      [hx * 0.85, hy],
      [0, hy],
      [-hx * 0.85, hy],
      [-hx, hy * 0.5],
      [-hx, 0],
      [-hx, -hy * 0.5]
    ];
    pts2D.forEach(([dx, dy]) => {
      contourPoints.push([Number((cx + dx).toFixed(3)), Number((cy + dy).toFixed(3)), Number(backZ.toFixed(3))]);
    });
  }

  return {
    attachmentType: isFloorMounted ? 'FLOOR_SKID_CONTOUR' : 'WALL_PIPE_CONTOUR',
    contourPointCount: contourPoints.length,
    contourPoints,
    backPlane: {
      center: [cx, cy, Number((cz + hz).toFixed(3))],
      normal: [0, 0, -1],
      width: sx,
      height: sy
    }
  };
}

/**
 * Creates the initial fast in-memory store with exact Excel records & part specs attached.
 */
export function createInitialDataPipeline() {
  const enrichedAssets = VALMET_ASSETS.map((a) => {
    const excelRec = EXCEL_ASSET_RECORDS[a.asset_id] || null;
    const partSpec = getPartVisualSpec(a);
    const excelTel = excelRec?.excel_telemetry || {};

    return {
      ...a,
      excel_item_name:
        excelRec?.excel_item_name || `${a.tag} · ${partSpec.itemTypeName} (${a.area_name})`,
      excel_class: excelRec?.asset_class || partSpec.excelClass,
      excel_area_id: excelRec?.area_id || a.area_id,
      excel_area_name: excelRec?.area_name || a.area_name,
      process_context: excelRec?.process_context || 'utilities',
      excel_criticality: excelRec?.criticality || a.criticality,
      installation_date: excelRec?.installation_date || '2020-05-01',
      last_service_date: excelRec?.last_service_date || '2026-01-15',
      service_interval_days: excelRec?.service_interval_days || 365,
      excel_connectivity: excelRec?.connectivity_profile || a.connectivity_profile,
      scene_path: excelRec?.scene_path || `/SyntheticPlant/${a.area_id}/${a.tag}`,
      nfc_id: excelRec?.nfc_id || `NFC-SYN-${a.asset_id.split('-')[1]}`,
      issue_code: excelRec?.issue_code || a.status_reason || 'NORMAL',
      issue_summary: excelRec?.issue_summary || a.service_description,
      urgency: excelRec?.urgency || 'routine',
      recommended_next_check: excelRec?.recommended_next_check || 'monitor',
      model_confidence: excelRec?.model_confidence ?? 0.85,
      knowledge_doc_id: excelRec?.knowledge_doc_id || partSpec.sopDocId,
      rag_doc_file: excelRec?.rag_doc_file || `DOC-${a.asset_id}.md`,
      excelRecord: excelRec,
      partSpec,
      telemetry: {
        ...a.telemetry,
        ...excelTel
      },
      telemetry_trend: [...(a.telemetry_trend || [])],
      events: [...(a.events || [])],
      contourModel: buildAssetContourModel(a)
    };
  });

  return {
    version: 1,
    lastUpdated: new Date().toLocaleTimeString(),
    sourceLabel: 'Valmet x Since AI 2026 - Synthetic Industrial Metaverse Builder Data Pack.xlsx',
    assets: enrichedAssets,
    docs: VALMET_RAG_DOCS,
    structuralObjects: STRUCTURAL_BOILER_OBJECTS
  };
}

/**
 * Appends/modifies telemetry for a specific asset on the fly and automatically recomputes
 * health_score, health_status, and anomaly_score.
 */
export function updateAssetTelemetryInMemory(pipelineState, assetId, telemetryPatch, customReason = null) {
  const nowStr = new Date().toTimeString().slice(0, 5);
  const nextAssets = pipelineState.assets.map((asset) => {
    if (asset.asset_id !== assetId) return asset;

    const mergedTelemetry = {
      ...asset.telemetry,
      ...telemetryPatch
    };

    let penalty = 0;
    if (mergedTelemetry.vibration_mms !== undefined && mergedTelemetry.vibration_mms > 3.5) {
      penalty += (mergedTelemetry.vibration_mms - 3.5) * 9.5;
    }
    if (mergedTelemetry.bearing_temp_c !== undefined && mergedTelemetry.bearing_temp_c > 68) {
      penalty += (mergedTelemetry.bearing_temp_c - 68) * 2.4;
    }
    if (mergedTelemetry.stiction_index !== undefined && mergedTelemetry.stiction_index > 0.30) {
      const sticVal = mergedTelemetry.stiction_index > 1.5 ? mergedTelemetry.stiction_index / 15 : mergedTelemetry.stiction_index;
      if (sticVal > 0.30) penalty += (sticVal - 0.30) * 95;
    }
    if (
      mergedTelemetry.setpoint_pct !== undefined &&
      mergedTelemetry.position_pct !== undefined
    ) {
      const dev = Math.abs(mergedTelemetry.setpoint_pct - mergedTelemetry.position_pct);
      if (dev > 2.5) penalty += (dev - 2.5) * 2.8;
    }

    const newHealth = Math.max(18, Math.min(98, Math.round(94 - penalty)));
    let newStatus = 'healthy';
    if (newHealth < 50) newStatus = 'attention_required';
    else if (newHealth < 65) newStatus = 'degraded';
    else if (newHealth < 82) newStatus = 'watch';

    const newTrendPoint = {
      time: nowStr,
      sp: mergedTelemetry.setpoint_pct,
      pv: mergedTelemetry.position_pct,
      stiction: mergedTelemetry.stiction_index,
      pressure: mergedTelemetry.pressure_bar,
      vibration: mergedTelemetry.vibration_mms,
      bearing_temp: mergedTelemetry.bearing_temp_c
    };

    const updatedTrend = [...(asset.telemetry_trend || []).slice(-5), newTrendPoint];

    const updatedEvents = [...asset.events];
    if (customReason || newStatus === 'attention_required') {
      updatedEvents.unshift({
        event_id: `EVT-LIVE-${Math.floor(1000 + Math.random() * 9000)}`,
        timestamp: `2026-03-03 ${new Date().toTimeString().slice(0, 8)}`,
        severity: newHealth < 55 ? 'critical' : 'high',
        event_type: customReason || asset.status_reason || 'TELEMETRY_EXCURSION',
        message: `Live in-memory pipeline update on ${asset.tag}: Health=${newHealth}%, Vib=${
          mergedTelemetry.vibration_mms ?? 'N/A'
        } mm/s, Temp=${mergedTelemetry.bearing_temp_c ?? mergedTelemetry.temperature_c}°C`
      });
    }

    return {
      ...asset,
      health_score: newHealth,
      health_status: newStatus,
      status_reason: customReason || (newStatus === 'healthy' ? 'NORMAL_OPERATION' : asset.status_reason),
      anomaly_score: Number(Math.min(0.99, Math.max(0.08, (100 - newHealth) / 62)).toFixed(2)),
      telemetry: mergedTelemetry,
      telemetry_trend: updatedTrend,
      events: updatedEvents.slice(0, 6)
    };
  });

  return {
    ...pipelineState,
    version: pipelineState.version + 1,
    lastUpdated: new Date().toLocaleTimeString(),
    assets: nextAssets
  };
}

/**
 * Simulates a live plant telemetry tick across all 30 assets in the fast in-memory array
 */
export function simulateLiveTelemetryTick(pipelineState) {
  const nextAssets = pipelineState.assets.map((asset) => {
    const t = { ...asset.telemetry };
    const jitter = (Math.random() - 0.48) * 0.08;
    if (t.pressure_bar !== undefined) {
      t.pressure_bar = Number(Math.max(1.5, t.pressure_bar + jitter).toFixed(2));
    }
    if (t.vibration_mms !== undefined) {
      t.vibration_mms = Number(Math.max(0.8, t.vibration_mms + jitter * 1.4).toFixed(2));
    }
    if (t.bearing_temp_c !== undefined) {
      t.bearing_temp_c = Number(Math.max(40, t.bearing_temp_c + jitter * 2.0).toFixed(1));
    }
    return {
      ...asset,
      telemetry: t
    };
  });

  return {
    ...pipelineState,
    version: pipelineState.version + 1,
    lastUpdated: new Date().toLocaleTimeString(),
    assets: nextAssets
  };
}
