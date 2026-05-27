// ── POST /api/brainstorm/item/variation/mockup ────────────────────
//
// Phase 12 — generate a static HTML mockup of a variation's
// interface. Persists on
// entities.expanded_detail.variations[i].mockup_html, idempotent
// (cache hit returns the existing mockup; mode=force regenerates).
//
// Body: { entityId, variationId, mode?: "default" | "force" }
//
// Returns: { mockup_html, mockup_generated_at, title }
//
// Security: the LLM output goes through sanitizeHtml() to strip
// <script> tags, event handlers, and dangerous tags. The client
// renders it in an iframe with sandbox="" so even residual hostile
// content can't execute. Belt + suspenders.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";
import { generateVariationMockup } from "@/lib/objective-canvas/generate-mockup";
import { readConstraints } from "@/lib/objective-canvas/constraints";

export const runtime = "nodejs";
export const maxDuration = 45;

interface Body {
  entityId?: string;
  variationId?: string;
  mode?: "default" | "force";
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  const variationId =
    typeof body?.variationId === "string" ? body.variationId : "";
  const force = body?.mode === "force";
  if (!entityId || !variationId) {
    return NextResponse.json(
      { error: "entityId + variationId required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Load entity + ownership.
  const { data: entity } = await db
    .from("entities")
    .select(
      "id, name, space_id, parent_sub_objective_id, causal_chain, expanded_detail",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const detail = (entity.expanded_detail as ExpandedItemDetail | null) ?? null;
  if (!detail || !Array.isArray(detail.variations)) {
    return NextResponse.json(
      { error: "entity has no expanded_detail.variations" },
      { status: 409 },
    );
  }
  const variation = detail.variations.find((v) => v.id === variationId);
  if (!variation) {
    return NextResponse.json(
      { error: "variation not found on this entity" },
      { status: 404 },
    );
  }

  // Cache hit — skip the LLM unless forced.
  if (!force && typeof variation.mockup_html === "string" && variation.mockup_html.length > 0) {
    return NextResponse.json({
      cached: true,
      mockup_html: variation.mockup_html,
      mockup_generated_at: variation.mockup_generated_at ?? null,
    });
  }

  // Optional context: room title + first pain text. Cheap lookups
  // wrapped in try/catch so a missing parent doesn't kill the gen.
  let roomTitle: string | null = null;
  let painText: string | null = null;
  try {
    if (entity.parent_sub_objective_id) {
      const { data: sub } = await db
        .from("improvement_goals")
        .select("title, top_negative_outcome")
        .eq("id", entity.parent_sub_objective_id)
        .maybeSingle();
      if (sub) {
        roomTitle = typeof sub.title === "string" ? sub.title : null;
        painText = typeof sub.top_negative_outcome === "string"
          ? sub.top_negative_outcome
          : null;
      }
    }
  } catch {
    // Soft-fail — context lookups are best-effort.
  }

  let mockup;
  try {
    mockup = await generateVariationMockup({
      variation,
      entityName: typeof entity.name === "string" ? entity.name : "(unknown)",
      painText,
      roomTitle,
      constraints: readConstraints(space.synthesis_data),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "mockup generation failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  // Persist.
  const generatedAt = new Date().toISOString();
  const nextVariations = detail.variations.map((v) =>
    v.id === variationId
      ? {
          ...v,
          mockup_html: mockup.html,
          mockup_generated_at: generatedAt,
        }
      : v,
  );
  const nextDetail: ExpandedItemDetail = {
    ...detail,
    variations: nextVariations,
  };
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    mockup_html: mockup.html,
    mockup_generated_at: generatedAt,
    title: mockup.title,
  });
}
