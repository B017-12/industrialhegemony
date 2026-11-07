import React, { useEffect, useRef, useState } from 'react';
import { Layers, Maximize2, Minimize2 } from 'lucide-react';

const STATUS_DOT_COLORS = {
  attention_required: '#ef4444',
  degraded: '#f97316',
  watch: '#eab308',
  healthy: '#64748b'
};

/**
 * 2D Top-Down Floor Occupancy & ESDF Minimap (ported from ahmad_branch & enhanced with live multi-worker traffic).
 * World space mapping: x in [-4.5, 3.8], z in [-3.6, 3.6].
 */
export default function FloorMinimap({
  assets = [],
  selectedAsset,
  onSelectAsset,
  exerciseMode = true,
  exerciseWorkers = [],
  activePathPoints = [],
  cvObjectCount = 441
}) {
  const canvasRef = useRef(null);
  const bgImgRef = useRef(null);
  const esdfImgRef = useRef(null);
  const [mapMode, setMapMode] = useState('occupancy'); // 'occupancy' | 'esdf'
  const [collapsed, setCollapsed] = useState(false);

  const WIDTH = 208;
  const HEIGHT = 158;

  // Preload floor_occ.png and nav_esdf.png from ahmad_branch
  useEffect(() => {
    const occ = new Image();
    occ.src = '/assets/derived/floor_occ.png';
    occ.onload = () => {
      bgImgRef.current = occ;
    };
    occ.onerror = () => {
      occ.src = '/data/derived/floor_occ.png';
    };

    const esdf = new Image();
    esdf.src = '/assets/evidence/nav_esdf.png';
    esdf.onload = () => {
      esdfImgRef.current = esdf;
    };
  }, []);

  // World (x, z) -> Minimap canvas (px, py)
  const worldToPx = (x, z) => {
    const minX = -4.6;
    const maxX = 4.0;
    const minZ = -3.6;
    const maxZ = 3.8;
    const px = ((x - minX) / (maxX - minX)) * (WIDTH - 20) + 10;
    const py = ((maxZ - z) / (maxZ - minZ)) * (HEIGHT - 20) + 10;
    return [px, py];
  };

  useEffect(() => {
    if (collapsed) return;
    let animId;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      // 1. Background Occupancy / ESDF Map
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      const activeImg = mapMode === 'esdf' ? esdfImgRef.current : bgImgRef.current;
      if (activeImg) {
        ctx.save();
        ctx.globalAlpha = mapMode === 'esdf' ? 0.82 : 0.72;
        ctx.drawImage(activeImg, 4, 4, WIDTH - 8, HEIGHT - 8);
        ctx.restore();
      }

      // Subtle coordinate grid
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = 1;
      for (let gx = 26; gx < WIDTH; gx += 36) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, HEIGHT);
        ctx.stroke();
      }
      for (let gy = 24; gy < HEIGHT; gy += 34) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(WIDTH, gy);
        ctx.stroke();
      }

      // 2. Active navigation route or worker paths
      if (exerciseMode && exerciseWorkers.length > 0) {
        exerciseWorkers.forEach((w) => {
          if (w.state === 'STANDBY' || !w.pathPoints || w.pathPoints.length < 2) return;
          ctx.strokeStyle = w.color || '#38bdf8';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          w.pathPoints.forEach((pt, idx) => {
            const [px, py] = worldToPx(pt[0], pt[2]);
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.stroke();
        });
      } else if (activePathPoints && activePathPoints.length > 1) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        activePathPoints.forEach((pt, idx) => {
          const [px, py] = worldToPx(pt[0], pt[2]);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }

      // 3. Plot all 30 Bound Assets
      assets.forEach((asset) => {
        const [px, py] = worldToPx(asset.position[0], asset.position[2]);
        const isSel = selectedAsset?.asset_id === asset.asset_id;
        const isFault =
          asset.health_status === 'attention_required' || asset.health_status === 'degraded';

        ctx.fillStyle = STATUS_DOT_COLORS[asset.health_status] || '#64748b';
        ctx.beginPath();
        ctx.arc(px, py, isSel ? 4.2 : isFault ? 3.5 : 2.4, 0, Math.PI * 2);
        ctx.fill();

        if (isSel || isFault) {
          ctx.strokeStyle = isSel ? '#38bdf8' : '#fca5a5';
          ctx.lineWidth = isSel ? 1.8 : 1.1;
          ctx.beginPath();
          ctx.arc(px, py, isSel ? 6.8 : 5.4, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // 4. Plot Technicians & AMRs
      if (exerciseMode && exerciseWorkers.length > 0) {
        exerciseWorkers.forEach((w) => {
          const wpos = w.position || w.pos || [0, -1.02, -0.32];
          const [wx, wy] = worldToPx(wpos[0], wpos[2]);
          const angle = w.angle || 0;
          const fx = Math.sin(angle);
          const fy = -Math.cos(angle);

          ctx.fillStyle =
            w.trafficStatus === 'YIELDING'
              ? '#ef4444'
              : w.state === 'REPAIRING'
              ? '#22c55e'
              : w.color || '#38bdf8';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.2;

          ctx.beginPath();
          ctx.moveTo(wx + fx * 6.5, wy + fy * 6.5);
          ctx.lineTo(wx - fx * 3.5 - fy * 4, wy - fy * 3.5 + fx * 4);
          ctx.lineTo(wx - fx * 3.5 + fy * 4, wy - fy * 3.5 - fx * 4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [assets, selectedAsset, exerciseMode, exerciseWorkers, activePathPoints, mapMode, collapsed]);

  const handleCanvasClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    let bestAsset = null;
    let bestDist = 11;
    assets.forEach((asset) => {
      const [px, py] = worldToPx(asset.position[0], asset.position[2]);
      const d = Math.hypot(px - clickX, py - clickY);
      if (d < bestDist) {
        bestDist = d;
        bestAsset = asset;
      }
    });

    if (bestAsset && onSelectAsset) {
      onSelectAsset(bestAsset);
    }
  };

  if (collapsed) {
    return (
      <button
        className="minimap-collapsed-btn"
        onClick={() => setCollapsed(false)}
        title="Expand 2D Floor Occupancy & ESDF Minimap"
      >
        <Layers size={13} />
        <span>2D Floor Map ({cvObjectCount} OBBs)</span>
        <Maximize2 size={12} />
      </button>
    );
  }

  return (
    <figure className="floor-minimap" aria-label="2D Top-Down Floor Occupancy & ESDF Minimap">
      <figcaption className="floor-minimap-head">
        <span className="mono" style={{ fontWeight: 600, fontSize: '10.5px' }}>
          {mapMode === 'esdf' ? 'ESDF CLEARANCE MAP' : '2D FLOOR OCCUPANCY'}
        </span>
        <div className="row" style={{ gap: '4px' }}>
          <button
            className="minimap-mode-btn"
            onClick={() => setMapMode((m) => (m === 'occupancy' ? 'esdf' : 'occupancy'))}
            title="Switch between RANSAC Floor Occupancy and Euclidean Signed Distance Field (ESDF)"
          >
            {mapMode === 'occupancy' ? 'ESDF' : 'Occ'}
          </button>
          <button
            className="minimap-mode-btn"
            onClick={() => setCollapsed(true)}
            title="Minimize minimap"
          >
            <Minimize2 size={11} />
          </button>
        </div>
      </figcaption>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        onClick={handleCanvasClick}
        className="floor-minimap-canvas"
        title="Click any asset dot to inspect and focus in 3D"
      />
      <div className="floor-minimap-foot mono">
        <span>17.4 m² walkable</span>
        <span>·</span>
        <span>1.24 m/unit</span>
        <span style={{ marginLeft: 'auto' }}>23/30 reachable</span>
      </div>
    </figure>
  );
}
