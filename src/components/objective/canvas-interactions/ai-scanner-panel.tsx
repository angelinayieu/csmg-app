"use client";

// ── Ai Scanner Panel (canvas-AI-scanner Phase 2) ──
//
// The minimalist floating "what could the AI do with this idea?" plate. Reveals
// off a selected sticky note / text shape (cards already carry their own hover
// menu). Renders as a Vision-Pro glass-float plate (CANVAS_VISIONPRO_UI_PLAN.md
// §3 Phase D + synergy-node-action-popover's chrome): --glass-float material,
// --blur-float, soft top highlight, sentence-case header, spring motion,
// reduced-motion-safe.
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

const ICONS: Record<string, typeof Split> = {
  decompose: Split,
  variations: Shuffle,
  questions: HelpCircle,
  make_plan: ListChecks,
};

const PANEL_W = 296;

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
  const [recs, setRecs] = useState<ScoredOperation[]>(() =>
    heuristicScan(target),
  );
  const [refining, setRefining] = useState(true);
  const [ranId, setRanId] = useState<string | null>(null);

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

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

  const transition = reduceMotion
    ? undefined
    : "background var(--dur-quick) var(--ease-spring-tight), color var(--dur-quick) var(--ease-spring-tight)";

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left,
        top: Math.max(12, y),
        width: PANEL_W,
        zIndex: 70,
        padding: 10,
        borderRadius: 18,
        background: "var(--glass-float-bg)",
        backdropFilter: "blur(var(--blur-float)) saturate(1.6)",
        WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.6)",
        border: "1px solid var(--glass-border)",
        boxShadow:
          "inset 0 1px 0 var(--glass-highlight), 0 2px 4px rgba(15,23,42,0.04), 0 18px 40px -16px rgba(15,23,42,0.22)",
        fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
      }}
    >
      {/* Header — sentence case, no all-caps eyebrow (Vision Pro plan §2). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 4px 8px",
        }}
      >
        <Sparkles
          style={{ width: 13, height: 13, color: "rgba(15,23,42,0.6)" }}
          strokeWidth={2}
        />
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "rgba(15,23,42,0.82)",
            letterSpacing: "-0.01em",
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
              color: "rgba(15,23,42,0.4)",
            }}
          />
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
                borderRadius: 12,
                border: "1px solid transparent",
                cursor: "pointer",
                background: recommended ? "rgba(15,23,42,0.045)" : "transparent",
                transition,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(15,23,42,0.07)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = recommended
                  ? "rgba(15,23,42,0.045)"
                  : "transparent";
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  marginTop: 1,
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 7,
                  background: "rgba(15,23,42,0.05)",
                  color: "rgba(15,23,42,0.72)",
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
                    color: "rgba(15,23,42,0.9)",
                  }}
                >
                  {op.label}
                  {recommended && (
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: "rgba(15,23,42,0.4)",
                      }}
                    >
                      · suggested
                    </span>
                  )}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 1,
                    fontSize: 11,
                    lineHeight: 1.32,
                    color: "rgba(15,23,42,0.52)",
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
