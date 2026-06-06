"use client";

// ── ConnectorDragLayer ──
//
// Drag-to-connect for the objective board. Hover a card → a "+" connector
// handle appears on its right edge. Drag from the handle to another card →
// a relation menu (Feeds / Depends on / Derived from) → on pick we:
//   1. draw a real bound tldraw arrow from source → target, and
//   2. persist a REAL object_link (POST …/link-objects) so the connection
//      shows up in the object cluster graph / detail rail.
//
// Group-aware: if you drag from a card that's part of a multi-selection of
// ≥2 linkable cards, EVERY selected card links to the drop target.
//
// Self-contained overlay (no backdrop, pointer-events pass through except the
// handle / active drag / menu) — mounted once at the board level alongside
// ObjectDetailMount. Coordinates: editor.pageToScreen returns CLIENT coords,
// and this layer is position:fixed, so screen coords map 1:1 to layer coords.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  type Editor,
  type TLShape,
  type TLShapeId,
  type TLArrowShape,
  type TLShapePartial,
  createShapeId,
  useValue,
} from "tldraw";
import { ArrowRight, Plus } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { OPEN_CARD_DETAIL_EVENT } from "../shapes/oc-card-shape";

type RelationKey = "feeds" | "depends_on" | "derived_from";
const RELATIONS: { key: RelationKey; label: string }[] = [
  { key: "feeds", label: "Feeds" },
  { key: "depends_on", label: "Depends on" },
  { key: "derived_from", label: "Derived from" },
];

/** The library_objects id a shape stands for, if any. Only object-cards (and
 *  anything else carrying a non-empty props.objectId) can be linked. */
function objectIdOf(shape: TLShape | undefined): string | null {
  if (!shape) return null;
  const v = (shape.props as { objectId?: unknown }).objectId;
  return typeof v === "string" && v.length > 0 ? v : null;
}
const isLinkable = (shape: TLShape | undefined): boolean => !!objectIdOf(shape);

/** Best-effort display name for a card shape (oc-card / similar carry props.name). */
function shapeName(shape: TLShape | undefined): string {
  if (!shape) return "the card";
  const n = (shape.props as { name?: unknown }).name;
  if (typeof n === "string" && n.trim().length > 0) return n.trim();
  return "the card";
}

interface ClientPt {
  x: number;
  y: number;
}

/** Draw a bound, directional arrow source → target (mirrors the binding shape
 *  used by createInsightWithLinks). No inline label — tldraw renders text labels
 *  as a heavy black pill that obscures the line; the relation surfaces via the
 *  post-connect toast + the object detail rail instead. */
function createLinkArrow(
  editor: Editor,
  fromId: TLShapeId,
  toId: TLShapeId,
) {
  const arrowId = createShapeId();
  const arrow: TLShapePartial<TLArrowShape> = {
    id: arrowId,
    type: "arrow",
    props: {
      color: "grey",
      size: "s",
      dash: "solid",
      arrowheadStart: "none",
      arrowheadEnd: "arrow",
    },
    meta: { objectLink: true },
  };
  editor.createShapes([arrow]);
  editor.createBindings([
    {
      fromId: arrowId,
      toId: fromId,
      type: "arrow",
      props: {
        terminal: "start",
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
      },
      meta: {},
    },
    {
      fromId: arrowId,
      toId: toId,
      type: "arrow",
      props: {
        terminal: "end",
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
      },
      meta: {},
    },
  ]);
}

export function ConnectorDragLayer({
  spaceId,
  editor,
}: {
  spaceId: string;
  editor: Editor;
}) {
  // Reactive board signals.
  const toolId = useValue("tool", () => editor.getCurrentToolId(), [editor]);
  const hoveredId = useValue(
    "hovered",
    () => editor.getHoveredShapeId(),
    [editor],
  );

  // The card the handle is anchored to (hovered, with a small grace so moving
  // the pointer onto the handle itself doesn't make it vanish).
  const [activeId, setActiveId] = useState<TLShapeId | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live drag state. sourcesRef holds the source set so the window listeners
  // stay stable for the whole drag; the state fields drive re-render.
  const sourcesRef = useRef<TLShapeId[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dragCur, setDragCur] = useState<ClientPt | null>(null);
  const [dragTarget, setDragTarget] = useState<TLShapeId | null>(null);

  // The relation menu, shown after a valid drop.
  const [menu, setMenu] = useState<{
    sourceIds: TLShapeId[];
    targetId: TLShapeId;
    at: ClientPt;
  } | null>(null);

  // Post-connect confirmation toast — bottom-center glass chip, click "Open"
  // to jump straight into the target card's detail rail. Auto-clears so it
  // never lingers.
  const [toast, setToast] = useState<{
    targetObjectId: string;
    targetName: string;
    relationLabel: string;
    count: number;
  } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);

  const cancelClear = useCallback(() => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
  }, []);
  const armClear = useCallback(() => {
    cancelClear();
    clearTimer.current = setTimeout(() => setActiveId(null), 160);
  }, [cancelClear]);

  // Track hover → active card (only with the select tool, never mid-drag/menu).
  useEffect(() => {
    if (dragging || menu) return;
    if (toolId !== "select") {
      setActiveId(null);
      return;
    }
    if (hoveredId && isLinkable(editor.getShape(hoveredId))) {
      cancelClear();
      setActiveId(hoveredId);
    } else {
      armClear();
    }
  }, [hoveredId, toolId, dragging, menu, editor, cancelClear, armClear]);

  useEffect(() => () => cancelClear(), [cancelClear]);

  // Handle screen position — right-edge midpoint of the active card. Recomputes
  // on camera/shape change (pageToScreen reads the camera signal) and when the
  // active card changes.
  const handlePos = useValue<ClientPt | null>(
    "handlePos",
    () => {
      if (!activeId) return null;
      const b = editor.getShapePageBounds(activeId);
      if (!b) return null;
      return editor.pageToScreen({ x: b.maxX, y: b.midY });
    },
    [editor, activeId],
  );

  // Screen anchors for the drag lines (one per source card) + target highlight.
  const dragAnchors = useValue<ClientPt[]>(
    "dragAnchors",
    () => {
      if (!dragging) return [];
      return sourcesRef.current
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => editor.pageToScreen({ x: b.maxX, y: b.midY }));
    },
    [editor, dragging],
  );
  const targetRect = useValue(
    "targetRect",
    () => {
      if (!dragTarget) return null;
      const b = editor.getShapePageBounds(dragTarget);
      if (!b) return null;
      const tl = editor.pageToScreen({ x: b.minX, y: b.minY });
      const br = editor.pageToScreen({ x: b.maxX, y: b.maxY });
      return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    },
    [editor, dragTarget],
  );

  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      const target = activeId;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      cancelClear();
      const sel = editor.getSelectedShapeIds();
      const selLinkable = sel.filter((id) => isLinkable(editor.getShape(id)));
      // Drag from a card inside a ≥2 linkable multi-selection → connect the
      // whole group; otherwise just the hovered card.
      sourcesRef.current =
        sel.includes(target) && selLinkable.length >= 2
          ? selLinkable
          : [target];
      setDragTarget(null);
      setDragCur({ x: e.clientX, y: e.clientY });
      setDragging(true);
    },
    [activeId, editor, cancelClear],
  );

  // Window-level move/up for the drag — stable for the drag's lifetime.
  useEffect(() => {
    if (!dragging) return;
    const filter = (s: TLShape) =>
      isLinkable(s) && !sourcesRef.current.includes(s.id);
    const hitAt = (ev: PointerEvent): TLShape | undefined => {
      const page = editor.screenToPage({ x: ev.clientX, y: ev.clientY });
      return editor.getShapeAtPoint(page, { hitInside: true, filter });
    };
    const move = (ev: PointerEvent) => {
      setDragCur({ x: ev.clientX, y: ev.clientY });
      setDragTarget(hitAt(ev)?.id ?? null);
    };
    const up = (ev: PointerEvent) => {
      const hit = hitAt(ev);
      if (hit) {
        setMenu({
          sourceIds: sourcesRef.current.slice(),
          targetId: hit.id,
          at: { x: ev.clientX, y: ev.clientY },
        });
      }
      setDragging(false);
      setDragCur(null);
      setDragTarget(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setDragging(false);
        setDragCur(null);
        setDragTarget(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging, editor]);

  // Commit the chosen relation: arrow + persisted link per source. Fire-and-
  // forget on the network (soft-fail), mirroring the board's Connect op.
  const commit = useCallback(
    (rel: RelationKey, label: string) => {
      const m = menu;
      if (!m) return;
      const targetShape = editor.getShape(m.targetId);
      const toObjectId = objectIdOf(targetShape);
      let linkedCount = 0;
      if (toObjectId) {
        for (const sid of m.sourceIds) {
          const fromObjectId = objectIdOf(editor.getShape(sid));
          if (!fromObjectId || fromObjectId === toObjectId) continue;
          createLinkArrow(editor, sid, m.targetId);
          void fetch(`/api/objective/${spaceId}/link-objects`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fromObjectId, toObjectId, relation: rel }),
          }).catch(() => {});
          linkedCount += 1;
        }
      }
      if (toObjectId && linkedCount > 0) {
        setToast({
          targetObjectId: toObjectId,
          targetName: shapeName(targetShape),
          relationLabel: label,
          count: linkedCount,
        });
      }
      setMenu(null);
      setActiveId(null);
    },
    [menu, editor, spaceId],
  );

  const openTarget = useCallback(() => {
    if (!toast) return;
    window.dispatchEvent(
      new CustomEvent(OPEN_CARD_DETAIL_EVENT, {
        detail: { objectId: toast.targetObjectId },
      }),
    );
    setToast(null);
  }, [toast]);

  // Menu Escape-to-close.
  useEffect(() => {
    if (!menu) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const sourceCount = dragging ? sourcesRef.current.length : 0;

  const lineColor = appleVibe.accent.primary;

  const showHandle =
    !!handlePos && !dragging && !menu && toolId === "select";

  return (
    <>
      {/* Drag lines + target highlight — full-viewport, non-interactive. */}
      {dragging && dragCur && (
        <svg
          style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 84,
            pointerEvents: "none",
          }}
        >
          {targetRect && (
            <rect
              x={targetRect.x - 2}
              y={targetRect.y - 2}
              width={targetRect.w + 4}
              height={targetRect.h + 4}
              rx={14}
              fill={`${lineColor}14`}
              stroke={lineColor}
              strokeWidth={2}
            />
          )}
          {dragAnchors.map((a, i) => (
            <g key={i}>
              <line
                x1={a.x}
                y1={a.y}
                x2={dragCur.x}
                y2={dragCur.y}
                stroke={lineColor}
                strokeWidth={2}
                strokeDasharray={dragTarget ? undefined : "5 5"}
                strokeLinecap="round"
              />
              <circle cx={a.x} cy={a.y} r={3.5} fill={lineColor} />
            </g>
          ))}
          <circle
            cx={dragCur.x}
            cy={dragCur.y}
            r={5}
            fill="white"
            stroke={lineColor}
            strokeWidth={2}
          />
        </svg>
      )}

      {/* The "+" connector handle on the active card's right edge. */}
      {showHandle && handlePos && (
        <button
          type="button"
          title={
            (editor.getSelectedShapeIds().includes(activeId as TLShapeId) &&
            editor
              .getSelectedShapeIds()
              .filter((id) => isLinkable(editor.getShape(id))).length >= 2
              ? "Drag to connect the selected cards"
              : "Drag to connect this card") + " to another"
          }
          onPointerDown={startDrag}
          onPointerEnter={cancelClear}
          onPointerLeave={armClear}
          style={{
            position: "fixed",
            left: handlePos.x,
            top: handlePos.y,
            transform: "translate(-45%, -50%)",
            zIndex: 86,
            width: 24,
            height: 24,
            display: "grid",
            placeItems: "center",
            borderRadius: 999,
            border: "1.5px solid white",
            background: appleVibe.accent.primary,
            color: appleVibe.text.onAccent,
            cursor: "grab",
            boxShadow: "0 6px 16px -4px rgba(11,18,40,0.35)",
            touchAction: "none",
            pointerEvents: "auto",
          }}
        >
          <Plus style={{ width: 14, height: 14 }} strokeWidth={3} />
        </button>
      )}

      {/* Relation menu after a valid drop. Transparent backdrop closes it. */}
      {menu && (
        <>
          <div
            onPointerDown={() => setMenu(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 94,
              background: "transparent",
            }}
          />
          <div
            style={{
              position: "fixed",
              left: menu.at.x,
              top: menu.at.y,
              transform: "translate(8px, 8px)",
              zIndex: 95,
              minWidth: 184,
              padding: 6,
              borderRadius: appleVibe.radius.md,
              background: "var(--glass-float-bg)",
              backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
              WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
              border: "1px solid var(--glass-border)",
              boxShadow:
                "inset 0 1px 0 var(--glass-highlight), 0 18px 44px -16px rgba(11,18,40,0.40)",
              fontFamily: appleVibe.font.stack,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: appleVibe.text.tertiary,
                padding: "4px 8px 6px",
              }}
            >
              {menu.sourceIds.length > 1
                ? `Connect ${menu.sourceIds.length} cards — relation`
                : "Connect — relation"}
            </div>
            {RELATIONS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => commit(r.key, r.label)}
                style={menuRow}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = appleVibe.surface.chipHover)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Post-connect confirmation toast — tells the user metadata now flows
          into the target card, with a one-click way to open its detail rail. */}
      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 96,
            transform: "translateX(-50%)",
            zIndex: 92,
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px 10px 14px",
            borderRadius: 14,
            background: "var(--glass-float-bg)",
            backdropFilter: "blur(var(--blur-float)) saturate(1.8)",
            WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.8)",
            border: "1px solid var(--glass-border)",
            boxShadow:
              "inset 0 1px 0 var(--glass-highlight), 0 24px 60px -20px rgba(11,18,40,0.45)",
            fontFamily: appleVibe.font.stack,
            pointerEvents: "auto",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              width: 22,
              height: 22,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              background: `${appleVibe.accent.primary}1f`,
              color: appleVibe.accent.primary,
              flexShrink: 0,
            }}
          >
            <ArrowRight style={{ width: 13, height: 13 }} strokeWidth={2.4} />
          </span>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: appleVibe.text.primary,
              maxWidth: 360,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {toast.count > 1
              ? `${toast.count} cards now ${toast.relationLabel.toLowerCase()} `
              : `${toast.relationLabel} `}
            <span style={{ color: appleVibe.text.secondary, fontWeight: 500 }}>
              →
            </span>{" "}
            <span style={{ color: appleVibe.accent.primary }}>
              {toast.targetName}
            </span>
          </span>
          <button
            type="button"
            onClick={openTarget}
            style={{
              fontFamily: appleVibe.font.stack,
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 10px",
              borderRadius: 999,
              border: `1px solid ${appleVibe.accent.primary}`,
              background: appleVibe.accent.primary,
              color: appleVibe.text.onAccent,
              cursor: "pointer",
              letterSpacing: "-0.005em",
            }}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            style={{
              fontFamily: appleVibe.font.stack,
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 8px",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: appleVibe.text.tertiary,
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

const menuRow: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 600,
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
};
