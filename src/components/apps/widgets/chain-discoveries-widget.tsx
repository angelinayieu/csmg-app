"use client";

// ── Chain Discoveries widget (VP Project — "why this, in 6 steps") ────────
//
// Renders persisted `CausalChain[]` — the provenance-linked trajectory from
// an L4 invariant in synthesis all the way to measurable goal contribution.
// Each chain has exactly 6 stages (concept → research → deliverable →
// application → outcome → goal), so the card layout is fixed: a horizontal
// mini-timeline of 6 beads with tooltips.
//
// Data source: `causal_chains` resolver reads `synthesis_data.causal_chains`
// already produced by the causal-chain propagator agent. Zero extra
// fetches.
//
// Sorted by rank (which is itself goal_contribution_pct desc). Default cap
// of 4 cards in the grid so the widget doesn't dominate the page — user
// can click "Show all" once we add an expansion affordance in Batch 5.

import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type { CausalChain, CausalStage, CausalStageKind } from "@/types/causal-chains";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";
import { cn } from "@/lib/utils";

interface ChainDiscoveriesConfig {
  title?: string;
  /** Cap on rendered chains. Default 4. */
  maxChains?: number;
}

// Stable color per stage kind — matches the six-step visual from the VP
// Project design. Muted enough to sit in a dashboard without fighting the
// loud variant_carousel above it.
const STAGE_META: Record<CausalStageKind, { color: string; glyph: string; label: string }> = {
  concept: { color: "#6366f1", glyph: "◆", label: "Concept" },
  research: { color: "#0ea5e9", glyph: "◉", label: "Research" },
  deliverable: { color: "#10b981", glyph: "▲", label: "Deliverable" },
  application: { color: "#f59e0b", glyph: "■", label: "Application" },
  outcome: { color: "#ef4444", glyph: "●", label: "Outcome" },
  goal: { color: "#a855f7", glyph: "★", label: "Goal" },
};

export function ChainDiscoveries({
  instance,
  context,
}: WidgetComponentProps<ChainDiscoveriesConfig>) {
  const cfg = instance.config ?? {};
  const chainsRes = context.resolve<CausalChain[]>(instance.bindings?.chains);
  const rawChains = chainsRes.value ?? [];

  if (rawChains.length === 0) {
    return (
      <Surface density="comfortable">
        <WidgetTitle
          eyebrow="Discoveries"
          title={cfg.title ?? "Causal chains"}
        />
        <WidgetEmpty>
          No causal chains propagated yet. These land after synthesis once
          the chain-propagator finishes scoring L4 convergences.
        </WidgetEmpty>
      </Surface>
    );
  }

  const maxChains = cfg.maxChains ?? 4;
  const chains = [...rawChains]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maxChains);

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Discoveries"
        title={cfg.title ?? "Causal chains"}
        subtitle={`${chains.length} of ${rawChains.length} provenance trajectories — concept → goal`}
      />
      <div className="mt-3 grid gap-2.5">
        {chains.map((chain) => (
          <ChainCard key={chain.id} chain={chain} />
        ))}
      </div>
    </Surface>
  );
}

// ── Single chain card ──────────────────────────────────────────────────

function ChainCard({ chain }: { chain: CausalChain }) {
  const pct = chain.goal_contribution_pct;
  const pctSign = pct >= 0 ? "+" : "";
  const pctColor = pct >= 0 ? "text-emerald-600" : "text-rose-600";
  const confPct = Math.round(chain.confidence * 100);

  return (
    <div className="rounded-xl border border-gray-200/70 bg-white/60 p-3 transition-shadow hover:shadow-sm">
      {/* Header: rank + name + contribution + confidence */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gray-900 px-1.5 text-[10px] font-bold text-white">
            {chain.rank}
          </span>
          <span className="truncate text-[13px] font-semibold text-gray-900">
            {chain.name}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 text-[11px]">
          <span className={cn("font-bold tabular-nums", pctColor)}>
            {pctSign}
            {pct.toFixed(1)}
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500">{confPct}% conf.</span>
        </div>
      </div>

      {/* 6-stage mini timeline */}
      <div className="flex items-center gap-0.5">
        {chain.stages.map((stage, i) => (
          <StageBead
            key={i}
            stage={stage}
            isLast={i === chain.stages.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// ── Stage bead with connector line ──────────────────────────────────

function StageBead({ stage, isLast }: { stage: CausalStage; isLast: boolean }) {
  const meta = STAGE_META[stage.kind];
  const confDim = stage.confidence != null && stage.confidence < 0.5;
  const tip = [
    `${meta.label}: ${stage.title}`,
    stage.meta ? `— ${stage.meta}` : null,
    stage.value_label ? `→ ${stage.value_label}` : null,
    stage.confidence != null ? `(${Math.round(stage.confidence * 100)}% conf.)` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div
        className="group/stage flex min-w-0 flex-1 flex-col items-center gap-1"
        title={tip}
      >
        <div
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold transition-transform group-hover/stage:scale-110",
            confDim && "opacity-60",
          )}
          style={{
            background: `${meta.color}22`,
            color: meta.color,
            border: `1px solid ${meta.color}55`,
          }}
        >
          {meta.glyph}
        </div>
        <div className="w-full truncate text-center text-[9px] font-medium text-gray-500">
          {stage.title}
        </div>
      </div>
      {!isLast && (
        <div
          aria-hidden
          className="mt-[-14px] h-px w-2 flex-shrink-0 bg-gradient-to-r from-gray-300 to-gray-200"
        />
      )}
    </>
  );
}
