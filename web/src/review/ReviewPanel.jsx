import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Camera,
  Check,
  ClipboardCheck,
  Download,
  Link2,
  Link2Off,
  Merge,
  PencilLine,
  Shapes,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cropUrl,
  fetchAnchors,
  fetchAssets,
  fetchCrops,
  fetchOverrides,
  fetchVlmLabels,
  patchOverride,
  restoreOverrides,
} from "../data.js";
import { useStore } from "../store.js";
import { Badge, Button, Card, cx, Field, IconButton, Kbd, MappingBadge, Meter, SectionTitle } from "../ui/primitives.jsx";
import { fmt, humanize } from "../ui/status.js";
import { INSTANCE_CLASSES, isHidden, mergeOverrides } from "./overrides.js";
import { buildQueue, GROUPS, nearestNeighbours, queueStats, REVIEW_GOAL } from "./queue.js";

const REVIEWER_KEY = "valmet.reviewer";
const CLASS_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
const SURE = 0.9;
const UNSURE = 0.6;
const BINDING_FIELDS = ["asset_id", "mapping_method"];

const STATUS_TONE = { confirmed: "normal", relabelled: "accent", rejected: "critical", merged: "offline" };

function isTypingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function useReviewQueue() {
  const base = useStore((s) => s.baseSceneObjects);
  const overrides = useStore((s) => s.labelOverrides);
  const nav = useStore((s) => s.baseNav);
  const navTargets = useStore((s) => s.navTargets);
  const reachable = useMemo(
    () => new Set((navTargets?.targets ?? []).filter((t) => t.reachable).map((t) => t.asset_id)),
    [navTargets],
  );
  const queueFor = useCallback(
    (file) =>
      base
        ? buildQueue({
            objects: mergeOverrides(base.objects, file),
            path: nav?.path,
            mpu: base.metres_per_unit ?? 1,
            targetObjectId: nav?.target_object_id,
            reachableAssets: reachable,
          })
        : [],
    [base, nav, reachable],
  );
  const queue = useMemo(() => queueFor(overrides), [queueFor, overrides]);
  return { queue, queueFor };
}

export function ReviewPanel() {
  const backend = useStore((s) => s.backend);
  const selectedId = useStore((s) => s.selectedId);
  const assets = useStore((s) => s.assets);
  const labelOverrides = useStore((s) => s.labelOverrides);
  const tour = useStore((s) => s.review.tour);
  const cropsVersion = useStore((s) => s.review.cropsVersion);
  const { queue, queueFor } = useReviewQueue();

  const [reviewer, setReviewer] = useState(() => localStorage.getItem(REVIEWER_KEY) ?? "");
  const [mode, setMode] = useState(null); // null | class | rename | merge | bind
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState([]);
  const [crops, setCrops] = useState({});
  const [vlm, setVlm] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const undoStack = useRef([]);
  const history = useRef([]);
  const skipped = useRef(new Set());

  const online = backend === "online";
  const canWrite = online && reviewer.trim().length > 0 && !busy && tour.state === "idle";
  const stats = useMemo(() => queueStats(queue), [queue]);
  const item = queue.find((i) => i.objectId === selectedId) ?? null;
  const object = item?.object ?? null;
  const assetIndex = useMemo(() => Object.fromEntries(assets.map((a) => [a.asset_id, a])), [assets]);
  const base = useStore((s) => s.baseSceneObjects);
  const baseObject = useMemo(() => base?.objects.find((o) => o.object_id === selectedId) ?? null, [base, selectedId]);

  // Fresh overrides when the panel opens: another tab or a test may have written them.
  useEffect(() => {
    fetchOverrides().then(({ data, source }) => source === "api" && useStore.getState().setLabelOverrides(data));
    fetchVlmLabels().then(setVlm);
  }, [online]);

  useEffect(() => {
    if (online) fetchCrops().then((index) => setCrops(index.crops ?? {}));
  }, [online, cropsVersion]);

  const select = useCallback((id, { remember = true } = {}) => {
    const s = useStore.getState();
    if (remember && s.selectedId && s.selectedId !== id) history.current.push(s.selectedId);
    setMode(null);
    setError(null);
    s.setSelectedId(id);
    // Re-fly even when the id is unchanged (CameraRig flies on selection changes only).
    useStore.setState((st) => ({ flyRequest: st.flyRequest + 1 }));
  }, []);

  const nextAfter = useCallback(
    (list, currentId) => {
      const open = list.filter((i) => !i.reviewed && i.objectId !== currentId);
      return (open.find((i) => !skipped.current.has(i.objectId)) ?? open[0])?.objectId ?? null;
    },
    [],
  );

  // Start on the first unreviewed object.
  useEffect(() => {
    if (!useStore.getState().selectedId && queue.length) {
      const first = nextAfter(queue, null);
      if (first) select(first, { remember: false });
    }
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.length > 0]);

  const refreshAssets = () => {
    const { setSceneData } = useStore.getState();
    fetchAssets().then((a) => setSceneData({ assets: a })).catch(() => {});
    fetchAnchors().then((a) => setSceneData({ anchors: a })).catch(() => {});
  };

  const touchesBinding = (changed, previous) =>
    Object.keys(changed).some((id) => BINDING_FIELDS.some((f) => (changed[id]?.[f] ?? null) !== (previous[id]?.[f] ?? null)));

  const act = async (body, { advance = true, label } = {}) => {
    if (!canWrite || !object) return;
    setBusy(true);
    setError(null);
    try {
      const res = await patchOverride(object.object_id, { reviewer: reviewer.trim(), ...body });
      undoStack.current.push({ objectId: object.object_id, previous: res.previous, label });
      useStore.getState().setLabelOverrides(res.overrides);
      setNotes(res.notes);
      setLastAction(`${label} ${object.object_id}`);
      if (touchesBinding(res.changed, res.previous)) refreshAssets();
      setMode(null);
      if (advance) {
        const next = nextAfter(queueFor(res.overrides), object.object_id);
        if (next) select(next);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    const entry = undoStack.current.pop();
    if (!entry || !online || !reviewer.trim()) return;
    setBusy(true);
    try {
      const res = await restoreOverrides(reviewer.trim(), entry.previous);
      useStore.getState().setLabelOverrides(res.overrides);
      if (touchesBinding(res.changed, res.previous)) refreshAssets();
      setLastAction(`Undid ${entry.label?.toLowerCase() ?? "action"} on ${entry.objectId}`);
      setNotes([]);
      select(entry.objectId);
    } catch (e) {
      undoStack.current.push(entry);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const accept = (unsure) =>
    act({ action: "confirm", class_confidence: unsure ? UNSURE : SURE }, { label: unsure ? "Accepted (unsure)" : "Accepted" });
  const setClass = (cls) =>
    act(
      cls === object.class ? { action: "confirm", class_confidence: SURE } : { action: "relabel", class: cls, class_confidence: SURE },
      { label: `Class ${cls}` },
    );
  const reject = () => act({ action: "reject" }, { label: "Rejected" });
  const skip = () => {
    if (!object) return;
    skipped.current.add(object.object_id);
    const next = nextAfter(queue, object.object_id);
    if (next) select(next);
  };
  const back = () => {
    const id = history.current.pop();
    if (id) select(id, { remember: false });
  };

  const neighbours = useMemo(
    () => (object ? nearestNeighbours(object, queue.map((i) => i.object)) : []),
    [object, queue],
  );

  // Keyboard-first: capture phase, so the app's global shortcuts (Esc clears
  // the selection) don't fire while a review sub-mode is open.
  const handlers = useRef({});
  handlers.current = { accept, setClass, reject, skip, back, undo, act, mode, object, neighbours, canWrite };
  useEffect(() => {
    const onKey = (event) => {
      const h = handlers.current;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof HTMLElement && event.target.closest("[role=dialog],[role=tree],[role=menu]")) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      let handled = true;
      if (h.mode === "class") {
        const index = CLASS_KEYS.indexOf(event.key);
        if (index >= 0 && INSTANCE_CLASSES[index]) h.setClass(INSTANCE_CLASSES[index]);
        else if (key === "Escape") setMode(null);
        else handled = false;
      } else if (h.mode === "merge") {
        const n = Number(event.key);
        if (n >= 1 && n <= h.neighbours.length) {
          const parent = h.neighbours[n - 1].object.object_id;
          h.act({ action: "merge", merge_into: parent }, { label: `Merged into ${parent}` });
        } else if (key === "Escape") setMode(null);
        else handled = false;
      } else if (h.mode && key === "Escape") {
        setMode(null);
      } else if (!h.mode && h.object) {
        if (key === "a" || key === "Enter") h.accept(event.shiftKey);
        else if (key === "c") setMode("class");
        else if (key === "r") setMode("rename");
        else if (key === "m") setMode("merge");
        else if (key === "x") h.reject();
        else if (key === "b") setMode("bind");
        else if (key === "u" && h.object.asset_id) h.act({ action: "unbind" }, { advance: false, label: "Unbound" });
        else if (key === "s" || key === "ArrowRight") h.skip();
        else if (key === "ArrowLeft") h.back();
        else if (key === "z") h.undo();
        else handled = false;
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const saveReviewer = (name) => {
    setReviewer(name);
    localStorage.setItem(REVIEWER_KEY, name);
  };

  const startTour = (all) => {
    const ids = queue.map((i) => i.objectId).filter((id) => all || !crops[id]);
    if (ids.length) useStore.getState().setTour({ state: "running", done: 0, total: ids.length, failed: 0, objectIds: ids });
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(labelOverrides ?? { schema_version: "1.0", overrides: {} }, null, 2) + "\n"], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "labels_override.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const missingCrops = queue.filter((i) => !crops[i.objectId]).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 gap-3 border-b border-line px-4 pt-3 pb-3">
        <ReviewerField reviewer={reviewer} onChange={saveReviewer} />
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-fg-muted">
              <span className="tabular font-semibold text-fg">{stats.reviewed}</span> of {REVIEW_GOAL} reviewed
            </span>
            <span className="tabular text-2xs text-fg-subtle">
              target {stats.byGroup.target?.reviewed ?? 0}/{stats.byGroup.target?.total ?? 0} · bound{" "}
              {stats.byGroup.bound?.reviewed ?? 0}/{stats.byGroup.bound?.total ?? 0} · route {stats.byGroup.route?.reviewed ?? 0}/
              {stats.byGroup.route?.total ?? 0}
            </span>
          </div>
          <Meter value={Math.min(stats.reviewed, REVIEW_GOAL)} max={REVIEW_GOAL} tone={stats.reviewed >= REVIEW_GOAL ? "normal" : "accent"} label="Objects reviewed" />
        </div>
        {!online && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-status-watch/40 bg-status-watch-soft px-2.5 py-1.5 text-xs text-fg">
            <span className="flex-1">Saving needs the live API. Start the backend, or download the current file.</span>
            <Button size="xs" variant="outline" onClick={download}>
              <Download /> labels_override.json
            </Button>
          </div>
        )}
        {online && (
          <TourControls tour={tour} missing={missingCrops} total={queue.length} onStart={startTour} disabled={busy} />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {object ? (
          <div className="grid gap-3">
            <ObjectHeader item={item} object={object} assetIndex={assetIndex} />
            <CropView objectId={object.object_id} crop={crops[object.object_id]} touring={tour.state !== "idle"} />
            <Suggestions object={object} baseObject={baseObject} vlm={vlm?.labels?.[object.object_id]} onPick={setClass} disabled={!canWrite} />
            <ActionBar
              object={object}
              mode={mode}
              setMode={setMode}
              canWrite={canWrite}
              onAccept={accept}
              onReject={reject}
              onSkip={skip}
              onBack={back}
              onUndo={undo}
              onUnbind={() => act({ action: "unbind" }, { advance: false, label: "Unbound" })}
              canUndo={undoStack.current.length > 0}
            />
            {mode === "class" && <ClassPicker current={object.class} onPick={setClass} onClose={() => setMode(null)} />}
            {mode === "rename" && (
              <RenameForm
                initial={object.display_label}
                onSubmit={(label) => act({ action: "relabel", display_label: label, class_confidence: SURE }, { label: "Renamed" })}
                onClose={() => setMode(null)}
              />
            )}
            {mode === "merge" && (
              <MergePicker
                neighbours={neighbours}
                bound={Boolean(object.asset_id)}
                onPick={(id) => act({ action: "merge", merge_into: id }, { label: `Merged into ${id}` })}
                onClose={() => setMode(null)}
              />
            )}
            {mode === "bind" && (
              <BindPicker
                assets={assets}
                current={object.asset_id}
                onPick={(id) => act({ action: "bind", asset_id: id }, { advance: false, label: `Bound ${id}` })}
                onClose={() => setMode(null)}
              />
            )}
            {error && (
              <p role="alert" className="m-0 rounded-md border border-status-critical/40 bg-status-critical-soft px-2.5 py-1.5 text-xs text-fg">
                {error}
              </p>
            )}
            {lastAction && !error && (
              <p role="status" className="m-0 text-2xs text-fg-subtle">
                Saved: {lastAction}. <Kbd>Z</Kbd> undoes.
              </p>
            )}
            {notes.length > 0 && (
              <ul className="m-0 grid list-none gap-1 rounded-md border border-status-watch/40 bg-status-watch-soft p-2 text-2xs text-fg">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <ObjectFacts object={object} item={item} />
          </div>
        ) : (
          <p className="m-0 text-sm text-fg-subtle">Pick an object in the queue below or click a box in the 3D view.</p>
        )}
        <QueueList queue={queue} selectedId={selectedId} onSelect={select} />
      </div>
    </div>
  );
}

function ReviewerField({ reviewer, onChange }) {
  const [draft, setDraft] = useState(reviewer);
  const [editing, setEditing] = useState(!reviewer);
  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-fg-subtle">Reviewer</span>
        <span className="font-medium text-fg">{reviewer}</span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <form
      className="grid gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        onChange(draft.trim());
        setEditing(false);
      }}
    >
      <label htmlFor="reviewer-name" className="text-xs text-fg-muted">
        Your name. It is written into every label you confirm; nothing is saved without it.
      </label>
      <div className="flex gap-2">
        <input
          id="reviewer-name"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="First Last"
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-2.5 text-sm text-fg outline-none focus:border-accent"
        />
        <Button type="submit" size="md" variant="primary" disabled={!draft.trim()}>
          Start reviewing
        </Button>
      </div>
    </form>
  );
}

function TourControls({ tour, missing, total, onStart, disabled }) {
  const running = tour.state !== "idle";
  if (running) {
    return (
      <div className="grid gap-1.5" role="status">
        <div className="flex items-center gap-2 text-xs">
          <Camera aria-hidden className="size-3.5 text-accent" />
          <span className="flex-1 text-fg-muted">
            Crop tour {tour.done}/{tour.total}
            {tour.failed ? ` · ${tour.failed} failed` : ""}
            {tour.state === "cancelling" ? " · stopping" : ""}
          </span>
          <Button size="xs" variant="outline" onClick={() => useStore.getState().setTour({ state: "cancelling" })} disabled={tour.state === "cancelling"}>
            <Square /> Stop
          </Button>
        </div>
        <Meter value={tour.done} max={tour.total || 1} label="Crop tour progress" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <Camera aria-hidden className="size-3.5 text-fg-faint" />
      <span className="flex-1 text-fg-muted">{missing ? `${missing} of ${total} objects have no crop yet` : `All ${total} objects have a crop`}</span>
      {missing > 0 && (
        <Button size="xs" variant="outline" onClick={() => onStart(false)} disabled={disabled}>
          Capture {missing}
        </Button>
      )}
      <Button size="xs" variant="ghost" onClick={() => onStart(true)} disabled={disabled}>
        Recapture all
      </Button>
    </div>
  );
}

function ObjectHeader({ item, object, assetIndex }) {
  const asset = object.asset_id ? assetIndex[object.asset_id] : null;
  const status = object.label_source === "human" ? object.review_status : null;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-semibold text-fg">{object.object_id}</span>
        <Badge tone={item.group === "target" ? "critical" : item.group === "bound" ? "procedural" : "offline"}>{GROUPS[item.group]}</Badge>
        {status ? (
          <Badge tone={STATUS_TONE[status] ?? "normal"} icon={ClipboardCheck}>
            {humanize(status)} by {object.reviewer}
          </Badge>
        ) : (
          <Badge>Not reviewed</Badge>
        )}
      </div>
      <div className="truncate text-sm text-fg">{object.display_label}</div>
      {object.asset_id && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Link2 aria-hidden className="size-3.5" />
          <span className="font-mono text-fg">{asset?.tag ?? object.asset_id}</span>
          <span>{humanize(asset?.asset_class ?? "")}</span>
          <MappingBadge method={object.mapping_method} />
        </div>
      )}
      {isHidden(object) && (
        <p className="m-0 text-2xs text-status-critical">
          Hidden in the viewer ({object.review_status}
          {object.merged_into ? ` into ${object.merged_into}` : ""}). Undo to restore it.
        </p>
      )}
    </div>
  );
}

function CropView({ objectId, crop, touring }) {
  if (!crop) {
    return (
      <div className="grid h-28 place-items-center rounded-lg border border-dashed border-line-strong bg-surface-2/50 px-4 text-center text-2xs text-fg-subtle">
        {touring ? "Capturing..." : "No crop yet. The 3D view is framed on this object; run the crop tour to store a crop."}
      </div>
    );
  }
  return (
    <figure className="m-0 grid gap-1">
      <img
        src={cropUrl(objectId, crop.captured_at)}
        alt={`Crop of ${objectId} from the splat with its box`}
        className="max-h-56 w-full rounded-lg border border-line bg-black object-contain"
      />
      <figcaption className="text-2xs text-fg-subtle">
        Crop {crop.width}×{crop.height} px, captured {crop.captured_at?.replace("T", " ").replace("Z", " UTC")}
      </figcaption>
    </figure>
  );
}

function Suggestions({ object, baseObject, vlm, onPick, disabled }) {
  const heuristic = baseObject && baseObject.label_source === "heuristic" ? baseObject : null;
  if (!heuristic && !vlm) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-2xs">
      <span className="text-fg-subtle">Suggestions</span>
      {heuristic && (
        <SuggestionChip
          source="Heuristic"
          cls={heuristic.class}
          confidence={heuristic.class_confidence}
          active={object.class === heuristic.class}
          onPick={onPick}
          disabled={disabled}
        />
      )}
      {vlm && (
        <SuggestionChip
          source="VLM"
          cls={vlm.class}
          confidence={vlm.confidence}
          title={vlm.short_description}
          active={object.class === vlm.class}
          onPick={onPick}
          disabled={disabled}
        />
      )}
    </div>
  );
}

function SuggestionChip({ source, cls, confidence, title, active, onPick, disabled }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={() => onPick(cls)}
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-2xs disabled:opacity-50",
        active ? "border-accent/50 bg-accent-soft text-fg" : "border-line-strong bg-surface-2 text-fg-muted hover:text-fg",
      )}
    >
      <span className="text-fg-subtle">{source}</span> {cls} <span className="tabular text-fg-subtle">{fmt(confidence, 2)}</span>
    </button>
  );
}

function ActionBar({ object, mode, setMode, canWrite, onAccept, onReject, onSkip, onBack, onUndo, onUnbind, canUndo }) {
  const toggle = (m) => setMode(mode === m ? null : m);
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" onClick={() => onAccept(false)} disabled={!canWrite}>
          <Check /> Accept <Kbd className="ml-0.5">A</Kbd>
        </Button>
        <Button size="sm" onClick={() => toggle("class")} disabled={!canWrite} aria-pressed={mode === "class"}>
          <Shapes /> Class <Kbd className="ml-0.5">C</Kbd>
        </Button>
        <Button size="sm" onClick={() => toggle("rename")} disabled={!canWrite} aria-pressed={mode === "rename"}>
          <PencilLine /> Rename <Kbd className="ml-0.5">R</Kbd>
        </Button>
        <Button size="sm" onClick={() => toggle("merge")} disabled={!canWrite} aria-pressed={mode === "merge"}>
          <Merge /> Merge <Kbd className="ml-0.5">M</Kbd>
        </Button>
        <Button size="sm" onClick={onReject} disabled={!canWrite}>
          <Ban /> Reject <Kbd className="ml-0.5">X</Kbd>
        </Button>
        <Button size="sm" onClick={() => toggle("bind")} disabled={!canWrite} aria-pressed={mode === "bind"}>
          <Link2 /> Bind <Kbd className="ml-0.5">B</Kbd>
        </Button>
        {object.asset_id && (
          <Button size="sm" variant="outline" onClick={onUnbind} disabled={!canWrite}>
            <Link2Off /> Unbind <Kbd className="ml-0.5">U</Kbd>
          </Button>
        )}
      </div>
      <div className="flex items-center gap-1 text-2xs text-fg-subtle">
        <IconButton label="Previous object" shortcut="←" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <IconButton label="Skip to the next object" shortcut="S" onClick={onSkip}>
          <ArrowRight />
        </IconButton>
        <IconButton label="Undo the last save" shortcut="Z" onClick={onUndo} disabled={!canUndo}>
          <Undo2 />
        </IconButton>
        <span className="ml-1">
          <Kbd>Shift</Kbd>+<Kbd>A</Kbd> accepts as unsure ({UNSURE})
        </span>
      </div>
    </div>
  );
}

function PickerCard({ title, onClose, children }) {
  return (
    <Card className="grid gap-2 border-accent/40">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg">{title}</span>
        <IconButton label="Close" shortcut="Esc" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      {children}
    </Card>
  );
}

function ClassPicker({ current, onPick, onClose }) {
  return (
    <PickerCard title="Choose the class" onClose={onClose}>
      <div className="grid grid-cols-3 gap-1">
        {INSTANCE_CLASSES.map((cls, i) => (
          <Button
            key={cls}
            size="sm"
            variant={cls === current ? "primary" : "default"}
            onClick={() => onPick(cls)}
            className="justify-between"
          >
            {humanize(cls)} <Kbd>{CLASS_KEYS[i]}</Kbd>
          </Button>
        ))}
      </div>
    </PickerCard>
  );
}

function RenameForm({ initial, onSubmit, onClose }) {
  const [value, setValue] = useState(initial ?? "");
  return (
    <PickerCard title="Display label" onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-2.5 text-sm text-fg outline-none focus:border-accent"
        />
        <Button type="submit" size="md" variant="primary" disabled={!value.trim()}>
          Save
        </Button>
      </form>
    </PickerCard>
  );
}

function MergePicker({ neighbours, bound, onPick, onClose }) {
  return (
    <PickerCard title="Merge this fragment into a neighbour" onClose={onClose}>
      {bound ? (
        <p className="m-0 text-xs text-fg-muted">This object holds an asset. Unbind it first (U), then merge.</p>
      ) : (
        <div className="grid gap-1">
          {neighbours.map(({ object: n, distance }, i) => (
            <Button key={n.object_id} size="sm" onClick={() => onPick(n.object_id)} className="justify-between">
              <span className="flex min-w-0 items-center gap-2">
                <Kbd>{i + 1}</Kbd>
                <span className="font-mono">{n.object_id}</span>
                <span className="truncate text-fg-muted">{humanize(n.class)}</span>
              </span>
              <span className="tabular text-2xs text-fg-subtle">{fmt(distance, 2)} units</span>
            </Button>
          ))}
          <p className="m-0 text-2xs text-fg-subtle">The neighbour keeps its id and grows to the union box; this object is hidden.</p>
        </div>
      )}
    </PickerCard>
  );
}

function BindPicker({ assets, current, onPick, onClose }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assets
      .filter((a) => !needle || `${a.tag} ${a.asset_id} ${a.asset_class}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [assets, q]);
  return (
    <PickerCard title="Bind an Excel asset to this object" onClose={onClose}>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (e.key === "Enter" && matches[0]) onPick(matches[0].asset_id);
        }}
        placeholder="Tag, id or class (Enter binds the first match)"
        className="h-8 rounded-md border border-line-strong bg-surface-2 px-2.5 text-sm text-fg outline-none focus:border-accent"
      />
      <div className="grid gap-1">
        {matches.map((a) => (
          <Button key={a.asset_id} size="sm" variant={a.asset_id === current ? "primary" : "default"} onClick={() => onPick(a.asset_id)} className="justify-between">
            <span className="flex items-center gap-2">
              <span className="font-mono">{a.tag}</span>
              <span className="text-fg-muted">{humanize(a.asset_class)}</span>
            </span>
            <span className="text-2xs text-fg-subtle">{a.scene_object_id ? `now ${a.scene_object_id}` : "unbound"}</span>
          </Button>
        ))}
      </div>
      <p className="m-0 text-2xs text-fg-subtle">
        The asset moves here and its previous object is unbound. The binding stays marked unverified; rerun the pipeline so its mission follows.
      </p>
    </PickerCard>
  );
}

function ObjectFacts({ object, item }) {
  const dims = object.features?.dims_m;
  const height = object.height_above_floor_m;
  return (
    <Card>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Field label={`Class (${object.label_source})`}>
          {humanize(object.class)} · {fmt(object.class_confidence, 2)}
        </Field>
        <Field label="Segmentation">{humanize(object.source)}</Field>
        {dims && (
          <Field label="Size (W × D × H)">
            {fmt(dims.width, 2)} × {fmt(dims.depth, 2)} × {fmt(dims.height, 2)} m
          </Field>
        )}
        {height && (
          <Field label="Height above floor">
            {fmt(height.bottom, 2)}–{fmt(height.top, 2)} m
          </Field>
        )}
        {object.features?.red_fraction != null && <Field label="Red fraction">{fmt(object.features.red_fraction, 2)}</Field>}
        <Field label="Route distance">{Number.isFinite(item.routeDistanceM) ? `${fmt(item.routeDistanceM, 2)} m` : "--"}</Field>
        <Field label="Splats">{fmt(object.splat_count, 0)}</Field>
        {object.review_notes && <Field label="Review notes">{object.review_notes}</Field>}
      </dl>
      {object.mapping_notes && <p className="m-0 mt-2.5 text-2xs text-fg-subtle">{object.mapping_notes}</p>}
    </Card>
  );
}

function QueueList({ queue, selectedId, onSelect }) {
  const groups = ["target", "bound", "route", "other"];
  return (
    <section className="mt-5">
      <SectionTitle>Queue</SectionTitle>
      <div className="grid gap-3">
        {groups.map((g) => {
          const rows = queue.filter((i) => i.group === g);
          if (!rows.length) return null;
          const done = rows.filter((i) => i.reviewed).length;
          return (
            <div key={g}>
              <div className="mb-1 flex justify-between text-2xs text-fg-subtle">
                <span>{GROUPS[g]}</span>
                <span className="tabular">
                  {done}/{rows.length}
                </span>
              </div>
              <ul className="m-0 grid list-none gap-px p-0">
                {rows.map((i) => (
                  <li key={i.objectId}>
                    <button
                      type="button"
                      onClick={() => onSelect(i.objectId)}
                      aria-current={i.objectId === selectedId ? "true" : undefined}
                      className={cx(
                        "flex h-6 w-full items-center gap-2 rounded-sm px-1.5 text-left text-2xs",
                        i.objectId === selectedId ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-3",
                      )}
                    >
                      <span
                        aria-label={i.reviewed ? "reviewed" : "not reviewed"}
                        className={cx("size-1.5 shrink-0 rounded-full", i.reviewed ? (isHidden(i.object) ? "bg-status-critical" : "bg-status-normal") : "bg-surface-4")}
                      />
                      <span className="font-mono">{i.objectId}</span>
                      <span className="truncate">{humanize(i.object.class)}</span>
                      {i.object.asset_id && <span className="ml-auto font-mono text-fg-subtle">{i.object.display_label?.split(" ")[0]}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
