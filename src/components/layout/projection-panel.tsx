"use client";

import { type ReactNode, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProjectionPanelProps {
  open: boolean;
  /** Screen-space origin from the active sidebar button. The card
   *  scales out from this point and the chat-bubble tail anchors here.
   *  Set on click and re-synced by the sidebar on every active-route
   *  change so direct URL loads still get a tail at the right button. */
  originRect: DOMRect | null;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  children: ReactNode;
}

const EASE = [0.22, 1, 0.36, 1] as const;

// Card geometry — generous gutters in non-fullscreen so the whiteboard
// base reads through. Tuned for ≥1280px viewports; on smaller screens
// the inset still leaves a hint of canvas on the right edge.
const INSET_REGULAR = { top: 32, right: 56, bottom: 32, left: 96 };
const TAIL_W = 18;
const TAIL_H = 32;

/**
 * Near-fullscreen glass card that projects out from a sidebar button.
 *
 * Two visual effects make this read as "projecting":
 *  1. the card scales out from a transform-origin computed on the
 *     button's vertical center, with a long Apple-style cubic ease;
 *  2. a chat-bubble tail (SVG triangle) sits at the card's left edge,
 *     pointing at the button. The tail uses the same fill as the card
 *     and overlaps it by 1px to read as a single shape.
 *
 * Fullscreen drops the inset to zero and hides the tail (no card edge
 * to point to). The user opts into fullscreen explicitly via the top
 * button; only the close (X) returns to bare canvas.
 */
export function ProjectionPanel({
  open,
  originRect,
  fullscreen,
  onToggleFullscreen,
  onClose,
  children,
}: ProjectionPanelProps) {
  // Capture viewport so we can position the tail precisely and pick a
  // transform-origin relative to the card. Re-measured on resize.
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const measure = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const insets = fullscreen
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : INSET_REGULAR;

  // Compute tail anchor vertically: align with the button center,
  // clamped inside the card so the tail can't escape the corners.
  const tailY = (() => {
    if (!originRect || !viewport) return null;
    const cardTop = insets.top;
    const cardBottom = viewport.h - insets.bottom;
    const buttonCenterY = originRect.top + originRect.height / 2;
    return Math.max(cardTop + 36, Math.min(cardBottom - 36, buttonCenterY));
  })();

  // Transform origin in card-local %: card scales out from where its
  // left edge meets the button's vertical center. Falls back to mid-
  // left for direct URL loads with no measured rect.
  const transformOrigin = (() => {
    if (!viewport) return "0% 50%";
    if (!originRect) return "8% 50%";
    const cardHeight = viewport.h - insets.top - insets.bottom;
    const yPct =
      cardHeight > 0
        ? ((originRect.top + originRect.height / 2 - insets.top) / cardHeight) * 100
        : 50;
    return `0% ${Math.max(5, Math.min(95, yPct))}%`;
  })();

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Soft backdrop — barely there. Dims the whiteboard behind
              the card just enough to focus attention without losing
              the sense that the canvas is the base. */}
          <motion.div
            key="projection-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="pointer-events-none fixed inset-0 z-30 bg-slate-900/[0.05]"
            aria-hidden
          />

          {/* Chat-bubble tail. Rendered at z-41 so it sits on top of
              the card edge by 1px (the path overlaps the card by 1px
              for a seamless silhouette). Hidden in fullscreen since
              there's no card edge to anchor to. */}
          {!fullscreen && tailY !== null && (
            <motion.svg
              key="projection-tail"
              initial={{ opacity: 0, scale: 0.6, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.6, x: -6 }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.06 }}
              className="pointer-events-none fixed z-[41]"
              style={{
                left: insets.left - TAIL_W + 1,
                top: tailY - TAIL_H / 2,
                width: TAIL_W,
                height: TAIL_H,
                filter:
                  "drop-shadow(-2px 0 4px rgba(15,23,42,0.06)) drop-shadow(0 8px 14px rgba(15,23,42,0.05))",
              }}
              viewBox={`0 0 ${TAIL_W} ${TAIL_H}`}
              aria-hidden
            >
              <path
                d={`M${TAIL_W} 0 L0 ${TAIL_H / 2} L${TAIL_W} ${TAIL_H} Z`}
                fill="white"
              />
            </motion.svg>
          )}

          <motion.section
            key="projection-card"
            role="dialog"
            aria-modal="false"
            initial={{ opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ duration: 0.52, ease: EASE }}
            style={{
              top: insets.top,
              right: insets.right,
              bottom: insets.bottom,
              left: insets.left,
              transformOrigin,
            }}
            className={cn(
              "fixed z-40 flex flex-col overflow-hidden bg-white",
              fullscreen ? "rounded-none" : "rounded-[24px]",
              !fullscreen &&
                // Layered shadow: a tight inset-white lip gives the card
                // a raised-glass feel; a soft white outer glow blends it
                // into the backdrop; the dark drop creates the depth.
                "shadow-[0_0_0_1px_rgba(255,255,255,0.95),0_0_56px_rgba(255,255,255,0.7),0_36px_80px_-24px_rgba(15,23,42,0.25),0_14px_36px_-12px_rgba(15,23,42,0.14)]",
            )}
          >
            {/* Floating chrome — top-right cluster, glass pills.
                Sits absolute over scroll content. */}
            <div className="pointer-events-none absolute right-4 top-4 z-20 flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleFullscreen}
                aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/80 text-[color:var(--muted-fg,#64748b)] shadow-[0_4px_12px_-4px_rgba(15,23,42,0.18)] backdrop-blur transition-all hover:bg-white hover:text-[color:var(--fg,#1d1d1f)]"
              >
                {fullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                title="Close"
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-black/5 bg-white/80 text-[color:var(--muted-fg,#64748b)] shadow-[0_4px_12px_-4px_rgba(15,23,42,0.18)] backdrop-blur transition-all hover:bg-white hover:text-[color:var(--fg,#1d1d1f)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Inner scroll surface — children render here. */}
            <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
              {children}
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
