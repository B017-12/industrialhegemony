// Per-frame mission state shared by the 3D layer and canvas widgets. Written
// only by MissionDriver; everything else reads it inside its own frame loop,
// so the exact clock never goes through React or the store.
export const runtime = {
  nav: null,
  events: [], // simulateMission() timeline for nav
  duration: 0,
  approachStart: 0,
  t: 0,
  state: "idle",
  pose: { pos: [0, 0, 0], yaw: 0, speed: 0, phase: "drive", index: 0 },
  active: [], // object ids in range (hysteresis), in order of entry
  version: 0, // bumped whenever `active` or `state` changes
};
