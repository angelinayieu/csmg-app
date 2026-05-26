// ── POST /api/brainstorm/item/variation/prototype ─────────────────
//
// Generates a prototype brief for the (variation × open_question)
// pair under the user's operational constraints. Each open_question
// gets ONE brief — composing them loses the binary-outcome property.
//
// Body: { entityId, variationId, openQuestion, mode?: "default" | "force" }
//
// Cached on entities.expanded_detail.prototype_briefs[] keyed by id
// (deterministic from variation_id + question slug).

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";
import { generatePrototypeBrief } from "@/lib/objective-canvas/generate-prototype-brief";
import { readConstraints } from "@/lib/objective-canvas/constraints";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  entityId?: string;
  variationId?: string;
  openQuestion?: string;
  mode?: "default" | "force";
}

const LAYER_SLUGS = ["pain", "features", "outcomes", "objective"] as const;
type LayerSlug = (typeof LAYER_SLUGS)[number];

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  const variationId =
    typeof body?.variationId === "string" ? body.variationId : "";
  const openQuestion =
    typeof body?.openQuestion === "string" ? body.openQuestion.trim() : "";
  if (!entityId || !variationId || !openQuestion) {
    return NextResponse.json(
      { error: "entityId, variationId, and openQuestion are required" },
      { status: 400 },
    );
  }
  const force = body?.mode === "force";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: entity } = await db
    .from("entities")
    .select(
      "id, name, space_id, layer_ontology_id, parent_sub_objective_id, expanded_detail",
    )
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

  const detail = entity.expanded_detail as ExpandedItemDetail | null;
  if (!detail || !Array.isArray(detail.variations)) {
    return NextResponse.json(
      { error: "no expanded_detail — open the drawer first to expand" },
      { status: 409 },
    );
  }

  const variation = detail.variations.find((v) => v.id === variationId);
  if (!variation) {
    return NextResponse.json(
      { error: "variation not found in this entity's detail" },
      { status: 404 },
    );
  }

  // Idempotent short-circuit: same (variation_id, openQuestion) already cached.
  const existingBriefs = detail.prototype_briefs ?? [];
  const existingBrief = existingBriefs.find(
    (b) =>
      b.variation_id === variationId &&
      b.open_question === openQuestion,
  );
  if (!force && existingBrief) {
    return NextResponse.json({ brief: existingBrief, cached: true });
  }

  // Resolve layer + sub-objective + parent objective.
  let layer: LayerSlug = "features";
  if (entity.layer_ontology_id) {
    const { data: layerRow } = await db
      .from("layer_ontology")
      .select("slug")
      .eq("id", entity.layer_ontology_id)
      .maybeSingle();
    if (layerRow && typeof layerRow.slug === "string") {
      const slug = layerRow.slug as string;
      if ((LAYER_SLUGS as readonly string[]).includes(slug)) {
        layer = slug as LayerSlug;
      }
    }
  }

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
      subObjectiveTitle = typeof sub.title === "string" ? sub.title : "";
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

  // Polish-2 — pass the parent composition + sibling briefs into the
  // generator so the experiment can either fold a composition
  // conflict into its signal_to_watch, or avoid duplicating signal
  // another brief is already capturing.
  const composedDesignForCtx = detail.composed_design
    ? {
        description: detail.composed_design.description,
        conflicts_open: detail.composed_design.conflicts_open ?? [],
        conflicts_resolved: detail.composed_design.conflicts_resolved ?? [],
      }
    : null;
  const siblingBriefs = existingBriefs
    .filter((b) => b.id !== existingBrief?.id) // exclude the one we're regenerating
    .map((b) => ({
      variation_id: b.variation_id,
      open_question: b.open_question,
      signal_to_watch: b.signal_to_watch,
    }));

  let brief;
  try {
    brief = await generatePrototypeBrief({
      variation,
      open_question: openQuestion,
      itemName: entity.name,
      itemLayer: layer,
      constraints: readConstraints(space.synthesis_data),
      subObjectiveTitle,
      coreObjectiveText,
      composedDesign: composedDesignForCtx,
      siblingBriefs,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "brief generation failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  // Bag-style persistence: dedupe by id (deterministic from
  // variation_id + question slug), replace if force regenerated.
  const nextBriefs = existingBriefs.filter((b) => b.id !== brief.id);
  nextBriefs.push(brief);

  const nextDetail: ExpandedItemDetail = {
    ...detail,
    prototype_briefs: nextBriefs,
  };
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    console.warn(
      "[item/variation/prototype] persist failed (non-fatal):",
      writeRes.error.message,
    );
  }

  return NextResponse.json({ brief });
}
