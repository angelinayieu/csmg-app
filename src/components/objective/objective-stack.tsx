"use client";

// ── Objective Stack Widget ────────────────────────────────────────
//
// Phase 11.A.5 — visualizes the ObjectiveStack on the sub-objective
// picker page (and anywhere else the user benefits from seeing the
// structural skeleton of their problem). Renders 4-6 layers as a
// vertical stack with:
//
//   • Top: outcome / output layer (ordinal N)
//   • Middle: mechanism / process layers
//   • Bottom: substrate / foundational layer (ordinal 1)
//
// Between each adjacent pair: cross-layer influence arrows with verb
// labels ("enables", "produces", "depends on", "constrains",
// "measures", "aggregates"). Long-range influences (L_1 → L_top, etc.)
// listed in a separate "closures" footer rather than drawn as crossing
// lines — keeps the visualization tables-and-rectangles per lock-in
// M10 ("no D3, no force-directed").
//
// Click semantics:
//   • Variable chip → popover with description
//   • Layer name → onLayerClick callback (host can highlight
//     proposals touching that layer)
//   • Template badge → tooltip with template_rationale
//
// Coverage chip at the bottom uses pickedIds + taggedProposals to
// show per-layer coverage state — drives the user toward full-stack
// pickup at the picker.

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Info, RefreshCw, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  LayerInfluenceVerb,
  LayerVariable,
  ObjectiveLayer,
  ObjectiveStack,
} from "@/lib/objective-canvas/layer-model";

interface Props {
  stack: ObjectiveStack;
  /** Sub-objective proposals tagged with layer_ordinals. Used to
   *  compute coverage state per layer + show "this layer has N
   *  proposals" chip next to the layer name. Empty array tolerated. */
  taggedProposals?: Array<{ id: string; layer_ordinals: number[] }>;
  /** Proposal ids the user has picked / committed to. Coverage chip
   *  at the bottom reads from this. Empty array → all layers show
   *  uncovered state. */
  pickedIds?: string[];
  /** Fires when the user clicks a layer name. Host can filter
   *  proposal list to highlight matching ones. Optional. */
  onLayerClick?: (layerOrdinal: number) => void;
  /** Optional regenerate handler. When provided, shows a small refresh
   *  button in the header that the host can wire to the
   *  /layers/generate?mode=regenerate endpoint. */
  onRegenerate?: () => void;
  regenerating?: boolean;
  /** When true, the widget renders compact (no descriptions,
   *  smaller chips) — useful for embedded contexts. Default false. */
  compact?: boolean;
}

const VERB_LABEL: Record<LayerInfluenceVerb, string> = {
  enables: "enables",
  produces: "produces",
  depends_on: "depends on",
  constrains: "constrains",
  measures: "measures",
  aggregates: "aggregates",
};

const ARCHETYPE_COLOR: Record<ObjectiveLayer["archetype"], string> = {
  substrate: appleVibe.stage.pain,        // red — foundational, often the constraint
  mechanism: appleVibe.stage.features,    // blue — interventions
  process: appleVibe.accent.primary,      // accent — workflow / execution
  output: appleVibe.stage.outcomes,       // green — measurable signals
  outcome: appleVibe.stage.objective,     // purple — strategic target
};

const ARCHETYPE_LABEL: Record<ObjectiveLayer["archetype"], string> = {
  substrate: "substrate",
  mechanism: "mechanism",
  process: "process",
  output: "output",
  outcome: "outcome",
};

const TEMPLATE_LABEL: Record<string, string> = {
  software: "Software / App",
  cognition_health: "Cognition / Health",
  business_ops: "Business / Operations",
  behavior_change: "Behavior Change",
  scientific: "Scientific",
  generic: "Generic",
};

export function ObjectiveStackWidget({
  stack,
  taggedProposals = [],
  pickedIds = [],
  onLayerClick,
  onRegenerate,
  regenerating = false,
  compact = false,
}: Props) {
  // Render order: highest ordinal first (outcome at top) so CSS column
  // flow matches the user's mental model (stack reads top→bottom = high→low).
  const layersTopDown = useMemo(
    () => [...stack.layers].sort((a, b) => b.ordinal - a.ordinal),
    [stack.layers],
  );

  // Index proposals by layer for the per-layer count chip.
  const proposalCountByLayer = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of taggedProposals) {
      for (const ord of p.layer_ordinals) {
        counts.set(ord, (counts.get(ord) ?? 0) + 1);
      }
    }
    return counts;
  }, [taggedProposals]);

  // Coverage = which layers are touched by at least one PICKED proposal.
  const coverageByLayer = useMemo(() => {
    const covered = new Set<number>();
    if (pickedIds.length === 0) return covered;
    const pickedSet = new Set(pickedIds);
    for (const p of taggedProposals) {
      if (!pickedSet.has(p.id)) continue;
      for (const ord of p.layer_ordinals) covered.add(ord);
    }
    return covered;
  }, [pickedIds, taggedProposals]);

  // Cross-layer influences indexed by (from, to). Adjacent pairs render
  // inline between layers; long-range goes to the closures footer.
  const { adjacentInfluences, longRangeInfluences } = useMemo(() => {
    const adjacent = new Map<string, Array<{ verb: LayerInfluenceVerb; rationale?: string }>>();
    const longRange: Array<{
      from: number;
      to: number;
      verb: LayerInfluenceVerb;
      rationale?: string;
    }> = [];
    for (const inf of stack.influences) {
      const distance = Math.abs(inf.from_layer - inf.to_layer);
      if (distance === 1) {
        // Adjacent — index by the LOWER ordinal so we can find both
        // directions when rendering the gap between layers L_n and L_n+1.
        const lower = Math.min(inf.from_layer, inf.to_layer);
        const upper = Math.max(inf.from_layer, inf.to_layer);
        const key = `${lower}::${upper}`;
        const list = adjacent.get(key) ?? [];
        list.push({ verb: inf.verb, rationale: inf.rationale });
        adjacent.set(key, list);
      } else {
        longRange.push({
          from: inf.from_layer,
          to: inf.to_layer,
          verb: inf.verb,
          rationale: inf.rationale,
        });
      }
    }
    return { adjacentInfluences: adjacent, longRangeInfluences: longRange };
  }, [stack.influences]);

  const [openVariable, setOpenVariable] = useState<{
    layerId: string;
    variable: LayerVariable;
  } | null>(null);
  const [showTemplateTooltip, setShowTemplateTooltip] = useState(false);

  const totalVariables = useMemo(
    () => stack.layers.reduce((sum, l) => sum + l.variables.length, 0),
    [stack.layers],
  );

  return (
    <div
      className="relative w-full"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.lg,
        fontFamily: appleVibe.font.stack,
        boxShadow: appleVibe.shadow.card,
      }}
    >
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between gap-3 px-5 py-3"
        style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Objective Stack
          </span>
          <span
            className="font-light italic"
            style={{
              color: appleVibe.text.faint,
              fontSize: "11px",
            }}
          >
            · {stack.layers.length} layers · {totalVariables} variables
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <div
            className="relative"
            onMouseEnter={() => setShowTemplateTooltip(true)}
            onMouseLeave={() => setShowTemplateTooltip(false)}
          >
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.secondary,
                border: `1px solid ${appleVibe.stroke.hairline}`,
                cursor: "help",
              }}
            >
              <Info className="h-2.5 w-2.5" strokeWidth={2} />
              {TEMPLATE_LABEL[stack.domain_template] ?? stack.domain_template}
            </span>
            {showTemplateTooltip && stack.template_rationale && (
              <div
                className="absolute right-0 top-full z-50 mt-2 w-72 rounded-md px-3 py-2 text-[11px] font-light leading-snug"
                style={{
                  background: appleVibe.surface.card,
                  color: appleVibe.text.secondary,
                  border: `1px solid ${appleVibe.stroke.medium}`,
                  boxShadow: appleVibe.shadow.card,
                }}
              >
                {stack.template_rationale}
              </div>
            )}
          </div>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-[rgba(15,23,42,0.04)] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                color: appleVibe.text.tertiary,
                border: `1px solid ${appleVibe.stroke.hairline}`,
                background: "transparent",
              }}
              title="Regenerate stack from current clarifying answers"
            >
              <RefreshCw
                className={`h-2.5 w-2.5 ${regenerating ? "animate-spin" : ""}`}
                strokeWidth={2}
              />
              {regenerating ? "Regenerating…" : "Regenerate"}
            </button>
          )}
        </div>
      </header>

      {/* ── Stack body — layers rendered top-down ── */}
      <div className="px-5 py-4">
        {layersTopDown.map((layer, idx) => {
          const isLast = idx === layersTopDown.length - 1;
          const isCovered = coverageByLayer.has(layer.ordinal);
          const proposalCount = proposalCountByLayer.get(layer.ordinal) ?? 0;
          // Adjacent influence to the layer BELOW (lower ordinal).
          const lowerOrdinal = layer.ordinal - 1;
          const influenceKey = `${lowerOrdinal}::${layer.ordinal}`;
          const inlineInfluences = adjacentInfluences.get(influenceKey) ?? [];

          return (
            <div key={layer.id}>
              {/* Layer row */}
              <div
                className="rounded-2xl px-3 py-2.5 transition-colors duration-150"
                style={{
                  background: isCovered
                    ? `${ARCHETYPE_COLOR[layer.archetype]}0A`
                    : appleVibe.surface.cardElevated,
                  border: `1px solid ${
                    isCovered
                      ? `${ARCHETYPE_COLOR[layer.archetype]}33`
                      : appleVibe.stroke.hairline
                  }`,
                }}
              >
                {/* Header row — ordinal · archetype · name · proposal count · coverage state */}
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span
                      className="font-mono text-[10.5px] font-semibold tabular-nums"
                      style={{
                        color: ARCHETYPE_COLOR[layer.archetype],
                        letterSpacing: "0.02em",
                      }}
                    >
                      {layer.id}
                    </span>
                    <button
                      type="button"
                      onClick={() => onLayerClick?.(layer.ordinal)}
                      className="min-w-0 truncate text-left text-[13.5px] font-semibold leading-tight tracking-tight transition-colors hover:underline"
                      style={{
                        color: appleVibe.text.primary,
                        letterSpacing: "-0.01em",
                      }}
                      title={`Focus proposals at ${layer.name}`}
                    >
                      {layer.name}
                    </button>
                    <span
                      className="font-light italic"
                      style={{
                        color: appleVibe.text.tertiary,
                        fontSize: "10px",
                      }}
                    >
                      · {ARCHETYPE_LABEL[layer.archetype]}
                    </span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {proposalCount > 0 && (
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold"
                        style={{
                          background: `${appleVibe.accent.primary}14`,
                          color: appleVibe.accent.primary,
                        }}
                        title={`${proposalCount} proposal${proposalCount === 1 ? "" : "s"} touching this layer`}
                      >
                        {proposalCount} prop{proposalCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {isCovered && (
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em]"
                        style={{
                          background: `${ARCHETYPE_COLOR[layer.archetype]}14`,
                          color: ARCHETYPE_COLOR[layer.archetype],
                        }}
                      >
                        covered
                      </span>
                    )}
                  </div>
                </div>

                {/* Description */}
                {!compact && layer.description && (
                  <p
                    className="mb-2 text-[11.5px] font-light leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    {layer.description}
                  </p>
                )}

                {/* Variable chips */}
                <div className="flex flex-wrap gap-1">
                  {layer.variables.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() =>
                        setOpenVariable({ layerId: layer.id, variable: v })
                      }
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors hover:bg-[rgba(15,23,42,0.05)]"
                      style={{
                        background: appleVibe.surface.chip,
                        color: appleVibe.text.secondary,
                        border: `1px solid ${appleVibe.stroke.hairline}`,
                      }}
                      title={v.description.slice(0, 120)}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Adjacent influences arrow row — between this layer and the one below */}
              {!isLast && (
                <div className="my-1.5 flex justify-center">
                  <div className="flex flex-col items-center gap-0.5">
                    {inlineInfluences.length === 0 ? (
                      <div
                        className="font-mono text-[9.5px]"
                        style={{ color: appleVibe.text.faint }}
                      >
                        ↑
                      </div>
                    ) : (
                      inlineInfluences.map((inf, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1"
                          title={inf.rationale ?? undefined}
                        >
                          <span
                            className="font-mono text-[9.5px]"
                            style={{ color: appleVibe.text.faint }}
                          >
                            ↑
                          </span>
                          <span
                            className="text-[9.5px] font-light italic"
                            style={{ color: appleVibe.text.tertiary }}
                          >
                            {VERB_LABEL[inf.verb]}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Long-range closures footer ── */}
      {longRangeInfluences.length > 0 && (
        <div
          className="px-5 py-2.5"
          style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
        >
          <div
            className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Long-range closures
          </div>
          <ul className="flex flex-col gap-0.5">
            {longRangeInfluences.map((inf, i) => (
              <li
                key={i}
                className="text-[10.5px] font-light leading-snug"
                style={{ color: appleVibe.text.secondary }}
                title={inf.rationale ?? undefined}
              >
                <span className="font-mono">L{inf.from}</span>
                <span style={{ color: appleVibe.text.tertiary }}> → </span>
                <span className="font-mono">L{inf.to}</span>
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

      {/* ── Coverage chip ── */}
      <div
        className="px-5 py-3"
        style={{
          borderTop: `1px solid ${appleVibe.stroke.hairline}`,
          background: appleVibe.surface.chip,
          borderBottomLeftRadius: appleVibe.radius.lg,
          borderBottomRightRadius: appleVibe.radius.lg,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: appleVibe.text.tertiary }}
            >
              Coverage
            </span>
            {stack.layers.map((l) => {
              const covered = coverageByLayer.has(l.ordinal);
              return (
                <span
                  key={l.id}
                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                  style={{
                    background: covered
                      ? `${ARCHETYPE_COLOR[l.archetype]}14`
                      : "transparent",
                    color: covered
                      ? ARCHETYPE_COLOR[l.archetype]
                      : appleVibe.text.tertiary,
                    border: `1px solid ${
                      covered
                        ? `${ARCHETYPE_COLOR[l.archetype]}33`
                        : appleVibe.stroke.hairline
                    }`,
                  }}
                  title={`${l.name} — ${covered ? "covered" : "uncovered"}`}
                >
                  <span className="font-mono">{l.id}</span>
                  <span aria-hidden>{covered ? "✓" : "○"}</span>
                </span>
              );
            })}
          </div>
          {pickedIds.length > 0 &&
            coverageByLayer.size < stack.layers.length && (
              <span
                className="font-light italic"
                style={{
                  color: appleVibe.text.tertiary,
                  fontSize: "10.5px",
                }}
              >
                ⚠ {stack.layers.length - coverageByLayer.size} layer
                {stack.layers.length - coverageByLayer.size === 1 ? "" : "s"} uncovered
              </span>
            )}
        </div>
      </div>

      {/* ── Variable popover ── */}
      <AnimatePresence>
        {openVariable && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: "rgba(15,23,42,0.32)" }}
            onClick={() => setOpenVariable(null)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl p-5"
              style={{
                background: appleVibe.surface.card,
                border: `1px solid ${appleVibe.stroke.medium}`,
                boxShadow: appleVibe.shadow.card,
              }}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-mono text-[10.5px] font-semibold"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    {openVariable.layerId}
                  </span>
                  <h3
                    className="text-[15px] font-semibold leading-tight tracking-tight"
                    style={{
                      color: appleVibe.text.primary,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {openVariable.variable.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenVariable(null)}
                  className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.06)]"
                  aria-label="Close"
                >
                  <X
                    className="h-3 w-3"
                    strokeWidth={2}
                    style={{ color: appleVibe.text.secondary }}
                  />
                </button>
              </div>
              {openVariable.variable.domain_tag && (
                <span
                  className="mb-2 inline-block text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {openVariable.variable.domain_tag}
                </span>
              )}
              <p
                className="text-[12.5px] font-light leading-relaxed"
                style={{ color: appleVibe.text.secondary }}
              >
                {openVariable.variable.description || "No description provided."}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
