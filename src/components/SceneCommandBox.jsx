import React, { useState } from 'react';
import { Check, Send, Sparkles, Undo2, X } from 'lucide-react';
import { sceneCommand } from '../sceneApi.js';

const VERDICT_CLS = { allowed: 'si-ok', warning: 'si-warn', blocked: 'si-bad' };
const STATUS_CLS = { proposal: '', refused: 'si-bad', clarify: 'si-warn', noop: '' };
const EXAMPLES = [
  'move the office chair next to the door',
  'put the vacuum 1 m to the left',
  'rotate the step ladder 90°',
  'clear the walkway to P-002',
  'remove the cardboard box from the scene'
];

/**
 * Typed scene command -> AI proposal (POST /api/scene/command; the AI only reads intent, the backend picks and
 * checks the pose). Allowed moves with real clearance apply on their own; anything else waits for Confirm.
 * Applying = glide the splats, then the normal commit (POST /api/scene/edits), which rebuilds rails and routes.
 */
export default function SceneCommandBox({ sceneEdit, splatMover, selectedCvObjectId, selectedAsset, onBeforeRun, GapGrid }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(null); // 'thinking' | 'moving' | null
  const [applied, setApplied] = useState(null); // { editId, auto }
  const [msg, setMsg] = useState(null);

  const mover = () => splatMover.mover();
  const movable = (id) => sceneEdit.movables.find((m) => m.object_id === id);

  const clear = () => {
    mover()?.cancel();
    mover()?.end();
  };

  const apply = async (r, auto) => {
    const obj = movable(r.movable_id);
    setBusy('moving');
    try {
      if (obj && mover()) await (r.edit.remove ? mover().animateRemove(obj) : mover().animateTo(obj, r.edit));
      const d = await sceneEdit.commit(r.edit, 'AI copilot');
      mover()?.end();
      const last = d.edits?.[d.edits.length - 1];
      setApplied({ editId: last?.edit_id, auto });
      setMsg(`${auto ? 'Applied automatically' : 'Applied'}. Rails and ${d.replan?.summary?.reachable}/${d.replan?.summary?.assets} routes rebuilt.`);
    } catch (e) {
      clear();
      setMsg(e.status === 409 ? `Blocked on commit: ${(e.body?.preview?.reasons || []).join('; ')}` : String(e.message || e));
    } finally {
      setBusy(null);
    }
  };

  const show = (r) => {
    setRes(r);
    const obj = movable(r.movable_id);
    if (r.status === 'proposal' && obj && mover()) {
      if (r.edit.remove) mover().showRemoval(obj);
      else mover().showProposal(obj, r.edit, r.preview);
      if (r.auto_apply) apply(r, true);
    }
  };

  const run = async (t, movableId) => {
    const q = (t ?? text).trim();
    if (!q) return;
    onBeforeRun?.();
    clear();
    setApplied(null);
    setMsg(null);
    setRes(null);
    setBusy('thinking');
    try {
      const r = await sceneCommand({
        text: q,
        selected_object_id: selectedCvObjectId || null,
        target_asset_id: selectedAsset?.asset_id || null,
        camera: mover()?.cameraPose() || null,
        movable_id: movableId || null
      });
      setBusy(null);
      show(r);
    } catch (e) {
      setBusy(null);
      setMsg(String(e.message || e));
    }
  };

  const useAlternative = async (alt) => {
    setBusy('thinking');
    try {
      const pv = await sceneEdit.preview(alt.edit);
      setBusy(null);
      show({ ...res, edit: alt.edit, preview: pv, exact: false, auto_apply: false,
        explanation: `Alternative: shift ${alt.moved_m} m. Check: ${pv.verdict}: ${pv.reasons.join('; ')}.` });
    } catch (e) {
      setBusy(null);
      setMsg(String(e.message || e));
    }
  };

  const pv = res?.preview;
  const pending = res?.status === 'proposal' && !applied && busy !== 'moving' && !res.auto_apply;

  return (
    <div className="section" data-testid="scene-command">
      <div className="section-title">
        <span>
          <Sparkles size={12} /> Ask the AI to move something
        </span>
        {res?.mode && <span className="mono">{res.mode === 'llm' ? res.model : 'rule parser'}</span>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          className="input"
          value={text}
          placeholder="e.g. move the office chair next to the door"
          onChange={(e) => setText(e.target.value)}
          disabled={!!busy}
        />
        <button className="btn btn-sm btn-primary" type="submit" disabled={!!busy || !text.trim()}>
          <Send size={12} />
        </button>
      </form>
      {!res && !busy && (
        <div className="si-row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="btn btn-sm btn-ghost" onClick={() => { setText(ex); run(ex); }}>
              {ex}
            </button>
          ))}
        </div>
      )}
      {busy && <div className="help">{busy === 'thinking' ? 'Reading the command, checking poses…' : 'Moving, then rebuilding rails…'}</div>}

      {res && (
        <div className="se-proposal" style={{ marginTop: 8 }}>
          <div className="section-title">
            <span>{res.label || (res.status === 'clarify' ? 'Which object?' : 'Answer')}</span>
            {pv ? (
              <span className={`si-chip ${VERDICT_CLS[pv.verdict] || ''}`}>{pv.verdict}</span>
            ) : (
              <span className={`si-chip ${STATUS_CLS[res.status] || ''}`}>{res.status}</span>
            )}
          </div>
          <div className="help" data-testid="scene-command-explanation">{res.explanation}</div>
          {res.status === 'proposal' && res.edit.remove && <div className="help mono">remove from the scene</div>}
          {res.status === 'proposal' && !res.edit.remove && (
            <div className="help mono">
              Δx {res.edit.translate_world[0].toFixed(2)} · Δz {res.edit.translate_world[2].toFixed(2)} · yaw {res.edit.yaw_deg}°
              {res.exact ? '' : ' · alternative pose'}
            </div>
          )}
          {pv?.gaps_m && GapGrid && <GapGrid gaps={pv.gaps_m} />}
          {res.options?.length > 0 && (
            <div className="si-row si-tools">
              {res.options.map((o) => (
                <button key={o.movable_id} className="btn btn-sm" onClick={() => run(res.text, o.movable_id)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {pending && (
            <div className="si-row si-tools">
              <button className="btn btn-sm btn-primary" disabled={pv?.verdict === 'blocked'} onClick={() => apply(res, false)}>
                <Check size={12} /> {res.edit?.remove ? 'Confirm removal' : 'Confirm move'}
              </button>
              <button className="btn btn-sm" onClick={() => { clear(); setRes(null); }}>
                <X size={12} /> Cancel
              </button>
            </div>
          )}
          {pending && res.alternatives?.length > 0 && (
            <div className="si-row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {res.alternatives.map((a, i) => (
                <button key={i} className="btn btn-sm btn-ghost" onClick={() => useAlternative(a)} title={a.reasons?.join('; ')}>
                  alt {i + 1}: {a.verdict}, {a.moved_m} m{a.route_delta_m != null ? `, route ${a.route_delta_m >= 0 ? '+' : ''}${a.route_delta_m} m` : ''}
                </button>
              ))}
            </div>
          )}
          {applied?.editId && (
            <div className="si-row si-tools">
              <button className="btn btn-sm btn-ghost" onClick={() => { sceneEdit.undo(applied.editId); setApplied(null); setMsg('Undone.'); }}>
                <Undo2 size={12} /> Undo
              </button>
            </div>
          )}
        </div>
      )}
      {msg && <div className="help" data-testid="scene-command-msg" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
