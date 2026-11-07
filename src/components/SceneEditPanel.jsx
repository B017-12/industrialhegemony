import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Move, RotateCcw, RotateCw, Undo2, X } from 'lucide-react';
import './sceneInspector.css';
import SceneCommandBox from './SceneCommandBox.jsx';

const VERDICT_CLS = { allowed: 'si-ok', warning: 'si-warn', blocked: 'si-bad' };
const STEP = 0.1; // PLY units (~0.12 m)

function GapGrid({ gaps }) {
  if (!gaps) return null;
  const fmt = (v) => (v == null ? '>2.4' : v.toFixed(2));
  return (
    <div className="se-gaps" title="Clear distance from the object to the nearest obstacle at the heights it occupies (world axes)">
      {['-x', '+x', '-z', '+z', 'min'].map((k) => (
        <div key={k}>
          {k}
          <b className={gaps[k] != null && gaps[k] < 0.15 ? 'si-bad-text' : ''}>{fmt(gaps[k])}</b>
        </div>
      ))}
    </div>
  );
}

/**
 * Move / rotate an extracted object (its splats and its box). Every pose is checked by the backend: gaps to
 * neighbours, interpenetration, floor, reachability of all assets, aisle clearance and route change. Blocked
 * poses cannot be applied. Applied edits rebuild the equal-clearance rails and every avatar route.
 */
export default function SceneEditPanel({
  cvSceneObjects,
  selectedCvObjectId,
  selectedAsset,
  sceneEdit,
  splatMover,
  useRailRoutes,
  onToggleRailRoutes,
  onSelectCvObject
}) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState('translate');
  const [pv, setPv] = useState(null);
  const [delta, setDelta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const seq = useRef(0);

  const obj = useMemo(
    () => cvSceneObjects?.objects?.find((o) => o.object_id === selectedCvObjectId) || null,
    [cvSceneObjects, selectedCvObjectId]
  );
  const whole = selectedCvObjectId ? sceneEdit.movableFor(selectedCvObjectId) : null; // null = fixed
  const mover = splatMover.mover();

  const runPreview = async (d) => {
    if (!d) return;
    setDelta(d);
    const my = ++seq.current;
    try {
      const res = await sceneEdit.preview(d);
      if (my !== seq.current) return; // stale
      setPv(res);
      splatMover.mover()?.setPreview(res);
    } catch (e) {
      setMsg(String(e.message || e));
    }
  };

  useEffect(() => {
    splatMover.setListener({ onChange: runPreview, onDragEnd: runPreview });
    return () => splatMover.setListener(null);
  });

  // stop editing when the selection changes or the panel closes
  useEffect(() => {
    return () => splatMover.mover()?.end();
  }, [selectedCvObjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setEditing(false);
    setPv(null);
    setDelta(null);
  }, [selectedCvObjectId]);

  const start = () => {
    if (!mover || !whole) return;
    const r = mover.begin(whole, mode);
    setEditing(true);
    setPv(null);
    setDelta(null);
    setMsg(r?.splats ? `${whole.label}: ${r.splats.toLocaleString()} splats move as one object` : 'splats not copyable: showing a proxy box');
  };

  const cancel = () => {
    mover?.cancel();
    mover?.end();
    setEditing(false);
    setPv(null);
    setDelta(null);
  };

  const apply = async () => {
    if (!delta) return;
    setBusy(true);
    try {
      const res = await sceneEdit.commit(delta, 'field technician');
      mover?.end();
      setEditing(false);
      setMsg(`Applied. Rails and ${res.replan?.summary?.reachable}/${res.replan?.summary?.assets} routes rebuilt.`);
      setPv(res.preview);
    } catch (e) {
      if (e.status === 409 && e.body?.preview) {
        setPv(e.body.preview);
        mover?.cancel();
        setMsg('Blocked: snapped back to the last valid pose.');
      } else setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const target = sceneEdit.replan?.targets?.find((t) => t.asset_id === selectedAsset?.asset_id);
  const blocked = pv?.verdict === 'blocked';

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Scene Editing</span>
        <span className="panel-count">
          {sceneEdit.online === false ? 'backend offline' : `${sceneEdit.edits.length} edit(s)`}
        </span>
      </div>
      <div className="panel-body">
        <SceneCommandBox
          sceneEdit={sceneEdit}
          splatMover={splatMover}
          selectedCvObjectId={selectedCvObjectId}
          selectedAsset={selectedAsset}
          onBeforeRun={() => editing && cancel()}
          GapGrid={GapGrid}
        />
        <div className="section">
          <div className="section-title">
            <span>Selected object</span>
            <span className="mono">{selectedCvObjectId || '-'}</span>
          </div>
          {whole ? (
            <div className="help">
              Whole object: <b>{whole.label}</b> ({whole.object_id}) · moves as one piece
              {obj?.scene_edit ? ' · moved' : ''}
            </div>
          ) : obj ? (
            <div className="si-gate">
              Fixed: {obj.display_label || obj.class} is part of the plant or building, or cannot be separated from
              neighbouring clutter in the scan. Only whole freestanding objects can move.
            </div>
          ) : (
            <div className="help">Select an object in the 3D view or pick one below.</div>
          )}
          {!editing ? (
            <div className="si-row si-tools">
              <button className="btn btn-sm btn-primary" disabled={!whole || whole.removed || !splatMover.ready} onClick={start}>
                <Move size={12} /> Move / rotate
              </button>
              {!splatMover.ready && <span className="help">waiting for the splat scene…</span>}
            </div>
          ) : (
            <>
              <div className="si-row si-tools">
                <div className="seg">
                  <button
                    className={mode === 'translate' ? 'active' : ''}
                    onClick={() => {
                      setMode('translate');
                      mover?.setMode('translate');
                    }}
                  >
                    Move
                  </button>
                  <button
                    className={mode === 'rotate' ? 'active' : ''}
                    onClick={() => {
                      setMode('rotate');
                      mover?.setMode('rotate');
                    }}
                  >
                    Rotate
                  </button>
                </div>
                <div className="se-nudge" title="Nudge (world axes)">
                  <span />
                  <button className="btn btn-sm" onClick={() => mover?.nudge(0, -STEP)}>−z</button>
                  <span />
                  <button className="btn btn-sm" onClick={() => mover?.nudge(-STEP, 0)}>−x</button>
                  <span />
                  <button className="btn btn-sm" onClick={() => mover?.nudge(STEP, 0)}>+x</button>
                  <span />
                  <button className="btn btn-sm" onClick={() => mover?.nudge(0, STEP)}>+z</button>
                  <span />
                </div>
                <button className="btn btn-sm" onClick={() => mover?.nudge(0, 0, -15)} title="Rotate −15°">
                  <RotateCcw size={12} />
                </button>
                <button className="btn btn-sm" onClick={() => mover?.nudge(0, 0, 15)} title="Rotate +15°">
                  <RotateCw size={12} />
                </button>
              </div>
              <div className="help">Drag the gizmo in the 3D view; the ghost turns green / amber / red.</div>
              {delta && (
                <div className="help mono">
                  Δx {delta.translate_world[0].toFixed(2)} · Δz {delta.translate_world[2].toFixed(2)} · yaw{' '}
                  {delta.yaw_deg.toFixed(0)}°
                </div>
              )}
              <div className="si-row si-tools">
                <button className="btn btn-sm btn-primary" disabled={!delta || blocked || busy} onClick={apply}>
                  <Check size={12} /> {busy ? 'Replanning…' : 'Apply & replan'}
                </button>
                <button className="btn btn-sm" onClick={cancel}>
                  <X size={12} /> Cancel
                </button>
              </div>
            </>
          )}
          {msg && <div className="help" style={{ marginTop: 6 }}>{msg}</div>}
        </div>

        {!editing && (
          <div className="section">
            <div className="section-title">
              <span>Movable objects</span>
              <span className="mono">{sceneEdit.movables.length}</span>
            </div>
            <div className="help" style={{ marginBottom: 6 }}>
              Hand-verified whole, freestanding objects. Everything else is fixed.
            </div>
            {sceneEdit.movables.map((m) => (
              <div key={m.object_id} className="se-edit">
                <span>
                  {m.label} <span className="mono">({m.object_id})</span>
                  {m.removed && <span className="help"> · removed</span>}
                </span>
                <button
                  className={`btn btn-sm ${whole?.object_id === m.object_id ? 'on' : ''}`}
                  onClick={() => onSelectCvObject?.(m.seed_object_ids?.[0])}
                >
                  Select
                </button>
              </div>
            ))}
          </div>
        )}

        {pv && (
          <div className="section">
            <div className="section-title">
              <span>Feasibility</span>
              <span className={`si-chip ${VERDICT_CLS[pv.verdict] || ''}`}>{pv.verdict}</span>
            </div>
            <ul className="si-list">
              {pv.reasons?.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            {pv.gaps_m && (
              <>
                <div className="field-label" style={{ marginTop: 8 }}>
                  <span>Gap to nearest obstacle (m)</span>
                  <span className="mono">
                    at {pv.gaps_band_m?.[0]}–{pv.gaps_band_m?.[1]} m height
                  </span>
                </div>
                <GapGrid gaps={pv.gaps_m} />
              </>
            )}
            <div className="si-kv mono" style={{ marginTop: 6 }}>
              overlap {(pv.overlap_frac * 100 || 0).toFixed(0)}% · outside floor {((pv.outside_floor_frac || 0) * 100).toFixed(0)}%
              {pv.aisle_spare_clearance_m != null ? ` · walkway spare ${pv.aisle_spare_clearance_m.toFixed(2)} m` : ''}
              {pv.route_delta_m != null ? ` · route ${pv.route_delta_m >= 0 ? '+' : ''}${pv.route_delta_m} m` : ''}
            </div>
          </div>
        )}

        <div className="section">
          <div className="section-title">
            <span>Routes</span>
            <span className="mono">
              {sceneEdit.replan ? `${sceneEdit.replan.summary.reachable}/${sceneEdit.replan.summary.assets} reachable` : ''}
            </span>
          </div>
          <label className="check">
            <input type="checkbox" checked={useRailRoutes} onChange={(e) => onToggleRailRoutes(e.target.checked)} />
            Avatar follows equal-clearance rails (left = right at every body band)
          </label>
          {target && (
            <div className="si-kv mono">
              {selectedAsset?.tag}:{' '}
              {target.reachable
                ? `${target.mission.length_m} m, min body clearance ${target.mission.min_body_clearance_m} m${
                    target.mission.lr_imbalance_m ? `, L/R imbalance median ${target.mission.lr_imbalance_m.median} m` : ''
                  }`
                : 'no reachable stand point'}
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-title">
            <span>Edit log (shared, persisted)</span>
            {sceneEdit.edits.length > 0 && (
              <button className="btn btn-sm btn-danger" onClick={() => sceneEdit.reset()}>
                Reset all
              </button>
            )}
          </div>
          {sceneEdit.edits.length === 0 && <div className="help">No edits: the scene matches the scan.</div>}
          {sceneEdit.edits.map((e) => (
            <div key={e.edit_id} className="se-edit">
              <span className="mono">
                {e.remove
                  ? `${e.object_id} removed`
                  : `${e.object_id} Δ(${e.translate_world[0].toFixed(2)}, ${e.translate_world[2].toFixed(2)}) ${e.yaw_deg}°`}
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => sceneEdit.undo(e.edit_id)} title="Undo this edit">
                <Undo2 size={12} />
              </button>
            </div>
          ))}
          {sceneEdit.error && <div className="si-gate">{sceneEdit.error}</div>}
        </div>
      </div>
    </>
  );
}
