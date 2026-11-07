import { useFrame } from "@react-three/fiber";
import { SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType } from "@sparkjsdev/spark";
import { useEffect, useMemo } from "react";
import { floorHeight } from "./frame.js";

// The full-room splat is closed by its ceiling and overhead pipe band, so a
// camera above the ceiling (the overview) sees only that. While the camera is
// above it, every splat higher than CUT_FRACTION of the floor-to-ceiling
// height is faded out. Views from inside the room are untouched.
const CUT_FRACTION = 0.78;

export function CeilingCutaway({ sceneObjects }) {
  const { floorY, ceilingY } = useMemo(() => {
    const ceiling = sceneObjects.objects.find((o) => o.class === "ceiling");
    return { floorY: floorHeight(sceneObjects), ceilingY: ceiling ? -ceiling.center[1] : null };
  }, [sceneObjects]);

  const edit = useMemo(() => {
    const e = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, softEdge: 0.04 });
    // Plane SDF: inside is local z < 0. Rotating +90 degrees about X points local
    // +z down, so the inside is everything above the plane.
    const plane = new SplatEditSdf({ type: SplatEditSdfType.PLANE, opacity: 0 });
    plane.rotation.x = Math.PI / 2;
    e.add(plane);
    e.visible = false;
    return e;
  }, []);

  const cutY = ceilingY == null ? null : floorY + CUT_FRACTION * (ceilingY - floorY);
  useEffect(() => {
    if (cutY != null) edit.children[0].position.set(0, cutY, 0);
  }, [edit, cutY]);

  useFrame(({ camera }) => {
    const above = ceilingY != null && camera.position.y > ceilingY;
    if (edit.visible !== above) edit.visible = above;
  });

  return ceilingY == null ? null : <primitive object={edit} />;
}
