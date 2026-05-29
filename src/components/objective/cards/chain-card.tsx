"use client";

// ── Chain Card ──
//
// One complete strategic proposition: Friction → Mechanism → Result.
// This is what gets approved and promoted to the main canvas. Each
// chain card is therefore the highest-value surface in the room.
//
// Compact view (3 stacked nodes with verbs on the arrows + composite
// strength). Click to expand and see:
//   • Why-it-works: root_cause × first_principle crosswalk
//   • Measurement: outcome.measured_by
//   • Risk: friction's other root_causes this chain doesn't address
//   • Alternatives: other mechanisms that also counter this friction
//   • Approve as a strategic bet (approves both underlying edges)

import { motion } from "framer-motion";
import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ChainTriple } from "@/lib/objective-canvas/compute-chains";

export interface ChainCardLaneLabels {
  pain: string;
  features: string;
  outcomes: string;
}

interface AlternativeRef {
  /** The other mechanism's name. */
  name: string;
  /** Composite strength if this alternative were the bridge. */
  strength: number;
  /** Result it produces (best-strength choice when multiple). */
  outcomeName: string;
}

interface CrosswalkRow {
  rootCause: string;
  firstPrinciple: string;
}

/** Tier 3 — the category triple resolved to display data. Each
 *  entry has the human label + the color for the lane. Null when
 *  that item didn't carry a sub_category. */
export interface ChainArchetype {
  pain: { label: string; color: string } | null;
  feature: { label: string; color: string } | null;
  result: { label: string; color: string } | null;
}

interface Props {
  chain: ChainTriple;
  /** Adaptive lane labels — drive the layer chips on each row
   *  ("Frictions / Mechanisms / Results" or whatever this room's
   *  LLM-picked nouns are). */
  laneLabels: ChainCardLaneLabels;
  /** Tier 3 — resolved category triple for the archetype label.
   *  Null entries are tolerated; we render only what's present. */
  archetype: ChainArchetype;
  /** Root causes of the friction. Used in the why-it-works
   *  crosswalk + risk list. */
  painRootCauses: string[];
  /** First principles of the mechanism. */
  featureFirstPrinciples: string[];
  /** Measured-by signal from the result. */
  outcomeMeasuredBy: string | null;
  /** Other mechanisms (besides this chain's feature) that also
   *  address the same friction — surfaced so the user can compare
   *  bets. */
  alternatives: AlternativeRef[];
  /** Approval state — both underlying edges must be approved for
   *  the chain to count as approved. */
  approved: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  /** Hover handler so the lane cards highlight in sync. */
  onHover: (sourceId: string | null) => void;
}

export function ChainCard({
  chain,
  laneLabels,
  archetype,
  painRootCauses,
  featureFirstPrinciples,
  outcomeMeasuredBy,
  alternatives,
  approved,
  busy,
  onApprove,
  onReject,
  onHover,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round(chain.composite * 100);
  const compositeColor =
    pct >= 75 ? "#16A34A" : pct >= 50 ? "#D97706" : "#94A3B8";

  // Crosswalk: we don't have an explicit LLM-generated mapping from
  // root_cause → first_principle. We approximate it positionally
  // (first cause aligns with first principle, etc.) up to min(N, M).
  // This is good-enough heuristic UI; a future LLM pass could emit
  // the explicit pairing.
  const crosswalk: CrosswalkRow[] = [];
  for (
    let i = 0;
    i < Math.min(painRootCauses.length, featureFirstPrinciples.length);
    i++
  ) {
    crosswalk.push({
      rootCause: painRootCauses[i]!,
      firstPrinciple: featureFirstPrinciples[i]!,
    });
  }

  // Unaddressed causes (risk) = root causes not covered by the
  // positional crosswalk (i.e., causes past the principle count).
  const unaddressedCauses = painRootCauses.slice(crosswalk.length);

  return (
    <motion.li
      layout
      transition={{ layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
      whileHover={{ y: -2 }}
      className="p-4"
      style={{
        // Frosted glass, not flat white — the surface reads as a pane
        // of light over the canvas. Approved chains carry a soft
        // outcome-green bloom (color as light, not a flat tint + hard
        // border) so the "this is a live bet" signal feels lit, not painted.
        background: approved
          ? `linear-gradient(180deg, ${appleVibe.stage.outcomes}0e, rgba(255,255,255,0.72))`
          : "rgba(255,255,255,0.72)",
        backdropFilter: "blur(16px) saturate(140%)",
        WebkitBackdropFilter: "blur(16px) saturate(140%)",
        border: `1px solid ${
          approved
            ? `${appleVibe.stage.outcomes}33`
            : appleVibe.stroke.soft
        }`,
        borderRadius: appleVibe.radius.lg,
        boxShadow: approved
          ? `${appleVibe.shadow.card}, 0 0 0 1px ${appleVibe.stage.outcomes}14, 0 10px 30px -14px ${appleVibe.stage.outcomes}55`
          : appleVibe.shadow.card,
      }}
      onMouseEnter={() => onHover(chain.painId)}
      onMouseLeave={() => onHover(null)}
    >
      {/* ── Archetype label (the cross-category triple) ──
          The category triple IS the strategic-bet archetype. Renders
          as 3 quiet outline chips with a hairline middot separator —
          monochrome chrome so the colored dots inside each chip carry
          the lane identity without screaming. */}
      {(archetype.pain || archetype.feature || archetype.result) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {archetype.pain && (
            <CategoryPip
              label={archetype.pain.label}
              color={archetype.pain.color}
            />
          )}
          {archetype.pain && archetype.feature && (
            <span
              className="text-[10px] font-light"
              style={{ color: appleVibe.text.faint }}
              aria-hidden
            >
              ·
            </span>
          )}
          {archetype.feature && (
            <CategoryPip
              label={archetype.feature.label}
              color={archetype.feature.color}
            />
          )}
          {archetype.feature && archetype.result && (
            <span
              className="text-[10px] font-light"
              style={{ color: appleVibe.text.faint }}
              aria-hidden
            >
              ·
            </span>
          )}
          {archetype.result && (
            <CategoryPip
              label={archetype.result.label}
              color={archetype.result.color}
            />
          )}
        </div>
      )}

      {/* ── Compact chain (3 nodes + 2 bridges) ── */}
      <div className="flex flex-col gap-1.5">
        <ChainNode
          color={appleVibe.stage.pain}
          label={laneLabels.pain}
          name={chain.painName}
        />
        <BridgeRow
          verb={chain.painFeatureEdge.relationship_type || "addresses"}
          mechanism={chain.mechanism}
        />
        <ChainNode
          color={appleVibe.stage.features}
          label={laneLabels.features}
          name={chain.featureName}
        />
        <BridgeRow
          verb={chain.featureOutcomeEdge.relationship_type || "produces"}
        />
        <ChainNode
          color={appleVibe.stage.outcomes}
          label={laneLabels.outcomes}
          name={chain.outcomeName}
          subtitle={outcomeMeasuredBy ? `measured by ${outcomeMeasuredBy}` : undefined}
        />
      </div>

      {/* ── Composite strength + expand + approve ──
          Composite is the metric anchor (left-anchored SF Display
          numeric + tiny tertiary label). Expand chevron sits next to
          it as a quiet affordance. Approve bet stays as the dominant
          dark CTA on the right. */}
      <div
        className="mt-3 flex items-center justify-between gap-3 border-t pt-2.5"
        style={{ borderColor: appleVibe.stroke.hairline }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="inline-flex items-baseline gap-1.5"
          title="Expand chain detail"
        >
          <span
            className="tabular-nums"
            style={{
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.display,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            {pct}
            <span
              style={{
                color: appleVibe.text.tertiary,
                fontSize: 11,
                fontWeight: 500,
                marginLeft: 1,
              }}
            >
              %
            </span>
          </span>
          <span
            className="text-[9.5px] font-medium uppercase tracking-[0.16em]"
            style={{ color: appleVibe.text.faint }}
          >
            Composite
          </span>
          <ChevronDown
            className="ml-0.5 h-3 w-3 translate-y-[1px]"
            strokeWidth={2}
            style={{
              color: appleVibe.text.faint,
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 180ms ease-out",
            }}
          />
        </button>

        <div className="flex items-center gap-1.5">
          {approved && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-medium tracking-tight transition-colors"
              style={{
                background: "transparent",
                color: appleVibe.text.tertiary,
                cursor: busy ? "default" : "pointer",
              }}
            >
              <X className="h-2.5 w-2.5" strokeWidth={2} />
              Reject
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!approved) onApprove();
            }}
            disabled={busy || approved}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-[4px] text-[10.5px] font-medium tracking-tight transition-colors"
            style={{
              background: approved
                ? `${appleVibe.stage.outcomes}12`
                : appleVibe.accent.primary,
              color: approved
                ? appleVibe.stage.outcomes
                : appleVibe.text.onAccent,
              cursor: busy || approved ? "default" : "pointer",
            }}
          >
            <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
            {approved ? "Approved" : "Approve bet"}
          </button>
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="mt-3 space-y-3"
        >
          {/* Why it works — crosswalk */}
          {crosswalk.length > 0 && (
            <Section title="Why this bet">
              <ul className="space-y-1.5">
                {crosswalk.map((row, i) => (
                  <li key={i} className="text-[11px] font-light leading-snug">
                    <span
                      className="font-medium"
                      style={{ color: appleVibe.stage.pain }}
                    >
                      {row.rootCause}
                    </span>
                    <span
                      className="mx-1.5"
                      style={{ color: appleVibe.text.tertiary }}
                    >
                      neutralized by
                    </span>
                    <span
                      className="font-medium"
                      style={{ color: appleVibe.stage.features }}
                    >
                      {row.firstPrinciple}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Rationale narrative — combined from both edges */}
          {(chain.painFeatureEdge.conditions ||
            chain.featureOutcomeEdge.conditions) && (
            <Section title="Reasoning">
              {chain.painFeatureEdge.conditions && (
                <p
                  className="text-[11px] font-light leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  <span
                    className="text-[9.5px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Bridge:
                  </span>{" "}
                  {chain.painFeatureEdge.conditions}
                </p>
              )}
              {chain.featureOutcomeEdge.conditions && (
                <p
                  className="mt-1 text-[11px] font-light leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  <span
                    className="text-[9.5px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Output:
                  </span>{" "}
                  {chain.featureOutcomeEdge.conditions}
                </p>
              )}
            </Section>
          )}

          {/* Measurement — how to know if this bet fires */}
          {outcomeMeasuredBy && (
            <Section title="How to know it works">
              <p
                className="text-[11px] font-light leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                {outcomeMeasuredBy}
              </p>
            </Section>
          )}

          {/* Risk — friction causes this chain doesn't cover */}
          {unaddressedCauses.length > 0 && (
            <Section title="What this bet does NOT cover">
              <ul className="flex flex-wrap gap-1">
                {unaddressedCauses.map((c) => (
                  <li
                    key={c}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      background: "rgba(220,38,38,0.06)",
                      color: "rgba(127,29,29,0.95)",
                      border: "1px solid rgba(220,38,38,0.18)",
                    }}
                  >
                    {c}
                  </li>
                ))}
              </ul>
              <p
                className="mt-1.5 text-[10.5px] font-light italic"
                style={{ color: appleVibe.text.tertiary }}
              >
                These root causes of the friction aren&rsquo;t addressed by
                this chain. Consider a complementary bet.
              </p>
            </Section>
          )}

          {/* Alternatives — other mechanisms that also address the friction */}
          {alternatives.length > 0 && (
            <Section title="Substitutable mechanisms">
              <ul className="space-y-1">
                {alternatives.slice(0, 3).map((alt, i) => {
                  const altPct = Math.round(alt.strength * 100);
                  return (
                    <li
                      key={i}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <div className="min-w-0 flex-1">
                        <span
                          className="font-medium"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {alt.name}
                        </span>
                        <span
                          className="ml-1.5"
                          style={{ color: appleVibe.text.tertiary }}
                        >
                          → {alt.outcomeName}
                        </span>
                      </div>
                      <span
                        className="ml-2 flex-shrink-0 font-mono text-[10px]"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        {altPct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </motion.div>
      )}
    </motion.li>
  );
}

// ── Primitives ─────────────────────────────────────────────────────

function ChainNode({
  color,
  label,
  name,
  subtitle,
}: {
  color: string;
  label: string;
  name: string;
  subtitle?: string;
}) {
  // Sentence-case the lane label so it reads as a tight inline tag,
  // not an all-caps category header. The colored dot carries lane
  // identity — the label itself stays in tertiary text.
  const sentenceLabel =
    label.length > 0 ? label[0]?.toUpperCase() + label.slice(1).toLowerCase() : label;
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span
            className="text-[10px] font-medium tracking-tight"
            style={{ color: appleVibe.text.tertiary }}
          >
            {sentenceLabel}
          </span>
          <span
            className="text-[13px] font-semibold leading-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.015em",
              fontFamily: appleVibe.font.display,
            }}
          >
            {name}
          </span>
        </div>
        {subtitle && (
          <p
            className="mt-1 text-[11px] font-light italic leading-snug"
            style={{ color: appleVibe.text.tertiary }}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

function BridgeRow({
  verb,
  mechanism,
}: {
  verb: string;
  mechanism?: string | null;
}) {
  // No vertical pipe, no caps mechanism pill. Sits indented under
  // the dot column so the chain reads top-to-bottom as a thin
  // editorial flow: verb in tertiary, mechanism italic, no chrome.
  return (
    <div className="ml-[14px] flex items-baseline gap-1">
      <span
        className="text-[10.5px] font-light italic lowercase"
        style={{ color: appleVibe.text.tertiary }}
      >
        {verb}
      </span>
      {mechanism && (
        <span
          className="min-w-0 truncate text-[10.5px] font-light italic"
          style={{ color: appleVibe.text.faint }}
          title="Mechanism — the lever this hop pulls"
        >
          · via &ldquo;{mechanism}&rdquo;
        </span>
      )}
    </div>
  );
}

function CategoryPip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-medium tracking-tight"
      style={{
        background: "transparent",
        color: appleVibe.text.secondary,
        border: `1px solid ${appleVibe.stroke.soft}`,
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {title}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
