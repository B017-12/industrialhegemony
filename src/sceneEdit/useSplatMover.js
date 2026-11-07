import { useEffect, useRef, useState } from 'react';
import { createSplatMover } from './splatMover.js';

/**
 * Owns the SplatMover for the lifetime of the viewport (not of a panel), waits for the Spark splat mesh, and
 * re-applies the committed edit log whenever it changes. Panels subscribe with setListener({onChange, onDragEnd}).
 */
export function useSplatMover(sceneCtx, edits, baseObjectsById) {
  const moverRef = useRef(null);
  const listenerRef = useRef({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!sceneCtx) return undefined;
    let mover = null;
    const poll = setInterval(() => {
      if (!sceneCtx.getSplatMesh?.()) return;
      clearInterval(poll);
      mover = createSplatMover(sceneCtx, {
        onChange: (d) => listenerRef.current.onChange?.(d),
        onDragEnd: (d) => listenerRef.current.onDragEnd?.(d)
      });
      moverRef.current = mover;
      setReady(true);
    }, 400);
    return () => {
      clearInterval(poll);
      mover?.dispose();
      moverRef.current = null;
      setReady(false);
    };
  }, [sceneCtx]);

  useEffect(() => {
    if (ready && moverRef.current && baseObjectsById) moverRef.current.applyEdits(edits || [], baseObjectsById);
  }, [ready, edits, baseObjectsById]);

  return {
    ready,
    mover: () => moverRef.current,
    setListener: (l) => {
      listenerRef.current = l || {};
    }
  };
}
