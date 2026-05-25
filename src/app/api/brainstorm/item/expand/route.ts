// ── POST /api/brainstorm/item/expand ──────────────────────────────
//
// Lazy-fetches the item detail drawer's depth surface (definition +
// variations + planning). Called once when the user first opens the
// drawer for an entity; cached on entities.expanded_detail thereafter.
//
// Body: { entityId, mode?: "default" | "force" }
//
// "force" regenerates from scratch (user explicitly asked).

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  expandItemDetail,
  type ExpandedItemDetail,
} from "@/lib/objective-canvas/expand-item-detail";
import {
  buildRagBlock,
  type SurfaceBundle,
  type DeepBundle,
} from "@/lib/research/research-service";

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

  // ── Load entity + ownership check ──
  const { data: entity, error: entityErr } = await db
    .from("entities")
    .select(
      "id, name, layer_ontology_id, parent_sub_objective_id, causal_chain, expanded_detail, space_id",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (entityErr) {
    return NextResponse.json(
      { error: "DB error", detail: entityErr.message },
      { status: 500 },
    );
  }
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }

  // Verify the user owns the parent space (RLS-ish via app code).
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, surface_research, deep_research")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Idempotent short-circuit on cached detail.
  const existing = entity.expanded_detail as ExpandedItemDetail | null;
  const hasCached =
    !!existing &&
    typeof existing === "object" &&
    typeof (existing as { definition?: unknown }).definition === "string" &&
    (existing as { definition: string }).definition.length > 0;
  if (!force && hasCached) {
    return NextResponse.json({ expanded_detail: existing, cached: true });
  }

  // ── Resolve layer slug from layer_ontology ──
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

  // ── Resolve room (sub-objective) + parent objective ──
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

  // ── Build RAG block from space-level research ──
  const surface = (space.surface_research as SurfaceBundle | null) ?? null;
  const deep = (space.deep_research as DeepBundle | null) ?? null;
  const ragBlock = buildRagBlock(surface, deep, {
    maxSources: 8,
    maxCharsPerSnippet: 400,
  });

  // ── Run the expansion LLM call ──
  let detail: ExpandedItemDetail;
  try {
    detail = await expandItemDetail({
      layer,
      name: entity.name,
      causalChain: (entity.causal_chain as Record<string, unknown>) ?? {},
      subObjectiveTitle,
      coreObjectiveText,
      ragBlock,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "expansion failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  // ── Persist ──
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: detail })
    .eq("id", entityId);
  if (writeRes.error) {
    console.warn(
      "[item/expand] failed to persist expanded_detail:",
      writeRes.error.message,
    );
  }

  return NextResponse.json({ expanded_detail: detail });
}
