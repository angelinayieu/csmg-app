"use client";

// ── SandboxPanel ──────────────────────────────────────────────────
//
// A floating, draggable / resizable / expandable whiteboard that overlays the
// main board — the "sandbox". It is a fully ISOLATED scratch space: its body
// is an iframe to the sandbox CHILD space's own objective canvas
// (`/app/objective/<id>?embed=1`). A separate document = a separate global
// event bus, so the sandbox's AI / deploy events can never cross-talk with the
// main board, and nothing made in here touches the parent room's context.
//
// Visually it reads as "another layer" stacked over the board — two faded
// ghost cards peek out behind it + a deep drop-shadow. There's no backdrop:
// the board behind stays live (the wrapper is pointer-events:none except the
// panel itself).
//
// Mounted ONCE per objective (in the objective layout, non-embed only); it's
// headless until `OPEN_SANDBOX_EVENT` fires with a matching parentSpaceId.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Layers, Maximize2, Minimize2, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  OPEN_SANDBOX_EVENT,
  type OpenSandboxDetail,
} from "@/lib/objective-canvas/sandbox-signal";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_W = 360;
const MIN_H = 280;
const DEFAULT_W = 700;
const DEFAULT_H = 500;

const rectKey = (parentSpaceId: string) => `sandbox:rect:${parentSpaceId}`;

function clampToViewport(r: Rect): Rect {
  if (typeof window === "undefined") return r;
  const w = Math.min(r.w, window.innerWidth - 16);
  const h = Math.min(r.h, window.innerHeight - 16);
  return {
    w,
    h,
    // Keep at least a sliver on-screen so the panel can always be grabbed back.
    x: Math.min(Math.max(r.x, 8), Math.max(8, window.innerWidth - 120)),
    y: Math.min(Math.max(r.y, 8), Math.max(8, window.innerHeight - 64)),
  };
}

function defaultRect(): Rect {
  if (typeof window === "undefined")
    return { x: 120, y: 96, w: DEFAULT_W, h: DEFAULT_H };
  return {
    w: DEFAULT_W,
    h: DEFAULT_H,
    x: Math.max(16, (window.innerWidth - DEFAULT_W) / 2),
    y: Math.max(16, (window.innerHeight - DEFAULT_H) / 3),
  };
}

export function SandboxPanel({ parentSpaceId }: { parentSpaceId: string }) {
  const [open, setOpen] = useState(false);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [rect, setRect] = useState<Rect>(defaultRect);
  // While the header is being dragged / the corner resized, kill iframe pointer
  // events so the drag isn't swallowed by the embedded board.
  const [interacting, setInteracting] = useState(false);
  const dragRef = useRef<{
    mode: "move" | "resize";
    px: number;
    py: number;
    start: Rect;
  } | null>(null);

  // Open on event (ignore events meant for another board's panel).
  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent<OpenSandboxDetail>).detail;
      if (!d?.sandboxId) return;
      if (d.parentSpaceId && d.parentSpaceId !== parentSpaceId) return;
      setSandboxId(d.sandboxId);
      setExpanded(false);
      try {
        const raw = window.localStorage.getItem(rectKey(parentSpaceId));
        setRect(raw ? clampToViewport(JSON.parse(raw) as Rect) : defaultRect());
      } catch {
        setRect(defaultRect());
      }
      setOpen(true);
    }
    window.addEventListener(OPEN_SANDBOX_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SANDBOX_EVENT, onOpen);
  }, [parentSpaceId]);

  const persistRect = useCallback(
    (r: Rect) => {
      try {
        window.localStorage.setItem(rectKey(parentSpaceId), JSON.stringify(r));
      } catch {
        /* storage unavailable — session-only geometry is fine */
      }
    },
    [parentSpaceId],
  );

  const onPointerDownDrag = useCallback(
    (mode: "move" | "resize") => (e: ReactPointerEvent) => {
      if (expanded) return; // locked while semi-fullscreen
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        mode,
        px: e.clientX,
        py: e.clientY,
        start: { ...rect },
      };
      setInteracting(true);
      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = ev.clientX - d.px;
        const dy = ev.clientY - d.py;
        if (d.mode === "move") {
          setRect(
            clampToViewport({
              ...d.start,
              x: d.start.x + dx,
              y: d.start.y + dy,
            }),
          );
        } else {
          setRect({
            ...d.start,
            w: Math.max(MIN_W, d.start.w + dx),
            h: Math.max(MIN_H, d.start.h + dy),
          });
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        dragRef.current = null;
        setInteracting(false);
        setRect((r) => {
          persistRect(r);
          return r;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [rect, expanded, persistRect],
  );

  const close = useCallback(() => {
    setOpen(false);
    setSandboxId(null);
  }, []);

  if (!open || !sandboxId) return null;
  // createPortal needs the DOM. On the server we render nothing; since `open`
  // starts false, the first client paint also renders null → no hydration
  // mismatch (the panel only ever opens in response to a client event).
  if (typeof document === "undefined") return null;

  const geom: CSSProperties = expanded
    ? { top: "4vh", left: "4vw", width: "92vw", height: "92vh" }
    : { top: rect.y, left: rect.x, width: rect.w, height: rect.h };

  return createPortal(
    <div style={wrapper}>
      {/* stacked "layer" ghosts — signal that this is another whiteboard layer */}
      {!expanded && (
        <>
          <div style={{ ...panelBase, ...geom, ...ghost2 }} />
          <div style={{ ...panelBase, ...geom, ...ghost1 }} />
        </>
      )}

      {/* the panel */}
      <div style={{ ...panelBase, ...geom, ...panelLive }}>
        {/* header / drag handle */}
        <div
          onPointerDown={onPointerDownDrag("move")}
          style={{ ...header, cursor: expanded ? "default" : "grab" }}
        >
          <span style={titleWrap}>
            <Layers
              style={{ width: 14, height: 14, color: appleVibe.accent.primary }}
              strokeWidth={2.2}
            />
            <span style={titleText}>Sandbox</span>
            <span style={isoChip}>isolated</span>
          </span>
          <span
            // Don't let button presses bubble to the header's drag handler.
            onPointerDown={(e) => e.stopPropagation()}
            style={{ display: "inline-flex", gap: 2 }}
          >
            <button
              type="button"
              title={expanded ? "Restore" : "Expand"}
              aria-label={expanded ? "Restore" : "Expand"}
              onClick={() => setExpanded((v) => !v)}
              style={hdrBtn}
            >
              {expanded ? (
                <Minimize2 style={ic} strokeWidth={2} />
              ) : (
                <Maximize2 style={ic} strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              title="Close sandbox"
              aria-label="Close sandbox"
              onClick={close}
              style={hdrBtn}
            >
              <X style={ic} strokeWidth={2} />
            </button>
          </span>
        </div>

        {/* the embedded, isolated whiteboard */}
        <div style={bodyWrap}>
          <iframe
            title="Sandbox whiteboard"
            src={`/app/objective/${sandboxId}?embed=1`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: "none",
              background: "transparent",
              pointerEvents: interacting ? "none" : "auto",
            }}
          />
        </div>

        {/* resize handle (bottom-right) */}
        {!expanded && (
          <div
            onPointerDown={onPointerDownDrag("resize")}
            style={resizeHandle}
            title="Drag to resize"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path
                d="M11 1 L1 11 M11 5 L5 11 M11 9 L9 11"
                stroke={appleVibe.text.faint}
                strokeWidth="1.3"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── styles ──
const wrapper: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  // No backdrop — the board behind stays live. Only the panel captures events.
  pointerEvents: "none",
};
const panelBase: CSSProperties = {
  position: "absolute",
  borderRadius: 18,
  background: appleVibe.surface.card,
  border: `1px solid ${appleVibe.stroke.soft}`,
  boxShadow:
    "0 44px 100px -34px rgba(11,18,40,0.55), 0 14px 32px -18px rgba(11,18,40,0.32)",
};
const panelLive: CSSProperties = {
  pointerEvents: "auto",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};
const ghost1: CSSProperties = {
  transform: "translate(11px, 13px)",
  opacity: 0.5,
  boxShadow: "none",
};
const ghost2: CSSProperties = {
  transform: "translate(22px, 26px)",
  opacity: 0.26,
  boxShadow: "none",
};
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "8px 8px 8px 12px",
  borderTopLeftRadius: 18,
  borderTopRightRadius: 18,
  borderBottom: `1px solid ${appleVibe.stroke.soft}`,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  userSelect: "none",
  touchAction: "none",
  fontFamily: appleVibe.font.stack,
};
const titleWrap: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  minWidth: 0,
};
const titleText: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
};
const isoChip: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
  background: appleVibe.surface.chip,
  borderRadius: 999,
  padding: "2px 7px",
};
const hdrBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: 999,
  border: "none",
  background: "transparent",
  color: appleVibe.text.secondary,
  cursor: "pointer",
};
const ic: CSSProperties = { width: 15, height: 15 };
const bodyWrap: CSSProperties = {
  position: "relative",
  flex: 1,
  overflow: "hidden",
  borderBottomLeftRadius: 18,
  borderBottomRightRadius: 18,
  background: "#fff",
};
const resizeHandle: CSSProperties = {
  position: "absolute",
  right: 3,
  bottom: 3,
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  cursor: "nwse-resize",
  touchAction: "none",
  borderRadius: 6,
};
