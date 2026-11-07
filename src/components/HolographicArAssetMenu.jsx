import React, { useMemo, useState } from 'react';
import { humanize } from '../ui/status.js';

/**
 * Lightweight, iPad-optimized Holographic AR Field Service HUD.
 * - Pre-renders complex holographic wireframes, thermal wear heatmaps, and sensor waveforms
 *   ONCE into static <canvas> data-URI images (zero per-frame SVG/DOM layout or backdrop-filter GPU blur).
 * - Matches the exact typography and layouts of the 5 AR Field Service views + 4 color themes.
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
 * Generates a single static PNG data-URI for the 3D CAD Internal Cutaway & Thermal Wear Heatmap
 * so iPad Safari displays a simple static <img> with zero continuous GPU/DOM overhead.
 */
function generateStaticCadCutawayDataUrl(asset, theme, explodePct = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 560;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Dark industrial background with subtle grid
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 300);
  bgGrad.addColorStop(0, '#071521');
  bgGrad.addColorStop(1, '#030a11');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 560, 300);

  ctx.strokeStyle = 'rgba(0, 242, 255, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 560; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 300);
    ctx.stroke();
  }
  for (let y = 0; y < 300; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(560, y);
    ctx.stroke();
  }

  const shift = (explodePct / 100) * 26;

  // Thermal Wear Heatmap radial glow at impeller core
  const heatGrad = ctx.createRadialGradient(265, 145, 8, 265, 145, 92);
  heatGrad.addColorStop(0, 'rgba(239, 68, 68, 0.92)');
  heatGrad.addColorStop(0.42, 'rgba(245, 158, 11, 0.75)');
  heatGrad.addColorStop(0.75, 'rgba(16, 185, 129, 0.35)');
  heatGrad.addColorStop(1, 'rgba(0, 242, 255, 0)');
  ctx.fillStyle = heatGrad;
  ctx.beginPath();
  ctx.arc(265, 145, 92, 0, Math.PI * 2);
  ctx.fill();

  // Holographic wireframe styling
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 1.6;

  // Left suction flange & shaft housing
  ctx.strokeRect(82 - shift, 116, 95, 58);
  ctx.beginPath();
  ctx.ellipse(82 - shift, 145, 16, 36, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let x = 100 - shift; x < 170 - shift; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, 116);
    ctx.lineTo(x, 174);
    ctx.stroke();
  }

  // Top discharge nozzle
  ctx.strokeRect(236, 38 - shift * 0.6, 58, 52);
  ctx.beginPath();
  ctx.ellipse(265, 38 - shift * 0.6, 35, 11, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Central volute casing & impeller blades
  ctx.beginPath();
  ctx.arc(265, 145, 62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(265, 145, 42, 0, Math.PI * 2);
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Impeller vanes
  for (let a = 0; a < 8; a++) {
    const rad = (a * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(265 + Math.cos(rad) * 14, 145 + Math.sin(rad) * 14);
    ctx.lineTo(265 + Math.cos(rad + 0.35) * 42, 145 + Math.sin(rad + 0.35) * 42);
    ctx.stroke();
  }

  // Bottom suction strainer basket
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(233, 207 + shift * 0.6, 64, 72);
  ctx.beginPath();
  ctx.ellipse(265, 279 + shift * 0.6, 32, 9, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Strainer mesh crosshatch
  ctx.strokeStyle = 'rgba(0, 242, 255, 0.35)';
  ctx.lineWidth = 1;
  for (let y = 216 + shift * 0.6; y < 274 + shift * 0.6; y += 10) {
    ctx.beginPath();
    ctx.moveTo(236, y);
    ctx.lineTo(294, y);
    ctx.stroke();
  }

  // Right drive motor & cooling fins
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(328 + shift, 102, 126, 86);
  ctx.beginPath();
  ctx.ellipse(454 + shift, 145, 16, 43, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let y = 112; y <= 178; y += 11) {
    ctx.beginPath();
    ctx.moveTo(338 + shift, y);
    ctx.lineTo(442 + shift, y);
    ctx.stroke();
  }

  // Leader line 1: Impeller Erosion
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(276, 126);
  ctx.lineTo(352, 54);
  ctx.lineTo(385, 54);
  ctx.stroke();
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(276, 126, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Leader line 2: Suction Strainer Pressure Drop
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(265, 245 + shift * 0.6);
  ctx.lineTo(352, 245);
  ctx.lineTo(385, 245);
  ctx.stroke();
  ctx.fillStyle = theme.primary;
  ctx.beginPath();
  ctx.arc(265, 245 + shift * 0.6, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // 3D XYZ coordinate triad bottom-left
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(30, 272);
  ctx.lineTo(58, 272);
  ctx.moveTo(30, 272);
  ctx.lineTo(30, 244);
  ctx.moveTo(30, 272);
  ctx.lineTo(18, 284);
  ctx.stroke();
  ctx.fillStyle = theme.primary;
  ctx.font = 'bold 10px monospace';
  ctx.fillText('X', 62, 275);
  ctx.fillText('Z', 27, 239);

  return canvas.toDataURL('image/png');
}

/**
 * Generates a static PNG sparkline image for sensor cards (zero SVG DOM overhead).
 */
function generateStaticWaveDataUrl(values, color, width = 220, height = 46) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !values.length) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.001, max - min);

  // Subtle horizontal grid
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();

  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * (width - 8) + 4,
    height - 6 - ((v - min) / span) * (height - 12)
  ]);

  // Fill area under curve
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

  // Stroke line
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
  // 5 core reference views from Image 1 + Multi-Sensor Suite from Image 2
  const [activeView, setActiveView] = useState('topology'); // 'topology' | 'multipanel' | 'badge' | 'cutaway' | 'executive' | 'sensors'
  const [themeId, setThemeId] = useState('cyan');
  const [explodePct, setExplodePct] = useState(0);
  const [lotoChecked, setLotoChecked] = useState({
    step1: false,
    step2: false,
    step3: true,
    step4: true
  });
  const [savedNotice, setSavedNotice] = useState(false);

  const theme = THEMES[themeId] || THEMES.cyan;

  // Derived asset metrics matching reference screenshots
  const metrics = useMemo(() => {
    const seed =
      (asset?.tag || 'P-005').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) || 42;
    const vib = Number(asset?.telemetry?.vibration_mms ?? 5.8);
    const press = Number(asset?.telemetry?.pressure_bar ?? 2.18);
    const temp = Number(asset?.telemetry?.temperature_c ?? 78.4);
    const flow = Number(asset?.telemetry?.flow_m3h ?? 86.4);
    const stiction = Number(asset?.telemetry?.stiction_index ?? 0.72);
    const health = Number(asset?.health_score ?? 44);
    const isFault = health < 75;
    const rulHours = Math.max(18, Math.round(health * 3.22));
    const downtimeCost = isFault ? 320 : 95;
    const nextMaintDays = Math.max(2, Math.round(health * 0.41));
    const impellerErosionMm = (8.2 + (100 - health) * 0.075).toFixed(1);
    const strainerDropM = (5.4 + (100 - health) * 0.081).toFixed(2);

    const vibSeries = [];
    const sucSeries = [];
    const flowSeries = [];
    const baseSeries = [];
    for (let i = 0; i < 24; i++) {
      const t = i / 23;
      vibSeries.push(vib * (0.78 + 0.25 * Math.sin(t * 7 + seed) + 0.1 * Math.cos(t * 15)));
      sucSeries.push(stiction * (0.82 + 0.2 * Math.cos(t * 6 + seed * 0.4)));
      flowSeries.push(flow * (0.88 + 0.14 * Math.sin(t * 5 + 1.2)));
      baseSeries.push(vib * 0.62 * (0.9 + 0.1 * Math.sin(t * 4)));
    }

    return {
      vib,
      press,
      temp,
      flow,
      stiction,
      health,
      isFault,
      rulHours,
      downtimeCost,
      nextMaintDays,
      impellerErosionMm,
      strainerDropM,
      vibSeries,
      sucSeries,
      flowSeries,
      baseSeries
    };
  }, [asset]);

  // Pre-rendered static images (computed only when asset, theme, or explode slider changes)
  const staticCadUrl = useMemo(
    () => generateStaticCadCutawayDataUrl(asset, theme, explodePct),
    [asset?.asset_id, asset?.health_score, theme, explodePct]
  );
  const vibWaveUrl = useMemo(
    () => generateStaticWaveDataUrl(metrics.vibSeries, theme.primary),
    [metrics.vibSeries, theme.primary]
  );
  const sucWaveUrl = useMemo(
    () => generateStaticWaveDataUrl(metrics.sucSeries, '#10b981'),
    [metrics.sucSeries]
  );
  const flowWaveUrl = useMemo(
    () => generateStaticWaveDataUrl(metrics.flowSeries, '#38bdf8'),
    [metrics.flowSeries]
  );

  // Connected process chain for View 1 (Spatial Process Topology & Causality Flow)
  const topologyNodes = useMemo(() => {
    const findByTag = (t) => assets.find((a) => a.tag === t);
    return [
      {
        tag: 'P-002',
        role: 'Suction Strainer',
        metric: 'ΔP: 0.12 bar',
        asset: findByTag('P-002'),
        wave: sucWaveUrl,
        active: false
      },
      {
        tag: asset?.tag || 'P-005',
        role: asset?.class ? humanize(asset.class) : 'Process Pump',
        metric: `Health: ${metrics.health}%`,
        asset,
        wave: vibWaveUrl,
        active: true
      },
      {
        tag: 'CV-005',
        role: 'Downstream Valve',
        metric: 'ΔP: 0.31 bar',
        asset: findByTag('CV-005') || findByTag('CV-001'),
        wave: flowWaveUrl,
        active: false
      },
      {
        tag: 'PT-002',
        role: 'Pressure Transmitter',
        metric: `P: ${metrics.press.toFixed(2)} bar`,
        asset: findByTag('PT-002') || findByTag('FT-002'),
        wave: sucWaveUrl,
        active: false
      }
    ];
  }, [asset, assets, metrics.health, metrics.press, sucWaveUrl, vibWaveUrl, flowWaveUrl]);

  // Utility Island fleet bars for View 5
  const fleetRows = useMemo(() => {
    const subset = assets.slice(0, 8);
    if (!subset.length) {
      return [
        { tag: 'P-001', health: 97 },
        { tag: 'P-002', health: 93 },
        { tag: 'P-003', health: 76 },
        { tag: 'P-004', health: 88 },
        { tag: asset?.tag || 'P-005', health: metrics.health, active: true },
        { tag: 'P-006', health: 91 },
        { tag: 'P-007', health: 95 },
        { tag: 'P-008', health: 92 }
      ];
    }
    return subset.map((a) => ({
      asset_id: a.asset_id,
      tag: a.tag,
      health: a.asset_id === asset?.asset_id ? metrics.health : a.health_score,
      active: a.asset_id === asset?.asset_id
    }));
  }, [assets, asset, metrics.health]);

  if (!asset) return null;

  const cvObjId = asset.cvObject?.object_id;
  const currentMove = (cvObjId && objectMoves[cvObjId]) || { dx: 0, dz: 0 };
  const bgPhoto = evidencePhoto || '/assets/vision/frames/FRM-005.jpg';

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
        width: activeView === 'badge' ? '480px' : 'min(880px, calc(100vw - 24px))',
        maxHeight: 'calc(100vh - 48px)',
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
      {/* Top Bar: AR FIELD SERVICE badge + Theme Dots + LIVE | 60 FPS */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '14px' }}>
            {asset.tag}
          </span>
          <span style={{ fontSize: '12px', color: theme.muted }}>
            {asset.service_description}
          </span>
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

      {/* 5 Reference Mode Switcher Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          padding: '6px 10px',
          background: 'rgba(0, 0, 0, 0.4)',
          borderBottom: `1px solid ${theme.borderSoft}`,
          overflowX: 'auto'
        }}
      >
        {[
          { id: 'topology', label: '1. Topology & Causality' },
          { id: 'multipanel', label: '2. Multi-Panel HUD' },
          { id: 'badge', label: '3. Quick-Inspection Badge' },
          { id: 'cutaway', label: '4. 3D CAD & Wear Heatmap' },
          { id: 'executive', label: '5. Shift Manager Analytics' }
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
      </div>

      {/* Main Static-Image-Backed Holographic Content Stage */}
      <div
        style={{
          position: 'relative',
          padding: '12px',
          overflowY: 'auto',
          backgroundImage: `linear-gradient(rgba(4, 14, 24, 0.78), rgba(4, 14, 24, 0.86)), url(${bgPhoto})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        {/* VIEW 1: SPATIAL PROCESS TOPOLOGY & CAUSALITY FLOW */}
        {activeView === 'topology' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Top 4-Node Causality Flow Chain */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '8px'
              }}
            >
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
                  <img
                    src={n.wave}
                    alt={n.tag}
                    style={{ width: '100%', height: '30px', display: 'block', borderRadius: '3px' }}
                  />
                  <div
                    style={{
                      marginTop: '4px',
                      fontFamily: 'var(--mono)',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: n.active ? '#fbbf24' : theme.primary
                    }}
                  >
                    {n.metric}
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Row: Left Warning Callout Box + Right Static Holographic CAD Overlay */}
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
                  <span style={{ fontSize: '28px', lineHeight: 1 }}>⚠️</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '26px', fontWeight: 900 }}>
                    {asset.tag}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: '6px',
                    color: '#fbbf24',
                    fontFamily: 'var(--mono)',
                    fontSize: '15px',
                    fontWeight: 800,
                    letterSpacing: '0.03em'
                  }}
                >
                  {metrics.isFault ? 'ATTENTION REQUIRED' : 'NOMINAL OPERATION'}
                </div>
                <div style={{ marginTop: '8px', fontSize: '14px', fontWeight: 700 }}>
                  Health Score: {metrics.health}/100
                </div>
                <div style={{ marginTop: '6px', fontSize: '14px', fontWeight: 700 }}>
                  ISSUE:{' '}
                  <span style={{ color: '#fbbf24' }}>
                    {asset.anomaly_Mode || (metrics.isFault ? 'FOULING / CAVITATION' : 'NONE')}
                  </span>
                </div>
                <div style={{ marginTop: '8px', fontSize: '13px', color: '#e2e8f0', lineHeight: 1.4 }}>
                  <div style={{ color: theme.muted, fontSize: '11px', fontFamily: 'var(--mono)' }}>
                    RECOMMENDED ACTION:
                  </div>
                  Inspect hydraulic path & clear suction strainer
                </div>
              </div>

              {/* Static Pre-Rendered Holographic CAD Image */}
              <div
                style={{
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: `1.5px solid ${theme.border}`,
                  background: '#04101a'
                }}
              >
                <img
                  src={staticCadUrl}
                  alt="Static Holographic CAD"
                  style={{ width: '100%', height: '210px', objectFit: 'cover', display: 'block' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: FLOATING MULTI-PANEL MODULAR HUD */}
        {activeView === 'multipanel' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr 1fr', gap: '10px', alignItems: 'stretch' }}>
            {/* Left Panel: LIVE SENSOR DATA (30 min) */}
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
              <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 800, color: theme.primary }}>
                📈 LIVE SENSOR DATA (30 min)
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '6px' }}>
                  <span>Vibration, mm/s</span>
                  <strong style={{ fontFamily: 'var(--mono)' }}>{metrics.vib.toFixed(1)}</strong>
                </div>
                <img src={vibWaveUrl} alt="Vibration" style={{ width: '100%', height: '38px', display: 'block' }} />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span>Suction Index</span>
                  <strong style={{ fontFamily: 'var(--mono)' }}>{metrics.stiction.toFixed(2)}</strong>
                </div>
                <img src={sucWaveUrl} alt="Suction" style={{ width: '100%', height: '38px', display: 'block' }} />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                  <span>Flow Rate, m³/h</span>
                  <strong style={{ fontFamily: 'var(--mono)' }}>{metrics.flow.toFixed(1)}</strong>
                </div>
                <img src={flowWaveUrl} alt="Flow" style={{ width: '100%', height: '38px', display: 'block' }} />
              </div>
            </div>

            {/* Center Panel: TAG / Health / HIGH URGENCY + Static Hologram Image */}
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
                <div style={{ fontFamily: 'var(--mono)', fontSize: '18px', fontWeight: 900 }}>
                  TAG: {asset.tag}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '15px', fontWeight: 800, color: '#fbbf24' }}>
                  Health: {metrics.health}/100
                </div>
                <div
                  style={{
                    marginTop: '6px',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    background: 'rgba(239, 68, 68, 0.25)',
                    border: '1px solid #ef4444',
                    color: '#fca5a5',
                    fontFamily: 'var(--mono)',
                    fontSize: '12px',
                    fontWeight: 800
                  }}
                >
                  ▲ {metrics.isFault ? 'HIGH URGENCY' : 'NORMAL PRIORITY'}
                </div>
              </div>

              <div
                style={{
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: `1.5px solid ${theme.border}`,
                  background: '#04101a',
                  flex: 1
                }}
              >
                <img
                  src={staticCadUrl}
                  alt="Holographic Asset"
                  style={{ width: '100%', height: '145px', objectFit: 'cover', display: 'block' }}
                />
              </div>
            </div>

            {/* Right Panel: LOCKOUT-TAGOUT */}
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
              <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 800, color: theme.primary }}>
                🔒 LOCKOUT-TAGOUT
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                {[
                  { key: 'step1', text: 'Isolate inlet valve' },
                  { key: 'step2', text: 'Depressurize system' },
                  { key: 'step3', text: 'Verify zero energy' },
                  { key: 'step4', text: 'Apply lock & tag' }
                ].map((item) => (
                  <label
                    key={item.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      borderRadius: '4px',
                      background: 'rgba(0,0,0,0.3)'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!lotoChecked[item.key]}
                      onChange={() =>
                        setLotoChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }))
                      }
                      style={{ accentColor: theme.primary }}
                    />
                    <span>{item.text}</span>
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
                📄 SOP Reference:
                <div style={{ color: theme.text, fontWeight: 700 }}>DOC-PROCESS_PUMP-CORE</div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: MINIMALIST QUICK-INSPECTION BADGE */}
        {activeView === 'badge' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '8px' }}>
            {/* Static Glowing Holographic Target Ring */}
            <div
              style={{
                width: '150px',
                height: '150px',
                borderRadius: '50%',
                border: `3px solid ${theme.primary}`,
                boxShadow: `inset 0 0 18px ${theme.borderSoft}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 242, 255, 0.08)',
                flexShrink: 0
              }}
            >
              <div
                style={{
                  width: '112px',
                  height: '112px',
                  borderRadius: '50%',
                  border: `1.5px dashed ${theme.primary}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--mono)'
                }}
              >
                <span style={{ fontSize: '11px', color: theme.muted }}>TARGET</span>
                <strong style={{ fontSize: '18px', color: theme.primary }}>{asset.tag}</strong>
              </div>
            </div>

            {/* Right Quick-Inspection Readout Box */}
            <div
              style={{
                flex: 1,
                padding: '14px 18px',
                borderRadius: '8px',
                background: theme.panelBg,
                border: `2px solid ${theme.primary}`
              }}
            >
              <div style={{ fontFamily: 'var(--mono)', fontSize: '22px', fontWeight: 900 }}>
                {asset.tag}
              </div>
              <div style={{ fontSize: '12px', color: theme.muted, fontFamily: 'var(--mono)', marginTop: '4px' }}>
                HEALTH
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '34px', fontWeight: 900, color: '#fbbf24', lineHeight: 1.05 }}>
                {metrics.health}%
              </div>
              <div style={{ fontSize: '11px', color: theme.muted, fontFamily: 'var(--mono)', marginTop: '8px' }}>
                REMAINING USEFUL LIFE
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '20px', fontWeight: 800, color: theme.primary, marginTop: '2px' }}>
                🕒 {metrics.rulHours} hrs
              </div>
            </div>
          </div>
        )}

        {/* VIEW 4: 3D CAD INTERNAL CUTAWAY & WEAR HEATMAP (STATIC IMAGE + CALLOUTS) */}
        {activeView === 'cutaway' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: '12px', alignItems: 'stretch' }}>
            <div
              style={{
                position: 'relative',
                borderRadius: '8px',
                overflow: 'hidden',
                border: `1.5px solid ${theme.primary}`,
                background: '#030a11'
              }}
            >
              <img
                src={staticCadUrl}
                alt="3D CAD Cutaway & Wear Heatmap"
                style={{ width: '100%', height: '250px', objectFit: 'cover', display: 'block' }}
              />

              {/* Top-left X-Ray Explode Slider */}
              <div
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '10px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  background: 'rgba(4, 14, 24, 0.88)',
                  border: `1px solid ${theme.borderSoft}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontFamily: 'var(--mono)'
                }}
              >
                <span>Explode CAD:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="25"
                  value={explodePct}
                  onChange={(e) => setExplodePct(Number(e.target.value))}
                  style={{ width: '75px', accentColor: theme.primary }}
                />
                <span>{explodePct}%</span>
              </div>

              {/* Callout Box 1: Impeller Erosion */}
              <div
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '16px',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  background: 'rgba(10, 22, 34, 0.92)',
                  border: '1.5px solid #fbbf24'
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700 }}>Impeller Erosion</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '17px', fontWeight: 900, color: '#fbbf24' }}>
                  {metrics.impellerErosionMm} mm
                </div>
              </div>

              {/* Callout Box 2: Suction Strainer Pressure Drop */}
              <div
                style={{
                  position: 'absolute',
                  right: '12px',
                  bottom: '14px',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  background: 'rgba(10, 22, 34, 0.92)',
                  border: `1.5px solid ${theme.primary}`
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700 }}>Suction Strainer Pressure Drop</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '16px', fontWeight: 900, color: theme.primary }}>
                  {metrics.strainerDropM} m
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
                  fontSize: '11px'
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: '4px' }}>Wear Level</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '10px', height: '10px', background: '#ef4444', display: 'inline-block' }} />
                  <span>High</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{ width: '10px', height: '10px', background: '#fbbf24', display: 'inline-block' }} />
                  <span>Med</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{ width: '10px', height: '10px', background: '#10b981', display: 'inline-block' }} />
                  <span>Low</span>
                </div>
              </div>
            </div>

            {/* Right Column: Mechanical & Hydraulic Readouts (matching Image 2 top-right) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'space-between' }}>
              {[
                { label: 'Hydraulic Pressure Drop', val: '-13.9 min', color: '#fbbf24' },
                { label: 'Suction Pressure Delta', val: `-${(metrics.press * 0.78).toFixed(2)} bar`, color: '#f87171' },
                { label: 'Peak Vibration Velocity', val: `${metrics.vib.toFixed(2)} mm/s`, color: theme.primary },
                { label: 'Bearing Housing Temp', val: `${metrics.temp.toFixed(1)} °C`, color: '#34d399' }
              ].map((card) => (
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
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '18px', fontWeight: 900, color: card.color }}>
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
              {/* Performance Trend (90d vs Now) */}
              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  background: theme.panelBg,
                  border: `1.5px solid ${theme.primary}`
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '13px', marginBottom: '6px' }}>
                  Performance Trend (90d vs Now)
                </div>
                <img
                  src={vibWaveUrl}
                  alt="Performance Trend"
                  style={{ width: '100%', height: '92px', display: 'block', borderRadius: '4px' }}
                />
                <div style={{ display: 'flex', gap: '14px', fontSize: '11px', marginTop: '6px', fontFamily: 'var(--mono)' }}>
                  <span style={{ color: theme.primary }}>● Current</span>
                  <span style={{ color: theme.muted }}>⋯ Baseline</span>
                </div>
              </div>

              {/* Downtime Risk + Next Maintenance Window */}
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
                  <div style={{ fontSize: '12px', fontWeight: 700 }}>Downtime Risk</div>
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: '24px',
                      fontWeight: 900,
                      color: '#fbbf24',
                      marginTop: '4px'
                    }}
                  >
                    € {metrics.downtimeCost} /hr <span style={{ color: '#ef4444' }}>↗</span>
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
                  <div style={{ fontSize: '12px', fontWeight: 700 }}>Next Maintenance Window</div>
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: '22px',
                      fontWeight: 900,
                      color: '#fbbf24',
                      marginTop: '4px'
                    }}
                  >
                    📅 {metrics.nextMaintDays} days
                  </div>
                </div>
              </div>

              {/* Fleet Status (Utility Island) */}
              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  background: theme.panelBg,
                  border: `1.5px solid ${theme.primary}`
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '13px', marginBottom: '6px' }}>
                  Fleet Status (Utility Island)
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

            {/* Bottom Action Banner */}
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
                <span style={{ fontSize: '22px' }}>⚠️</span>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '14px', color: '#fbbf24' }}>
                    {asset.tag} – {metrics.isFault ? 'Action Required' : 'Routine Monitoring'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#e2e8f0' }}>
                    Inspect hydraulic path due to fouling
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveView('cutaway')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: `1.5px solid ${theme.primary}`,
                  background: theme.headerBg,
                  color: theme.text,
                  fontFamily: 'var(--mono)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                View Details →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lightweight Interactive Footer: 1-Click 3D Part Move + Fault/Repair/Dispatch */}
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
        {/* 1-Click Separate & Move 3D Part Controls */}
        {cvObjId && onMoveObject ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.primary, fontWeight: 700 }}>
              ✥ MOVE 3D PART:
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
            Profile: Mikhail_Standard_View
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {onExecuteMaintenanceAction && (
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
