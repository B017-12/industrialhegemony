import React, { useState } from 'react';
import {
  Bot,
  Compass,
  QrCode,
  Send,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react';
import { PRESET_COPILOT_QUERIES, runEdgeCopilotQuery } from '../utils/copilotEngine';

export function EdgeCopilotDrawer({
  selectedAsset,
  humanPath,
  robotPath,
  nearbyAssets
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
    <div className="bg-slate-900/95 border-t border-slate-800 px-4 py-3 flex flex-col gap-2.5 select-none">
      {/* Top Row: Preset Grounded Queries + Custom Input */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-semibold flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5" />
            <span>Offline Edge AI Copilot</span>
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESET_COPILOT_QUERIES.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => handleAsk(preset)}
                className="px-2 py-1 rounded bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 transition truncate max-w-[235px]"
                title={preset}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Query Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
          className="flex items-center gap-1.5 min-w-[260px] flex-1 max-w-md"
        >
          <input
            type="text"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder={`Ask about ${selectedAsset?.tag || 'assets'}, LOTO, A* routes, or DQ flags...`}
            className="w-full px-3 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
          />
          <button
            type="submit"
            className="px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1 shrink-0"
          >
            <Send className="w-3 h-3" />
            <span>Ask</span>
          </button>
        </form>
      </div>

      {/* Grounded Answer Output with Explicit Document & Asset Citations */}
      {response && (
        <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 flex flex-col md:flex-row items-start justify-between gap-4">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="text-xs font-bold text-white">{response.title}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Confidence {(response.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-xs text-slate-300 whitespace-pre-line leading-relaxed max-h-24 overflow-y-auto pr-2">
              {response.answer}
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-1">
            <span className="text-[10px] font-mono uppercase text-slate-400">
              Grounded Citations
            </span>
            <div className="flex flex-wrap justify-end gap-1 max-w-[240px]">
              {response.citations.map((cid) => (
                <span
                  key={cid}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[10px] text-sky-300"
                >
                  {cid}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Synced Mobile AR Field HUD Modal (Feature 4: QR-SYN Marker Localization & Hands-Free LOTO)
 */
export function MobileArFieldHudModal({
  isOpen,
  onClose,
  selectedAsset,
  checkedLotoSteps,
  onToggleLotoStep,
  humanPath
}) {
  if (!isOpen || !selectedAsset) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border-2 border-slate-700 shadow-2xl overflow-hidden flex flex-col">
        {/* Top Phone Status Bar */}
        <div className="px-5 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-xs font-bold text-emerald-300">
              AR LOCALIZED • {selectedAsset.qr_id}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Simulated Camera Viewfinder + 3D AR Wireframe Reticle */}
        <div className="relative h-56 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4 flex flex-col justify-between border-b border-slate-800 overflow-hidden">
          {/* HUD Grid Lines */}
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(circle at center, rgba(56,189,248,0.4) 1px, transparent 1px)',
              backgroundSize: '20px 20px'
            }}
          />

          <div className="relative z-10 flex items-center justify-between text-xs font-mono">
            <span className="px-2 py-0.5 rounded bg-slate-950/90 border border-sky-500/40 text-sky-300">
              ANCHOR: {selectedAsset.anchor_id}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-950/90 border border-slate-700 text-slate-300">
              POS: [{selectedAsset.position.map((n) => n.toFixed(2)).join(', ')}]
            </span>
          </div>

          {/* Center AR Target Reticle */}
          <div className="relative z-10 my-auto mx-auto px-5 py-3 rounded-xl border-2 border-dashed border-emerald-400/80 bg-slate-950/75 text-center">
            <QrCode className="w-7 h-7 text-emerald-400 mx-auto mb-1" />
            <div className="font-mono text-sm font-bold text-white">
              {selectedAsset.tag} ({selectedAsset.asset_id})
            </div>
            <div className="text-[11px] text-emerald-300 font-mono">
              Health {selectedAsset.health_score}/100 • {selectedAsset.status_reason}
            </div>
          </div>

          {/* Bottom 3D Compass Guidance Bar */}
          <div className="relative z-10 flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800 text-xs font-mono">
            <div className="flex items-center gap-1.5 text-cyan-300">
              <Compass className="w-4 h-4 animate-spin" style={{ animationDuration: '8s' }} />
              <span>Dist to Tool Crib: {humanPath?.distanceMeters || 3.8}m</span>
            </div>
            <span className="text-slate-400">{selectedAsset.connectivity_profile}</span>
          </div>
        </div>

        {/* Synced Hands-Free LOTO Verification Checklist */}
        <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Field Technician LOTO Checklist (Synced)</span>
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              Tap to verify step
            </span>
          </div>

          <div className="space-y-2">
            {selectedAsset.loto_checklist.map((step, idx) => {
              const key = `${selectedAsset.asset_id}-${idx}`;
              const checked = Boolean(checkedLotoSteps[key]);
              return (
                <div
                  key={key}
                  onClick={() => onToggleLotoStep(key)}
                  className={`p-2.5 rounded-xl border text-xs cursor-pointer transition flex items-start gap-2.5 ${
                    checked
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200 line-through'
                      : 'bg-slate-950 border-slate-800 text-slate-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {}}
                    className="mt-0.5 accent-emerald-400"
                  />
                  <span>{step}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
