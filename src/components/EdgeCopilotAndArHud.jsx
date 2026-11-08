import React, { useState } from 'react';
import { Compass, Navigation, QrCode, Send, X } from 'lucide-react';
import { PRESET_QUERIES, assetCard } from '../utils/diagnosticEngine.js';
import { humanize, statusOf } from '../ui/status.js';
import SceneCommandBox from './SceneCommandBox.jsx';
import DiagnosticReport, { Sources } from './DiagnosticReport.jsx';

const COND_CLS = { attention_required: 'critical', degraded: 'high', watch: 'medium', healthy: 'normal' };

function AssetRow({ item, assets, onSelectAsset, onAsk, onStartGuidedRun, right }) {
  const sceneAsset = assets.find((a) => a.asset_id === item.asset_id);
  return (
    <div className={`diag-row cond-${COND_CLS[item.condition_state] || 'normal'}`}>
      <button type="button" className="diag-row-main" onClick={() => sceneAsset && onSelectAsset?.(sceneAsset)}>
        <span className="diag-dot" />
        <b className="mono">{item.tag}</b>
        <span className="diag-row-issue">{item.issue_code === 'NORMAL' ? 'Normal' : humanize(item.issue_code)}</span>
        <span className="muted mono">{item.health_score}</span>
        {right}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAsk(`Diagnose ${item.tag}`)}>
        Diagnose
      </button>
      {sceneAsset && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStartGuidedRun(item.asset_id)}>
          Guide
        </button>
      )}
    </div>
  );
}

function GuidedRunStrip({ run, nearbyAssets, assets, onSelectAsset, onToggleFollow, onCancel }) {
  const phaseText =
    run.phase === 'walking'
      ? `${run.workerLabel || 'Technician'} walking to ${run.tag}`
      : run.phase === 'arrived'
      ? `On site at ${run.tag}: diagnosis ready`
      : `Repairing ${run.tag}`;
  const live = nearbyAssets.filter((n) => n.asset_id !== run.assetId);
  return (
    <div className={`guided-strip phase-${run.phase}`}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <Navigation size={12} />
        <b>{phaseText}</b>
        <span className="spacer" />
        <button type="button" className={`btn btn-sm ${run.follow ? 'on' : ''}`} onClick={onToggleFollow} title="Camera follows the technician">
          Follow
        </button>
        {run.phase !== 'repairing' && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} title="Recall technician">
            <X size={12} />
          </button>
        )}
      </div>
      <div className="guided-strip-label">Along the route ({run.passed.length} scanned)</div>
      <div className="diag-chips">
        {run.passed.length === 0 && <span className="muted">No assets in range yet…</span>}
        {run.passed.map((p) => {
          const c = assetCard(p) || p;
          const inRange = live.some((n) => n.asset_id === p.asset_id);
          const sceneAsset = assets.find((a) => a.asset_id === p.asset_id);
          return (
            <button
              key={p.asset_id}
              type="button"
              className={`diag-chip cond-${COND_CLS[c.condition_state] || 'normal'} ${inRange ? 'live' : ''}`}
              onClick={() => sceneAsset && onSelectAsset?.(sceneAsset)}
              title={c.name}
            >
              <span className="diag-dot" />
              <b>{c.tag}</b>
              {c.issue_code && c.issue_code !== 'NORMAL' && <span>{humanize(c.issue_code)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResponseView({
  response,
  assets,
  onSelectAsset,
  onAsk,
  onStartGuidedRun,
  guidedRun,
  onProceedRepair,
  onOpen3dCutaway
}) {
  if (!response) return null;
  if (response.kind === 'diagnosis') {
    return (
      <DiagnosticReport
        key={`${response.asset.asset_id}-${response.query}`}
        report={response}
        assets={assets}
        onSelectAsset={onSelectAsset}
        guidedRun={guidedRun}
        onProceedRepair={onProceedRepair}
        onOpen3dCutaway={onOpen3dCutaway}
      />
    );
  }
  const rowProps = { assets, onSelectAsset, onAsk, onStartGuidedRun };
  return (
    <div className="answer">
      <div className={`answer-head ${response.failed ? 'diag-failed' : ''}`}>{response.headline}</div>
      <div className="answer-body diag-answer-list">
        {response.kind === 'triage' &&
          response.items.map((it) => (
            <AssetRow key={it.asset_id} item={it} {...rowProps} right={<span className="diag-urg">{it.urgency}</span>} />
          ))}
        {response.kind === 'nearby' &&
          response.items.map((it) => (
            <AssetRow key={it.asset_id} item={it} {...rowProps} right={<span className="mono muted">{it.distance_m} m</span>} />
          ))}
        {response.kind === 'search' &&
          response.results.map((r) => (
            <div key={r.id} className="diag-hit">
              <div>
                <span className="mono">{r.id}</span> <b>{r.title}</b>
              </div>
              <div className="muted">{r.text}</div>
            </div>
          ))}
      </div>
      {response.kind === 'search' && <Sources ids={response.citations} assets={assets} onSelectAsset={onSelectAsset} />}
    </div>
  );
}

export function EdgeCopilotDrawer({
  assets = [],
  selectedAsset,
  onSelectAsset,
  nearbyAssets = [],
  tab = 'diagnostics',
  onTabChange,
  response,
  onAsk,
  guidedRun,
  onStartGuidedRun,
  onProceedRepair,
  onCancelGuidedRun,
  onToggleFollow,
  sceneEdit,
  splatMover,
  selectedCvObjectId,
  onOpen3dCutaway
}) {
  const [queryInput, setQueryInput] = useState('');

  const handleAsk = (text) => {
    const q = text || queryInput;
    if (!q.trim()) return;
    onAsk(q);
    if (!text) setQueryInput('');
  };

  return (
    <>
      <div className="tabs copilot-tabs">
        <button type="button" className={`tab ${tab === 'diagnostics' ? 'active' : ''}`} onClick={() => onTabChange('diagnostics')}>
          Diagnostics
        </button>
        <button type="button" className={`tab ${tab === 'scene' ? 'active' : ''}`} onClick={() => onTabChange('scene')}>
          Scene Commands
        </button>
      </div>

      {tab === 'scene' && (
        <div className="panel-body">
          {sceneEdit && splatMover && (
            <SceneCommandBox
              sceneEdit={sceneEdit}
              splatMover={splatMover}
              selectedCvObjectId={selectedCvObjectId}
              selectedAsset={selectedAsset}
            />
          )}
        </div>
      )}

      {tab === 'diagnostics' && (
        <>
          <div className="panel-header">
            <span className="panel-title">Diagnostic Assistant</span>
            <span className="panel-count">Local RAG · Excel pack</span>
          </div>

          <div className="panel-toolbar">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAsk();
              }}
              className="row"
            >
              <input
                type="text"
                className="input"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={`Ask about ${selectedAsset?.tag || 'an asset'}, or "guide me to P-005"…`}
              />
              <button type="submit" className="btn btn-primary btn-icon" title="Ask">
                <Send size={13} />
              </button>
            </form>
            {selectedAsset && (
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => onStartGuidedRun(selectedAsset.asset_id)}>
                  <Navigation size={12} /> Guide me to {selectedAsset.tag}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => handleAsk(`Diagnose ${selectedAsset.tag}`)}>
                  Diagnose {selectedAsset.tag}
                </button>
              </div>
            )}
          </div>

          <div className="panel-body">
            {guidedRun && (
              <div className="section">
                <GuidedRunStrip
                  run={guidedRun}
                  nearbyAssets={nearbyAssets}
                  assets={assets}
                  onSelectAsset={onSelectAsset}
                  onToggleFollow={onToggleFollow}
                  onCancel={onCancelGuidedRun}
                />
              </div>
            )}

            {response && (
              <div className="section">
                {response.query && <div className="diag-query">“{response.query}”</div>}
                <ResponseView
                  response={response}
                  assets={assets}
                  onSelectAsset={onSelectAsset}
                  onAsk={handleAsk}
                  onStartGuidedRun={onStartGuidedRun}
                  guidedRun={guidedRun}
                  onProceedRepair={onProceedRepair}
                  onOpen3dCutaway={onOpen3dCutaway}
                />
              </div>
            )}

            <div className="section stack">
              <div className="section-title">
                <span>Try asking</span>
              </div>
              {PRESET_QUERIES.map((preset) => (
                <button key={preset} type="button" className="suggestion" onClick={() => handleAsk(preset)}>
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Field Verification & Synced LOTO Sign-Off Modal
 */
export function MobileArFieldHudModal({
  isOpen,
  onClose,
  selectedAsset,
  checkedLotoSteps,
  onToggleLotoStep,
  humanPath,
  arTrafficSignal
}) {
  const [qrScanned, setQrScanned] = useState(true);
  const [hudLightMode, setHudLightMode] = useState('AUTO'); // 'AUTO' | 'RED' | 'YELLOW' | 'GREEN'

  if (!isOpen || !selectedAsset) return null;

  const st = statusOf(selectedAsset);
  const baseSig = arTrafficSignal || {
    light: 'GREEN',
    headline: 'GREEN LIGHT — PROCEED',
    detail: 'Corridor clear · Right-of-way granted'
  };
  const activeLight = hudLightMode === 'AUTO' ? baseSig.light : hudLightMode;
  const activeHeadline =
    hudLightMode === 'RED'
      ? 'RED LIGHT — HOLD POSITION'
      : hudLightMode === 'YELLOW'
      ? 'YELLOW LIGHT — KEEP RIGHT LANE'
      : hudLightMode === 'GREEN'
      ? 'GREEN LIGHT — PROCEED'
      : baseSig.headline;
  const activeDetail =
    hudLightMode === 'RED'
      ? 'Cross-traffic AMR/Technician priority in aisle · Wait at virtual stop line'
      : hudLightMode === 'YELLOW'
      ? 'Shared corridor active · Maintain +0.22 m right-hand passing offset'
      : hudLightMode === 'GREEN'
      ? 'Aisle clear to target equipment · Safe to proceed'
      : baseSig.detail;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <QrCode size={16} />
          <span className="panel-title">Field Verification — {selectedAsset.tag}</span>
          <span className="spacer" />
          <button
            className="btn btn-sm"
            onClick={() => setQrScanned((s) => !s)}
          >
            {qrScanned ? 'Re-scan QR' : 'Lock Marker'}
          </button>
          <button
            className="btn btn-sm btn-icon"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="hud-view" style={{ height: '245px' }}>
            <div className="hud-row mono">
              <span>ANCHOR: {selectedAsset.anchor_id}</span>
              <span>
                {qrScanned ? `LOCKED · ${selectedAsset.qr_id}` : 'SCANNING MARKER...'}
              </span>
            </div>

            {/* AR Corridor Red-Light / Green-Light Traffic Control Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 8px',
                background: 'rgba(18, 23, 27, 0.88)',
                border: `1px solid ${
                  activeLight === 'RED'
                    ? '#ef4444'
                    : activeLight === 'YELLOW'
                    ? '#f59e0b'
                    : '#49a942'
                }`,
                borderRadius: '3px'
              }}
            >
              <div className="traffic-lights">
                <span className={`traffic-lamp red ${activeLight === 'RED' ? 'on' : ''}`} />
                <span className={`traffic-lamp yellow ${activeLight === 'YELLOW' ? 'on' : ''}`} />
                <span className={`traffic-lamp green ${activeLight === 'GREEN' ? 'on' : ''}`} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: '11px', fontWeight: 700, color: '#fff' }}>
                  {activeHeadline}
                </div>
                <div className="truncate" style={{ fontSize: '10.5px', color: '#cbd5e1' }}>
                  {activeDetail}
                </div>
              </div>
              <div className="row" style={{ gap: '2px' }}>
                {['AUTO', 'RED', 'YELLOW', 'GREEN'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setHudLightMode(m)}
                    style={{
                      fontSize: '9.5px',
                      padding: '2px 4px',
                      borderRadius: '2px',
                      border: '1px solid #475569',
                      background: hudLightMode === m ? '#1f6fb2' : '#1e293b',
                      color: '#fff',
                      fontFamily: 'var(--mono)'
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="hud-target">
              <div className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>
                {selectedAsset.tag} · {selectedAsset.asset_id}
              </div>
              <div style={{ fontSize: '12px', color: '#d5dde5', marginTop: '2px' }}>
                {selectedAsset.service_description}
              </div>
              <div className="mono" style={{ fontSize: '11.5px', marginTop: '6px' }}>
                {st.label} ({selectedAsset.health_score}%) · {humanize(selectedAsset.status_reason)}
              </div>
            </div>

            <div className="hud-row mono">
              <span>
                <Compass size={12} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
                Route distance: {humanPath?.distanceMeters || 3.8} m
              </span>
              <span>{selectedAsset.connectivity_profile}</span>
            </div>
          </div>

          <div className="section stack">
            <div className="section-title">
              <span>LOTO Isolation Checklist (Synced)</span>
              <span className="mono">{selectedAsset.qr_id}</span>
            </div>

            <ul className="checklist">
              {selectedAsset.loto_checklist.map((step, idx) => {
                const key = `${selectedAsset.asset_id}-${idx}`;
                const checked = Boolean(checkedLotoSteps[key]);
                return (
                  <li
                    key={key}
                    className={checked ? 'done' : ''}
                    onClick={() => onToggleLotoStep(key)}
                  >
                    <input type="checkbox" checked={checked} onChange={() => {}} />
                    <span>{step}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
