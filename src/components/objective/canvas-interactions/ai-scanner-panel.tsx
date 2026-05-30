"use client";

// ── Ai Scanner Panel (canvas-AI-scanner Phase 2) ──
//
// The minimalist floating "what could the AI do with this idea?" plate. Reveals
// off a selected sticky note / text shape (cards carry their own hover menu).
// Vision-Pro glass-float chrome (CANVAS_VISIONPRO_UI_PLAN.md §3 Phase D +
// synergy-node-action-popover): --glass-float material, --blur-float, soft top
// highlight, spring entrance that grows from the source corner, appleVibe
// typography tokens, reduced-motion-safe.
//
// Hybrid recommendations: heuristic ranking shows instantly, then an LLM pass
// patches it (scan-recommendations.ts). Clicking a row runs the operation via
// the host's onRun (→ executeCardOperation → result cards near the source).

import { useEffect, useMemo, useState } from "react";
import {
  Split,
  Shuffle,
  HelpCircle,
  ListChecks,
  Wrench,
  Layers3,
  Workflow,
  Sparkles,
  Loader2,
  Check,
} from "lucide-react";
import {
  heuristicScan,
  refineScan,
  type ScoredOperation,
} from "@/lib/objective-canvas/scan-recommendations";
import type { OperationTarget } from "@/lib/objective-canvas/canvas-operations";
import { appleVibe } from "@/lib/apple-vibe-tokens";

const ICONS: Record<string, typeof Split> = {
  decompose: Split,
  variations: Shuffle,
  questions: HelpCircle,
  make_plan: ListChecks,
  make_technical: Wrench,
  layers: Layers3,
  data_flow: Workflow,
};

const PANEL_W = 300;

export function AiScannerPanel({
  target,
  x,
  y,
  onRun,
}: {
  target: OperationTarget;
  x: number;
  y: number;
  onRun: (opId: string) => void;
}) {
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const [recs, setRecs] = useState<ScoredOperation[]>(() =>
    heuristicScan(target),
  );
  const [refining, setRefining] = useState(true);
  const [ranId, setRanId] = useState<string | null>(null);
  // Entrance — grow + fade from the anchored corner on mount.
  const [shown, setShown] = useState(reduceMotion);

  useEffect(() => {
    if (reduceMotion) return;
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [reduceMotion]);

  useEffect(() => {
    setRecs(heuristicScan(target));
    setRefining(true);
    let alive = true;
    refineScan(target)
      .then((r) => {
        if (alive && r && r.length) setRecs(r);
      })
      .finally(() => {
        if (alive) setRefining(false);
      });
    return () => {
      alive = false;
    };
    // Re-scan when the idea identity / text changes — NOT on every board tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.shapeId, target.text]);

  function run(opId: string) {
    setRanId(opId);
    onRun(opId);
    window.setTimeout(() => setRanId((c) => (c === opId ? null : c)), 1200);
  }

  // Flip to the left of the source if the panel would overflow the right edge.
  const flip =
    typeof window !== "undefined" && x + 12 + PANEL_W > window.innerWidth - 12;
  const left = flip ? Math.max(12, x - PANEL_W - 12) : x + 12;

  const rowTransition = reduceMotion
    ? undefined
    : "background var(--dur-quick) var(--ease-spring-tight), color var(--dur-quick) var(--ease-spring-tight)";

  const idea = target.text.replace(/\s+/g, " ").trim();
  const ideaShort = idea.length > 76 ? `${idea.slice(0, 76)}…` : idea;

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left,
        top: Math.max(12, y),
        width: PANEL_W,
        zIndex: 70,
        padding: 11,
        borderRadius: appleVibe.radius.lg,
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
        border: "1px solid var(--glass-border)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 2px 6px rgba(11,18,40,0.05), 0 22px 48px -20px rgba(11,18,40,0.30)",
        fontFamily: appleVibe.font.stack,
        // Spring entrance — grow from the corner nearest the source.
        transformOrigin: flip ? "top right" : "top left",
        opacity: shown ? 1 : 0,
        transform: shown
          ? "translateY(0) scale(1)"
          : "translateY(6px) scale(0.97)",
        transition: reduceMotion
          ? undefined
          : "opacity var(--dur-normal) var(--ease-spring-soft), transform var(--dur-normal) var(--ease-spring-soft)",
      }}
    >
      {/* Header: sentence-case overline + the idea being scanned. */}
      <div style={{ padding: "1px 3px 9px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Sparkles
            style={{ width: 13, height: 13, color: appleVibe.text.tertiary }}
            strokeWidth={2}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.01em",
              color: appleVibe.text.secondary,
            }}
          >
            What could the AI do here?
          </span>
          {refining && (
            <Loader2
              className={reduceMotion ? undefined : "animate-spin"}
              style={{
                marginLeft: "auto",
                width: 12,
                height: 12,
                color: appleVibe.text.faint,
              }}
            />
          )}
        </div>
        {ideaShort && (
          <div
            style={{
              marginTop: 4,
              marginLeft: 19,
              fontSize: 12,
              fontWeight: 550,
              lineHeight: 1.3,
              color: appleVibe.text.primary,
              letterSpacing: "-0.01em",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {ideaShort}
          </div>
        )}
      </div>

      {/* Operation rows — recommended first, the top one softly highlighted. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {recs.map((op, i) => {
          const Icon = ICONS[op.id] ?? Sparkles;
          const recommended = i === 0;
          const ran = ranId === op.id;
          return (
            <button
              key={op.id}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                run(op.id);
              }}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                width: "100%",
                textAlign: "left",
                padding: "8px 9px",
                borderRadius: appleVibe.radius.sm,
                border: "1px solid transparent",
                cursor: "pointer",
                background: recommended ? appleVibe.surface.chip : "transparent",
                transition: rowTransition,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = appleVibe.surface.chipHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = recommended
                  ? appleVibe.surface.chip
                  : "transparent";
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  marginTop: 0.5,
                  width: 23,
                  height: 23,
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  background: ran ? appleVibe.accent.primary : appleVibe.surface.chip,
                  color: ran ? appleVibe.text.onAccent : appleVibe.text.secondary,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
                }}
              >
                {ran ? (
                  <Check style={{ width: 13, height: 13 }} strokeWidth={2.6} />
                ) : (
                  <Icon style={{ width: 13, height: 13 }} strokeWidth={2} />
                )}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: appleVibe.text.primary,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {op.label}
                  {recommended && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        height: 15,
                        padding: "0 6px",
                        borderRadius: appleVibe.radius.pill,
                        background: appleVibe.surface.chip,
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: "0.01em",
                        color: appleVibe.text.tertiary,
                      }}
                    >
                      Suggested
                    </span>
                  )}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 1.5,
                    fontSize: 11,
                    lineHeight: 1.32,
                    color: appleVibe.text.tertiary,
                  }}
                >
                  {ran ? "Working…" : op.reason}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
