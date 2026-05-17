"use client";

// ── CanvasTwinRevealOrchestrator (cinematic Phase 1) ──────────────
//
// The "twin is ready" climax moment. When the pipeline event painter
// spawns a TwinSnapshotShape for the first time in this session, the
// orchestrator takes over the canvas for ~4 seconds:
//
//   T+0     — zoom-to-twin-snapshot (1.2s, easeInOut)
//   T+0.3s  — headline fades in: "Your digital twin is ready"
//   T+2.5s  — headline fades out
//   T+3.0s  — zoom-to-fit (800ms) so user sees full landscape
//   T+3.5s  — "Open twin →" CTA pulses in bottom-center
//   T+8.5s  — CTA auto-fades
//
// Idempotent — fires once per canvas mount. Re-mount (page refresh,
// SPA route change) resets the gate so the user sees the moment again
// if they revisit.
//
// Also responds to a window CustomEvent `twin:reveal-debug` so the
// sequence can be triggered manually for testing (since real twins
// can take minutes to materialize during pipeline runs). The debug
// event finds any existing twin-snapshot OR workspace-room kind=twin
// shape and fires against it.
//
// Lives inside the InFrontOfTheCanvas tree so it gets useEditor() +
// access to tldraw's camera controls.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { useEditor, type Editor, type TLShapeId } from "tldraw";

type Phase = "idle" | "zooming-in" | "headline" | "settling" | "cta" | "done";

interface RevealState {
  phase: Phase;
  twinShapeId: TLShapeId | null;
  spaceId: string | null;
}

const ZOOM_IN_MS = 1200;
const HEADLINE_LEAD_MS = 300; // delay after zoom starts before headline shows
const HEADLINE_HOLD_MS = 2200;
const HEADLINE_FADE_MS = 400;
const ZOOM_OUT_MS = 800;
const CTA_HOLD_MS = 5000;
const CTA_FADE_MS = 600;

export function CanvasTwinRevealOrchestrator({
  spaceId,
}: {
  spaceId: string;
}) {
  const editor = useEditor();
  const router = useRouter();
  const [state, setState] = useState<RevealState>({
    phase: "idle",
    twinShapeId: null,
    spaceId: null,
  });
  // useRef gate so the orchestrator only fires once per mount.
  const hasFiredRef = useRef(false);
  // Track active timeouts so we can clean up on unmount mid-sequence.
  const timeoutsRef = useRef<number[]>([]);

  const clearTimeouts = useCallback(() => {
    for (const id of timeoutsRef.current) window.clearTimeout(id);
    timeoutsRef.current = [];
  }, []);

  const scheduleTimeout = useCallback((fn: () => void, delay: number) => {
    const id = window.setTimeout(fn, delay);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  /** Fire the climax sequence against the given twin shape. */
  const fireSequence = useCallback(
    (twinShapeId: TLShapeId) => {
      if (hasFiredRef.current) return;
      hasFiredRef.current = true;

      // Cinematic Phase 4 mutual exclusion — mark the body so the
      // CanvasSceneDirector pauses its queue while the twin reveal
      // owns the camera. Cleared in the final phase ("done") below.
      if (typeof document !== "undefined") {
        document.body.setAttribute("data-canvas-twin-reveal-active", "true");
      }

      // Phase 1: zoom to the twin shape's bounds
      try {
        const bounds = editor.getShapePageBounds(twinShapeId);
        if (!bounds) {
          hasFiredRef.current = false;
          if (typeof document !== "undefined") {
            document.body.removeAttribute("data-canvas-twin-reveal-active");
          }
          return;
        }
        // Expand bounds slightly so the shape isn't pressed against
        // the viewport edge — gives the headline overlay room above.
        const padded = {
          x: bounds.x - 80,
          y: bounds.y - 160, // extra top room for headline
          w: bounds.w + 160,
          h: bounds.h + 200,
        };
        editor.zoomToBounds(padded, {
          animation: { duration: ZOOM_IN_MS, easing: easeInOutQuart },
          inset: 0,
        });
      } catch (err) {
        console.warn("[twin-reveal] zoomToBounds failed:", err);
        hasFiredRef.current = false;
        return;
      }

      setState({ phase: "zooming-in", twinShapeId, spaceId });

      // Phase 2 (T+0.3s): show headline
      scheduleTimeout(() => {
        setState((s) => ({ ...s, phase: "headline" }));
      }, HEADLINE_LEAD_MS);

      // Phase 3 (T+0.3s + hold + fade): start zoom-out
      scheduleTimeout(
        () => {
          setState((s) => ({ ...s, phase: "settling" }));
          try {
            editor.zoomToFit({
              animation: { duration: ZOOM_OUT_MS, easing: easeInOutQuart },
            });
          } catch {
            // No-op — if zoomToFit fails the camera just stays put.
          }
        },
        HEADLINE_LEAD_MS + HEADLINE_HOLD_MS + HEADLINE_FADE_MS,
      );

      // Phase 4 (after zoom-out): CTA appears
      scheduleTimeout(
        () => {
          setState((s) => ({ ...s, phase: "cta" }));
        },
        HEADLINE_LEAD_MS +
          HEADLINE_HOLD_MS +
          HEADLINE_FADE_MS +
          ZOOM_OUT_MS,
      );

      // Phase 5 (after CTA hold): fade CTA + release mutual-exclusion
      scheduleTimeout(
        () => {
          setState((s) => ({ ...s, phase: "done" }));
          // Release the body attribute so any queued scene-director
          // spotlights (Phase 4) can resume.
          if (typeof document !== "undefined") {
            document.body.removeAttribute("data-canvas-twin-reveal-active");
          }
        },
        HEADLINE_LEAD_MS +
          HEADLINE_HOLD_MS +
          HEADLINE_FADE_MS +
          ZOOM_OUT_MS +
          CTA_HOLD_MS +
          CTA_FADE_MS,
      );
    },
    [editor, scheduleTimeout, spaceId],
  );

  // Listen to tldraw store events for shape creation. When a
  // twin-snapshot OR a workspace-room with kind="twin" lands, fire
  // the sequence. Skips if we've already fired in this session.
  useEffect(() => {
    if (!editor) return;

    // Run an initial scan in case the twin shape already exists when
    // the orchestrator mounts (e.g., user navigated away and back, or
    // the painter spawned it before this component rendered).
    const existing = findTwinShape(editor);
    if (existing && !hasFiredRef.current) {
      // Defer by a frame so initial canvas paint completes first.
      scheduleTimeout(() => fireSequence(existing), 60);
    }

    const unlisten = editor.store.listen(
      (entry) => {
        if (entry.source !== "user" && entry.source !== "remote") {
          // Programmatic store changes — could include painter-spawned
          // shapes. We want those too.
        }
        for (const record of Object.values(entry.changes.added)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = record as any;
          if (r?.typeName !== "shape") continue;
          const isTwinSnapshot = r.type === "twin-snapshot";
          const isWorkspaceTwin =
            r.type === "workspace-room" &&
            r.props &&
            r.props.kind === "twin";
          if (!isTwinSnapshot && !isWorkspaceTwin) continue;
          if (hasFiredRef.current) continue;
          fireSequence(r.id as TLShapeId);
          return;
        }
      },
      { scope: "all", source: "all" },
    );

    return unlisten;
  }, [editor, fireSequence, scheduleTimeout]);

  // Debug trigger — `window.dispatchEvent(new CustomEvent("twin:reveal-debug"))`
  // re-fires against the first matching shape on canvas. Useful for
  // demoing without waiting for a real pipeline run.
  useEffect(() => {
    function onDebug() {
      hasFiredRef.current = false;
      clearTimeouts();
      const target = findTwinShape(editor);
      if (!target) {
        console.warn(
          "[twin-reveal] debug fired but no twin shape on canvas",
        );
        return;
      }
      fireSequence(target);
    }
    window.addEventListener("twin:reveal-debug", onDebug);
    return () => window.removeEventListener("twin:reveal-debug", onDebug);
  }, [editor, fireSequence, clearTimeouts]);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      clearTimeouts();
      // Ensure the mutual-exclusion attribute is cleared if the
      // orchestrator unmounts mid-sequence (e.g., user navigates
      // away during the reveal).
      if (typeof document !== "undefined") {
        document.body.removeAttribute("data-canvas-twin-reveal-active");
      }
    };
  }, [clearTimeouts]);

  const handleOpenTwin = () => {
    router.push(`/app/space/${spaceId}/twin`);
  };

  // ── Render: portal-style overlay over the canvas ──

  // Headline visibility
  const showHeadline = state.phase === "headline";

  // CTA visibility
  const showCTA = state.phase === "cta";

  // Only render the overlay portal when we're actively in a phase
  // that needs UI. "done" + "idle" render nothing.
  if (state.phase === "idle" || state.phase === "done") return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-40"
      style={{ overflow: "hidden" }}
    >
      {/* Headline — appears above-center while the camera is on the
          twin. Fades in/out via opacity transitions. */}
      <div
        className="absolute left-1/2 top-[18%] -translate-x-1/2"
        style={{
          opacity: showHeadline ? 1 : 0,
          transform: `translate(-50%, ${showHeadline ? "0" : "-12px"})`,
          transition: `opacity 380ms cubic-bezier(0.22, 1, 0.36, 1), transform 380ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      >
        <div
          className="inline-flex items-center gap-2 rounded-full px-5 py-2"
          style={{
            background: "rgba(255, 255, 255, 0.88)",
            backdropFilter: "blur(18px) saturate(180%)",
            WebkitBackdropFilter: "blur(18px) saturate(180%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(15,23,42,0.04), 0 14px 32px -12px rgba(15,23,42,0.18)",
          }}
        >
          <span
            aria-hidden
            className="inline-flex h-5 w-5 items-center justify-center rounded-full"
            style={{
              background: "rgba(16, 185, 129, 0.12)",
              color: "#10b981",
            }}
          >
            <Sparkles className="h-3 w-3" strokeWidth={1.75} />
          </span>
          <span className="font-display-tight text-[14px] font-medium tracking-tight text-gray-900">
            Your digital twin is ready
          </span>
        </div>
      </div>

      {/* CTA — bottom-center floating pill. Pulses gently to draw
          attention without being demanding. Pointer-events on so it's
          clickable while the rest of the overlay is transparent. */}
      <div
        className="pointer-events-auto absolute bottom-[12%] left-1/2 -translate-x-1/2"
        style={{
          opacity: showCTA ? 1 : 0,
          transform: `translate(-50%, ${showCTA ? "0" : "8px"})`,
          transition: `opacity ${CTA_FADE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${CTA_FADE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      >
        <button
          onClick={handleOpenTwin}
          className="group inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition hover:scale-[1.03]"
          style={{
            background:
              "linear-gradient(180deg, #10b981 0%, #059669 100%)",
            boxShadow:
              "0 0 0 1px rgba(16,185,129,0.4), 0 10px 30px -10px rgba(16,185,129,0.55), inset 0 1px 0 rgba(255,255,255,0.3)",
            animation: showCTA
              ? "twinRevealCtaPulse 2.4s ease-in-out infinite"
              : "none",
          }}
        >
          Open the twin
          <ArrowUpRight
            className="h-3.5 w-3.5 transition group-hover:rotate-12"
            strokeWidth={1.75}
          />
        </button>
      </div>

      <style jsx>{`
        @keyframes twinRevealCtaPulse {
          0%,
          100% {
            box-shadow:
              0 0 0 1px rgba(16, 185, 129, 0.4),
              0 10px 30px -10px rgba(16, 185, 129, 0.55),
              inset 0 1px 0 rgba(255, 255, 255, 0.3);
          }
          50% {
            box-shadow:
              0 0 0 2px rgba(16, 185, 129, 0.6),
              0 14px 40px -10px rgba(16, 185, 129, 0.7),
              inset 0 1px 0 rgba(255, 255, 255, 0.3);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          button[style*="twinRevealCtaPulse"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ──

/** easeInOutQuart — tldraw's animation easing functions accept a t→t
 *  callable. This curve feels more cinematic than linear or basic
 *  cubic for the camera move. */
function easeInOutQuart(t: number): number {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

/** Find a twin shape on the current page — prefers twin-snapshot,
 *  falls back to workspace-room kind="twin". */
function findTwinShape(editor: Editor): TLShapeId | null {
  const all = editor.getCurrentPageShapes();
  for (const s of all) {
    if (s.type === "twin-snapshot") return s.id;
  }
  for (const s of all) {
    if (s.type !== "workspace-room") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = s.props as any;
    if (props?.kind === "twin") return s.id;
  }
  return null;
}
