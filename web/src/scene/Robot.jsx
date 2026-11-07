import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { STATUS_HEX } from "../ui/status.js";
import { PROXIMITY } from "./mission.js";
import { runtime } from "./missionRuntime.js";

const ROBOT_RADIUS_M = 0.3;
const TRAIL_LIFT = 0.012;
const SCAN_RANGE_M = PROXIMITY.enterM * 0.6;
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Raw PLY frame is y-down, so "up" is -y.
function liftedPositions(samples, lift) {
  const out = new Float32Array(samples.length * 3);
  samples.forEach((s, i) => out.set([s.pos[0], s.pos[1] - lift, s.pos[2]], i * 3));
  return out;
}

function fatLine(positions, { colour, width, opacity, dashed = false, renderOrder }) {
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color: colour,
    linewidth: width,
    transparent: true,
    opacity,
    depthWrite: false,
    dashed,
    dashSize: 0.04,
    gapSize: 0.03,
  });
  const line = new Line2(geometry, material);
  if (dashed) line.computeLineDistances();
  line.renderOrder = renderOrder;
  line.frustumCulled = false;
  return line;
}

// Procedural robot sized to the planning radius. Built with +y up and +z
// forward; the parent flips it into the y-down raw frame.
function RobotBody({ unit }) {
  const r = ROBOT_RADIUS_M * unit;
  const accent = STATUS_HEX.accent;
  return (
    <group rotation={[0, 0, Math.PI]}>
      <mesh position={[0, r * 0.12, 0]}>
        <cylinderGeometry args={[r * 0.82, r * 0.9, r * 0.24, 40]} />
        <meshStandardMaterial color="#1b232e" metalness={0.4} roughness={0.55} />
      </mesh>
      <mesh position={[0, r * 0.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r * 0.84, r * 0.035, 8, 48]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} />
      </mesh>
      <mesh position={[0, r * 0.5, 0]}>
        <cylinderGeometry args={[r * 0.5, r * 0.62, r * 0.5, 32]} />
        <meshStandardMaterial color="#c9d3df" metalness={0.2} roughness={0.45} />
      </mesh>
      <mesh position={[0, r * 0.76, 0]}>
        <cylinderGeometry args={[r * 0.5, r * 0.5, r * 0.04, 32]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, r * 1.0, 0]}>
        <cylinderGeometry args={[r * 0.06, r * 0.08, r * 0.45, 12]} />
        <meshStandardMaterial color="#2d3a49" />
      </mesh>
      <group position={[0, r * 1.28, 0]}>
        <mesh>
          <sphereGeometry args={[r * 0.24, 24, 16]} />
          <meshStandardMaterial color="#232d3a" metalness={0.35} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, r * 0.2]}>
          <boxGeometry args={[r * 0.3, r * 0.1, r * 0.1]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={2} />
        </mesh>
      </group>
      <mesh position={[0, r * 0.26, r * 0.78]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[r * 0.14, r * 0.26, 3]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

export function Robot({ nav, metresPerUnit = 1 }) {
  const unit = 1 / metresPerUnit;
  const robotRef = useRef();
  const pulseRef = useRef();
  const lastIndex = useRef(-1);

  const lines = useMemo(() => {
    const positions = liftedPositions(nav.samples, TRAIL_LIFT);
    return {
      segments: nav.samples.length - 1,
      route: fatLine(positions, { colour: STATUS_HEX.accent, width: 2, opacity: 0.7, dashed: true, renderOrder: 11 }),
      glow: fatLine(positions, { colour: STATUS_HEX.accent, width: 9, opacity: 0.18, renderOrder: 12 }),
      trail: fatLine(positions, { colour: STATUS_HEX.accent, width: 3, opacity: 0.95, renderOrder: 13 }),
    };
  }, [nav]);

  useEffect(
    () => () => {
      for (const key of ["route", "glow", "trail"]) {
        lines[key].geometry.dispose();
        lines[key].material.dispose();
      }
    },
    [lines],
  );

  const sector = useMemo(() => {
    const radius = SCAN_RANGE_M * unit;
    const geometry = new THREE.CircleGeometry(radius, 40, Math.PI / 4, Math.PI / 2);
    // Fade from the robot outwards through vertex alpha.
    const colours = new Float32Array((geometry.attributes.position.count) * 4);
    const base = new THREE.Color(STATUS_HEX.accent);
    for (let i = 0; i < geometry.attributes.position.count; i += 1) {
      const x = geometry.attributes.position.getX(i);
      const y = geometry.attributes.position.getY(i);
      const f = 1 - Math.hypot(x, y) / radius;
      colours.set([base.r, base.g, base.b, 0.05 + 0.3 * f], i * 4);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 4));
    return geometry;
  }, [unit]);

  useFrame((state) => {
    const robot = robotRef.current;
    if (!robot) return;
    const { pos, yaw, index } = runtime.pose;
    robot.position.set(pos[0], pos[1], pos[2]);
    robot.rotation.y = yaw;

    const travelled = runtime.state === "idle" || runtime.state === "dispatched" ? 0 : Math.min(index + 1, lines.segments);
    if (travelled !== lastIndex.current) {
      lastIndex.current = travelled;
      lines.trail.geometry.instanceCount = travelled;
      lines.glow.geometry.instanceCount = travelled;
    }

    const pulse = pulseRef.current;
    if (pulse) {
      const moving = runtime.state === "en_route" || runtime.state === "approaching" || runtime.state === "dispatched";
      const phase = reducedMotion ? 0.6 : (state.clock.elapsedTime * (moving ? 0.9 : 0.4)) % 1;
      const scale = 1 + phase * 1.4;
      pulse.scale.set(scale, scale, scale);
      pulse.material.opacity = (1 - phase) * (moving ? 0.55 : 0.25);
    }
  });

  return (
    <>
      <primitive object={lines.route} />
      <primitive object={lines.glow} />
      <primitive object={lines.trail} />
      <group ref={robotRef}>
        <RobotBody unit={unit} />
        {/* Floor decals sit just above the floor (raw -y is up). */}
        <mesh geometry={sector} position={[0, -TRAIL_LIFT * 1.5, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={12}>
          <meshBasicMaterial vertexColors transparent depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={pulseRef} position={[0, -TRAIL_LIFT, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={12}>
          <ringGeometry args={[ROBOT_RADIUS_M * unit * 0.95, ROBOT_RADIUS_M * unit * 1.02, 48]} />
          <meshBasicMaterial color={STATUS_HEX.accent} transparent depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}
