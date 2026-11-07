import React, { useState, useMemo } from 'react';
import { humanize, statusOf } from '../ui/status.js';

/**
 * Color themes matching Image 2's 4 quadrants:
 * - Cyber Cyan (Default AR Field Service)
 * - Emerald Mint
 * - Industrial Amber
 * - Violet Spectrum
 */
const AR_THEMES = {
  cyan: {
    id: 'cyan',
    name: 'Cyber Cyan',
    primary: '#00f0ff',
    secondary: '#38bdf8',
    border: 'rgba(0, 240, 255, 0.55)',
    glow: 'rgba(0, 240, 255, 0.28)',
    bg: 'rgba(6, 15, 28, 0.86)',
    panelBg: 'rgba(8, 22, 40, 0.78)',
    badgeBg: 'rgba(0, 240, 255, 0.14)',
    textAccent: '#67e8f9'
  },
  emerald: {
    id: 'emerald',
    name: 'Emerald Mint',
    primary: '#00f5d4',
    secondary: '#10b981',
    border: 'rgba(0, 245, 212, 0.55)',
    glow: 'rgba(16, 185, 129, 0.28)',
    bg: 'rgba(6, 22, 24, 0.86)',
    panelBg: 'rgba(8, 31, 34, 0.78)',
    badgeBg: 'rgba(0, 245, 212, 0.14)',
    textAccent: '#6ee7b7'
  },
  amber: {
    id: 'amber',
    name: 'Industrial Amber',
    primary: '#fbbf24',
    secondary: '#f59e0b',
    border: 'rgba(251, 191, 36, 0.6)',
    glow: 'rgba(245, 158, 11, 0.28)',
    bg: 'rgba(24, 16, 6, 0.88)',
    panelBg: 'rgba(36, 23, 8, 0.80)',
    badgeBg: 'rgba(251, 191, 36, 0.15)',
    textAccent: '#fde68a'
  },
  violet: {
    id: 'violet',
    name: 'Violet Spectrum',
    primary: '#e879f9',
    secondary: '#a855f7',
    border: 'rgba(232, 121, 249, 0.55)',
    glow: 'rgba(168, 85, 247, 0.28)',
    bg: 'rgba(20, 8, 30, 0.88)',
    panelBg: 'rgba(31, 12, 46, 0.80)',
    badgeBg: 'rgba(232, 121, 249, 0.15)',
    textAccent: '#f0abfc'
  }
};

const TECHNICIAN_PROFILES = [
  { id: 'Mikhail_Standard_View', label: 'Mikhail_Standard_View (All-in-One HUD)', defaultTab: 'overview' },
  { id: 'Process_Engineer_Topology', label: 'Process_Engineer_View (Topology & Multi-Panel)', defaultTab: 'topology' },
  { id: 'Mechanical_Wear_XRay', label: 'Mechanical_Repair_View (3D CAD & Wear Heatmap)', defaultTab: 'cad_wear' },
  { id: 'Power_Diagnostics_FFT', label: 'Deep_Diagnostic_View (Multi-Sensor FFT)', defaultTab: 'diagnostics' },
  { id: 'Field_Safety_LOTO', label: 'Safety_Officer_View (LOTO & SOP)', defaultTab: 'loto' },
  { id: 'Quick_Walkthrough_Badge', label: 'Walkthrough_Quick_Badge (Minimalist AR)', defaultTab: 'quick_badge' }
];

export default function HolographicArAssetMenu({
  asset,
  allAssets = [],
  screenAnchor,
  onClose,
  onSelectAsset,
  onFocusCamera,
  onQuickMutateTelemetry,
  exerciseWorkers = [],
  selectedWorkerId,
  onAssignWorkerToFault,
  objectMoveOffset = { dx: 0, dz: 0 },
  onNudgeAssetPosition,
  onResetAssetPosition
}) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'cad_wear' | 'topology' | 'diagnostics' | 'loto' | 'quick_badge'
  const [themeKey, setThemeKey] = useState('cyan');
  const [profileId, setProfileId] = useState('Mikhail_Standard_View');
  const [xrayExplode, setXrayExplode] = useState(35);
  const [selectedWearZone, setSelectedWearZone] = useState('impeller');
  const [checkedLoto, setCheckedLoto] = useState({ 0: true, 2: true });
  const [hoverTimeIdx, setHoverTimeIdx] = useState(8);
  const [savedNotice, setSavedNotice] = useState(false);

  if (!asset) return null;

  const theme = AR_THEMES[themeKey] || AR_THEMES.cyan;
  const st = statusOf(asset);
  const health = Number(asset.health_score ?? 85);
  const isCritical = health < 55 || asset.health_status === 'attention_required';
  const isDegraded = !isCritical && (health < 78 || asset.health_status === 'degraded' || asset.health_status === 'watch');

  const statusColor = isCritical ? '#ef4444' : isDegraded ? '#f59e0b' : '#10b981';
  const vib = Number(asset.telemetry?.vibration_mms ?? (isCritical ? 5.8 : 2.1));
  const press = Number(asset.telemetry?.pressure_bar ?? 5.5);
  const temp = Number(asset.telemetry?.temperature_c ?? (isCritical ? 78.4 : 52.0));
  const flow = Number(asset.telemetry?.flow_m3h ?? 86.4);
  const stiction = Number(asset.telemetry?.stiction_index ?? (isCritical ? 0.72 : 0.18));

  // Derived predictive metrics (matching Image 1 & Image 2)
  const rulHours = Math.max(18, Math.round(health * 3.2 - vib * 4));
  const downtimeCostPerHr = isCritical ? 320 : isDegraded ? 180 : 65;
  const nextMaintDays = Math.max(2, Math.round(health * 0.4));
  const impellerErosionMm = Number((1.8 + (100 - health) * 0.19).toFixed(1));
  const strainerDropM = Number((2.1 + stiction * 10.9).toFixed(2));
  const hydraulicDropBar = Number((-0.35 - (100 - health) * 0.024).toFixed(2));

  // Build 4-node Spatial Process Topology Chain (matching Image 1 Panel 1)
  const topologyChain = useMemo(() => {
    const byLine = allAssets.filter((a) => a.line_id === asset.line_id && a.asset_id !== asset.asset_id);
    const pool = byLine.length >= 3 ? byLine : allAssets.filter((a) => a.asset_id !== asset.asset_id);
    const upstream = pool[0] || asset;
    const downstream = pool[1] || asset;
    const sensor = pool.find((a) => a.asset_class?.includes('transmitter') || a.asset_class?.includes('sensor')) || pool[2] || asset;
    return [
      {
        role: 'Upstream Feed',
        asset: upstream,
        tag: upstream.tag || 'P-002',
        subtitle: humanize(upstream.subtype || upstream.asset_class || 'Suction Strainer'),
        metric: `ΔP: ${(0.12 + (100 - (upstream.health_score || 80)) * 0.004).toFixed(2)} bar`,
        isCurrent: false
      },
      {
        role: 'Active Target',
        asset,
        tag: asset.tag,
        subtitle: humanize(asset.asset_class || 'Process Pump'),
        metric: `Health: ${health}%`,
        isCurrent: true
      },
      {
        role: 'Downstream Control',
        asset: downstream,
        tag: downstream.tag || 'CV-005',
        subtitle: humanize(downstream.asset_class || 'Downstream Valve'),
        metric: `ΔP: ${(0.31 + stiction * 0.25).toFixed(2)} bar`,
        isCurrent: false
      },
      {
        role: 'Line Instrumentation',
        asset: sensor,
        tag: sensor.tag || 'PT-002',
        subtitle: humanize(sensor.asset_class || 'Pressure Transmitter'),
        metric: `P: ${press.toFixed(2)} bar`,
        isCurrent: false
      }
    ];
  }, [asset, allAssets, health, press, stiction]);

  // Same-bay Fleet Status list (matching Image 1 Panel 5)
  const bayFleet = useMemo(() => {
    const sameArea = allAssets.filter((a) => a.area_id === asset.area_id);
    const list = sameArea.length >= 5 ? sameArea.slice(0, 8) : allAssets.slice(0, 8);
    if (!list.some((a) => a.asset_id === asset.asset_id)) {
      list[Math.min(4, list.length - 1)] = asset;
    }
    return list;
  }, [allAssets, asset]);

  // LOTO Steps
  const lotoSteps = useMemo(() => {
    if (Array.isArray(asset.loto_checklist) && asset.loto_checklist.length >= 4) {
      return asset.loto_checklist;
    }
    return [
      `Isolate ${asset.tag} inlet & discharge block valves`,
      `Depressurize ${asset.line_id || 'LINE-1'} hydraulic manifold to 0.0 bar`,
      `Apply physical Lockout-Tagout (LOTO) hasp & verify zero energy`,
      `Bleed instrument air supply & verify ${asset.qr_id || 'QR'} tag`,
      `Perform post-service stroke / vibration baseline test`
    ];
  }, [asset]);

  const assignedWorker = (exerciseWorkers || []).find(
    (w) => w.targetAssetId === asset.asset_id && w.state !== 'STANDBY'
  );
  const standbyWorker =
    (exerciseWorkers || []).find((w) => w.id === selectedWorkerId && w.state === 'STANDBY') ||
    (exerciseWorkers || []).find((w) => w.state === 'STANDBY') ||
    exerciseWorkers[0];

  // Generate 24-point SVG waveform paths
  const makeWavePoints = (baseVal, amp, freq, phaseOffset = 0, width = 260, height = 46) =>
    Array.from({ length: 24 }, (_, i) => {
      const x = (i / 23) * width;
      const n =
        Math.sin(i * freq + phaseOffset) * amp +
        Math.cos(i * (freq * 1.7) + baseVal) * (amp * 0.55);
      const y = Math.min(height - 4, Math.max(4, height * 0.52 - n));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

  // ==================== MINIMALIST QUICK-INSPECTION BADGE (IMAGE 1 PANEL 3) ====================
  if (activeTab === 'quick_badge') {
    const anchorX = screenAnchor ? Math.min(window.innerWidth - 310, Math.max(24, screenAnchor.x)) : 280;
    const anchorY = screenAnchor ? Math.min(window.innerHeight - 240, Math.max(70, screenAnchor.y - 40)) : 180;
    return (
      <div
        style={{
          position: 'absolute',
          left: anchorX,
          top: anchorY,
          zIndex: 55,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          pointerEvents: 'auto',
          userSelect: 'none'
        }}
      >
        {/* Glowing Holographic Target Ring */}
        <div
          onClick={() => setActiveTab('overview')}
          title="Click to expand full Holographic AR HUD"
          style={{
            width: 84,
            height: 84,
            borderRadius: '50%',
            border: `2.5px solid ${theme.primary}`,
            boxShadow: `0 0 24px ${theme.primary}, inset 0 0 18px ${theme.glow}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            position: 'relative',
            background: 'radial-gradient(circle, rgba(0,240,255,0.12) 0%, transparent 70%)'
          }}
        >
          <div
            style={{
              width: 62,
              height: 62,
              borderRadius: '50%',
              border: `1px dashed ${theme.secondary}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              fontWeight: 700,
              color: theme.primary
            }}
          >
            {asset.tag}
          </div>
        </div>

        {/* Minimalist Quick-Inspection Badge Card (Image 1 Panel 3) */}
        <div
          style={{
            background: theme.bg,
            border: `1.5px solid ${theme.border}`,
            boxShadow: `0 0 28px ${theme.glow}, inset 0 0 16px rgba(0, 240, 255, 0.08)`,
            borderRadius: 12,
            padding: '12px 16px',
            minWidth: 215,
            backdropFilter: 'blur(12px)',
            color: '#f8fafc',
            fontFamily: 'var(--sans)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '0.03em' }}>
              {asset.tag}
            </span>
            <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: theme.primary }}>
              ● LIVE | 60 FPS
            </span>
          </div>

          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: '#94a3b8', letterSpacing: '0.08em' }}>
            HEALTH
          </div>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 32,
              fontWeight: 800,
              color: statusColor,
              lineHeight: 1.05,
              textShadow: `0 0 14px ${statusColor}66`,
              marginBottom: 8
            }}
          >
            {health}%
          </div>

          <div style={{ fontSize: 9.5, fontFamily: 'var(--mono)', color: '#94a3b8', letterSpacing: '0.06em' }}>
            REMAINING USEFUL LIFE
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 10 }}>
            <span style={{ color: theme.primary, fontSize: 15 }}>🕒</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>
              {rulHours} hrs
            </span>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              style={{
                flex: 1,
                padding: '5px 8px',
                borderRadius: 6,
                border: `1px solid ${theme.primary}`,
                background: theme.badgeBg,
                color: theme.primary,
                fontFamily: 'var(--mono)',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              ⊞ Expand AR HUD
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid rgba(148,163,184,0.35)',
                background: 'transparent',
                color: '#cbd5e1',
                fontFamily: 'var(--mono)',
                fontSize: 10,
                cursor: 'pointer'
              }}
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== FULL HOLOGRAPHIC AR FIELD SERVICE HUD (IMAGES 1 & 2) ====================
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(940px, calc(100% - 28px))',
        maxHeight: 'calc(100% - 28px)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 55,
        background: theme.bg,
        border: `1.5px solid ${theme.border}`,
        boxShadow: `0 0 42px ${theme.glow}, 0 20px 60px rgba(0, 0, 0, 0.75), inset 0 0 24px ${theme.glow}`,
        borderRadius: 14,
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        color: '#f8fafc',
        fontFamily: 'var(--sans)',
        overflow: 'hidden',
        pointerEvents: 'auto'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Holographic Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '10px 16px',
          borderBottom: `1px solid ${theme.border}`,
          background: 'rgba(2, 8, 18, 0.65)',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              border: `1px solid ${theme.primary}`,
              background: theme.badgeBg,
              color: theme.primary,
              fontFamily: 'var(--mono)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              boxShadow: `0 0 12px ${theme.glow}`
            }}
          >
            💠 AR FIELD SERVICE
          </span>

          <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 800, color: '#fff' }}>
            {asset.tag}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#94a3b8' }}>
            ({asset.asset_id}{asset.cvObject?.object_id ? ` · ${asset.cvObject.object_id}` : ''})
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10.5,
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              color: '#4ade80'
            }}
          >
            ● ONLINE
          </span>
        </div>

        {/* Theme Switcher Pills + Live FPS + Close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(15, 23, 42, 0.8)',
              padding: '3px 6px',
              borderRadius: 999,
              border: '1px solid rgba(148,163,184,0.25)'
            }}
            title="Switch Holographic AR Color Theme"
          >
            {Object.values(AR_THEMES).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setThemeKey(t.id)}
                title={t.name}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: t.primary,
                  border: themeKey === t.id ? '2px solid #fff' : '1px solid transparent',
                  boxShadow: themeKey === t.id ? `0 0 8px ${t.primary}` : 'none',
                  cursor: 'pointer',
                  padding: 0
                }}
              />
            ))}
          </div>

          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10.5,
              color: '#e2e8f0',
              background: 'rgba(15, 23, 42, 0.75)',
              padding: '4px 9px',
              borderRadius: 6,
              border: '1px solid rgba(148,163,184,0.28)'
            }}
          >
            <span style={{ color: '#4ade80' }}>●</span> LIVE | 60 FPS
          </span>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(239, 68, 68, 0.18)',
              border: '1px solid rgba(239, 68, 68, 0.55)',
              color: '#fca5a5',
              borderRadius: 6,
              padding: '4px 9px',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer'
            }}
            title="Close AR Field Service HUD"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Mode Navigation Tabs (Matching Image 1 & Image 2 Tabs) */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '8px 16px',
          borderBottom: `1px solid rgba(148, 163, 184, 0.2)`,
          background: 'rgba(4, 12, 24, 0.55)',
          overflowX: 'auto'
        }}
      >
        {[
          { id: 'overview', label: '⊞ EXECUTIVE OVERVIEW' },
          { id: 'cad_wear', label: '⚙️ 3D CAD & WEAR HEATMAP' },
          { id: 'topology', label: '🌐 SPATIAL TOPOLOGY & MULTI-PANEL' },
          { id: 'diagnostics', label: '📈 MULTI-SENSOR DIAGNOSTICS' },
          { id: 'loto', label: '🔒 LOTO & SAFETY PROCEDURES' },
          { id: 'quick_badge', label: '🎯 COMPACT AR BADGE' }
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 7,
                border: isActive ? `1.5px solid ${theme.primary}` : '1px solid rgba(148, 163, 184, 0.25)',
                background: isActive ? theme.badgeBg : 'rgba(15, 23, 42, 0.55)',
                color: isActive ? theme.primary : '#cbd5e1',
                boxShadow: isActive ? `0 0 14px ${theme.glow}` : 'none',
                fontFamily: 'var(--mono)',
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.03em',
                whiteSpace: 'nowrap',
                cursor: 'pointer'
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ==================== MAIN TAB CONTENT BODY ==================== */}
      <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1 }}>
        {/* -------------------- TAB 1: EXECUTIVE OVERVIEW (IMAGE 2 TOP-LEFT + IMAGE 1 PANEL 5) -------------------- */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(390px, 1fr))', gap: 12 }}>
            {/* Top-Left Card: 3D CAD Internal X-Ray & Wear Heatmap Preview */}
            <div
              style={{
                background: theme.panelBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: 12,
                position: 'relative'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 700, color: theme.textAccent }}>
                  ⚙️ 3D CAD · {humanize(asset.asset_class)} {asset.tag}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('cad_wear')}
                  style={{
                    fontSize: 10,
                    fontFamily: 'var(--mono)',
                    padding: '2px 7px',
                    borderRadius: 5,
                    border: `1px solid ${theme.primary}`,
                    background: 'transparent',
                    color: theme.primary,
                    cursor: 'pointer'
                  }}
                >
                  Open X-Ray Cutaway →
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Wear Level Legend */}
                <div style={{ fontSize: 10, fontFamily: 'var(--mono)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ color: '#94a3b8', marginBottom: 2 }}>Wear Level</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 10, height: 10, background: '#ef4444', borderRadius: 2, display: 'inline-block' }} />
                    <span>High</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 10, height: 10, background: '#eab308', borderRadius: 2, display: 'inline-block' }} />
                    <span>Med</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 10, height: 10, background: '#10b981', borderRadius: 2, display: 'inline-block' }} />
                    <span>Low</span>
                  </div>
                  <div style={{ marginTop: 6, color: '#fbbf24', fontWeight: 700 }}>
                    Impeller Erosion
                    <div style={{ fontSize: 13 }}>{impellerErosionMm} mm</div>
                  </div>
                </div>

                {/* Holographic 3D Wireframe Cutaway & Thermal Wear Heatmap SVG */}
                <svg viewBox="0 0 280 128" style={{ flex: 1, height: 128, overflow: 'visible' }}>
                  <defs>
                    <radialGradient id="wearHeatGrad" cx="52%" cy="50%" r="44%">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity="0.88" />
                      <stop offset="45%" stopColor="#f59e0b" stopOpacity="0.65" />
                      <stop offset="78%" stopColor="#10b981" stopOpacity="0.35" />
                      <stop offset="100%" stopColor={theme.primary} stopOpacity="0.05" />
                    </radialGradient>
                  </defs>
                  {/* Isometric grid base */}
                  <line x1="20" y1="112" x2="260" y2="112" stroke={theme.primary} strokeOpacity="0.25" strokeDasharray="3 3" />
                  {/* Outer Wireframe Casing */}
                  <rect x="34" y="36" width="52" height="52" rx="6" fill="rgba(0,240,255,0.08)" stroke={theme.primary} strokeWidth="1.4" />
                  <ellipse cx="34" cy="62" rx="10" ry="26" fill="rgba(0,240,255,0.12)" stroke={theme.primary} strokeWidth="1.4" />
                  {/* Central Volute / Impeller Chamber with Thermal Wear Glow */}
                  <circle cx="136" cy="62" r="42" fill="url(#wearHeatGrad)" stroke={theme.primary} strokeWidth="1.6" />
                  <circle cx="136" cy="62" r="26" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="4 2" />
                  {/* Impeller Vanes */}
                  {[0, 60, 120, 180, 240, 300].map((deg) => {
                    const rad = (deg * Math.PI) / 180;
                    const x2 = 136 + Math.cos(rad) * 32;
                    const y2 = 62 + Math.sin(rad) * 32;
                    return (
                      <line key={deg} x1="136" y1="62" x2={x2} y2={y2} stroke="#fde047" strokeWidth="2" />
                    );
                  })}
                  {/* Top Discharge Flange */}
                  <rect x="118" y="8" width="36" height="16" rx="3" fill="rgba(0,240,255,0.14)" stroke={theme.primary} strokeWidth="1.4" />
                  {/* Right Drive Shaft & Bearing Housing */}
                  <rect x="178" y="46" width="68" height="32" rx="4" fill="rgba(0,240,255,0.08)" stroke={theme.primary} strokeWidth="1.4" />
                  <line x1="86" y1="62" x2="246" y2="62" stroke="#fff" strokeWidth="2" strokeDasharray="5 3" />
                  {/* Callout Leader Line */}
                  <line x1="136" y1="62" x2="195" y2="18" stroke="#fbbf24" strokeWidth="1.5" />
                  <circle cx="136" cy="62" r="4" fill="#ef4444" />
                  <text x="198" y="20" fill="#fde047" fontSize="10" fontFamily="monospace" fontWeight="bold">
                    Wear Core ({impellerErosionMm}mm)
                  </text>
                </svg>
              </div>
            </div>

            {/* Top-Right Card: Real-Time Telemetry (Last 30 min) with Interactive Hover & Sliders */}
            <div
              style={{
                background: theme.panelBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: 12
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 700, color: theme.textAccent }}>
                  📈 Real-Time Telemetry (Last 30 min)
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#cbd5e1' }}>
                  <span style={{ color: theme.primary }}>●</span> Pressure ({press.toFixed(1)} bar) &nbsp;
                  <span style={{ color: '#fbbf24' }}>---</span> Vibration ({vib.toFixed(1)} mm/s)
                </span>
              </div>

              <svg
                viewBox="0 0 340 86"
                style={{ width: '100%', height: 86, background: 'rgba(2, 8, 18, 0.5)', borderRadius: 6 }}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const idx = Math.min(23, Math.max(0, Math.round(((e.clientX - rect.left) / rect.width) * 23)));
                  setHoverTimeIdx(idx);
                }}
              >
                {[20, 43, 66].map((y) => (
                  <line key={y} x1="0" y1={y} x2="340" y2={y} stroke="rgba(148,163,184,0.14)" strokeWidth="1" />
                ))}
                <polyline
                  fill="none"
                  stroke={theme.primary}
                  strokeWidth="2.2"
                  points={makeWavePoints(press, 14, 0.55, 0, 340, 82)}
                />
                <polyline
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="1.8"
                  strokeDasharray="4 2"
                  points={makeWavePoints(vib, 18, 0.85, 1.5, 340, 82)}
                />
                {/* Interactive cursor marker */}
                <line
                  x1={(hoverTimeIdx / 23) * 340}
                  y1="4"
                  x2={(hoverTimeIdx / 23) * 340}
                  y2="82"
                  stroke="#fff"
                  strokeDasharray="2 2"
                  strokeWidth="1.2"
                />
                <rect
                  x={Math.min(235, Math.max(6, (hoverTimeIdx / 23) * 340 - 48))}
                  y="6"
                  width="98"
                  height="28"
                  rx="4"
                  fill="rgba(6, 15, 28, 0.92)"
                  stroke={theme.border}
                />
                <text
                  x={Math.min(235, Math.max(6, (hoverTimeIdx / 23) * 340 - 48)) + 6}
                  y="18"
                  fill="#94a3b8"
                  fontSize="8.5"
                  fontFamily="monospace"
                >
                  {(30 - hoverTimeIdx * 1.25).toFixed(1)} min ago
                </text>
                <text
                  x={Math.min(235, Math.max(6, (hoverTimeIdx / 23) * 340 - 48)) + 6}
                  y="29"
                  fill={theme.primary}
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  P:{press.toFixed(1)}b V:{vib.toFixed(1)}
                </text>
              </svg>

              {/* Interactive Live Sliders to test telemetry response */}
              {onQuickMutateTelemetry && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--mono)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                      <span>Pressure (bar)</span>
                      <strong style={{ color: theme.primary }}>{press.toFixed(1)} bar</strong>
                    </div>
                    <input
                      type="range"
                      min="2.0"
                      max="9.5"
                      step="0.1"
                      value={press}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        onQuickMutateTelemetry(
                          asset.asset_id,
                          { pressure_bar: v },
                          v < 3.8 || v > 8.2 ? 'PRESSURE_DEVIATION' : null
                        );
                      }}
                      style={{ width: '100%', accentColor: theme.primary, cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--mono)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                      <span>Vibration (mm/s)</span>
                      <strong style={{ color: statusColor }}>{vib.toFixed(1)} mm/s</strong>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="9.5"
                      step="0.1"
                      value={vib}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        onQuickMutateTelemetry(
                          asset.asset_id,
                          { vibration_mms: v },
                          v >= 6.0 ? 'HIGH_VIBRATION_ALARM' : v < 3.5 ? 'NORMAL_OPERATION' : null
                        );
                      }}
                      style={{ width: '100%', accentColor: statusColor, cursor: 'pointer' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Bottom-Left Card: Asset Status Circular Gauge + RUL + Downtime Risk (Image 2 Top-Left & Image 1 Panel 5) */}
            <div
              style={{
                background: theme.panelBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: 12,
                display: 'grid',
                gridTemplateColumns: '110px 1fr',
                gap: 14,
                alignItems: 'center'
              }}
            >
              {/* Circular Health Gauge SVG */}
              <div style={{ position: 'relative', width: 104, height: 104, margin: '0 auto' }}>
                <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                  <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="9" />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke={statusColor}
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={`${(health / 100) * 251.2} 251.2`}
                  />
                </svg>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--mono)'
                  }}
                >
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{health}%</span>
                  <span style={{ fontSize: 8.5, color: '#94a3b8', textAlign: 'center' }}>HEALTH SCORE</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 800, color: theme.primary }}>
                      {rulHours} h
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: '#94a3b8' }}>
                      🕒 REMAINING USEFUL LIFE (RUL)
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 800, color: '#fbbf24' }}>
                      € {downtimeCostPerHr} /hr ↗
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: '#94a3b8' }}>
                      DOWNTIME RISK
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    borderRadius: 7,
                    background: 'rgba(15, 23, 42, 0.75)',
                    border: '1px solid rgba(148,163,184,0.22)',
                    fontFamily: 'var(--mono)',
                    fontSize: 10.5
                  }}
                >
                  <span style={{ color: '#cbd5e1' }}>📅 Next Maintenance Window:</span>
                  <strong style={{ color: '#fff' }}>{nextMaintDays} days</strong>
                </div>

                <div
                  style={{
                    padding: '6px 10px',
                    borderRadius: 7,
                    background: isCritical ? 'rgba(239, 68, 68, 0.16)' : 'rgba(245, 158, 11, 0.14)',
                    border: `1px solid ${statusColor}`,
                    fontFamily: 'var(--mono)',
                    fontSize: 10.5,
                    color: '#f8fafc'
                  }}
                >
                  <strong style={{ color: statusColor }}>⚠️ {asset.tag} – {humanize(asset.status_reason || 'ATTENTION')}:</strong>{' '}
                  {asset.work_order?.summary || 'Inspect hydraulic path and verify actuator/bearing tolerances.'}
                </div>
              </div>
            </div>

            {/* Bottom-Right Card: Process Topology Flow + Bay Fleet Status Bars */}
            <div
              style={{
                background: theme.panelBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 10
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 700, color: theme.textAccent }}>
                    🌐 Process Topology & Causality Flow
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: '#94a3b8' }}>
                    Click node to jump
                  </span>
                </div>

                {/* 4-Node Interactive Topology Chain */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {topologyChain.map((node, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (node.asset && onSelectAsset) onSelectAsset(node.asset);
                      }}
                      style={{
                        padding: '6px 6px',
                        borderRadius: 7,
                        border: node.isCurrent
                          ? `1.5px solid #fbbf24`
                          : `1px solid ${theme.border}`,
                        background: node.isCurrent
                          ? 'rgba(245, 158, 11, 0.18)'
                          : 'rgba(6, 15, 28, 0.75)',
                        color: '#f8fafc',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontFamily: 'var(--mono)'
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 800, color: node.isCurrent ? '#fbbf24' : theme.primary }}>
                        {node.tag}
                      </div>
                      <div className="truncate" style={{ fontSize: 8.5, color: '#94a3b8', marginTop: 1 }}>
                        {node.subtitle}
                      </div>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: '#e2e8f0', marginTop: 3 }}>
                        {node.metric}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Mini Fleet Status Bars (Image 1 Panel 5) */}
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>
                  FLEET STATUS ({asset.area_name || 'Utility Island'})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
                  {bayFleet.slice(0, 6).map((fa) => {
                    const fh = Number(fa.health_score ?? 90);
                    const fc = fh < 55 ? '#ef4444' : fh < 78 ? '#f59e0b' : '#10b981';
                    return (
                      <div
                        key={fa.asset_id}
                        onClick={() => onSelectAsset && onSelectAsset(fa)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontFamily: 'var(--mono)',
                          fontSize: 10,
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ width: 42, fontWeight: fa.asset_id === asset.asset_id ? 800 : 600, color: fa.asset_id === asset.asset_id ? '#fbbf24' : '#e2e8f0' }}>
                          {fa.tag}
                        </span>
                        <div style={{ flex: 1, height: 6, background: 'rgba(148,163,184,0.2)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${fh}%`, height: '100%', background: fc }} />
                        </div>
                        <span style={{ width: 28, textAlign: 'right', color: fc, fontWeight: 700 }}>{fh}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* -------------------- TAB 2: 3D CAD INTERNAL CUTAWAY & WEAR HEATMAP (IMAGE 1 PANEL 4 & IMAGE 2 TOP-RIGHT) -------------------- */}
        {activeTab === 'cad_wear' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.65fr 1fr', gap: 14, alignItems: 'stretch' }}>
            <div
              style={{
                background: theme.panelBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 800, color: '#fff' }}>
                    ⚙️ Industrial {humanize(asset.asset_class)} {asset.tag} — 3D Internal Cutaway & Wear Heatmap
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#94a3b8' }}>
                    Click any datum callout or drag the X-Ray Explode slider to inspect internal tolerances
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono)', fontSize: 10 }}>
                  <span>X-Ray Explode: {xrayExplode}%</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={xrayExplode}
                    onChange={(e) => setXrayExplode(Number(e.target.value))}
                    style={{ width: 95, accentColor: theme.primary, cursor: 'pointer' }}
                  />
                </div>
              </div>

              {/* Large Interactive 3D CAD Cutaway SVG with Datum Callouts */}
              <svg viewBox="0 0 520 230" style={{ width: '100%', height: 225, margin: '6px 0' }}>
                <defs>
                  <radialGradient id="coreHeatBig" cx="50%" cy="50%" r="48%">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity="0.92" />
                    <stop offset="42%" stopColor="#f59e0b" stopOpacity="0.75" />
                    <stop offset="78%" stopColor="#10b981" stopOpacity="0.38" />
                    <stop offset="100%" stopColor={theme.primary} stopOpacity="0.05" />
                  </radialGradient>
                </defs>

                {/* Exploded Suction Strainer Basket (Bottom-Left) */}
                <g
                  transform={`translate(${-xrayExplode * 0.22}, ${xrayExplode * 0.18})`}
                  onClick={() => setSelectedWearZone('strainer')}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x="130"
                    y="148"
                    width="56"
                    height="64"
                    rx="8"
                    fill="rgba(16, 185, 129, 0.18)"
                    stroke={selectedWearZone === 'strainer' ? '#fff' : '#10b981'}
                    strokeWidth={selectedWearZone === 'strainer' ? 2.5 : 1.5}
                  />
                  <line x1="142" y1="154" x2="142" y2="206" stroke="#10b981" strokeDasharray="3 3" />
                  <line x1="158" y1="154" x2="158" y2="206" stroke="#10b981" strokeDasharray="3 3" />
                  <line x1="174" y1="154" x2="174" y2="206" stroke="#10b981" strokeDasharray="3 3" />
                  <line x1="186" y1="185" x2="265" y2="195" stroke={theme.primary} strokeWidth="1.5" />
                  <text x="270" y="192" fill={theme.primary} fontSize="11" fontFamily="monospace" fontWeight="bold">
                    Suction Strainer Pressure Drop: {strainerDropM} m
                  </text>
                </g>

                {/* Inlet Nozzle Assembly (Left, Explodes Left) */}
                <g
                  transform={`translate(${-xrayExplode * 0.35}, 0)`}
                  onClick={() => setSelectedWearZone('inlet')}
                  style={{ cursor: 'pointer' }}
                >
                  <rect x="68" y="76" width="84" height="58" rx="6" fill="rgba(0, 240, 255, 0.10)" stroke={theme.primary} strokeWidth="1.6" />
                  <ellipse cx="68" cy="105" rx="14" ry="32" fill="rgba(0, 240, 255, 0.18)" stroke={theme.primary} strokeWidth="1.8" />
                  <line x1="82" y1="76" x2="42" y2="38" stroke={theme.primary} strokeWidth="1.3" />
                  <text x="12" y="32" fill="#e2e8f0" fontSize="10" fontFamily="monospace">
                    3D DATUM: Inlet Flange (±0.12mm)
                  </text>
                </g>

                {/* Central Impeller / Trim Wear Core */}
                <g onClick={() => setSelectedWearZone('impeller')} style={{ cursor: 'pointer' }}>
                  <circle
                    cx="235"
                    cy="105"
                    r="58"
                    fill="url(#coreHeatBig)"
                    stroke={selectedWearZone === 'impeller' ? '#fff' : '#fbbf24'}
                    strokeWidth={selectedWearZone === 'impeller' ? 2.6 : 1.8}
                  />
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
                    const rad = (deg * Math.PI) / 180;
                    return (
                      <line
                        key={deg}
                        x1="235"
                        y1="105"
                        x2={235 + Math.cos(rad) * 46}
                        y2={105 + Math.sin(rad) * 46}
                        stroke="#fde047"
                        strokeWidth="2.2"
                      />
                    );
                  })}
                  <circle cx="235" cy="105" r="16" fill="#ef4444" stroke="#fff" strokeWidth="1.5" />
                  <line x1="235" y1="89" x2="295" y2="28" stroke="#fbbf24" strokeWidth="1.8" />
                  <text x="300" y="26" fill="#fde047" fontSize="12" fontFamily="monospace" fontWeight="bold">
                    Impeller Erosion: {impellerErosionMm} mm
                  </text>
                  <text x="300" y="40" fill="#cbd5e1" fontSize="9.5" fontFamily="monospace">
                    Cavitation / Fouling Hot-Spot
                  </text>
                </g>

                {/* Right Bearing & Drive Shaft Assembly (Explodes Right) */}
                <g
                  transform={`translate(${xrayExplode * 0.35}, 0)`}
                  onClick={() => setSelectedWearZone('bearing')}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x="293"
                    y="80"
                    width="115"
                    height="50"
                    rx="6"
                    fill="rgba(245, 158, 11, 0.14)"
                    stroke={selectedWearZone === 'bearing' ? '#fff' : theme.primary}
                    strokeWidth="1.6"
                  />
                  <ellipse cx="408" cy="105" rx="12" ry="28" fill="rgba(0, 240, 255, 0.18)" stroke={theme.primary} strokeWidth="1.6" />
                  <line x1="140" y1="105" x2="420" y2="105" stroke="#fff" strokeWidth="2.2" strokeDasharray="6 3" />
                  <line x1="355" y1="80" x2="390" y2="54" stroke={theme.primary} strokeWidth="1.3" />
                  <text x="345" y="50" fill="#e2e8f0" fontSize="10" fontFamily="monospace">
                    Bearing Thermal: {temp.toFixed(1)} °C
                  </text>
                </g>
              </svg>

              {/* Interactive Component Selector Pills */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { id: 'impeller', label: `🔥 Impeller / Trim Core (${impellerErosionMm} mm)` },
                  { id: 'strainer', label: `💧 Suction Strainer (${strainerDropM} m)` },
                  { id: 'bearing', label: `⚙️ Drive Bearing (${temp.toFixed(1)} °C)` },
                  { id: 'inlet', label: `🔩 Inlet Manifold (${press.toFixed(2)} bar)` }
                ].map((zone) => (
                  <button
                    key={zone.id}
                    type="button"
                    onClick={() => setSelectedWearZone(zone.id)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: selectedWearZone === zone.id ? `1.5px solid #fbbf24` : `1px solid ${theme.border}`,
                      background: selectedWearZone === zone.id ? 'rgba(245, 158, 11, 0.2)' : 'rgba(15, 23, 42, 0.65)',
                      color: selectedWearZone === zone.id ? '#fde047' : '#cbd5e1',
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {zone.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Column: Mechanical Tolerance & Hydraulic Readout Stack (Image 2 Top-Right) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Hydraulic Pressure Drop Time', val: `-${(10 + stiction * 6).toFixed(1)} min`, color: '#fde047' },
                { label: 'Hydraulic Pressure Drop', val: `${hydraulicDropBar} bar`, color: '#fb923c' },
                { label: 'Impeller / Trim Erosion Rate', val: `-${(vib * 0.82).toFixed(2)} mm/s`, color: '#f87171' },
                { label: 'RMS Vibration Level', val: `* ${vib.toFixed(2)} mm/s`, color: statusColor }
              ].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: theme.panelBg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 9,
                    padding: '10px 14px'
                  }}
                >
                  <div style={{ fontSize: 10.5, color: '#cbd5e1', fontFamily: 'var(--mono)' }}>{item.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: item.color, fontFamily: 'var(--mono)', marginTop: 2 }}>
                    {item.val}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* -------------------- TAB 3: SPATIAL TOPOLOGY & FLOATING MULTI-PANEL (IMAGE 1 PANELS 1 & 2) -------------------- */}
        {activeTab === 'topology' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Top Spatial Process Topology Chain (Image 1 Panel 1) */}
            <div
              style={{
                background: theme.panelBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                padding: 12
              }}
            >
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: theme.primary, marginBottom: 8 }}>
                1. SPATIAL PROCESS TOPOLOGY & CAUSALITY FLOW (CLICK ANY ASSET IN CHAIN)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, alignItems: 'center' }}>
                {topologyChain.map((node, idx) => (
                  <div
                    key={idx}
                    onClick={() => node.asset && onSelectAsset && onSelectAsset(node.asset)}
                    style={{
                      background: node.isCurrent ? 'rgba(245, 158, 11, 0.16)' : 'rgba(6, 15, 28, 0.82)',
                      border: node.isCurrent ? '2px solid #fbbf24' : `1.5px solid ${theme.primary}`,
                      boxShadow: `0 0 16px ${node.isCurrent ? 'rgba(245,158,11,0.3)' : theme.glow}`,
                      borderRadius: 9,
                      padding: '8px 10px',
                      cursor: 'pointer',
                      textAlign: 'center',
                      fontFamily: 'var(--mono)'
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{node.tag}</div>
                    <div className="truncate" style={{ fontSize: 9.5, color: '#94a3b8' }}>{node.subtitle}</div>
                    <svg viewBox="0 0 120 26" style={{ width: '100%', height: 24, margin: '4px 0' }}>
                      <polyline
                        fill="none"
                        stroke={node.isCurrent ? '#fbbf24' : theme.primary}
                        strokeWidth="1.8"
                        points={makeWavePoints(idx + vib, 7, 0.8, idx, 120, 24)}
                      />
                    </svg>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: node.isCurrent ? '#fde047' : theme.textAccent }}>
                      {node.metric}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom 3-Column Modular HUD (Image 1 Panel 2) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr 1.15fr', gap: 12 }}>
              {/* Left: LIVE SENSOR DATA (30 min) */}
              <div style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: theme.primary, marginBottom: 8 }}>
                  📈 LIVE SENSOR DATA (30 min)
                </div>
                {[
                  { name: 'Vibration, mm/s', val: vib.toFixed(1), color: '#38bdf8', seed: 1 },
                  { name: 'Suction / Stiction Index', val: stiction.toFixed(2), color: '#4ade80', seed: 2 },
                  { name: 'Flow Rate, m³/h', val: flow.toFixed(1), color: '#00f5d4', seed: 3 }
                ].map((s, i) => (
                  <div key={i} style={{ marginBottom: i < 2 ? 8 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 10.5 }}>
                      <span style={{ color: '#cbd5e1' }}>{s.name}</span>
                      <strong style={{ color: '#fff', fontSize: 13 }}>{s.val}</strong>
                    </div>
                    <svg viewBox="0 0 220 32" style={{ width: '100%', height: 30 }}>
                      <polyline
                        fill="none"
                        stroke={s.color}
                        strokeWidth="1.8"
                        points={makeWavePoints(parseFloat(s.val), 9, 0.75, s.seed * 2, 220, 30)}
                      />
                    </svg>
                  </div>
                ))}
              </div>

              {/* Center: TAG & ATTENTION REQUIRED CALLOUT */}
              <div
                style={{
                  background: theme.panelBg,
                  border: `2px solid ${statusColor}`,
                  boxShadow: `0 0 24px ${statusColor}44`,
                  borderRadius: 10,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  fontFamily: 'var(--mono)'
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>TAG: {asset.tag}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fde047', marginTop: 2 }}>
                    Health: {health}/100
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      padding: '4px 8px',
                      borderRadius: 5,
                      background: 'rgba(239, 68, 68, 0.22)',
                      border: `1px solid ${statusColor}`,
                      color: '#fca5a5',
                      fontSize: 11,
                      fontWeight: 800
                    }}
                  >
                    ⚠️ {isCritical ? 'HIGH URGENCY' : isDegraded ? 'ATTENTION REQUIRED' : 'NOMINAL'}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(148,163,184,0.25)', paddingTop: 8, fontSize: 10.5 }}>
                  <div style={{ color: '#fde047', fontWeight: 700 }}>
                    ISSUE: {humanize(asset.status_reason || 'FOULING').toUpperCase()}
                  </div>
                  <div style={{ color: '#cbd5e1', marginTop: 4 }}>
                    RECOMMENDED ACTION:
                    <div style={{ color: '#fff', fontWeight: 600, marginTop: 2 }}>
                      {asset.work_order?.summary || 'Inspect hydraulic path & verify positioner calibration'}
                    </div>
                  </div>
                </div>

                {/* 1-Click Separate / Move 3D Object Controls */}
                {onNudgeAssetPosition && (
                  <div style={{ borderTop: '1px solid rgba(148,163,184,0.25)', paddingTop: 8 }}>
                    <div style={{ fontSize: 9.5, color: theme.primary, marginBottom: 4 }}>
                      ✥ SEPARATE / MOVE 3D PART ({objectMoveOffset.dx.toFixed(2)}m, {objectMoveOffset.dz.toFixed(2)}m)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
                      <button type="button" onClick={() => onNudgeAssetPosition(-0.35, 0)} style={{ padding: '4px', borderRadius: 4, border: `1px solid ${theme.border}`, background: 'rgba(15,23,42,0.8)', color: '#fff', cursor: 'pointer', fontSize: 10 }}>◀</button>
                      <button type="button" onClick={() => onNudgeAssetPosition(0, 0.35)} style={{ padding: '4px', borderRadius: 4, border: `1px solid ${theme.border}`, background: 'rgba(15,23,42,0.8)', color: '#fff', cursor: 'pointer', fontSize: 10 }}>▲</button>
                      <button type="button" onClick={() => onNudgeAssetPosition(0, -0.35)} style={{ padding: '4px', borderRadius: 4, border: `1px solid ${theme.border}`, background: 'rgba(15,23,42,0.8)', color: '#fff', cursor: 'pointer', fontSize: 10 }}>▼</button>
                      <button type="button" onClick={() => onNudgeAssetPosition(0.35, 0)} style={{ padding: '4px', borderRadius: 4, border: `1px solid ${theme.border}`, background: 'rgba(15,23,42,0.8)', color: '#fff', cursor: 'pointer', fontSize: 10 }}>▶</button>
                      <button type="button" onClick={onResetAssetPosition} style={{ padding: '4px', borderRadius: 4, border: '1px solid #f43f5e', background: 'rgba(244,63,94,0.2)', color: '#fda4af', cursor: 'pointer', fontSize: 9.5 }}>↺</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: LOCKOUT-TAGOUT Quick Panel */}
              <div style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: theme.primary, marginBottom: 8 }}>
                  🔒 LOCKOUT-TAGOUT
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {lotoSteps.slice(0, 4).map((step, idx) => {
                    const done = Boolean(checkedLoto[idx]);
                    return (
                      <div
                        key={idx}
                        onClick={() => setCheckedLoto((p) => ({ ...p, [idx]: !p[idx] }))}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '5px 8px',
                          borderRadius: 6,
                          background: done ? 'rgba(16, 185, 129, 0.16)' : 'rgba(15, 23, 42, 0.65)',
                          border: done ? '1px solid #10b981' : '1px solid rgba(148,163,184,0.25)',
                          cursor: 'pointer',
                          fontSize: 10.5,
                          fontFamily: 'var(--mono)'
                        }}
                      >
                        <span style={{ color: done ? '#4ade80' : '#64748b', fontWeight: 800 }}>
                          {done ? '☑' : '☐'}
                        </span>
                        <span style={{ color: done ? '#ecfdf5' : '#cbd5e1' }}>{step}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 8, fontSize: 10, fontFamily: 'var(--mono)', color: '#94a3b8' }}>
                  📄 SOP Reference: <strong style={{ color: theme.primary }}>{asset.doc_refs?.[0] || 'DOC-PROCESS_PUMP-CORE'}</strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* -------------------- TAB 4: MULTI-SENSOR DIAGNOSTICS (IMAGE 2 BOTTOM-LEFT) -------------------- */}
        {activeTab === 'diagnostics' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
            {/* 1. FFT Vibration Spectrum */}
            <div style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: theme.textAccent, marginBottom: 6 }}>
                <span>📊 FFT Vibration Spectrum (1x / 2x / Blade Pass)</span>
                <span>Peak: {(vib * 48).toFixed(0)} Hz</span>
              </div>
              <svg viewBox="0 0 320 82" style={{ width: '100%', height: 82 }}>
                <polyline
                  fill="none"
                  stroke={theme.primary}
                  strokeWidth="2"
                  points={Array.from({ length: 36 }, (_, i) => {
                    const x = (i / 35) * 320;
                    const spike = i === 6 || i === 14 || i === 23 ? (vib / 9.5) * 62 : Math.sin(i * 1.7) * 8 + 10;
                    const y = 78 - Math.min(72, Math.max(4, spike));
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(' ')}
                />
              </svg>
            </div>

            {/* 2. Suction / Stiction Index vs Baseline */}
            <div style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: theme.textAccent, marginBottom: 6 }}>
                <span>📈 Suction / Stiction Index vs Baseline</span>
                <span>Index: {stiction.toFixed(2)}</span>
              </div>
              <svg viewBox="0 0 320 82" style={{ width: '100%', height: 82 }}>
                <line x1="0" y1="42" x2="320" y2="42" stroke="#94a3b8" strokeDasharray="4 3" strokeWidth="1.2" />
                <polyline
                  fill="none"
                  stroke={theme.primary}
                  strokeWidth="2.2"
                  points={makeWavePoints(stiction * 10, 18, 0.65, 1, 320, 80)}
                />
              </svg>
            </div>

            {/* 3. Motor / Bearing Temperature Curve (°C) */}
            <div style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: theme.textAccent, marginBottom: 6 }}>
                <span>🌡️ Motor / Bearing Temperature Curve (°C)</span>
                <span>{temp.toFixed(1)} °C</span>
              </div>
              <svg viewBox="0 0 320 82" style={{ width: '100%', height: 82 }}>
                <path
                  d={`M 0 74 Q 95 28, 320 ${Math.max(10, 74 - (temp / 110) * 60)}`}
                  fill="none"
                  stroke={theme.primary}
                  strokeWidth="2.5"
                />
              </svg>
            </div>

            {/* 4. Impeller Flow Rate Histogram */}
            <div style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: theme.textAccent, marginBottom: 6 }}>
                <span>💧 Impeller Flow Rate Distribution</span>
                <span>{flow.toFixed(1)} m³/h</span>
              </div>
              <svg viewBox="0 0 320 82" style={{ width: '100%', height: 82 }}>
                {Array.from({ length: 24 }, (_, i) => {
                  const bh = Math.min(70, Math.max(14, 36 + Math.sin(i * 0.6 + flow) * 26));
                  return (
                    <rect
                      key={i}
                      x={i * 13 + 4}
                      y={78 - bh}
                      width="8"
                      height={bh}
                      rx="2"
                      fill={theme.primary}
                      fillOpacity="0.82"
                    />
                  );
                })}
              </svg>
            </div>
          </div>
        )}

        {/* -------------------- TAB 5: LOTO & SAFETY PROCEDURES (IMAGE 2 BOTTOM-RIGHT) -------------------- */}
        {activeTab === 'loto' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 14 }}>
            <div style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: theme.primary }}>
                  🔒 Interactive Lockout-Tagout (LOTO) Checklist
                </span>
                <button
                  type="button"
                  onClick={() => setCheckedLoto({ 0: true, 1: true, 2: true, 3: true, 4: true })}
                  style={{
                    fontSize: 10,
                    fontFamily: 'var(--mono)',
                    padding: '3px 8px',
                    borderRadius: 5,
                    border: '1px solid #10b981',
                    background: 'rgba(16, 185, 129, 0.2)',
                    color: '#4ade80',
                    cursor: 'pointer'
                  }}
                >
                  ✓ Verify All Steps
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {lotoSteps.map((step, idx) => {
                  const done = Boolean(checkedLoto[idx]);
                  return (
                    <div
                      key={idx}
                      onClick={() => setCheckedLoto((p) => ({ ...p, [idx]: !p[idx] }))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: 7,
                        background: done ? 'rgba(16, 185, 129, 0.16)' : 'rgba(6, 15, 28, 0.75)',
                        border: done ? '1px solid #10b981' : `1px solid ${theme.border}`,
                        cursor: 'pointer',
                        fontFamily: 'var(--mono)',
                        fontSize: 11
                      }}
                    >
                      <span>
                        {idx + 1}. {step}
                      </span>
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          border: done ? '1px solid #10b981' : '1px solid #64748b',
                          background: done ? '#10b981' : 'transparent',
                          color: '#052e16',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800
                        }}
                      >
                        {done ? '✓' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12, fontFamily: 'var(--mono)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: theme.primary, marginBottom: 6 }}>
                📄 SOP: {asset.doc_refs?.[0] || 'DOC-PROCESS_PUMP-CORE'}
              </div>
              <div style={{ fontSize: 10.5, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 10 }}>
                Standard zero-energy isolation, manifold bleed-off, and mechanical inspection procedure for{' '}
                <strong style={{ color: '#fff' }}>{asset.tag}</strong> ({asset.service_description}) in{' '}
                <strong style={{ color: theme.textAccent }}>{asset.area_name}</strong>.
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: 'rgba(2, 8, 18, 0.75)',
                  border: `1px solid ${theme.border}`,
                  marginBottom: 10
                }}
              >
                <div style={{ fontSize: 10, color: '#94a3b8' }}>QR ANCHOR VERIFICATION</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 2 }}>
                  {asset.qr_id} · {asset.anchor_id}
                </div>
                <div style={{ fontSize: 10, color: '#4ade80', marginTop: 4 }}>
                  ✓ ESDF Collision-Free Standoff Verified
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== BOTTOM FOOTER BAR (PROFILE SELECTOR + ACTION BUTTONS) ==================== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '9px 16px',
          borderTop: `1px solid ${theme.border}`,
          background: 'rgba(2, 8, 18, 0.75)',
          flexWrap: 'wrap',
          fontFamily: 'var(--mono)',
          fontSize: 10.5
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#94a3b8' }}>Technician Profile:</span>
          <select
            value={profileId}
            onChange={(e) => {
              const nextId = e.target.value;
              setProfileId(nextId);
              const spec = TECHNICIAN_PROFILES.find((p) => p.id === nextId);
              if (spec) setActiveTab(spec.defaultTab);
            }}
            style={{
              background: 'rgba(15, 23, 42, 0.9)',
              color: theme.primary,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              padding: '4px 8px',
              fontFamily: 'var(--mono)',
              fontSize: 10.5
            }}
          >
            {TECHNICIAN_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {standbyWorker && onAssignWorkerToFault && (
            <button
              type="button"
              onClick={() => onAssignWorkerToFault(standbyWorker.id, asset)}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: `1px solid ${theme.primary}`,
                background: theme.badgeBg,
                color: theme.primary,
                fontFamily: 'var(--mono)',
                fontSize: 10.5,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {assignedWorker
                ? `🔧 ${assignedWorker.id} Dispatched (${assignedWorker.state})`
                : `🔧 Dispatch ${standbyWorker.id} to ${asset.tag}`}
            </button>
          )}

          {onQuickMutateTelemetry && (
            <>
              <button
                type="button"
                onClick={() =>
                  onQuickMutateTelemetry(
                    asset.asset_id,
                    {
                      vibration_mms: 1.6,
                      bearing_temp_c: 54.0,
                      stiction_index: 0.12,
                      position_pct: asset.telemetry?.setpoint_pct || 64.0
                    },
                    'NORMAL_OPERATION'
                  )
                }
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid #10b981',
                  background: 'rgba(16, 185, 129, 0.18)',
                  color: '#4ade80',
                  fontFamily: 'var(--mono)',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                ✓ Restore Nominal
              </button>
              <button
                type="button"
                onClick={() =>
                  onQuickMutateTelemetry(
                    asset.asset_id,
                    {
                      vibration_mms: 7.8,
                      bearing_temp_c: 86.0,
                      stiction_index: 0.68
                    },
                    'CRITICAL_FAULT_INJECTED'
                  )
                }
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid #ef4444',
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#fca5a5',
                  fontFamily: 'var(--mono)',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                ⚡ Inject Fault
              </button>
            </>
          )}

          {onFocusCamera && (
            <button
              type="button"
              onClick={onFocusCamera}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid rgba(148,163,184,0.35)',
                background: 'rgba(15, 23, 42, 0.75)',
                color: '#e2e8f0',
                fontFamily: 'var(--mono)',
                fontSize: 10.5,
                cursor: 'pointer'
              }}
            >
              🎯 Center 3D View
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setSavedNotice(true);
              setTimeout(() => setSavedNotice(false), 1800);
            }}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: `1px solid ${theme.primary}`,
              background: theme.primary,
              color: '#020617',
              fontFamily: 'var(--mono)',
              fontSize: 10.5,
              fontWeight: 800,
              cursor: 'pointer'
            }}
          >
            {savedNotice ? '✓ Layout Saved!' : '✓ Save Layout'}
          </button>
        </div>
      </div>
    </div>
  );
}
