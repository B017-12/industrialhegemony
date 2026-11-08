import { ScanEye, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { alreadyAtApproach, currentStart, resolveTarget } from "../../scene/dispatch.js";
import { useStore } from "../../store.js";
import { Button, Tooltip } from "../primitives.jsx";
import { fmt, humanize } from "../status.js";

const POST_ARRIVAL = new Set(["arrived"]);

// Sends the robot from wherever it is; disabled with the reason when the
// target has no approach pose or the robot is already there.
export function SendRobotButton({ target, className }) {
  const navTargets = useStore((s) => s.navTargets);
  const sceneObjects = useStore((s) => s.sceneObjects);
  const assets = useStore((s) => s.assets);
  const missionState = useStore((s) => s.mission.state);
  const missionObjectId = useStore((s) => s.mission.targetObjectId);
  const navGrid = useStore((s) => s.navGrid);
  const baseNav = useStore((s) => s.baseNav);
  const running = useStore((s) => s.running);
  const key = JSON.stringify(target);
  const resolved = useMemo(
    () => resolveTarget(useStore.getState(), target),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, navTargets, sceneObjects, assets, navGrid],
  );
  const mpu = navGrid?.mpu ?? baseNav?.metres_per_unit ?? navTargets?.metres_per_unit ?? 1;
  const here = resolved.ok && (alreadyAtApproach(currentStart(useStore.getState()), resolved.approach, mpu) || (resolved.object.object_id === missionObjectId && POST_ARRIVAL.has(missionState)));
  const moving = missionState === "moving" && running;
  const reason = !resolved.ok ? resolved.reason : here ? "The robot is already at this approach pose" : moving ? "Pause the robot or wait until it arrives before sending a new target" : null;
  const label = resolved.label || "the target";
  return (
    <Tooltip content={reason ?? `Plan a route from the robot's current pose to ${label}`}>
      <span className={className ?? "ml-auto inline-flex"}>
        <Button size="xs" variant="outline" disabled={Boolean(reason)} onClick={() => useStore.getState().dispatchMission(target)}>
          <Send /> Dispatch to {label}
        </Button>
      </span>
    </Tooltip>
  );
}

// What the video-frame detector saw for this object (pipeline/semantic.py).
export function VisionEvidence({ objectId }) {
  const object = useStore((s) => s.sceneObjects?.objects.find((o) => o.object_id === objectId));
  const [failedId, setFailedId] = useState(null);
  const vision = object?.vision;
  if (!vision) return null;
  // The pipeline's decision, which a reviewer relabel does not change; the posterior is sorted, winner first.
  const fused = object.label_source === "vision_fusion" || Boolean(vision.phrase);
  const [cls, posterior] = Object.entries(vision.posterior ?? {})[0] ?? [object.class, null];
  const imageOk = failedId !== objectId;
  return (
    <div className="grid gap-2">
      <div className="flex items-start gap-2 text-xs">
        <ScanEye aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
        <span className="text-fg-muted">
          {fused
            ? `AI-assisted label: ${humanize(vision.phrase ?? cls)} in ${vision.support_views?.[cls] ?? 0} of ${vision.views_seen} video frames that see it (posterior ${fmt(posterior, 2)}).`
            : vision.views_seen
              ? `Seen in ${vision.views_seen} video frames, but the detector did not agree on a class, so the geometry label is kept.`
              : "Not visible in any posed video frame; the label is from geometry only."}
        </span>
      </div>
      {fused && imageOk && (
        <figure className="m-0">
          <img
            src={`/data/derived/vision/evidence/${objectId}.jpg`}
            alt={`Video frames for ${objectId}: projected box in yellow, detection in green`}
            loading="lazy"
            onError={() => setFailedId(objectId)}
            className="w-full rounded-md border border-line"
          />
          <figcaption className="mt-1 text-2xs text-fg-subtle">
            Yellow: this object's 3D box projected into the frame. Green: the detector's box. Unverified.
          </figcaption>
        </figure>
      )}
    </div>
  );
}
