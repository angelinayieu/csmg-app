"use client";

// ── CanvasWorkspaceRoomFullscreen (universal-canvas Phase A.5) ────
//
// The "state 3" of the room lifecycle. Collapsed → expanded → here.
// Renders the artifact's actual surface in a near-fullscreen modal
// over the canvas, without forcing the user to leave the page or open
// a new tab. The canvas is still alive underneath — we never unmount
// the tldraw editor, so resuming work is instant when the user closes.
//
// Event-driven: each room's header dispatches a
// `canvas-workspace:open-fullscreen` CustomEvent with
// { kind, artifactId, title, href }. This portal listens, holds the
// state, and renders the iframe. Escape key + close button + click-
// on-backdrop all dismiss it. Idempotent: opening over an already-
// open modal just swaps the iframe src — no flicker for re-clicks.
//
// Architecture note: we deliberately render via createPortal so the
// modal escapes the tldraw editor's transform stack. If we rendered
// in-tree, tldraw's CSS transforms (pan/zoom) would warp the modal.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Minimize, X } from "lucide-react";
import type { WorkspaceRoomShape } from "@/components/canvas/shapes/types";

interface OpenDetail {
  kind: WorkspaceRoomShape["props"]["kind"];
  artifactId: string;
  title: string;
  href: string;
}

const KIND_LABEL: Record<WorkspaceRoomShape["props"]["kind"], string> = {
  brainstorm: "Brainstorm",
  strategy: "Strategy",
  twin: "Digital Twin",
  probe: "Brain Probe",
  space: "R&D Space",
};

const KIND_ACCENT: Record<WorkspaceRoomShape["props"]["kind"], string> = {
  brainstorm: "#0A84FF",
  strategy: "#7C3AED",
  twin: "#10B981",
  probe: "#F59E0B",
  space: "#E11D48",
};

export function CanvasWorkspaceRoomFullscreen() {
  const [state, setState] = useState<OpenDetail | null>(null);
  const [mounted, setMounted] = useState(false);

  // Mount gate — createPortal needs document.body, which is undefined
  // during SSR. Defer the portal until the first client tick.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Listen for open + close events. Open events carry the artifact
  // detail; close events are bare and dismiss whatever's open.
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<OpenDetail>).detail;
      if (!detail || !detail.href || !detail.artifactId) return;
      setState(detail);
    };
    const onClose = () => setState(null);
    window.addEventListener("canvas-workspace:open-fullscreen", onOpen);
    window.addEventListener("canvas-workspace:close-fullscreen", onClose);
    return () => {
      window.removeEventListener("canvas-workspace:open-fullscreen", onOpen);
      window.removeEventListener("canvas-workspace:close-fullscreen", onClose);
    };
  }, []);

  // Escape key dismiss + body scroll lock while open. We block the
  // background scroll so the canvas underneath doesn't pan when the
  // user scrolls inside the iframe and overshoots.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [state]);

  const handleOpenInNewTab = useCallback(() => {
    if (!state) return;
    window.open(state.href, "_blank");
  }, [state]);

  const handleClose = useCallback(() => setState(null), []);

  if (!mounted || !state) return null;

  const accent = KIND_ACCENT[state.kind];
  const kindLabel = KIND_LABEL[state.kind];

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${kindLabel} fullscreen`}
    >
      {/* Backdrop — frosted-glass over the canvas. Click to dismiss. */}
      <div
        onClick={handleClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        style={{
          animation: "ws-fullscreen-fade-in 220ms ease forwards",
        }}
      />

      {/* Modal card — near-fullscreen so the embedded artifact has
          room to breathe but the canvas is still visible at the edges
          (reads as "I'm still in my workspace"). */}
      <div
        className="relative flex h-[92vh] w-[94vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/[0.08]"
        style={{
          animation:
            "ws-fullscreen-pop-in 280ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-2.5"
          style={{ background: "rgba(255,255,255,0.96)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: accent }}
              aria-hidden
            />
            <span
              className="font-mono text-[10px] uppercase tracking-[0.18em]"
              style={{ color: accent }}
            >
              {kindLabel}
            </span>
            <span className="truncate text-[13px] font-medium text-gray-900">
              {state.title || "Untitled"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenInNewTab}
              className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700 ring-1 ring-black/[0.04] transition hover:bg-gray-100"
              title="Open in a new tab and leave the canvas"
            >
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              New tab
            </button>
            <button
              onClick={handleClose}
              className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700 ring-1 ring-black/[0.04] transition hover:bg-gray-100"
              title="Return to canvas (Esc)"
            >
              <Minimize className="h-3 w-3" strokeWidth={1.75} />
              Back to canvas
            </button>
            <button
              onClick={handleClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition hover:bg-black/[0.04] hover:text-gray-700"
              title="Close (Esc)"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Iframe — the artifact's actual surface. We pass key=href
            so React replaces the iframe (and resets its scroll) when
            the user navigates between different rooms without closing
            the modal in between. */}
        <iframe
          key={state.href}
          src={state.href}
          title={state.title || kindLabel}
          className="flex-1 border-0"
          style={{ background: "#f8fafc" }}
        />
      </div>

      {/* Inline keyframes — keeps the animation co-located with the
          component and avoids a global stylesheet edit. */}
      <style>{`
        @keyframes ws-fullscreen-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes ws-fullscreen-pop-in {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
