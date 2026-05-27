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
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  entityId?: string;
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

  const db = auth.supabase as any;

  // ── Load entity + ownership check (also load expanded_detail so
  //    we can persist scores back into it after MC runs). ──
  const { data: entity } = await db
    .from("entities")
    .select("id, space_id, parent_sub_objective_id, expanded_detail")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── Run the scoring engine ──
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
    const nextDetail: ExpandedItemDetail = {
      ...existing,
      variations: updatedVariations,
      effectiveness_envelope: {
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

  return NextResponse.json(envelope);
}
