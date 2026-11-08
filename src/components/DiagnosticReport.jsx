import React, { useState } from 'react';
import { assetCard, lookupSource } from '../utils/diagnosticEngine.js';
import { humanize } from '../ui/status.js';

const COND_CLS = { attention_required: 'critical', degraded: 'high', watch: 'medium', healthy: 'normal' };

function Spark({ points }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((v, i) => `${((i / (points.length - 1)) * 60).toFixed(1)},${(14 - ((v - min) / span) * 12 - 1).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="diag-spark" viewBox="0 0 60 14" width="60" height="14" aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function AssetChip({ item, assets, onSelectAsset, extra }) {
  const sceneAsset = assets.find((a) => a.asset_id === item.asset_id);
  return (
    <button
      type="button"
      className={`diag-chip cond-${COND_CLS[item.condition_state] || 'normal'}`}
      onClick={() => sceneAsset && onSelectAsset?.(sceneAsset)}
      title={sceneAsset ? `Select ${item.tag} in the scene` : item.tag}
    >
      <span className="diag-dot" />
      <b>{item.tag}</b>
      {item.issue_code && item.issue_code !== 'NORMAL' && <span>{humanize(item.issue_code)}</span>}
      {item.health_score != null && <span className="muted">{item.health_score}</span>}
      {extra}
    </button>
  );
}

export function Sources({ ids, assets, onSelectAsset }) {
  const [open, setOpen] = useState(null);
  if (!ids?.length) return null;
  const src = open ? lookupSource(open) : null;
  return (
    <div className="diag-sources">
      <div className="section-title">
        <span>Sources (Excel pack)</span>
      </div>
      <div className="ref-list">
        {ids.map((id) => {
          const sceneAsset = assets.find((a) => a.asset_id === id);
          return (
            <button
              key={id}
              type="button"
              className={`ref ${open === id ? 'on' : ''}`}
              onClick={() => {
                setOpen(open === id ? null : id);
                if (sceneAsset) onSelectAsset?.(sceneAsset);
              }}
            >
              {sceneAsset ? `${sceneAsset.tag} (${id})` : id}
            </button>
          );
        })}
      </div>
      {src && (
        <div className="diag-source-snippet">
          <b>{src.title}</b>
          <div>{src.text}</div>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, defaultOpen = true, children }) {
  return (
    <details className="diag-section" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {count != null && <span className="muted">{count}</span>}
      </summary>
      <div className="diag-section-body">{children}</div>
    </details>
  );
}

function NeighbourList({ title, items, assets, onSelectAsset }) {
  return (
    <div className="diag-neigh">
      <div className="diag-neigh-title">{title}</div>
      {items.length === 0 && <div className="muted">None in the assumed topology.</div>}
      {items.map((n) => (
        <div key={n.tag} className={`diag-neigh-item ${n.flag !== 'ok' ? 'flagged' : ''}`}>
          <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <AssetChip item={n} assets={assets} onSelectAsset={onSelectAsset} />
            <span className="mono muted">
              {n.relation}
              {n.hops > 1 ? ` · via ${n.via}` : ''}
              {n.distance_m != null ? ` · ${n.distance_m} m` : ''}
            </span>
            {n.flag !== 'ok' && <span className="diag-flag">{n.flag}</span>}
          </div>
          <div className="diag-neigh-note">{n.note}</div>
          <div className="diag-neigh-check">→ {n.check}</div>
        </div>
      ))}
    </div>
  );
}

export default function DiagnosticReport({
  report,
  assets,
  onSelectAsset,
  guidedRun,
  onProceedRepair,
  onOpen3dCutaway
}) {
  const [checked, setChecked] = useState({});
  const focus = report.focus;
  const open = (key, fallback = true) => (focus ? focus === key : fallback);
  const canRepair =
    guidedRun?.phase === 'arrived' && guidedRun.assetId === report.asset.asset_id && report.asset.issue_code !== 'NORMAL';
  const a = report.asset;
  const m = report.modelCatalogMatch;

  return (
    <div className="diag-report">
      {m && (
        <div
          style={{
            padding: '10px 12px',
            marginBottom: '8px',
            borderRadius: '8px',
            background: 'rgba(2, 18, 34, 0.94)',
            border: '1.5px solid #00f2ff'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
            <span className="mono" style={{ fontSize: '10px', color: '#00f2ff', fontWeight: 800 }}>
              3D CATALOG RESOLVED · {m.model_id}
            </span>
            <span className="mono" style={{ fontSize: '10px', color: '#fca5a5', fontWeight: 700 }}>
              part_id: {m.part_id}
            </span>
          </div>
          <div style={{ fontWeight: 800, fontSize: '12px', marginTop: '3px', color: '#fff' }}>
            {m.tag} · {m.model_name} ({m.service_circuit})
          </div>
          <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '3px' }}>
            Matched GLB: <code className="mono">{m.glb_path}</code> ({m.part_count} parts) · Highlighted nodes:{' '}
            <b>{m.matched_nodes.join(', ')}</b>
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '3px' }}>
            Credit: {m.attribution} · {m.license}
          </div>
          {onOpen3dCutaway && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginTop: '7px', width: '100%' }}
              onClick={() => onOpen3dCutaway(m)}
            >
              🔬 Open 31-Part 3D Cutaway &amp; Mechanical Seal Leak Demo
            </button>
          )}
        </div>
      )}
      <div className={`diag-head cond-${COND_CLS[a.condition_state] || 'normal'}`}>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <span className="diag-dot" />
          <b className="mono">{a.tag}</b>
          <span className="muted">{a.name.split(' · ')[1]}</span>
          <span className="spacer" />
          <span className="diag-conf" title={report.confidence.reasons.join('\n')}>
            conf {Math.round(report.confidence.value * 100)}%
          </span>
        </div>
        <div className="diag-headline">{report.headline}</div>
        {report.spatial.arrived && <div className="diag-arrived">Technician on site at {a.tag}</div>}
        <p className="diag-summary">{report.summary}</p>
        {canRepair && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onProceedRepair}>
            Checks done — proceed with repair
          </button>
        )}
      </div>

      {report.findings.length > 0 && (
        <Section title="Findings (telemetry vs healthy baseline)" count={report.findings.length} defaultOpen={open('findings')}>
          {report.findings.map((f) => (
            <div key={f.signal} className={`diag-finding ${f.supports === true ? 'yes' : f.supports === false ? 'no' : 'info'}`}>
              <span className="diag-finding-mark">{f.supports === true ? '✓' : f.supports === false ? '✗' : '•'}</span>
              <span className="diag-finding-text">{f.text}</span>
              <Spark points={f.spark} />
            </div>
          ))}
          {report.cases.length > 0 && (
            <div className="diag-cases">
              {report.cases.map((c) => (
                <div key={c.case_id}>
                  <span className="mono">{c.case_id}</span> {c.interpretation} → <i>{c.next_check}</i> ({c.severity})
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="Instructions" count={`${report.steps.length} phases`} defaultOpen={open('steps')}>
        {report.steps.map((ph) => (
          <div key={ph.phase} className={`diag-phase ${ph.illustrative ? 'illustrative' : ''}`}>
            <div className="diag-phase-title">{ph.phase}</div>
            {ph.items.map((it, i) => {
              const key = `${ph.phase}-${i}`;
              return (
                <label key={key} className={`diag-step ${checked[key] ? 'done' : ''}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(checked[key])}
                    onChange={() => setChecked((p) => ({ ...p, [key]: !p[key] }))}
                  />
                  <span>{it}</span>
                </label>
              );
            })}
          </div>
        ))}
      </Section>

      <Section
        title="Previous & subsequent processes to check"
        count={report.upstream.length + report.downstream.length}
        defaultOpen={open('process')}
      >
        <NeighbourList title="Upstream (previous)" items={report.upstream} assets={assets} onSelectAsset={onSelectAsset} />
        <NeighbourList title="Downstream (subsequent)" items={report.downstream} assets={assets} onSelectAsset={onSelectAsset} />
        {report.instruments.length > 0 && (
          <div className="diag-neigh">
            <div className="diag-neigh-title">Instruments</div>
            {report.instruments.map((i) => (
              <div key={i.tag} className="diag-neigh-item">
                <AssetChip item={i} assets={assets} onSelectAsset={onSelectAsset} />{' '}
                <span className="muted">{i.relation} — {i.note}</span>
              </div>
            ))}
          </div>
        )}
        {report.utilities.length > 0 && (
          <div className="diag-neigh">
            <div className="diag-neigh-title">Utilities</div>
            {report.utilities.map((u) => (
              <div key={u.id} className="diag-neigh-item">
                <b>{u.name}</b> — {u.check}
              </div>
            ))}
          </div>
        )}
      </Section>

      {(report.spatial.passed.length > 0 || report.spatial.nearbyNow.length > 0 || report.spatial.notes.length > 0) && (
        <Section title="Spatial context" defaultOpen={open('spatial', report.spatial.arrived)}>
          {report.spatial.notes.map((n) => (
            <div key={n} className="diag-note">{n}</div>
          ))}
          {report.spatial.passed.length > 0 && (
            <>
              <div className="diag-neigh-title">Passed on the route</div>
              <div className="diag-chips">
                {report.spatial.passed.map((p) => (
                  <AssetChip key={p.tag} item={assetCard(p) || p} assets={assets} onSelectAsset={onSelectAsset} />
                ))}
              </div>
            </>
          )}
          {report.spatial.nearbyNow.length > 0 && (
            <>
              <div className="diag-neigh-title">Within reach now</div>
              <div className="diag-chips">
                {report.spatial.nearbyNow.map((n) => (
                  <AssetChip key={n.tag} item={n} assets={assets} onSelectAsset={onSelectAsset} extra={<span className="mono muted">{n.distance_m} m</span>} />
                ))}
              </div>
            </>
          )}
        </Section>
      )}

      <Section title="Service history" defaultOpen={open('history', false)}>
        {report.history.serviceDue && (
          <div className="diag-note">
            Last service {report.history.serviceDue.last}, interval {report.history.serviceDue.intervalDays} d → due{' '}
            {report.history.serviceDue.due} (
            {report.history.serviceDue.daysUntilDue < 0
              ? `${-report.history.serviceDue.daysUntilDue} d overdue`
              : `in ${report.history.serviceDue.daysUntilDue} d`}
            )
          </div>
        )}
        {report.history.prior && (
          <div className="diag-note">
            Fleet record for “{report.history.prior.action}” on this class: {report.history.prior.n} jobs, avg{' '}
            {report.history.prior.avg_duration_h} h / {report.history.prior.avg_downtime_h} h downtime; outcomes{' '}
            {Object.entries(report.history.prior.results).map(([k, v]) => `${humanize(k)} ${v}`).join(', ')}.
          </div>
        )}
        {report.history.recent.map((w) => (
          <div key={w.work_order_id} className="diag-wo">
            <span className="mono">{w.work_order_id}</span> {String(w.opened_at).slice(0, 10)} · {w.action} · {humanize(w.result)}
          </div>
        ))}
        {report.history.events && (
          <div className="diag-note">
            Events: {report.history.events.open} open ·{' '}
            {Object.entries(report.history.events.bySeverity).map(([k, v]) => `${k} ${v}`).join(', ')}
          </div>
        )}
      </Section>

      <div className="diag-caveats">
        {report.caveats.map((c) => (
          <div key={c}>⚠ {c}</div>
        ))}
      </div>
      <Sources ids={report.citations} assets={assets} onSelectAsset={onSelectAsset} />
    </div>
  );
}
