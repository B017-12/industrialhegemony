import React, { useMemo, useState } from 'react';
import { getPartVisualSpec } from '../data/excelPartCatalog.js';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Camera,
  Check,
  Download,
  Eye,
  Link2,
  Merge,
  Play,
  RotateCcw,
  Square,
  Tag
} from 'lucide-react';
import {
  INSTANCE_CLASSES,
  EVIDENCE_PHOTO_MAP,
  buildCvReviewQueue,
  nearestCvNeighbours,
  computeMergedObbOverride
} from '../utils/cvEngine.js';
import { humanize } from '../ui/status.js';

export default function CvReviewPanel({
  cvSceneObjects,
  cvMetrics,
  evidenceFrames = {},
  assets = [],
  selectedCvObjectId,
  onSelectCvObject,
  onSelectAsset,
  showAllCvDetections,
  onToggleShowAllCvDetections,
  onPatchCvOverride,
  onResetCvOverrides
}) {
  const [filterGroup, setFilterGroup] = useState('all'); // 'all' | 'video_evidence' | 'bound' | 'equipment'
  const [rebindAssetId, setRebindAssetId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [tourPlaying, setTourPlaying] = useState(false);
  const [showDiagModal, setShowDiagModal] = useState(false);

  const objects = cvSceneObjects?.objects || [];
  const queue = useMemo(() => buildCvReviewQueue(objects), [objects]);

  const filteredQueue = useMemo(() => {
    if (filterGroup === 'all') return queue;
    return queue.filter((q) => q.group === filterGroup);
  }, [queue, filterGroup]);

  const currentIdx = useMemo(() => {
    if (!filteredQueue.length) return 0;
    const idx = filteredQueue.findIndex((q) => q.objectId === selectedCvObjectId);
    return idx >= 0 ? idx : 0;
  }, [filteredQueue, selectedCvObjectId]);

  const currentItem = filteredQueue[currentIdx] || queue[0] || null;
  const activeObj = currentItem?.object || null;

  const neighbours = useMemo(
    () => (activeObj ? nearestCvNeighbours(activeObj, objects, 4) : []),
    [activeObj, objects]
  );

  // Auto-advance 3D Crop Tour timer when active
  React.useEffect(() => {
    if (!tourPlaying || !filteredQueue.length) return;
    const timer = setInterval(() => {
      const nextIdx = (currentIdx + 1) % filteredQueue.length;
      const nextItem = filteredQueue[nextIdx];
      if (nextItem) {
        onSelectCvObject(nextItem.object);
      }
    }, 2800);
    return () => clearInterval(timer);
  }, [tourPlaying, currentIdx, filteredQueue, onSelectCvObject]);

  const selectByIndex = (idx) => {
    if (!filteredQueue.length) return;
    const wrapped = (idx + filteredQueue.length) % filteredQueue.length;
    const item = filteredQueue[wrapped];
    if (item) {
      onSelectCvObject(item.object);
      if (item.object.asset_id) {
        onSelectAsset(item.object.asset_id);
      }
    }
  };

  const handleConfirm = () => {
    if (!activeObj) return;
    onPatchCvOverride({
      [activeObj.object_id]: {
        review_status: 'confirmed',
        label_source: 'human',
        reviewer: 'M. Virtanen',
        class_confidence: 0.95
      }
    });
    selectByIndex(currentIdx + 1);
  };

  const handleRelabelClass = (newClass) => {
    if (!activeObj) return;
    onPatchCvOverride({
      [activeObj.object_id]: {
        class: newClass,
        display_label: humanize(newClass),
        review_status: 'relabelled',
        label_source: 'human',
        reviewer: 'M. Virtanen',
        class_confidence: 0.92
      }
    });
  };

  const handleBindAsset = () => {
    if (!activeObj || !rebindAssetId) return;
    const patch = {
      [activeObj.object_id]: {
        asset_id: rebindAssetId,
        mapping_method: 'human_pinned',
        mapping_confidence: 0.95,
        review_status: 'confirmed',
        label_source: 'human',
        reviewer: 'M. Virtanen'
      }
    };
    // Unbind any previous object that held this asset_id
    objects.forEach((o) => {
      if (o.asset_id === rebindAssetId && o.object_id !== activeObj.object_id) {
        patch[o.object_id] = {
          asset_id: null,
          mapping_method: null
        };
      }
    });
    onPatchCvOverride(patch);
    onSelectAsset(rebindAssetId);
  };

  const handleMergeWithNeighbour = () => {
    const targetId = mergeTargetId || neighbours[0]?.object?.object_id;
    if (!activeObj || !targetId) return;
    const sec = objects.find((o) => o.object_id === targetId);
    if (!sec) return;
    const mergePatch = computeMergedObbOverride(activeObj, sec, 'M. Virtanen');
    onPatchCvOverride(mergePatch);
  };

  const handleReject = () => {
    if (!activeObj) return;
    onPatchCvOverride({
      [activeObj.object_id]: {
        review_status: 'rejected',
        label_source: 'human',
        reviewer: 'M. Virtanen'
      }
    });
    selectByIndex(currentIdx + 1);
  };

  const handleExportOverrides = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(
        JSON.stringify(
          {
            schema_version: '1.0',
            exported_at: new Date().toISOString(),
            total_objects: objects.length,
            bound_objects: objects.filter((o) => o.asset_id).map((o) => ({
              object_id: o.object_id,
              asset_id: o.asset_id,
              class: o.class,
              mapping_method: o.mapping_method,
              review_status: o.review_status
            }))
          },
          null,
          2
        )
      );
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = 'labels_override_export.json';
    a.click();
  };

  const reviewedCount = queue.filter((q) => q.reviewed).length;
  const boundCount = objects.filter((o) => o.asset_id).length;
  const evidencePhoto = activeObj ? EVIDENCE_PHOTO_MAP[activeObj.object_id] : null;
  const frameList = activeObj ? evidenceFrames[activeObj.object_id] || [] : [];
  const boundAsset = activeObj?.asset_id
    ? assets.find((a) => a.asset_id === activeObj.asset_id)
    : null;

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">CV 3D Detection &amp; Labeling</span>
        <span className="panel-count">{objects.length} OBBs</span>
      </div>

      <div className="panel-toolbar stack" style={{ gap: '8px' }}>
        <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
          <div className="metric" style={{ padding: '6px 8px' }}>
            <div className="k">3DGS Splats</div>
            <div className="v mono" style={{ fontSize: '12px' }}>
              {(cvMetrics?.filter?.kept || 820511).toLocaleString()}
            </div>
          </div>
          <div className="metric" style={{ padding: '6px 8px' }}>
            <div className="k">3D OBBs</div>
            <div className="v mono" style={{ fontSize: '12px' }}>
              {objects.length} ({boundCount} bound)
            </div>
          </div>
          <div className="metric" style={{ padding: '6px 8px' }}>
            <div className="k">Reviewed</div>
            <div className="v mono" style={{ fontSize: '12px' }}>
              {reviewedCount}/{queue.length}
            </div>
          </div>
        </div>

        <label className="check" style={{ fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={showAllCvDetections}
            onChange={(e) => onToggleShowAllCvDetections(e.target.checked)}
          />
          <span>
            Show all {objects.length} CV-detected OBBs in 3D (off = 30 bound only)
          </span>
        </label>

        <div className="seg" role="tablist" aria-label="Filter CV detection queue">
          {[
            { key: 'all', label: 'All', count: queue.length },
            {
              key: 'video_evidence',
              label: 'Video Crops',
              count: queue.filter((q) => q.group === 'video_evidence').length
            },
            {
              key: 'bound',
              label: 'Bound',
              count: queue.filter((q) => q.group === 'bound').length
            },
            {
              key: 'equipment',
              label: 'Unbound',
              count: queue.filter((q) => q.group === 'equipment').length
            }
          ].map((tab) => (
            <button
              key={tab.key}
              className={filterGroup === tab.key ? 'active' : ''}
              onClick={() => setFilterGroup(tab.key)}
            >
              <span>{tab.label}</span>
              <span className="count">{tab.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-body">
        {/* 1. CROP TOUR NAVIGATION BAR */}
        <div className="section stack">
          <div className="section-title">
            <span>
              3D OBB Crop Tour ({currentIdx + 1} of {filteredQueue.length})
            </span>
            <button
              className={`btn btn-sm ${tourPlaying ? 'btn-primary' : ''}`}
              onClick={() => setTourPlaying((p) => !p)}
              title="Automatically fly camera from one CV-detected 3D OBB to the next"
            >
              {tourPlaying ? <Square size={11} /> : <Play size={11} />}
              <span>{tourPlaying ? 'Stop Tour' : 'Auto Crop Tour'}</span>
            </button>
          </div>

          <div className="row" style={{ gap: '6px' }}>
            <button
              className="btn btn-sm"
              style={{ flex: 1 }}
              onClick={() => selectByIndex(currentIdx - 1)}
            >
              <ArrowLeft size={12} />
              <span>Prev OBB</span>
            </button>
            <button
              className="btn btn-sm btn-primary"
              style={{ flex: 1 }}
              onClick={handleConfirm}
              title="Confirm CV segmentation box and advance to next"
            >
              <Check size={12} />
              <span>Confirm Box</span>
            </button>
            <button
              className="btn btn-sm"
              style={{ flex: 1 }}
              onClick={() => selectByIndex(currentIdx + 1)}
            >
              <span>Next OBB</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {/* 2. ACTIVE 3D OBJECT DETAILS & CAMERA EVIDENCE CROP */}
        {activeObj && (
          <div className="section stack">
            <div className="row" style={{ gap: '6px' }}>
              <span className="mono" style={{ fontWeight: 700, fontSize: '13px' }}>
                {activeObj.object_id}
              </span>
              <span className="status info">
                {humanize(activeObj.class)} · {Math.round((activeObj.class_confidence || 0.75) * 100)}%
              </span>
              {activeObj.review_status && (
                <span className="status ok">{humanize(activeObj.review_status)}</span>
              )}
              <span className="spacer" />
              <span className="mono muted">{(activeObj.splat_count || 0).toLocaleString()} splats</span>
            </div>

            {boundAsset ? (
              <div
                className="notice ok"
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectAsset(boundAsset)}
              >
                <div className="notice-title">
                  <Link2 size={13} />
                  <span>
                    Bound to <strong>{boundAsset.tag}</strong> ({boundAsset.asset_id})
                  </span>
                  <span className="mono" style={{ marginLeft: 'auto', fontSize: '10.5px' }}>
                    {humanize(activeObj.mapping_method || 'procedural')}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px' }}>{boundAsset.service_description}</div>
              </div>
            ) : (
              <div className="help">
                Unbound 3D segmentation instance. You can bind it to any of the 30 Valmet assets below.
              </div>
            )}

            {/* Part-matched transparent image */}
            {(boundAsset || activeObj) && (
              <div style={{ textAlign: 'center', padding: 6, borderRadius: 6, background: 'radial-gradient(circle at center, rgba(0,242,255,0.14), rgba(3,12,22,0.85))', border: '1px solid rgba(0,242,255,0.35)' }}>
                <img
                  src={getPartVisualSpec(boundAsset || activeObj).transparentImg + '?v=2'}
                  alt={boundAsset?.tag || activeObj.object_id}
                  style={{ maxWidth: '100%', maxHeight: 120, objectFit: 'contain' }}
                />
              </div>
            )}
            {/* Video Evidence Photo Crop (from COLMAP-aligned walkthrough frames) */}
            {evidencePhoto ? (
              <div className="cv-evidence-card">
                <div className="cv-evidence-head">
                  <Camera size={12} />
                  <span>COLMAP Video Frame Projection ({activeObj.object_id})</span>
                  {frameList.length > 0 && (
                    <span className="mono muted" style={{ marginLeft: 'auto' }}>
                      {frameList[0]}
                    </span>
                  )}
                </div>
                <img
                  src={evidencePhoto}
                  alt={`Projected 3D OBB ${activeObj.object_id} on video frame`}
                  className="cv-evidence-img"
                />
                {activeObj.mapping_notes && (
                  <div className="cv-evidence-notes">{activeObj.mapping_notes}</div>
                )}
              </div>
            ) : (
              <div className="cv-evidence-card">
                <div className="cv-evidence-head">
                  <Eye size={12} />
                  <span>HDBSCAN + Pipe-RANSAC 3D Segmentation Overview</span>
                  <button
                    className="btn btn-sm"
                    style={{ marginLeft: 'auto', height: '20px', padding: '0 6px', fontSize: '10px' }}
                    onClick={() => setShowDiagModal((s) => !s)}
                  >
                    {showDiagModal ? 'Front OBBs' : 'Before / After'}
                  </button>
                </div>
                <img
                  src={
                    showDiagModal
                      ? '/assets/evidence/before_after.png'
                      : '/assets/evidence/boxes_front.png'
                  }
                  alt="3D OBB segmentation diagnostic projection"
                  className="cv-evidence-img"
                />
              </div>
            )}

            {/* 3. RELABEL DETECTED CLASS */}
            <div>
              <div className="field-label">
                <span>
                  <Tag size={11} style={{ marginRight: '4px', verticalAlign: '-1px' }} />
                  Relabel 3D Instance Class
                </span>
                <span className="mono">{activeObj.class}</span>
              </div>
              <div className="cv-class-grid">
                {INSTANCE_CLASSES.map((cls) => (
                  <button
                    key={cls}
                    className={`btn btn-sm ${activeObj.class === cls ? 'btn-primary' : ''}`}
                    onClick={() => handleRelabelClass(cls)}
                  >
                    {cls}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. BIND / REBIND TO VALMET ASSET */}
            <div>
              <div className="field-label">
                <span>Bind / Rebind to Valmet Asset</span>
              </div>
              <div className="row" style={{ gap: '6px' }}>
                <select
                  className="select"
                  style={{ flex: 1 }}
                  value={rebindAssetId || activeObj.asset_id || ''}
                  onChange={(e) => setRebindAssetId(e.target.value)}
                >
                  <option value="">Select asset to bind...</option>
                  {assets.map((a) => (
                    <option key={a.asset_id} value={a.asset_id}>
                      {a.tag} ({a.asset_id}) — {a.service_description}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!rebindAssetId}
                  onClick={handleBindAsset}
                >
                  <Link2 size={12} />
                  <span>Bind</span>
                </button>
              </div>
            </div>

            {/* 5. MERGE FRAGMENTED NEIGHBOUR OBB OR REJECT */}
            <div>
              <div className="field-label">
                <span>Merge Split Neighbour OBB</span>
              </div>
              <div className="row" style={{ gap: '6px' }}>
                <select
                  className="select"
                  style={{ flex: 1 }}
                  value={mergeTargetId || neighbours[0]?.object?.object_id || ''}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                >
                  {neighbours.map((n) => (
                    <option key={n.object.object_id} value={n.object.object_id}>
                      {n.object.object_id} ({n.object.class} · {n.distanceMeters} m away)
                    </option>
                  ))}
                </select>
                <button className="btn btn-sm" onClick={handleMergeWithNeighbour}>
                  <Merge size={12} />
                  <span>Merge</span>
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={handleReject}
                  title="Reject and hide noisy segmentation box"
                >
                  <Ban size={12} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 6. OBJECT DETECTION QUEUE TABLE */}
        <div className="section" style={{ padding: 0 }}>
          <div className="section-title" style={{ padding: '10px 12px 4px' }}>
            <span>Segmented 3D Objects ({filteredQueue.length})</span>
            <div className="row" style={{ gap: '4px' }}>
              <button
                className="btn btn-sm"
                onClick={handleExportOverrides}
                title="Export labels_override.json"
              >
                <Download size={11} />
                <span>Export</span>
              </button>
              <button
                className="btn btn-sm"
                onClick={onResetCvOverrides}
                title="Reset custom review edits"
              >
                <RotateCcw size={11} />
              </button>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '76px' }}>Object ID</th>
                <th style={{ width: '68px' }}>Class</th>
                <th>Binding / Evidence</th>
                <th className="right" style={{ width: '58px' }}>
                  Splats
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredQueue.slice(0, 80).map((item) => {
                const o = item.object;
                const isSel = activeObj?.object_id === o.object_id;
                const linkedAsset = o.asset_id
                  ? assets.find((a) => a.asset_id === o.asset_id)
                  : null;
                return (
                  <tr
                    key={o.object_id}
                    className={isSel ? 'selected' : ''}
                    onClick={() => {
                      onSelectCvObject(o);
                      if (o.asset_id) onSelectAsset(o.asset_id);
                    }}
                  >
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {o.object_id}
                    </td>
                    <td>{o.class}</td>
                    <td className="mono" style={{ fontSize: '11px' }}>
                      {linkedAsset ? (
                        <span style={{ color: 'var(--brand)', fontWeight: 600 }}>
                          {linkedAsset.tag} ({humanize(o.mapping_method || 'bound')})
                        </span>
                      ) : item.hasPhoto ? (
                        <span style={{ color: 'var(--info)' }}>Video Evidence Crop</span>
                      ) : (
                        <span className="muted">Unbound instance</span>
                      )}
                    </td>
                    <td className="right mono">{(o.splat_count || 0).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
