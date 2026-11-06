import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  FileText,
  GitBranch,
  Layers,
  MapPin,
  QrCode,
  ShieldAlert,
  Sparkles,
  Wrench
} from 'lucide-react';
import { VALMET_RAG_DOCS } from '../data/valmetDataset';

export default function AssetInspectorPanel({
  selectedAsset,
  nearbyAssets,
  onSelectAsset,
  checkedLotoSteps,
  onToggleLotoStep,
  onOpenArHud,
  onDraftWorkOrder,
  draftedWoBanner
}) {
  const [activeTab, setActiveTab] = useState('why'); // 'why' | 'telemetry' | 'loto' | 'nearby'

  if (!selectedAsset) return null;

  const isCritical =
    selectedAsset.health_status === 'attention_required' ||
    selectedAsset.health_status === 'degraded';

  const badgeStyles = {
    attention_required: 'bg-red-500/20 text-red-300 border-red-500/40',
    degraded: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    watch: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    healthy: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
  };

  return (
    <aside className="w-[410px] shrink-0 h-full bg-slate-900/95 border-l border-slate-800 flex flex-col overflow-hidden select-none">
      {/* Asset Identity Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/60">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold text-white">
                {selectedAsset.tag}
              </span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {selectedAsset.asset_id}
              </span>
              <span
                className={`text-[11px] font-mono uppercase px-2 py-0.5 rounded border font-semibold ${
                  badgeStyles[selectedAsset.health_status]
                }`}
              >
                {selectedAsset.health_status.replace('_', ' ')} • {selectedAsset.health_score}%
              </span>
            </div>
            <div className="text-xs text-slate-300 mt-1 font-medium">
              {selectedAsset.service_description} ({selectedAsset.subtype.replace(/_/g, ' ')})
            </div>
          </div>

          <button
            onClick={onOpenArHud}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center gap-1.5 shrink-0"
            title="Open Synced Mobile AR Field HUD"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>AR HUD</span>
          </button>
        </div>

        {/* Spatial & Anchor Metadata Pills */}
        <div className="grid grid-cols-3 gap-1.5 mt-3 text-[11px]">
          <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Area / Zone</span>
            <span className="font-mono text-slate-200 truncate block">{selectedAsset.area_name}</span>
          </div>
          <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">3D Anchor Pos</span>
            <span className="font-mono text-sky-300">
              [{selectedAsset.position.map((v) => v.toFixed(1)).join(', ')}]
            </span>
          </div>
          <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">QR / Connectivity</span>
            <span className="font-mono text-slate-200">{selectedAsset.qr_id}</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="grid grid-cols-4 border-b border-slate-800 bg-slate-950/40 text-xs font-medium">
        <button
          onClick={() => setActiveTab('why')}
          className={`py-2.5 px-2 border-b-2 transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'why'
              ? 'border-sky-400 text-sky-300 bg-sky-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>Why Tree</span>
        </button>
        <button
          onClick={() => setActiveTab('telemetry')}
          className={`py-2.5 px-2 border-b-2 transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'telemetry'
              ? 'border-sky-400 text-sky-300 bg-sky-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>Telemetry</span>
        </button>
        <button
          onClick={() => setActiveTab('loto')}
          className={`py-2.5 px-2 border-b-2 transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'loto'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          <span>LOTO SOP</span>
        </button>
        <button
          onClick={() => setActiveTab('nearby')}
          className={`py-2.5 px-2 border-b-2 transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'nearby'
              ? 'border-amber-400 text-amber-300 bg-amber-500/10'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Radar ({nearbyAssets.length})</span>
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* TAB 1: CONTEXT DECISION TREE ("WHY" PANEL) */}
        {activeTab === 'why' && (
          <>
            {/* Process Coupling Topology Card */}
            <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Spatial & Process Topology</span>
                <span className="text-sky-400">{selectedAsset.line_id}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Upstream</div>
                  <div className="font-mono text-slate-200 mt-0.5 truncate" title={selectedAsset.upstream_asset}>
                    {selectedAsset.upstream_asset}
                  </div>
                </div>
                <div className="p-2 rounded bg-sky-500/10 border border-sky-500/30 text-center">
                  <div className="text-[10px] text-sky-300">Selected</div>
                  <div className="font-mono font-bold text-white mt-0.5">{selectedAsset.tag}</div>
                </div>
                <div className="p-2 rounded bg-slate-900 border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Downstream</div>
                  <div className="font-mono text-slate-200 mt-0.5 truncate" title={selectedAsset.downstream_asset}>
                    {selectedAsset.downstream_asset}
                  </div>
                </div>
              </div>
            </div>

            {/* 4-Step Context Decision Tree */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                <span>Explainable AI Context Decision Tree</span>
                <span className="text-[11px] font-mono text-emerald-400">
                  Anomaly Score: {(selectedAsset.anomaly_score * 100).toFixed(0)}%
                </span>
              </div>

              {selectedAsset.decision_tree.map((node, i) => (
                <div
                  key={node.step}
                  className="relative pl-6 pb-2 border-l-2 border-slate-700 last:border-l-0"
                >
                  <span
                    className={`absolute -left-[9px] top-0.5 w-4 h-4 rounded-full text-[10px] font-mono font-bold flex items-center justify-center ${
                      i === 3
                        ? 'bg-emerald-500 text-slate-950'
                        : isCritical
                        ? 'bg-orange-500 text-slate-950'
                        : 'bg-sky-500 text-slate-950'
                    }`}
                  >
                    {node.step}
                  </span>
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400">
                        {node.node}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-white mt-0.5">{node.title}</div>
                    <div className="text-xs text-slate-300 mt-1 leading-relaxed">{node.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Grounded Work Order & Event Evidence */}
            {selectedAsset.work_order && (
              <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-orange-300 flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5" />
                    {selectedAsset.work_order.wo_id} ({selectedAsset.work_order.priority})
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-200">
                    {selectedAsset.work_order.failure_code}
                  </span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {selectedAsset.work_order.summary}
                </p>
              </div>
            )}

            {/* Data Quality / Connectivity Alert if present */}
            {selectedAsset.data_quality_note && (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Data Quality & Edge Flag:</span>
                  {selectedAsset.data_quality_note}
                </div>
              </div>
            )}

            {/* Grounded RAG Documentation Citations */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Grounded Valmet RAG Knowledge Docs
              </div>
              {selectedAsset.doc_refs.map((docId) => {
                const doc = VALMET_RAG_DOCS.find((d) => d.doc_id === docId);
                return (
                  <div
                    key={docId}
                    className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-xs"
                  >
                    <div className="flex items-center gap-1.5 font-mono text-sky-300 font-semibold">
                      <FileText className="w-3.5 h-3.5" />
                      <span>{docId}</span>
                    </div>
                    {doc && (
                      <>
                        <div className="text-slate-200 font-medium mt-0.5">{doc.title}</div>
                        <div className="text-slate-400 text-[11px] mt-0.5">{doc.summary}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* TAB 2: LIVE TELEMETRY & ALARM EVENTS */}
        {activeTab === 'telemetry' && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              {Object.entries(selectedAsset.telemetry).map(([key, val]) => (
                <div
                  key={key}
                  className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800"
                >
                  <div className="text-[10px] font-mono uppercase text-slate-400">
                    {key.replace(/_/g, ' ')}
                  </div>
                  <div className="text-base font-mono font-bold text-white mt-0.5">
                    {val}
                  </div>
                </div>
              ))}
            </div>

            {/* 30-Minute Time-Series Trend Bars */}
            {selectedAsset.telemetry_trend && (
              <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-200">
                  Recent 30-Min Telemetry Trend (Valmet Builder Pack)
                </div>
                <div className="space-y-1.5">
                  {selectedAsset.telemetry_trend.map((pt, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs font-mono py-1 border-b border-slate-800/60 last:border-0"
                    >
                      <span className="text-slate-400">{pt.time}</span>
                      <div className="flex items-center gap-3 text-slate-200">
                        {pt.sp !== undefined && <span>SP: {pt.sp}%</span>}
                        {pt.pv !== undefined && (
                          <span className="text-sky-300">PV: {pt.pv}%</span>
                        )}
                        {pt.stiction !== undefined && (
                          <span className="text-orange-300">Stic: {pt.stiction}</span>
                        )}
                        {pt.pressure !== undefined && <span>P: {pt.pressure} bar</span>}
                        {pt.vibration !== undefined && (
                          <span className="text-red-300">Vib: {pt.vibration} mm/s</span>
                        )}
                        {pt.bearing_temp !== undefined && (
                          <span className="text-orange-300">Brg: {pt.bearing_temp}°C</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active Event Log */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-200">
                Plant Event Stream ({selectedAsset.events.length})
              </div>
              {selectedAsset.events.map((ev) => (
                <div
                  key={ev.event_id}
                  className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-sky-300 font-bold">{ev.event_id}</span>
                    <span className="text-slate-400">{ev.timestamp}</span>
                  </div>
                  <div className="text-xs font-semibold text-orange-300">{ev.event_type}</div>
                  <div className="text-xs text-slate-300">{ev.message}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* TAB 3: INTERACTIVE LOTO & FIELD SOP CHECKLIST */}
        {activeTab === 'loto' && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-emerald-400" />
                Zero-Energy LOTO & Field Calibration Protocol
              </div>
              <div className="text-[11px] text-emerald-300/80 mt-1">
                Synced in real time with the Technician Mobile AR HUD ({selectedAsset.qr_id}).
              </div>
            </div>

            <div className="space-y-2">
              {selectedAsset.loto_checklist.map((stepText, idx) => {
                const stepKey = `${selectedAsset.asset_id}-${idx}`;
                const isDone = Boolean(checkedLotoSteps[stepKey]);
                return (
                  <label
                    key={stepKey}
                    onClick={() => onToggleLotoStep(stepKey)}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ${
                      isDone
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 line-through opacity-85'
                        : 'bg-slate-950/80 border-slate-800 text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => {}}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <span className="leading-relaxed">{stepText}</span>
                  </label>
                );
              })}
            </div>

            <button
              onClick={() => onDraftWorkOrder(selectedAsset)}
              className="w-full py-2.5 px-4 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 transition"
            >
              <Sparkles className="w-4 h-4" />
              <span>Generate AI-Grounded Work Order Packet</span>
            </button>

            {draftedWoBanner && (
              <div className="p-3 rounded-lg bg-sky-500/15 border border-sky-500/40 text-xs text-sky-200 space-y-1">
                <div className="font-mono font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Dispatched: {draftedWoBanner.id}</span>
                </div>
                <div>{draftedWoBanner.message}</div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PROXIMITY RADAR (ASSETS WITHIN AVATAR RADIUS) */}
        {activeTab === 'nearby' && (
          <div className="space-y-2.5">
            <div className="text-xs text-slate-300">
              Assets dynamically detected inside the Robot/Technician 3D proximity sphere as it walks the path:
            </div>
            {nearbyAssets.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400 text-center">
                No assets currently inside proximity radius. Increase radius slider or scrub robot path.
              </div>
            ) : (
              nearbyAssets.map((item) => (
                <button
                  key={item.asset_id}
                  onClick={() => onSelectAsset(item)}
                  className={`w-full p-2.5 rounded-lg border text-left transition flex items-center justify-between ${
                    item.asset_id === selectedAsset.asset_id
                      ? 'bg-sky-500/15 border-sky-500/50'
                      : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-white">{item.tag}</span>
                      <span className="text-[10px] font-mono text-slate-400">{item.asset_id}</span>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-0.5">
                      {item.service_description} • Health {item.health_score}%
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-xs font-bold">
                      {item.distanceToAvatar}m
                    </span>
                    <div className="text-[10px] text-slate-400 mt-0.5">{item.status_reason}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
