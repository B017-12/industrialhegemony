import * as THREE from "three";

// All data is in raw PLY frame (y-down). The viewer shows it under one parent
// group rotated 180 degrees about X, which maps (x, y, z) to (x, -y, -z).
export const DISPLAY_ROTATION = [Math.PI, 0, 0];

export function rawToDisplay([x, y, z]) {
  return new THREE.Vector3(x, -y, -z);
}

// Display-space bounds of the floor plane plus every equipment box.
export function sceneBounds(sceneObjects) {
  const box = new THREE.Box3();
  for (const object of sceneObjects.objects) {
    const isFloor = object.class === "floor";
    if (object.source === "structure_plane" && !isFloor) continue;
    box.expandByPoint(rawToDisplay(object.aabb_min));
    box.expandByPoint(rawToDisplay(object.aabb_max));
  }
  return box;
}

export function floorHeight(sceneObjects) {
  const floor = sceneObjects.objects.find((o) => o.class === "floor");
  return floor ? -floor.center[1] : sceneBounds(sceneObjects).min.y;
}
