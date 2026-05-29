"use client";

// ── CanvasWorkspaceRoomFullscreen (Phase 1 — VR window stack) ─────
//
// The spatial-window layer over the whiteboard. A whiteboard shape's
// header dispatches `canvas-workspace:open-fullscreen` with
// { kind, artifactId, title, href, originRect? }; this portal grows a
// WINDOW out of that node (magic-move), renders the artifact's *actual
// route* in an <iframe>, and leaves the tldraw canvas alive underneath.
//
// Decoupling note: the window NEVER imports content components — it only
// hosts a route by URL via the iframe. So the screen/motion layer (here)
// and the internal content (the routes/cards) evolve independently and
// can't collide. This is why we iframe rather than direct-mount.
//
// Mechanics are the shared room-stack engine (RoomStackProvider +
// RoomStackViewport): VR glow/scrim, magic-move, a stack of windows with
// ⌘↑/↓ glide + Esc, deterministic compress-back-into-node. The viewport
// is portal'd to <body> so it escapes tldraw's pan/zoom transform.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Minimize, X } from "lucide-react";
import type { WorkspaceRoomShape } from "@/components/canvas/shapes/types";
import {
  RoomStackProvider,
  useRoomStack,
  type RoomDescriptor,
} from "@/components/rooms/room-stack-context";
import { RoomStackViewport } from "@/components/rooms/room-stack-viewport";

interface OpenDetail {
  kind: WorkspaceRoomShape["props"]["kind"];
  artifactId: string;
  title: string;
  href: string;
  /** Screen-space center + width of the originating shape, for the
   *  magic-move (window grows out of / compresses back into the node).
   *  Optional — absent = plain fly-in (back-compatible with callers
   *  that don't yet send it). */
  originRect?: { cx: number; cy: number; width: number };
}

// Kept as open string maps so non-workspace kinds (e.g. "objective",
// "room", "lab" once the objective view opens as a window) resolve too.
const KIND_LABEL: Record<string, string> = {
  brainstorm: "Brainstorm",
  strategy: "Strategy",
  twin: "Digital Twin",
  probe: "Brain Probe",
  space: "R&D Space",
  objective: "Objective",
  room: "Room",
  lab: "Lab",
};

const KIND_ACCENT: Record<string, string> = {
  brainstorm: "#0A84FF",
  strategy: "#7C3AED",
  twin: "#10B981",
  probe: "#F59E0B",
  space: "#E11D48",
  objective: "#7C3AED",
  room: "#DC2626",
  lab: "#2563EB",
};

export function CanvasWorkspaceRoomFullscreen() {
  return (
    <RoomStackProvider>
      <FullscreenWindowStack />
    </RoomStackProvider>
  );
}

function FullscreenWindowStack() {
  const { push, reset, stack } = useRoomStack();
  const [mounted, setMounted] = useState(false);

  // createPortal needs document.body — defer to first client tick.
  useEffect(() => setMounted(true), []);

  // Translate the existing window events into stack ops. Open pushes a
  // window (idempotent: pushing the current top is a no-op); close
  // clears the whole stack (returns to the bare canvas).
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const d = (ev as CustomEvent<OpenDetail>).detail;
      if (!d || !d.href || !d.artifactId) return;
      push({
        id: d.artifactId,
        kind: d.kind,
        title: d.title,
        href: d.href,
        originRect: d.originRect,
      });
    };
    const onClose = () => reset();
    window.addEventListener("canvas-workspace:open-fullscreen", onOpen);
    window.addEventListener("canvas-workspace:close-fullscreen", onClose);
    return () => {
      window.removeEventListener("canvas-workspace:open-fullscreen", onOpen);
      window.removeEventListener("canvas-workspace:close-fullscreen", onClose);
    };
  }, [push, reset]);

  // Lock background scroll while any window is open so scrolling inside
  // an iframe and overshooting doesn't pan the canvas underneath.
  useEffect(() => {
    if (stack.length === 0) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [stack.length]);

  if (!mounted) return null;

  // Near-fullscreen windows: small top/bottom margins so the canvas peeks
  // at the edges ("I'm still in my workspace"), wide maxWidth so the room
  // effectively fills the screen on typical displays.
  return createPortal(
    <RoomStackViewport
      paneFill
      topOffset={32}
      bottomPad={32}
      maxWidth={2000}
      renderRoom={(room, isTop) => <WindowChrome room={room} isTop={isTop} />}
    />,
    document.body,
  );
}

function WindowChrome({ room, isTop }: { room: RoomDescriptor; isTop: boolean }) {
  const { pop, reset } = useRoomStack();
  const accent = KIND_ACCENT[room.kind] ?? "#0A84FF";
  const label = KIND_LABEL[room.kind] ?? "Room";
  const ix = { pointerEvents: isTop ? "auto" : "none" } as const;

  return (
    <div className="flex h-full flex-col">
      {/* Header strip — sits on the glass FloatingCard the viewport wraps
          this in. Compress (×) pops one level; Back to canvas exits all. */}
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: accent }}
            aria-hidden
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: accent }}
          >
            {label}
          </span>
          <span className="truncate text-[13px] font-medium text-gray-900">
            {room.title || "Untitled"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {room.href && (
            <button
              type="button"
              onClick={() => window.open(room.href, "_blank")}
              className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700 ring-1 ring-black/[0.04] transition hover:bg-gray-100"
              title="Open in a new tab"
              style={ix}
            >
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              New tab
            </button>
          )}
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700 ring-1 ring-black/[0.04] transition hover:bg-gray-100"
            title="Return to canvas (Esc)"
            style={ix}
          >
            <Minimize className="h-3 w-3" strokeWidth={1.75} />
            Back to canvas
          </button>
          <button
            type="button"
            onClick={() => pop()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition hover:bg-black/[0.04] hover:text-gray-700"
            title="Compress (Esc)"
            aria-label="Compress window"
            style={ix}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* The room itself — the artifact's real route. key=href resets
          scroll when navigating between rooms without closing. */}
      {room.href && (
        <iframe
          key={room.href}
          src={room.href}
          title={room.title || label}
          className="flex-1 border-0"
          style={{ background: "#f8fafc", pointerEvents: isTop ? "auto" : "none" }}
        />
      )}
    </div>
  );
}
