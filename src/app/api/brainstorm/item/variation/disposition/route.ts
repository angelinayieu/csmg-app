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
    .select("id, space_id, expanded_detail")
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

  return NextResponse.json({
    variations: updatedVariations,
    composed_design_invalidated: electionSetChanged,
  });
}
