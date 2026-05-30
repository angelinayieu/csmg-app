// ── POST /api/brainstorm/item/variation/description-doc ───────────
//
// Op A — generate a PR/FAQ-style description doc for a variation.
// Idempotent (cache hit returns existing; mode=force regenerates).
// Refine flag enables a critic+rewrite pass (+1 LLM call).
//
// Body: { entityId, variationId, refine?: boolean, mode?: "default"|"force" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";
import { generateVariationDescriptionDoc } from "@/lib/objective-canvas/generate-description-doc";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  entityId?: string;
  variationId?: string;
  refine?: boolean;
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
  const refine = body?.refine === true;
  const force = body?.mode === "force";
  if (!entityId || !variationId) {
    return NextResponse.json(
      { error: "entityId + variationId required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

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

  // Cache hit short-circuit.
  if (!force && typeof variation.description_doc === "string" && variation.description_doc.length > 0) {
    return NextResponse.json({
      cached: true,
      description_doc: variation.description_doc,
      description_doc_generated_at: variation.description_doc_generated_at ?? null,
    });
  }

  // Resolve objective text + sibling elections for composition framing.
  const objectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "(no objective text)";
  const siblingElections = detail.variations
    .filter((v) => v.id !== variationId && v.disposition === "elected")
    .slice(0, 4)
    .map((v) => ({ name: v.name, description: v.description }));

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
        painText = typeof sub.top_negative_outcome === "string" ? sub.top_negative_outcome : null;
      }
    }
  } catch {
    // Soft-fail.
  }

  let result;
  try {
    result = await generateVariationDescriptionDoc({
      variation,
      entityName: typeof entity.name === "string" ? entity.name : "(unknown)",
      objectiveText,
      roomTitle,
      painText,
      constraints: readConstraints(space.synthesis_data),
      siblingElections: siblingElections.length > 0 ? siblingElections : undefined,
      // Arc 3.5+ — ground the doc's technical sections in the feature's
      // v2 mechanism spec when one exists (reuse, not parallel content).
      mechanismSpec: detail.mechanism_spec ?? null,
      refine,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "description-doc generation failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  const generatedAt = new Date().toISOString();
  const nextVariations = detail.variations.map((v) =>
    v.id === variationId
      ? {
          ...v,
          description_doc: result.doc,
          description_doc_generated_at: generatedAt,
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

  // Notebook visibility — only the fresh-gen path (cache hits silent).
  void logDecision(db, {
    userId: auth.user.id,
    spaceId: entity.space_id,
    subObjectiveId:
      typeof entity.parent_sub_objective_id === "string"
        ? entity.parent_sub_objective_id
        : null,
    proposalId: entityId,
    action: "deliverable_generated",
    metadata: {
      deliverable_subtype: "description_doc",
      entity_id: entityId,
      entity_name: typeof entity.name === "string" ? entity.name : null,
      variation_id: variationId,
      variation_name:
        typeof variation.name === "string" ? variation.name : null,
      refined: refine === true,
    },
  });

  return NextResponse.json({
    description_doc: result.doc,
    description_doc_generated_at: generatedAt,
  });
}
