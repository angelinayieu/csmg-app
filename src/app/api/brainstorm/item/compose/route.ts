// ── POST /api/brainstorm/item/compose ──────────────────────────────
//
// Synthesizes the elected variations of an item into a single
// composed design. Idempotent — returns the cached composed_design
// when source_variation_ids still match the current election set.
//
// Body: { entityId, mode?: "default" | "force" }
//
// Requires ≥2 elected variations. Returns 409 otherwise.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import type {
  ExpandedItemDetail,
  ComposedDesign,
} from "@/lib/objective-canvas/expand-item-detail";
import { composeVariations } from "@/lib/objective-canvas/compose-variations";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";

export const runtime = "nodejs";
export const maxDuration = 45;

interface Body {
  entityId?: string;
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
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
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
    .select("id, user_id, description, input_text")
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

  const elected = detail.variations.filter((v) => v.disposition === "elected");
  if (elected.length < 2) {
    return NextResponse.json(
      {
        error: "≥2 elected variations required for composition",
        elected_count: elected.length,
      },
      { status: 409 },
    );
  }

  // Idempotent short-circuit: same elected ids → return cached.
  if (!force && detail.composed_design) {
    const cachedIds = new Set(detail.composed_design.source_variation_ids);
    const electedIds = new Set(elected.map((v) => v.id));
    const sameSet =
      cachedIds.size === electedIds.size &&
      [...cachedIds].every((id) => electedIds.has(id));
    if (sameSet) {
      return NextResponse.json({
        composed_design: detail.composed_design,
        cached: true,
      });
    }
  }

  // Resolve layer + sub-objective + parent objective + annotations.
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
  let parentAnnotationsRaw: unknown = null;
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
          .select("title, description, annotations")
          .eq("id", sub.parent_goal_id)
          .maybeSingle();
        if (parent?.description) coreObjectiveText = parent.description;
        else if (parent?.title) coreObjectiveText = parent.title;
        parentAnnotationsRaw = parent?.annotations ?? null;
      }
    }
  }
  if (!parentAnnotationsRaw) {
    const { data: rootGoal } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("space_id", entity.space_id)
      .is("parent_goal_id", null)
      .maybeSingle();
    parentAnnotationsRaw = rootGoal?.annotations ?? null;
  }
  const annotations = normalizeAnnotations(parentAnnotationsRaw);

  let composed: ComposedDesign;
  try {
    composed = await composeVariations({
      itemName: entity.name,
      itemLayer: layer,
      electedVariations: elected,
      subObjectiveTitle,
      coreObjectiveText,
      annotations: annotations.length > 0 ? annotations : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "composition failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  const nextDetail: ExpandedItemDetail = {
    ...detail,
    composed_design: composed,
  };
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    console.warn(
      "[item/compose] failed to persist composed_design:",
      writeRes.error.message,
    );
  }

  return NextResponse.json({ composed_design: composed });
}
