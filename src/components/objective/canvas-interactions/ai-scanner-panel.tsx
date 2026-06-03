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

import { Fragment, useEffect, useMemo, useState } from "react";
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
  Wand2,
  ArrowRight,
  Thermometer,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  heuristicScan,
  refineScan,
  type ScoredOperation,
} from "@/lib/objective-canvas/scan-recommendations";
import type { OperationTarget } from "@/lib/objective-canvas/canvas-operations";
import {
  opIdForDirection,
  getDirectionEngine,
  type Direction,
} from "@/lib/objective-canvas/converge-diverge";
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
// The strategist's temperature persists across selections (the panel re-keys
// per shape). 0 = precise/repeatable, 1 = exploratory. These ops run on the
// best Claude model (see canvas-operations.ts → augment / idea-op routes).
const TEMP_STORAGE_KEY = "oc:analysis-temperature";
const DEFAULT_TEMPERATURE = 0.4;
const MODEL_LABEL = "Claude Opus 4.1";

export function AiScannerPanel({
  target,
  x,
  y,
  onRun,
  onForge,
  forging = false,
}: {
  target: OperationTarget;
  x: number;
  y: number;
  onRun: (opId: string, temperature: number) => void;
  /** Run the full SpecForge causal-spec chain on this idea (the hero CTA). */
  onForge?: () => void;
  /** True while the chain is running — disables the hero button. */
  forging?: boolean;
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
  // How many leading rows are "recommended" (highlighted, above the divider).
  const [recommendedCount, setRecommendedCount] = useState(3);
  const [refining, setRefining] = useState(true);
  const [ranId, setRanId] = useState<string | null>(null);
  // Entrance — grow + fade from the anchored corner on mount.
  const [shown, setShown] = useState(reduceMotion);

  // Sampling temperature for the analyses, persisted so it carries across
  // selections. Lazily hydrated from localStorage (SSR-safe).
  const [temperature, setTemperature] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_TEMPERATURE;
    const saved = Number(window.localStorage.getItem(TEMP_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1
      ? saved
      : DEFAULT_TEMPERATURE;
  });

  function updateTemperature(next: number) {
    const clamped = Math.min(1, Math.max(0, next));
    setTemperature(clamped);
    try {
      window.localStorage.setItem(TEMP_STORAGE_KEY, String(clamped));
    } catch {
      /* private mode / storage disabled — in-memory value still applies */
    }
  }

  useEffect(() => {
    if (reduceMotion) return;
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [reduceMotion]);

  useEffect(() => {
    const base = heuristicScan(target);
    setRecs(base);
    setRecommendedCount(Math.min(3, base.length));
    setRefining(true);
    let alive = true;
    refineScan(target)
      .then((refined) => {
        if (!alive || !refined || !refined.length) return;
        // Surface the AI's picks first WITHOUT dropping the rest — every
        // operation stays available, just re-ordered + grouped under "More".
        const ids = new Set(refined.map((r) => r.id));
        const rest = base.filter((o) => !ids.has(o.id));
        setRecs([...refined, ...rest]);
        setRecommendedCount(refined.length);
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
    onRun(opId, temperature);
    window.setTimeout(() => setRanId((c) => (c === opId ? null : c)), 1200);
  }

  // The two compressed verbs. WHICH engine they run (the new pipeline vs.
  // regrouping the existing ops) is set by the top toggle, read at click time.
  const [ranDir, setRanDir] = useState<Direction | null>(null);
  function runDirection(dir: Direction) {
    setRanDir(dir);
    onRun(opIdForDirection(dir, getDirectionEngine()), temperature);
    window.setTimeout(() => setRanDir((c) => (c === dir ? null : c)), 1200);
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

      {/* Hero CTA — run the full SpecForge causal-spec chain on this idea.
          Unfurls ~14 decision cards (clean summary → target user → problem
          root → thesis → differentiation → MVPs → recommended build) below. */}
      {onForge && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          disabled={forging}
          onClick={(e) => {
            e.stopPropagation();
            if (!forging) onForge();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            textAlign: "left",
            marginBottom: 8,
            padding: "10px 11px",
            borderRadius: appleVibe.radius.md,
            border: "1px solid rgba(255,255,255,0.14)",
            cursor: forging ? "default" : "pointer",
            background:
              "linear-gradient(135deg, rgba(28,33,48,0.98) 0%, rgba(15,20,33,0.99) 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.14), 0 12px 28px -14px rgba(11,18,40,0.55)",
            opacity: forging ? 0.82 : 1,
            transition: "opacity var(--dur-quick) var(--ease-spring-tight)",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              width: 28,
              height: 28,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 9,
              background: "rgba(255,255,255,0.14)",
              color: "white",
            }}
          >
            {forging ? (
              <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} />
            ) : (
              <Wand2 style={{ width: 15, height: 15 }} strokeWidth={2.2} />
            )}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 650,
                letterSpacing: "-0.01em",
                color: "white",
              }}
            >
              {forging ? "Forging full spec…" : "Forge full spec"}
            </span>
            <span
              style={{
                display: "block",
                marginTop: 1,
                fontSize: 11,
                lineHeight: 1.3,
                color: "rgba(255,255,255,0.62)",
              }}
            >
              {forging
                ? "Streaming decision cards below"
                : "Idea → root cause → MVPs → first build"}
            </span>
          </span>
          {!forging && (
            <ArrowRight
              style={{ width: 15, height: 15, color: "rgba(255,255,255,0.7)" }}
              strokeWidth={2.2}
            />
          )}
        </button>
      )}

      {/* The two compressed verbs — the same move as a card's ‹ › hover glyphs.
          What they run is set by the top engine toggle (pipeline vs. regroup). */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {(
          [
            {
              dir: "diverge",
              Icon: ChevronLeft,
              label: "Diverge",
              hint: "Open up — meta questions → distilled factors",
            },
            {
              dir: "converge",
              Icon: ChevronRight,
              label: "Converge",
              hint: "Narrow — constraint questions → distilled decisions",
            },
          ] as const
        ).map(({ dir, Icon, label, hint }) => {
          const active = ranDir === dir;
          return (
            <button
              key={dir}
              type="button"
              title={hint}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                runDirection(dir);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                flex: 1,
                padding: "9px 10px",
                borderRadius: appleVibe.radius.md,
                border: "1px solid var(--glass-border)",
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 650,
                letterSpacing: "-0.01em",
                fontFamily: appleVibe.font.stack,
                color: appleVibe.text.primary,
                background: appleVibe.surface.chip,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
                transition: rowTransition,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = appleVibe.surface.chipHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = appleVibe.surface.chip;
              }}
            >
              {active ? (
                <Loader2
                  className={reduceMotion ? undefined : "animate-spin"}
                  style={{ width: 14, height: 14 }}
                />
              ) : (
                <Icon style={{ width: 15, height: 15 }} strokeWidth={2.4} />
              )}
              {label}
            </button>
          );
        })}
      </div>

      {/* Operation rows — recommended first, the top one softly highlighted. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {recs.map((op, i) => {
          const Icon = ICONS[op.id] ?? Sparkles;
          const isTop = i === 0;
          const inRecommended = i < recommendedCount;
          const ran = ranId === op.id;
          const showMoreDivider =
            i === recommendedCount && recommendedCount < recs.length;
          return (
            <Fragment key={op.id}>
              {showMoreDivider && (
                <div
                  style={{
                    margin: "6px 6px 2px",
                    fontSize: 10,
                    fontWeight: 600,
                    color: appleVibe.text.faint,
                  }}
                >
                  More options
                </div>
              )}
            <button
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
                background: inRecommended
                  ? appleVibe.surface.chip
                  : "transparent",
                transition: rowTransition,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = appleVibe.surface.chipHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = inRecommended
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
                  {isTop && (
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
            </Fragment>
          );
        })}
      </div>

      {/* Analysis controls — a temperature dial for the AI passes, plus the
          model they run on. Lower = precise/repeatable, higher = exploratory. */}
      <div
        style={{
          marginTop: 9,
          paddingTop: 10,
          borderTop: "1px solid var(--glass-border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 7,
          }}
        >
          <Thermometer
            style={{ width: 12, height: 12, color: appleVibe.text.tertiary }}
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
            Temperature
          </span>
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              height: 17,
              padding: "0 7px",
              borderRadius: appleVibe.radius.pill,
              background: appleVibe.surface.chip,
              fontSize: 11,
              fontWeight: 650,
              fontVariantNumeric: "tabular-nums",
              color: appleVibe.text.primary,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
            }}
          >
            {temperature.toFixed(2)}
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={temperature}
          aria-label="Analysis temperature"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => updateTemperature(Number(e.target.value))}
          style={{
            width: "100%",
            height: 4,
            cursor: "pointer",
            accentColor: appleVibe.accent.primary,
          }}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 4,
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: appleVibe.text.faint,
          }}
        >
          <span>Precise</span>
          <span>Creative</span>
        </div>

        {/* The model these analyses run on — the best available Claude. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            marginTop: 8,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              flexShrink: 0,
              borderRadius: 999,
              background: appleVibe.accent.primary,
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 550,
              color: appleVibe.text.tertiary,
            }}
          >
            Runs on {MODEL_LABEL}
          </span>
        </div>
      </div>
    </div>
  );
}
