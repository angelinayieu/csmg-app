"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  Plus,
  Sparkles,
  X,
  ArrowLeft,
  Check,
  GitBranch,
  Loader2,
  Search,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  canvasScopeColors,
  type CanvasScopeToken,
} from "@/lib/design-tokens";
import type {
  FramesResponse,
  HydratedFrame,
  FrameBridge,
} from "@/types";
import { ProposeBridgeModal } from "./propose-bridge-modal";

/**
 * Universal / objective canvas editor — SVG-backed composition surface.
 *
 * Layout: a large scrollable viewport. Each included child canvas is a
 * FrameCard positioned absolutely. A single SVG overlay spans the full
 * viewport and draws bridge edges between entity DOM anchors (bezier
 * paths). Drag-to-link is implemented as pointer-capture from an entity
 * row → drop on another entity row → open ProposeBridgeModal.
 *
 * Limitations vs. tldraw (handled in a future polish):
 *   - No pan/zoom; use browser scroll.
 *   - No multi-select / lasso.
 *   - Frames are rectangular only; shapes come later.
 *
 * This editor is wired as a drop-in replacement for the Sprint 1 placeholder
 * on `/app/canvas/[id]` when scope is universal or objective.
 */

interface UniversalCanvasEditorProps {
  canvasId: string;
  initialData: FramesResponse;
}

const VIEWPORT_PADDING = 48;

type BridgeDraft = {
  source_entity_id: string;
  target_entity_id: string;
  source_entity_name: string;
  target_entity_name: string;
};

type WeaveState = "idle" | "running" | "done" | "error";

export function UniversalCanvasEditor({
  canvasId,
  initialData,
}: UniversalCanvasEditorProps) {
  const [data, setData] = useState<FramesResponse>(initialData);
  const [showAddFrame, setShowAddFrame] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<BridgeDraft | null>(null);
  const [weaveState, setWeaveState] = useState<WeaveState>("idle");
  const [weaveSummary, setWeaveSummary] = useState<string | null>(null);

  // Drag-to-link state
  const [linking, setLinking] = useState<{
    fromEntityId: string;
    fromEntityName: string;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Frame-drag state — pointer-down on a frame header starts a drag. On
  // pointer-up we PATCH the new position; during drag we update local
  // state optimistically so the frame follows the cursor smoothly.
  const [framePan, setFramePan] = useState<{
    frameId: string;
    originX: number;          // frame.position_x at drag start
    originY: number;
    pointerStartX: number;    // viewport-space pointer X at drag start
    pointerStartY: number;
  } | null>(null);

  // Frame-resize state — pointer-down on the bottom-right corner handle
  // starts a resize. Same shape as framePan but tracks width/height.
  const [frameResize, setFrameResize] = useState<{
    frameId: string;
    originW: number;
    originH: number;
    pointerStartX: number;
    pointerStartY: number;
  } | null>(null);

  // Track entity DOM nodes so the SVG layer can compute endpoint coords.
  const entityRefs = useRef<Map<string, HTMLElement>>(new Map());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [tick, setTick] = useState(0); // bumps after layout changes to re-measure

  // Recompute edge positions on window resize + after frame moves
  useEffect(() => {
    function onResize() {
      setTick((t) => t + 1);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── data refresh ──
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/canvases/${canvasId}/frames`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      const next = (await res.json()) as FramesResponse;
      setData(next);
      setTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    }
  }, [canvasId]);

  // ── add frame ──
  async function addFrame(frameCanvasId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/canvases/${canvasId}/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame_canvas_id: frameCanvasId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setShowAddFrame(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add frame failed");
    }
  }

  async function removeFrame(frameId: string) {
    setError(null);
    setData((prev) => ({
      ...prev,
      frames: prev.frames.filter((f) => f.id !== frameId),
    }));
    try {
      const res = await fetch(
        `/api/canvases/${canvasId}/frames/${frameId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
      await refresh(); // restore truth
    }
  }

  // ── run weave ──
  async function runWeave() {
    setWeaveState("running");
    setWeaveSummary(null);
    setError(null);
    try {
      const res = await fetch(`/api/canvases/${canvasId}/weave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_pairs: 10 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Weave failed");
      setWeaveSummary(
        `${body.bridges_created} bridge${body.bridges_created === 1 ? "" : "s"} across ${body.pairs_run} pair${body.pairs_run === 1 ? "" : "s"}`,
      );
      setWeaveState("done");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Weave failed");
      setWeaveState("error");
    }
  }

  // ── drag-to-link ──
  const onEntityPointerDown = useCallback(
    (e: React.PointerEvent, entityId: string, entityName: string) => {
      e.preventDefault();
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      if (!viewportRect) return;
      setLinking({
        fromEntityId: entityId,
        fromEntityName: entityName,
        currentX: e.clientX - viewportRect.left,
        currentY: e.clientY - viewportRect.top,
      });
    },
    [],
  );

  // ── frame-drag handlers ──
  const onFrameHeaderPointerDown = useCallback(
    (e: React.PointerEvent, frame: HydratedFrame) => {
      e.preventDefault();
      const vp = viewportRef.current?.getBoundingClientRect();
      if (!vp) return;
      setFramePan({
        frameId: frame.id,
        originX: frame.position_x,
        originY: frame.position_y,
        pointerStartX: e.clientX - vp.left,
        pointerStartY: e.clientY - vp.top,
      });
    },
    [],
  );

  // ── frame-resize handlers ──
  const onFrameResizeHandleDown = useCallback(
    (e: React.PointerEvent, frame: HydratedFrame) => {
      e.preventDefault();
      e.stopPropagation(); // don't start a drag too
      const vp = viewportRef.current?.getBoundingClientRect();
      if (!vp) return;
      setFrameResize({
        frameId: frame.id,
        originW: frame.width,
        originH: frame.height,
        pointerStartX: e.clientX - vp.left,
        pointerStartY: e.clientY - vp.top,
      });
    },
    [],
  );

  useEffect(() => {
    if (!frameResize) return;
    const MIN_W = 220;
    const MIN_H = 180;

    function onMove(e: PointerEvent) {
      const vp = viewportRef.current?.getBoundingClientRect();
      if (!vp || !frameResize) return;
      const dx = e.clientX - vp.left - frameResize.pointerStartX;
      const dy = e.clientY - vp.top - frameResize.pointerStartY;
      const nextW = Math.max(MIN_W, frameResize.originW + dx);
      const nextH = Math.max(MIN_H, frameResize.originH + dy);
      setData((prev) => ({
        ...prev,
        frames: prev.frames.map((f) =>
          f.id === frameResize.frameId
            ? { ...f, width: nextW, height: nextH }
            : f,
        ),
      }));
      setTick((t) => t + 1);
    }

    function onUp() {
      if (!frameResize) return;
      setData((prev) => {
        const r = prev.frames.find((f) => f.id === frameResize.frameId);
        if (r) {
          fetch(
            `/api/canvases/${canvasId}/frames/${frameResize.frameId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ width: r.width, height: r.height }),
            },
          )
            .then((res) => {
              if (!res.ok) throw new Error("PATCH failed");
            })
            .catch(async () => {
              setError("Frame size did not save — reverting.");
              await refresh();
            });
        }
        return prev;
      });
      setFrameResize(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [frameResize, canvasId, refresh]);

  useEffect(() => {
    if (!framePan) return;

    function onMove(e: PointerEvent) {
      const vp = viewportRef.current?.getBoundingClientRect();
      if (!vp || !framePan) return;
      const dx = e.clientX - vp.left - framePan.pointerStartX;
      const dy = e.clientY - vp.top - framePan.pointerStartY;
      const nextX = Math.max(0, framePan.originX + dx);
      const nextY = Math.max(0, framePan.originY + dy);
      setData((prev) => ({
        ...prev,
        frames: prev.frames.map((f) =>
          f.id === framePan.frameId
            ? { ...f, position_x: nextX, position_y: nextY }
            : f,
        ),
      }));
      setTick((t) => t + 1);
    }

    async function onUp() {
      if (!framePan) return;
      // Read current state for the PATCH payload.
      setData((prev) => {
        const moved = prev.frames.find((f) => f.id === framePan.frameId);
        if (moved) {
          // Fire-and-forget PATCH — revert on failure.
          fetch(
            `/api/canvases/${canvasId}/frames/${framePan.frameId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                position_x: moved.position_x,
                position_y: moved.position_y,
              }),
            },
          )
            .then((res) => {
              if (!res.ok) throw new Error("PATCH failed");
            })
            .catch(async () => {
              setError("Frame position did not save — reverting.");
              await refresh();
            });
        }
        return prev;
      });
      setFramePan(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [framePan, canvasId, refresh]);

  useEffect(() => {
    if (!linking) return;

    function onMove(e: PointerEvent) {
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      if (!viewportRect) return;
      setLinking((prev) =>
        prev
          ? {
              ...prev,
              currentX: e.clientX - viewportRect.left,
              currentY: e.clientY - viewportRect.top,
            }
          : null,
      );
    }

    function onUp(e: PointerEvent) {
      // Find which entity, if any, is under the pointer.
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const entityEl = target?.closest(
        "[data-entity-id]",
      ) as HTMLElement | null;
      const targetEntityId = entityEl?.getAttribute("data-entity-id");
      const targetEntityName =
        entityEl?.getAttribute("data-entity-name") ?? "";

      if (
        targetEntityId &&
        linking &&
        targetEntityId !== linking.fromEntityId
      ) {
        setDraft({
          source_entity_id: linking.fromEntityId,
          source_entity_name: linking.fromEntityName,
          target_entity_id: targetEntityId,
          target_entity_name: targetEntityName,
        });
      }
      setLinking(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [linking]);

  async function confirmDraftBridge(payload: {
    bridge_type: "identity" | "influence" | "structural";
    coupling_strength: "strong" | "moderate" | "weak";
    coupling_direction:
      | "source_to_target"
      | "target_to_source"
      | "bidirectional";
    shared_variable_name: string;
    description?: string;
    rationale?: string;
  }) {
    if (!draft) return;
    try {
      const res = await fetch(`/api/canvases/${canvasId}/bridges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvas_id: canvasId,
          source_entity_id: draft.source_entity_id,
          target_entity_id: draft.target_entity_id,
          ...payload,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bridge");
      throw err;
    }
  }

  // ── bridge resolve ──
  async function resolveBridge(
    bridgeId: string,
    action: "confirm" | "reject",
  ) {
    // Optimistic: remove or confirm in local state
    setData((prev) => ({
      ...prev,
      bridges:
        action === "reject"
          ? prev.bridges.filter((b) => b.id !== bridgeId)
          : prev.bridges.map((b) =>
              b.id === bridgeId ? { ...b, status: "user_confirmed" } : b,
            ),
    }));
    try {
      const res = await fetch(`/api/bridges/${bridgeId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bridge resolve failed");
      await refresh();
    }
  }

  // ── viewport size ──
  const viewportSize = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    for (const f of data.frames) {
      const r = f.position_x + f.width;
      const b = f.position_y + f.height;
      if (r > maxX) maxX = r;
      if (b > maxY) maxY = b;
    }
    return {
      width: Math.max(1200, maxX + VIEWPORT_PADDING),
      height: Math.max(700, maxY + VIEWPORT_PADDING),
    };
  }, [data.frames]);

  const scopeColor = canvasScopeColors[data.canvas.scope as CanvasScopeToken];

  return (
    <div className="-mx-6 -my-6 flex h-[calc(100vh-2rem)] flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white/80 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/app/library"
            className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft className="h-3 w-3" />
            Library
          </Link>
          <span className="text-gray-300">/</span>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: scopeColor.dot }}
            />
            <span
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: scopeColor.text }}
            >
              {scopeColor.label}
            </span>
          </div>
          <h1 className="text-[15px] font-semibold text-gray-900">
            {data.canvas.title}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddFrame((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <Plus className="h-3 w-3" />
            Add frame
          </button>
          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            title="Open a whiteboard and use its Connect panel to weave"
          >
            <Search className="h-3 w-3" />
            Deep weave
          </Link>
          <Link
            href="/app/lab"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            title="Open the Universal Lab to simulate what-if scenarios across your universe"
          >
            <FlaskConical className="h-3 w-3" />
            Lab
          </Link>
          <button
            onClick={runWeave}
            disabled={weaveState === "running" || data.frames.length < 2}
            className={cn(
              "btn-gradient-outline inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold",
              (weaveState === "running" || data.frames.length < 2) &&
                "cursor-not-allowed opacity-60",
            )}
          >
            {weaveState === "running" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Run weave
          </button>
        </div>
      </div>

      {/* Status / add-frame dropdown */}
      {showAddFrame && (
        <AddFrameDropdown
          candidates={data.addable_canvases}
          onPick={addFrame}
          onClose={() => setShowAddFrame(false)}
        />
      )}
      {(error || weaveSummary) && (
        <div
          className={cn(
            "border-b border-gray-200 px-6 py-2 text-[12px]",
            error
              ? "border-red-200 bg-red-50 text-red-700"
              : "bg-interaxis-50 text-interaxis-700",
          )}
        >
          {error ?? weaveSummary}
        </div>
      )}

      {/* Viewport */}
      <div
        ref={viewportRef}
        className="relative flex-1 overflow-auto bg-gradient-page"
        onPointerDown={(e) => {
          // Clicking on empty canvas cancels any in-progress link
          if (e.target === e.currentTarget && linking) setLinking(null);
        }}
      >
        {data.frames.length === 0 ? (
          <EmptyCanvas onAdd={() => setShowAddFrame(true)} />
        ) : (
          <div
            className="relative"
            style={{
              width: viewportSize.width,
              height: viewportSize.height,
            }}
          >
            {/* Bridge SVG layer — rendered behind frames so frames click-through */}
            <BridgeEdgeLayer
              bridges={data.bridges}
              entityRefs={entityRefs.current}
              viewportRef={viewportRef}
              viewportSize={viewportSize}
              tick={tick}
              linking={linking}
              onResolve={resolveBridge}
            />

            {/* Frames */}
            {data.frames.map((frame) => (
              <FrameCard
                key={frame.id}
                frame={frame}
                registerEntityRef={(id, el) => {
                  if (el) entityRefs.current.set(id, el);
                  else entityRefs.current.delete(id);
                  setTick((t) => t + 1);
                }}
                onRemove={() => removeFrame(frame.id)}
                onEntityPointerDown={onEntityPointerDown}
                onHeaderPointerDown={(e) => onFrameHeaderPointerDown(e, frame)}
                onResizeHandleDown={(e) => onFrameResizeHandleDown(e, frame)}
                isBeingDragged={framePan?.frameId === frame.id}
                isBeingResized={frameResize?.frameId === frame.id}
                linkingFromId={linking?.fromEntityId ?? null}
              />
            ))}
          </div>
        )}
      </div>

      {draft && (
        <ProposeBridgeModal
          draft={draft}
          onCancel={() => setDraft(null)}
          onConfirm={confirmDraftBridge}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function EmptyCanvas({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-interaxis-50">
          <GitBranch className="h-5 w-5 text-interaxis-600" />
        </div>
        <p className="mt-3 text-sm font-medium text-gray-700">
          This canvas is empty.
        </p>
        <p className="mt-1 max-w-md text-xs text-gray-500">
          Add frames from your project / objective / app canvases to
          intersect their entities, then run weave to discover bridges.
        </p>
        <button
          onClick={onAdd}
          className="btn-gradient-outline mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold"
        >
          <Plus className="h-3 w-3" />
          Add first frame
        </button>
      </div>
    </div>
  );
}

function AddFrameDropdown({
  candidates,
  onPick,
  onClose,
}: {
  candidates: FramesResponse["addable_canvases"];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(
    () =>
      candidates.filter((c) =>
        c.title.toLowerCase().includes(filter.toLowerCase()),
      ),
    [candidates, filter],
  );
  return (
    <div className="relative z-20 border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-gray-400" />
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search your whiteboards…"
          className="flex-1 border-0 bg-transparent text-[13px] placeholder-gray-400 focus:outline-none focus:ring-0"
        />
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 max-h-60 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] text-gray-400">
            No canvases match. Project / app / objective canvases only.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
            {filtered.map((c) => {
              const color = canvasScopeColors[c.scope as CanvasScopeToken];
              return (
                <button
                  key={c.id}
                  onClick={() => onPick(c.id)}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left text-[12px] hover:bg-gray-50"
                >
                  <span
                    className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: color.dot }}
                  />
                  <span className="truncate font-medium text-gray-900">
                    {c.title}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FrameCard({
  frame,
  registerEntityRef,
  onRemove,
  onEntityPointerDown,
  onHeaderPointerDown,
  onResizeHandleDown,
  isBeingDragged,
  isBeingResized,
  linkingFromId,
}: {
  frame: HydratedFrame;
  registerEntityRef: (id: string, el: HTMLElement | null) => void;
  onRemove: () => void;
  onEntityPointerDown: (
    e: React.PointerEvent,
    id: string,
    name: string,
  ) => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
  onResizeHandleDown: (e: React.PointerEvent) => void;
  isBeingDragged: boolean;
  isBeingResized: boolean;
  linkingFromId: string | null;
}) {
  const color =
    canvasScopeColors[frame.frame_canvas.scope as CanvasScopeToken];
  return (
    <div
      className={cn(
        "group absolute flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm",
        isBeingDragged && "cursor-grabbing shadow-lg",
      )}
      style={{
        left: frame.position_x,
        top: frame.position_y,
        width: frame.width,
        height: frame.height,
        borderColor: color.tintBorder,
        transition: isBeingDragged || isBeingResized ? "none" : "box-shadow 120ms",
      }}
    >
      {/* Frame header — drag handle */}
      <div
        onPointerDown={(e) => {
          // Don't initiate drag if pointer-down was on the remove button
          if ((e.target as HTMLElement).closest("[data-frame-remove]")) return;
          onHeaderPointerDown(e);
        }}
        className={cn(
          "flex items-center justify-between px-3 py-2 select-none",
          isBeingDragged ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{ background: color.tintBg }}
        title="Drag to move"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: color.dot }}
          />
          <span
            className="truncate text-[11px] font-semibold uppercase tracking-widest"
            style={{ color: color.text }}
          >
            {frame.frame_canvas.title}
          </span>
        </div>
        <button
          data-frame-remove
          onClick={onRemove}
          className="rounded p-0.5 text-gray-400 hover:bg-black/5 hover:text-gray-700"
          aria-label="Remove frame"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {/* Entities */}
      <div className="flex-1 overflow-y-auto p-2">
        {frame.entities.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-gray-400">
            No entities to show.
          </div>
        ) : (
          <div className="space-y-1">
            {frame.entities.map((e) => {
              const isLinkSource = linkingFromId === e.id;
              return (
                <div
                  key={e.id}
                  data-entity-id={e.id}
                  data-entity-name={e.name}
                  ref={(el) => registerEntityRef(e.id, el)}
                  onPointerDown={(ev) =>
                    onEntityPointerDown(ev, e.id, e.name)
                  }
                  className={cn(
                    "cursor-grab rounded border px-2 py-1 text-[12px] leading-tight transition-colors active:cursor-grabbing",
                    isLinkSource
                      ? "border-interaxis-400 bg-interaxis-50/60"
                      : "border-transparent hover:border-gray-200 hover:bg-gray-50",
                  )}
                  title={e.description ?? undefined}
                >
                  <div className="truncate font-medium text-gray-900">
                    {e.name}
                  </div>
                  {e.description && (
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-gray-500">
                      {e.description}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Resize handle — bottom-right corner. Invisible until the frame
          is hovered or actively resizing, to keep the canvas looking clean. */}
      <div
        onPointerDown={onResizeHandleDown}
        className={cn(
          "absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize opacity-0 transition-opacity group-hover:opacity-100",
          isBeingResized && "opacity-100",
        )}
        title="Drag to resize"
      >
        {/* Subtle diagonal grip marks */}
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          className="pointer-events-none"
          aria-hidden
        >
          <path
            d="M 4 16 L 16 4"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="text-gray-400"
          />
          <path
            d="M 9 16 L 16 9"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="text-gray-400"
          />
        </svg>
      </div>
    </div>
  );
}

function BridgeEdgeLayer({
  bridges,
  entityRefs,
  viewportRef,
  viewportSize,
  tick,
  linking,
  onResolve,
}: {
  bridges: FrameBridge[];
  entityRefs: Map<string, HTMLElement>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  viewportSize: { width: number; height: number };
  tick: number;
  linking: {
    fromEntityId: string;
    currentX: number;
    currentY: number;
  } | null;
  onResolve: (bridgeId: string, action: "confirm" | "reject") => void;
}) {
  const [, setMountTick] = useState(0);
  useEffect(() => {
    // Schedule a post-mount measurement so entity refs are populated.
    setMountTick((t) => t + 1);
  }, [tick]);
  void tick;

  function getCenter(entityId: string): { x: number; y: number } | null {
    const el = entityRefs.get(entityId);
    const vp = viewportRef.current;
    if (!el || !vp) return null;
    const r = el.getBoundingClientRect();
    const vpR = vp.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - vpR.left + vp.scrollLeft,
      y: r.top + r.height / 2 - vpR.top + vp.scrollTop,
    };
  }

  const edges = bridges
    .map((b) => {
      const s = getCenter(b.source_entity_id);
      const t = getCenter(b.target_entity_id);
      if (!s || !t) return null;
      return { bridge: b, s, t };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const linkingEndpoint = linking
    ? {
        from: getCenter(linking.fromEntityId),
        to: { x: linking.currentX, y: linking.currentY },
      }
    : null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={viewportSize.width}
      height={viewportSize.height}
    >
      {/* Bridge edges */}
      {edges.map(({ bridge, s, t }) => {
        const isGhost =
          bridge.origin === "weave" && bridge.status === "active";
        const color = bridgeColor(bridge);
        const dx = t.x - s.x;
        const c1x = s.x + dx * 0.5;
        const c1y = s.y;
        const c2x = t.x - dx * 0.5;
        const c2y = t.y;
        const path = `M ${s.x} ${s.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${t.x} ${t.y}`;
        const midX = (s.x + t.x) / 2;
        const midY = (s.y + t.y) / 2;
        return (
          <g key={bridge.id}>
            <path
              d={path}
              stroke={color}
              strokeWidth={bridge.coupling_strength === "strong" ? 2 : 1.5}
              strokeDasharray={isGhost ? "4 4" : undefined}
              fill="none"
              opacity={isGhost ? 0.7 : 1}
            />
            {/* Ghost-bridge action puck — inline confirm/reject */}
            {isGhost && (
              <g
                transform={`translate(${midX - 28} ${midY - 12})`}
                className="pointer-events-auto"
              >
                <rect
                  width={56}
                  height={24}
                  rx={12}
                  fill="white"
                  stroke={color}
                  strokeWidth={1}
                />
                <g
                  transform="translate(14 12)"
                  onClick={() => onResolve(bridge.id, "confirm")}
                  className="cursor-pointer"
                >
                  <circle r={10} fill="transparent" />
                  <Check14 x={-7} y={-7} color="#22c55e" />
                </g>
                <g
                  transform="translate(42 12)"
                  onClick={() => onResolve(bridge.id, "reject")}
                  className="cursor-pointer"
                >
                  <circle r={10} fill="transparent" />
                  <X14 x={-7} y={-7} color="#ef4444" />
                </g>
              </g>
            )}
            <title>
              {`${bridge.bridge_type} · ${bridge.coupling_strength} · ${bridge.shared_variable_name}`}
            </title>
          </g>
        );
      })}

      {/* In-progress drag-to-link */}
      {linkingEndpoint && linkingEndpoint.from && (
        <path
          d={`M ${linkingEndpoint.from.x} ${linkingEndpoint.from.y} L ${linkingEndpoint.to.x} ${linkingEndpoint.to.y}`}
          stroke="#00ACC1"
          strokeWidth={2}
          strokeDasharray="4 3"
          fill="none"
        />
      )}
    </svg>
  );
}

// Tiny inline SVG icons (lucide icons don't render in raw <svg> cleanly)
function Check14({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <path
      d={`M ${x + 2} ${y + 7} L ${x + 5} ${y + 10} L ${x + 12} ${y + 3}`}
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

function X14({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g>
      <path
        d={`M ${x + 3} ${y + 3} L ${x + 11} ${y + 11}`}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d={`M ${x + 11} ${y + 3} L ${x + 3} ${y + 11}`}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </g>
  );
}

function bridgeColor(b: FrameBridge): string {
  // Identity / influence / structural → distinct hues.
  // User-confirmed (non-weave origin) colored slightly stronger.
  if (b.status === "user_rejected") return "#E5E7EB";
  switch (b.bridge_type) {
    case "identity":
      return "#00ACC1"; // teal
    case "influence":
      return "#AF52DE"; // purple
    case "structural":
      return "#FF9500"; // amber
  }
}
