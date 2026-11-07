import React, { useMemo, useState } from 'react';
import { humanize } from '../ui/status.js';
import { EXCEL_ASSET_RECORDS, getPartVisualSpec } from '../data/excelPartCatalog.js';

/**
 * Part-Specific, Excel-Backed 2D Static-Image Holographic AR Field Service HUD
 * - Adapts its transparent part image, 3D CAD cutaway callouts, sensor channels, LOTO steps,
 *   and SOP documentation to the exact clicked part class:
 *   CONTROL_VALVE | PROCESS_PUMP | ELECTRIC_MOTOR | PRESSURE_TRANSMITTER | VIBRATION_SENSOR | FORKLIFT | IBC_TOTE | CABINET
 * - Grounded in the exact rows of "Valmet x Since AI 2026 - Synthetic Industrial Metaverse Builder Data Pack.xlsx"
 */

const THEMES = {
  cyan: {
    id: 'cyan',
    label: 'Cyber Cyan',
    primary: '#00f2ff',
    secondary: '#38bdf8',
    border: 'rgba(0, 242, 255, 0.78)',
    borderSoft: 'rgba(0, 242, 255, 0.32)',
    bg: '#05111b',
    panelBg: 'rgba(6, 22, 36, 0.92)',
    headerBg: 'rgba(0, 242, 255, 0.14)',
    text: '#ecfeff',
    muted: '#94a3b8'
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald Mint',
    primary: '#10b981',
    secondary: '#34d399',
    border: 'rgba(16, 185, 129, 0.78)',
    borderSoft: 'rgba(16, 185, 129, 0.32)',
    bg: '#041612',
    panelBg: 'rgba(6, 28, 23, 0.92)',
    headerBg: 'rgba(16, 185, 129, 0.14)',
    text: '#ecfdf5',
    muted: '#94a3b8'
  },
  amber: {
    id: 'amber',
    label: 'Industrial Amber',
    primary: '#f59e0b',
    secondary: '#fbbf24',
    border: 'rgba(245, 158, 11, 0.82)',
    borderSoft: 'rgba(245, 158, 11, 0.34)',
    bg: '#181004',
    panelBg: 'rgba(30, 19, 6, 0.92)',
    headerBg: 'rgba(245, 158, 11, 0.15)',
    text: '#fffbeb',
    muted: '#cbd5e1'
  },
  violet: {
    id: 'violet',
    label: 'Violet Spectrum',
    primary: '#c084fc',
    secondary: '#e879f9',
    border: 'rgba(192, 132, 252, 0.82)',
    borderSoft: 'rgba(192, 132, 252, 0.34)',
    bg: '#13071e',
    panelBg: 'rgba(25, 10, 40, 0.92)',
    headerBg: 'rgba(192, 132, 252, 0.15)',
    text: '#faf5ff',
    muted: '#cbd5e1'
  }
};

/**
 * Generates a static PNG sparkline image for sensor cards (zero SVG DOM overhead).
 */
function generateStaticWaveDataUrl(values, color, width = 220, height = 42) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !values.length) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.001, max - min);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();

  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * (width - 8) + 4,
    height - 5 - ((v - min) / span) * (height - 10)
  ]);

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, color + '55');
  grad.addColorStop(1, color + '05');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], height);
  pts.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(pts[pts.length - 1][0], height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach(([x, y], idx) => {
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  return canvas.toDataURL('image/png');
}

function HolographicArAssetMenuInner({
  asset,
  assets = [],
  evidencePhoto,
  onClose,
  onSelectAsset,
  onUpdateTelemetry,
  onExecuteMaintenanceAction,
  onCenterAsset,
  onMoveObject,
  objectMoves = {}
}) {
  const [activeView, setActiveView] = useState('topology'); // 'topology' | 'multipanel' | 'badge' | 'cutaway' | 'executive' | 'excel'
  const [themeId, setThemeId] = useState('cyan');
  const [useOnlinePhoto, setUseOnlinePhoto] = useState(false);
  const [lotoChecked, setLotoChecked] = useState({
    0: false,
    1: false,
    2: true,
    3: true
  });
  const [savedNotice, setSavedNotice] = useState(false);

  const theme = THEMES[themeId] || THEMES.cyan;
  const excelRec = (asset?.asset_id && EXCEL_ASSET_RECORDS[asset.asset_id]) || asset?.excelRecord || null;
  const partSpec = useMemo(() => getPartVisualSpec(asset), [asset]);

  // Part-specific metrics grounded in the Excel workbook's Telemetry & Current_State sheets
  const partData = useMemo(() => {
    const exTel = excelRec?.excel_telemetry || {};
    const liveTel = asset?.telemetry || {};
    const health = Number(asset?.health_score ?? excelRec?.health_score ?? 85);
    const isFault = health < 75;
    const excelClass = excelRec?.asset_class || partSpec.excelClass;

    const issueCode =
      (asset?.status_reason && asset.status_reason !== 'NORMAL_OPERATION'
        ? asset.status_reason
        : excelRec?.issue_code) || (isFault ? 'DEGRADATION_DETECTED' : 'NORMAL');
    const issueSummary =
      excelRec?.issue_summary || asset?.service_description || 'No significant deviation';
    const recommendedAction =
      excelRec?.recommended_next_check || 'Inspect component and verify baseline';
    const urgency = (excelRec?.urgency || (health < 55 ? 'high' : health < 80 ? 'medium' : 'routine')).toUpperCase();
    const confidencePct = Math.round((excelRec?.model_confidence ?? 0.88) * 100);
    const rulHours = Math.max(24, Math.round(health * 3.25));
    const downtimeCost =
      (excelRec?.criticality || '').startsWith('A') ? 320 : (excelRec?.criticality || '').startsWith('B') ? 190 : 95;
    const nextMaintDays = Math.max(3, Math.round((excelRec?.service_interval_days || 365) * (health / 1000)));

    // Build 3 part-specific sensor rows + 4 mechanical readout cards + 2 cutaway datum values
    let sensors = [];
    let mechanicalCards = [];
    let callout1Value = '';
    let callout2Value = '';

    if (excelClass === 'CONTROL_VALVE') {
      const sp = Number(liveTel.setpoint_pct ?? exTel.position_setpoint_pct ?? 58.66);
      const pv = Number(liveTel.position_pct ?? exTel.position_actual_pct ?? 67.79);
      const dev = Math.abs(sp - pv);
      const stic = Number(exTel.stiction_index ?? (liveTel.stiction_index ? liveTel.stiction_index * 14.5 : 8.22));
      const loadPct = Number(exTel.load_for_opening_pct ?? 34.16);
      const supplyBar = Number(liveTel.supply_air_bar ?? exTel.pneumatic_supply_bar ?? 5.85);
      const pressBar = Number(liveTel.pressure_bar ?? exTel.process_pressure_bar ?? 4.95);
      const flowPct = Number(exTel.process_flow_pct ?? liveTel.flow_m3h ?? 51.1);

      callout1Value = `${stic.toFixed(2)} % stiction`;
      callout2Value = `${dev.toFixed(2)} % pos error`;

      sensors = [
        { label: 'Valve Position Actual, %', value: `${pv.toFixed(1)}% (SP ${sp.toFixed(1)}%)`, base: pv, color: theme.primary },
        { label: 'Actuator Stiction Index', value: stic.toFixed(2), base: stic, color: '#fbbf24' },
        { label: 'Process Flow, %', value: `${flowPct.toFixed(1)}%`, base: flowPct, color: '#10b981' }
      ];
      mechanicalCards = [
        { label: 'Position Tracking Deviation', val: `${(pv - sp >= 0 ? '+' : '') + (pv - sp).toFixed(2)} %`, color: dev > 3 ? '#f87171' : '#34d399' },
        { label: 'Load for Opening', val: `${loadPct.toFixed(1)} %`, color: '#fbbf24' },
        { label: 'Pneumatic Supply Air', val: `${supplyBar.toFixed(2)} bar`, color: theme.primary },
        { label: 'Line Process Pressure', val: `${pressBar.toFixed(2)} bar`, color: '#38bdf8' }
      ];
    } else if (excelClass === 'ELECTRIC_MOTOR') {
      const vib = Number(liveTel.vibration_mms ?? exTel.vibration_mm_s ?? 5.39);
      const bTemp = Number(liveTel.bearing_temp_c ?? exTel.bearing_temp_c ?? 56.3);
      const currA = Number(exTel.motor_current_a ?? 42.5);
      const rpm = Number(exTel.speed_rpm ?? 1486.0);
      const sigQ = Number(exTel.signal_quality_pct ?? 99.6);

      callout1Value = `${bTemp.toFixed(1)} °C DE bearing`;
      callout2Value = `${currA.toFixed(1)} A phase load`;

      sensors = [
        { label: 'RMS Vibration, mm/s', value: vib.toFixed(2), base: vib, color: theme.primary },
        { label: 'Bearing Temperature, °C', value: `${bTemp.toFixed(1)} °C`, base: bTemp, color: '#fbbf24' },
        { label: 'Stator Motor Current, A', value: `${currA.toFixed(1)} A`, base: currA, color: '#10b981' }
      ];
      mechanicalCards = [
        { label: 'Drive-End Bearing Temp', val: `${bTemp.toFixed(1)} °C`, color: bTemp > 68 ? '#f87171' : '#fbbf24' },
        { label: 'Motor Phase Current', val: `${currA.toFixed(2)} A`, color: theme.primary },
        { label: 'Rotor Shaft Speed', val: `${rpm.toFixed(0)} RPM`, color: '#34d399' },
        { label: 'Vibration Velocity (RMS)', val: `${vib.toFixed(2)} mm/s`, color: vib > 4 ? '#f87171' : '#38bdf8' }
      ];
    } else if (excelClass === 'PRESSURE_TRANSMITTER') {
      const pressBar = Number(liveTel.pressure_bar ?? exTel.process_pressure_bar ?? 5.12);
      const sigQ = Number(exTel.signal_quality_pct ?? 99.8);
      const bias = Number(exTel.sensor_bias ?? 0.0);
      const loopMa = 4 + (Math.min(10, Math.max(0, pressBar)) / 10) * 16;

      callout1Value = `${pressBar.toFixed(3)} bar`;
      callout2Value = `${sigQ.toFixed(1)} % signal`;

      sensors = [
        { label: 'Process Pressure, bar', value: `${pressBar.toFixed(3)} bar`, base: pressBar, color: theme.primary },
        { label: 'HART Loop Current, mA', value: `${loopMa.toFixed(2)} mA`, base: loopMa, color: '#10b981' },
        { label: 'Signal Quality, %', value: `${sigQ.toFixed(1)}%`, base: sigQ, color: '#38bdf8' }
      ];
      mechanicalCards = [
        { label: 'Process Pressure Reading', val: `${pressBar.toFixed(3)} bar`, color: theme.primary },
        { label: 'Transmitter Signal Quality', val: `${sigQ.toFixed(1)} %`, color: '#34d399' },
        { label: 'Zero Calibration Bias', val: `${bias.toFixed(3)} bar`, color: '#fbbf24' },
        { label: '4–20 mA Loop Output', val: `${loopMa.toFixed(2)} mA`, color: '#38bdf8' }
      ];
    } else if (excelClass === 'VIBRATION_SENSOR') {
      const vib = Number(liveTel.vibration_mms ?? exTel.vibration_mm_s ?? 4.56);
      const sigQ = Number(exTel.signal_quality_pct ?? 99.7);
      const bias = Number(exTel.sensor_bias ?? 0.0);

      callout1Value = `${vib.toFixed(3)} mm/s RMS`;
      callout2Value = `2.9 Nm M8 stud`;

      sensors = [
        { label: 'Piezo Vibration, mm/s', value: `${vib.toFixed(3)} mm/s`, base: vib, color: theme.primary },
        { label: 'IEPE Signal Quality, %', value: `${sigQ.toFixed(1)}%`, base: sigQ, color: '#10b981' },
        { label: 'Sensor Bias Drift', value: `${bias.toFixed(3)} g`, base: 1.0 + bias, color: '#fbbf24' }
      ];
      mechanicalCards = [
        { label: 'RMS Vibration Velocity', val: `${vib.toFixed(3)} mm/s`, color: vib > 3.5 ? '#f87171' : theme.primary },
        { label: 'IEPE Signal Quality', val: `${sigQ.toFixed(1)} %`, color: '#34d399' },
        { label: 'Accelerometer Bias', val: `${bias.toFixed(3)} g`, color: '#fbbf24' },
        { label: 'Stud Mounting Torque', val: isFault ? '1.4 Nm (Loose)' : '2.9 Nm (OK)', color: isFault ? '#f87171' : '#38bdf8' }
      ];
    } else {
      // PROCESS_PUMP & general equipment
      const pressBar = Number(liveTel.pressure_bar ?? exTel.process_pressure_bar ?? 4.51);
      const flowPct = Number(exTel.process_flow_pct ?? liveTel.flow_m3h ?? 64.6);
      const vib = Number(liveTel.vibration_mms ?? exTel.vibration_mm_s ?? 5.21);
      const bTemp = Number(liveTel.bearing_temp_c ?? exTel.bearing_temp_c ?? 56.4);
      const currA = Number(exTel.motor_current_a ?? 45.6);
      const rpm = Number(exTel.speed_rpm ?? 1480.1);

      callout1Value = `${(8.2 + (100 - health) * 0.075).toFixed(1)} mm wear`;
      callout2Value = `${pressBar.toFixed(2)} bar head`;

      sensors = [
        { label: 'Vibration, mm/s', value: vib.toFixed(2), base: vib, color: theme.primary },
        { label: 'Process Flow, %', value: `${flowPct.toFixed(1)}%`, base: flowPct, color: '#10b981' },
        { label: 'Discharge Pressure, bar', value: `${pressBar.toFixed(2)} bar`, base: pressBar, color: '#38bdf8' }
      ];
      mechanicalCards = [
        { label: 'Discharge Pressure', val: `${pressBar.toFixed(2)} bar`, color: theme.primary },
        { label: 'Process Flow Rate', val: `${flowPct.toFixed(1)} %`, color: '#34d399' },
        { label: 'Pump Vibration (RMS)', val: `${vib.toFixed(2)} mm/s`, color: vib > 4 ? '#f87171' : '#fbbf24' },
        { label: 'Drive Current / Speed', val: `${currA.toFixed(1)} A · ${rpm.toFixed(0)} RPM`, color: '#38bdf8' }
      ];
    }

    // Generate static sparkline URLs for each sensor channel
    const seed =
      (asset?.tag || 'P-005').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) || 42;
    const enrichedSensors = sensors.map((s, idx) => {
      const arr = [];
      for (let i = 0; i < 24; i++) {
        const t = i / 23;
        arr.push(
          s.base * (0.86 + 0.18 * Math.sin(t * 6.5 + seed + idx * 1.7) + 0.07 * Math.cos(t * 13))
        );
      }
      return {
        ...s,
        waveUrl: generateStaticWaveDataUrl(arr, s.color)
      };
    });

    return {
      health,
      isFault,
      excelClass,
      issueCode,
      issueSummary,
      recommendedAction,
      urgency,
      confidencePct,
      rulHours,
      downtimeCost,
      nextMaintDays,
      callout1Value,
      callout2Value,
      sensors: enrichedSensors,
      mechanicalCards
    };
  }, [asset, excelRec, partSpec, theme.primary]);

  // Connected process topology nodes for View 1 (same area or upstream/downstream)
  const topologyNodes = useMemo(() => {
    const areaName = excelRec?.area_name || asset?.area_name || 'Utility Island';
    const sameArea = assets.filter(
      (a) => (EXCEL_ASSET_RECORDS[a.asset_id]?.area_name || a.area_name) === areaName
    );
    const pool = sameArea.length >= 4 ? sameArea : assets;
    const picked = [];
    const curIdx = Math.max(0, pool.findIndex((a) => a.asset_id === asset?.asset_id));
    for (let offset = -1; offset <= 2; offset++) {
      const item = pool[(curIdx + offset + pool.length) % Math.max(1, pool.length)];
      if (item) picked.push(item);
    }
    if (!picked.length && asset) picked.push(asset);

    return picked.slice(0, 4).map((a, idx) => {
      const rec = EXCEL_ASSET_RECORDS[a.asset_id];
      const spec = getPartVisualSpec(a);
      const isCur = a.asset_id === asset?.asset_id;
      return {
        asset: a,
        tag: a.tag,
        role: spec.itemTypeName.replace('Pneumatic Globe ', '').replace('3-Phase Squirrel-Cage ', ''),
        metric: isCur
          ? `Health: ${partData.health}% (${partData.issueCode})`
          : `Health: ${a.health_score}% · ${rec?.connectivity_profile || 'OPC_UA'}`,
        wave: partData.sensors[idx % partData.sensors.length]?.waveUrl || partData.sensors[0]?.waveUrl,
        active: isCur
      };
    });
  }, [asset, assets, excelRec, partData]);

  // Area fleet status bars for View 5
  const fleetRows = useMemo(() => {
    const areaName = excelRec?.area_name || asset?.area_name || 'Utility Island';
    const sameArea = assets.filter(
      (a) => (EXCEL_ASSET_RECORDS[a.asset_id]?.area_name || a.area_name) === areaName
    );
    const subset = (sameArea.length >= 3 ? sameArea : assets).slice(0, 8);
    return subset.map((a) => ({
      asset_id: a.asset_id,
      tag: a.tag,
      classLabel: EXCEL_ASSET_RECORDS[a.asset_id]?.asset_class || a.asset_class,
      health: a.asset_id === asset?.asset_id ? partData.health : a.health_score,
      active: a.asset_id === asset?.asset_id
    }));
  }, [assets, asset, excelRec, partData.health]);

  if (!asset) return null;

  const cvObjId = asset.cvObject?.object_id || asset.object_id;
  const currentMove = (cvObjId && objectMoves[cvObjId]) || { dx: 0, dz: 0 };
  const bgPhoto = evidencePhoto || '/assets/vision/frames/FRM-005.jpg';
  const activePartImg = useOnlinePhoto ? partSpec.onlineTransparentUrl : partSpec.transparentImg + '?v=2';
  const itemTitle =
    excelRec?.excel_item_name ||
    asset.excel_item_name ||
    `${asset.tag} · ${partSpec.itemTypeName}`;

  const handleNudge = (dx, dz, reset = false) => {
    if (!onMoveObject || !cvObjId) return;
    if (reset) {
      onMoveObject(cvObjId, 0, 0);
    } else {
      onMoveObject(cvObjId, +(currentMove.dx + dx).toFixed(2), +(currentMove.dz + dz).toFixed(2));
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: activeView === 'badge' ? '520px' : 'min(920px, calc(100vw - 20px))',
        maxHeight: 'calc(100vh - 36px)',
        display: 'flex',
        flexDirection: 'column',
        background: theme.bg,
        border: `2px solid ${theme.primary}`,
        borderRadius: '10px',
        color: theme.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        zIndex: 85,
        overflow: 'hidden',
        boxShadow: '0 14px 36px rgba(0, 0, 0, 0.85)'
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Top Header: AR FIELD SERVICE + Exact Excel Item Name + Protocol/Area Badges */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: theme.headerBg,
          borderBottom: `1px solid ${theme.borderSoft}`,
          gap: '8px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 9px',
              borderRadius: '4px',
              border: `1px solid ${theme.primary}`,
              background: 'rgba(0, 0, 0, 0.45)',
              color: theme.primary,
              fontFamily: 'var(--mono)',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.06em'
            }}
          >
            ⬡ AR FIELD SERVICE
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 900, fontSize: '14px', color: '#fff' }}>
            {itemTitle}
          </span>
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'var(--mono)',
              padding: '2px 6px',
              borderRadius: '3px',
              background: 'rgba(0, 242, 255, 0.14)',
              border: `1px solid ${theme.borderSoft}`,
              color: theme.primary
            }}
          >
            {excelRec?.asset_class || partSpec.excelClass} · {excelRec?.connectivity_profile || 'OPC_UA'}
          </span>
          {excelRec?.criticality && (
            <span
              style={{
                fontSize: '10px',
                fontFamily: 'var(--mono)',
                padding: '2px 6px',
                borderRadius: '3px',
                background: 'rgba(245, 158, 11, 0.16)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#fbbf24'
              }}
            >
              Class {excelRec.criticality}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* 4 Color Theme Dots */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            {Object.values(THEMES).map((t) => (
              <button
                key={t.id}
                onClick={() => setThemeId(t.id)}
                title={t.label}
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  background: t.primary,
                  border: themeId === t.id ? '2px solid #fff' : '1px solid rgba(255,255,255,0.3)',
                  cursor: 'pointer',
                  padding: 0
                }}
              />
            ))}
          </div>

          <span
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              background: 'rgba(0, 0, 0, 0.55)',
              border: '1px solid rgba(16, 185, 129, 0.5)',
              color: '#e2e8f0',
              fontFamily: 'var(--mono)',
              fontSize: '11px',
              fontWeight: 700
            }}
          >
            <span style={{ color: '#10b981' }}>●</span> LIVE | 60 FPS
          </span>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(239, 68, 68, 0.18)',
              border: '1px solid rgba(239, 68, 68, 0.55)',
              color: '#fca5a5',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* View Switcher Tabs (5 Reference AR Views + Full Excel Workbook Sheet View) */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          padding: '6px 10px',
          background: 'rgba(0, 0, 0, 0.45)',
          borderBottom: `1px solid ${theme.borderSoft}`,
          overflowX: 'auto',
          alignItems: 'center'
        }}
      >
        {[
          { id: 'topology', label: '1. Topology & Causality' },
          { id: 'multipanel', label: '2. Multi-Panel HUD' },
          { id: 'badge', label: '3. Quick-Inspection Badge' },
          { id: 'cutaway', label: '4. Part Cutaway & Wear' },
          { id: 'executive', label: '5. Shift Manager Analytics' },
          { id: 'excel', label: '6. Excel Data Sheet' }
        ].map((tab) => {
          const on = activeView === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              style={{
                padding: '5px 10px',
                borderRadius: '4px',
                border: `1px solid ${on ? theme.primary : theme.borderSoft}`,
                background: on ? theme.primary : 'rgba(15, 23, 42, 0.7)',
                color: on ? '#031018' : theme.text,
                fontFamily: 'var(--mono)',
                fontSize: '11px',
                fontWeight: on ? 800 : 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {tab.label}
            </button>
          );
        })}

        <button
          onClick={() => setUseOnlinePhoto((v) => !v)}
          style={{
            marginLeft: 'auto',
            padding: '4px 8px',
            borderRadius: '4px',
            border: `1px solid ${theme.borderSoft}`,
            background: useOnlinePhoto ? 'rgba(16, 185, 129, 0.22)' : 'rgba(15, 23, 42, 0.7)',
            color: theme.text,
            fontFamily: 'var(--mono)',
            fontSize: '10px',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
          title="Switch between transparent holographic CAD part image and online transparent Wikimedia part diagram"
        >
          {useOnlinePhoto ? '🌐 Web Part Image: ON' : '🔷 Transparent Hologram PNG'}
        </button>
      </div>

      {/* Main Content Stage */}
      <div
        style={{
          position: 'relative',
          padding: '12px',
          overflowY: 'auto',
          backgroundImage: `linear-gradient(rgba(4, 14, 24, 0.80), rgba(4, 14, 24, 0.88)), url(${bgPhoto})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        {/* VIEW 1: SPATIAL PROCESS TOPOLOGY & CAUSALITY FLOW */}
        {activeView === 'topology' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Top 4-Node Causality Flow Chain */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {topologyNodes.map((n) => (
                <div
                  key={n.tag}
                  onClick={() => n.asset && onSelectAsset && onSelectAsset(n.asset.asset_id)}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    background: theme.panelBg,
                    border: `1.5px solid ${n.active ? '#f59e0b' : theme.primary}`,
                    cursor: n.asset ? 'pointer' : 'default',
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '12px' }}>
                    {n.tag}
                  </div>
                  <div style={{ fontSize: '10px', color: theme.muted, marginBottom: '4px' }}>
                    {n.role}
                  </div>
                  {n.wave && (
                    <img
                      src={n.wave}
                      alt={n.tag}
                      style={{ width: '100%', height: '28px', display: 'block', borderRadius: '3px' }}
                    />
                  )}
                  <div
                    style={{
                      marginTop: '4px',
                      fontFamily: 'var(--mono)',
                      fontSize: '10px',
                      fontWeight: 700,
                      color: n.active ? '#fbbf24' : theme.primary
                    }}
                  >
                    {n.metric}
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Row: Left Excel Diagnostic Callout + Right Transparent Part Cutout Image */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1.25fr', gap: '12px', alignItems: 'center' }}>
              <div
                style={{
                  padding: '14px',
                  borderRadius: '8px',
                  background: theme.panelBg,
                  border: `2px solid ${theme.primary}`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '26px', lineHeight: 1 }}>
                    {partData.isFault ? '⚠️' : '✅'}
                  </span>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '24px', fontWeight: 900, lineHeight: 1 }}>
                      {asset.tag}
                    </div>
                    <div style={{ fontSize: '11px', color: theme.primary, fontFamily: 'var(--mono)', marginTop: '2px' }}>
                      {partSpec.itemTypeName}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: '8px',
                    color: partData.isFault ? '#fbbf24' : '#34d399',
                    fontFamily: 'var(--mono)',
                    fontSize: '14px',
                    fontWeight: 800
                  }}
                >
                  {partData.isFault ? 'ATTENTION REQUIRED' : 'HEALTHY · NOMINAL'} (Conf: {partData.confidencePct}%)
                </div>

                <div style={{ marginTop: '6px', fontSize: '14px', fontWeight: 700 }}>
                  Health Score: {partData.health}/100 · Area: {excelRec?.area_name || asset.area_name}
                </div>

                <div style={{ marginTop: '6px', fontSize: '13px', fontWeight: 700 }}>
                  EXCEL ISSUE:{' '}
                  <span style={{ color: '#fbbf24' }}>
                    {partData.issueCode} — {partData.issueSummary}
                  </span>
                </div>

                <div style={{ marginTop: '8px', fontSize: '12px', color: '#e2e8f0', lineHeight: 1.4 }}>
                  <div style={{ color: theme.muted, fontSize: '10px', fontFamily: 'var(--mono)' }}>
                    EXCEL RECOMMENDED NEXT CHECK ({excelRec?.knowledge_doc_id || partSpec.sopDocId}):
                  </div>
                  <strong style={{ color: theme.primary }}>{humanize(partData.recommendedAction)}</strong> —{' '}
                  {excelRec?.excel_work_order
                    ? `Last WO ${excelRec.excel_work_order.work_order_id}: ${excelRec.excel_work_order.action} (${excelRec.excel_work_order.role})`
                    : partSpec.sopSummary}
                </div>
              </div>

              {/* Transparent Part Image Card */}
              <div
                style={{
                  position: 'relative',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: `1.5px solid ${theme.border}`,
                  background:
                    'radial-gradient(circle at center, rgba(0, 242, 255, 0.14) 0%, rgba(3, 12, 22, 0.72) 100%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px',
                  minHeight: '220px'
                }}
              >
                <img
                  src={activePartImg}
                  alt={itemTitle}
                  onError={(e) => {
                    e.currentTarget.src = partSpec.transparentImg;
                  }}
                  style={{
                    width: '100%',
                    maxHeight: '195px',
                    objectFit: 'contain',
                    display: 'block',
                    filter: 'drop-shadow(0 0 10px rgba(0, 242, 255, 0.35))'
                  }}
                />
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: '10px',
                    color: theme.muted,
                    marginTop: '4px'
                  }}
                >
                  {excelRec?.scene_path || `/SyntheticPlant/${asset.area_id}/${asset.tag}`} · QR: {excelRec?.qr_id || asset.qr_id}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: FLOATING MULTI-PANEL MODULAR HUD */}
        {activeView === 'multipanel' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr 1fr', gap: '10px', alignItems: 'stretch' }}>
            {/* Left Panel: Part-Specific Excel Sensor Channels */}
            <div
              style={{
                padding: '10px',
                borderRadius: '8px',
                background: theme.panelBg,
                border: `1.5px solid ${theme.primary}`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 800, color: theme.primary }}>
                📈 EXCEL TELEMETRY ({partData.excelClass})
              </div>

              {partData.sensors.map((s) => (
                <div key={s.label} style={{ marginTop: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span>{s.label}</span>
                    <strong style={{ fontFamily: 'var(--mono)', color: s.color }}>{s.value}</strong>
                  </div>
                  <img src={s.waveUrl} alt={s.label} style={{ width: '100%', height: '36px', display: 'block' }} />
                </div>
              ))}
            </div>

            {/* Center Panel: TAG / Health / Urgency + Transparent Part Image */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  background: theme.panelBg,
                  border: `2px solid ${theme.primary}`,
                  textAlign: 'center'
                }}
              >
                <div style={{ fontFamily: 'var(--mono)', fontSize: '17px', fontWeight: 900 }}>
                  TAG: {asset.tag} ({partSpec.itemTypeName})
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '14px', fontWeight: 800, color: '#fbbf24' }}>
                  Health: {partData.health}/100 · {partData.issueCode}
                </div>
                <div
                  style={{
                    marginTop: '6px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: partData.isFault ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.2)',
                    border: `1px solid ${partData.isFault ? '#ef4444' : '#10b981'}`,
                    color: partData.isFault ? '#fca5a5' : '#6ee7b7',
                    fontFamily: 'var(--mono)',
                    fontSize: '11px',
                    fontWeight: 800
                  }}
                >
                  ▲ URGENCY: {partData.urgency} · NEXT CHECK: {partData.recommendedAction.toUpperCase()}
                </div>
              </div>

              <div
                style={{
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: `1.5px solid ${theme.border}`,
                  background:
                    'radial-gradient(circle at center, rgba(0, 242, 255, 0.14) 0%, rgba(3, 12, 22, 0.78) 100%)',
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px'
                }}
              >
                <img
                  src={activePartImg}
                  alt={itemTitle}
                  onError={(e) => {
                    e.currentTarget.src = partSpec.transparentImg;
                  }}
                  style={{ width: '100%', height: '145px', objectFit: 'contain', display: 'block' }}
                />
              </div>
            </div>

            {/* Right Panel: Part-Specific LOCKOUT-TAGOUT & Excel RAG Doc */}
            <div
              style={{
                padding: '10px',
                borderRadius: '8px',
                background: theme.panelBg,
                border: `1.5px solid ${theme.primary}`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 800, color: theme.primary }}>
                🔒 {partData.excelClass} LOTO CHECKLIST
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' }}>
                {partSpec.lotoSteps.map((text, idx) => (
                  <label
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      borderRadius: '4px',
                      background: 'rgba(0,0,0,0.32)'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!lotoChecked[idx]}
                      onChange={() =>
                        setLotoChecked((prev) => ({ ...prev, [idx]: !prev[idx] }))
                      }
                      style={{ accentColor: theme.primary }}
                    />
                    <span>{text}</span>
                  </label>
                ))}
              </div>

              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '6px',
                  borderTop: `1px solid ${theme.borderSoft}`,
                  fontSize: '10px',
                  fontFamily: 'var(--mono)',
                  color: theme.muted
                }}
              >
                📄 Excel SOP & RAG Asset Card:
                <div style={{ color: theme.text, fontWeight: 700 }}>
                  {excelRec?.knowledge_doc_id || partSpec.sopDocId} · {excelRec?.rag_doc_file || `DOC-${asset.asset_id}.md`}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: MINIMALIST QUICK-INSPECTION BADGE */}
        {activeView === 'badge' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '8px' }}>
            <div
              style={{
                width: '170px',
                height: '170px',
                borderRadius: '50%',
                border: `3px solid ${theme.primary}`,
                boxShadow: `inset 0 0 18px ${theme.borderSoft}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 242, 255, 0.08)',
                flexShrink: 0,
                padding: '12px'
              }}
            >
              <img
                src={activePartImg}
                alt={asset.tag}
                onError={(e) => {
                  e.currentTarget.src = partSpec.transparentImg;
                }}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>

            <div
              style={{
                flex: 1,
                padding: '14px 18px',
                borderRadius: '8px',
                background: theme.panelBg,
                border: `2px solid ${theme.primary}`
              }}
            >
              <div style={{ fontFamily: 'var(--mono)', fontSize: '20px', fontWeight: 900 }}>
                {asset.tag} · {excelRec?.area_name || asset.area_name}
              </div>
              <div style={{ fontSize: '11px', color: theme.primary, fontFamily: 'var(--mono)' }}>
                {partSpec.itemTypeName}
              </div>
              <div style={{ fontSize: '11px', color: theme.muted, fontFamily: 'var(--mono)', marginTop: '6px' }}>
                EXCEL HEALTH SCORE ({partData.issueCode})
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '32px', fontWeight: 900, color: '#fbbf24', lineHeight: 1.05 }}>
                {partData.health}%
              </div>
              <div style={{ fontSize: '11px', color: theme.muted, fontFamily: 'var(--mono)', marginTop: '6px' }}>
                SERVICE INTERVAL / RUL
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '16px', fontWeight: 800, color: theme.primary, marginTop: '2px' }}>
                🕒 {partData.rulHours} hrs · Every {excelRec?.service_interval_days || 365}d
              </div>
            </div>
          </div>
        )}

        {/* VIEW 4: PART-SPECIFIC TRANSPARENT CUTAWAY & WEAR HEATMAP */}
        {activeView === 'cutaway' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: '12px', alignItems: 'stretch' }}>
            <div
              style={{
                position: 'relative',
                borderRadius: '8px',
                overflow: 'hidden',
                border: `1.5px solid ${theme.primary}`,
                background:
                  'radial-gradient(circle at center, rgba(0, 242, 255, 0.14) 0%, rgba(3, 10, 18, 0.92) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '255px',
                padding: '16px'
              }}
            >
              <img
                src={activePartImg}
                alt={itemTitle}
                onError={(e) => {
                  e.currentTarget.src = partSpec.transparentImg;
                }}
                style={{
                  width: '100%',
                  maxHeight: '225px',
                  objectFit: 'contain',
                  display: 'block',
                  filter: 'drop-shadow(0 0 12px rgba(0, 242, 255, 0.4))'
                }}
              />

              {/* Part-Specific Callout Box 1 */}
              <div
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '10px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: 'rgba(10, 22, 34, 0.92)',
                  border: '1.5px solid #fbbf24'
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700 }}>{partSpec.cutawayCallout1Label}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '15px', fontWeight: 900, color: '#fbbf24' }}>
                  {partData.callout1Value}
                </div>
              </div>

              {/* Part-Specific Callout Box 2 */}
              <div
                style={{
                  position: 'absolute',
                  right: '10px',
                  bottom: '10px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: 'rgba(10, 22, 34, 0.92)',
                  border: `1.5px solid ${theme.primary}`
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700 }}>{partSpec.cutawayCallout2Label}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '15px', fontWeight: 900, color: theme.primary }}>
                  {partData.callout2Value}
                </div>
              </div>

              {/* Bottom-Left Wear Level Legend */}
              <div
                style={{
                  position: 'absolute',
                  left: '10px',
                  bottom: '10px',
                  padding: '6px 9px',
                  borderRadius: '6px',
                  background: 'rgba(4, 14, 24, 0.9)',
                  border: `1px solid ${theme.borderSoft}`,
                  fontSize: '10px'
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: '3px' }}>Wear Level</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '9px', height: '9px', background: '#ef4444', display: 'inline-block' }} />
                  <span>High</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                  <span style={{ width: '9px', height: '9px', background: '#fbbf24', display: 'inline-block' }} />
                  <span>Med</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                  <span style={{ width: '9px', height: '9px', background: '#10b981', display: 'inline-block' }} />
                  <span>Low</span>
                </div>
              </div>
            </div>

            {/* Right Column: Part-Specific Excel Telemetry Readouts */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'space-between' }}>
              {partData.mechanicalCards.map((card) => (
                <div
                  key={card.label}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: theme.panelBg,
                    border: `1px solid ${theme.border}`
                  }}
                >
                  <div style={{ fontSize: '11px', color: theme.muted }}>{card.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '17px', fontWeight: 900, color: card.color }}>
                    {card.val}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIEW 5: SHIFT MANAGER ANALYTICS & PREDICTION DASHBOARD */}
        {activeView === 'executive' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.9fr 1.15fr', gap: '10px' }}>
              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  background: theme.panelBg,
                  border: `1.5px solid ${theme.primary}`
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '12px', marginBottom: '6px' }}>
                  {partData.sensors[0]?.label || 'Performance Trend'} (Excel Stream)
                </div>
                <img
                  src={partData.sensors[0]?.waveUrl}
                  alt="Performance Trend"
                  style={{ width: '100%', height: '92px', display: 'block', borderRadius: '4px' }}
                />
                <div style={{ display: 'flex', gap: '14px', fontSize: '11px', marginTop: '6px', fontFamily: 'var(--mono)' }}>
                  <span style={{ color: theme.primary }}>● Current ({partData.sensors[0]?.value})</span>
                  <span style={{ color: theme.muted }}>⋯ Baseline</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    background: theme.panelBg,
                    border: `1.5px solid ${theme.primary}`
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 700 }}>
                    Downtime Risk ({excelRec?.criticality || 'Standard'})
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: '22px',
                      fontWeight: 900,
                      color: '#fbbf24',
                      marginTop: '4px'
                    }}
                  >
                    € {partData.downtimeCost} /hr <span style={{ color: '#ef4444' }}>↗</span>
                  </div>
                </div>

                <div
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    background: theme.panelBg,
                    border: `1.5px solid ${theme.primary}`
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 700 }}>
                    Service Interval ({excelRec?.service_interval_days || 365}d cycle)
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: '18px',
                      fontWeight: 900,
                      color: '#fbbf24',
                      marginTop: '4px'
                    }}
                  >
                    📅 Next in {partData.nextMaintDays} days
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  background: theme.panelBg,
                  border: `1.5px solid ${theme.primary}`
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '12px', marginBottom: '6px' }}>
                  Fleet Status ({excelRec?.area_name || asset.area_name})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {fleetRows.map((r) => (
                    <div
                      key={r.tag}
                      onClick={() => r.asset_id && onSelectAsset && onSelectAsset(r.asset_id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '58px 1fr 36px',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        fontFamily: 'var(--mono)',
                        cursor: r.asset_id ? 'pointer' : 'default',
                        color: r.active ? '#fbbf24' : theme.text,
                        fontWeight: r.active ? 800 : 500
                      }}
                    >
                      <span>{r.active ? `▲ ${r.tag}` : `● ${r.tag}`}</span>
                      <div style={{ height: '7px', background: 'rgba(255,255,255,0.12)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${r.health}%`,
                            height: '100%',
                            background: r.health < 70 ? '#fbbf24' : '#10b981'
                          }}
                        />
                      </div>
                      <span style={{ textAlign: 'right' }}>{r.health}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: '8px',
                background: theme.panelBg,
                border: `1.5px solid ${theme.primary}`
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>⚠️</span>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '13px', color: '#fbbf24' }}>
                    {itemTitle} — {partData.issueCode}
                  </div>
                  <div style={{ fontSize: '12px', color: '#e2e8f0' }}>
                    {partData.issueSummary} · Next check: {partData.recommendedAction}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveView('excel')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: `1.5px solid ${theme.primary}`,
                  background: theme.headerBg,
                  color: theme.text,
                  fontFamily: 'var(--mono)',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Excel Data →
              </button>
            </div>
          </div>
        )}

        {/* VIEW 6: COMPLETE EXCEL WORKBOOK RECORD FOR THIS PART */}
        {activeView === 'excel' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '11px' }}>
            <div
              style={{
                padding: '10px',
                borderRadius: '8px',
                background: theme.panelBg,
                border: `1.5px solid ${theme.primary}`
              }}
            >
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, color: theme.primary, marginBottom: '6px' }}>
                📋 SHEET 3 & 4: ASSET_MASTER + SCENE_ANCHORS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '135px 1fr', rowGap: '4px', fontFamily: 'var(--mono)' }}>
                <span style={{ color: theme.muted }}>asset_id / tag:</span>
                <span>{excelRec?.asset_id || asset.asset_id} / {asset.tag}</span>
                <span style={{ color: theme.muted }}>asset_class:</span>
                <span>{excelRec?.asset_class || partSpec.excelClass}</span>
                <span style={{ color: theme.muted }}>area_id / name:</span>
                <span>{excelRec?.area_id || asset.area_id} · {excelRec?.area_name || asset.area_name}</span>
                <span style={{ color: theme.muted }}>process_context:</span>
                <span>{excelRec?.process_context || 'utilities'}</span>
                <span style={{ color: theme.muted }}>criticality:</span>
                <span style={{ color: '#fbbf24' }}>{excelRec?.criticality || asset.criticality}</span>
                <span style={{ color: theme.muted }}>install / service:</span>
                <span>{excelRec?.installation_date || '2020-05-01'} / {excelRec?.last_service_date || '2026-01-15'}</span>
                <span style={{ color: theme.muted }}>connectivity:</span>
                <span>{excelRec?.connectivity_profile || 'OPC_UA'}</span>
                <span style={{ color: theme.muted }}>qr_id / nfc_id:</span>
                <span>{excelRec?.qr_id || asset.qr_id} / {excelRec?.nfc_id || 'NFC-SYN'}</span>
                <span style={{ color: theme.muted }}>scene_path:</span>
                <span>{excelRec?.scene_path || `/SyntheticPlant/${asset.tag}`}</span>
              </div>
            </div>

            <div
              style={{
                padding: '10px',
                borderRadius: '8px',
                background: theme.panelBg,
                border: `1.5px solid ${theme.primary}`
              }}
            >
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, color: theme.primary, marginBottom: '6px' }}>
                🔍 SHEET 5, 7, 8 & 12: STATE, EVENTS, WO & DATA QUALITY
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '135px 1fr', rowGap: '4px', fontFamily: 'var(--mono)' }}>
                <span style={{ color: theme.muted }}>condition_state:</span>
                <span style={{ color: '#fbbf24' }}>
                  {excelRec?.condition_state || asset.health_status} ({partData.health}/100)
                </span>
                <span style={{ color: theme.muted }}>issue_code:</span>
                <span>{partData.issueCode}</span>
                <span style={{ color: theme.muted }}>issue_summary:</span>
                <span>{partData.issueSummary}</span>
                <span style={{ color: theme.muted }}>next_check:</span>
                <span>{partData.recommendedAction} (conf: {partData.confidencePct}%)</span>
                <span style={{ color: theme.muted }}>latest_event:</span>
                <span>
                  {excelRec?.excel_event
                    ? `${excelRec.excel_event.event_id} · ${excelRec.excel_event.event_code} (${excelRec.excel_event.status})`
                    : 'EVT-NOMINAL'}
                </span>
                <span style={{ color: theme.muted }}>work_order:</span>
                <span>
                  {excelRec?.excel_work_order
                    ? `${excelRec.excel_work_order.work_order_id} · ${excelRec.excel_work_order.action} (${excelRec.excel_work_order.duration_h}h)`
                    : 'WO-STANDBY'}
                </span>
                <span style={{ color: theme.muted }}>knowledge_doc:</span>
                <span>
                  {excelRec?.knowledge_doc_id || partSpec.sopDocId} ({excelRec?.rag_doc_file || 'RAG'})
                </span>
                <span style={{ color: theme.muted }}>data_quality:</span>
                <span>
                  {excelRec?.excel_dq
                    ? `${excelRec.excel_dq.issue_id}: ${excelRec.excel_dq.issue_type} → ${excelRec.excel_dq.recommended_handling}`
                    : 'Verified'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Bar: 1-Click 3D Part Move + Dispatch / Restore / Inject Fault */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(0, 0, 0, 0.65)',
          borderTop: `1px solid ${theme.borderSoft}`,
          gap: '8px',
          flexWrap: 'wrap'
        }}
      >
        {cvObjId && onMoveObject ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.primary, fontWeight: 700 }}>
              ✥ MOVE 3D PART ({cvObjId}):
            </span>
            {[
              { label: '◀ Left', dx: -0.5, dz: 0 },
              { label: '▲ Fwd', dx: 0, dz: 0.5 },
              { label: '▼ Back', dx: 0, dz: -0.5 },
              { label: 'Right ▶', dx: 0.5, dz: 0 },
              { label: '↺ Reset', reset: true }
            ].map((b) => (
              <button
                key={b.label}
                onClick={() => handleNudge(b.dx, b.dz, b.reset)}
                style={{
                  padding: '3px 7px',
                  borderRadius: '4px',
                  border: `1px solid ${theme.borderSoft}`,
                  background: 'rgba(15, 23, 42, 0.9)',
                  color: theme.text,
                  fontFamily: 'var(--mono)',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        ) : (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: theme.muted }}>
            Excel Source: Valmet_SinceAI_2026_Builder_Pack.xlsx
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {onExecuteMaintenanceAction && asset.asset_id && !String(asset.asset_id).startsWith('UNBOUND-') && (
            <>
              <button
                onClick={() => onExecuteMaintenanceAction(asset.asset_id, 'dispatch')}
                style={{
                  padding: '4px 9px',
                  borderRadius: '4px',
                  border: `1px solid ${theme.primary}`,
                  background: theme.primary,
                  color: '#04121d',
                  fontFamily: 'var(--mono)',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                Dispatch Tech
              </button>
              <button
                onClick={() => onExecuteMaintenanceAction(asset.asset_id, 'restore')}
                style={{
                  padding: '4px 9px',
                  borderRadius: '4px',
                  border: '1px solid #10b981',
                  background: 'rgba(16, 185, 129, 0.18)',
                  color: '#6ee7b7',
                  fontFamily: 'var(--mono)',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Restore Nominal
              </button>
              <button
                onClick={() => onExecuteMaintenanceAction(asset.asset_id, 'inject_fault')}
                style={{
                  padding: '4px 9px',
                  borderRadius: '4px',
                  border: '1px solid #ef4444',
                  background: 'rgba(239, 68, 68, 0.18)',
                  color: '#fca5a5',
                  fontFamily: 'var(--mono)',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Inject Fault
              </button>
            </>
          )}
          <button
            onClick={() => {
              setSavedNotice(true);
              setTimeout(() => setSavedNotice(false), 1500);
            }}
            style={{
              padding: '4px 9px',
              borderRadius: '4px',
              border: `1px solid ${theme.border}`,
              background: theme.headerBg,
              color: theme.text,
              fontFamily: 'var(--mono)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {savedNotice ? '✓ Saved' : '✓ Save Layout'}
          </button>
        </div>
      </div>
    </div>
  );
}

const HolographicArAssetMenu = React.memo(HolographicArAssetMenuInner);
export default HolographicArAssetMenu;
