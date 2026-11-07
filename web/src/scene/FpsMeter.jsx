import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { useStore } from "../store.js";

const WINDOW_S = 0.5;

export function FpsMeter() {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, delta) => {
    const a = acc.current;
    a.frames += 1;
    a.time += delta;
    if (a.time < WINDOW_S) return;
    useStore.getState().setPerf({
      fps: Math.round(a.frames / a.time),
      frameMs: Math.round((a.time / a.frames) * 10000) / 10,
    });
    a.frames = 0;
    a.time = 0;
  });
  return null;
}
