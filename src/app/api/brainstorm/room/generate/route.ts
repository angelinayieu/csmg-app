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

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  runLayeredGeneration,
  linkCorrelations,
  type RoomContext,
} from "@/lib/objective-canvas/layered-generation";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";

// ── entities table contracts (Phase 6) ────────────────────────────
// entity_category has a CHECK constraint to one of these values;
// entity_type is free-text but we mirror the layer for readability.
const ENTITY_CATEGORY_BY_LAYER = {
  pain: "fault",
  features: "concrete",
  outcomes: "abstract",
  objective: "abstract",
} as const;

const ENTITY_TYPE_BY_LAYER = {
  pain: "pain_point",
  features: "feature",
  outcomes: "outcome",
  objective: "objective_anchor",
} as const;

// source_tag has a CHECK constraint to {explicit, implicit, assumed};
// canvas items are AI-derived from the user's typed objective → "implicit".
const SOURCE_TAG = "implicit" as const;

// Build a stable per-row entity_id (required, non-null on entities).
// Format: oc_<layer>_<short uuid> keeps it readable in DB inspection
// without colliding across rooms.
function buildEntityId(layer: keyof typeof ENTITY_CATEGORY_BY_LAYER): string {
  return `oc_${layer}_${randomUUID().slice(0, 8)}`;
}

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
  // v2 returns rich items with their causal chains (pain →
  // negative_outcome, root_causes[], influence_rank; feature →
  // positive_outcome, first_principles[]; outcome → measured_by)
  // plus the room-level top_negative_outcome.
  let gen: Awaited<ReturnType<typeof runLayeredGeneration>>;
  try {
    gen = await runLayeredGeneration(ctx);
  } catch (err) {
    return NextResponse.json(
      { error: `generation failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
  const { pain, outcomes, features, top_negative_outcome, lane_labels } = gen;

  // ── Persist entities ────────────────────────────────────────────
  // Required columns on `entities`:
  //   entity_id        text NOT NULL         (we generate per-row)
  //   source_tag       text NOT NULL CHECK   (must be explicit/implicit/assumed)
  //   entity_category  text NOT NULL CHECK   (must be concrete/abstract/process/relational/epistemic/fault)
  // Plus our v2 jsonb: causal_chain.
  const buildRow = (
    layer: keyof typeof ENTITY_CATEGORY_BY_LAYER,
    name: string,
    description: string,
    confidence: number,
    causal_chain: Record<string, unknown> | null,
  ) => ({
    space_id: spaceId,
    parent_sub_objective_id: subObjectiveId,
    layer_ontology_id: layersBySlug.get(layer)!.id,
    entity_id: buildEntityId(layer),
    name,
    description,
    entity_type: ENTITY_TYPE_BY_LAYER[layer],
    entity_category: ENTITY_CATEGORY_BY_LAYER[layer],
    source_tag: SOURCE_TAG,
    confidence,
    causal_chain,
  });

  const entityRows = [
    // Pain: name is the EFFECT title; description is the
    // negative_outcome (one line); causal_chain carries the root
    // causes + the LLM's influence rank used for lane ordering.
    ...pain.map((p) =>
      buildRow("pain", p.name, p.negative_outcome, 0.7, {
        negative_outcome: p.negative_outcome,
        root_causes: p.root_causes,
        influence_rank: p.influence_rank,
      }),
    ),
    // Outcome: name is the state; description holds the
    // measured_by signal; causal_chain mirrors it for symmetry.
    ...outcomes.map((o) =>
      buildRow("outcomes", o.name, o.measured_by, 0.7, {
        measured_by: o.measured_by,
      }),
    ),
    // Feature: name is the feature; description is the
    // positive_outcome; causal_chain carries first_principles.
    ...features.map((f) =>
      buildRow("features", f.name, f.positive_outcome, 0.65, {
        positive_outcome: f.positive_outcome,
        first_principles: f.first_principles,
      }),
    ),
    // Objective anchor: a single entity so cross-layer edges to
    // "objective" have a valid target.
    buildRow(
      "objective",
      sub.title,
      coreObjectiveText.slice(0, 600),
      1.0,
      null,
    ),
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
    // edges CHECK constraints (Phase 6 wire-up):
    //   source_tag ∈ {stated, inferred, predicted}  → "inferred" for AI-derived
    //   polarity   ∈ {positive, negative, neutral, conditional}
    //                LLM may emit "ambiguous" — map that to "conditional"
    //   dimension  ∈ {structural, functional, temporal, causal, ...}
    const mapPolarity = (
      p: string,
    ): "positive" | "negative" | "neutral" | "conditional" => {
      if (p === "positive" || p === "negative" || p === "neutral") return p;
      // "ambiguous" or anything else collapses to "conditional" — the
      // polarity is real but depends on context the LLM couldn't pin down.
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

  // ── Mark generation complete + persist room header anchor +
  //    adaptive lane labels. lane_labels is a jsonb the room page
  //    reads to override the canonical Pain/Features/Outcomes/
  //    Objective names with domain-appropriate ones. ──
  await db
    .from("improvement_goals")
    .update({
      room_layers_generated_at: new Date().toISOString(),
      top_negative_outcome: top_negative_outcome || null,
      room_lane_labels: lane_labels,
    })
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
