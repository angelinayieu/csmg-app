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
   *  explicitly when warranted. */
  method?: "rubric" | "simulation";
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

  const method: "rubric" | "simulation" =
    body?.method === "simulation" ? "simulation" : "rubric";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load entity + ownership check (also load expanded_detail so
  //    we can persist scores back into it after MC runs). ──
  const { data: entity } = await db
    .from("entities")
    .select("id, name, space_id, parent_sub_objective_id, expanded_detail")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
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
    const roomOutcomes = lanes
      .filter((r) => r.entity_type === "outcome")
      .map((o) => ({ name: o.name }));
    const constraints = readConstraints(space.synthesis_data);

    // Score against the rubric.
    const featureCausal = (entity.expanded_detail as ExpandedItemDetail | null)
      ?.definition;
    let rubricEnvelope: Awaited<
      ReturnType<typeof scoreVariationsWithRubric>
    >;
    try {
      rubricEnvelope = await scoreVariationsWithRubric({
        feature: {
          name: entity.name,
          positive_outcome: featureCausal ?? undefined,
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
    const updatedVariations = existing.variations.map((v) => {
      const s = v.id ? scoreById.get(v.id) : undefined;
      return s
        ? {
            ...v,
            effectiveness_score: s.composite_score,
            evaluation_method: "rubric" as const,
            rubric_criteria: s.criteria,
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
        },
      });
    }

    return NextResponse.json(rubricEnvelope);
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
