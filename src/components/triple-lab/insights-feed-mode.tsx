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
import type { Entity } from "@/types";
import { useRunEventStoreOptional } from "@/components/canvas/hooks/run-event-store";
import { colors, tracking } from "./tokens";

interface InsightsFeedModeProps {
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

export function InsightsFeedMode({
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: ((streamed as any).id as string | undefined) ?? `${eventType}-${emittedAtMs}`,
        type: eventType,
        meta,
        title,
        subtitle,
        entityIds,
        emittedAt: emittedAtMs,
      });
    }
    // Newest first
    out.sort((a, b) => b.emittedAt - a.emittedAt);
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
          <FeedEmptyState hasStream={!!store} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {insights.map((insight) => {
              // "Fresh" = arrived strictly AFTER we mounted.
              const isFreshlySeen = insight.emittedAt > mountTime;
              return (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  isFresh={isFreshlySeen}
                  selected={
                    selectedEntityId !== null &&
                    insight.entityIds.includes(selectedEntityId)
                  }
                  onSelectEntity={onSelectEntity}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
function FeedEmptyState({ hasStream }: { hasStream: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: colors.brand.bgSoft }}
      >
        <span style={{ color: colors.brand.fg, fontSize: 16 }}>✦</span>
      </div>
      <div className="text-sm font-semibold text-slate-700">
        {hasStream ? "Insights will surface here as the pipeline runs"
                   : "Insights stream when a run is active"}
      </div>
      <div className="mt-1 max-w-[280px] text-xs leading-relaxed text-slate-500">
        Drop a paper or trigger a decompose — every cycle, bridge,
        hidden signal, root cause, and strategy proposal lands as a
        card in this feed.
      </div>
    </div>
  );
}

// ── Single insight card ─────────────────────────────────────────────
function InsightCard({
  insight,
  isFresh,
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
  };
  isFresh: boolean;
  selected: boolean;
  onSelectEntity: (id: string | null) => void;
}) {
  const onClick = () => {
    // Anchor selection to the first referenced entity so the right
    // panel + middle graph can both react.
    if (insight.entityIds.length > 0) onSelectEntity(insight.entityIds[0]);
  };

  return (
    <div
      onClick={onClick}
      className="cursor-pointer overflow-hidden rounded-xl border bg-white transition-all"
      style={{
        borderColor: selected
          ? insight.meta.accent
          : colors.neutral.borderFaint,
        boxShadow: selected
          ? `0 6px 18px ${colors.brand.shadow}`
          : isFresh
          ? `0 4px 14px ${insight.meta.accent}22`
          : colors.neutral.cardShadow,
        animation: isFresh ? "insight-card-arrive 480ms ease-out" : undefined,
      }}
    >
      {/* Accent stripe — color-codes the insight type at a glance */}
      <div style={{ height: 2, background: insight.meta.accent }} />

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamed: any,
  entities: Entity[],
): { title: string; subtitle: string | null; entityIds: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    default:
      return {
        title: typeof ev.label === "string" ? ev.label : type,
        subtitle: null,
        entityIds: [],
      };
  }
}
