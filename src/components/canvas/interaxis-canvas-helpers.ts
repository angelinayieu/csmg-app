// Module-scope helpers extracted from interaxis-canvas.tsx so that file
// stays focused on component orchestration. None of these touch
// component state — they take an editor + plain args and operate on
// the tldraw store.

import { createShapeId, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { THREAD_DEFAULT_W, THREAD_DEFAULT_H } from "./shapes/thread-note-shape";
import type {
  StickyNoteShape,
  StrategyShape,
  ThreadNoteShape,
  AssetCardShape,
} from "./shapes/types";

/**
 * Update an asset-card shape's HITL extraction status props.
 * Looks up the shape by `assetId` (not by tldraw id, since the
 * caller usually only knows the asset row id, not the shape id).
 * Soft-fails if no matching shape is on the canvas — the asset may
 * have been uploaded outside the canvas (settings panel, library
 * view) and have no card to update.
 *
 * Called by the extraction-review drawer's onExtract / onSkip
 * callbacks so the card visibly transitions through the states:
 * pending_preview → previewed (when preview returns) → extracting
 * (during commit) → extracted | skipped (terminal).
 */
export function updateAssetCardStatus(
  editor: Editor,
  assetId: string,
  patch: {
    extractionStatus?: string;
    extractedEntityCount?: number;
    previewCandidateCount?: number;
  },
): void {
  if (!assetId) return;
  // Find every asset-card shape with the matching assetId. Usually 1
  // — but if the user dragged multiple cards for the same asset
  // (rare; possible via copy/paste) we update all of them.
  const allShapes = editor.getCurrentPageShapes();
  for (const shape of allShapes) {
    if (shape.type !== "asset-card") continue;
    const props = (shape as AssetCardShape).props;
    if (props.assetId !== assetId) continue;
    editor.updateShape<AssetCardShape>({
      id: shape.id,
      type: "asset-card",
      props: {
        ...(patch.extractionStatus !== undefined
          ? { extractionStatus: patch.extractionStatus }
          : {}),
        ...(patch.extractedEntityCount !== undefined
          ? { extractedEntityCount: patch.extractedEntityCount }
          : {}),
        ...(patch.previewCandidateCount !== undefined
          ? { previewCandidateCount: patch.previewCandidateCount }
          : {}),
      },
    });
  }
}

export function createStickyAtCenter(
  editor: Editor,
  opts: {
    text: string;
    color?: StickyNoteShape["props"]["color"];
    offset?: { x: number; y: number };
  },
) {
  const viewport = editor.getViewportPageBounds();
  const cx = viewport.midX + (opts.offset?.x ?? 0);
  const cy = viewport.midY + (opts.offset?.y ?? 0);
  const id = createShapeId();
  editor.createShape<StickyNoteShape>({
    id,
    type: "sticky-note",
    x: cx - 100 + (Math.random() - 0.5) * 24,
    y: cy - 100 + (Math.random() - 0.5) * 24,
    props: {
      w: 200,
      h: 200,
      text: opts.text,
      color: opts.color ?? "yellow",
      dimension: null,
      aiTagged: false,
      entityId: null,
    },
  });
  editor.select(id);
  if (opts.text === "") {
    editor.setEditingShape(id);
  }
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

// Arc 5A: thread-note creation helper.
//
// Drops a ThreadNoteShape tethered to the given parent shape and enters
// edit mode. Chooses accent color from the parent's visible palette so
// the tether + accent bar inherit meaningfully:
//   • kg-node: category-derived indigo default
//   • sticky-note: hard-coded border color per color prop
//   • strategy-card: status accent
//   • thread-note: inherit parent's accent (reply chain)
//   • anything else: indigo fallback
//
// Placement: below-right of the parent with a small random jitter so
// rapid repeat-C doesn't stack threads on top of each other. Depth
// increments when parent is already a thread.
export function createThreadOnShape(
  editor: Editor,
  parentShape: TLShape,
): TLShapeId | null {
  // Accent derivation
  let accentHex = "#6366F1"; // indigo-500 default
  if (parentShape.type === "sticky-note") {
    const p = parentShape as StickyNoteShape;
    const map: Record<StickyNoteShape["props"]["color"], string> = {
      yellow: "#F59E0B",
      pink: "#EC4899",
      blue: "#3B82F6",
      green: "#10B981",
      purple: "#8B5CF6",
    };
    accentHex = map[p.props.color] ?? accentHex;
  } else if (parentShape.type === "strategy-card") {
    const p = parentShape as StrategyShape;
    const statusMap = {
      confirmed: "#10B981",
      reviewing: "#F59E0B",
      generated: "#6366F1",
      superseded: "#9CA3AF",
    } as const;
    accentHex = statusMap[p.props.status] ?? accentHex;
  } else if (parentShape.type === "thread-note") {
    accentHex = (parentShape as ThreadNoteShape).props.accentHex || accentHex;
  }

  // Depth + root tracing
  let parentShapeId: string | null;
  let rootShapeId: string;
  let depth: number;
  if (parentShape.type === "thread-note") {
    const t = parentShape as ThreadNoteShape;
    parentShapeId = t.id;
    rootShapeId = t.props.rootShapeId || t.id;
    depth = t.props.depth + 1;
  } else {
    parentShapeId = null;
    rootShapeId = parentShape.id;
    depth = 0;
  }

  // Placement: below-right of parent
  const bounds = editor.getShapePageBounds(parentShape.id);
  if (!bounds) return null;
  const jitter = (Math.random() - 0.5) * 18;
  const x = Math.round(bounds.x + bounds.w + 24 + jitter);
  const y = Math.round(bounds.y + jitter);

  const id = createShapeId();
  editor.markHistoryStoppingPoint(`thread-create-${parentShape.id}`);
  editor.createShape<ThreadNoteShape>({
    id,
    type: "thread-note",
    x,
    y,
    props: {
      w: THREAD_DEFAULT_W,
      h: THREAD_DEFAULT_H,
      threadId: "",
      text: "",
      parentShapeId,
      rootShapeId,
      depth,
      accentHex,
      authorDisplay: "",
      createdAtIso: new Date().toISOString(),
      pending: true,
    },
  });
  editor.select(id);
  editor.setEditingShape(id);
  return id;
}

// ── Probe trail helpers (2026-07-04) ───────────────────────────────
//
// Mutating a probe-trail node's status (idle → working → result / error)
// requires parsing the trail JSON, walking to the node, flipping its
// status, and re-stringifying back to the shape prop. Centralized here
// so the canvas's branch-click + collapse listeners stay readable.

type ProbeTrailNodeStatus = "idle" | "working" | "complete" | "result" | "error";

interface ProbeTrailShapeView {
  id: TLShapeId;
  type: "probe-trail";
  props: {
    w: number;
    h: number;
    trailJson: string;
    sourceEntityId: string;
    sourceEntityName: string;
    rootQuestion: string;
    spawnedAt: number;
  };
}

/**
 * Find the probe-trail shape on the current page whose embedded
 * trail.id matches `trailId`. Returns null if no match — the user
 * may have deleted the trail or navigated to another page.
 */
function findProbeTrailShape(
  editor: Editor,
  trailId: string | null,
): ProbeTrailShapeView | null {
  if (!trailId) return null;
  const all = editor.getCurrentPageShapes();
  for (const s of all) {
    if (s.type !== "probe-trail") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sa = s as any;
    try {
      const parsed = JSON.parse(sa.props.trailJson);
      if (parsed?.id === trailId) {
        return sa as ProbeTrailShapeView;
      }
    } catch {
      // ignore — malformed trail JSON
    }
  }
  return null;
}

/**
 * Flip one probe-trail node's status by id. No-op if the trail or
 * node can't be found (caller is expected to check; this is intended
 * to be safe to call from poll-loop ticks where the user may have
 * deleted the trail).
 */
export function updateProbeTrailNodeStatus(
  editor: Editor,
  trailId: string | null,
  nodeId: string,
  status: ProbeTrailNodeStatus,
): void {
  const shape = findProbeTrailShape(editor, trailId);
  if (!shape) return;
  let parsed: { nodes?: Array<{ id: string; status: string }> };
  try {
    parsed = JSON.parse(shape.props.trailJson);
  } catch {
    return;
  }
  const node = parsed.nodes?.find((n) => n.id === nodeId);
  if (!node) return;
  node.status = status;
  editor.updateShape({
    id: shape.id,
    type: "probe-trail",
    props: { trailJson: JSON.stringify(parsed) },
  });
}

/**
 * Poll research-deep until terminal state, then flip the trail node
 * accordingly. Self-terminating: stops when the trail shape is
 * deleted, when status reaches 'completed' / 'failed', or when the
 * timeout fires.
 *
 * Polling is intentionally simple — every 8 seconds, no exponential
 * backoff. Research-deep is async OpenAI background mode which can
 * legitimately take 2-10 min, so the timeout is generous (12 min).
 */
const PROBE_POLL_INTERVAL_MS = 8000;
const PROBE_POLL_TIMEOUT_MS = 12 * 60 * 1000;

export async function pollProbeBranch(opts: {
  editor: Editor;
  spaceId: string;
  responseId: string;
  trailId: string | null;
  nodeId: string;
  onResult?: () => void;
  onError?: (msg: string) => void;
}): Promise<void> {
  const { editor, spaceId, responseId, trailId, nodeId, onResult, onError } = opts;
  const start = Date.now();

  while (Date.now() - start < PROBE_POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, PROBE_POLL_INTERVAL_MS));

    // Bail if the user deleted the trail mid-poll.
    if (!findProbeTrailShape(editor, trailId)) return;

    let pollRes: Response;
    try {
      pollRes = await fetch("/api/pipeline/research-deep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "poll", responseId, spaceId }),
      });
    } catch {
      // Network blip — try again next tick.
      continue;
    }
    if (!pollRes.ok) continue;
    let payload: { status?: string; completed?: boolean };
    try {
      payload = (await pollRes.json()) as { status?: string; completed?: boolean };
    } catch {
      continue;
    }

    if (payload.completed === true || payload.status === "completed") {
      updateProbeTrailNodeStatus(editor, trailId, nodeId, "result");
      onResult?.();
      return;
    }
    if (payload.status === "failed" || payload.status === "cancelled") {
      updateProbeTrailNodeStatus(editor, trailId, nodeId, "error");
      onError?.(payload.status);
      return;
    }
    // status in_progress / queued / unknown — keep polling.
  }

  // Timeout reached without a terminal state.
  updateProbeTrailNodeStatus(editor, trailId, nodeId, "error");
  onError?.("Research timed out (12 min cap)");
}

