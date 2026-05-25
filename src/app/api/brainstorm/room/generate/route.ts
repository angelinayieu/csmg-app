// ── POST /api/brainstorm/room/generate ────────────────────────────
//
// Runs the 4-stage layered generator (Pain → Outcomes → Features
// → cross-layer Correlations) for one sub-objective room, then
// persists results as entities + edges scoped via
// parent_sub_objective_id.
//
// Body: { spaceId, subObjectiveId, mode?: "initial" | "regenerate" }
//   initial    — no-op if entities already exist for this sub-obj
//   regenerate — cascade-deletes existing items, then regenerates
//
// Returns a summary (counts) so the UI can show a toast; the room
// page re-queries on next render.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  runLayeredGeneration,
  linkCorrelations,
  type RoomContext,
} from "@/lib/objective-canvas/layered-generation";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";

export const runtime = "nodejs";
export const maxDuration = 90;

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

  // ── Load space + sub-objective + parent core goal ───────────────
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
    .select("id, title, description, space_id, user_id, parent_goal_id, room_layers_generated_at")
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (!sub || sub.user_id !== auth.user.id || sub.space_id !== spaceId) {
    return NextResponse.json(
      { error: "sub-objective not found in this space" },
      { status: 404 },
    );
  }

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
    if (parent?.description) {
      coreObjectiveText = parent.description;
    } else if (parent?.title) {
      coreObjectiveText = parent.title;
    }
  }

  // ── Load layer_ontology rows for this space ─────────────────────
  const { data: layerRows } = await db
    .from("layer_ontology")
    .select("id, slug, label")
    .eq("space_id", spaceId);
  const layersBySlug = new Map<LayerSlug, { id: string; slug: string; label: string }>();
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
  if (layersBySlug.size < 4) {
    return NextResponse.json(
      {
        error:
          "Space is missing one or more required layers (pain/features/outcomes/objective). The trigger may not have run — check space.space_kind.",
      },
      { status: 409 },
    );
  }

  // ── Mode handling ───────────────────────────────────────────────
  if (mode === "initial" && sub.room_layers_generated_at) {
    return NextResponse.json({
      summary: { pain_count: 0, outcome_count: 0, feature_count: 0, edge_count: 0 },
      cached: true,
    });
  }

  if (mode === "regenerate") {
    // Cascade-delete handled by FK on parent_sub_objective_id. Drop
    // edges first to keep referential integrity loud if something is
    // wrong; entities second.
    await db
      .from("edges")
      .delete()
      .eq("parent_sub_objective_id", subObjectiveId);
    await db
      .from("entities")
      .delete()
      .eq("parent_sub_objective_id", subObjectiveId);
  }

  // ── Build the room context ──────────────────────────────────────
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

  const ctx: RoomContext = {
    spaceId,
    userId: auth.user.id,
    subObjectiveId,
    subObjectiveTitle: sub.title,
    subObjectiveDescription: sub.description,
    coreObjectiveText,
    clarifyingAnswers,
    layersBySlug,
  };

  // ── Generate (3 LLM calls back to back) ─────────────────────────
  let pain: Array<{ name: string; description: string }>;
  let outcomes: Array<{ name: string; description: string }>;
  let features: Array<{ name: string; description: string }>;
  try {
    const gen = await runLayeredGeneration(ctx);
    pain = gen.pain;
    outcomes = gen.outcomes;
    features = gen.features;
  } catch (err) {
    return NextResponse.json(
      { error: `generation failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  // ── Persist entities ────────────────────────────────────────────
  // The "objective" layer always carries a single anchor: the core
  // objective text. It exists so cross-layer edges to "objective"
  // have a valid target.
  const entityRows = [
    ...pain.map((p) => ({
      space_id: spaceId,
      parent_sub_objective_id: subObjectiveId,
      layer_ontology_id: layersBySlug.get("pain")!.id,
      name: p.name,
      description: p.description,
      entity_type: "pain_point",
      confidence: 0.7,
    })),
    ...outcomes.map((o) => ({
      space_id: spaceId,
      parent_sub_objective_id: subObjectiveId,
      layer_ontology_id: layersBySlug.get("outcomes")!.id,
      name: o.name,
      description: o.description,
      entity_type: "outcome",
      confidence: 0.7,
    })),
    ...features.map((f) => ({
      space_id: spaceId,
      parent_sub_objective_id: subObjectiveId,
      layer_ontology_id: layersBySlug.get("features")!.id,
      name: f.name,
      description: f.description,
      entity_type: "feature",
      confidence: 0.65,
    })),
    {
      space_id: spaceId,
      parent_sub_objective_id: subObjectiveId,
      layer_ontology_id: layersBySlug.get("objective")!.id,
      name: sub.title,
      description: coreObjectiveText.slice(0, 600),
      entity_type: "objective_anchor",
      confidence: 1.0,
    },
  ];

  const entityInsert = await db
    .from("entities")
    .insert(entityRows)
    .select("id, name, layer_ontology_id, entity_type");
  if (entityInsert.error) {
    return NextResponse.json(
      {
        error: "entity insert failed",
        detail: entityInsert.error.message,
      },
      { status: 500 },
    );
  }

  const inserted = (entityInsert.data ?? []) as Array<{
    id: string;
    name: string;
    layer_ontology_id: string;
    entity_type: string;
  }>;

  // Map back to layer slug for the correlations stage.
  const slugByLayerId = new Map(
    Array.from(layersBySlug.entries()).map(([slug, row]) => [row.id, slug]),
  );
  const itemRefs = inserted.map((e) => ({
    id: e.id,
    name: e.name,
    layer: (slugByLayerId.get(e.layer_ontology_id) ?? "features") as
      | "pain"
      | "outcomes"
      | "features"
      | "objective",
  }));

  // ── Generate cross-layer correlations ───────────────────────────
  let correlations: Awaited<ReturnType<typeof linkCorrelations>> = [];
  try {
    correlations = await linkCorrelations(ctx, itemRefs);
  } catch (err) {
    console.warn(
      "[room/generate] correlation stage failed (non-fatal):",
      sanitizeErrorMessage(err),
    );
  }

  let edgeCount = 0;
  if (correlations.length > 0) {
    const edgeRows = correlations.map((c) => ({
      space_id: spaceId,
      parent_sub_objective_id: subObjectiveId,
      source_entity_id: c.sourceId,
      target_entity_id: c.targetId,
      relationship_type: c.relationship,
      dimension: "causal",
      source_tag: "objective_canvas_room",
      strength: c.strength,
      polarity: c.polarity,
      confidence: 0.6,
      conditions: c.rationale.slice(0, 500),
    }));
    const edgeInsert = await db.from("edges").insert(edgeRows).select("id");
    if (edgeInsert.error) {
      console.warn(
        "[room/generate] edge insert failed:",
        edgeInsert.error.message,
      );
    } else {
      edgeCount = (edgeInsert.data ?? []).length;
    }
  }

  // ── Mark generation complete ────────────────────────────────────
  await db
    .from("improvement_goals")
    .update({ room_layers_generated_at: new Date().toISOString() })
    .eq("id", subObjectiveId);

  return NextResponse.json({
    summary: {
      pain_count: pain.length,
      outcome_count: outcomes.length,
      feature_count: features.length,
      edge_count: edgeCount,
    },
  });
}
