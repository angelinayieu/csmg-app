"use client";

// ── ProbabilitySpaceRail (Phase 2E · Tier 2) ──
//
// Chrome-layer surface that renders one floating glass card per
// open probability space. Subscribes to the structural event
// stream via useStructuralEventStream — each `space_opened` event
// materializes a new shell; `space_entity_added` fills it with
// mini-chips; `space_merge_begin` / `space_merge_complete` plays
// the convergence animation.
//
// Layout: shells fan out in a wide horizontal band below the
// origin card. Each shell is a glass card ~220×140 with an accent
// bar, axis label, rationale tooltip, and a content area that
// fills in as events arrive.
//
// This turn ships the SHELL + `space_opened` handling only.
// Per-axis entity filling + merge animation ship with the
// follow-up generator endpoints.

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStructuralEventStream } from "../hooks/use-structural-event-stream";
import { RunRatingChip } from "./run-rating-chip";
import {
  AXIS_CATALOG,
  type AxisMeta,
} from "@/lib/probability-space/axis-catalog";
import type {
  CrossSpaceLinkEvent,
  ProbabilitySpaceAxis,
  SpaceEdgeAddedEvent,
  SpaceEntityAddedEvent,
  SpaceMergeBeginEvent,
  SpaceMergeCompleteEvent,
  SpaceOpenedEvent,
} from "@/types/pipeline-events";

export interface ProbabilitySpaceRailProps {
  runId: string | null;
  /**
   * When true (run completed), shells fade out gracefully after
   * the merge animation. Parent drives this via the same SSE
   * stream's run status.
   */
  runDone?: boolean;
}

interface ShellState {
  spaceKey: string;
  axis: ProbabilitySpaceAxis;
  label: string;
  tagline: string;
  accent: string;
  rationale: string;
  orderIndex: number;
  /** Entities streamed into this shell via space_entity_added events. */
  entities: Array<{ entityId: string; name: string; weight: number }>;
  /** Phase 2E · PR 3 — intra-axis edges from space_edge_added events.
   *  Rendered as mechanism lines in the expanded shell below the
   *  chips. Source/target are entityIds that match the entries in
   *  `entities`. */
  edges: Array<{
    sourceEntityId: string;
    targetEntityId: string;
    mechanism: string;
    polarity: SpaceEdgeAddedEvent["polarity"];
    dynamics: SpaceEdgeAddedEvent["dynamics"];
    confidence: number;
  }>;
  /** True when space_merge_begin has fired — shell starts
   *  translating toward center + fading. */
  merging: boolean;
}

/** Phase 2E · PR 4 — leverage summary sourced from
 *  `cross_space_link` + `space_merge_complete` events. Drives the
 *  gold-ring indicator on chips and the summary pill below the rail.
 *
 *  The linker emits one `cross_space_link` event per group carrying a
 *  CANONICAL entityId + the axes the group spans. Chip rendering
 *  matches by normalized NAME (not id) so every axis-scoped
 *  duplicate — e.g., `${runId}:financial:c3` and `${runId}:actors:c1`
 *  both named "customer retention" — gets the ring. Matching by id
 *  wouldn't work: the linker only carries the first occurrence's id,
 *  not every member. */
interface LeverageState {
  /** Keyed by normalized entity name. Chip renderer normalizes its
   *  own name with the same function (inlined below) for the lookup. */
  leverageByName: Map<string, { name: string; axes: ProbabilitySpaceAxis[] }>;
  /** Present after `space_merge_complete` fires. */
  summary: {
    solo: number;
    leverage: number;
  } | null;
}

/** Kept in sync with the server-side normalizer in
 *  /api/pipeline/cross-space-linker so lookups match. */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

export function ProbabilitySpaceRail({
  runId,
  runDone,
}: ProbabilitySpaceRailProps) {
  const { events } = useStructuralEventStream(runId);

  // Reduce event stream → shell state map + leverage state. Keyed
  // by spaceKey so later events can find + mutate their shell.
  const { shells, leverage } = useMemo(() => {
    const byKey = new Map<string, ShellState>();
    const leverageByName = new Map<
      string,
      { name: string; axes: ProbabilitySpaceAxis[] }
    >();
    let summary: LeverageState["summary"] = null;
    for (const { event } of events) {
      if (event.type === "space_opened") {
        const e = event as SpaceOpenedEvent;
        if (!byKey.has(e.spaceKey)) {
          byKey.set(e.spaceKey, {
            spaceKey: e.spaceKey,
            axis: e.axis,
            label: e.label,
            tagline: e.tagline,
            accent: e.accent,
            rationale: e.rationale,
            orderIndex: e.orderIndex,
            entities: [],
            edges: [],
            merging: false,
          });
        }
      } else if (event.type === "space_entity_added") {
        const e = event as SpaceEntityAddedEvent;
        const shell = byKey.get(e.spaceKey);
        if (shell) {
          shell.entities.push({
            entityId: e.entityId,
            name: e.name,
            weight: e.weight,
          });
        }
      } else if (event.type === "space_edge_added") {
        // PR 3 — intra-axis edges land here. Guard against arrival
        // before endpoints (event ordering guarantees entities first
        // via sequence, but defensive check keeps reducer pure if
        // events ever deliver out of order).
        const e = event as SpaceEdgeAddedEvent;
        const shell = byKey.get(e.spaceKey);
        if (shell) {
          shell.edges.push({
            sourceEntityId: e.sourceEntityId,
            targetEntityId: e.targetEntityId,
            mechanism: e.mechanism,
            polarity: e.polarity,
            dynamics: e.dynamics,
            confidence: e.confidence,
          });
        }
      } else if (event.type === "space_merge_begin") {
        const e = event as SpaceMergeBeginEvent;
        for (const key of e.spaceKeys) {
          const shell = byKey.get(key);
          if (shell) shell.merging = true;
        }
      } else if (event.type === "cross_space_link") {
        // PR 4 — mark all chips whose normalized name matches this
        // group as leverage entities. Axes list goes in the tooltip.
        const e = event as CrossSpaceLinkEvent;
        leverageByName.set(normalizeName(e.name), {
          name: e.name,
          axes: e.axes,
        });
      } else if (event.type === "space_merge_complete") {
        const e = event as SpaceMergeCompleteEvent;
        summary = {
          solo: e.soloEntityCount,
          leverage: e.leverageEntityCount,
        };
      }
    }
    const sortedShells = Array.from(byKey.values()).sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    const leverageState: LeverageState = {
      leverageByName,
      summary,
    };
    return { shells: sortedShells, leverage: leverageState };
  }, [events]);

  if (runId === null || shells.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-3 px-8"
      style={{
        // Sit clear of the origin card (top-20 = 80px + prompt card
        // ~200px tall when full + flow line buffer). Earlier 220 left
        // the "THINKING FROM" prompt clipped behind the first shell.
        top: 310,
      }}
    >
      <div className="flex flex-wrap items-start justify-center gap-5">
        {shells.map((shell) => (
          <SpaceShell
            key={shell.spaceKey}
            shell={shell}
            runDone={Boolean(runDone)}
            leverage={leverage}
          />
        ))}
      </div>
      {/* PR 4 — merge summary pill. Shows once the linker emits
          `space_merge_complete`. Frames the convergence as a leverage
          signal: "N entities appeared across M lenses" is what the
          user should walk away understanding. */}
      {leverage.summary && (
        <div
          className="pointer-events-auto mt-1 flex items-center gap-2 rounded-full border border-amber-300/50 bg-white/70 px-3 py-1 text-[10.5px] font-medium text-gray-700 shadow-sm backdrop-blur"
          title="Leverage entities appear in 2+ axes. Solo entities are unique to a single lens."
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "#d4a11f" }}
          />
          <span className="tabular-nums text-amber-700 font-semibold">
            {leverage.summary.leverage}
          </span>
          <span className="text-gray-500">leverage</span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums text-gray-700 font-semibold">
            {leverage.summary.solo}
          </span>
          <span className="text-gray-500">solo</span>
        </div>
      )}

      {/* PR 6.1 — run rating chip. Appears once the run completes
          (parent passes runDone=true) AND the merge summary has
          landed, which together signal "this run has something
          worth rating." Rating ≥4 feeds the self-improvement loop
          via axis_candidate_exemplars; lower ratings are stored for
          telemetry. The chip lives on the rail (not the top-right
          HUD) because the rail is already where the user's
          attention is at merge time — one less surface to scan. */}
      {runDone && leverage.summary && runId && (
        <RunRatingChip runId={runId} />
      )}
    </div>
  );
}

// ── SpaceShell (Phase 2H visual upgrade) ──
//
// Apple/Figma-tier manifold card. Replaces the previous dense glass
// panel with:
//   • a soft radial density field (accent-tinted ellipse, heavy
//     blur) that gives each axis a distinct "probability flavor"
//     instead of a rectangle with a tag header
//   • typography-first header — thin kerned caps axis label + a
//     display-scale entity count, not competing pills
//   • pill chips without hard borders — subtle accent tint, gentle
//     wrap, leverage chips have a soft gold aura (no chunky border)
//   • a pulse dot while the axis generator is still emitting (goes
//     still when no new entities land for ~2s)
//   • a single calm "Why this lens" affordance at the bottom to
//     reveal rationale + relationships — no competing expand nubs
//
// Motion: opens with a smooth translate+scale on first event;
// merges translate+fade toward page center; entities pop in with a
// short scale-from-0.9 spring (handled by CSS transition).

function SpaceShell({
  shell,
  runDone,
  leverage,
}: {
  shell: ShellState;
  runDone: boolean;
  leverage: LeverageState;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta: AxisMeta = AXIS_CATALOG[shell.axis];
  const isEmpty = shell.entities.length === 0;
  const isActive = !runDone && !shell.merging && !isEmpty;

  // Keep shells crisp and fully opaque — they're the KG's entry points
  // for the user, not ephemeral animation frames. Earlier the post-run
  // fade (0.82) + merge translucence (0.28) made the panel look broken
  // or stalled once the pipeline settled.
  const transform = "translateY(0) scale(1)";
  const opacity = 1;

  return (
    <div
      className={cn(
        "pointer-events-auto group relative isolate overflow-hidden rounded-[20px]",
        "bg-white/72 backdrop-blur-2xl",
        "border border-black/[0.04]",
        "shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-14px_rgba(16,24,40,0.14)]",
        "transition-all duration-[520ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
      )}
      style={{
        width: 300,
        transform,
        opacity,
      }}
    >
      {/* Soft density field — the "probability" flavor. Large blurred
          ellipse at the top, accent-tinted, ~12% opacity. Gives the
          card a gradient depth without a solid fill. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[120%]"
        style={{
          background: `radial-gradient(ellipse 85% 55% at 50% 18%, color-mix(in srgb, ${shell.accent} 16%, transparent) 0%, transparent 72%)`,
        }}
      />

      {/* Top row — axis label + tagline on left, count on right */}
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-0.5">
        <div className="min-w-0 flex-1">
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: shell.accent }}
            title={meta.label}
          >
            {meta.label}
          </div>
          <div className="mt-1 line-clamp-1 text-[11px] font-medium text-gray-500">
            {shell.tagline}
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          {isEmpty && !runDone ? (
            <span className="text-[10px] font-medium italic text-gray-400">
              opening<AnimatedEllipsis />
            </span>
          ) : isEmpty ? (
            <span className="text-[10px] font-medium text-gray-300">—</span>
          ) : (
            <>
              <span
                className="font-semibold leading-none tabular-nums"
                style={{
                  color: shell.accent,
                  fontSize: 26,
                  letterSpacing: "-0.02em",
                }}
              >
                {shell.entities.length}
              </span>
              {isActive && (
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ background: shell.accent }}
                  aria-hidden
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Entity pills — borderless, flow layout. Only render when
          non-empty; empty state above communicates "opening". */}
      {shell.entities.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-5 pb-3 pt-2.5">
          {shell.entities.slice(0, 6).map((e) => {
            const lever = leverage.leverageByName.get(normalizeName(e.name));
            const isLeverage = Boolean(lever);
            return (
              <span
                key={e.entityId}
                className={cn(
                  "inline-flex max-w-[240px] truncate rounded-full px-2.5 py-0.5 text-[10.5px] font-medium",
                  "transition-all duration-200",
                )}
                style={{
                  background: isLeverage
                    ? "color-mix(in srgb, #d4a11f 14%, transparent)"
                    : `color-mix(in srgb, ${shell.accent} 10%, transparent)`,
                  color: isLeverage ? "#92670b" : shell.accent,
                  boxShadow: isLeverage
                    ? "0 0 0 1px rgba(212,161,31,0.35), 0 0 10px rgba(212,161,31,0.18)"
                    : undefined,
                }}
                title={
                  lever
                    ? `Cross-lens leverage · appears in ${lever.axes.length} lenses: ${lever.axes.join(", ")}`
                    : e.name
                }
              >
                {e.name}
              </span>
            );
          })}
          {shell.entities.length > 6 && (
            <span className="inline-flex items-center text-[10px] font-medium text-gray-400">
              +{shell.entities.length - 6}
            </span>
          )}
        </div>
      )}

      {/* "Why this lens" — single calm affordance. Collapsed by default. */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between border-t border-black/[0.04] px-5 py-2.5 text-[10.5px] font-medium text-gray-500 transition-colors hover:bg-gray-50/60 hover:text-gray-700"
      >
        <span>{expanded ? "Hide context" : "Why this lens"}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-300",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="px-5 pb-4 pt-1">
          <p className="text-[11.5px] leading-relaxed text-gray-600">
            {shell.rationale}
          </p>
          {shell.edges.length > 0 && <SpaceRelationships shell={shell} />}
        </div>
      )}
    </div>
  );
}

// Small animated ellipsis for "opening…" state.
function AnimatedEllipsis() {
  return (
    <span className="inline-flex">
      <span className="animate-[fadeInOut_1.4s_ease-in-out_infinite]">.</span>
      <span className="animate-[fadeInOut_1.4s_ease-in-out_0.2s_infinite]">
        .
      </span>
      <span className="animate-[fadeInOut_1.4s_ease-in-out_0.4s_infinite]">
        .
      </span>
    </span>
  );
}

// ── Intra-axis relationships (Phase 2E · PR 3) ──

function SpaceRelationships({ shell }: { shell: ShellState }) {
  const MAX_VISIBLE = 5;
  const nameById = new Map(
    shell.entities.map((e) => [e.entityId, e.name] as const),
  );
  const visibleEdges = shell.edges.slice(0, MAX_VISIBLE);
  const overflow = shell.edges.length - visibleEdges.length;

  const polarityAccent = (
    p: ShellState["edges"][number]["polarity"],
  ): string => {
    if (p === "positive") return "#16a34a";
    if (p === "negative") return "#dc2626";
    if (p === "conditional") return "#d97706";
    return "#64748b";
  };

  const polaritySymbol = (
    p: ShellState["edges"][number]["polarity"],
  ): string => {
    if (p === "positive") return "+";
    if (p === "negative") return "−";
    if (p === "conditional") return "?";
    return "·";
  };

  return (
    <div className="mt-2">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">
        {shell.edges.length} relationship{shell.edges.length === 1 ? "" : "s"}
      </div>
      <div className="flex flex-col gap-1">
        {visibleEdges.map((edge, i) => {
          const src = nameById.get(edge.sourceEntityId);
          const tgt = nameById.get(edge.targetEntityId);
          if (!src || !tgt) return null;
          const pc = polarityAccent(edge.polarity);
          return (
            <div
              key={`${edge.sourceEntityId}-${edge.targetEntityId}-${i}`}
              className="rounded-md px-1.5 py-1 text-[10px] leading-snug"
              style={{
                background: `color-mix(in srgb, ${shell.accent} 4%, transparent)`,
              }}
              title={edge.mechanism}
            >
              <div className="flex items-center gap-1.5 text-[9.5px] font-semibold">
                <span className="truncate text-gray-700" style={{ maxWidth: 90 }}>
                  {src}
                </span>
                <span
                  className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full font-mono text-[9px]"
                  style={{ background: `${pc}18`, color: pc }}
                  title={`polarity: ${edge.polarity} · dynamics: ${edge.dynamics}`}
                >
                  {polaritySymbol(edge.polarity)}
                </span>
                <span className="truncate text-gray-700" style={{ maxWidth: 90 }}>
                  {tgt}
                </span>
              </div>
              <div className="mt-0.5 line-clamp-2 text-[9.5px] italic text-gray-500">
                {edge.mechanism}
              </div>
            </div>
          );
        })}
        {overflow > 0 && (
          <span className="text-[9.5px] text-gray-400">
            +{overflow} more relationship{overflow === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
