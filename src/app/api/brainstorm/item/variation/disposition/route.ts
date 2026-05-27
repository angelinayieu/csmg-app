// ── PATCH /api/brainstorm/item/variation/disposition ──────────────
//
// Updates a single variation's disposition (elected/rejected/
// deferred/null) on entities.expanded_detail. Also INVALIDATES any
// cached composed_design when the set of elected ids changes — the
// next read calls /compose to refresh.
//
// Body: { entityId, variationId, disposition: "elected" | "rejected" | "deferred" | null }
//
// Returns: { variations, composed_design_invalidated }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type {
  ExpandedItemDetail,
  ItemVariation,
  VariationDisposition,
} from "@/lib/objective-canvas/expand-item-detail";
import {
  logDecision,
  type DecisionAction,
} from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface Body {
  entityId?: string;
  variationId?: string;
  disposition?: VariationDisposition;
}

const ALLOWED: ReadonlyArray<VariationDisposition> = [
  "elected",
  "rejected",
  "deferred",
  null,
];

export async function PATCH(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  const variationId =
    typeof body?.variationId === "string" ? body.variationId : "";
  if (!entityId || !variationId) {
    return NextResponse.json(
      { error: "entityId + variationId required" },
      { status: 400 },
    );
  }
  const disposition =
    body?.disposition === null || ALLOWED.includes(body?.disposition ?? null)
      ? (body?.disposition ?? null)
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

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
    .select("user_id")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const existing = entity.expanded_detail as ExpandedItemDetail | null;
  if (!existing || !Array.isArray(existing.variations)) {
    return NextResponse.json(
      { error: "no expanded_detail to update" },
      { status: 409 },
    );
  }

  // Find the target variation BEFORE mutation so we can log its
  // prior disposition + capture metadata for the decision log.
  const targetVariation = existing.variations.find((v) => v.id === variationId);
  const priorDisposition: VariationDisposition =
    targetVariation?.disposition ?? null;

  // Apply the disposition + detect election-set change so we can
  // invalidate the composed_design cache when the user toggles.
  const priorElectedIds = new Set(
    existing.variations.filter((v) => v.disposition === "elected").map((v) => v.id),
  );
  const updatedVariations: ItemVariation[] = existing.variations.map((v) =>
    v.id === variationId ? { ...v, disposition } : v,
  );
  const newElectedIds = new Set(
    updatedVariations.filter((v) => v.disposition === "elected").map((v) => v.id),
  );
  const electionSetChanged =
    priorElectedIds.size !== newElectedIds.size ||
    [...priorElectedIds].some((id) => !newElectedIds.has(id));

  const next: ExpandedItemDetail = {
    ...existing,
    variations: updatedVariations,
    composed_design: electionSetChanged ? null : existing.composed_design,
  };

  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: next })
    .eq("id", entityId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  // ── Polish-3: log the item-level variation disposition to the
  //    decision_log. Same telemetry surface as sub-objective
  //    dispositions, distinguished by metadata.entity_type so future
  //    analyses can filter (or aggregate) item-level vs.
  //    sub-objective-level signal. Required-by-schema fields:
  //      action — mapped from disposition
  //      proposal_id — the variation id (the canonical "thing
  //        being dispositioned"; sub_objective_decisions doesn't
  //        constrain its semantic to sub-obj proposal ids)
  //      batch_intent — null at item-variation level (variations
  //        carry `kind`, not `intent`; we surface kind in metadata
  //        instead) ──
  const action: DecisionAction =
    disposition === "elected"
      ? "elect"
      : disposition === "rejected"
        ? "reject"
        : disposition === "deferred"
          ? "defer"
          : "clear";
  void logDecision(db, {
    userId: auth.user.id,
    spaceId: entity.space_id,
    // Phase 9 — thread sub_objective_id so the Lab Notebook can
    // scope its timeline to ONE room. Kept null-safe for entities
    // that aren't in a room (rare).
    subObjectiveId: entity.parent_sub_objective_id ?? null,
    proposalId: variationId,
    action,
    // Variations live in `kind` not `intent` so the batch_intent
    // enum doesn't apply; null keeps the column honest. Filter by
    // metadata.entity_type when querying.
    batchIntent: null,
    metadata: {
      entity_type: "variation",
      entity_id: entityId,
      parent_sub_objective_id: entity.parent_sub_objective_id ?? null,
      variation_kind: targetVariation?.kind ?? null,
      variation_name: targetVariation?.name ?? null,
      prior_disposition: priorDisposition,
      composed_design_invalidated: electionSetChanged,
    },
  });

  return NextResponse.json({
    variations: updatedVariations,
    composed_design_invalidated: electionSetChanged,
  });
}
