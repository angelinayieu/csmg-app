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
  Check,
  ChevronDown,
  ChevronUp,
  FlaskConical,
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
  /** Op C — thumbnail-format HTML mockup (480×320 single-screen).
   *  When present and the variation is elected, the LineupRow renders
   *  an inline iframe preview below the expanded section. Persisted
   *  by /api/brainstorm/item/variation/mockup at format=thumbnail. */
  mockup_thumbnail_html?: string;
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
    | "tested"
    | "ensemble";
  disposition?: "elected" | "rejected" | "deferred" | null;
  provenance?: "rd_iteration";
  /** Phase 8b — root_cause this candidate was generated to address
   *  (R&D iterations only). Surfaces as a chip in the expanded row. */
  target_root_cause?: string;
  /** Phase 11.2 — per-proxy-indicator grades from the rubric scorer.
   *  Each row says "this variation moves this indicator by this much,
   *  and we have this much confidence the proxy is real." Renders as
   *  a chip strip in the expanded row, grouped by outcome. Undefined
   *  for legacy rows scored before Phase 11.2 (no chip strip shows).
   *
   *  Phase 11.3 — ensemble tier adds optional lens_scores +
   *  disagreement + mediation_check + goodhart_risk. When the
   *  IndicatorBreakdown component sees lens_scores it switches to
   *  the richer display (lens-agreement chip, Goodhart flag,
   *  mediation tag). Rubric tier renders the Phase 11.2 minimal chip. */
  indicator_scores?: Array<{
    indicator_text: string;
    outcome_id: string;
    outcome_name: string;
    score: number;
    reason: string;
    confidence: number;
    lens_scores?: Array<{
      lens:
        | "systems_analyst"
        | "skeptic"
        | "operator"
        | "engineer"
        | "historian";
      score: number;
      confidence: number;
      reason: string;
    }>;
    disagreement_score?: number;
    disagreement_confidence?: number;
    lens_agreement_count?: number;
    mediation_check?: "necessary" | "indirect" | "questionable";
    goodhart_risk?: "low" | "medium" | "high";
    /** Phase 11.5 — MC-propagated lift % on this indicator under the
     *  variation's intervention. Composed as outcome_mc_lift ×
     *  consensus_confidence (Prentice proportion-explained proxy). */
    lift_pct?: number;
    /** Phase 11.5 — MC sample-quantile band, also scaled by confidence. */
    lift_band?: { p10: number; p50: number; p90: number };
    lift_band_method?: "mc_scaled" | "mc_direct";
  }>;
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
  /** Phase 11.2 — used by LineupRow's "Open Lab" link to build the
   *  deep-link URL into /app/objective/[spaceId]/sub/[subId]/lab/[featureId].
   *  Optional for legacy mounts; the affordance is hidden when either
   *  is missing. */
  spaceId?: string;
  subObjectiveId?: string;
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
  spaceId,
  subObjectiveId,
  onApprove,
  onOpenFeatureDetail,
  onOpenPainDetail,
  onOpenOutcomeDetail,
  refreshSignal,
  lateralLinks = [],
  onOpenItem,
}: Props) {
  // ── Phase 11.4 — chain enrichment surface ───────────────────────
  // Read enrichment from the pain→feature edge's agent_feedback.
  // Both edges in a chain carry the same enrichment payload (the
  // enrich-chains endpoint writes it to both), so either works.
  // Undefined when the chain hasn't been enriched yet — the
  // "Causal mechanism" section just doesn't render in that case.
  // The user runs canvas autopilot or POSTs to /enrich-chains to
  // populate it.
  const chainEnrichment = useMemo((): {
    narrative: string;
    chain_strength: number;
    mediators: Array<{
      name: string;
      assumption: string;
      effect: "amplifies" | "dampens" | "conditional";
    }>;
    causal_flow_rationale: string;
    outcome_closes_loop: string;
    weak_points: string[];
  } | null => {
    const af = chain.painFeatureEdge.agent_feedback as
      | Record<string, unknown>
      | null;
    if (!af) return null;
    const narrative = typeof af.narrative === "string" ? af.narrative : "";
    if (!narrative) return null;
    const chain_strength =
      typeof af.chain_strength === "number" ? af.chain_strength : 0;
    const mediators = Array.isArray(af.mediators)
      ? (af.mediators as unknown[]).filter(
          (m): m is {
            name: string;
            assumption: string;
            effect: "amplifies" | "dampens" | "conditional";
          } =>
            typeof m === "object" &&
            m !== null &&
            typeof (m as { name: unknown }).name === "string" &&
            typeof (m as { assumption: unknown }).assumption === "string",
        )
      : [];
    return {
      narrative,
      chain_strength,
      mediators,
      causal_flow_rationale:
        typeof af.causal_flow_rationale === "string"
          ? af.causal_flow_rationale
          : "",
      outcome_closes_loop:
        typeof af.outcome_closes_loop === "string"
          ? af.outcome_closes_loop
          : "",
      weak_points: Array.isArray(af.weak_points)
        ? (af.weak_points as unknown[]).filter(
            (s): s is string => typeof s === "string",
          )
        : [],
    };
  }, [chain.painFeatureEdge.agent_feedback]);
  const [mechanismExpanded, setMechanismExpanded] = useState(false);

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
        // Op C — thread the cached thumbnail mockup HTML so the
        // LineupRow can render it inline without a server round trip
        // when the user expands an elected variation.
        mockup_thumbnail_html: v.mockup_thumbnail_html,
        // Phase 11.2 — thread the per-proxy-indicator breakdown so
        // the expanded row's IndicatorBreakdown component can render
        // chips without a separate server round trip. Empty/undefined
        // when no indicators were graded.
        indicator_scores: v.indicator_scores,
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
      {/* Header — eyebrow + title on the left, hero composite metric +
          approved pill on the right. The composite is the visual anchor:
          SF Display numeric, no chip, no shouting. */}
      <header
        className="flex items-center justify-between gap-4 px-6 py-4"
        style={{ borderBottom: `1px solid ${appleVibe.stroke.hairline}` }}
      >
        <div className="min-w-0 flex-1">
          <div
            className="text-[9.5px] font-medium uppercase tracking-[0.18em]"
            style={{ color: appleVibe.text.faint }}
          >
            Experiment frame
          </div>
          <h3
            className="mt-1 truncate text-[16px] font-semibold leading-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.018em",
              fontFamily: appleVibe.font.display,
            }}
            title={categoryLabel}
          >
            {categoryLabel}
          </h3>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          {approved && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-medium tracking-tight"
              style={{
                background: `${OUTCOME_COLOR}12`,
                color: OUTCOME_COLOR,
              }}
              title="Approved — promoted to the main canvas"
            >
              <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
              Approved
            </span>
          )}
          <div
            className="text-right leading-none"
            title="Chain composite — min of the two hop strengths"
          >
            <div
              className="tabular-nums"
              style={{
                color: appleVibe.text.primary,
                fontFamily: appleVibe.font.display,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.025em",
              }}
            >
              {compositePct}
              <span
                style={{
                  color: appleVibe.text.tertiary,
                  fontSize: 14,
                  fontWeight: 500,
                  marginLeft: 1,
                }}
              >
                %
              </span>
            </div>
            <div
              className="mt-1 text-[8.5px] font-medium uppercase tracking-[0.2em]"
              style={{ color: appleVibe.text.faint }}
            >
              Composite
            </div>
          </div>
        </div>
      </header>

      {/* Problem ↔ Outcome juxtaposition — two zones inside one card,
          separated by a single vertical hairline. No nested cards,
          no colored borders. Each zone carries its lane identity via
          a 2px colored left edge + a small colored dot. */}
      <div className="flex flex-col px-6 pt-5 md:flex-row md:items-stretch">
        <div className="min-w-0 flex-1 pb-5 md:pb-0 md:pr-6">
          <ProblemHalf
            pain={pain}
            painName={chain.painName}
            onClick={onOpenPainDetail}
          />
        </div>
        <div
          className="hidden md:block"
          style={{
            width: 1,
            background: appleVibe.stroke.hairline,
          }}
          aria-hidden
        />
        <div className="min-w-0 flex-1 md:pl-6">
          <OutcomeHalf
            outcome={outcome}
            outcomeName={chain.outcomeName}
            onClick={onOpenOutcomeDetail}
          />
        </div>
      </div>

      {/* Bridge — feature name + mechanism phrase. Single left-aligned
          line, no hr-sandwich, no pill wrapper. A small filled dot in
          the feature lane color is the only visual anchor. */}
      <button
        type="button"
        onClick={onOpenFeatureDetail}
        className="group mx-6 mt-5 mb-1 flex w-[calc(100%-3rem)] items-baseline gap-2 text-left"
        title="Open mechanism detail"
      >
        <span
          className="inline-block h-1.5 w-1.5 flex-shrink-0 translate-y-[-1px] rounded-full"
          style={{ background: FEATURE_COLOR }}
          aria-hidden
        />
        <span
          className="text-[10.5px] font-medium tracking-tight"
          style={{ color: appleVibe.text.tertiary }}
        >
          Tested via
        </span>
        <span
          className="min-w-0 truncate text-[12.5px] font-medium transition-opacity duration-150 group-hover:opacity-70"
          style={{
            color: appleVibe.text.primary,
            letterSpacing: "-0.01em",
          }}
        >
          {chain.featureName}
        </span>
        {chain.mechanism && (
          <span
            className="min-w-0 truncate text-[11.5px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
            title="The named lever this chain pulls"
          >
            · &ldquo;{chain.mechanism}&rdquo;
          </span>
        )}
      </button>

      {/* Phase 11.4 — Causal mechanism section. Renders when the chain
          has been enriched (post canvas autopilot or explicit POST to
          /enrich-chains). Collapsed by default — header shows chain
          strength + mediator count + expand caret. Expanded shows the
          full narrative + mediators + weak points + outcome-closes-
          loop rationale. Restrained styling — tables only inside,
          per lock-in M5 "Lab elaborates with tables." */}
      {chainEnrichment && (
        <div
          className="mx-6 mt-3 rounded-lg"
          style={{
            background: appleVibe.surface.chip,
            border: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <button
            type="button"
            onClick={() => setMechanismExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-[rgba(15,23,42,0.025)]"
            style={{ borderRadius: 7 }}
            aria-label={
              mechanismExpanded
                ? "Hide causal mechanism"
                : "Show causal mechanism"
            }
            aria-expanded={mechanismExpanded}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Causal mechanism
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                style={{
                  background:
                    chainEnrichment.chain_strength >= 0.7
                      ? `${OUTCOME_COLOR}1F`
                      : chainEnrichment.chain_strength >= 0.4
                        ? `${FEATURE_COLOR}1F`
                        : `${PAIN_COLOR}1F`,
                  color:
                    chainEnrichment.chain_strength >= 0.7
                      ? OUTCOME_COLOR
                      : chainEnrichment.chain_strength >= 0.4
                        ? FEATURE_COLOR
                        : PAIN_COLOR,
                }}
                title="End-to-end chain strength (0 to 1) — how plausibly Pain → Feature → Outcome closes the loop"
              >
                ⚡ {chainEnrichment.chain_strength.toFixed(2)}
              </span>
              {chainEnrichment.mediators.length > 0 && (
                <span
                  className="text-[10px] font-light"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  · {chainEnrichment.mediators.length}{" "}
                  {chainEnrichment.mediators.length === 1
                    ? "mediator"
                    : "mediators"}
                </span>
              )}
              {chainEnrichment.weak_points.length > 0 && (
                <span
                  className="text-[10px] font-light"
                  style={{ color: PAIN_COLOR }}
                  title={chainEnrichment.weak_points.join(" · ")}
                >
                  · {chainEnrichment.weak_points.length} weak{" "}
                  {chainEnrichment.weak_points.length === 1
                    ? "point"
                    : "points"}
                </span>
              )}
            </div>
            {mechanismExpanded ? (
              <ChevronUp
                className="h-3 w-3 flex-shrink-0"
                strokeWidth={2.4}
                style={{ color: appleVibe.text.tertiary }}
              />
            ) : (
              <ChevronDown
                className="h-3 w-3 flex-shrink-0"
                strokeWidth={2.4}
                style={{ color: appleVibe.text.tertiary }}
              />
            )}
          </button>
          {mechanismExpanded && (
            <div
              className="px-3 pb-3 pt-1"
              style={{
                borderTop: `1px solid ${appleVibe.stroke.hairline}`,
              }}
            >
              <p
                className="text-[11.5px] leading-snug"
                style={{ color: appleVibe.text.primary }}
              >
                {chainEnrichment.narrative}
              </p>
              {chainEnrichment.mediators.length > 0 && (
                <div className="mt-2">
                  <div
                    className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Mediators
                  </div>
                  <ul className="mt-1 space-y-1">
                    {chainEnrichment.mediators.map((m, idx) => (
                      <li
                        key={idx}
                        className="flex items-baseline gap-2 text-[11px]"
                      >
                        <span
                          className="font-medium"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {m.name}
                        </span>
                        <span
                          className="text-[9.5px] uppercase tracking-[0.1em]"
                          style={{
                            color:
                              m.effect === "amplifies"
                                ? OUTCOME_COLOR
                                : m.effect === "dampens"
                                  ? PAIN_COLOR
                                  : appleVibe.text.tertiary,
                          }}
                        >
                          {m.effect}
                        </span>
                        <span
                          className="flex-1 font-light"
                          style={{ color: appleVibe.text.secondary }}
                        >
                          {m.assumption}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {chainEnrichment.outcome_closes_loop && (
                <div className="mt-2">
                  <div
                    className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Outcome closes loop
                  </div>
                  <p
                    className="mt-0.5 text-[11px] leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    {chainEnrichment.outcome_closes_loop}
                  </p>
                </div>
              )}
              {chainEnrichment.weak_points.length > 0 && (
                <div className="mt-2">
                  <div
                    className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: PAIN_COLOR }}
                  >
                    Weak points
                  </div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {chainEnrichment.weak_points.map((w, idx) => (
                      <li
                        key={idx}
                        className="text-[11px] leading-snug"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Phase 8b — within-layer relationship chips. Surface
          composes_with / interferes_with links to OTHER chains'
          mechanisms so the user sees at a glance that this
          experiment doesn't live in isolation. Chips are subtle
          (no bold colors) and click through to the related
          feature's drawer. */}
      {lateralLinks.length > 0 && (
        <div className="mx-6 mt-4 flex flex-wrap items-center gap-1.5">
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

      {/* Phase 8c — Feature first_principles. Replaces the colored band
          with a quiet hairline-anchored zone: hairline above, sentence-
          case label, clean text rows (no bullet dots). Visually belongs
          to the mechanism band without color-shouting. */}
      {feature && feature.first_principles && feature.first_principles.length > 0 && (
        <div
          className="mx-6 mt-4 mb-4 pt-3"
          style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
        >
          <div
            className="mb-1.5 text-[9.5px] font-medium tracking-tight"
            style={{ color: appleVibe.text.faint }}
          >
            Why this works
          </div>
          <ul className="space-y-1">
            {feature.first_principles.slice(0, 5).map((p, i) => (
              <li
                key={`${i}-${p}`}
                className="text-[11.5px] leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mechanism Lineup */}
      <div className="px-6 pb-5 pt-1">
        <MechanismLineup
          variations={sortedVariations}
          featureId={chain.featureId}
          spaceId={spaceId}
          subObjectiveId={subObjectiveId}
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
        className="flex items-center justify-between gap-3 px-6 py-3"
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
      whileHover={{ opacity: 0.78, transition: { duration: 0.15 } }}
      whileTap={{ scale: 0.998, transition: { duration: 0.08 } }}
      className="block w-full text-left"
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ background: PAIN_COLOR }}
          aria-hidden
        />
        <span
          className="text-[10.5px] font-medium tracking-tight"
          style={{ color: appleVibe.text.tertiary }}
        >
          Problem
        </span>
      </div>
      <h4
        className="mt-2 text-[14px] font-semibold leading-snug line-clamp-2"
        style={{
          color: appleVibe.text.primary,
          letterSpacing: "-0.018em",
          fontFamily: appleVibe.font.display,
        }}
      >
        {pain?.name ?? painName}
      </h4>
      {pain?.negative_outcome && (
        <p
          className="mt-1.5 text-[11.5px] leading-snug line-clamp-2"
          style={{ color: appleVibe.text.secondary }}
        >
          {pain.negative_outcome}
        </p>
      )}
      {Array.isArray(pain?.root_causes) && pain.root_causes.length > 0 && (
        <div
          className="mt-3 pt-2.5"
          style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
        >
          <div
            className="text-[9.5px] font-medium tracking-tight"
            style={{ color: appleVibe.text.faint }}
          >
            Root causes
          </div>
          <ul className="mt-1 space-y-0.5">
            {pain.root_causes.slice(0, 3).map((c, i) => (
              <li
                key={i}
                className="text-[11.5px] leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                {c}
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
      whileHover={{ opacity: 0.78, transition: { duration: 0.15 } }}
      whileTap={{ scale: 0.998, transition: { duration: 0.08 } }}
      className="block w-full text-left"
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ background: OUTCOME_COLOR }}
          aria-hidden
        />
        <span
          className="text-[10.5px] font-medium tracking-tight"
          style={{ color: appleVibe.text.tertiary }}
        >
          Outcome
        </span>
      </div>
      <h4
        className="mt-2 text-[14px] font-semibold leading-snug line-clamp-2"
        style={{
          color: appleVibe.text.primary,
          letterSpacing: "-0.018em",
          fontFamily: appleVibe.font.display,
        }}
      >
        {outcome?.name ?? outcomeName}
      </h4>
      {outcome?.measured_by && (
        <p
          className="mt-1.5 text-[11.5px] leading-snug line-clamp-2"
          style={{ color: appleVibe.text.secondary }}
        >
          {outcome.measured_by}
        </p>
      )}
      {/* Phase 8d — INDICATORS list. Falls back to [measured_by] when
          indicators are missing (legacy rooms). Cap at 4 entries so
          this column stays balanced with the Problem column. */}
      {(() => {
        const list =
          outcome?.indicators && outcome.indicators.length > 0
            ? outcome.indicators
            : outcome?.measured_by
              ? [outcome.measured_by]
              : [];
        if (list.length === 0) return null;
        return (
          <div
            className="mt-3 pt-2.5"
            style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
          >
            <div
              className="text-[9.5px] font-medium tracking-tight"
              style={{ color: appleVibe.text.faint }}
            >
              Indicators
            </div>
            <ul className="mt-1 space-y-0.5">
              {list.slice(0, 4).map((ind, i) => (
                <li
                  key={`${i}-${ind}`}
                  className="text-[11.5px] leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  {ind}
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
  featureId,
  spaceId,
  subObjectiveId,
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
  /** Op C — passed down to LineupRow so it can fire the mockup route
   *  for elected variations. */
  featureId: string;
  /** Phase 11.2 — used by LineupRow's "Open Lab" deep-link. */
  spaceId?: string;
  subObjectiveId?: string;
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
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <div
            className="text-[10.5px] font-medium tracking-tight"
            style={{ color: appleVibe.text.tertiary }}
          >
            Mechanism lineup
          </div>
          <span
            className="text-[10.5px] font-light tabular-nums"
            style={{ color: appleVibe.text.faint }}
          >
            {variations.length}
          </span>
          {/* Phase 8b — "ranked" chip. Visible only when at least one
              variation carries a score so the user knows the order is
              data-backed, not arbitrary. */}
          {hasScores && (
            <span
              className="inline-flex translate-y-[-0.5px] items-center gap-0.5 rounded-full px-1.5 py-[2px] text-[9.5px] font-medium tracking-tight"
              style={{
                background: `${OUTCOME_COLOR}10`,
                color: OUTCOME_COLOR,
              }}
              title="Sorted by effectiveness score descending"
            >
              <Check className="h-2 w-2" strokeWidth={2.5} />
              Ranked
            </span>
          )}
          {envelope?.lift_pct !== undefined && envelope.lift_pct !== null && (
            <span
              className="truncate text-[10px] font-light"
              style={{ color: appleVibe.text.faint }}
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
            whileHover={{ y: -0.5, transition: { duration: 0.15 } }}
            whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
            className="inline-flex items-center gap-1 transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.secondary,
              borderRadius: appleVibe.radius.pill,
              padding: "4px 10px",
              fontSize: "10.5px",
              fontWeight: 500,
              letterSpacing: "-0.005em",
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
            featureId={featureId}
            spaceId={spaceId}
            subObjectiveId={subObjectiveId}
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
  featureId,
  spaceId,
  subObjectiveId,
  onElect,
  onReject,
}: {
  rank: number;
  variation: LineupVariation;
  /** Op C — entity id for firing the mockup route on elected
   *  variations. The LineupRow can render the inline mockup inside
   *  its expanded section without bubbling state up. */
  featureId: string;
  /** Phase 11.2 — used to build the Open Lab deep-link URL. When
   *  either is missing the link is hidden (legacy mount sites that
   *  don't surface the affordance). */
  spaceId?: string;
  subObjectiveId?: string;
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
        {/* Phase 11.2 — "Open Lab" deep-link. Small flask icon that
            routes to the focused evaluation page for this mechanism.
            Hidden when spaceId/subObjectiveId aren't threaded through
            (older mount sites). Sits to the LEFT of the expand
            chevron so it reads as a parallel affordance, not a
            secondary control. */}
        {spaceId && subObjectiveId && (
          <a
            href={`/app/objective/${spaceId}/sub/${subObjectiveId}/lab/${featureId}`}
            onClick={(e) => e.stopPropagation()}
            className="flex h-5 w-5 items-center justify-center rounded-full transition-all duration-150 ease-out hover:bg-[rgba(124,58,237,0.10)]"
            style={{
              color: appleVibe.accent.primary,
              opacity: 0.55,
            }}
            title="Open Lab — focused evaluation for this mechanism"
            aria-label="Open Lab"
          >
            <FlaskConical className="h-3 w-3" strokeWidth={2.2} />
          </a>
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
          {/* Phase 11.2 — per-proxy-indicator breakdown. Surfaces
              "how does this variation move each measurable thing the
              outcome is trying to track" — directly answering the
              user's stated vision: "scoring based on proxy indicators."
              Grouped by outcome so chips with the same outcome stay
              together; the ⚠️ marks low-confidence proxies so the
              user can reconsider what they're measuring. */}
          {v.indicator_scores && v.indicator_scores.length > 0 && (
            <IndicatorBreakdown
              indicators={v.indicator_scores}
            />
          )}
          {/* Op C — inline thumbnail mockup for elected variations.
              Surfaces the interface design WHERE the user expanded
              the mechanism, instead of behind the drawer's
              Deliverables modal. */}
          {isElected && v.id && (
            <InlineMockupPreview
              entityId={featureId}
              variationId={v.id}
              initialHtml={v.mockup_thumbnail_html}
            />
          )}
        </div>
      )}
    </li>
  );
}

// ── Phase 11.2 — per-proxy-indicator chip strip ────────────────────
//
// Shows each indicator the rubric scored this variation against,
// grouped by outcome. Score is the explicit number; confidence ≤0.4
// renders a ⚠️ tooltip to flag "this proxy is shaky — reconsider
// what you're measuring" so the user doesn't chase a vanity metric.
//
// Why a chip strip vs. a table: variations live in a dense lineup,
// each row competes for vertical space, and the user's primary
// question is "did this move what I care about" — answerable at a
// glance. The drawer can host a fuller table view when needed.

function IndicatorBreakdown({
  indicators,
}: {
  indicators: NonNullable<LineupVariation["indicator_scores"]>;
}) {
  const grouped = new Map<string, typeof indicators>();
  for (const ind of indicators) {
    const key = ind.outcome_name;
    const arr = grouped.get(key) ?? [];
    arr.push(ind);
    grouped.set(key, arr);
  }
  // Phase 11.3 — render mode auto-detected. When lens_scores is
  // present on the first row, we surface the ensemble visuals
  // (lens-agreement chip + Goodhart flag + mediation tag). When
  // absent, we fall back to the Phase 11.2 minimal chip strip.
  const isEnsemble =
    indicators.length > 0 && Array.isArray(indicators[0].lens_scores);
  return (
    <div>
      <div
        className="mb-0.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        <span>Proxy indicators</span>
        {isEnsemble && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-medium normal-case"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.secondary,
              border: `1px solid ${appleVibe.stroke.hairline}`,
              letterSpacing: "0.01em",
            }}
            title="Each indicator graded from 5 lenses (systems_analyst / skeptic / operator / engineer / historian). Variance across lenses is the confidence signal — when lenses agree the proxy is well-formed; when they diverge it's a Potemkin metric."
          >
            📊 5-lens
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {Array.from(grouped.entries()).map(([outcomeName, list]) => (
          <div key={outcomeName} className="space-y-0.5">
            <div
              className="text-[9.5px] font-medium italic"
              style={{ color: appleVibe.text.faint }}
            >
              in {outcomeName}
            </div>
            <div className="flex flex-wrap gap-1">
              {list.map((ind, i) => {
                const shaky = ind.confidence <= 0.4;
                const truncated =
                  ind.indicator_text.length > 32
                    ? `${ind.indicator_text.slice(0, 30)}…`
                    : ind.indicator_text;
                const tier =
                  ind.score >= 0.7
                    ? OUTCOME_COLOR
                    : ind.score < 0.4
                      ? appleVibe.stage.pain
                      : appleVibe.text.secondary;
                // Phase 11.3 — lens-aware signals. lens_agreement
                // becomes a "N/5" chip; mediation=="questionable"
                // and goodhart=="high" surface as small icon glyphs.
                const lensCount = ind.lens_agreement_count ?? 0;
                const lensTotal = ind.lens_scores?.length ?? 0;
                const lensShaky = lensTotal > 0 && lensCount < 3;
                const mediation = ind.mediation_check;
                const goodhartRisk = ind.goodhart_risk;
                // Tooltip composes lens-specific reasons when present
                // (one sentence per lens, joined by " | ") so hovering
                // a chip reveals the full multi-perspective rationale.
                const tooltipParts: string[] = [];
                if (ind.lens_scores && ind.lens_scores.length > 0) {
                  for (const ls of ind.lens_scores) {
                    tooltipParts.push(`${ls.lens}: ${ls.reason}`);
                  }
                } else if (ind.reason) {
                  tooltipParts.push(ind.reason);
                }
                if (shaky) {
                  tooltipParts.push(
                    `shaky proxy: pooled confidence ${ind.confidence.toFixed(2)}`,
                  );
                }
                if (mediation === "questionable") {
                  tooltipParts.push(
                    "Prentice mediation: questionable — proxy might invert under intervention",
                  );
                }
                if (goodhartRisk === "high") {
                  tooltipParts.push(
                    "Goodhart: high risk — pure-volume or vanity proxy, easily gamed",
                  );
                }
                // Phase 11.5 — lift chip. When MC ran AND produced a
                // valid band, render the signed lift % beside the
                // score. Color tiers: positive = outcomes green,
                // negative = pain red, ≈0 = neutral.
                const hasLift = typeof ind.lift_pct === "number";
                const liftPct = ind.lift_pct ?? 0;
                const liftSign = liftPct > 0 ? "+" : "";
                const liftColor =
                  liftPct > 0.02
                    ? OUTCOME_COLOR
                    : liftPct < -0.02
                      ? appleVibe.stage.pain
                      : appleVibe.text.tertiary;
                // Append lift band to tooltip when present
                if (ind.lift_band) {
                  tooltipParts.push(
                    `MC lift band: p10 ${(ind.lift_band.p10 * 100).toFixed(1)}% · p50 ${(ind.lift_band.p50 * 100).toFixed(1)}% · p90 ${(ind.lift_band.p90 * 100).toFixed(1)}%`,
                  );
                }
                return (
                  <span
                    key={`${ind.indicator_text}-${i}`}
                    title={tooltipParts.join(" | ")}
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium"
                    style={{
                      background: shaky
                        ? `${appleVibe.stage.pain}10`
                        : appleVibe.surface.chip,
                      color: tier,
                      border: shaky
                        ? `1px solid ${appleVibe.stage.pain}40`
                        : `1px solid ${appleVibe.stroke.hairline}`,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span>{truncated}</span>
                    <span style={{ fontWeight: 600 }}>
                      {ind.score.toFixed(2)}
                    </span>
                    {ind.lens_scores && (
                      <span
                        style={{
                          color: lensShaky
                            ? appleVibe.stage.pain
                            : appleVibe.text.tertiary,
                          fontWeight: 500,
                        }}
                      >
                        · {lensCount}/{lensTotal}
                      </span>
                    )}
                    {hasLift && (
                      <span
                        style={{
                          color: liftColor,
                          fontWeight: 600,
                          marginLeft: "2px",
                        }}
                      >
                        {liftSign}
                        {(liftPct * 100).toFixed(0)}%
                      </span>
                    )}
                    {goodhartRisk === "high" && <span aria-hidden>⚠️</span>}
                    {mediation === "questionable" && (
                      <span aria-hidden>⚡</span>
                    )}
                    {shaky && <span aria-hidden>🔻</span>}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Inline mockup preview (Op C) ───────────────────────────────────
//
// Renders a 480×320 thumbnail mockup of an elected variation directly
// inside the expanded variation row on the CategoryCard. Self-fetches
// from /api/brainstorm/item/variation/mockup at format=thumbnail when
// no cached value is present.
//
// Three states:
//   - no cached mockup → "Generate inline mockup" button
//   - generating       → loader pill
//   - rendered         → sandboxed iframe + small "Open fullscreen"
//                         link (a future enhancement could route to
//                         the Deliverables modal; for now it just
//                         hints at where the full version lives)
//
// Visual: top-tier — Apple-vibe pill button with Layout icon, soft
// hairline border on the iframe, gradient-fade label badge above.

function InlineMockupPreview({
  entityId,
  variationId,
  initialHtml,
}: {
  entityId: string;
  variationId: string;
  initialHtml?: string;
}) {
  const [html, setHtml] = useState<string>(initialHtml ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMockup = useCallback(
    async (force = false) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(
          "/api/brainstorm/item/variation/mockup",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              entityId,
              variationId,
              format: "thumbnail",
              mode: force ? "force" : "default",
            }),
          },
        );
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          mockup_html?: string;
        };
        if (!res.ok) {
          setError(j.error ?? "Mockup generation failed.");
          return;
        }
        if (typeof j.mockup_html === "string") setHtml(j.mockup_html);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setBusy(false);
      }
    },
    [busy, entityId, variationId],
  );

  // No cached html + user hasn't clicked → button only.
  if (!html && !busy && !error) {
    return (
      <div className="mt-1.5">
        <motion.button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void fetchMockup(false);
          }}
          whileHover={{ y: -1, transition: { duration: 0.15 } }}
          whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
          className="inline-flex items-center gap-1.5 transition-[background,color] duration-150 ease-out hover:bg-[rgba(124,58,237,0.08)]"
          style={{
            background: appleVibe.surface.card,
            color: appleVibe.accent.primary,
            border: `1px solid ${appleVibe.accent.primary}40`,
            borderRadius: appleVibe.radius.pill,
            padding: "4px 10px",
            fontSize: "10.5px",
            fontWeight: 600,
            letterSpacing: "0.02em",
            boxShadow: appleVibe.shadow.chip,
            fontFamily: appleVibe.font.stack,
          }}
          title="Generate a 480×320 HTML mockup of this variation's interface — shows inline below"
        >
          <Sparkles
            className="h-3 w-3"
            strokeWidth={2.2}
            style={{ color: appleVibe.accent.primary }}
          />
          Generate inline mockup
        </motion.button>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[9px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: appleVibe.accent.primary }}
        >
          Interface mockup
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void fetchMockup(true);
          }}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium transition-opacity disabled:opacity-50"
          style={{
            color: appleVibe.text.tertiary,
            background: "transparent",
          }}
          title="Regenerate"
        >
          {busy ? (
            <Loader2
              className="h-2.5 w-2.5 animate-spin"
              strokeWidth={2.4}
            />
          ) : (
            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.4} />
          )}
          {busy ? "Generating…" : "Regenerate"}
        </button>
      </div>
      {error && (
        <p
          className="text-[10.5px] font-light"
          style={{ color: "rgba(127,29,29,0.95)" }}
        >
          {error}
        </p>
      )}
      {html ? (
        <iframe
          title="Variation interface mockup"
          srcDoc={html}
          sandbox=""
          className="w-full"
          style={{
            background: "#ffffff",
            border: `1px solid ${appleVibe.stroke.hairline}`,
            borderRadius: appleVibe.radius.md,
            height: "320px",
            boxShadow: appleVibe.shadow.chip,
          }}
        />
      ) : busy ? (
        <div
          className="flex items-center justify-center gap-2"
          style={{
            background: appleVibe.surface.cardElevated,
            border: `1px dashed ${appleVibe.stroke.medium}`,
            borderRadius: appleVibe.radius.md,
            height: "320px",
          }}
        >
          <Loader2
            className="h-4 w-4 animate-spin"
            style={{ color: appleVibe.text.tertiary }}
          />
          <span
            className="text-[11.5px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            Generating mockup — usually 10-20 seconds.
          </span>
        </div>
      ) : null}
    </div>
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
