// ── POST /api/brainstorm/item/variation/score ────────────────────
//
// Phase 4a — Mechanism Effectiveness Scoring (engine wire-up).
// Phase 4c — Persistence of the scoring envelope.
//
// Computes a deterministic 0..1 effectiveness score per variation
// on a FEATURE card by:
//   1. Resolving the feature → linked pain entity (highest-strength
//      edge target/source)
//   2. Running simulateVariantLift on (lever=feature, target=pain)
//   3. Running computePlaceboRefutation for specificity
//   4. Composing per-variation scores using the variation's
//      LLM-rated addresses_pain
//   5. (Phase 4c) Persisting the envelope + per-variation scores
//      into entities.expanded_detail so re-opening the drawer
//      surfaces the prior run without re-spending MC budget.
//
// Body: { entityId }    — the feature entity (NOT a variation id)
//
// Returns the full VariationScoreEnvelope including diagnostic
// status when scoring isn't possible (lever unreachable, no target
// pain, etc.). Soft-fails so the UI can surface "scoring unavailable"
// instead of an error overlay.
//
// Persistence: atomic merge into entities.expanded_detail using the
// same {...existing, ...patch} pattern as disposition/compose. Two
// fields touched:
//   • variations[]            → each row's effectiveness_score
//                                updated from the envelope
//   • effectiveness_envelope  → new envelope-level fields
//                                (target/lift/placebo/status/scored_at)
// Persist soft-fails so a write hiccup doesn't bury the score in
// the response — the user still sees scores on the current run.
//
// Performance: ~1-3s typical (Monte Carlo × 2 baseline+variant ×
// real+placebo). Caller should trigger on-demand, NOT auto-fire on
// every drawer open.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { scoreVariationsForFeature } from "@/lib/objective-canvas/score-variation-effectiveness";
import { scoreVariationsWithRubric } from "@/lib/objective-canvas/score-rubric";
import {
  scoreVariationsWithEnsemble,
  type EnsembleScoreEnvelope,
} from "@/lib/objective-canvas/score-indicator-ensemble";
import { poolEnsembleIndicators } from "@/lib/objective-canvas/pool-indicator-confidence";
import {
  composeIndicatorLiftBands,
  indexOverlays,
} from "@/lib/objective-canvas/compose-indicator-lift-bands";
import {
  scoreIndicatorsWithEvidence,
  buildEvidenceSourcePool,
} from "@/lib/objective-canvas/score-indicator-evidence";
import {
  generateHCDPersonas,
  type HCDPersona,
} from "@/lib/objective-canvas/generate-personas";
import { scoreIndicatorsWithPersonas } from "@/lib/objective-canvas/score-indicator-personas";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  entityId?: string;
  /** Phase 11.1 — evaluation tier selector. Defaults to "rubric"
   *  (Tier 2: cheap, honest, explicit 5-criteria LLM grade).
   *  "simulation" routes through the Phase 4 Monte Carlo + placebo
   *  refutation engine for cases with genuine propagating
   *  uncertainty. Chat agent or Lab page user opts in to MC
   *  explicitly when warranted.
   *
   *  Phase 11.3 — "ensemble" routes through the 5-lens proxy-indicator
   *  scorer. ONE LLM call grades each variation × each indicator from
   *  systems_analyst / skeptic / operator / engineer / historian
   *  perspectives, returns per-lens scores + Goodhart risk + Prentice
   *  mediation classification per indicator, and one counter-indicator
   *  per outcome (yang/yin Goodhart antidote pairing). Per-indicator
   *  confidence then gets random-effects-pooled across variations
   *  with REML τ² so the envelope surfaces heterogeneity. ~2x rubric
   *  token cost; the most rigorous tier short of an actual experiment. */
  method?: "rubric" | "simulation" | "ensemble";
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  if (!entityId) {
    return NextResponse.json(
      { error: "entityId required" },
      { status: 400 },
    );
  }

  const method: "rubric" | "simulation" | "ensemble" =
    body?.method === "simulation"
      ? "simulation"
      : body?.method === "ensemble"
        ? "ensemble"
        : "rubric";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load entity + ownership check (also load expanded_detail so
  //    we can persist scores back into it after MC runs + causal_chain
  //    so the rubric prompt grounds in positive_outcome + first_principles). ──
  const { data: entity } = await db
    .from("entities")
    .select(
      "id, name, space_id, parent_sub_objective_id, causal_chain, expanded_detail, detail_research",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  const { data: space } = await db
    .from("spaces")
    .select(
      "id, user_id, description, input_text, synthesis_data, surface_research, deep_research",
    )
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── RUBRIC PATH (Phase 11.1b, new default) ──
  if (method === "rubric") {
    const existing = entity.expanded_detail as ExpandedItemDetail | null;
    if (!existing || !Array.isArray(existing.variations) || existing.variations.length === 0) {
      return NextResponse.json(
        {
          evaluation_method: "rubric",
          variation_scores: [],
          status: "no_variations",
          status_detail: "Feature has no variations to score yet — expand the item drawer first.",
          scored_at: new Date().toISOString(),
        },
        { status: 200 },
      );
    }

    // Fetch room context: sub-objective title + core objective + pains + outcomes.
    // All cheap by-id reads; the rubric prompt needs them for grounding.
    let subObjectiveTitle = "";
    let coreObjectiveText: string =
      (typeof space.description === "string" && space.description.trim()) ||
      (typeof space.input_text === "string" && space.input_text.trim()) ||
      "";
    if (entity.parent_sub_objective_id) {
      const { data: sub } = await db
        .from("improvement_goals")
        .select("title, parent_goal_id")
        .eq("id", entity.parent_sub_objective_id)
        .maybeSingle();
      if (sub) {
        subObjectiveTitle =
          typeof sub.title === "string" ? sub.title : "";
        if (sub.parent_goal_id) {
          const { data: parent } = await db
            .from("improvement_goals")
            .select("title, description")
            .eq("id", sub.parent_goal_id)
            .maybeSingle();
          if (parent?.description) coreObjectiveText = parent.description;
          else if (parent?.title) coreObjectiveText = parent.title;
        }
      }
    }
    // Room pains + outcomes — entity_type discriminates the lane.
    // Slim select; the rubric needs names + negative_outcome only.
    const { data: laneRows } = entity.parent_sub_objective_id
      ? await db
          .from("entities")
          .select("id, name, entity_type, causal_chain")
          .eq("parent_sub_objective_id", entity.parent_sub_objective_id)
          .in("entity_type", ["pain_point", "outcome"])
      : { data: [] };
    const lanes = (laneRows ?? []) as Array<{
      id: string;
      name: string;
      entity_type: string;
      causal_chain: Record<string, unknown> | null;
    }>;
    const roomPains = lanes
      .filter((r) => r.entity_type === "pain_point")
      .map((p) => ({
        name: p.name,
        negative_outcome:
          typeof p.causal_chain?.negative_outcome === "string"
            ? (p.causal_chain.negative_outcome as string)
            : undefined,
      }));
    // Phase 11.2 wiring fix — pass each outcome's proxy indicators
    // through so the rubric scorer can grade "how much does this
    // variation move THIS indicator" alongside the 5 generic criteria.
    // Indicators live at outcome.causal_chain.indicators[]; missing or
    // non-array values resolve to undefined cleanly so the scorer
    // skips the indicator side of the prompt for that outcome.
    const roomOutcomes = lanes
      .filter((r) => r.entity_type === "outcome")
      .map((o) => {
        const indicators = Array.isArray(o.causal_chain?.indicators)
          ? (o.causal_chain.indicators as unknown[])
              .filter((x): x is string => typeof x === "string" && x.length > 0)
              .slice(0, 6)
          : undefined;
        return {
          id: o.id,
          name: o.name,
          indicators,
        };
      });
    const constraints = readConstraints(space.synthesis_data);

    // Score against the rubric. positive_outcome + first_principles
    // come from entity.causal_chain (the feature's own causal chain),
    // NOT from expanded_detail.definition (which is the plain-language
    // explainer). Critical for prompt grounding — first_principles
    // tell the LLM what the feature is built on; definition only
    // describes what it IS in user-facing terms.
    const featureCausalChain =
      (entity.causal_chain as Record<string, unknown> | null) ?? {};
    const featurePositiveOutcome =
      typeof featureCausalChain.positive_outcome === "string"
        ? (featureCausalChain.positive_outcome as string)
        : undefined;
    const featureFirstPrinciples = Array.isArray(
      featureCausalChain.first_principles,
    )
      ? (featureCausalChain.first_principles as unknown[])
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .slice(0, 6)
      : undefined;
    let rubricEnvelope: Awaited<
      ReturnType<typeof scoreVariationsWithRubric>
    >;
    try {
      rubricEnvelope = await scoreVariationsWithRubric({
        feature: {
          name: entity.name,
          positive_outcome: featurePositiveOutcome,
          first_principles: featureFirstPrinciples,
        },
        room_pains: roomPains,
        room_outcomes: roomOutcomes,
        sub_objective_title: subObjectiveTitle,
        core_objective_text: coreObjectiveText,
        constraints,
        variations: existing.variations,
      });
    } catch (err) {
      return NextResponse.json(
        { error: "rubric scoring failed", detail: sanitizeErrorMessage(err) },
        { status: 500 },
      );
    }

    // Persist: per-variation criteria + composite score + envelope.
    // Soft-fail if persist hiccups — return the envelope regardless.
    const scoreById = new Map(
      rubricEnvelope.variation_scores.map((s) => [s.variation_id, s] as const),
    );
    // Persist indicator_scores alongside rubric_criteria so the Lab
    // page can render the per-proxy-indicator breakdown without
    // re-fetching. The rubric scorer returns indicator_scores as an
    // empty array when no indicators were graded — passing through
    // preserves that signal (UI can show "no indicators graded" vs
    // "indicators present but all zero").
    const updatedVariations = existing.variations.map((v) => {
      const s = v.id ? scoreById.get(v.id) : undefined;
      return s
        ? {
            ...v,
            effectiveness_score: s.composite_score,
            evaluation_method: "rubric" as const,
            rubric_criteria: s.criteria,
            indicator_scores: s.indicator_scores ?? [],
          }
        : v;
    });
    const nextDetail: ExpandedItemDetail = {
      ...existing,
      variations: updatedVariations,
      effectiveness_envelope: {
        evaluation_method: "rubric",
        target_entity_id: null,
        target_entity_name: null,
        target_edge_strength: null,
        lift_pct: null,
        lift_band: null,
        placebo_verdict: null,
        placebo_ratio: null,
        status: rubricEnvelope.status,
        status_detail: rubricEnvelope.status_detail,
        scored_at: rubricEnvelope.scored_at,
      },
    };
    const writeRes = await db
      .from("entities")
      .update({ expanded_detail: nextDetail })
      .eq("id", entityId);
    if (writeRes.error) {
      console.warn(
        "[item/variation/score] rubric persist failed (non-fatal):",
        writeRes.error.message,
      );
    }

    // Log the rubric run to the Lab Notebook timeline. Same `score`
    // action as MC, but metadata carries evaluation_method so the
    // notebook UI can render the right method badge per row.
    if (rubricEnvelope.status === "ok") {
      const topScore = rubricEnvelope.variation_scores.reduce(
        (max, s) => (s.composite_score > max ? s.composite_score : max),
        0,
      );

      // Phase 11.2 — aggregate per-indicator across variations so the
      // notebook event can surface "this run touched these proxies"
      // as a top-3 breakdown. avg_score = mean across variations;
      // min_confidence = lowest proxy-confidence we saw (the "shaky
      // proxy" flag). Empty array when no indicators were graded.
      const indicatorAgg = new Map<
        string,
        {
          score_sum: number;
          conf_min: number;
          count: number;
          outcome_name: string;
        }
      >();
      for (const v of rubricEnvelope.variation_scores) {
        for (const ind of v.indicator_scores ?? []) {
          const key = `${ind.outcome_id}::${ind.indicator_text}`;
          const cell = indicatorAgg.get(key) ?? {
            score_sum: 0,
            conf_min: 1,
            count: 0,
            outcome_name: ind.outcome_name,
          };
          cell.score_sum += ind.score;
          cell.conf_min = Math.min(cell.conf_min, ind.confidence);
          cell.count += 1;
          indicatorAgg.set(key, cell);
        }
      }
      const indicatorBreakdown = Array.from(indicatorAgg.entries())
        .map(([key, cell]) => {
          const [, indicator_text] = key.split("::");
          return {
            indicator: indicator_text,
            avg_score: cell.score_sum / Math.max(1, cell.count),
            min_confidence: cell.conf_min,
            outcome_name: cell.outcome_name,
          };
        })
        .sort((a, b) => b.avg_score - a.avg_score)
        .slice(0, 3);

      void logDecision(db, {
        userId: auth.user.id,
        spaceId: entity.space_id,
        subObjectiveId: entity.parent_sub_objective_id ?? null,
        proposalId: entityId,
        action: "score",
        batchIntent: null,
        metadata: {
          entity_type: "feature",
          entity_id: entityId,
          entity_name: entity.name,
          evaluation_method: "rubric",
          variation_count: rubricEnvelope.variation_scores.length,
          top_score: topScore,
          // Phase 11.2 — proxy-indicator breakdown for the notebook.
          // Top 3 by average score across variations + lowest proxy
          // confidence so the row can flag "shaky proxy" when low.
          indicator_breakdown: indicatorBreakdown,
          indicator_count: indicatorAgg.size,
        },
      });
    }

    return NextResponse.json(rubricEnvelope);
  }

  // ── ENSEMBLE PATH (Phase 11.3 — Tier 3: multi-lens + REML τ²) ──
  // The most rigorous evaluation tier short of a real experiment:
  //   • ONE LLM call grades each variation × indicator from 5 lenses
  //   • Variance across lenses = disagreement signal
  //   • Goodhart risk + Prentice mediation classification per indicator
  //   • Counter-indicator (yang/yin pairing) per outcome
  //   • REML τ² pools per-indicator confidence across variations →
  //     surfaces heterogeneity as an envelope-level signal
  if (method === "ensemble") {
    const existing = entity.expanded_detail as ExpandedItemDetail | null;
    if (
      !existing ||
      !Array.isArray(existing.variations) ||
      existing.variations.length === 0
    ) {
      return NextResponse.json(
        {
          evaluation_method: "ensemble",
          variation_scores: [],
          counter_indicators: [],
          status: "no_variations",
          status_detail:
            "Feature has no variations to score yet — expand the item drawer first.",
          scored_at: new Date().toISOString(),
        },
        { status: 200 },
      );
    }

    // Reuse the rubric path's context-loading pattern. Sub-objective
    // title + core objective text + room pains/outcomes + outcome
    // indicators all required for the ensemble prompt.
    let subObjectiveTitle = "";
    let coreObjectiveText: string =
      (typeof space.description === "string" && space.description.trim()) ||
      (typeof space.input_text === "string" && space.input_text.trim()) ||
      "";
    if (entity.parent_sub_objective_id) {
      const { data: sub } = await db
        .from("improvement_goals")
        .select("title, parent_goal_id")
        .eq("id", entity.parent_sub_objective_id)
        .maybeSingle();
      if (sub) {
        subObjectiveTitle =
          typeof sub.title === "string" ? sub.title : "";
        if (sub.parent_goal_id) {
          const { data: parent } = await db
            .from("improvement_goals")
            .select("title, description")
            .eq("id", sub.parent_goal_id)
            .maybeSingle();
          if (parent?.description) coreObjectiveText = parent.description;
          else if (parent?.title) coreObjectiveText = parent.title;
        }
      }
    }
    const { data: laneRows } = entity.parent_sub_objective_id
      ? await db
          .from("entities")
          .select("id, name, entity_type, causal_chain")
          .eq("parent_sub_objective_id", entity.parent_sub_objective_id)
          .in("entity_type", ["pain_point", "outcome"])
      : { data: [] };
    const lanes = (laneRows ?? []) as Array<{
      id: string;
      name: string;
      entity_type: string;
      causal_chain: Record<string, unknown> | null;
    }>;
    const roomPains = lanes
      .filter((r) => r.entity_type === "pain_point")
      .map((p) => ({
        name: p.name,
        negative_outcome:
          typeof p.causal_chain?.negative_outcome === "string"
            ? (p.causal_chain.negative_outcome as string)
            : undefined,
      }));
    const roomOutcomes = lanes
      .filter((r) => r.entity_type === "outcome")
      .map((o) => ({
        id: o.id,
        name: o.name,
        indicators: Array.isArray(o.causal_chain?.indicators)
          ? (o.causal_chain.indicators as unknown[])
              .filter((x): x is string => typeof x === "string" && x.length > 0)
              .slice(0, 6)
          : [],
        // Phase 11.6 — pass user-set baselines through to the scorer
        // so the rubric and ensemble prompts can ground scores in
        // measurable movement from baseline. Undefined for outcomes
        // that haven't had baselines set; the scorers tolerate
        // undefined cleanly (fall back to abstract scoring).
        indicator_baselines:
          (o.causal_chain?.indicator_baselines as
            | Record<
                string,
                {
                  baseline_value?: string;
                  target_value?: string;
                  unit?: string;
                  measurement_method?: string;
                  source?: "user" | "llm";
                }
              >
            | undefined) ?? undefined,
      }));
    const constraints = readConstraints(space.synthesis_data);

    const featureCausalChain =
      (entity.causal_chain as Record<string, unknown> | null) ?? {};
    const featurePositiveOutcome =
      typeof featureCausalChain.positive_outcome === "string"
        ? (featureCausalChain.positive_outcome as string)
        : undefined;
    const featureFirstPrinciples = Array.isArray(
      featureCausalChain.first_principles,
    )
      ? (featureCausalChain.first_principles as unknown[])
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .slice(0, 6)
      : undefined;

    let ensembleEnvelope: EnsembleScoreEnvelope;
    try {
      ensembleEnvelope = await scoreVariationsWithEnsemble({
        feature: {
          name: entity.name,
          positive_outcome: featurePositiveOutcome,
          first_principles: featureFirstPrinciples,
        },
        room_pains: roomPains,
        room_outcomes: roomOutcomes,
        sub_objective_title: subObjectiveTitle,
        core_objective_text: coreObjectiveText,
        constraints,
        variations: existing.variations,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: "ensemble scoring failed",
          detail: sanitizeErrorMessage(err),
        },
        { status: 500 },
      );
    }

    // ── REML τ² pool across variations per indicator ──
    // Group ensemble's per-(variation, indicator) rows by
    // (outcome_id, indicator_text), then poolEnsembleIndicators runs
    // DerSimonian-Laird-with-REML-iteration over the per-variation
    // confidence point estimates, using disagreement_confidence as
    // the within-variation standard error.
    const poolGroups = new Map<
      string,
      {
        indicator_text: string;
        outcome_id: string;
        outcome_name: string;
        rows: Array<{
          variation_id: string;
          confidence: number;
          disagreement_confidence: number;
        }>;
      }
    >();
    for (const v of ensembleEnvelope.variation_scores) {
      for (const ind of v.indicator_scores) {
        const key = `${ind.outcome_id}::${ind.indicator_text}`;
        const cell = poolGroups.get(key) ?? {
          indicator_text: ind.indicator_text,
          outcome_id: ind.outcome_id,
          outcome_name: ind.outcome_name,
          rows: [],
        };
        cell.rows.push({
          variation_id: v.variation_id,
          confidence: ind.consensus_confidence,
          disagreement_confidence: ind.disagreement_confidence,
        });
        poolGroups.set(key, cell);
      }
    }
    const indicatorPool = poolEnsembleIndicators(
      Array.from(poolGroups.values()),
    );

    // ── Phase 11.5 — Multi-target MC overlay ──
    // After ensemble produces per-indicator confidence grades, run
    // the existing MC simulator (scoreVariationsForFeature) on the
    // same feature. When MC succeeds (target_pain reachable, no
    // diagnostic), compose per-indicator lift bands as
    //   outcome_lift × consensus_confidence
    // The consensus_confidence is our proxy for the Prentice
    // proportion-explained — treating it as the fraction of the
    // outcome's variance the indicator captures. Each indicator
    // ends up with a defensible lift distribution {p10, p50, p90}
    // rather than ensemble's qualitative grade alone. Soft-fail:
    // if MC has issues we just skip the overlay (indicator_scores
    // still carry the ensemble grades + lens data).
    let mcOverlay: ReturnType<typeof indexOverlays> | null = null;
    try {
      const mcEnvelope = await scoreVariationsForFeature(db, {
        spaceId: entity.space_id,
        featureEntityId: entityId,
        parentSubObjectiveId: entity.parent_sub_objective_id ?? null,
      });
      // Build a flat indicator list across all variations so we
      // can compose once per indicator (consensus_confidence is
      // already aggregated). We use the first occurrence's
      // confidence — they're all the same indicator per (variation,
      // indicator) cell so we group by composite key.
      const allIndicators = new Map<
        string,
        { indicator_text: string; outcome_id: string; confidence: number }
      >();
      for (const v of ensembleEnvelope.variation_scores) {
        for (const ind of v.indicator_scores) {
          const key = `${ind.outcome_id}::${ind.indicator_text}::${v.variation_id}`;
          allIndicators.set(key, {
            indicator_text: ind.indicator_text,
            outcome_id: ind.outcome_id,
            confidence: ind.consensus_confidence,
          });
        }
      }
      const overlays = composeIndicatorLiftBands(
        {
          lift_pct: mcEnvelope.lift_pct,
          lift_band: mcEnvelope.lift_band,
          status: mcEnvelope.status,
        },
        Array.from(allIndicators.values()),
      );
      // Index by (variation_id, outcome_id, indicator_text) so we
      // can attach per-variation lift bands below. The compose call
      // already produced one overlay per row (each variation's
      // indicator gets its own lift_pct via its own confidence).
      const overlayByCompositeKey = new Map<
        string,
        (typeof overlays)[number]
      >();
      // Reconstruct the variation_id from allIndicators iteration order
      // (overlays come out in the same order they went in).
      let idx = 0;
      for (const v of ensembleEnvelope.variation_scores) {
        for (const ind of v.indicator_scores) {
          const overlay = overlays[idx++];
          if (overlay) {
            overlayByCompositeKey.set(
              `${v.variation_id}::${ind.outcome_id}::${ind.indicator_text}`,
              overlay,
            );
          }
        }
      }
      mcOverlay = overlayByCompositeKey as unknown as ReturnType<
        typeof indexOverlays
      >;
    } catch (mcErr) {
      console.warn(
        "[item/variation/score] MC overlay failed (non-fatal, ensemble persists without it):",
        mcErr instanceof Error ? mcErr.message : String(mcErr),
      );
    }

    // ── Phase 11.6 — Evidence tier overlay ──
    // Pool the available research sources (item-level detail_research
    // + space-level deep_research + surface_research), dedup by URL,
    // hand to the evidence scorer. ONE LLM call maps sources to
    // indicators with supports/refutes/contextual classification.
    // The result is keyed by indicator_text so we can lookup and
    // attach to the right indicator_score below. Soft-fail: when no
    // sources are available (most fresh spaces) the scorer returns
    // status="no_sources" and we proceed with ensemble + MC only.
    const evidenceByIndicator = new Map<
      string,
      {
        citations: Array<{
          source_idx: number;
          source_title: string;
          source_url: string;
          source_snippet: string;
          source_lens?: string;
          classification: "supports" | "refutes" | "contextual";
          relevance: number;
          argument: string;
        }>;
        evidence_support: number;
        supports_count: number;
        refutes_count: number;
        contextual_count: number;
      }
    >();
    try {
      const sourcePool = buildEvidenceSourcePool({
        item_research: entity.detail_research as
          | { sources?: Parameters<typeof buildEvidenceSourcePool>[0]["item_research"] extends infer T
              ? T extends { sources?: infer S }
                ? S
                : never
              : never }
          | null,
        deep_research: space.deep_research as
          | { all_sources?: Parameters<typeof buildEvidenceSourcePool>[0]["deep_research"] extends infer T
              ? T extends { all_sources?: infer S }
                ? S
                : never
              : never }
          | null,
        surface_research: space.surface_research as
          | { sources?: Parameters<typeof buildEvidenceSourcePool>[0]["surface_research"] extends infer T
              ? T extends { sources?: infer S }
                ? S
                : never
              : never }
          | null,
      });
      if (sourcePool.length > 0) {
        // Build a deduped indicator list (one per unique
        // (outcome_id, indicator_text)) so the LLM scores each
        // proxy once across all variations — they share the same
        // indicator-outcome link regardless of which variation.
        const uniqIndicators = new Map<
          string,
          { indicator_text: string; outcome_id: string; outcome_name: string }
        >();
        for (const v of ensembleEnvelope.variation_scores) {
          for (const ind of v.indicator_scores) {
            const key = `${ind.outcome_id}::${ind.indicator_text}`;
            if (!uniqIndicators.has(key)) {
              uniqIndicators.set(key, {
                indicator_text: ind.indicator_text,
                outcome_id: ind.outcome_id,
                outcome_name: ind.outcome_name,
              });
            }
          }
        }
        const evidenceEnvelope = await scoreIndicatorsWithEvidence({
          indicators: Array.from(uniqIndicators.values()),
          sources: sourcePool,
          feature_name: entity.name,
          sub_objective_title: subObjectiveTitle,
        });
        if (evidenceEnvelope.status === "ok") {
          for (const r of evidenceEnvelope.indicator_results) {
            evidenceByIndicator.set(
              `${r.outcome_id}::${r.indicator_text}`,
              {
                citations: r.citations,
                evidence_support: r.evidence_support,
                supports_count: r.supports_count,
                refutes_count: r.refutes_count,
                contextual_count: r.contextual_count,
              },
            );
          }
        }
      }
    } catch (evidenceErr) {
      console.warn(
        "[item/variation/score] evidence overlay failed (non-fatal):",
        evidenceErr instanceof Error
          ? evidenceErr.message
          : String(evidenceErr),
      );
    }

    // ── Phase 11.8 — HCD persona overlay ──
    // When hcd_mode=true on the space, every variation × indicator
    // gets graded from 3-5 persona perspectives in-character.
    // Personas are persisted on the sub-objective room so they stay
    // stable across scoring runs (cross-variation comparability
    // requires the same personas). Generated on first HCD-on scoring
    // run; cached for subsequent runs.
    //
    // Key keyed by (variation_id, outcome_id, indicator_text) so we
    // can attach per-variation persona scores below.
    const hcdMode =
      readObjectiveCanvasState(space.synthesis_data).hcd_mode === true;
    const personaByIndicatorKey = new Map<
      string,
      {
        persona_scores: Array<{
          persona_id: string;
          persona_name: string;
          score: number;
          matters: number;
          reason: string;
        }>;
        persona_consensus_score: number;
        persona_disagreement_score: number;
        persona_coverage_count: number;
        persona_coverage_total: number;
      }
    >();
    if (hcdMode && entity.parent_sub_objective_id) {
      try {
        // Load or generate personas. Stored on improvement_goals.
        // synthesis_data.hcd_personas as a stable array.
        const { data: subRow } = await db
          .from("improvement_goals")
          .select("synthesis_data")
          .eq("id", entity.parent_sub_objective_id)
          .maybeSingle();
        const existingPersonas: HCDPersona[] = Array.isArray(
          subRow?.synthesis_data?.hcd_personas,
        )
          ? (subRow.synthesis_data.hcd_personas as HCDPersona[])
          : [];
        let personas = existingPersonas;
        if (personas.length === 0) {
          // First HCD scoring run — generate + persist.
          const state = readObjectiveCanvasState(space.synthesis_data);
          const clarifyingAnswers: Array<{
            question: string;
            answer: string;
          }> = [];
          if (state.clarifying) {
            for (const q of state.clarifying.questions) {
              const a = state.clarifying.answers[q.id];
              if (a?.status === "answered" && a.value) {
                clarifyingAnswers.push({
                  question: q.question,
                  answer: a.value,
                });
              }
            }
          }
          personas = await generateHCDPersonas({
            sub_objective_title: subObjectiveTitle,
            core_objective_text: coreObjectiveText,
            room_pains: roomPains,
            clarifying_answers: clarifyingAnswers,
          });
          if (personas.length > 0) {
            const nextSynth = {
              ...((subRow?.synthesis_data as Record<string, unknown>) ?? {}),
              hcd_personas: personas,
            };
            await db
              .from("improvement_goals")
              .update({ synthesis_data: nextSynth })
              .eq("id", entity.parent_sub_objective_id);
          }
        }

        // Score with personas when we have them + indicators.
        if (personas.length > 0) {
          const uniqIndicators = new Map<
            string,
            { indicator_text: string; outcome_id: string; outcome_name: string }
          >();
          for (const v of ensembleEnvelope.variation_scores) {
            for (const ind of v.indicator_scores) {
              const key = `${ind.outcome_id}::${ind.indicator_text}`;
              if (!uniqIndicators.has(key)) {
                uniqIndicators.set(key, {
                  indicator_text: ind.indicator_text,
                  outcome_id: ind.outcome_id,
                  outcome_name: ind.outcome_name,
                });
              }
            }
          }
          const personaEnvelope = await scoreIndicatorsWithPersonas({
            personas,
            variations: existing.variations,
            indicators: Array.from(uniqIndicators.values()),
            feature_name: entity.name,
            sub_objective_title: subObjectiveTitle,
          });
          if (personaEnvelope.status === "ok") {
            for (const r of personaEnvelope.results) {
              personaByIndicatorKey.set(
                `${r.variation_id}::${r.outcome_id}::${r.indicator_text}`,
                {
                  persona_scores: r.persona_scores,
                  persona_consensus_score: r.persona_consensus_score,
                  persona_disagreement_score: r.persona_disagreement_score,
                  persona_coverage_count: r.persona_coverage_count,
                  persona_coverage_total: r.persona_coverage_total,
                },
              );
            }
          }
        }
      } catch (personaErr) {
        console.warn(
          "[item/variation/score] HCD persona overlay failed (non-fatal):",
          personaErr instanceof Error
            ? personaErr.message
            : String(personaErr),
        );
      }
    }

    // ── Persist: per-variation lens-rich indicator_scores + envelope
    //    with counter_indicators + indicator_pool. Soft-fail on write. ──
    const ensembleScoreById = new Map(
      ensembleEnvelope.variation_scores.map((s) => [s.variation_id, s] as const),
    );
    const updatedVariations = existing.variations.map((v) => {
      const s = v.id ? ensembleScoreById.get(v.id) : undefined;
      if (!s) return v;
      // Translate ensemble's richer shape into the persisted indicator_scores
      // shape (consensus_score → score, consensus_confidence → confidence,
      // plus optional lens_scores / disagreement / mediation / goodhart).
      return {
        ...v,
        effectiveness_score: s.composite_score,
        evaluation_method: "ensemble" as const,
        indicator_scores: s.indicator_scores.map((ind) => {
          // Phase 11.5 — attach MC-scaled lift_band when the overlay
          // produced one for THIS (variation, indicator) cell.
          const overlay = mcOverlay
            ? (mcOverlay as unknown as Map<
                string,
                {
                  lift_pct: number;
                  lift_band: { p10: number; p50: number; p90: number };
                  lift_band_method: "mc_scaled";
                }
              >).get(`${v.id}::${ind.outcome_id}::${ind.indicator_text}`)
            : undefined;
          // Phase 11.6 — attach evidence citations + strength for
          // this indicator (keyed by outcome_id + indicator_text;
          // shared across all variations since the proxy-outcome
          // link is the same regardless of variation).
          const evidence = evidenceByIndicator.get(
            `${ind.outcome_id}::${ind.indicator_text}`,
          );
          // `confidence` is the RAW proxy-validity confidence the
          // ensemble emitted (consensus_confidence). We no longer
          // overwrite it — that made the persisted value match no
          // scorer + diverge from the rubric (whose confidence is also
          // raw) and from the REML pool (which already uses the raw
          // consensus). The evidence-adjusted blend is stored ALONGSIDE
          // as evidence_weighted_confidence so the UI can render either
          // without the two silently colliding.
          const evidenceWeightedConf = evidence
            ? Math.max(
                0,
                Math.min(
                  1,
                  ind.consensus_confidence * (evidence.evidence_support * 2),
                ),
              )
            : ind.consensus_confidence;
          return {
            indicator_text: ind.indicator_text,
            outcome_id: ind.outcome_id,
            outcome_name: ind.outcome_name,
            score: ind.consensus_score,
            reason:
              ind.lens_scores.length > 0
                ? `${ind.lens_scores[0].lens}: ${ind.lens_scores[0].reason}`
                : "",
            confidence: ind.consensus_confidence,
            lens_scores: ind.lens_scores,
            disagreement_score: ind.disagreement_score,
            disagreement_confidence: ind.disagreement_confidence,
            lens_agreement_count: ind.lens_agreement_count,
            mediation_check: ind.mediation_check,
            goodhart_risk: ind.goodhart_risk,
            // Phase 11.5 — per-indicator MC overlay fields.
            ...(overlay
              ? {
                  lift_pct: overlay.lift_pct,
                  lift_band: overlay.lift_band,
                  lift_band_method: overlay.lift_band_method,
                }
              : {}),
            // Phase 11.6 — evidence overlay fields.
            ...(evidence
              ? {
                  evidence_citations: evidence.citations,
                  evidence_support: evidence.evidence_support,
                  evidence_supports: evidence.supports_count,
                  evidence_refutes: evidence.refutes_count,
                  evidence_contextual: evidence.contextual_count,
                  // Derived blend (consensus × evidence) kept SEPARATE
                  // from the raw `confidence` above — no silent overwrite.
                  evidence_weighted_confidence: evidenceWeightedConf,
                }
              : {}),
            // Phase 11.8 — HCD persona overlay fields. Keyed per
            // (variation × indicator) so each variation's persona
            // grades get attached to the right row.
            ...((() => {
              const personaCell = personaByIndicatorKey.get(
                `${v.id}::${ind.outcome_id}::${ind.indicator_text}`,
              );
              return personaCell
                ? {
                    persona_scores: personaCell.persona_scores,
                    persona_consensus_score:
                      personaCell.persona_consensus_score,
                    persona_disagreement_score:
                      personaCell.persona_disagreement_score,
                    persona_coverage_count: personaCell.persona_coverage_count,
                    persona_coverage_total: personaCell.persona_coverage_total,
                  }
                : {};
            })()),
          };
        }),
      };
    });
    const nextDetail: ExpandedItemDetail = {
      ...existing,
      variations: updatedVariations,
      effectiveness_envelope: {
        evaluation_method: "ensemble",
        target_entity_id: null,
        target_entity_name: null,
        target_edge_strength: null,
        lift_pct: null,
        lift_band: null,
        placebo_verdict: null,
        placebo_ratio: null,
        status: ensembleEnvelope.status,
        status_detail: ensembleEnvelope.status_detail,
        scored_at: ensembleEnvelope.scored_at,
        // Phase 11.3 — additional envelope fields. These live on the
        // canonical envelope JSONB; readers branch on
        // evaluation_method to surface them.
        counter_indicators: ensembleEnvelope.counter_indicators,
        indicator_pool: indicatorPool,
      } as ExpandedItemDetail["effectiveness_envelope"],
    };
    const writeRes = await db
      .from("entities")
      .update({ expanded_detail: nextDetail })
      .eq("id", entityId);
    if (writeRes.error) {
      console.warn(
        "[item/variation/score] ensemble persist failed (non-fatal):",
        writeRes.error.message,
      );
    }

    // Log the ensemble run to the notebook. The chip strip in
    // MetadataChips renders evaluation_method="ensemble" with the
    // pooled τ² + counter-indicator + top-3 indicator breakdown.
    if (ensembleEnvelope.status === "ok") {
      const topScore = ensembleEnvelope.variation_scores.reduce(
        (max, s) => (s.composite_score > max ? s.composite_score : max),
        0,
      );

      // Top 3 indicators by avg lens-consensus score across variations,
      // plus the worst (highest) τ² seen so the notebook can flag
      // "this run had inconsistent indicator grading across variations."
      const indicatorBreakdown = indicatorPool
        .map((p) => ({
          indicator: p.indicator_text,
          avg_score:
            ensembleEnvelope.variation_scores.reduce((sum, v) => {
              const match = v.indicator_scores.find(
                (i) =>
                  i.indicator_text === p.indicator_text &&
                  i.outcome_id === p.outcome_id,
              );
              return sum + (match?.consensus_score ?? 0);
            }, 0) / Math.max(1, p.n_variations),
          min_confidence: p.pooled_confidence,
          outcome_name: p.outcome_name,
          tau_squared: p.tau_squared,
        }))
        .sort((a, b) => b.avg_score - a.avg_score)
        .slice(0, 3);
      const maxTauSquared = indicatorPool.reduce(
        (max, p) => (p.tau_squared > max ? p.tau_squared : max),
        0,
      );
      const meanLensConsensus =
        ensembleEnvelope.variation_scores
          .flatMap((v) => v.indicator_scores)
          .reduce(
            (acc, i) => {
              acc.sum += i.lens_agreement_count;
              acc.count += 1;
              return acc;
            },
            { sum: 0, count: 0 },
          );
      const lensAgreementAvg =
        meanLensConsensus.count > 0
          ? meanLensConsensus.sum / meanLensConsensus.count
          : 0;

      void logDecision(db, {
        userId: auth.user.id,
        spaceId: entity.space_id,
        subObjectiveId: entity.parent_sub_objective_id ?? null,
        proposalId: entityId,
        action: "score",
        batchIntent: null,
        metadata: {
          entity_type: "feature",
          entity_id: entityId,
          entity_name: entity.name,
          evaluation_method: "ensemble",
          variation_count: ensembleEnvelope.variation_scores.length,
          top_score: topScore,
          indicator_breakdown: indicatorBreakdown,
          indicator_count: poolGroups.size,
          // Phase 11.3 ensemble-specific surface signals.
          lens_agreement_avg: lensAgreementAvg, // 0..5
          tau_squared_max: maxTauSquared,
          counter_indicator_count: ensembleEnvelope.counter_indicators.length,
        },
      });
    }

    return NextResponse.json(ensembleEnvelope);
  }

  // ── SIMULATION PATH (Phase 4, on-demand only after 11.1) ──
  // Falls through to the original MC + placebo engine when the
  // caller explicitly requests method="simulation".

  let envelope: Awaited<ReturnType<typeof scoreVariationsForFeature>>;
  try {
    envelope = await scoreVariationsForFeature(db, {
      spaceId: entity.space_id,
      featureEntityId: entityId,
      parentSubObjectiveId: entity.parent_sub_objective_id ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "scoring failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  // ── Phase 4c — persist envelope + per-variation scores ──
  // Atomic merge: spread existing expanded_detail, override the
  // variations array with effectiveness_score patched in by id,
  // attach the envelope-level shared signals. Same {...existing,
  // ...patch} pattern as the disposition + compose routes.
  //
  // Soft-fail: a persist hiccup doesn't bury the score the client
  // already has — log + return the envelope regardless.
  const existing = entity.expanded_detail as ExpandedItemDetail | null;
  if (existing && Array.isArray(existing.variations)) {
    // Build a quick id → score lookup so the variations merge stays
    // O(N) rather than O(N²) for many variations.
    const scoreById = new Map<string, number>();
    for (const s of envelope.variation_scores) {
      scoreById.set(s.variation_id, s.effectiveness_score);
    }
    const updatedVariations = existing.variations.map((v) => {
      const newScore =
        envelope.status === "ok" && v.id ? scoreById.get(v.id) : undefined;
      // When the envelope is non-ok (no_target, lever_unreachable, etc.)
      // we DON'T strip the prior score — let the user see what was
      // computed last time and surface the diagnostic banner instead.
      // Only the OK path updates the per-row score.
      return newScore !== undefined
        ? { ...v, effectiveness_score: newScore }
        : v;
    });
    // Phase 11.1 — also stamp evaluation_method="simulation" on each
    // updated variation so the UI can surface the method badge. This
    // is purely metadata — the score number itself is identical to
    // what the MC scorer always returned.
    const updatedWithMethod = updatedVariations.map((v) => {
      const wasUpdated = v.id ? scoreById.has(v.id) : false;
      return wasUpdated
        ? { ...v, evaluation_method: "simulation" as const }
        : v;
    });
    const nextDetail: ExpandedItemDetail = {
      ...existing,
      variations: updatedWithMethod,
      effectiveness_envelope: {
        evaluation_method: "simulation",
        target_entity_id: envelope.target_entity_id,
        target_entity_name: envelope.target_entity_name,
        target_edge_strength: envelope.target_edge_strength,
        lift_pct: envelope.lift_pct,
        lift_band: envelope.lift_band,
        placebo_verdict: envelope.placebo_verdict,
        placebo_ratio: envelope.placebo_ratio,
        status: envelope.status,
        status_detail: envelope.status_detail,
        scored_at: new Date().toISOString(),
      },
    };
    const writeRes = await db
      .from("entities")
      .update({ expanded_detail: nextDetail })
      .eq("id", entityId);
    if (writeRes.error) {
      console.warn(
        "[item/variation/score] persist failed (non-fatal):",
        writeRes.error.message,
      );
    }
  }

  // Phase 9 — log the scoring run to the Lab Notebook so the timeline
  // shows which mechanisms got scored when, with their lift + placebo
  // verdict. Only log OK runs — diagnostic-status runs (no_target /
  // lever_unreachable) aren't user-facing events worth surfacing.
  if (envelope.status === "ok") {
    const topScore = envelope.variation_scores.reduce(
      (max, s) => (s.effectiveness_score > max ? s.effectiveness_score : max),
      0,
    );
    void logDecision(db, {
      userId: auth.user.id,
      spaceId: entity.space_id,
      subObjectiveId: entity.parent_sub_objective_id ?? null,
      proposalId: entityId,
      action: "score",
      batchIntent: null,
      metadata: {
        entity_type: "feature",
        entity_id: entityId,
        entity_name: envelope.lever_entity_name,
        evaluation_method: "simulation",
        target_pain_id: envelope.target_entity_id,
        target_pain_name: envelope.target_entity_name,
        lift_pct: envelope.lift_pct,
        placebo_verdict: envelope.placebo_verdict,
        placebo_ratio: envelope.placebo_ratio,
        variation_count: envelope.variation_scores.length,
        top_score: topScore,
      },
    });
  }

  return NextResponse.json(envelope);
}
