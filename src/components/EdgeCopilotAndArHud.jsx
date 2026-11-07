import React, { useState } from 'react';
import { Compass, QrCode, Send, X } from 'lucide-react';
import { PRESET_COPILOT_QUERIES, runEdgeCopilotQuery } from '../utils/copilotEngine.js';
import { cleanMarkdown, humanize, statusOf } from '../ui/status.js';
import SceneCommandBox from './SceneCommandBox.jsx';

export function EdgeCopilotDrawer({
  assets = [],
  selectedAsset,
  onSelectAsset,
  humanPath,
  robotPath,
  nearbyAssets,
  sceneEdit,
  splatMover,
  selectedCvObjectId
}) {
  const [queryInput, setQueryInput] = useState('');
  const [response, setResponse] = useState(() =>
    runEdgeCopilotQuery(
      'Explain why CV-003 and P-002 are failing together (Spatial + Root Cause).',
      selectedAsset,
      humanPath,
      robotPath,
      nearbyAssets
    )
  );

  const handleAsk = (text) => {
    const q = text || queryInput;
    if (!q.trim()) return;
    const res = runEdgeCopilotQuery(q, selectedAsset, humanPath, robotPath, nearbyAssets);
    setResponse(res);
    if (!text) setQueryInput('');
  };

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Diagnostic Assistant</span>
        <span className="panel-count">Local RAG</span>
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
            placeholder={`Ask about ${selectedAsset?.tag || 'assets'}, LOTO, or routing...`}
          />
          <button type="submit" className="btn btn-primary btn-icon" title="Run query">
            <Send size={13} />
          </button>
        </form>
      </div>

      <div className="panel-body">
        {sceneEdit && splatMover && (
          <SceneCommandBox
            sceneEdit={sceneEdit}
            splatMover={splatMover}
            selectedCvObjectId={selectedCvObjectId}
            selectedAsset={selectedAsset}
          />
        )}
        {response && (
          <div className="section">
            <div className="answer">
              <div className="answer-head">{cleanMarkdown(response.title)}</div>
              <div className="answer-body">{cleanMarkdown(response.answer)}</div>
              {response.citations?.length > 0 && (
                <div className="answer-foot stack">
                  <div className="section-title" style={{ marginBottom: '2px' }}>
                    <span>Referenced Sources</span>
                  </div>
                  <div className="ref-list">
                    {response.citations.map((cid) => {
                      const matchedAsset = assets.find(
                        (a) => a.asset_id === cid || a.tag === cid
                      );
                      if (matchedAsset && onSelectAsset) {
                        return (
                          <button
                            key={cid}
                            className="ref"
                            onClick={() => onSelectAsset(matchedAsset)}
                            title={`Select ${matchedAsset.tag} (${matchedAsset.service_description})`}
                          >
                            {matchedAsset.tag} ({cid})
                          </button>
                        );
                      }
                      return (
                        <span key={cid} className="ref">
                          {cid}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="section stack">
          <div className="section-title">
            <span>Standard Diagnostic Queries</span>
          </div>
          {PRESET_COPILOT_QUERIES.map((preset, idx) => (
            <button
              key={idx}
              className="suggestion"
              onClick={() => handleAsk(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>
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
