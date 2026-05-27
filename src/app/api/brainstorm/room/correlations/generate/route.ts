// ── POST /api/brainstorm/room/correlations/generate ───────────────
//
// Surgical retry of ONLY the correlation step for a sub-objective
// room. Reuses existing entities — does not regenerate them — so the
// user can recover from a soft-failed correlation pass without
// re-spending LLM budget on Pain / Mechanism / Result regeneration.
//
// Body: { spaceId, subObjectiveId, mode?: "initial" | "regenerate" }
//   initial    — no-op if the room already has edges
//   regenerate — wipes existing edges, runs the correlation LLM
//                pass, persists the new set
//
// Returns: { summary: { edge_count, chain_count } } on success.
// On LLM error, returns 500 with the error message (NOT silent —
// the side panel surfaces it so the user can retry intelligently).

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  linkCorrelations,
  linkWithinLayer,
  type RoomContext,
  type RoomCategoryEnum,
} from "@/lib/objective-canvas/layered-generation";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import { normalizeRoomCategories } from "@/lib/objective-canvas/generate-categories";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  spaceId?: string;
  subObjectiveId?: string;
  mode?: "initial" | "regenerate";
}

const LAYER_SLUGS = ["pain", "features", "outcomes", "objective"] as const;
type LayerSlug = (typeof LAYER_SLUGS)[number];

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const subObjectiveId =
    typeof body?.subObjectiveId === "string" ? body.subObjectiveId : "";
  if (!spaceId || !subObjectiveId) {
    return NextResponse.json(
      { error: "spaceId + subObjectiveId required" },
      { status: 400 },
    );
  }
  const mode: "initial" | "regenerate" =
    body?.mode === "regenerate" ? "regenerate" : "initial";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load + ownership ────────────────────────────────────────────
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: sub } = await db
    .from("improvement_goals")
    .select(
      "id, title, description, space_id, user_id, parent_goal_id, room_categories, room_layers_generated_at",
    )
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (!sub || sub.user_id !== auth.user.id || sub.space_id !== spaceId) {
    return NextResponse.json(
      { error: "sub-objective not found in this space" },
      { status: 404 },
    );
  }
  if (!sub.room_layers_generated_at) {
    return NextResponse.json(
      {
        error:
          "Room hasn't been generated yet. Generate the room first to create the entities correlations need to link.",
      },
      { status: 409 },
    );
  }

  // ── Mode handling ───────────────────────────────────────────────
  if (mode === "initial") {
    const { count } = await db
      .from("edges")
      .select("id", { count: "exact", head: true })
      .eq("parent_sub_objective_id", subObjectiveId);
    if ((count ?? 0) > 0) {
      return NextResponse.json({
        summary: { edge_count: 0, chain_count: 0 },
        cached: true,
      });
    }
  } else {
    // regenerate: wipe existing edges
    await db
      .from("edges")
      .delete()
      .eq("parent_sub_objective_id", subObjectiveId);
  }

  // ── Resolve parent core objective text (for prompt context) ─────
  let coreObjectiveText =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  if (sub.parent_goal_id) {
    const { data: parent } = await db
      .from("improvement_goals")
      .select("title, description")
      .eq("id", sub.parent_goal_id)
      .maybeSingle();
    if (parent?.description) coreObjectiveText = parent.description;
    else if (parent?.title) coreObjectiveText = parent.title;
  }

  // ── Load layer_ontology rows ────────────────────────────────────
  const { data: layerRows } = await db
    .from("layer_ontology")
    .select("id, slug, label")
    .eq("space_id", spaceId);
  const layersBySlug = new Map<
    LayerSlug,
    { id: string; slug: string; label: string }
  >();
  for (const r of (layerRows ?? []) as Array<{
    id: string;
    slug: string;
    label: string;
  }>) {
    if ((LAYER_SLUGS as readonly string[]).includes(r.slug)) {
      layersBySlug.set(r.slug as LayerSlug, {
        id: r.id,
        slug: r.slug,
        label: r.label,
      });
    }
  }
  const slugByLayerId = new Map(
    Array.from(layersBySlug.entries()).map(([slug, row]) => [row.id, slug]),
  );

  // ── Load existing entities — these are the nodes correlations
  //    will link. If empty, correlations can't form. ──
  //
  // Phase-2: select causal_chain too so we can hand the body content
  // (negative_outcome, root_causes, positive_outcome, first_principles,
  // measured_by) to linkCorrelations. The same content the original
  // room/generate route passes inline post-generation — here it comes
  // from the persisted jsonb instead. Lets the retry path also produce
  // content-grounded edges instead of name-only fallbacks.
  const { data: entityRows } = await db
    .from("entities")
    .select("id, name, layer_ontology_id, causal_chain")
    .eq("parent_sub_objective_id", subObjectiveId);
  const entities = ((entityRows ?? []) as Array<{
    id: string;
    name: string;
    layer_ontology_id: string | null;
    causal_chain: Record<string, unknown> | null;
  }>);
  if (entities.length < 2) {
    return NextResponse.json(
      {
        error:
          "Not enough entities in this room to correlate. Generate the room first.",
      },
      { status: 409 },
    );
  }
  /** Pull a string field from a causal_chain jsonb defensively. */
  function ccStr(
    cc: Record<string, unknown> | null,
    key: string,
  ): string | undefined {
    const v = cc?.[key];
    return typeof v === "string" && v.trim().length > 0 ? v : undefined;
  }
  /** Pull a string[] field from a causal_chain jsonb defensively. */
  function ccStrArr(
    cc: Record<string, unknown> | null,
    key: string,
  ): string[] | undefined {
    const v = cc?.[key];
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
    return out.length > 0 ? out : undefined;
  }
  const itemRefs = entities
    .map((e) => {
      const layer = (e.layer_ontology_id
        ? slugByLayerId.get(e.layer_ontology_id)
        : null) as LayerSlug | undefined;
      if (!layer) return null;
      const base = { id: e.id, name: e.name, layer };
      if (layer === "pain") {
        return {
          ...base,
          negative_outcome: ccStr(e.causal_chain, "negative_outcome"),
          root_causes: ccStrArr(e.causal_chain, "root_causes"),
        };
      }
      if (layer === "outcomes") {
        return {
          ...base,
          measured_by: ccStr(e.causal_chain, "measured_by"),
        };
      }
      if (layer === "features") {
        return {
          ...base,
          positive_outcome: ccStr(e.causal_chain, "positive_outcome"),
          first_principles: ccStrArr(e.causal_chain, "first_principles"),
        };
      }
      return base; // objective anchor — name-only
    })
    .filter((it): it is NonNullable<typeof it> => !!it);

  // ── Build the room context (mirrors room/generate/route.ts) ─────
  const state = readObjectiveCanvasState(space.synthesis_data);
  const clarifyingAnswers: Array<{ question: string; answer: string }> = [];
  if (state.clarifying) {
    for (const q of state.clarifying.questions) {
      const a = state.clarifying.answers[q.id];
      if (a?.status === "answered" && a.value) {
        clarifyingAnswers.push({ question: q.question, answer: a.value });
      }
    }
  }

  // Pass categories through so the correlation prompt sees them
  // (future: correlation prompt can use them for archetype naming).
  const cats = normalizeRoomCategories(sub.room_categories);
  const hasCats =
    cats.friction.length + cats.mechanism.length + cats.result.length > 0;
  const categoriesEnum: RoomCategoryEnum | undefined = hasCats
    ? {
        friction: Object.fromEntries(
          cats.friction.map((c) => [c.slug, c.label]),
        ),
        mechanism: Object.fromEntries(
          cats.mechanism.map((c) => [c.slug, c.label]),
        ),
        result: Object.fromEntries(cats.result.map((c) => [c.slug, c.label])),
      }
    : undefined;

  const ctx: RoomContext = {
    spaceId,
    userId: auth.user.id,
    subObjectiveId,
    subObjectiveTitle: sub.title,
    subObjectiveDescription: sub.description,
    coreObjectiveText,
    clarifyingAnswers,
    layersBySlug,
    categories: categoriesEnum,
  };

  // ── Run the correlation LLM step ────────────────────────────────
  let correlations: Awaited<ReturnType<typeof linkCorrelations>>;
  try {
    correlations = await linkCorrelations(ctx, itemRefs);
  } catch (err) {
    // CRITICAL: do NOT silently swallow this. Bubble up so the
    // side panel can surface the message to the user.
    return NextResponse.json(
      {
        error: "correlation generation failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }
  if (correlations.length === 0) {
    return NextResponse.json(
      {
        error: "no correlations generated",
        detail:
          "The LLM didn't return any edges meeting the strength threshold. Try regenerating — sometimes the model needs another pass.",
      },
      { status: 422 },
    );
  }

  // ── Persist edges (same column contracts as room/generate) ──────
  const mapPolarity = (
    p: string,
  ): "positive" | "negative" | "neutral" | "conditional" => {
    if (p === "positive" || p === "negative" || p === "neutral") return p;
    return "conditional";
  };
  const edgeRows = correlations.map((c) => ({
    space_id: spaceId,
    parent_sub_objective_id: subObjectiveId,
    source_entity_id: c.sourceId,
    target_entity_id: c.targetId,
    relationship_type: c.relationship,
    dimension: "causal",
    source_tag: "inferred",
    strength: c.strength,
    polarity: mapPolarity(c.polarity),
    confidence: 0.6,
    conditions: c.rationale.slice(0, 500),
    agent_feedback: c.mechanism
      ? { mechanism: c.mechanism.slice(0, 60) }
      : {},
  }));
  const edgeInsert = await db.from("edges").insert(edgeRows).select("id");
  if (edgeInsert.error) {
    return NextResponse.json(
      {
        error: "edge insert failed",
        detail: edgeInsert.error.message,
      },
      { status: 500 },
    );
  }
  let edgeCount = (edgeInsert.data ?? []).length;

  // ── Phase 8b — Within-layer links retry path ──
  // Same logic as room/generate. Soft-fail so the cross-layer retry
  // still succeeds even if the within-layer pass throws.
  try {
    const withinLayerLinks = await linkWithinLayer(ctx, itemRefs);
    if (withinLayerLinks.length > 0) {
      const lateralRows = withinLayerLinks.map((l) => ({
        space_id: spaceId,
        parent_sub_objective_id: subObjectiveId,
        source_entity_id: l.sourceId,
        target_entity_id: l.targetId,
        relationship_type: l.kind,
        dimension: "structural",
        source_tag: "inferred",
        strength: l.strength,
        polarity:
          l.kind === "composes_with"
            ? ("positive" as const)
            : ("negative" as const),
        confidence: 0.6,
        conditions: l.rationale.slice(0, 500),
        agent_feedback: { mechanism: l.kind },
      }));
      const lateralInsert = await db
        .from("edges")
        .insert(lateralRows)
        .select("id");
      if (lateralInsert.error) {
        console.warn(
          "[room/correlations] within-layer edge insert failed:",
          lateralInsert.error.message,
        );
      } else {
        edgeCount += (lateralInsert.data ?? []).length;
      }
    }
  } catch (err) {
    console.warn(
      "[room/correlations] within-layer link generation failed (non-fatal):",
      sanitizeErrorMessage(err),
    );
  }

  return NextResponse.json({
    summary: { edge_count: edgeCount, chain_count: 0 /* derived client-side */ },
  });
}
