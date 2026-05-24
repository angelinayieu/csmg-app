"use client";

// InsightsFeedMode — middle-panel default view. Renders a chronological
// stream of "insight-y" events as they land via the structural event
// SSE bus. The user sees the pipeline THINKING — every cycle, bridge,
// hidden signal, root cause, twin proposal, and consensus result
// streams in as a card the moment it's persisted.
//
// Distinct from the Graph mode (force-directed layout): the feed shows
// WHAT the pipeline is finding, the graph shows WHERE in the structure
// it lives. Together they give the user both narrative + topology.
//
// Filtering: we deliberately ignore entity_added / edge_added (too
// noisy — those run constantly and dilute the signal). Only
// structurally-significant events make the feed.

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Entity } from "@/types";
import { useRunEventStoreOptional } from "@/components/canvas/hooks/run-event-store";
import { colors, tracking } from "./tokens";

interface InsightsFeedModeProps {
  /** Space id — required so the empty-state idea-entry can POST to
   *  /api/pipeline/decompose with the right existingSpaceId. Threaded
   *  in from kg-panel.tsx (which already takes spaceId as a prop). */
  spaceId: string;
  entities: Entity[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
}

// Which event types qualify as an "insight." Tuned to surface
// structurally-meaningful artifacts, not raw graph growth.
const INSIGHT_EVENT_TYPES = new Set<string>([
  "cycle_detected",
  "bridge_formed",
  "signal_detected",
  "signal_cluster",
  "twin_proposal_ready",
  "strategy_consensus_ready",
  "proposal_ready",
  "root_cause_identified",
  "why_chain_deepened",
  "framing_proposed",
  "framing_approved",
  "lab_proposed",
  "kg_plan_proposed",
  "convergence_detected",
  "contradiction_found",
  "structural_analog_found",
  "taxonomy_inferred",
  "causal_stage_ready",
  // Fast Haiku preflight emits these within ~5-10s of submit so the
  // feed isn't empty during Pass 1's long reasoning phase. Marked
  // visually distinct from canonical insights (lower importance,
  // muted accent, "early guess" eyebrow).
  "preliminary_hypothesis",
]);

// Per-kind labels + tone. Defines the visual language for the feed —
// each insight category has a consistent eyebrow + accent across the
// app, so the user learns the grammar quickly.
const KIND_META: Record<
  string,
  {
    eyebrow: string;
    accent: string;
    bg: string;
    fg: string;
    glyph: string;
  }
> = {
  cycle_detected: {
    eyebrow: "Cycle",
    accent: colors.state.cycle,
    bg: colors.state.leverageChip,
    fg: colors.state.leverageFgDark,
    glyph: "↻",
  },
  bridge_formed: {
    eyebrow: "Bridge",
    accent: colors.state.bridgeEdge,
    bg: "rgba(6, 182, 212, 0.12)",
    fg: "#0E7490",
    glyph: "⇄",
  },
  signal_detected: {
    eyebrow: "Hidden signal",
    accent: colors.brand.fg,
    bg: colors.brand.bgChip,
    fg: colors.brand.fgDark,
    glyph: "✦",
  },
  signal_cluster: {
    eyebrow: "Signal cluster",
    accent: colors.brand.fgDarker,
    bg: colors.brand.bgPanelStrong,
    fg: colors.brand.fgDarker,
    glyph: "✦✦",
  },
  twin_proposal_ready: {
    eyebrow: "Twin proposal",
    accent: colors.state.ok,
    bg: colors.state.okSoft,
    fg: colors.state.okFg,
    glyph: "⊙",
  },
  strategy_consensus_ready: {
    eyebrow: "Strategy",
    accent: "#7C3AED",
    bg: "rgba(124, 58, 237, 0.12)",
    fg: "#6D28D9",
    glyph: "◆",
  },
  proposal_ready: {
    eyebrow: "Proposal",
    accent: "#7C3AED",
    bg: "rgba(124, 58, 237, 0.10)",
    fg: "#6D28D9",
    glyph: "◇",
  },
  root_cause_identified: {
    eyebrow: "Root cause",
    accent: colors.state.bottleneck,
    bg: colors.state.bottleneckSoft,
    fg: colors.state.bottleneckFg,
    glyph: "▼",
  },
  why_chain_deepened: {
    eyebrow: "Why-chain",
    accent: colors.state.bottleneck,
    bg: colors.state.bottleneckSoft,
    fg: colors.state.bottleneckFg,
    glyph: "▽",
  },
  framing_proposed: {
    eyebrow: "Framing",
    accent: "#0891B2",
    bg: colors.state.infoChip,
    fg: colors.state.infoFg,
    glyph: "◧",
  },
  framing_approved: {
    eyebrow: "Framing locked",
    accent: colors.state.ok,
    bg: colors.state.okSoft,
    fg: colors.state.okFg,
    glyph: "◨",
  },
  lab_proposed: {
    eyebrow: "Lab proposal",
    accent: "#0F766E",
    bg: colors.state.okSoft,
    fg: colors.state.okFg,
    glyph: "⚗",
  },
  kg_plan_proposed: {
    eyebrow: "KG plan",
    accent: colors.brand.fg,
    bg: colors.brand.bgChip,
    fg: colors.brand.fgDark,
    glyph: "▦",
  },
  convergence_detected: {
    eyebrow: "Convergence",
    accent: colors.state.ok,
    bg: colors.state.okSoft,
    fg: colors.state.okFg,
    glyph: "⊕",
  },
  contradiction_found: {
    eyebrow: "Contradiction",
    accent: colors.state.bottleneck,
    bg: colors.state.bottleneckSoft,
    fg: colors.state.bottleneckFg,
    glyph: "⚠",
  },
  structural_analog_found: {
    eyebrow: "Analog",
    accent: colors.state.info,
    bg: colors.state.infoChip,
    fg: colors.state.infoFg,
    glyph: "≈",
  },
  taxonomy_inferred: {
    eyebrow: "Taxonomy",
    accent: colors.brand.fg,
    bg: colors.brand.bgChip,
    fg: colors.brand.fgDark,
    glyph: "▤",
  },
  causal_stage_ready: {
    eyebrow: "Causal stage",
    accent: colors.state.cycle,
    bg: colors.state.leverageChip,
    fg: colors.state.leverageFgDark,
    glyph: "⟶",
  },
  preliminary_hypothesis: {
    eyebrow: "Early guess",
    accent: colors.neutral.fg500,
    bg: colors.neutral.chipBg,
    fg: colors.neutral.fg700,
    glyph: "?",
  },
};

// Generic fallback so unknown event types still render (forward-compat
// for events the painter learns about before this file does).
const FALLBACK_META = {
  eyebrow: "Insight",
  accent: colors.neutral.fg500,
  bg: colors.neutral.chipBg,
  fg: colors.neutral.fg700,
  glyph: "·",
};

// Importance scoring — drives the auto-rerank of the feed. Higher =
// more important = floats to the top. The exact numbers don't matter
// in isolation; what matters is the ORDER (and that ties get broken
// by recency in the sort below). When a new high-importance insight
// lands it bumps lower-importance items down — the framer-motion
// `layout` prop animates the cards smoothly into their new slots
// (FLIP-style). This is what makes the panel feel alive instead of
// static. Tune the constants if you re-prioritize what the user
// should notice first.
//
// Reasoning behind the ordering:
//   - Root cause + strategy consensus are the "answers" — surface first
//   - Twin proposals (lab/strategy/problem framings) come next as
//     they're the next-action-able artifacts
//   - Signal clusters > single signals (clusters are more informative)
//   - Cycles + bridges are structural revelations (high but below
//     the synthesizers)
//   - Per-step intermediates (kg plan, taxonomy, causal stages) sit
//     lower — useful to see, but not what you came for
//
 
function importanceFor(eventType: string, _streamed: unknown): number {
  switch (eventType) {
    case "root_cause_identified":
      return 100;
    case "strategy_consensus_ready":
      return 92;
    case "twin_proposal_ready":
      return 88;
    case "signal_cluster":
      return 78;
    case "cycle_detected":
      return 72;
    case "bridge_formed":
      return 68;
    case "proposal_ready":
      return 62;
    case "signal_detected":
      return 58;
    case "convergence_detected":
      return 54;
    case "contradiction_found":
      return 50;
    case "why_chain_deepened":
      return 44;
    case "lab_proposed":
    case "framing_approved":
      return 38;
    case "framing_proposed":
      return 34;
    case "kg_plan_proposed":
    case "structural_analog_found":
    case "taxonomy_inferred":
    case "causal_stage_ready":
      return 26;
    // Preliminary hypotheses sit BELOW everything real — they're fast
    // early guesses, not deep-reasoning output. As soon as canonical
    // insights land, these get pushed down the feed.
    case "preliminary_hypothesis":
      return 12;
    default:
      return 18;
  }
}

export function InsightsFeedMode({
  // spaceId retained in the prop type for callers (some pass it for
  // future per-space behavior), but the in-flight FeedEmptyState no
  // longer needs it after the duplicate idea-entry was removed. We
  // void-reference it to keep the prop documented + lint-quiet.
  spaceId: _spaceId,
  entities,
  selectedEntityId,
  onSelectEntity,
}: InsightsFeedModeProps) {
  const store = useRunEventStoreOptional();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Mount timestamp — captured ONCE in the useState initializer so
  // Date.now() runs in mount-time, not in render. Insights whose
  // emittedAt > mountTime get the "freshly arrived" pulse animation;
  // ones already in the store on first paint render flat. State
  // (not ref) because the lint rule forbids reading refs during
  // render — state is fine.
  const [mountTime] = useState<number>(() => Date.now());

  // Build the live feed: filter store events to insight types, sort
  // newest-first, derive a stable per-card id. The store is the
  // source of truth for ordering — we don't shuffle.
  //
  // emittedAt comes from the SSE store as an ISO string; we parse to
  // epoch ms once so downstream comparisons (sort + isFresh) operate
  // on numbers.
  interface FeedInsight {
    id: string;
    type: string;
    meta: { eyebrow: string; accent: string; bg: string; fg: string; glyph: string };
    title: string;
    subtitle: string | null;
    entityIds: string[];
    emittedAt: number;
    /** Importance score 0-100, used to rank the feed. Higher =
     *  more important. Drives both the sort and the per-card "rank"
     *  badge. When a high-importance insight lands it visibly jumps
     *  to the top, displacing lower-ranked ones (FLIP animation
     *  driven by framer-motion's `layout` prop). */
    importance: number;
  }
  const insights = useMemo<FeedInsight[]>(() => {
    if (!store) return [];
    const out: FeedInsight[] = [];
    for (const streamed of store.events) {
      const eventType = streamed.event.type;
      if (!INSIGHT_EVENT_TYPES.has(eventType)) continue;
      const meta = KIND_META[eventType] ?? FALLBACK_META;
      const { title, subtitle, entityIds } = describeEvent(
        streamed,
        entities,
      );
      const emittedAtMs = (() => {
        const raw = streamed.emittedAt;
        if (typeof raw === "number") return raw;
        const parsed = Date.parse(String(raw));
        return Number.isFinite(parsed) ? parsed : 0;
      })();
      out.push({
        // Each event in the store has a stable id; if absent we
        // synthesize one from type + emittedAt so dedup works.
         
        id: ((streamed as any).id as string | undefined) ?? `${eventType}-${emittedAtMs}`,
        type: eventType,
        meta,
        title,
        subtitle,
        entityIds,
        emittedAt: emittedAtMs,
        importance: importanceFor(eventType, streamed),
      });
    }
    // Sort by importance DESC, with recency as tiebreaker. So a brand-
    // new high-importance insight (e.g. bottleneck identified) jumps
    // to position #1, displacing older items down. The framer-motion
    // `layout` prop on each card animates the reorder smoothly.
    out.sort((a, b) => {
      const di = b.importance - a.importance;
      if (di !== 0) return di;
      return b.emittedAt - a.emittedAt;
    });
    return out;
  }, [store, entities]);

  // (mountTime is captured in the useState initializer above —
  // no separate effect needed.)

  // Auto-scroll to top when a new insight lands at the top of the
  // list — keeps the user's eye on the freshest output.
  useEffect(() => {
    if (insights.length === 0) return;
    if (!containerRef.current) return;
    // Only scroll if the top is already roughly visible — don't yank
    // the user if they've scrolled down to read an older insight.
    if (containerRef.current.scrollTop < 200) {
      containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [insights.length]);

  return (
    <div className="flex h-full flex-col" style={{ background: "white" }}>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {insights.length === 0 ? (
          <FeedEmptyState
            hasStream={!!store}
            entitiesEmpty={entities.length === 0}
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            <AnimatePresence initial={false}>
              {insights.map((insight, idx) => {
                // "Fresh" = arrived strictly AFTER we mounted.
                const isFreshlySeen = insight.emittedAt > mountTime;
                return (
                  <motion.div
                    key={insight.id}
                    layout
                    initial={
                      isFreshlySeen
                        ? { opacity: 0, y: -8, scale: 0.98 }
                        : false
                    }
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{
                      // Spring physics keeps the reorder snappy but
                      // not jarring — items glide rather than teleport.
                      type: "spring",
                      stiffness: 380,
                      damping: 34,
                      mass: 0.7,
                    }}
                  >
                    <InsightCard
                      insight={insight}
                      isFresh={isFreshlySeen}
                      rank={idx + 1}
                      selected={
                        selectedEntityId !== null &&
                        insight.entityIds.includes(selectedEntityId)
                      }
                      onSelectEntity={onSelectEntity}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
//
// When entities are zero, this surface IS the primary entry CTA — a
// big "Start from an idea" textarea + submit button posting straight
// to /api/pipeline/decompose. Mirrors UnifiedEmptyState's flow but
// lives inside the middle column so the user always has somewhere to
// type, even if the page-level overlay was suppressed by orphan
// synthesis data, lingering rooms, or a previously-dismissed session.
//
// When entities exist but no insights have arrived yet (mid-run), the
// surface degrades to the informational "Insights will surface here"
// hint — same as before — because the entry has clearly been made.
// Informational ONLY — the prompt entry lives at the page level
// (UnifiedEmptyState overlay) and at the homepage. Earlier this
// surface had its own "Start from an idea" textarea as a fallback,
// but having THREE duplicate prompt-entry surfaces (homepage + page
// overlay + middle panel) on the same flow was confusing users.
// Reverted so the middle panel is purely the insights stream — entry
// belongs to the canonical surface.
function FeedEmptyState({
  hasStream,
  entitiesEmpty,
}: {
  hasStream: boolean;
  entitiesEmpty: boolean;
}) {
  // Entities present + active stream → rich live activity card so the
  // user sees what's happening instead of staring at a static line.
  if (!entitiesEmpty && hasStream) {
    return <LiveActivitySurface />;
  }
  // All other cases: informational placeholder. Either truly empty
  // (entry happens at page/homepage level) or entities exist but no
  // run streaming (the page-level overlay has already surfaced the
  // entry path).
  const headline = entitiesEmpty
    ? "Insights stream once you start a run"
    : "Insights stream when a run is active";
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: colors.brand.bgSoft }}
      >
        <span style={{ color: colors.brand.fg, fontSize: 16 }}>✦</span>
      </div>
      <div className="text-sm font-semibold text-slate-700">{headline}</div>
      <div className="mt-1 max-w-[280px] text-xs leading-relaxed text-slate-500">
        Every cycle, bridge, hidden signal, root cause, and strategy
        proposal lands as a card in this feed — ranked by importance,
        freshest at the top.
      </div>
    </div>
  );
}

// (Phase 6d primary-entry FeedEmptyState was deleted here — it
// duplicated the homepage hero + UnifiedEmptyState overlay producing
// three layers of "Start from an idea" prompts on the same flow.
// See SHA 9efd153 for the deleted markup if it's ever needed.)

// ── Live activity surface ──────────────────────────────────────────
//
// Rendered when a pipeline run is in flight but insight-type events
// haven't landed yet (decompose / research stages take ~60-120s
// before the first cycle_detected / signal_detected emits). Without
// this surface the middle column stares blank for the entire
// decompose phase, which makes the user think the system is hung.
//
// Reads directly from the SSE store: current stage, entity/edge
// counts, and the last reasoning chunk preview. Pulses softly so
// the user reads "live activity" instead of "static placeholder."
function LiveActivitySurface() {
  // Reads the store unconditionally (gated by hasStream upstream so
  // we're guaranteed a provider). Cheaper than threading store down
  // via props — the parent already paid the context-subscribe cost.
  const store = useRunEventStoreOptional();
  // Tick every 1s so elapsed time updates live. We track wall-clock
  // ms in state so elapsedSec's useMemo body can read it as a pure
  // value (calling Date.now() during render trips react-hooks/purity).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const events = store?.events ?? [];
  // Counts from the store — same source the painter / KG uses, so
  // these match the LEFT panel exactly.
  const entityCount = useMemo(
    () => events.filter((e) => e.event.type === "entity_added").length,
    [events],
  );
  const edgeCount = useMemo(
    () => events.filter((e) => e.event.type === "edge_added").length,
    [events],
  );
  const cycleCount = useMemo(
    () => events.filter((e) => e.event.type === "cycle_detected").length,
    [events],
  );
  // Latest stage_boundary tells us which stage the chain is in.
  // Walk from newest backwards so we don't re-iterate on each render.
  const latestStage = useMemo<{
    label: string;
    glyph: string;
  } | null>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i].event;
      if (ev.type !== "stage_boundary") continue;
      const stageKey = (ev as { stage?: string }).stage ?? "";
      return STAGE_LABELS[stageKey] ?? { label: stageKey || "Running", glyph: "●" };
    }
    return null;
  }, [events]);
  // Latest reasoning_chunk preview — last 140 chars trimmed at a word
  // boundary so the preview reads as a natural sentence fragment.
  const reasoningPreview = useMemo<string | null>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i].event;
      if (ev.type !== "reasoning_chunk") continue;
      const full = (ev as { textSoFar?: string }).textSoFar ?? "";
      if (full.length < 30) return null;
      const tail = full.slice(-180);
      // Snap to next word boundary to avoid mid-word starts.
      const firstSpace = tail.indexOf(" ");
      const cleaned = firstSpace > 0 ? tail.slice(firstSpace + 1) : tail;
      return cleaned.length > 140 ? cleaned.slice(-140) : cleaned;
    }
    return null;
  }, [events]);
  // Elapsed time since the first event in the store (proxy for "run
  // started"). Bounded so very long-running stale subscriptions don't
  // produce absurd labels.
  const elapsedSec = useMemo(() => {
    if (events.length === 0) return 0;
    const first = events[0].emittedAt;
    const firstMs =
      typeof first === "number" ? first : Date.parse(String(first));
    if (!Number.isFinite(firstMs)) return 0;
    return Math.min(3600, Math.max(0, Math.floor((nowMs - firstMs) / 1000)));
  }, [events, nowMs]);

  const stageLabel = latestStage?.label ?? "Decomposing";
  const stageGlyph = latestStage?.glyph ?? "≡";

  return (
    <div className="flex h-full flex-col items-center justify-center px-5 py-10">
      <div
        className="w-full max-w-[380px] rounded-2xl border bg-white p-5 shadow-sm"
        style={{ borderColor: colors.brand.haloSoft }}
      >
        {/* Eyebrow row: pulsing dot + stage label + elapsed */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full"
              style={{ background: colors.brand.fg }}
            />
            <span
              className="text-[9.5px] font-bold uppercase"
              style={{
                color: colors.brand.fgDark,
                letterSpacing: tracking.eyebrow,
              }}
            >
              Pipeline running
            </span>
          </div>
          <span className="font-mono text-[10px] text-slate-400">
            {formatElapsed(elapsedSec)}
          </span>
        </div>

        {/* Current stage header */}
        <div className="mb-4 flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-[15px]"
            style={{
              background: colors.brand.bgSoft,
              color: colors.brand.fg,
            }}
          >
            {stageGlyph}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-slate-900">
              {stageLabel}…
            </div>
            <div className="text-[10.5px] text-slate-500">
              Insights surface as the chain progresses to synthesis.
            </div>
          </div>
        </div>

        {/* Live counts row */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <ActivityStat label="Entities" value={entityCount} />
          <ActivityStat label="Edges" value={edgeCount} />
          <ActivityStat label="Cycles" value={cycleCount} />
        </div>

        {/* Reasoning prose preview */}
        {reasoningPreview && (
          <div
            className="rounded-md border px-3 py-2 text-[10.5px] leading-snug text-slate-600"
            style={{
              borderColor: colors.brand.haloSoft,
              background: "#F8FAFC",
            }}
          >
            <div
              className="mb-1 text-[8.5px] font-bold uppercase text-slate-400"
              style={{ letterSpacing: tracking.eyebrow }}
            >
              Currently reasoning
            </div>
            <div className="line-clamp-3 italic text-slate-600">
              …{reasoningPreview}
            </div>
          </div>
        )}

        <div className="mt-3 text-center text-[9.5px] text-slate-400">
          Synthesis typically begins after ~90 seconds.
        </div>
      </div>
    </div>
  );
}

function ActivityStat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-md border px-2 py-1.5 text-center"
      style={{ borderColor: colors.brand.haloSoft, background: "white" }}
    >
      <div
        className="font-mono text-[15px] font-semibold leading-none"
        style={{ color: colors.brand.fgDark }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-[8.5px] font-medium uppercase text-slate-400"
        style={{ letterSpacing: tracking.eyebrow }}
      >
        {label}
      </div>
    </div>
  );
}

// Canonical stage_boundary.stage → display label + glyph. Mirrors
// pipeline-progress-strip's stage table so labels stay consistent
// across the lab. If a new stage shows up that isn't mapped here
// we fall back to the raw key so it's still legible.
const STAGE_LABELS: Record<string, { label: string; glyph: string }> = {
  intake: { label: "Decomposing", glyph: "≡" },
  landscape: { label: "Mapping landscape", glyph: "▦" },
  kg: { label: "Building knowledge graph", glyph: "≡" },
  proposal: { label: "Synthesizing insights", glyph: "✦" },
  twin: { label: "Composing strategy", glyph: "◆" },
  lab: { label: "Generating lab options", glyph: "⚗" },
  reflexive: { label: "Materializing apps", glyph: "□" },
  results: { label: "Finalizing results", glyph: "★" },
};

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

// ── Single insight card ─────────────────────────────────────────────
function InsightCard({
  insight,
  isFresh,
  rank,
  selected,
  onSelectEntity,
}: {
  insight: {
    id: string;
    type: string;
    meta: { eyebrow: string; accent: string; bg: string; fg: string; glyph: string };
    title: string;
    subtitle: string | null;
    entityIds: string[];
    emittedAt: number;
    importance: number;
  };
  isFresh: boolean;
  /** 1-indexed position in the importance-sorted feed. Drives the
   *  little "#1 / #2 …" badge in the corner. Top 3 get an emphasized
   *  treatment to underline that these are the highest-impact items
   *  right now (and will move down if a more important insight lands). */
  rank: number;
  selected: boolean;
  onSelectEntity: (id: string | null) => void;
}) {
  const onClick = () => {
    // Anchor selection to the first referenced entity so the right
    // panel + middle graph can both react.
    if (insight.entityIds.length > 0) onSelectEntity(insight.entityIds[0]);
  };
  const isTopRanked = rank <= 3;

  return (
    <div
      onClick={onClick}
      className="cursor-pointer overflow-hidden rounded-xl border bg-white transition-all"
      style={{
        borderColor: selected
          ? insight.meta.accent
          : isTopRanked
          ? `${insight.meta.accent}55`
          : colors.neutral.borderFaint,
        boxShadow: selected
          ? `0 6px 18px ${colors.brand.shadow}`
          : isFresh
          ? `0 4px 14px ${insight.meta.accent}22`
          : isTopRanked
          ? `0 2px 10px ${insight.meta.accent}15`
          : colors.neutral.cardShadow,
        animation: isFresh ? "insight-card-arrive 480ms ease-out" : undefined,
      }}
    >
      {/* Accent stripe — color-codes the insight type at a glance.
          Top-3 ranked cards get a thicker stripe so the eye lands on
          the most important insights first. */}
      <div
        style={{
          height: isTopRanked ? 3 : 2,
          background: insight.meta.accent,
        }}
      />

      <div className="px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <span
            className="rounded px-1.5 text-[8.5px] font-bold uppercase tracking-wider"
            style={{
              background: insight.meta.bg,
              color: insight.meta.fg,
              letterSpacing: tracking.eyebrowTight,
            }}
          >
            <span className="mr-1 font-mono text-[10px]">
              {insight.meta.glyph}
            </span>
            {insight.meta.eyebrow}
          </span>
          {/* Rank badge — tiny chip showing this insight's position in
              the importance-ordered feed. Cards animate to new slots
              when an inbound event displaces them, and the badge
              updates in lockstep, so the user SEES the rerank. */}
          <span
            className="flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[8.5px] font-bold tabular-nums"
            style={{
              background: isTopRanked
                ? insight.meta.accent
                : colors.neutral.chipBg,
              color: isTopRanked ? "white" : colors.neutral.fg500,
            }}
            title={`Importance ${insight.importance}/100 — rank #${rank}`}
          >
            #{rank}
          </span>
          <span className="ml-auto text-[9.5px] text-slate-400">
            {formatAge(insight.emittedAt)}
          </span>
        </div>

        <div className="text-[12.5px] font-semibold leading-snug text-slate-900">
          {insight.title}
        </div>

        {insight.subtitle && (
          <div className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-slate-600">
            {insight.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

// Format an emittedAt timestamp as a short relative-time string.
// Matches the convention in the rail-pulse activity feed.
function formatAge(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.max(0, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Turn a structural event into title + subtitle + referenced entity
// ids. Defensive — events have varying shapes per type; we narrow
// case-by-case with optional chaining + fallbacks so an unexpected
// shape never crashes the card.
//
 
function describeEvent(
   
  streamed: any,
  entities: Entity[],
): { title: string; subtitle: string | null; entityIds: string[] } {
   
  const ev = streamed.event as any;
  const type = ev.type as string;
  const nameById = new Map<string, string>(entities.map((e) => [e.id, e.name]));
  const lookupName = (id: unknown): string =>
    typeof id === "string" ? nameById.get(id) ?? id : "—";

  switch (type) {
    case "cycle_detected": {
      const cycle = ev.cycle ?? ev.payload ?? {};
      const ids = Array.isArray(cycle.entity_ids) ? cycle.entity_ids : [];
      const names = ids.slice(0, 3).map(lookupName);
      return {
        title:
          cycle.classification === "reinforcing_positive"
            ? "Reinforcing positive cycle"
            : cycle.classification === "reinforcing_negative"
            ? "Reinforcing negative cycle"
            : cycle.classification === "balancing"
            ? "Balancing loop"
            : "Cycle detected",
        subtitle: names.length > 0 ? names.join(" → ") + " →" : null,
        entityIds: ids,
      };
    }
    case "bridge_formed": {
      const src = lookupName(ev.source_entity_id);
      const tgt = lookupName(ev.target_entity_id);
      return {
        title: `${src} ⇄ ${tgt}`,
        subtitle: ev.bridge_type
          ? `${String(ev.bridge_type)} bridge`
          : "Cross-context bridge",
        entityIds: [ev.source_entity_id, ev.target_entity_id].filter(
          (x): x is string => typeof x === "string",
        ),
      };
    }
    case "signal_detected": {
      const sig = ev.signal ?? ev;
      const title =
        sig.kind === "structural_hole"
          ? "Structural hole"
          : sig.kind === "hidden_variable"
          ? "Hidden mediator"
          : sig.kind === "cascade_vulnerability"
          ? "Cascade vulnerability"
          : sig.kind === "flip_prone_loop"
          ? "Flip-prone loop"
          : "Hidden signal";
      const ids = Array.isArray(sig.entity_ids) ? sig.entity_ids : [];
      return {
        title,
        subtitle: typeof sig.description === "string" ? sig.description : null,
        entityIds: ids,
      };
    }
    case "signal_cluster": {
      const cluster = ev.cluster ?? ev;
      return {
        title: typeof cluster.label === "string"
          ? cluster.label
          : "Hidden signal cluster",
        subtitle: typeof cluster.signal_count === "number"
          ? `${cluster.signal_count} signals · ${cluster.strength ?? "moderate"}`
          : null,
        entityIds: Array.isArray(cluster.shared_entity_ids)
          ? cluster.shared_entity_ids
          : [],
      };
    }
    case "twin_proposal_ready": {
      return {
        title:
          ev.kind === "lab_twin"
            ? "Lab proposal ready"
            : ev.kind === "strategy_twin"
            ? "Strategy proposal ready"
            : ev.kind === "problem_twin"
            ? "Framing proposal ready"
            : "Twin proposal ready",
        subtitle: typeof ev.label === "string" ? ev.label : null,
        entityIds: [],
      };
    }
    case "strategy_consensus_ready": {
      return {
        title: "Strategy consensus reached",
        subtitle:
          typeof ev.primary_label === "string"
            ? ev.primary_label
            : "Primary strategy + alternatives ranked",
        entityIds: [],
      };
    }
    case "proposal_ready": {
      return {
        title:
          typeof ev.label === "string" ? ev.label : "Proposal ready",
        subtitle:
          typeof ev.kind === "string"
            ? `Kind: ${ev.kind}`
            : null,
        entityIds: typeof ev.target_entity_id === "string"
          ? [ev.target_entity_id]
          : [],
      };
    }
    case "root_cause_identified": {
      return {
        title: "Root cause identified",
        subtitle: typeof ev.driver_label === "string" ? ev.driver_label : null,
        entityIds: typeof ev.thread_entity_id === "string"
          ? [ev.thread_entity_id]
          : [],
      };
    }
    case "why_chain_deepened": {
      const count =
        typeof ev.user_controllable_count === "number"
          ? `${ev.user_controllable_count} controllable · ${ev.external_count ?? "?"} external`
          : null;
      return {
        title: "Why-chain deepened",
        subtitle: count,
        entityIds: [],
      };
    }
    case "framing_proposed":
      return {
        title: "Framings proposed",
        subtitle: typeof ev.count === "number" ? `${ev.count} candidates` : null,
        entityIds: [],
      };
    case "framing_approved":
      return {
        title: "Framing approved",
        subtitle: typeof ev.label === "string" ? ev.label : null,
        entityIds: [],
      };
    case "lab_proposed":
      return {
        title: "Lab options proposed",
        subtitle: typeof ev.stance_count === "number"
          ? `${ev.stance_count} stances`
          : null,
        entityIds: [],
      };
    case "kg_plan_proposed":
      return {
        title: "Knowledge-graph plan proposed",
        subtitle: typeof ev.axis_count === "number"
          ? `${ev.axis_count} axes`
          : null,
        entityIds: [],
      };
    case "convergence_detected":
      return {
        title: "Cross-mechanism convergence",
        subtitle: typeof ev.label === "string" ? ev.label : null,
        entityIds: Array.isArray(ev.entity_ids) ? ev.entity_ids : [],
      };
    case "contradiction_found":
      return {
        title: "Contradiction surfaced",
        subtitle: typeof ev.label === "string" ? ev.label : null,
        entityIds: Array.isArray(ev.entity_ids) ? ev.entity_ids : [],
      };
    case "structural_analog_found":
      return {
        title: "Structural analog",
        subtitle: typeof ev.label === "string" ? ev.label : null,
        entityIds: [],
      };
    case "taxonomy_inferred":
      return {
        title: typeof ev.label === "string" ? ev.label : "Taxonomy inferred",
        subtitle: typeof ev.kind === "string" ? ev.kind : null,
        entityIds: [],
      };
    case "causal_stage_ready":
      return {
        title: typeof ev.label === "string" ? ev.label : "Causal stage ready",
        subtitle: null,
        entityIds: [],
      };
    case "preliminary_hypothesis":
      return {
        title: typeof ev.headline === "string" ? ev.headline : "Early hypothesis",
        subtitle: typeof ev.body === "string" ? ev.body : null,
        entityIds: [],
      };
    default:
      return {
        title: typeof ev.label === "string" ? ev.label : type,
        subtitle: null,
        entityIds: [],
      };
  }
}
