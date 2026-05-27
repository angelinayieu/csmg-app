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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { MethodBadge } from "./method-badge";
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
  /** Phase 8b — surfaced in the expanded lineup row alongside
   *  description. Lets the user see "what gives, what gives up"
   *  per candidate without opening the drawer. */
  tradeoff?: string;
  /** Phase 8b — open questions per candidate, surfaced in the
   *  expanded row. Drives the user to design experiments around
   *  the variant's unknowns. */
  open_questions?: string[];
  effectiveness_score?: number;
  /** Phase 11.1 — which evaluation tier scored this row. Drives the
   *  MethodBadge displayed inline beside the score so the user
   *  always sees the method that produced the number. Undefined for
   *  pre-11.1 rows (treat as simulation — the only old path). */
  evaluation_method?:
    | "heuristic"
    | "rubric"
    | "evidence"
    | "simulation"
    | "tested";
  disposition?: "elected" | "rejected" | "deferred" | null;
  provenance?: "rd_iteration";
  /** Phase 8b — root_cause this candidate was generated to address
   *  (R&D iterations only). Surfaces as a chip in the expanded row. */
  target_root_cause?: string;
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
  /** Phase 7c — external refresh signal. When this number changes
   *  (bumped by the room-level AutopilotRunner after writing new
   *  candidates/scores for this chain's feature), the card re-fetches
   *  expanded_detail so the lineup picks up the new data without
   *  user interaction. Optional — undefined means "no external
   *  refresh." */
  refreshSignal?: number;
  /** Phase 8b — within-layer relationships with other chains'
   *  mechanisms. Pre-computed by CategoryCardsView from the room's
   *  edge list. Each entry is a sibling mechanism that this card's
   *  feature either composes_with (build-on / extends) or
   *  interferes_with (conflicts / collides). Renders as chips
   *  below the "tested via" bridge. Optional — empty array hides
   *  the row entirely. */
  lateralLinks?: Array<{
    otherFeatureId: string;
    otherFeatureName: string;
    otherChainId: string;
    kind: "composes_with" | "interferes_with";
    rationale: string;
  }>;
  /** Phase 8b — open another entity's drawer (not necessarily this
   *  card's). Used by lateral chips to jump to the related
   *  mechanism's detail. Optional — when undefined, lateral chips
   *  fall through to opening THIS card's feature instead. */
  onOpenItem?: (entityId: string) => void;
}

// Lane colors — referenced so the Category Card can paint its
// Problem/Outcome halves in their lane hue without redefining.
const PAIN_COLOR = appleVibe.stage.pain;
const FEATURE_COLOR = appleVibe.stage.features;
const OUTCOME_COLOR = appleVibe.stage.outcomes;

export function CategoryCard({
  chain,
  pain,
  // Phase 8c — feature.first_principles now renders in the
  // mechanism-bridge band (between the "tested via" pill and the
  // lineup) so the Category Card has symmetry across all three
  // panels: pain.root_causes / feature.first_principles /
  // outcome.indicators.
  feature,
  outcome,
  categoryLabel,
  approved,
  onApprove,
  onOpenFeatureDetail,
  onOpenPainDetail,
  onOpenOutcomeDetail,
  refreshSignal,
  lateralLinks = [],
  onOpenItem,
}: Props) {
  // ── Lazy load the feature's expanded_detail for the lineup ──
  // The lineup needs the feature's variations[] + effectiveness
  // scores. These live in expanded_detail (Phase 4c persistence).
  // We /expand the feature on mount; cache hits return instantly.
  //
  // Loading is implied by detail === null — no separate state
  // (avoids the React lint rule against setState directly in effect).
  const [detail, setDetail] = useState<FeatureDetail | null>(null);

  // ── Phase 7b action state — score / refine / dispatch (elect+reject)
  // status flags. Separate from detail because actions are user-driven
  // and should not collide with the initial lazy-load.
  const [scoringBusy, setScoringBusy] = useState(false);
  const [refiningBusy, setRefiningBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Optimistic dispatch tracking — when the user clicks elect/reject
  // on a row, we update the UI before the API responds. The Set
  // tracks which variation ids have an in-flight disposition update;
  // the optimistic disposition is applied per row via a separate
  // Map so the UI can render the new state immediately.
  const [optimisticDisposition, setOptimisticDisposition] = useState<
    Map<string, "elected" | "rejected">
  >(new Map());

  // Reusable: parse /expand response into FeatureDetail shape.
  // Extracted so re-fetches after actions share the same parsing
  // logic as the initial mount load.
  const parseDetail = useCallback((ed: unknown): FeatureDetail => {
    const eds = ed as
      | {
          variations?: LineupVariation[];
          effectiveness_envelope?: {
            lift_pct?: number | null;
            placebo_verdict?: "pass" | "fail" | "skip" | null;
            target_entity_name?: string | null;
          };
        }
      | null
      | undefined;
    if (!eds || !Array.isArray(eds.variations)) {
      return { variations: [] };
    }
    return {
      variations: eds.variations.map((v: LineupVariation) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        // Phase 8b — surface tradeoff + open_questions + target_root_cause
        // so the expanded lineup row can show the full per-candidate
        // story without the user having to open the drawer.
        tradeoff: v.tradeoff,
        open_questions: v.open_questions,
        target_root_cause: v.target_root_cause,
        effectiveness_score: v.effectiveness_score,
        // Phase 11.1 — thread the evaluation method through so the
        // LineupRow can render <MethodBadge /> beside the score.
        evaluation_method: v.evaluation_method,
        disposition: v.disposition,
        provenance: v.provenance,
      })),
      envelope: eds.effectiveness_envelope
        ? {
            lift_pct: eds.effectiveness_envelope.lift_pct ?? null,
            placebo_verdict:
              eds.effectiveness_envelope.placebo_verdict ?? null,
            target_entity_name:
              eds.effectiveness_envelope.target_entity_name ?? null,
          }
        : undefined,
    };
  }, []);

  // Soft re-fetch: pull fresh /expand without showing a loader.
  // Used after score / refine / disposition actions so the lineup
  // reflects the latest persisted state. Optimistic disposition
  // tracking is cleared after a successful refetch — server state
  // wins.
  const refetchDetail = useCallback(async () => {
    if (!chain.featureId) return;
    try {
      const res = await fetch("/api/brainstorm/item/expand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId: chain.featureId }),
      });
      if (!res.ok) return;
      const json = await res.json();
      setDetail(parseDetail(json?.expanded_detail));
      setOptimisticDisposition(new Map());
    } catch {
      // Soft re-fetch — silent on failure. UI keeps last known state.
    }
  }, [chain.featureId, parseDetail]);

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
        if (cancelled) return;
        setDetail(parseDetail(json?.expanded_detail));
      })
      .catch(() => {
        if (!cancelled) setDetail({ variations: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [chain.featureId, parseDetail]);

  // ── Phase 7c — external refresh signal ──
  // Bumped by the room-level AutopilotRunner after it writes new
  // candidates / fresh scores for this chain's feature. We re-fetch
  // expanded_detail so the lineup picks up the new data without the
  // user having to scroll, click, or interact.
  //
  // We skip the FIRST render by tracking with a ref — the lazy-load
  // useEffect above already fires on mount, so refetching ON THE
  // SAME mount would be wasted. Only fires when refreshSignal CHANGES
  // after mount.
  const lastRefreshSignalRef = useRef<number | undefined>(refreshSignal);
  useEffect(() => {
    if (refreshSignal === undefined) return;
    if (lastRefreshSignalRef.current === refreshSignal) return;
    lastRefreshSignalRef.current = refreshSignal;
    void refetchDetail();
  }, [refreshSignal, refetchDetail]);

  // ── Phase 7b actions ──────────────────────────────────────────
  //
  // All three flows post to existing Phase 4 / 5b endpoints with
  // optimistic UI then re-fetch. No new server endpoints needed.

  /** Score this card's mechanism. Calls Phase 4 scoring engine. */
  async function handleScore() {
    if (!chain.featureId) return;
    setScoringBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/brainstorm/item/variation/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId: chain.featureId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        const tail =
          typeof j.detail === "string" && j.detail.length > 0
            ? ` — ${j.detail}`
            : "";
        setActionError(`${j.error ?? "Scoring failed."}${tail}`);
        return;
      }
      // Score route persists envelope + per-row effectiveness_score
      // into expanded_detail; the soft refetch pulls it back.
      await refetchDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setScoringBusy(false);
    }
  }

  /** Run R&D experiment — proposes 3 new candidates + scores them. */
  async function handleRefine() {
    if (!chain.featureId) return;
    setRefiningBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/brainstorm/item/variation/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId: chain.featureId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        const tail =
          typeof j.detail === "string" && j.detail.length > 0
            ? ` — ${j.detail}`
            : "";
        setActionError(`${j.error ?? "Experiment failed."}${tail}`);
        return;
      }
      const json = (await res.json()) as { status?: string; status_detail?: string };
      if (json.status && json.status !== "ok") {
        setActionError(json.status_detail ?? `Experiment: ${json.status}`);
        return;
      }
      await refetchDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setRefiningBusy(false);
    }
  }

  /** Inline elect/reject for a lineup row. Optimistic — flips local
   *  state before the API call completes; reconciled on refetch. */
  async function handleDispatch(
    variationId: string,
    disposition: "elected" | "rejected",
  ) {
    if (!chain.featureId || !variationId) return;
    setOptimisticDisposition((prev) => {
      const next = new Map(prev);
      next.set(variationId, disposition);
      return next;
    });
    setActionError(null);
    try {
      const res = await fetch(
        "/api/brainstorm/item/variation/disposition",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityId: chain.featureId,
            variationId,
            disposition,
          }),
        },
      );
      if (!res.ok) {
        // Roll back the optimistic flip.
        setOptimisticDisposition((prev) => {
          const next = new Map(prev);
          next.delete(variationId);
          return next;
        });
        setActionError("Couldn't update disposition. Try again.");
        return;
      }
      await refetchDetail();
    } catch {
      setOptimisticDisposition((prev) => {
        const next = new Map(prev);
        next.delete(variationId);
        return next;
      });
      setActionError("Network error.");
    }
  }
  const detailLoading = detail === null;

  // Phase 7b — fold optimistic disposition flips into the lineup
  // BEFORE sorting so the row visually moves to the bottom (rejected)
  // or gets the elected ring immediately on click. The server-side
  // reconciliation happens in the background via refetchDetail.
  const sortedVariations = useMemo(() => {
    const merged = (detail?.variations ?? []).map((v) => {
      if (!v.id) return v;
      const optimistic = optimisticDisposition.get(v.id);
      return optimistic ? { ...v, disposition: optimistic } : v;
    });
    return merged.slice().sort((a, b) => {
      if (a.disposition === "rejected" && b.disposition !== "rejected") return 1;
      if (b.disposition === "rejected" && a.disposition !== "rejected") return -1;
      const sa = a.effectiveness_score ?? 0;
      const sb = b.effectiveness_score ?? 0;
      return sb - sa;
    });
  }, [detail, optimisticDisposition]);

  // Has the lineup ever been scored? Drives Score vs Re-score copy.
  const hasScores = useMemo(
    () =>
      (detail?.variations ?? []).some(
        (v) => typeof v.effectiveness_score === "number",
      ),
    [detail],
  );

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

      {/* Phase 8b — within-layer relationship chips. Surface
          composes_with / interferes_with links to OTHER chains'
          mechanisms so the user sees at a glance that this
          experiment doesn't live in isolation. Chips are subtle
          (no bold colors) and click through to the related
          feature's drawer. */}
      {lateralLinks.length > 0 && (
        <div className="mx-5 mb-3 flex flex-wrap items-center gap-1.5">
          {lateralLinks.map((l) => (
            <LateralChip
              key={`${l.kind}-${l.otherFeatureId}`}
              link={l}
              onClick={() =>
                onOpenItem
                  ? onOpenItem(l.otherFeatureId)
                  : onOpenFeatureDetail()
              }
            />
          ))}
        </div>
      )}

      {/* Phase 8c — Feature first_principles band.
          Mirrors pain.root_causes treatment. Only renders when the
          feature carries principles in its causal_chain. Faint
          lane-color background so it visually belongs to the
          mechanism band (between the bridge pill above + the
          lineup below). */}
      {feature && feature.first_principles && feature.first_principles.length > 0 && (
        <div
          className="mx-5 mb-4 px-3 py-2"
          style={{
            background: `${FEATURE_COLOR}08`,
            border: `1px solid ${FEATURE_COLOR}1A`,
            borderRadius: appleVibe.radius.sm,
          }}
        >
          <div
            className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: FEATURE_COLOR }}
          >
            First principles · why this works
          </div>
          <ul className="space-y-0.5">
            {feature.first_principles.slice(0, 5).map((p, i) => (
              <li
                key={`${i}-${p}`}
                className="flex items-start gap-1.5 text-[11.5px] leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                <span
                  className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full"
                  style={{ background: FEATURE_COLOR }}
                  aria-hidden
                />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mechanism Lineup */}
      <div className="px-5 pb-4">
        <MechanismLineup
          variations={sortedVariations}
          loading={detailLoading}
          envelope={detail?.envelope}
          hasScores={hasScores}
          scoringBusy={scoringBusy}
          refiningBusy={refiningBusy}
          actionError={actionError}
          onScore={handleScore}
          onRefine={handleRefine}
          onElect={(id) => void handleDispatch(id, "elected")}
          onReject={(id) => void handleDispatch(id, "rejected")}
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
      {/* Phase 8d — INDICATORS list. Renders observable criteria
          mirroring pain.root_causes treatment. Falls back to
          [measured_by] when indicators are missing (legacy rooms).
          Cap at 4 entries so the panel doesn't outgrow the
          PROBLEM half visually. */}
      {(() => {
        const list =
          outcome?.indicators && outcome.indicators.length > 0
            ? outcome.indicators
            : outcome?.measured_by
              ? [outcome.measured_by]
              : [];
        if (list.length === 0) return null;
        return (
          <div className="mt-2">
            <div
              className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: OUTCOME_COLOR }}
            >
              Indicators
            </div>
            <ul className="space-y-0.5">
              {list.slice(0, 4).map((ind, i) => (
                <li
                  key={`${i}-${ind}`}
                  className="flex items-start gap-1.5 text-[11.5px] leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  <span
                    className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full"
                    style={{ background: OUTCOME_COLOR }}
                    aria-hidden
                  />
                  <span>{ind}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
    </motion.button>
  );
}

// ── Mechanism Lineup — the bottom rail ────────────────────────────

function MechanismLineup({
  variations,
  loading,
  envelope,
  hasScores,
  scoringBusy,
  refiningBusy,
  actionError,
  onScore,
  onRefine,
  onElect,
  onReject,
  onOpenFeatureDetail,
}: {
  variations: LineupVariation[];
  loading: boolean;
  envelope?: { lift_pct: number | null; placebo_verdict: "pass" | "fail" | "skip" | null; target_entity_name: string | null };
  /** Phase 7b — has the lineup ever been scored? Drives Score vs
   *  Re-score button copy + visibility of the experiment trigger. */
  hasScores: boolean;
  scoringBusy: boolean;
  refiningBusy: boolean;
  actionError: string | null;
  /** Phase 7b — inline action handlers. All three route to existing
   *  Phase 4 / 5b endpoints with optimistic UI in the parent. */
  onScore: () => void;
  onRefine: () => void;
  onElect: (variationId: string) => void;
  onReject: (variationId: string) => void;
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
    // Empty state — feature was expanded but had no variations.
    // Rare in practice (room generation always seeds variations);
    // surfacing the drawer link lets the user investigate.
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
            No variations yet — open the mechanism to inspect.
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
      {/* Header row — title + (when scored) envelope summary + action
          buttons. The Apple-tier choice is to keep the buttons in
          the header so the lineup row is just signal (no buttons
          per row except elect/reject which are tiny). */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Mechanism lineup · {variations.length} candidate
            {variations.length === 1 ? "" : "s"}
          </div>
          {/* Phase 8b — "ranked" chip matching the reference. Visible
              only when at least one variation carries a score so the
              user knows the order is data-backed, not arbitrary. */}
          {hasScores && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.10em]"
              style={{
                background: `${OUTCOME_COLOR}14`,
                color: OUTCOME_COLOR,
              }}
              title="Sorted by effectiveness score descending"
            >
              <Check className="h-2 w-2" strokeWidth={2.5} />
              ranked
            </span>
          )}
          {envelope?.lift_pct !== undefined && envelope.lift_pct !== null && (
            <span
              className="truncate text-[10px] font-light"
              style={{ color: appleVibe.text.tertiary }}
              title="Structural lift from the last scoring run"
            >
              · lift {(envelope.lift_pct * 100).toFixed(0)}% · placebo{" "}
              {envelope.placebo_verdict ?? "—"}
            </span>
          )}
        </div>
        {/* Phase 7b — action buttons. The score button copy shifts
            from "Score lineup" (cold) to "Re-score" (warm) so the
            user always sees the next-most-likely action. The
            experiment button only appears once scored — refining
            without a target pain has nothing to optimize against. */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <motion.button
            type="button"
            onClick={onScore}
            disabled={scoringBusy || refiningBusy}
            whileHover={{
              y: -1,
              transition: { duration: 0.15, ease: [0.22, 1, 0.36, 1] },
            }}
            whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
            className="inline-flex items-center gap-1 transition-[background,color] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: "transparent",
              color: appleVibe.text.secondary,
              border: `1px solid ${appleVibe.stroke.medium}`,
              borderRadius: appleVibe.radius.pill,
              padding: "3px 9px",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
            title={
              hasScores
                ? "Re-score this mechanism's variations"
                : "Score this mechanism's variations against the room's target pain"
            }
          >
            {scoringBusy ? (
              <>
                <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2.5} />
                Scoring…
              </>
            ) : (
              <>
                <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.5} />
                {hasScores ? "Re-score" : "Score"}
              </>
            )}
          </motion.button>
          {hasScores && (
            <motion.button
              type="button"
              onClick={onRefine}
              disabled={scoringBusy || refiningBusy}
              whileHover={{
                y: -1,
                transition: { duration: 0.15, ease: [0.22, 1, 0.36, 1] },
              }}
              whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
              className="inline-flex items-center gap-1 transition-all duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: appleVibe.accent.primary,
                color: appleVibe.text.onAccent,
                borderRadius: appleVibe.radius.pill,
                padding: "3px 10px",
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.02em",
                boxShadow: appleVibe.shadow.chip,
              }}
              title="Propose 3 new IV candidates targeting the weakest gap"
            >
              {refiningBusy ? (
                <>
                  <Loader2
                    className="h-2.5 w-2.5 animate-spin"
                    strokeWidth={2.5}
                  />
                  Running…
                </>
              ) : (
                <>
                  <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} />
                  Run experiment
                </>
              )}
            </motion.button>
          )}
        </div>
      </div>

      {/* Error banner — surfaced inline, not modal. Disappears on
          next successful action. */}
      {actionError && (
        <div
          className="mb-2 px-2.5 py-1.5"
          style={{
            background: "rgba(220,38,38,0.04)",
            border: "1px solid rgba(220,38,38,0.20)",
            borderRadius: appleVibe.radius.sm,
          }}
        >
          <p
            className="text-[11px] leading-snug"
            style={{ color: "rgba(127,29,29,0.95)" }}
          >
            {actionError}
          </p>
        </div>
      )}

      <ul className="space-y-1">
        {variations.slice(0, 6).map((v, i) => (
          <LineupRow
            key={v.id}
            rank={i + 1}
            variation={v}
            onElect={onElect}
            onReject={onReject}
          />
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
  onElect,
  onReject,
}: {
  rank: number;
  variation: LineupVariation;
  /** Phase 7b — inline disposition handlers. The id arg lets the
   *  parent route to /variation/disposition without the row needing
   *  to know about the entity. */
  onElect: (variationId: string) => void;
  onReject: (variationId: string) => void;
}) {
  const score = v.effectiveness_score ?? 0;
  const isElected = v.disposition === "elected";
  const isRejected = v.disposition === "rejected";
  const isRdCandidate = v.provenance === "rd_iteration";
  // Phase 8b — per-row expand state. Defaults closed. When the user
  // expands a row we surface description + tradeoff + open_questions
  // + target_root_cause chip — the full per-candidate story without
  // requiring the drawer trip.
  const [expanded, setExpanded] = useState(false);
  const hasExtras = !!(
    v.description ||
    v.tradeoff ||
    (v.open_questions && v.open_questions.length > 0) ||
    v.target_root_cause
  );

  return (
    <li
      className="group flex flex-col gap-1.5 px-2.5 py-2 transition-colors duration-150 ease-out hover:bg-[rgba(15,23,42,0.025)]"
      style={{
        borderRadius: appleVibe.radius.sm,
        opacity: isRejected ? 0.5 : 1,
        border: `1px solid ${
          isElected
            ? `${OUTCOME_COLOR}33`
            : appleVibe.stroke.hairline
        }`,
        background: isElected
          ? `${OUTCOME_COLOR}06`
          : appleVibe.surface.cardElevated,
      }}
    >
      {/* Header row — rank + name + chips + score + actions. */}
      <div className="flex items-center gap-2.5">
        <span
          className="w-3.5 flex-shrink-0 font-mono text-[10px] font-semibold tabular-nums"
          style={{ color: appleVibe.text.tertiary }}
        >
          #{rank}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[12px] font-semibold"
          style={{ color: appleVibe.text.primary }}
          title={v.name}
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
        {/* Phase 11.1c — method badge alongside the score so the user
            always sees the evaluation tier that produced the number.
            Compact mode (no tier label) keeps row chrome tight; the
            full label surfaces on hover via the title attribute. */}
        {score > 0 && v.evaluation_method && (
          <MethodBadge method={v.evaluation_method} compact />
        )}
        {/* Phase 8b — expand toggle. Always renders when there's
            extras to show; the chevron itself is the affordance. */}
        {hasExtras && (
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            aria-label={expanded ? "Collapse details" : "Expand details"}
            aria-expanded={expanded}
            className="flex h-5 w-5 items-center justify-center rounded-full transition-all duration-150 ease-out hover:bg-[rgba(15,23,42,0.06)]"
            style={{
              color: appleVibe.text.tertiary,
              opacity: expanded ? 1 : 0.55,
            }}
            title={expanded ? "Hide details" : "Show details"}
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" strokeWidth={2.4} />
            ) : (
              <ChevronDown className="h-3 w-3" strokeWidth={2.4} />
            )}
          </button>
        )}
        {/* Inline elect/reject — at 0.4 opacity at rest, full on
            row hover, full+active when the disposition is set. */}
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => v.id && onReject(v.id)}
            disabled={isRejected || !v.id}
            aria-label="Reject this candidate"
            className="flex h-5 w-5 items-center justify-center rounded-full transition-all duration-150 ease-out hover:bg-[rgba(220,38,38,0.10)] disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100"
            style={{
              color: isRejected ? "rgba(220,38,38,0.85)" : appleVibe.text.tertiary,
              opacity: isRejected ? 1 : 0.45,
            }}
            title="Reject"
          >
            <X className="h-3 w-3" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => v.id && onElect(v.id)}
            disabled={isElected || !v.id}
            aria-label="Elect this candidate"
            className="flex h-5 w-5 items-center justify-center rounded-full transition-all duration-150 ease-out hover:bg-[rgba(22,163,74,0.10)] disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100"
            style={{
              color: isElected ? OUTCOME_COLOR : appleVibe.text.tertiary,
              opacity: isElected ? 1 : 0.45,
            }}
            title="Elect"
          >
            <Check className="h-3 w-3" strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {/* Description — always visible (line-clamp-2 at rest, full
          when expanded). This is the data-richness fix per the
          reference: each candidate now reads as a card with
          substance, not just a name + score. */}
      {v.description && (
        <p
          className="pl-6 text-[11.5px] leading-snug"
          style={{
            color: appleVibe.text.secondary,
            ...(expanded
              ? {}
              : {
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }),
          }}
        >
          {v.description}
        </p>
      )}

      {/* Expanded extras — tradeoff + open_questions + target_root_cause. */}
      {expanded && (
        <div className="space-y-2 pl-6">
          {v.tradeoff && (
            <div
              className="px-2.5 py-1.5"
              style={{
                background: "rgba(217,119,6,0.06)",
                border: "1px solid rgba(217,119,6,0.18)",
                borderRadius: appleVibe.radius.sm,
              }}
            >
              <div
                className="text-[9px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: "rgba(146,64,14,0.95)" }}
              >
                Tradeoff
              </div>
              <p
                className="mt-0.5 text-[11.5px] leading-snug"
                style={{ color: "rgba(120,53,15,0.92)" }}
              >
                {v.tradeoff}
              </p>
            </div>
          )}
          {v.open_questions && v.open_questions.length > 0 && (
            <div>
              <div
                className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Open questions
              </div>
              <ul className="space-y-0.5">
                {v.open_questions.slice(0, 3).map((q, i) => (
                  <li
                    key={`${i}-${q}`}
                    className="flex items-start gap-1.5 text-[11px] leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    <span
                      className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full"
                      style={{ background: appleVibe.text.faint }}
                      aria-hidden
                    />
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {v.target_root_cause && (
            <div className="flex items-center gap-1">
              <span
                className="text-[9px] font-semibold uppercase tracking-[0.10em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                targets
              </span>
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                style={{
                  background: appleVibe.surface.chip,
                  color: appleVibe.text.secondary,
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                }}
              >
                {v.target_root_cause}
              </span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── Phase 8b — Lateral relationship chip ─────────────────────────
//
// Renders a single composes_with / interferes_with link to another
// chain's mechanism. composes_with reads as collaborative (features
// blue at low alpha); interferes_with reads as friction (amber).
// Hover lifts subtly + reveals the LLM's rationale via title attr.

function LateralChip({
  link,
  onClick,
}: {
  link: {
    otherFeatureId: string;
    otherFeatureName: string;
    kind: "composes_with" | "interferes_with";
    rationale: string;
  };
  onClick: () => void;
}) {
  const isComposes = link.kind === "composes_with";
  const accent = isComposes ? FEATURE_COLOR : "rgba(217,119,6,1)";
  const label = isComposes ? "composes with" : "conflicts with";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -1, transition: { duration: 0.15 } }}
      whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-[background,border-color,box-shadow] duration-150 ease-out"
      style={{
        background: `${accent}10`,
        border: `1px dashed ${accent}40`,
        color: appleVibe.text.secondary,
      }}
      title={link.rationale || `${label} ${link.otherFeatureName}`}
    >
      <span
        className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: accent }}
      >
        {label}
      </span>
      <span
        className="text-[11px] font-medium truncate max-w-[160px]"
        style={{ color: appleVibe.text.primary }}
      >
        {link.otherFeatureName}
      </span>
    </motion.button>
  );
}
