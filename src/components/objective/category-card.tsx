"use client";

// ── Category Card ─────────────────────────────────────────────────
//
// Phase 7a — the experiment frame view. Each chain (pain × mechanism
// × outcome triplet) renders as a single Category Card that reads as
// ONE EXPERIMENT SETUP:
//
//   ┌─ Category title ─────────────────────────────────────────┐
//   │  ↓ MINIMIZE                          ↑ MAXIMIZE          │
//   │  ┌──── PROBLEM ────┐  ┌──── OUTCOME ──────┐              │
//   │  │ pain name       │  │ result name       │              │
//   │  │ root causes     │  │ measured by       │              │
//   │  └─────────────────┘  └───────────────────┘              │
//   │                                                          │
//   │  Tested via: <feature name> via "<mechanism>"            │
//   │                                                          │
//   │  ┌─ MECHANISM LINEUP ───────────────────────────────────┐│
//   │  │ #1 Variation A           ●●●●○ 0.72                  ││
//   │  │ #2 Variation B           ●●●○○ 0.58                  ││
//   │  │ #3 Variation C           ●●○○○ 0.39                  ││
//   │  │                          [ Run experiment ]          ││
//   │  └──────────────────────────────────────────────────────┘│
//   │                                                          │
//   │  Composite 80%        [ ✓ Approve bet ]                  │
//   └──────────────────────────────────────────────────────────┘
//
// Reads the chain triplet's pain/feature/outcome entities + the
// feature's lazy-loaded expanded_detail.variations[] for the
// lineup. Effectiveness scores come from Phase 4c persistence; if
// the feature has never been scored, the lineup shows variations
// without scores + a "Score variations first" hint.
//
// Clicking the feature name OR the lineup → opens the existing
// item-detail-drawer focused on the feature, where the user can
// elect/reject variations and run experiments in the full panel.
// The Category Card is the OVERVIEW + experiment trigger; the
// drawer is curation.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Check, Loader2, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ChainTriple } from "@/lib/objective-canvas/compute-chains";
import type {
  PainCardItem,
} from "./cards/pain-card";
import type { FeatureCardItem } from "./cards/feature-card";
import type { OutcomeCardItem } from "./cards/outcome-card";

interface LineupVariation {
  id: string;
  name: string;
  description?: string;
  effectiveness_score?: number;
  disposition?: "elected" | "rejected" | "deferred" | null;
  provenance?: "rd_iteration";
}

interface FeatureDetail {
  variations: LineupVariation[];
  envelope?: {
    lift_pct: number | null;
    placebo_verdict: "pass" | "fail" | "skip" | null;
    target_entity_name: string | null;
  };
}

interface Props {
  chain: ChainTriple;
  pain: PainCardItem | undefined;
  feature: FeatureCardItem | undefined;
  outcome: OutcomeCardItem | undefined;
  /** Composite category label (e.g. "Distraction Overload × Attention
   *  Tracking × Efficiency Gain"). Pre-computed by the parent from
   *  the chain.categoryTriple. */
  categoryLabel: string;
  approved: boolean;
  onApprove: () => void;
  onOpenFeatureDetail: () => void;
  onOpenPainDetail: () => void;
  onOpenOutcomeDetail: () => void;
}

// Lane colors — referenced so the Category Card can paint its
// Problem/Outcome halves in their lane hue without redefining.
const PAIN_COLOR = appleVibe.stage.pain;
const FEATURE_COLOR = appleVibe.stage.features;
const OUTCOME_COLOR = appleVibe.stage.outcomes;

export function CategoryCard({
  chain,
  pain,
  // feature is reserved for future deep-detail integration (e.g.
  // showing first_principles in the bridge label). Lineup data
  // comes from the lazy-fetched expanded_detail instead.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  feature,
  outcome,
  categoryLabel,
  approved,
  onApprove,
  onOpenFeatureDetail,
  onOpenPainDetail,
  onOpenOutcomeDetail,
}: Props) {
  // ── Lazy load the feature's expanded_detail for the lineup ──
  // The lineup needs the feature's variations[] + effectiveness
  // scores. These live in expanded_detail (Phase 4c persistence).
  // We /expand the feature on mount; cache hits return instantly.
  //
  // Loading is implied by detail === null — no separate state
  // (avoids the React lint rule against setState directly in effect).
  const [detail, setDetail] = useState<FeatureDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!chain.featureId) return;
    void fetch("/api/brainstorm/item/expand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId: chain.featureId }),
    })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const ed = json?.expanded_detail;
        if (!ed || !Array.isArray(ed.variations)) {
          if (!cancelled) setDetail({ variations: [] });
          return;
        }
        if (cancelled) return;
        setDetail({
          variations: ed.variations.map((v: LineupVariation) => ({
            id: v.id,
            name: v.name,
            description: v.description,
            effectiveness_score: v.effectiveness_score,
            disposition: v.disposition,
            provenance: v.provenance,
          })),
          envelope: ed.effectiveness_envelope
            ? {
                lift_pct: ed.effectiveness_envelope.lift_pct ?? null,
                placebo_verdict:
                  ed.effectiveness_envelope.placebo_verdict ?? null,
                target_entity_name:
                  ed.effectiveness_envelope.target_entity_name ?? null,
              }
            : undefined,
        });
      })
      .catch(() => {
        if (!cancelled) setDetail({ variations: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [chain.featureId]);
  const detailLoading = detail === null;

  // Sorted lineup — variations by effectiveness score desc, rejected
  // dimmed at the bottom. Phase 7a default: show all variations,
  // user can dig into the drawer to manage them.
  const sortedVariations = (detail?.variations ?? [])
    .slice()
    .sort((a, b) => {
      if (a.disposition === "rejected" && b.disposition !== "rejected") return 1;
      if (b.disposition === "rejected" && a.disposition !== "rejected") return -1;
      const sa = a.effectiveness_score ?? 0;
      const sb = b.effectiveness_score ?? 0;
      return sb - sa;
    });

  const compositePct = Math.round((chain.composite ?? 0) * 100);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${approved ? `${OUTCOME_COLOR}40` : appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.xl,
        boxShadow: approved
          ? `${appleVibe.shadow.card}, 0 0 0 2px ${OUTCOME_COLOR}15`
          : appleVibe.shadow.card,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Header — category label + composite + approved chip */}
      <header
        className="flex items-center justify-between gap-3 px-5 py-3"
        style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
      >
        <div className="min-w-0 flex-1">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Experiment frame
          </div>
          <h3
            className="mt-0.5 truncate text-[15px] font-semibold tracking-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.01em",
              fontFamily: appleVibe.font.display,
            }}
            title={categoryLabel}
          >
            {categoryLabel}
          </h3>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.secondary,
            }}
            title="Chain composite — min of the two hop strengths"
          >
            {compositePct}% composite
          </span>
          {approved && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.10em]"
              style={{
                background: `${OUTCOME_COLOR}15`,
                color: OUTCOME_COLOR,
                border: `1px solid ${OUTCOME_COLOR}33`,
              }}
            >
              <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
              approved
            </span>
          )}
        </div>
      </header>

      {/* Problem ↔ Outcome juxtaposition */}
      <div className="grid grid-cols-1 gap-3 px-5 pt-4 md:grid-cols-2">
        <ProblemHalf
          pain={pain}
          painName={chain.painName}
          onClick={onOpenPainDetail}
        />
        <OutcomeHalf
          outcome={outcome}
          outcomeName={chain.outcomeName}
          onClick={onOpenOutcomeDetail}
        />
      </div>

      {/* Bridge label — feature name + mechanism phrase */}
      <button
        type="button"
        onClick={onOpenFeatureDetail}
        className="group mx-5 my-3 block w-[calc(100%-2.5rem)] text-left transition-colors duration-150 ease-out"
        title="Open mechanism detail"
      >
        <div className="flex items-center gap-2">
          <div
            className="h-px flex-1"
            style={{ background: appleVibe.stroke.hairline }}
          />
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{
              background: `${FEATURE_COLOR}10`,
              border: `1px solid ${FEATURE_COLOR}26`,
            }}
          >
            <span
              className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: FEATURE_COLOR }}
            >
              tested via
            </span>
            <span
              className="text-[11.5px] font-medium"
              style={{ color: appleVibe.text.primary }}
            >
              {chain.featureName}
            </span>
            {chain.mechanism && (
              <span
                className="text-[10.5px] font-light italic"
                style={{ color: appleVibe.text.tertiary }}
                title="The named lever this chain pulls"
              >
                · &ldquo;{chain.mechanism}&rdquo;
              </span>
            )}
          </span>
          <div
            className="h-px flex-1"
            style={{ background: appleVibe.stroke.hairline }}
          />
        </div>
      </button>

      {/* Mechanism Lineup */}
      <div className="px-5 pb-4">
        <MechanismLineup
          variations={sortedVariations}
          loading={detailLoading}
          envelope={detail?.envelope}
          onOpenFeatureDetail={onOpenFeatureDetail}
        />
      </div>

      {/* Footer — approve bet action */}
      <footer
        className="flex items-center justify-between gap-3 px-5 py-2.5"
        style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
      >
        <span
          className="text-[10.5px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          {approved
            ? "Promoted to the main canvas."
            : "Approve to promote this chain to the main canvas."}
        </span>
        {!approved && (
          <motion.button
            type="button"
            onClick={onApprove}
            whileHover={{ y: -1, transition: { duration: 0.15 } }}
            whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
            className="inline-flex items-center gap-1.5 transition-all duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: appleVibe.accent.primary,
              color: appleVibe.text.onAccent,
              borderRadius: appleVibe.radius.pill,
              padding: "5px 14px",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.02em",
              boxShadow: appleVibe.shadow.chip,
            }}
          >
            <Check className="h-3 w-3" strokeWidth={2.5} />
            Approve bet
          </motion.button>
        )}
      </footer>
    </motion.article>
  );
}

// ── Problem half — left side of the juxtaposition ────────────────

function ProblemHalf({
  pain,
  painName,
  onClick,
}: {
  pain: PainCardItem | undefined;
  painName: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{
        y: -1,
        transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
      }}
      whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
      className="text-left transition-shadow duration-200 ease-out"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${PAIN_COLOR}22`,
        borderRadius: appleVibe.radius.md,
        padding: "12px 14px",
        boxShadow: appleVibe.shadow.chip,
      }}
    >
      <div className="flex items-center gap-1.5">
        <ArrowDown
          className="h-3 w-3 flex-shrink-0"
          strokeWidth={2.5}
          style={{ color: PAIN_COLOR }}
        />
        <span
          className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: PAIN_COLOR }}
        >
          Problem · minimize
        </span>
      </div>
      <h4
        className="mt-1 text-[13.5px] font-semibold leading-tight tracking-tight line-clamp-2"
        style={{
          color: appleVibe.text.primary,
          letterSpacing: "-0.01em",
        }}
      >
        {pain?.name ?? painName}
      </h4>
      {pain?.negative_outcome && (
        <p
          className="mt-1 text-[11.5px] leading-snug line-clamp-2"
          style={{ color: appleVibe.text.secondary }}
        >
          <span className="italic">leads to</span> →{" "}
          {pain.negative_outcome}
        </p>
      )}
      {Array.isArray(pain?.root_causes) && pain.root_causes.length > 0 && (
        <div className="mt-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Root causes
          </div>
          <ul className="mt-1 space-y-0.5">
            {pain.root_causes.slice(0, 3).map((c, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-[11px]"
                style={{ color: appleVibe.text.secondary }}
              >
                <span
                  className="mt-1 h-1 w-1 flex-shrink-0 rounded-full"
                  style={{ background: PAIN_COLOR, opacity: 0.5 }}
                  aria-hidden
                />
                <span className="leading-snug">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.button>
  );
}

// ── Outcome half — right side of the juxtaposition ───────────────

function OutcomeHalf({
  outcome,
  outcomeName,
  onClick,
}: {
  outcome: OutcomeCardItem | undefined;
  outcomeName: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{
        y: -1,
        transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
      }}
      whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
      className="text-left transition-shadow duration-200 ease-out"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${OUTCOME_COLOR}22`,
        borderRadius: appleVibe.radius.md,
        padding: "12px 14px",
        boxShadow: appleVibe.shadow.chip,
      }}
    >
      <div className="flex items-center gap-1.5">
        <ArrowUp
          className="h-3 w-3 flex-shrink-0"
          strokeWidth={2.5}
          style={{ color: OUTCOME_COLOR }}
        />
        <span
          className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: OUTCOME_COLOR }}
        >
          Outcome · maximize
        </span>
      </div>
      <h4
        className="mt-1 text-[13.5px] font-semibold leading-tight tracking-tight line-clamp-2"
        style={{
          color: appleVibe.text.primary,
          letterSpacing: "-0.01em",
        }}
      >
        {outcome?.name ?? outcomeName}
      </h4>
      {outcome?.measured_by && (
        <p
          className="mt-1 text-[11.5px] leading-snug line-clamp-2"
          style={{ color: appleVibe.text.secondary }}
        >
          <span className="italic">measured by</span> →{" "}
          {outcome.measured_by}
        </p>
      )}
    </motion.button>
  );
}

// ── Mechanism Lineup — the bottom rail ────────────────────────────

function MechanismLineup({
  variations,
  loading,
  envelope,
  onOpenFeatureDetail,
}: {
  variations: LineupVariation[];
  loading: boolean;
  envelope?: { lift_pct: number | null; placebo_verdict: "pass" | "fail" | "skip" | null; target_entity_name: string | null };
  onOpenFeatureDetail: () => void;
}) {
  // Empty state — feature hasn't been expanded yet
  if (loading && variations.length === 0) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{
          background: appleVibe.surface.cardElevated,
          border: `1px solid ${appleVibe.stroke.hairline}`,
          borderRadius: appleVibe.radius.sm,
        }}
      >
        <Loader2
          className="h-3 w-3 animate-spin flex-shrink-0"
          style={{ color: appleVibe.text.tertiary }}
        />
        <span
          className="text-[11.5px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          Loading mechanism lineup…
        </span>
      </div>
    );
  }

  if (!loading && variations.length === 0) {
    return (
      <motion.button
        type="button"
        onClick={onOpenFeatureDetail}
        whileHover={{ y: -1, transition: { duration: 0.15 } }}
        whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
        className="flex w-full items-center justify-between gap-2 text-left transition-shadow duration-200 ease-out"
        style={{
          background: appleVibe.surface.cardElevated,
          border: `1px dashed ${appleVibe.stroke.medium}`,
          borderRadius: appleVibe.radius.sm,
          padding: "10px 12px",
        }}
      >
        <div className="min-w-0 flex-1">
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Mechanism lineup
          </div>
          <p
            className="mt-0.5 text-[12px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            Open the mechanism to generate + score IV candidates.
          </p>
        </div>
        <Sparkles
          className="h-3.5 w-3.5 flex-shrink-0"
          strokeWidth={2}
          style={{ color: FEATURE_COLOR }}
        />
      </motion.button>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div
          className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Mechanism lineup · {variations.length} candidate
          {variations.length === 1 ? "" : "s"}
        </div>
        {envelope?.lift_pct !== undefined && envelope.lift_pct !== null && (
          <span
            className="text-[10px] font-light"
            style={{ color: appleVibe.text.tertiary }}
            title="Structural lift from the last scoring run"
          >
            lift {(envelope.lift_pct * 100).toFixed(0)}% · placebo{" "}
            {envelope.placebo_verdict ?? "—"}
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {variations.slice(0, 6).map((v, i) => (
          <LineupRow key={v.id} rank={i + 1} variation={v} />
        ))}
        {variations.length > 6 && (
          <li
            className="px-2 pt-1 text-[10.5px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            + {variations.length - 6} more — open mechanism for full list
          </li>
        )}
      </ul>
    </div>
  );
}

function LineupRow({
  rank,
  variation: v,
}: {
  rank: number;
  variation: LineupVariation;
}) {
  const score = v.effectiveness_score ?? 0;
  const isElected = v.disposition === "elected";
  const isRejected = v.disposition === "rejected";
  const isRdCandidate = v.provenance === "rd_iteration";
  return (
    <li
      className="flex items-center gap-2.5 px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-[rgba(15,23,42,0.025)]"
      style={{
        borderRadius: appleVibe.radius.sm,
        opacity: isRejected ? 0.5 : 1,
      }}
    >
      <span
        className="w-3.5 flex-shrink-0 font-mono text-[10px] font-semibold tabular-nums"
        style={{ color: appleVibe.text.tertiary }}
      >
        #{rank}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[12px] font-medium"
        style={{ color: appleVibe.text.primary }}
        title={v.description ?? v.name}
      >
        {v.name}
      </span>
      {isElected && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.10em]"
          style={{
            background: `${OUTCOME_COLOR}15`,
            color: OUTCOME_COLOR,
          }}
        >
          <Check className="h-2 w-2" strokeWidth={2.5} />
          elected
        </span>
      )}
      {isRdCandidate && !isElected && !isRejected && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.10em]"
          style={{
            background: `${FEATURE_COLOR}15`,
            color: FEATURE_COLOR,
          }}
          title="Candidate from an R&D refinement run"
        >
          experiment
        </span>
      )}
      <div className="flex w-24 flex-shrink-0 items-center gap-1.5">
        <div
          className="relative h-[5px] flex-1 overflow-hidden"
          style={{
            background: `${FEATURE_COLOR}1F`,
            borderRadius: appleVibe.radius.pill,
          }}
        >
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.max(3, Math.min(100, score * 100))}%`,
              background: `linear-gradient(90deg, ${FEATURE_COLOR}D9 0%, ${FEATURE_COLOR} 100%)`,
              borderRadius: appleVibe.radius.pill,
            }}
          />
        </div>
        <span
          className="w-6 flex-shrink-0 text-right font-mono text-[10px] font-semibold tabular-nums"
          style={{ color: appleVibe.text.primary }}
        >
          {score > 0 ? (score * 100).toFixed(0) : "—"}
        </span>
      </div>
    </li>
  );
}
