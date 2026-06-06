"use client";

// ── ImageWireOverlay — image→concept wires (persisted + live preview) ──
//
// Mirrors SharpeningConnectorsOverlay: one SVG over the board surface,
// drawn in page space (the OnTheCanvas slot is already camera-
// transformed). Renders TWO classes of paths:
//
//   1. Persisted wires — fetched from /api/objective/[id]/image-links.
//      For each saved object_link image_source → concept, find the
//      corresponding objective-image-card shape (by props.imageFileId)
//      and oc-card shape (by props.objectId), draw a side-to-side
//      bezier with a thick warm accent stroke + arrowhead.
//
//   2. Active wire — when image-wire-signal has an ingestedFileId set
//      (user clicked the "Connect" button on an image card), draw a
//      live bezier from the source handle to the current cursor
//      position. Click on an oc-card targets the wire; ESC or click
//      on empty board cancels.
//
// Pattern follows sharpening-connectors: useEditor + useValue for
// live shape positions; weights divide by zoom to stay crisp.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditor, useValue, type Editor, type TLShape } from "tldraw";
import {
  bumpImageWireRefresh,
  cancelImageWire,
  getImageWireState,
  subscribeImageWire,
} from "@/lib/objective-canvas/image-wire-signal";
import type { ImageWireRow } from "@/app/api/objective/[spaceId]/image-links/route";

const PERSISTED_STROKE = "#c2593b"; // warm terracotta — the brand sun
const LIVE_STROKE = "#0F172A"; // graphite for the in-progress wire
const HANDLE = "#c2593b";

interface PageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pull spaceId from the URL. Board pages live at /app/objective/[spaceId]. */
function spaceIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/\/app\/objective\/([^/?]+)/);
  return m ? m[1] : null;
}

function sideToSide(a: PageBox, b: PageBox): {
  from: { x: number; y: number };
  to: { x: number; y: number };
  d: string;
} {
  const bLeftOfA = b.x + b.w / 2 < a.x + a.w / 2;
  const from = bLeftOfA
    ? { x: a.x, y: a.y + a.h / 2 }
    : { x: a.x + a.w, y: a.y + a.h / 2 };
  const to = bLeftOfA
    ? { x: b.x + b.w, y: b.y + b.h / 2 }
    : { x: b.x, y: b.y + b.h / 2 };
  const dx = Math.max(44, Math.abs(to.x - from.x) * 0.5) * (bLeftOfA ? -1 : 1);
  return {
    from,
    to,
    d: `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`,
  };
}

interface PersistedSeg {
  id: string;
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  toObjectId: string;
}

function computePersistedSegments(
  editor: Editor,
  wires: ImageWireRow[],
): PersistedSeg[] {
  if (wires.length === 0) return [];
  const shapes = editor.getCurrentPageShapes();
  const imgByFileId = new Map<string, TLShape>();
  const cardByObjectId = new Map<string, TLShape>();
  for (const s of shapes) {
    if (s.type === "objective-image-card") {
      const fileId = (s.props as { imageFileId?: string }).imageFileId;
      if (fileId) imgByFileId.set(fileId, s);
    } else if (s.type === "oc-card") {
      const oid = (s.props as { objectId?: string }).objectId;
      if (oid) cardByObjectId.set(oid, s);
    }
  }
  const out: PersistedSeg[] = [];
  for (const w of wires) {
    const fromShape = imgByFileId.get(w.ingestedFileId);
    const toShape = cardByObjectId.get(w.toObjectId);
    if (!fromShape || !toShape) continue;
    const fb = editor.getShapePageBounds(fromShape.id);
    const tb = editor.getShapePageBounds(toShape.id);
    if (!fb || !tb) continue;
    const c = sideToSide(
      { x: fb.x, y: fb.y, w: fb.w, h: fb.h },
      { x: tb.x, y: tb.y, w: tb.w, h: tb.h },
    );
    out.push({
      id: `img-wire-${w.ingestedFileId}-${w.toObjectId}`,
      d: c.d,
      from: c.from,
      to: c.to,
      toObjectId: w.toObjectId,
    });
  }
  return out;
}

export function ImageWireOverlay() {
  const editor = useEditor();
  const spaceId = useMemo(() => spaceIdFromUrl(), []);

  // ── persisted wires ──
  const [wires, setWires] = useState<ImageWireRow[]>([]);
  const reload = useCallback(async () => {
    if (!spaceId) return;
    try {
      const r = await fetch(`/api/objective/${spaceId}/image-links`, {
        cache: "no-store",
      });
      if (r.ok) {
        const j = (await r.json()) as { wires?: ImageWireRow[] };
        setWires(j.wires ?? []);
      }
    } catch {
      /* soft */
    }
  }, [spaceId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // ── active wire signal ──
  const [active, setActive] = useState(getImageWireState());
  useEffect(() => {
    const unsub = subscribeImageWire((s) => setActive({ ...s }));
    return unsub;
  }, []);
  // Refetch persisted set whenever the refresh tick bumps.
  useEffect(() => {
    void reload();
  }, [active.refreshTick, reload]);

  // ── camera + live cursor (page space) ──
  const scale = useValue("iw-scale", () => editor.getCamera().z, [editor]);
  const cursor = useValue(
    "iw-cursor",
    () => {
      // editor.inputs.currentPagePoint is updated on every pointer move.
      const p = editor.inputs.currentPagePoint;
      return { x: p.x, y: p.y };
    },
    [editor],
  );

  // ── recompute on every camera/shape change ──
  const persistedSegs = useValue(
    "image-wire-persisted",
    () => computePersistedSegments(editor, wires),
    [editor, wires],
  );

  // ── click-on-oc-card while active = persist the wire ──
  useEffect(() => {
    if (!active.ingestedFileId || !spaceId) return;
    const handler = async (e: PointerEvent) => {
      // Find which shape is under the pointer at page coords.
      const ingestedFileId = active.ingestedFileId;
      if (!ingestedFileId) return;
      // Use the editor's hit detection — gives the right shape under cursor.
      const hit = editor.getShapeAtPoint(editor.inputs.currentPagePoint, {
        hitInside: true,
        margin: 0,
      });
      if (!hit || hit.type !== "oc-card") return;
      const targetObjectId = (hit.props as { objectId?: string }).objectId;
      if (!targetObjectId) return;
      e.preventDefault();
      try {
        await fetch(`/api/objective/${spaceId}/link-objects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromIngestedFileId: ingestedFileId,
            toObjectId: targetObjectId,
            relation: "informs",
          }),
        });
      } catch {
        /* soft */
      }
      cancelImageWire();
      bumpImageWireRefresh();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelImageWire();
    };
    // Capture phase so we beat tldraw's selection handler.
    window.addEventListener("pointerdown", handler, { capture: true });
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("pointerdown", handler, { capture: true });
      window.removeEventListener("keydown", keyHandler);
    };
  }, [active.ingestedFileId, editor, spaceId]);

  const hasAnyToDraw = persistedSegs.length > 0 || !!active.ingestedFileId;
  if (!hasAnyToDraw) return null;

  // Live wire from source handle to cursor — drawn with a soft curve so
  // it reads as a directed gesture, not a straight line.
  let liveSeg: { d: string; from: { x: number; y: number }; to: { x: number; y: number } } | null =
    null;
  if (active.ingestedFileId) {
    const from = { x: active.fromX, y: active.fromY };
    const to = cursor;
    const dx = Math.max(36, Math.abs(to.x - from.x) * 0.5);
    liveSeg = {
      from,
      to,
      d: `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`,
    };
  }

  return (
    <svg
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <defs>
        <marker
          id="img-wire-arrow"
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={PERSISTED_STROKE} />
        </marker>
        <marker
          id="img-wire-arrow-live"
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={LIVE_STROKE} />
        </marker>
      </defs>

      {persistedSegs.map((s) => (
        <g key={s.id}>
          <path
            d={s.d}
            fill="none"
            stroke={PERSISTED_STROKE}
            strokeWidth={2 / scale}
            strokeLinecap="round"
            markerEnd="url(#img-wire-arrow)"
            opacity={0.92}
          />
          <circle
            cx={s.from.x}
            cy={s.from.y}
            r={3.5 / scale}
            fill="#ffffff"
            stroke={HANDLE}
            strokeWidth={1.5 / scale}
          />
        </g>
      ))}

      {liveSeg && (
        <g>
          <path
            d={liveSeg.d}
            fill="none"
            stroke={LIVE_STROKE}
            strokeWidth={1.75 / scale}
            strokeDasharray={`${6 / scale} ${4 / scale}`}
            strokeLinecap="round"
            markerEnd="url(#img-wire-arrow-live)"
            opacity={0.7}
          />
          <circle
            cx={liveSeg.from.x}
            cy={liveSeg.from.y}
            r={4 / scale}
            fill={LIVE_STROKE}
          />
        </g>
      )}
    </svg>
  );
}
