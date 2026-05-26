// ── POST /api/brainstorm/item/variation/score ────────────────────
//
// Phase 4a — Mechanism Effectiveness Scoring (engine wire-up).
//
// Computes a deterministic 0..1 effectiveness score per variation
// on a FEATURE card by:
//   1. Resolving the feature → linked pain entity (highest-strength
//      edge target/source)
//   2. Running simulateVariantLift on (lever=feature, target=pain)
//   3. Running computePlaceboRefutation for specificity
//   4. Composing per-variation scores using the variation's
//      LLM-rated addresses_pain
//
// Body: { entityId }    — the feature entity (NOT a variation id)
//
// Returns the full VariationScoreEnvelope including diagnostic
// status when scoring isn't possible (lever unreachable, no target
// pain, etc.). Soft-fails so the UI can surface "scoring unavailable"
// instead of an error overlay.
//
// Performance: ~1-3s typical (Monte Carlo × 2 baseline+variant ×
// real+placebo). Caller should trigger on-demand, NOT auto-fire on
// every drawer open.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { scoreVariationsForFeature } from "@/lib/objective-canvas/score-variation-effectiveness";

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

  // ── Load entity + ownership check ──
  const { data: entity } = await db
    .from("entities")
    .select("id, space_id, parent_sub_objective_id")
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
  try {
    const envelope = await scoreVariationsForFeature(db, {
      spaceId: entity.space_id,
      featureEntityId: entityId,
      parentSubObjectiveId: entity.parent_sub_objective_id ?? null,
    });
    return NextResponse.json(envelope);
  } catch (err) {
    return NextResponse.json(
      {
        error: "scoring failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }
}
