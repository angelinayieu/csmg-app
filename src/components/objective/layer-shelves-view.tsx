"use client";

// ── Layer Shelves View ────────────────────────────────────────────
//
// The unified Objective Canvas spine. Replaces the old triple-stack
// of (ObjectiveStack widget) + (theme rows) + (card grid) with ONE
// system: the causal stack's layers become horizontal "shelves",
// and every sub-objective lives inside the shelf for the layer it
// operates at (its `layerOrdinals`). No second grouping axis — the
// concept-cluster theme demotes to a small chip on each card.
//
// Per design lock (2026-05-28):
//   • Bands ARE the canvas — the stack widget's variables + coverage
//     fold into each shelf header; there is no separate stack widget
//     and no theme-row gallery in this view.
//   • Cards are frosted flashcards. Collapsed front = title + status
//     + color-coded RESULTS pills only. Expand reveals the full
//     Problems × Mechanisms × Results tree + approved plays.
//   • Each shelf is a drag-to-scroll horizontal gallery with
//     scroll-snap + edge-fade masks (premium spatial feel).
//
// Placement rule: a sub is shown on the shelf of its HIGHEST ordinal
// (most emergent layer it touches); lower ordinals it bridges are
// badged on the card. Untagged subs (pre-stack picks) collect in an
// "Unplaced" shelf at the bottom so nothing is silently dropped.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, Loader2 } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { ARCHETYPE_COLOR } from "@/components/objective/objective-stack";
import { RetagCardsButton } from "@/components/objective/retag-cards-button";
import { GroupCardsButton } from "@/components/objective/group-cards-button";
import { NestedChildCard } from "@/components/objective/nested-child-card";
import type {
  LayerInfluenceVerb,
  ObjectiveLayer,
  ObjectiveStack,
} from "@/lib/objective-canvas/layer-model";
import type {
  LaneBreakdownRow,
  MainCanvasSub,
} from "@/components/objective/main-canvas-view";
import type { ClusterAnalysis } from "@/lib/objective-canvas/cluster-proposals";
import {
  SUB_PROGRESS_STAGES,
  type SubProgress,
} from "@/lib/objective-canvas/elected-ready-variations";

const VERB_LABEL: Record<LayerInfluenceVerb, string> = {
  enables: "enables",
  produces: "produces",
  depends_on: "depends on",
  constrains: "constrains",
  measures: "measures",
  aggregates: "aggregates",
};

const CARD_WIDTH = 296;
// Constant folder-tab lane height. Reserved on EVERY card (labeled or
// not) so all card bodies in a shelf align along one top edge — the
// tab's height must never shift the body, or sibling cards stagger.
const TAB_H = 22;

// Append an alpha byte to a #RRGGBB hex so a category color can be used
// at a fractional opacity (e.g. `${color}${alphaHex(0.16)}`).
function alphaHex(a: number): string {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return v.toString(16).padStart(2, "0");
}

// ── Build the route to a sub-objective room. The Objective Canvas
//    layout (`ObjectiveCanvasShell`) already swaps the room view as a
//    floating window over the persistent whiteboard when this URL
//    activates, so plain Next.js navigation is the correct mechanism —
//    NOT the iframe-based `canvas-workspace:open-fullscreen` event,
//    which only has a listener mounted on the whiteboard space route
//    and would fire into a void here.
export function roomHref(spaceId: string, subId: string): string {
  return `/app/objective/${spaceId}/sub/${subId}`;
}

// ── Drag-to-scroll hook ───────────────────────────────────────────
// Horizontal-only: only hijacks the pointer once movement is clearly
// horizontal (|dx| > |dy| and past a threshold) so vertical page
// scroll is never stolen. Exposes a ref the card click-handlers read
// to suppress the "click" that ends a drag.
function useDragScroll() {
  const ref = useRef<HTMLDivElement | null>(null);
  const didDrag = useRef(false);
  const state = useRef<{
    down: boolean;
    capturing: boolean;
    startX: number;
    startY: number;
    startScroll: number;
    pointerId: number;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    didDrag.current = false;
    state.current = {
      down: true,
      capturing: false,
      startX: e.clientX,
      startY: e.clientY,
      startScroll: ref.current?.scrollLeft ?? 0,
      pointerId: e.pointerId,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = state.current;
    if (!s || !s.down || !ref.current) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.capturing) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
        s.capturing = true;
        didDrag.current = true;
        ref.current.setPointerCapture?.(s.pointerId);
      } else {
        return;
      }
    }
    e.preventDefault();
    ref.current.scrollLeft = s.startScroll - dx;
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    const s = state.current;
    if (s?.capturing && ref.current) {
      ref.current.releasePointerCapture?.(s.pointerId);
    }
    state.current = null;
    // Let the trailing click fire first, then clear the flag.
    if (didDrag.current) {
      window.setTimeout(() => {
        didDrag.current = false;
      }, 0);
    }
  }, []);

  return {
    ref,
    didDrag,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}

// ── Progress → stage pill ─────────────────────────────────────────
// The single status signal: names the pipeline stage the sub has
// reached. Color ramps gray → accent → green (export-ready), so it
// doubles as a readiness cue without a second "status" pill.
const DELIVERED = SUB_PROGRESS_STAGES.length; // completed === 5

function stagePillTone(progress: SubProgress, accent: string) {
  if (progress.completed >= DELIVERED) {
    return { bg: "rgba(22,163,74,0.12)", fg: "rgba(20,83,45,0.95)" };
  }
  if (progress.completed === 0) {
    return { bg: appleVibe.surface.chip, fg: appleVibe.text.tertiary };
  }
  return { bg: `${accent}16`, fg: accent };
}

function StagePill({
  progress,
  accent,
}: {
  progress: SubProgress;
  accent: string;
}) {
  const tone = stagePillTone(progress, accent);
  const label = progress.current
    ? SUB_PROGRESS_STAGES.find((s) => s.key === progress.current)!.short
    : "Not started";
  const delivered = progress.completed >= DELIVERED;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.08em]"
      style={{ background: tone.bg, color: tone.fg }}
      title={
        progress.current
          ? SUB_PROGRESS_STAGES.find((s) => s.key === progress.current)!.label
          : "Pipeline not started"
      }
    >
      {delivered && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      {label}
    </span>
  );
}

// ── Progress bar — 5 segmented pips, one per pipeline stage ────────
function ProgressTrack({
  progress,
  accent,
}: {
  progress: SubProgress;
  accent: string;
}) {
  const delivered = progress.completed >= DELIVERED;
  const fill = delivered ? "#16A34A" : accent;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span
          className="text-[9px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Progress
        </span>
        <span
          className="font-mono text-[9px] tabular-nums"
          style={{ color: appleVibe.text.faint }}
        >
          {progress.completed}/{SUB_PROGRESS_STAGES.length}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {SUB_PROGRESS_STAGES.map((s, i) => {
          const on = i < progress.completed;
          return (
            <span
              key={s.key}
              title={s.label}
              className="h-[5px] flex-1 rounded-full transition-colors"
              style={{
                background: on ? fill : "rgba(15,23,42,0.07)",
                boxShadow: on ? `0 0 6px ${fill}55` : "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Results pills — the collapsed card's headline ─────────────────
function ResultsPills({
  rows,
  total,
}: {
  rows: LaneBreakdownRow[];
  total: number;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.count - a.count),
    [rows],
  );
  const shown = sorted.slice(0, 4);
  const overflow = sorted.length - shown.length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Results
        </span>
        <span
          className="font-mono text-[9px]"
          style={{ color: appleVibe.text.faint }}
        >
          {total}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {shown.length > 0 ? (
          shown.map((r, i) => {
            // Importance ramp — pills are already sorted by count desc.
            // The #1 result is a SOLID saturated chip (white text) so it
            // unmistakably anchors the list; ranks below fade off steeply
            // as graded tints with dark text. A narrow tint range reads as
            // "all the same color", so the lead must be fully saturated.
            const lead = i === 0;
            const fade = Math.pow(0.6, i); // 1 · 0.6 · 0.36 · 0.216
            return (
              <span
                key={r.label}
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10.5px]"
                style={{
                  background: lead
                    ? r.color
                    : `${r.color}${alphaHex(0.4 * fade)}`,
                  border: `1px solid ${r.color}${alphaHex(lead ? 1 : 0.32 * fade)}`,
                  color: lead
                    ? "#ffffff"
                    : `rgba(15,23,42,${(0.5 + 0.4 * fade).toFixed(3)})`,
                  fontWeight: lead ? 700 : 500,
                  boxShadow: lead
                    ? `0 1px 5px ${r.color}66, inset 0 1px 0 rgba(255,255,255,0.28)`
                    : "none",
                }}
                title={`${r.label} · ${r.count}`}
              >
                <span
                  className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{
                    background: lead ? "rgba(255,255,255,0.95)" : r.color,
                    opacity: lead ? 1 : 0.35 + 0.55 * fade,
                  }}
                  aria-hidden
                />
                <span className="max-w-[120px] truncate">{r.label}</span>
                {r.count > 1 && (
                  <span
                    className="font-mono text-[9px]"
                    style={{
                      color: lead
                        ? "rgba(255,255,255,0.82)"
                        : appleVibe.text.tertiary,
                    }}
                  >
                    {r.count}
                  </span>
                )}
              </span>
            );
          })
        ) : (
          <span
            className="text-[10px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            uncategorized
          </span>
        )}
        {overflow > 0 && (
          <span
            className="inline-flex items-center rounded-full px-1.5 py-[3px] text-[10px] font-medium"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.tertiary,
            }}
          >
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Expanded lane tree (the "back" of the flashcard) ──────────────
function LaneTreeRow({
  label,
  laneColor,
  total,
  rows,
}: {
  label: string;
  laneColor: string;
  total: number;
  rows: LaneBreakdownRow[];
}) {
  if (total === 0) return null;
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <span
          className="block h-1.5 w-1.5 rounded-full"
          style={{ background: laneColor }}
          aria-hidden
        />
        <span
          className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: laneColor }}
        >
          {label}
        </span>
        <span
          className="font-mono text-[9px]"
          style={{ color: appleVibe.text.tertiary }}
        >
          {total}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 pl-3">
        {sorted.length > 0 ? (
          sorted.map((r) => (
            <span
              key={r.label}
              className="inline-flex items-center gap-1 text-[10.5px] font-medium"
              style={{ color: appleVibe.text.secondary }}
            >
              <span
                className="block h-1.5 w-1.5 rounded-full"
                style={{ background: r.color }}
                aria-hidden
              />
              {r.label}
              <span
                className="font-mono text-[9px]"
                style={{ color: appleVibe.text.faint }}
              >
                {r.count}
              </span>
            </span>
          ))
        ) : (
          <span
            className="text-[10px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            uncategorized
          </span>
        )}
      </div>
    </div>
  );
}

// ── Flashcard ─────────────────────────────────────────────────────
// Exported so the /preflight/card-variants harness can render the
// production card as a bare baseline next to candidate redesigns.
export function LayerFlashcard({
  spaceId,
  sub,
  accent,
  themeLabel,
  tabFade,
  bridgesTo,
  getDragged,
}: {
  spaceId: string;
  sub: MainCanvasSub;
  accent: string;
  themeLabel: string | null;
  tabFade: number;
  bridgesTo: number[];
  getDragged: () => boolean;
}) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  // `loading` shows the click was registered while the destination
  // route's RSC payload streams in. Reset whenever the URL actually
  // becomes (or includes) the destination — covers both a successful
  // route swap AND a back-nav that lands somewhere unexpected, so the
  // card never gets stuck in the loading visual.
  const [loading, setLoading] = useState(false);
  const targetHref = roomHref(spaceId, sub.id);
  useEffect(() => {
    if (loading && pathname?.startsWith(targetHref)) setLoading(false);
  }, [loading, pathname, targetHref]);
  // Prefetched once per hover: Next.js dedupes, but we still gate to
  // avoid scheduling a refresh on every micro-hover.
  const prefetched = useRef(false);

  const isApproved = sub.approvedItems.length > 0 || sub.approvedPlayCount > 0;
  // The glow is the card's permanent layer identity — ALWAYS the layer
  // accent, never repainted by pipeline state. Readiness is signalled
  // by the stage pill + progress bar instead, so a card never changes
  // which layer it visually belongs to (was: green when delivered,
  // which made a ready card on the purple layer read as a green-layer
  // card — the consistency bug).
  const glow = accent;

  // Folder-tab importance depth. Text is ALWAYS the deep accent (never
  // white-on-solid, which was hard to read), and the fill stays faint so
  // the label reads clearly. Importance is encoded by tint depth alone —
  // dominant category ~0.28, least-important ~0.06.
  const tabTopA = 0.05 + 0.23 * tabFade;
  const tabBotA = tabTopA * 0.35;

  const hasResults = sub.laneTotalCounts.result > 0;
  const hasTree =
    sub.laneTotalCounts.friction +
      sub.laneTotalCounts.mechanism +
      sub.laneTotalCounts.result >
    0;

  // Inline expand of the Problems/Mechanisms/Results tree. Secondary to
  // the card's primary action (open the room) — so its triggers
  // stopPropagation to avoid also firing the card-open.
  const toggle = () => {
    if (getDragged()) return;
    if (!hasTree) return;
    setExpanded((v) => !v);
  };

  // Primary action: the WHOLE card opens the room (matching the grid
  // SubCard affordance). Suppressed when the pointer-up ends a
  // drag-scroll so scrolling the gallery never navigates. Re-clicking
  // while a navigation is already in flight is a no-op so the user
  // can't queue duplicate pushes.
  const openRoom = (e: React.MouseEvent) => {
    if (getDragged()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    if (loading) return;
    e.preventDefault();
    setLoading(true);
    router.push(targetHref);
  };

  // Warm the room route's RSC payload on hover so the actual click
  // hits a primed cache. The ObjectiveCanvasShell also prefetches
  // every room on mount, but a fresh deploy / cache-eviction can
  // make that miss — re-prefetching on hover guarantees the click
  // path is hot.
  const onHoverPrefetch = () => {
    if (prefetched.current) return;
    prefetched.current = true;
    try {
      router.prefetch(targetHref);
    } catch {
      /* prefetch best-effort */
    }
  };

  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -5 }}
      onHoverStart={() => {
        setHovered(true);
        onHoverPrefetch();
      }}
      onHoverEnd={() => setHovered(false)}
      onPointerEnter={onHoverPrefetch}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      role="button"
      tabIndex={0}
      aria-busy={loading}
      onClick={openRoom}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (loading) return;
          e.preventDefault();
          setLoading(true);
          router.push(targetHref);
        }
      }}
      className="group/card relative flex flex-shrink-0 cursor-pointer flex-col"
      style={{
        width: CARD_WIDTH,
        scrollSnapAlign: "start",
        fontFamily: appleVibe.font.stack,
        // Soft accent-tinted drop-shadow glow that traces the folder
        // silhouette (tab + body). Replaces the old colored side spine.
        // When loading, push the glow brighter so the card itself
        // becomes the "click registered" cue.
        filter: loading
          ? `drop-shadow(0 18px 40px ${glow}66) drop-shadow(0 6px 14px ${glow}33)`
          : hovered
            ? `drop-shadow(0 16px 34px ${glow}40) drop-shadow(0 5px 12px rgba(15,23,42,0.10))`
            : `drop-shadow(0 8px 20px ${glow}24) drop-shadow(0 2px 5px rgba(15,23,42,0.06))`,
        transition: "filter 0.28s ease",
      }}
    >
      {/* Folder-tab lane — CONSTANT height on every card so all card
          bodies in a shelf align on one top edge. The tab is a soft
          accent gradient that fades into the white card body at its
          bottom edge, so tab + body read as one folder silhouette under
          the shared glow (no hard rim). Every themed card carries its
          own labeled tab; untagged cards reserve the lane silently. */}
      <div
        className="relative z-20 flex items-end"
        style={{ height: TAB_H, marginBottom: -1 }}
        aria-hidden={!themeLabel}
      >
        {themeLabel && (
          <span
            className="block truncate pl-4 pr-3.5 text-[10px] font-semibold leading-[21px] tracking-[0.01em]"
            style={{
              maxWidth: CARD_WIDTH - 14,
              // Folder lip: flush to the card's left edge (no inset, so
              // the card's top-left corner can't peek out beside it).
              // Left edge runs straight up from the body; both top
              // corners round equally, like a real folder tab.
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
              background: `linear-gradient(180deg, ${accent}${alphaHex(tabTopA)} 0%, ${accent}${alphaHex(tabBotA)} 100%)`,
              color: accent,
              boxShadow: `inset 0 1px 0 ${accent}40`,
            }}
            title={`Category · ${themeLabel}`}
          >
            {themeLabel}
          </span>
        )}
      </div>

      <div
        className="relative z-10 flex min-h-[212px] flex-1 flex-col gap-2 px-4 pb-3 pt-3.5"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${
            isApproved ? "rgba(22,163,74,0.30)" : appleVibe.stroke.soft
          }`,
          // Square the top-left so the left edge runs continuously into
          // the tab above it — the folder silhouette. Other corners keep
          // the soft card radius.
          borderTopLeftRadius: themeLabel ? 0 : appleVibe.radius.xl,
          borderTopRightRadius: appleVibe.radius.xl,
          borderBottomLeftRadius: appleVibe.radius.xl,
          borderBottomRightRadius: appleVibe.radius.xl,
        }}
      >
        {/* Meta row — bridge badge left, pipeline-stage pill right */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {bridgesTo.length > 0 && (
              <span
                className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.06em]"
                style={{ background: `${accent}12`, color: accent }}
                title={`Also operates at ${bridgesTo.map((o) => `L${o}`).join(", ")}`}
              >
                bridges {bridgesTo.map((o) => `L${o}`).join(", ")}
              </span>
            )}
          </div>
          <StagePill progress={sub.progress} accent={accent} />
        </div>

        {/* Title — clicking anywhere on the card opens the room, so the
            title is plain text (no separate handler). */}
        <h3
          className="text-[14.5px] font-semibold leading-snug tracking-tight"
          style={{
            color: appleVibe.text.primary,
            fontFamily: appleVibe.font.display,
          }}
        >
          {sub.title}
        </h3>

        {/* Results pills — the headline payoff */}
        {hasResults ? (
          <ResultsPills
            rows={sub.laneBreakdown.result}
            total={sub.laneTotalCounts.result}
          />
        ) : (
          <span
            className="text-[10.5px] font-light italic"
            style={{ color: appleVibe.text.faint }}
          >
            {!sub.generatedAt
              ? "No results yet · open the room"
              : "Results pending"}
          </span>
        )}

        {/* Expanded tree */}
        <AnimatePresence initial={false}>
          {expanded && hasTree && (
            <motion.div
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduce ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: "hidden" }}
            >
              <div
                className="mt-1 flex flex-col gap-2.5 rounded-2xl p-3"
                style={{
                  background: "rgba(15,23,42,0.025)",
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                  borderRadius: appleVibe.radius.md,
                }}
              >
                <LaneTreeRow
                  label="Problems"
                  laneColor={appleVibe.stage.pain}
                  total={sub.laneTotalCounts.friction}
                  rows={sub.laneBreakdown.friction}
                />
                <LaneTreeRow
                  label="Mechanisms"
                  laneColor={appleVibe.stage.features}
                  total={sub.laneTotalCounts.mechanism}
                  rows={sub.laneBreakdown.mechanism}
                />
                <LaneTreeRow
                  label="Results"
                  laneColor={appleVibe.stage.outcomes}
                  total={sub.laneTotalCounts.result}
                  rows={sub.laneBreakdown.result}
                />
                {sub.approvedPlayCount > 0 && (
                  <div
                    className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: "rgba(20,83,45,0.9)" }}
                  >
                    {sub.approvedPlayCount} approved play
                    {sub.approvedPlayCount === 1 ? "" : "s"}
                  </div>
                )}
                {sub.rationale && (
                  <p
                    className="text-[10.5px] font-light italic leading-snug"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    {sub.rationale}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom anatomy — pinned so every card in a shelf aligns its
            progress + footer regardless of how much middle content the
            room has generated. */}
        <div className="mt-auto flex flex-col gap-2 pt-1.5">
          {/* Pipeline progress — analyzed → … → export-ready */}
          <ProgressTrack progress={sub.progress} accent={accent} />

          {/* Footer — Details toggle (secondary; stops propagation so it
              expands inline without opening the room) + an "Open room"
              cue. The whole card is the click target, so the cue is a
              plain visual hint, not a nested link. */}
          <div className="flex items-center justify-between">
          {hasTree ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              className="inline-flex items-center gap-1 text-[10.5px] font-medium transition-colors"
              style={{ color: appleVibe.text.tertiary }}
            >
              <ChevronDown
                className="h-3 w-3 transition-transform"
                strokeWidth={2}
                style={{
                  transform: expanded ? "rotate(180deg)" : "none",
                }}
              />
              {expanded ? "Less" : "Details"}
            </button>
          ) : (
            <span />
          )}
          <span
            className="inline-flex items-center gap-1 text-[10.5px] font-semibold transition-colors"
            style={{ color: accent }}
          >
            {loading ? (
              <>
                <Loader2
                  className="h-3 w-3 animate-spin"
                  strokeWidth={2.2}
                />
                Opening…
              </>
            ) : (
              <>
                Open room
                <ArrowRight
                  className="h-3 w-3 transition-transform group-hover/card:translate-x-0.5"
                  strokeWidth={2.2}
                />
              </>
            )}
          </span>
          </div>
        </div>
      </div>

      {/* Loading veil — appears the instant the click is registered so
          the user gets immediate "something is happening" feedback while
          the room's server render streams in. The veil sits ABOVE the
          card body but BELOW the spinner-bearing footer, with a soft
          shimmer that uses the layer's accent so it reads as the card
          turning ON, not greying out. Pointer-events: none so a frantic
          re-click still hits the card root (which no-ops via `loading`).
          ARIA-hidden because the card itself is aria-busy. */}
      {loading && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
          style={{
            borderRadius: 16,
            background: `linear-gradient(135deg, ${accent}1F 0%, ${accent}0A 100%)`,
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            animation: "shelfCardPulse 1.2s ease-in-out infinite",
          }}
        >
          {/* Shimmer sweep — a single diagonal highlight that sweeps
              across the card every cycle, the universal "loading is
              progressing" cue. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(115deg, transparent 35%, ${accent}33 50%, transparent 65%)`,
              animation: "shelfCardSweep 1.4s ease-in-out infinite",
            }}
          />
        </div>
      )}
    </motion.div>
  );
}

// ── Shelf ─────────────────────────────────────────────────────────
function LayerShelf({
  spaceId,
  layer,
  subs,
  themeBySubId,
  tabFadeBySubId,
  childrenByContainer,
}: {
  spaceId: string;
  layer: ObjectiveLayer;
  subs: MainCanvasSub[];
  themeBySubId: Map<string, string>;
  tabFadeBySubId: Map<string, number>;
  /** Nesting axis: containerCardId → its sub-feature cards. A container
   *  card in this shelf renders its children stacked beside it. */
  childrenByContainer: Map<string, MainCanvasSub[]>;
}) {
  const accent = ARCHETYPE_COLOR[layer.archetype];
  const covered = subs.length > 0;
  const drag = useDragScroll();
  const getDragged = useCallback(() => drag.didDrag.current, [drag.didDrag]);

  // Group same-theme cards adjacent so their (same-colored) folder tabs
  // cluster visually. Within a theme, keep further-along cards first so
  // the shelf reads progress → to-do.
  const orderedSubs = useMemo(() => {
    return [...subs].sort((a, b) => {
      const ta = themeBySubId.get(a.id) ?? "￿";
      const tb = themeBySubId.get(b.id) ?? "￿";
      if (ta !== tb) return ta.localeCompare(tb);
      if (b.progress.completed !== a.progress.completed) {
        return b.progress.completed - a.progress.completed;
      }
      return a.title.localeCompare(b.title);
    });
  }, [subs, themeBySubId]);

  return (
    <section
      className="relative w-full"
      style={{
        // Soft top-down accent wash + a full hairline ring tinted by
        // the layer color, and a gentle accent-tinted ambient shadow.
        // No hard left bar — that read cheap.
        background: covered
          ? `linear-gradient(180deg, ${accent}0B, transparent 58%)`
          : "transparent",
        border: `1px solid ${covered ? `${accent}24` : appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.xl,
        boxShadow: covered
          ? `0 1px 2px rgba(15,23,42,0.04), 0 14px 34px -18px ${accent}4D`
          : "none",
      }}
    >
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-2.5 pt-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums"
              style={{ background: `${accent}16`, color: accent }}
            >
              {layer.id}
            </span>
            <h2
              className="text-[16px] font-semibold leading-tight tracking-tight"
              style={{
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.display,
                letterSpacing: "-0.01em",
              }}
            >
              {layer.name}
            </h2>
            <span
              className="text-[10.5px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
            >
              · {layer.archetype}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.tertiary,
              }}
            >
              {subs.length} card{subs.length === 1 ? "" : "s"}
            </span>
          </div>
          {layer.description && (
            <p
              className="max-w-xl text-[11.5px] font-light leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              {layer.description}
            </p>
          )}
        </div>
        {/* Variable chips — folded from the stack widget */}
        {layer.variables.length > 0 && (
          <div className="flex max-w-[44%] flex-wrap justify-end gap-1">
            {layer.variables.slice(0, 5).map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  background: appleVibe.surface.chip,
                  color: appleVibe.text.secondary,
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                }}
                title={v.description?.slice(0, 120)}
              >
                {v.name}
              </span>
            ))}
            {layer.variables.length > 5 && (
              <span
                className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: appleVibe.surface.chip,
                  color: appleVibe.text.tertiary,
                }}
              >
                +{layer.variables.length - 5}
              </span>
            )}
          </div>
        )}
      </header>

      {/* Gallery */}
      {subs.length > 0 ? (
        <div
          ref={drag.ref}
          {...drag.bind}
          className="flex w-full items-start gap-4 px-5 pb-6 pt-4"
          style={{
            overflowX: "auto",
            scrollSnapType: "x proximity",
            scrollbarWidth: "none",
            touchAction: "pan-y",
            cursor: "grab",
            maskImage:
              "linear-gradient(to right, transparent, #000 20px, #000 calc(100% - 20px), transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, #000 20px, #000 calc(100% - 20px), transparent)",
          }}
        >
          {orderedSubs.map((sub) => {
            const ords = sub.layerOrdinals ?? [];
            const bridgesTo = ords
              .filter((o) => o !== layer.ordinal)
              .sort((a, b) => b - a);
            const themeLabel = themeBySubId.get(sub.id) ?? null;
            const children = childrenByContainer.get(sub.id) ?? [];
            if (children.length === 0) {
              return (
                <LayerFlashcard
                  key={sub.id}
                  spaceId={spaceId}
                  sub={sub}
                  accent={accent}
                  themeLabel={themeLabel}
                  tabFade={tabFadeBySubId.get(sub.id) ?? 1}
                  bridgesTo={bridgesTo}
                  getDragged={getDragged}
                />
              );
            }
            // Container card: render its sub-feature cards stacked
            // beside it (the "card below the card" nesting).
            return (
              <div
                key={sub.id}
                className="flex items-start gap-2.5"
                style={{ scrollSnapAlign: "start" }}
              >
                <LayerFlashcard
                  spaceId={spaceId}
                  sub={sub}
                  accent={accent}
                  themeLabel={themeLabel}
                  tabFade={tabFadeBySubId.get(sub.id) ?? 1}
                  bridgesTo={bridgesTo}
                  getDragged={getDragged}
                />
                <div
                  className="flex flex-col gap-1.5 pt-1"
                  style={{ width: 190, flex: "0 0 auto" }}
                >
                  <span
                    className="pl-0.5 text-[9px] font-semibold uppercase tracking-[0.13em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    {children.length} sub-feature{children.length === 1 ? "" : "s"}
                  </span>
                  {children.map((ch) => (
                    <NestedChildCard
                      key={ch.id}
                      spaceId={spaceId}
                      sub={ch}
                      accent={accent}
                      getDragged={getDragged}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-5 pb-4 pt-1">
          <p
            className="text-[11.5px] font-light italic"
            style={{ color: appleVibe.text.faint }}
          >
            No sub-objectives operate at this altitude yet.
          </p>
        </div>
      )}
    </section>
  );
}

// ── Shelf connector — the causal verb between adjacent layers ──────
function ShelfConnector({ verb }: { verb: LayerInfluenceVerb | null }) {
  return (
    <div className="flex items-center justify-center py-1" aria-hidden>
      <div className="flex items-center gap-1.5">
        <span
          className="font-mono text-[11px]"
          style={{ color: appleVibe.text.faint }}
        >
          ↑
        </span>
        {verb && (
          <span
            className="text-[9.5px] font-medium uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {VERB_LABEL[verb]}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────
export function LayerShelvesView({
  spaceId,
  subs,
  stack,
  themes,
}: {
  spaceId: string;
  subs: MainCanvasSub[];
  stack: ObjectiveStack;
  themes: ClusterAnalysis | null;
}) {
  // Layers top-down: highest ordinal (outcome) first, mirroring the
  // stack widget's reading order.
  const layersTopDown = useMemo(
    () => [...stack.layers].sort((a, b) => b.ordinal - a.ordinal),
    [stack.layers],
  );

  // Adjacent causal verb between layer N and the layer directly below.
  const verbBetween = useMemo(() => {
    const map = new Map<string, LayerInfluenceVerb>();
    for (const inf of stack.influences) {
      if (Math.abs(inf.from_layer - inf.to_layer) !== 1) continue;
      const lower = Math.min(inf.from_layer, inf.to_layer);
      const upper = Math.max(inf.from_layer, inf.to_layer);
      map.set(`${lower}::${upper}`, inf.verb);
    }
    return map;
  }, [stack.influences]);

  // sub.id → theme label (concept cluster shown as the folder tab).
  const themeBySubId = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of themes?.clusters ?? []) {
      for (const id of c.proposal_ids) byId.set(id, c.label);
    }
    return byId;
  }, [themes]);

  // sub.id → tab importance fade (1 = most important category). Themes
  // are ranked GLOBALLY by member count (the most-represented cluster is
  // the dominant category). The fade steps LINEARLY by rank — every step
  // is an equal, clearly visible drop from 1 (dominant) to 0.18 (least),
  // so the difference between categories reads at a glance instead of the
  // lower ranks all bunching near zero (the old 0.5^rank curve did that).
  // All cards in a theme share its fade, so same-theme tabs stay even.
  const tabFadeBySubId = useMemo(() => {
    const ranked = [...(themes?.clusters ?? [])]
      .map((c, idx) => ({ c, idx }))
      .sort(
        (a, b) =>
          b.c.proposal_ids.length - a.c.proposal_ids.length || a.idx - b.idx,
      );
    const n = ranked.length;
    const byId = new Map<string, number>();
    ranked.forEach(({ c }, rank) => {
      const fade = n <= 1 ? 1 : 1 - (rank / (n - 1)) * 0.82;
      for (const id of c.proposal_ids) byId.set(id, fade);
    });
    return byId;
  }, [themes]);

  // Bucket subs by their PRIMARY (highest) ordinal; collect untagged.
  const { byOrdinal, unplaced, childrenByContainer } = useMemo(() => {
    const presentIds = new Set(subs.map((s) => s.id));
    const isNested = (s: MainCanvasSub) => {
      const cid = s.containerCardId ?? null;
      return !!cid && cid !== s.id && presentIds.has(cid);
    };

    // Nesting axis: a card with a valid container renders UNDER that
    // container (wherever it sits), not on its own layer shelf. Build
    // the child map first, then bucket only the top-level cards.
    const children = new Map<string, MainCanvasSub[]>();
    for (const sub of subs) {
      if (isNested(sub)) {
        const cid = sub.containerCardId!;
        const list = children.get(cid) ?? [];
        list.push(sub);
        children.set(cid, list);
      }
    }

    const buckets = new Map<number, MainCanvasSub[]>();
    const orphans: MainCanvasSub[] = [];
    for (const sub of subs) {
      if (isNested(sub)) continue; // shown under its container instead
      const ords = sub.layerOrdinals ?? [];
      if (ords.length === 0) {
        orphans.push(sub);
        continue;
      }
      const primary = Math.max(...ords);
      const list = buckets.get(primary) ?? [];
      list.push(sub);
      buckets.set(primary, list);
    }
    return {
      byOrdinal: buckets,
      unplaced: orphans,
      childrenByContainer: children,
    };
  }, [subs]);

  return (
    <div className="mx-auto mt-2 flex w-full max-w-5xl flex-col">
      {/* Nesting controls — group the flat card row into container →
          sub-feature features (the second axis below layers). */}
      {subs.length >= 3 && (
        <div className="mb-1 flex items-center justify-end gap-2 px-1">
          {childrenByContainer.size > 0 && (
            <GroupCardsButton spaceId={spaceId} mode="clear" />
          )}
          <GroupCardsButton spaceId={spaceId} />
        </div>
      )}
      {layersTopDown.map((layer, idx) => {
        const isLast = idx === layersTopDown.length - 1;
        const below = layersTopDown[idx + 1];
        const verb = below
          ? verbBetween.get(`${below.ordinal}::${layer.ordinal}`) ?? null
          : null;
        return (
          <div key={layer.id}>
            <LayerShelf
              spaceId={spaceId}
              layer={layer}
              subs={byOrdinal.get(layer.ordinal) ?? []}
              themeBySubId={themeBySubId}
              tabFadeBySubId={tabFadeBySubId}
              childrenByContainer={childrenByContainer}
            />
            {!isLast && <ShelfConnector verb={verb} />}
          </div>
        );
      })}

      {/* Unplaced shelf — cards with no layer_ordinals (picked before
          the stack existed, or too broad/structural for the proposer's
          tagger to place). The button runs the in-place re-sort. */}
      {unplaced.length > 0 && (
        <>
          <ShelfConnector verb={null} />
          <LayerShelf
            spaceId={spaceId}
            layer={{
              id: "—",
              ordinal: 0,
              name: "Unplaced",
              description:
                "No layer yet — sort them in to drop each card onto the layer it operates at.",
              archetype: "substrate",
              variables: [],
            }}
            subs={unplaced}
            themeBySubId={themeBySubId}
            tabFadeBySubId={tabFadeBySubId}
            childrenByContainer={childrenByContainer}
          />
          <div className="mt-2 px-5">
            <RetagCardsButton spaceId={spaceId} unplacedCount={unplaced.length} />
          </div>
        </>
      )}

      {/* Long-range closures — folded from the stack widget footer. */}
      {stack.influences.some(
        (inf) => Math.abs(inf.from_layer - inf.to_layer) > 1,
      ) && (
        <div className="mt-4 px-5">
          <div
            className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Long-range closures
          </div>
          <ul className="flex flex-col gap-0.5">
            {stack.influences
              .filter((inf) => Math.abs(inf.from_layer - inf.to_layer) > 1)
              .map((inf, i) => (
                <li
                  key={i}
                  className="text-[10.5px] font-light leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                  title={inf.rationale ?? undefined}
                >
                  <span className="font-mono">L{inf.from_layer}</span>
                  <span style={{ color: appleVibe.text.tertiary }}> → </span>
                  <span className="font-mono">L{inf.to_layer}</span>
                  <span style={{ color: appleVibe.text.tertiary }}>
                    {" "}
                    · {VERB_LABEL[inf.verb]}
                  </span>
                  {inf.rationale && (
                    <span style={{ color: appleVibe.text.tertiary }}>
                      {" "}
                      — {inf.rationale}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
