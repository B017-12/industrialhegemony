import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Link2, MessageSquare, RefreshCw, Square, Tag } from 'lucide-react';
import {
  visionCrosscheck,
  visionEval,
  visionForObject,
  visionFrames,
  visionHealth,
  visionInspect,
  visionLabel,
  visionLink,
  visionAddRegion
} from '../sceneApi.js';
import './sceneInspector.css';

const STATE_CLS = {
  open: 'si-ok',
  closed: 'si-warn',
  partially_open: 'si-warn',
  unknown: 'si-unknown',
  not_applicable: 'si-na'
};
const VERDICT_CLS = { consistent: 'si-ok', mismatch: 'si-bad', unverifiable: 'si-unknown' };
const GT_STATES = ['open', 'closed', 'partially_open', 'unknown', 'not_applicable'];
const KINDS = ['manual_valve', 'control_valve', 'gauge', 'pump', 'motor', 'other'];

function lsGet(k, d) {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

/** Frame image with clickable region boxes and an optional draw-a-box mode. */
function FrameView({ frame, selectedRegionId, onSelectRegion, drawMode, onDrawn }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const W = frame.width || 1280;
  const H = frame.height || 720;
  const toPx = (e) => {
    const r = ref.current.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
  };
  const pct = (b) => ({
    left: `${(b[0] / W) * 100}%`,
    top: `${(b[1] / H) * 100}%`,
    width: `${((b[2] - b[0]) / W) * 100}%`,
    height: `${((b[3] - b[1]) / H) * 100}%`
  });
  return (
    <div
      ref={ref}
      className={`si-frame ${drawMode ? 'drawing' : ''}`}
      onPointerDown={(e) => {
        if (!drawMode) return;
        const p = toPx(e);
        setDrag([...p, ...p]);
      }}
      onPointerMove={(e) => {
        if (drag) setDrag([drag[0], drag[1], ...toPx(e)]);
      }}
      onPointerUp={() => {
        if (!drag) return;
        const b = [
          Math.min(drag[0], drag[2]),
          Math.min(drag[1], drag[3]),
          Math.max(drag[0], drag[2]),
          Math.max(drag[1], drag[3])
        ];
        setDrag(null);
        if (b[2] - b[0] > 12 && b[3] - b[1] > 12) onDrawn(b);
      }}
    >
      <img src={frame.file} alt={frame.frame_id} draggable={false} />
      {frame.regions.map((r) => (
        <button
          key={r.region_id}
          className={`si-box ${r.region_id === selectedRegionId ? 'sel' : ''} ${r.object_id ? 'linked' : ''}`}
          style={pct(r.bbox_px)}
          title={`${r.region_id} · ${r.kind} · ${r.description}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!drawMode) onSelectRegion(r.region_id);
          }}
        />
      ))}
      {drag && <div className="si-box drawing-box" style={pct([Math.min(drag[0], drag[2]), Math.min(drag[1], drag[3]), Math.max(drag[0], drag[2]), Math.max(drag[1], drag[3])])} />}
    </div>
  );
}

function FindingCard({ f }) {
  if (!f) return null;
  const d = f.draft;
  return (
    <div className="si-card">
      <div className="si-row">
        <span className={`si-chip ${STATE_CLS[f.state] || ''}`}>{f.state.replace('_', ' ')}</span>
        <span className="mono si-conf" title="computed confidence">
          conf {f.confidence.toFixed(2)}
        </span>
        <span className="si-mode mono">
          {f.mode}
          {f.model_id ? ` · ${f.model_id}` : ''}
        </span>
      </div>
      <div className="si-seen">
        {d.object_seen}
        {d.text_read ? <span className="mono"> “{d.text_read}”</span> : null}
      </div>
      {f.gate_note && <div className="si-gate">{f.gate_note}</div>}
      {d.answer && <div className="si-answer">{d.answer}</div>}
      {d.state_cues?.length > 0 && (
        <ul className="si-list">
          {d.state_cues.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      {d.gauge && (
        <div className="si-kv">
          gauge:{' '}
          {d.gauge.readable
            ? `${d.gauge.value} ${d.gauge.unit || ''} (scale ${d.gauge.scale_min ?? '?'}–${d.gauge.scale_max ?? '?'})`
            : 'not readable'}
        </div>
      )}
      {d.running_indicator && d.running_indicator !== 'not_applicable' && (
        <div className="si-kv">running indicator: {d.running_indicator.replace('_', ' ')}</div>
      )}
      {d.visible_issues?.length > 0 && <div className="si-kv si-bad-text">visible: {d.visible_issues.join('; ')}</div>}
      <details className="si-factors">
        <summary>confidence factors</summary>
        {f.confidence_factors.map((c) => (
          <div key={c.name} className="si-factor">
            <span>{c.name}</span>
            <span className="mono">{c.value.toFixed(2)}</span>
            <span className="si-note">{c.note}</span>
          </div>
        ))}
      </details>
      <div className="si-ev mono">
        {f.finding_id} · {f.evidence_ids.join(' · ')}
      </div>
      <div className="si-safety">{f.safety_note}</div>
    </div>
  );
}

function CrossCheckCard({ cc }) {
  if (!cc) return null;
  return (
    <div className="si-card">
      <div className="si-row">
        <span className={`si-chip ${VERDICT_CLS[cc.verdict]}`}>{cc.verdict}</span>
        <span className="mono">
          {cc.tag} · {cc.asset_class?.toLowerCase().replace(/_/g, ' ')}
        </span>
      </div>
      {cc.telemetry_flag && <div className="si-gate">Telemetry: {cc.telemetry_flag}</div>}
      <ul className="si-list">
        {cc.rationale.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <div className="si-ev mono">{cc.evidence_ids.join(' · ')}</div>
      <div className="si-safety">{cc.advice}</div>
    </div>
  );
}

/**
 * Visual inspection panel: real video frames of the boiler room, hand-drawn regions, Gemini findings with a
 * computed confidence, technician linking/labelling, and a vision-vs-telemetry cross-check.
 */
export default function SceneInspectorPanel({ selectedCvObjectId, selectedAsset }) {
  const [health, setHealth] = useState(null);
  const [frames, setFrames] = useState([]);
  const [scope, setScope] = useState('object'); // 'object' | 'all'
  const [objInfo, setObjInfo] = useState(null);
  const [frameId, setFrameId] = useState(null);
  const [regionId, setRegionId] = useState(null);
  const [finding, setFinding] = useState(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [cc, setCc] = useState(null);
  const [evalDoc, setEvalDoc] = useState(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawKind, setDrawKind] = useState('manual_valve');
  const [labeller, setLabeller] = useState(() => lsGet('valmet.vision.labeller', ''));
  const assetId = selectedAsset?.asset_id;

  const refreshFrames = useCallback(
    () =>
      visionFrames()
        .then((d) => setFrames(d.frames))
        .catch((e) => setError(String(e.message || e))),
    []
  );

  useEffect(() => {
    visionHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
    refreshFrames();
    visionEval().then(setEvalDoc).catch(() => null);
  }, [refreshFrames]);

  useEffect(() => {
    if (!selectedCvObjectId) return;
    visionForObject(selectedCvObjectId)
      .then((d) => {
        setObjInfo(d);
        const first = d.linked_regions[0];
        if (first) {
          setFrameId(first.frame_id);
          setRegionId(first.region_id);
          setFinding(d.findings.find((f) => f.region_id === first.region_id) || null);
        } else if (d.near_frames[0]) {
          setFrameId(d.near_frames[0].frame_id);
          setRegionId(null);
          setFinding(null);
        }
      })
      .catch(() => setObjInfo(null));
  }, [selectedCvObjectId]);

  useEffect(() => {
    if (!assetId) return;
    visionCrosscheck(assetId).then(setCc).catch(() => setCc(null));
  }, [assetId, finding]);

  const frameList = useMemo(() => {
    if (scope === 'all' || !objInfo) return frames;
    const ids = new Set([
      ...objInfo.linked_regions.map((r) => r.frame_id),
      ...objInfo.near_frames.map((n) => n.frame_id)
    ]);
    const list = frames.filter((f) => ids.has(f.frame_id));
    return list.length ? list : frames;
  }, [scope, objInfo, frames]);

  const frame = frames.find((f) => f.frame_id === frameId) || frameList[0];
  const region = frame?.regions.find((r) => r.region_id === regionId) || null;
  const near = objInfo?.near_frames.find((n) => n.frame_id === frame?.frame_id);

  const run = async (opts = {}) => {
    if (!frame) return;
    setBusy(true);
    setError(null);
    try {
      const body = region
        ? { region_id: region.region_id }
        : { frame_id: frame.frame_id };
      const f = await visionInspect({ ...body, question: opts.question || null, force: !!opts.force });
      setFinding(f);
      visionEval().then(setEvalDoc).catch(() => null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    if (!region) return;
    try {
      await visionLink(region.region_id, {
        object_id: selectedCvObjectId || null,
        asset_id: assetId || null,
        by: labeller || 'technician'
      });
      await refreshFrames();
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  const label = async (state) => {
    if (!region) return;
    if (!labeller.trim()) {
      setError('Enter your name before labelling ground truth.');
      return;
    }
    try {
      await visionLabel(region.region_id, { state, labelled_by: labeller.trim() });
      await refreshFrames();
      visionEval().then(setEvalDoc).catch(() => null);
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  const onDrawn = async (bbox) => {
    try {
      const r = await visionAddRegion({ frame_id: frame.frame_id, bbox_px: bbox, kind: drawKind });
      await refreshFrames();
      setRegionId(r.region_id);
      setFinding(null);
      setDrawMode(false);
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Visual Inspection</span>
        <span className="panel-count" title="vision model (VISION_MODEL in .env)">
          {health ? health.model || 'no model: fallback' : 'backend offline'}
        </span>
      </div>
      <div className="panel-toolbar">
        <div className="seg">
          <button className={scope === 'object' ? 'active' : ''} onClick={() => setScope('object')}>
            Near {selectedCvObjectId || 'object'}
          </button>
          <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
            All frames <span className="count">{frames.length}</span>
          </button>
        </div>
        <div className="si-thumbs">
          {frameList.map((f) => (
            <button
              key={f.frame_id}
              className={`si-thumb ${f.frame_id === frame?.frame_id ? 'sel' : ''}`}
              onClick={() => {
                setFrameId(f.frame_id);
                setRegionId(null);
                setFinding(null);
              }}
              title={`${f.frame_id} · t=${f.video_t_s}s · ${f.regions.length} regions`}
            >
              <img src={f.file} alt="" loading="lazy" />
              <span className="mono">{f.frame_id.slice(4)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body">
        {!health && (
          <div className="section help">
            Backend not reachable. Start it with <span className="mono">uv run uvicorn backend.app:app --port 8000</span>.
          </div>
        )}
        {frame && (
          <div className="section">
            <div className="section-title">
              <span>
                {frame.frame_id} · video {frame.video_t_s}s
              </span>
              <span>{near ? `captured ${near.distance_m} m from ${selectedCvObjectId}` : ''}</span>
            </div>
            <FrameView
              frame={frame}
              selectedRegionId={region?.region_id}
              onSelectRegion={(id) => {
                setRegionId(id);
                const f = objInfo?.findings.find((x) => x.region_id === id);
                setFinding(f || null);
              }}
              drawMode={drawMode}
              onDrawn={onDrawn}
            />
            <div className="si-row si-tools">
              <button className={`btn btn-sm ${drawMode ? 'on' : ''}`} onClick={() => setDrawMode((v) => !v)}>
                <Square size={12} /> {drawMode ? 'Drag a box…' : 'Draw region'}
              </button>
              {drawMode && (
                <select className="select si-small" value={drawKind} onChange={(e) => setDrawKind(e.target.value)}>
                  {KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              )}
              <span className="help">Camera orientation is unknown: “near” means captured nearby, not facing.</span>
            </div>
          </div>
        )}

        <div className="section">
          <div className="section-title">
            <span>{region ? `${region.region_id} · ${region.kind.replace('_', ' ')}` : 'Whole frame'}</span>
            {region?.object_id && (
              <span className="mono" title={`link: ${region.link_method} (${region.link_confidence})`}>
                → {region.object_id}
                {region.asset_id ? ` / ${region.asset_id}` : ''}
              </span>
            )}
          </div>
          {region && <div className="help">{region.description}{region.note ? ` · ${region.note}` : ''}</div>}
          <div className="si-row si-tools">
            <button className="btn btn-sm btn-primary" disabled={busy || !frame} onClick={() => run()}>
              <Eye size={12} /> {busy ? 'Inspecting…' : 'Inspect'}
            </button>
            <button className="btn btn-sm" disabled={busy || !frame} onClick={() => run({ force: true })} title="Ignore cache">
              <RefreshCw size={12} />
            </button>
            {region && (
              <button
                className="btn btn-sm"
                onClick={link}
                disabled={!selectedCvObjectId && !assetId}
                title="Technician confirms this photo region shows the selected 3D object / asset"
              >
                <Link2 size={12} /> Link to {selectedAsset?.tag || selectedCvObjectId}
              </button>
            )}
          </div>
          <div className="si-row si-tools">
            <input
              className="input"
              placeholder="Ask about this region / frame…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && question.trim()) run({ question: question.trim() });
              }}
            />
            <button className="btn btn-sm" disabled={busy || !question.trim()} onClick={() => run({ question: question.trim() })}>
              <MessageSquare size={12} />
            </button>
          </div>
          {error && <div className="si-gate">{error}</div>}
          <FindingCard f={finding} />
          {region && (
            <div className="si-gt">
              <div className="field-label">
                <span>
                  <Tag size={11} /> Ground truth (human)
                </span>
                <span className="mono">
                  {region.gt ? `${region.gt.state} by ${region.gt.labelled_by}` : region.proposed ? `draft: ${region.proposed.state}` : 'unlabelled'}
                </span>
              </div>
              <div className="si-row">
                <input
                  className="input si-small"
                  placeholder="your name"
                  value={labeller}
                  onChange={(e) => {
                    setLabeller(e.target.value);
                    lsSet('valmet.vision.labeller', e.target.value);
                  }}
                />
                {GT_STATES.map((s) => (
                  <button key={s} className={`btn btn-sm ${region.gt?.state === s ? 'on' : ''}`} onClick={() => label(s)}>
                    {s.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {assetId && (
          <div className="section">
            <div className="section-title">
              <span>Vision vs telemetry · {selectedAsset?.tag}</span>
            </div>
            <CrossCheckCard cc={cc} />
          </div>
        )}

        {evalDoc && (
          <div className="section help">
            Accuracy on human labels: {evalDoc.evaluated}/{evalDoc.labelled_regions} labelled regions inspected
            {Object.entries(evalDoc.per_kind).map(([k, v]) => (
              <span key={k} className="mono">
                {' '}
                · {k}: {v.state_accuracy ?? '–'} (n={v.n}, abstained {v.abstained})
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
