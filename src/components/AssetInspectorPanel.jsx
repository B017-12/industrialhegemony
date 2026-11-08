import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { QrCode, FileText, Wrench, CheckCircle2, Camera, Box, PanelRightClose } from 'lucide-react';
import {
  statusOf,
  humanize,
  telemetryLabel,
  telemetryUnit
} from '../ui/status.js';
import { EVIDENCE_PHOTO_MAP } from '../utils/cvEngine.js';
import { getPartVisualSpec, EXCEL_ASSET_RECORDS } from '../data/excelPartCatalog.js';

/**
 * 3D Asset Contour & Planar Datum Preview
 * Uses neutral light grey background (ISA-101) and reserves colour for abnormal states.
 */
function AssetContourMiniViewer({ asset }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || !asset) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe4e8ec);

    const width = container.clientWidth || 320;
    const height = container.clientHeight || 150;

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 20);
    camera.position.set(1.25, 0.9, -1.45);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dLight.position.set(2, 3, -2);
    scene.add(dLight);

    const root = new THREE.Group();
    scene.add(root);

    const [sx, sy, sz] = asset.bbox_size;

    // 1. Planar rear datum face
    const backPlaneGeo = new THREE.PlaneGeometry(sx * 1.04, sy * 1.04);
    const backPlaneMat = new THREE.MeshBasicMaterial({
      color: 0xcbd2d9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75
    });
    const backPlane = new THREE.Mesh(backPlaneGeo, backPlaneMat);
    backPlane.position.set(0, 0, sz * 0.5);
    root.add(backPlane);

    const backBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(backPlaneGeo),
      new THREE.LineBasicMaterial({ color: 0x7d8893 })
    );
    backBorder.position.copy(backPlane.position);
    root.add(backBorder);

    // 2. Equipment mesh with ISA-101 status colour
    const colorMap = {
      attention_required: 0xc62828,
      degraded: 0xe06c00,
      watch: 0xc99400,
      healthy: 0x6b7682
    };
    const statusColor = colorMap[asset.health_status] || 0x6b7682;

    const equipMat = new THREE.MeshStandardMaterial({
      color: statusColor,
      metalness: 0.45,
      roughness: 0.35,
      transparent: true,
      opacity: 0.88
    });

    if (asset.asset_class === 'control_valve') {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(sx * 0.25, sx * 0.25, sx * 0.7, 16),
        equipMat
      );
      body.rotation.z = Math.PI / 2;
      body.position.y = -sy * 0.15;
      root.add(body);
      const dome = new THREE.Mesh(
        new THREE.CylinderGeometry(sx * 0.36, sx * 0.22, sy * 0.35, 20),
        equipMat
      );
      dome.position.y = sy * 0.22;
      root.add(dome);
    } else if (
      asset.asset_class === 'process_pump' ||
      asset.asset_class === 'electric_motor'
    ) {
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(sy * 0.32, sy * 0.32, sx * 0.75, 20),
        equipMat
      );
      cyl.rotation.z = Math.PI / 2;
      root.add(cyl);
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(sx * 0.88, sy * 0.14, sz * 0.82),
        equipMat
      );
      base.position.y = -sy * 0.38;
      root.add(base);
    } else {
      const sensor = new THREE.Mesh(
        new THREE.SphereGeometry(Math.min(sx, sy) * 0.34, 18, 18),
        equipMat
      );
      root.add(sensor);
    }

    // 3. Bounding wireframe
    const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: statusColor })
    );
    root.add(wire);

    // 4. Multi-point attachment seam loop
    if (asset.contourModel?.contourPoints?.length) {
      const localPts = asset.contourModel.contourPoints.map(
        (pt) =>
          new THREE.Vector3(
            pt[0] - asset.position[0],
            pt[1] - asset.position[1],
            pt[2] - asset.position[2]
          )
      );
      localPts.push(localPts[0].clone());

      const cLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(localPts),
        new THREE.LineBasicMaterial({ color: 0x1f6fb2 })
      );
      root.add(cLine);

      const dotGeo = new THREE.SphereGeometry(0.028, 10, 10);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x1f6fb2 });
      localPts.slice(0, -1).forEach((v) => {
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(v);
        root.add(dot);
      });
    }

    let animId;
    const animate = (now) => {
      animId = requestAnimationFrame(animate);
      root.rotation.y = Math.sin(now * 0.0007) * 0.55;
      renderer.render(scene, camera);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, [asset]);

  return (
    <div className="preview">
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      <div className="preview-caption mono">
        {asset.contourModel?.contourPointCount || 12} seam vertices • planar rear datum
      </div>
    </div>
  );
}

export default function AssetInspectorPanel({
  assets = [],
  selectedAsset,
  onSelectAsset,
  checkedLotoSteps,
  onToggleLotoStep,
  onOpenArHud,
  onDraftWorkOrder,
  draftedWoBanner,
  onMutateTelemetry,
  pipelineMeta,
  onOpenCvReview,
  onClose
}) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'diagnosis' | 'telemetry' | 'procedure'

  if (!selectedAsset) return null;

  const st = statusOf(selectedAsset);
  const completedSteps = selectedAsset.loto_checklist.filter((_, idx) =>
    Boolean(checkedLotoSteps[`${selectedAsset.asset_id}-${idx}`])
  ).length;
  const totalSteps = selectedAsset.loto_checklist.length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const resolveLinkedAsset = (text) => {
    if (!text) return null;
    const match = String(text).match(/(ASSET-\d{3}|CV-\d{3}|P-\d{3}|M-\d{3}|PT-\d{3}|FT-\d{3}|VS-\d{3})/);
    if (!match) return null;
    const token = match[1];
    return assets.find((a) => a.asset_id === token || a.tag === token) || null;
  };

  const upstreamTarget = resolveLinkedAsset(selectedAsset.upstream_asset);
  const downstreamTarget = resolveLinkedAsset(selectedAsset.downstream_asset);

  const rootCauseStep = selectedAsset.decision_tree?.[2];
  const actionStep = selectedAsset.decision_tree?.[3];
  const cvObj = selectedAsset.cvObject || null;
  const cvEvidencePhoto =
    cvObj?.evidence_photo || (cvObj?.object_id ? EVIDENCE_PHOTO_MAP[cvObj.object_id] : null);

  return (
    <aside className="inspector" aria-label="Asset inspector">
      {/* ==================== ASSET IDENTITY HEADER ==================== */}
      <div className="inspector-head">
        <div className="row">
          <span className="inspector-tag">{selectedAsset.tag}</span>
          <span className="mono muted">{selectedAsset.asset_id}</span>
          <span className={`status ${st.cls}`}>
            <span className={`sdot ${st.cls}`} />
            <span>
              {st.label} · {selectedAsset.health_score}%
            </span>
          </span>
          <span className="spacer" />
          <button
            className="btn btn-sm"
            onClick={onOpenArHud}
            title="Verify asset marker & LOTO checklist"
          >
            <QrCode size={13} />
            <span>Verify</span>
          </button>
          {onClose && (
            <button
              className="btn btn-sm btn-icon"
              onClick={onClose}
              title="Collapse Inspector (give 3D viewport maximum width)"
              style={{ marginLeft: '4px' }}
            >
              <PanelRightClose size={13} />
            </button>
          )}
        </div>

        <div className="inspector-desc">
          {selectedAsset.service_description} ({humanize(selectedAsset.subtype)})
        </div>

        <div className="inspector-meta">
          <span>{selectedAsset.area_name}</span>
          <span>•</span>
          <span className="mono">{selectedAsset.line_id}</span>
          <span>•</span>
          <span className="mono">{selectedAsset.qr_id}</span>
          {cvObj?.object_id && (
            <>
              <span>•</span>
              <span className="mono" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                {cvObj.object_id}
              </span>
            </>
          )}
        </div>

        {/* Part-matched transparent image (from Valmet Excel class) */}
        {(() => {
          const spec = getPartVisualSpec(selectedAsset);
          const rec = EXCEL_ASSET_RECORDS[selectedAsset.asset_id];
          return (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 6,
                textAlign: 'center',
                background: 'radial-gradient(circle at center, rgba(0,242,255,0.14), rgba(3,12,22,0.85))',
                border: '1px solid rgba(0,242,255,0.35)'
              }}
            >
              <img
                src={spec.transparentImg + '?v=2'}
                alt={rec?.excel_item_name || selectedAsset.tag}
                style={{ maxWidth: '100%', maxHeight: 150, objectFit: 'contain' }}
              />
              <div className="mono" style={{ fontSize: 10.5, color: '#7dd3fc', marginTop: 4 }}>
                {rec?.excel_item_name || `${selectedAsset.tag} · ${spec.itemTypeName}`}
                {rec?.scene_path ? ` · ${rec.scene_path}` : ''}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ==================== INSPECTOR TABS ==================== */}
      <div className="tabs" role="tablist">
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'diagnosis', label: 'Diagnosis' },
          { key: 'telemetry', label: 'Telemetry' },
          {
            key: 'procedure',
            label: `LOTO (${completedSteps}/${totalSteps})`
          }
        ].map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ==================== TAB BODY ==================== */}
      <div className="panel-body">
        {activeTab === 'overview' && (
          <>
            {/* 1. Executive Summary (Condition / Cause / Next Action) */}
            <div className="section">
              <div className="section-title">
                <span>Condition Summary</span>
                <span className={`health ${st.cls} mono`}>
                  Health {selectedAsset.health_score}/100
                </span>
              </div>
              <div className="summary">
                <div className="summary-item">
                  <span className="k">Condition</span>
                  <span className="v">
                    <strong>{humanize(selectedAsset.status_reason)}</strong>
                  </span>
                </div>
                {rootCauseStep && (
                  <div className="summary-item">
                    <span className="k">Probable cause</span>
                    <span className="v">
                      <strong>{rootCauseStep.title}</strong>
                      {rootCauseStep.detail}
                    </span>
                  </div>
                )}
                {actionStep && (
                  <div className="summary-item">
                    <span className="k">Next action</span>
                    <span className="v">
                      <strong>{actionStep.title}</strong>
                      {actionStep.detail}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Computer Vision 3DGS Binding & Video Evidence Crop (from ahmad_branch) */}
            {cvObj && (
              <div className="section stack">
                <div className="section-title">
                  <span>
                    <Box size={12} style={{ marginRight: '4px', verticalAlign: '-1px' }} />
                    CV 3DGS Segmentation &amp; Binding
                  </span>
                  <span className="status info mono">
                    {cvObj.object_id} · {humanize(cvObj.mapping_method)}
                  </span>
                </div>

                {cvEvidencePhoto && (
                  <div className="cv-evidence-card">
                    <div className="cv-evidence-head">
                      <Camera size={12} />
                      <span>COLMAP Video Evidence Projection ({cvObj.object_id})</span>
                      {cvObj.evidence_frames?.[0] && (
                        <span className="mono muted" style={{ marginLeft: 'auto' }}>
                          {cvObj.evidence_frames[0]}
                        </span>
                      )}
                    </div>
                    <img
                      src={cvEvidencePhoto}
                      alt={`CV Video Evidence for ${selectedAsset.tag} (${cvObj.object_id})`}
                      className="cv-evidence-img"
                    />
                    {cvObj.mapping_notes && (
                      <div className="cv-evidence-notes">{cvObj.mapping_notes}</div>
                    )}
                  </div>
                )}

                <dl className="kv">
                  <dt>3D Object ID</dt>
                  <dd className="mono">{cvObj.object_id}</dd>
                  <dt>Detected CV Class</dt>
                  <dd>
                    {humanize(cvObj.detected_class)} (conf{' '}
                    {Math.round((cvObj.class_confidence || 0.75) * 100)}%)
                  </dd>
                  <dt>Gaussian Splats</dt>
                  <dd className="mono">
                    {(cvObj.splat_count || 0).toLocaleString()} splats ·{' '}
                    {(cvObj.voxel_count || 0).toLocaleString()} voxels
                  </dd>
                  <dt>Mapping Method</dt>
                  <dd>{humanize(cvObj.mapping_method)}</dd>
                </dl>

                {onOpenCvReview && (
                  <button
                    className="btn btn-sm btn-block"
                    onClick={() => onOpenCvReview(cvObj.object_id)}
                  >
                    <Camera size={12} />
                    <span>Inspect / Rebind in CV Detection Review</span>
                  </button>
                )}
              </div>
            )}

            {/* 3. 3D Geometry & Attachment Seam Preview */}
            <div className="section stack">
              <div className="section-title">
                <span>Extracted 3D Geometry</span>
                <span className="mono">
                  {selectedAsset.located === false
                    ? 'Not located'
                    : humanize(selectedAsset.contourModel?.attachmentType)}
                </span>
              </div>
              {selectedAsset.located === false ? (
                <div className="text-2" style={{ fontSize: '12px' }}>
                  Not located in this scan. The workbook Scene_Anchors coordinates are placeholders,
                  and no reviewed object in the Equipment Room scan carries this tag.
                </div>
              ) : (
                <AssetContourMiniViewer asset={selectedAsset} />
              )}
              {selectedAsset.location_kind === 'parent_assembly' && (
                <div className="text-2" style={{ fontSize: '12px' }}>
                  Shown on its parent assembly ({selectedAsset.cvObject?.object_id}), not the sensor body.
                </div>
              )}
            </div>

            {/* 4. Process Topology */}
            <div className="section stack">
              <div className="section-title">
                <span>Process Coupling</span>
                <span className="mono">{selectedAsset.line_id}</span>
              </div>
              <div className="topology">
                <div
                  className="node"
                  style={{ cursor: upstreamTarget ? 'pointer' : 'default' }}
                  onClick={() => upstreamTarget && onSelectAsset(upstreamTarget)}
                  title={selectedAsset.upstream_asset}
                >
                  <div className="k">Upstream</div>
                  <div className="v">{selectedAsset.upstream_asset}</div>
                </div>
                <div className="arrow">→</div>
                <div className="node current" title={selectedAsset.service_description}>
                  <div className="k">Selected</div>
                  <div className="v">{selectedAsset.tag}</div>
                </div>
                <div className="arrow">→</div>
                <div
                  className="node"
                  style={{ cursor: downstreamTarget ? 'pointer' : 'default' }}
                  onClick={() => downstreamTarget && onSelectAsset(downstreamTarget)}
                  title={selectedAsset.downstream_asset}
                >
                  <div className="k">Downstream</div>
                  <div className="v">{selectedAsset.downstream_asset}</div>
                </div>
              </div>
            </div>

            {/* 5. Engineering Properties */}
            <div className="section">
              <div className="section-title">
                <span>Engineering &amp; Spatial Metadata</span>
              </div>
              <dl className="kv">
                <dt>Asset ID</dt>
                <dd className="mono">{selectedAsset.asset_id}</dd>
                <dt>Equipment class</dt>
                <dd>{humanize(selectedAsset.asset_class)}</dd>
                <dt>Subtype</dt>
                <dd>{humanize(selectedAsset.subtype)}</dd>
                <dt>Area / Zone</dt>
                <dd title={selectedAsset.area_name}>{selectedAsset.area_name}</dd>
                <dt>3D Coordinates</dt>
                <dd className="mono">
                  {selectedAsset.located === false
                    ? 'Not located in scan'
                    : `[${selectedAsset.position.map((v) => v.toFixed(2)).join(', ')} m]`}
                </dd>
                {selectedAsset.located !== false && (
                  <>
                    <dt>Bounding box</dt>
                    <dd className="mono">
                      {selectedAsset.bbox_size.map((v) => v.toFixed(2)).join(' × ')} m
                    </dd>
                    <dt>Rear datum plane</dt>
                    <dd className="mono">
                      [{selectedAsset.contourModel?.backPlane?.center?.join(', ')} m]
                    </dd>
                  </>
                )}
                <dt>Field marker</dt>
                <dd className="mono">
                  {selectedAsset.qr_id} ({selectedAsset.connectivity_profile})
                </dd>
              </dl>
            </div>
          </>
        )}

        {activeTab === 'diagnosis' && (
          <>
            <div className="section">
              <div className="section-title">
                <span>Diagnostic Causal Chain</span>
                <span className="mono">{selectedAsset.tag}</span>
              </div>

              <ol className="steps">
                {selectedAsset.decision_tree.map((node) => (
                  <li key={node.step}>
                    <div className="k">{humanize(node.node)}</div>
                    <div className="t">{node.title}</div>
                    <div className="d">{node.detail}</div>
                  </li>
                ))}
              </ol>
            </div>

            {selectedAsset.work_order && (
              <div className="section stack">
                <div className="section-title">
                  <span>Associated Work Order</span>
                  <span className={`status ${st.cls}`}>
                    {selectedAsset.work_order.priority}
                  </span>
                </div>
                <div className="notice warn">
                  <div className="notice-title">
                    <Wrench size={14} />
                    <span className="mono">{selectedAsset.work_order.wo_id}</span>
                    <span>•</span>
                    <span>{humanize(selectedAsset.work_order.failure_code)}</span>
                  </div>
                  <div>{selectedAsset.work_order.summary}</div>
                </div>
              </div>
            )}

            <div className="section stack">
              <div className="section-title">
                <span>Evidence &amp; Reference Documents</span>
              </div>
              <div className="ref-list">
                {selectedAsset.doc_refs?.map((docId) => (
                  <span key={docId} className="ref">
                    <FileText size={11} style={{ marginRight: '4px', verticalAlign: '-1px' }} />
                    {docId}
                  </span>
                ))}
                {selectedAsset.event_refs?.map((evtId) => (
                  <span key={evtId} className="ref">
                    {evtId}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'telemetry' && (
          <>
            <div className="section stack">
              <div className="section-title">
                <span>Live Historian Values</span>
                <span className="mono">Updated {pipelineMeta?.lastUpdated}</span>
              </div>

              <div className="metric-grid">
                {Object.entries(selectedAsset.telemetry).map(([key, val]) => {
                  const unit = telemetryUnit(key);
                  return (
                    <div key={key} className="metric">
                      <div className="k">{telemetryLabel(key)}</div>
                      <div className="v mono">
                        {val}
                        {unit && <small>{unit}</small>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="section stack">
              <div className="section-title">
                <span>Simulation Override ({selectedAsset.tag})</span>
                <span className="mono">Rev. {pipelineMeta?.version || 1}</span>
              </div>
              <p className="help">
                Adjusting process parameters recalculates asset health and updates autonomous
                fleet dispatch in real time.
              </p>

              <div>
                <div className="field-label">
                  <span>Vibration (mm/s RMS)</span>
                  <span className="mono">
                    {selectedAsset.telemetry.vibration_mms ?? 2.1} mm/s
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="9.5"
                  step="0.1"
                  value={selectedAsset.telemetry.vibration_mms ?? 2.1}
                  onChange={(e) =>
                    onMutateTelemetry(selectedAsset.asset_id, {
                      vibration_mms: Number(e.target.value)
                    })
                  }
                />
              </div>

              <div>
                <div className="field-label">
                  <span>Bearing / body temperature (°C)</span>
                  <span className="mono">
                    {selectedAsset.telemetry.bearing_temp_c ??
                      selectedAsset.telemetry.temperature_c ??
                      55}{' '}
                    °C
                  </span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="95"
                  step="0.5"
                  value={
                    selectedAsset.telemetry.bearing_temp_c ??
                    selectedAsset.telemetry.temperature_c ??
                    55
                  }
                  onChange={(e) =>
                    onMutateTelemetry(selectedAsset.asset_id, {
                      bearing_temp_c: Number(e.target.value),
                      temperature_c: Number(e.target.value)
                    })
                  }
                />
              </div>

              <div className="row" style={{ marginTop: '4px' }}>
                <button
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                  onClick={() =>
                    onMutateTelemetry(
                      selectedAsset.asset_id,
                      {
                        vibration_mms: 7.4,
                        bearing_temp_c: 84.5,
                        stiction_index: 0.62,
                        position_pct: (selectedAsset.telemetry.setpoint_pct || 65) - 12.5
                      },
                      'EMERGENCY_SPIKE_INJECTED'
                    )
                  }
                >
                  Inject Fault Spike
                </button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={() =>
                    onMutateTelemetry(
                      selectedAsset.asset_id,
                      {
                        vibration_mms: 1.8,
                        bearing_temp_c: 58.0,
                        stiction_index: 0.14,
                        position_pct: selectedAsset.telemetry.setpoint_pct || 64.0
                      },
                      'NORMAL_OPERATION'
                    )
                  }
                >
                  Restore Nominal
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'procedure' && (
          <>
            <div className="section stack">
              <div className="section-title">
                <span>Isolation &amp; Calibration (LOTO)</span>
                <span className="mono">
                  {completedSteps}/{totalSteps} verified
                </span>
              </div>

              <div className="progress">
                <div style={{ width: `${progressPct}%` }} />
              </div>

              <ul className="checklist">
                {selectedAsset.loto_checklist.map((stepText, idx) => {
                  const stepKey = `${selectedAsset.asset_id}-${idx}`;
                  const isDone = Boolean(checkedLotoSteps[stepKey]);
                  return (
                    <li
                      key={stepKey}
                      className={isDone ? 'done' : ''}
                      onClick={() => onToggleLotoStep(stepKey)}
                    >
                      <input type="checkbox" checked={isDone} onChange={() => {}} />
                      <span>{stepText}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="section stack">
              <div className="section-title">
                <span>Maintenance Dispatch</span>
              </div>

              <button
                className="btn btn-primary btn-block"
                onClick={() => onDraftWorkOrder(selectedAsset)}
              >
                <Wrench size={13} />
                <span>Queue Work Order in SAP PM</span>
              </button>

              <button className="btn btn-block" onClick={onOpenArHud}>
                <QrCode size={13} />
                <span>Open Field Verification ({selectedAsset.qr_id})</span>
              </button>

              {draftedWoBanner && (
                <div className="notice ok">
                  <div className="notice-title">
                    <CheckCircle2 size={14} />
                    <span>Queued: {draftedWoBanner.id}</span>
                  </div>
                  <div>{draftedWoBanner.message}</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
