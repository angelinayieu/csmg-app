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
import { readConstraints } from "@/lib/objective-canvas/constraints";
import {
  resolveParentObjectiveContext,
  resolveEntityLayer,
  type LayerSlug,
} from "@/lib/objective-canvas/context-helpers";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";

export const runtime = "nodejs";
export const maxDuration = 45;

interface Body {
  entityId?: string;
  mode?: "default" | "force";
}

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

  // Phase-1 helpers — was ~50 lines of inline layer + parent + annotations
  // resolution; now two helper calls. Same behavior, same query count.
  const layer: LayerSlug = await resolveEntityLayer(
    db,
    entity.layer_ontology_id,
  );
  const {
    subObjectiveTitle,
    coreObjectiveText,
    annotations,
  } = await resolveParentObjectiveContext(db, entity, space);

  // Telemetry-wrapped composition call. artifact_kind 'composed_design'
  // + entity.id lets the feedback endpoint find the most-recent compose
  // log row when the user thumbs-rates the composition banner.
  let composed: ComposedDesign;
  try {
    composed = await instrumentedLLMCall(
      {
        db,
        userId: auth.user.id,
        spaceId: entity.space_id,
        callSite: "compose_variations",
        modelHint: "gpt-4o",
        artifactKind: "composed_design",
        artifactId: entity.id,
        metadata: {
          itemLayer: layer,
          elected_count: elected.length,
          had_lens: annotations.length > 0,
          had_constraints: !!readConstraints(space.synthesis_data),
        },
      },
      () =>
        composeVariations({
          itemName: entity.name,
          itemLayer: layer,
          electedVariations: elected,
          subObjectiveTitle,
          coreObjectiveText,
          annotations: annotations.length > 0 ? annotations : undefined,
          constraints: readConstraints(space.synthesis_data),
        }),
    );
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
