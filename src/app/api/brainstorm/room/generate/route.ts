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
  linkWithinLayer,
  type RoomContext,
  type RoomCategoryEnum,
} from "@/lib/objective-canvas/layered-generation";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import {
  generateRoomCategories,
  normalizeRoomCategories,
  type RoomCategories,
} from "@/lib/objective-canvas/generate-categories";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import { generateObjectiveAnnotations } from "@/lib/objective-canvas/generate-annotations";
import {
  buildRagBlock,
  collectRagSources,
  type SurfaceBundle,
  type DeepBundle,
  type ResearchSource,
} from "@/lib/research/research-service";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import { readConstraints, buildConstraintsBlock } from "@/lib/objective-canvas/constraints";
import {
  loadRecentLearnings,
  buildLearningsBlock,
} from "@/lib/objective-canvas/load-recent-learnings";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";

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
    .select(
      "id, user_id, description, input_text, synthesis_data, surface_research, deep_research",
    )
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: sub } = await db
    .from("improvement_goals")
    .select(
      "id, title, description, space_id, user_id, parent_goal_id, room_layers_generated_at, room_categories",
    )
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
  // Parent goal carries the objective text + the persisted annotation
  // set the canvas generated. Annotations are the semantic substrate
  // the room generation reasons against (see ANNOTATION LENS in
  // layered-generation.ts). When there's no parent goal we fall
  // through to the space-level root goal lookup below so rooms in
  // legacy spaces still benefit.
  let parentAnnotationsRaw: unknown = null;
  if (sub.parent_goal_id) {
    const { data: parent } = await db
      .from("improvement_goals")
      .select("title, description, annotations")
      .eq("id", sub.parent_goal_id)
      .maybeSingle();
    if (parent?.description) {
      coreObjectiveText = parent.description;
    } else if (parent?.title) {
      coreObjectiveText = parent.title;
    }
    parentAnnotationsRaw = parent?.annotations ?? null;
  } else {
    // No parent_goal_id — fall back to the root improvement_goal in
    // this space (the canvas root, parent_goal_id IS NULL). Picks up
    // annotations for spaces where the sub WAS the root.
    const { data: rootGoal } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("space_id", spaceId)
      .is("parent_goal_id", null)
      .maybeSingle();
    parentAnnotationsRaw = rootGoal?.annotations ?? null;
  }
  const annotations = normalizeAnnotations(parentAnnotationsRaw);

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

  // ── Resolve room_categories (Tier 3) ────────────────────────────
  // Try the persisted set first. If empty (first room visit), call
  // the pre-room category generator and persist before continuing.
  // The generated set becomes the enum constraint for every item
  // the 3-stage room generator emits.
  let roomCategories: RoomCategories = normalizeRoomCategories(
    sub.room_categories,
  );
  const hasCategories =
    roomCategories.friction.length > 0 ||
    roomCategories.mechanism.length > 0 ||
    roomCategories.result.length > 0;
  if (!hasCategories) {
    try {
      roomCategories = await generateRoomCategories({
        coreObjectiveText,
        subObjectiveTitle: sub.title,
        subObjectiveDescription: sub.description,
        clarifyingAnswers,
      });
      // Persist immediately so a regenerate / refresh sees the same
      // set. Soft-fail: if persist fails the room still generates
      // (categories live in memory for this run only).
      const persistRes = await db
        .from("improvement_goals")
        .update({ room_categories: roomCategories })
        .eq("id", subObjectiveId);
      if (persistRes.error) {
        console.warn(
          "[room/generate] room_categories persist failed:",
          persistRes.error.message,
        );
      }
    } catch (err) {
      console.warn(
        "[room/generate] category generation failed (non-fatal):",
        sanitizeErrorMessage(err),
      );
      // Categories remain empty — room generates without sub_category
      // tagging, items render under "Uncategorized" in the UI.
    }
  }

  // Convert to enum form (slug → label) for the stage prompts.
  const categoriesEnum: RoomCategoryEnum = {
    friction: Object.fromEntries(
      roomCategories.friction.map((c) => [c.slug, c.label]),
    ),
    mechanism: Object.fromEntries(
      roomCategories.mechanism.map((c) => [c.slug, c.label]),
    ),
    result: Object.fromEntries(
      roomCategories.result.map((c) => [c.slug, c.label]),
    ),
  };

  // ── Build RAG block from persisted research bundles (Commit 2) ──
  // When research has landed for this space (surface + deep
  // bundles populated), prepend a RESEARCH CONTEXT block to every
  // stage's user prompt + force the LLM to emit citations[] per
  // item. When research is empty/skipped, ragBlock = "" and
  // generation falls through to LLM-only.
  const surfaceBundle =
    (space.surface_research as SurfaceBundle | null) ?? null;
  const deepBundle = (space.deep_research as DeepBundle | null) ?? null;
  const ragBlock = buildRagBlock(surfaceBundle, deepBundle, {
    maxSources: 12,
    maxCharsPerSnippet: 500,
  });
  // The same dedup'd source list the prompt sees — used below to
  // persist each item's citation INDEX → URL mapping into
  // causal_chain so the UI can render real source previews.
  const ragSources = collectRagSources(surfaceBundle, deepBundle, 12);

  // ── K2 Wire 1 — operational constraints into room gen ──
  // Lifts the user's situation (time / budget / team / risk /
  // compliance) into every stage prompt. Without this the room
  // generates as if every user is a funded enterprise PM.
  const constraints = readConstraints(space.synthesis_data);
  const constraintsBlock = buildConstraintsBlock(constraints);

  // ── K2 Wire 4 — cross-room findings into room gen ──
  // When the space already has cached analysis findings (themes,
  // recurring mechanisms, annotation overlaps, orphan annotations),
  // surface them so the NEW room respects what's already been
  // discovered across sibling rooms. Skipped on first room — no
  // findings exist yet.
  const cachedAnalysis: CrossRoomAnalysisState | null =
    (space.synthesis_data?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;
  const crossRoomFindingsBlock = buildCrossRoomFindingsBlock(cachedAnalysis);

  // ── K4 Wire 2 — concluded experiment learnings into room gen ──
  // Closes the amnesia loop. The user's concluded / abandoned
  // experiments in THIS space inform new room generation so we
  // don't propose mechanisms they've already tested and discarded.
  const recentLearnings = await loadRecentLearnings({
    db,
    userId: auth.user.id,
    spaceId,
    limit: 8,
  });
  const learningsBlock = buildLearningsBlock(recentLearnings, {
    crossSpace: false,
  });

  const ctx: RoomContext = {
    spaceId,
    userId: auth.user.id,
    subObjectiveId,
    subObjectiveTitle: sub.title,
    subObjectiveDescription: sub.description,
    coreObjectiveText,
    clarifyingAnswers,
    layersBySlug,
    categories: hasCategories || Object.keys(categoriesEnum.friction).length > 0
      ? categoriesEnum
      : undefined,
    ragBlock,
    annotations: annotations.length > 0 ? annotations : undefined,
    constraintsBlock,
    crossRoomFindingsBlock,
    learningsBlock,
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

  // Resolve LLM-emitted citation indices (1-based) → actual
  // ResearchSource records for persistence. We store the
  // RESOLVED objects (not just the indices) so the UI can render
  // source previews without re-loading the bundles. Bad indices
  // (out of bounds, hallucinated) are dropped silently.
  function resolveCitations(
    indices: number[] | undefined,
  ): Array<{ title: string; url: string; snippet: string; lens?: string }> {
    if (!indices || indices.length === 0) return [];
    const out: Array<{
      title: string;
      url: string;
      snippet: string;
      lens?: string;
    }> = [];
    for (const i of indices) {
      const src = ragSources[i - 1]; // 1-based → 0-based
      if (!src) continue;
      out.push({
        title: src.title,
        url: src.url,
        snippet: src.snippet,
        lens: src.lens,
      });
    }
    return out;
  }

  const entityRows = [
    // Pain: name is the EFFECT title; description is the
    // negative_outcome (one line); causal_chain carries the root
    // causes + the LLM's influence rank used for lane ordering +
    // the sub_category slug (Tier 3) used for chip + grouping +
    // chain archetype derivation + Commit-2 citations (resolved
    // to source records so the UI can render previews directly) +
    // ANNOTATION provenance (resolved {index, phrase, facet} entries
    // the room view turns into hover-linked chips on the card).
    ...pain.map((p) =>
      buildRow("pain", p.name, p.negative_outcome, 0.7, {
        negative_outcome: p.negative_outcome,
        root_causes: p.root_causes,
        influence_rank: p.influence_rank,
        sub_category: p.sub_category ?? null,
        citations: resolveCitations(p.citations),
        derived_from_annotations: p.derived_from_annotations ?? [],
      }),
    ),
    // Outcome: name is the state; description holds the
    // measured_by signal; causal_chain mirrors it + sub_category
    // + citations + annotation provenance + Phase 8 indicators[].
    ...outcomes.map((o) =>
      buildRow("outcomes", o.name, o.measured_by, 0.7, {
        measured_by: o.measured_by,
        // Phase 8 — observable criteria mirroring pain.root_causes
        // so the Category Card's OUTCOME panel renders symmetrically
        // with the PROBLEM panel.
        indicators: Array.isArray(o.indicators) ? o.indicators : [],
        sub_category: o.sub_category ?? null,
        citations: resolveCitations(o.citations),
        derived_from_annotations: o.derived_from_annotations ?? [],
      }),
    ),
    // Feature: name is the feature; description is the
    // positive_outcome; causal_chain carries first_principles +
    // sub_category + citations + annotation provenance.
    ...features.map((f) =>
      buildRow("features", f.name, f.positive_outcome, 0.65, {
        positive_outcome: f.positive_outcome,
        first_principles: f.first_principles,
        sub_category: f.sub_category ?? null,
        citations: resolveCitations(f.citations),
        derived_from_annotations: f.derived_from_annotations ?? [],
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

  // Phase-2 content-aware correlations: build per-layer name→body
  // lookups so the inserted ids (which we only know post-insert) can
  // be joined to the original generated bodies (negative_outcome,
  // root_causes, positive_outcome, first_principles, measured_by).
  // Joining on (layer, name) is safe — the generator emits unique
  // names within layer, and the inserted rows preserve them verbatim.
  const painByName = new Map(pain.map((p) => [p.name, p]));
  const outcomeByName = new Map(outcomes.map((o) => [o.name, o]));
  const featureByName = new Map(features.map((f) => [f.name, f]));

  const itemRefs = inserted.map((e) => {
    const layer = (slugByLayerId.get(e.layer_ontology_id) ?? "features") as
      | "pain"
      | "outcomes"
      | "features"
      | "objective";
    const base = { id: e.id, name: e.name, layer };
    // Attach body content per layer so the correlation LLM can ground
    // edges in actual semantic overlaps instead of label matching.
    if (layer === "pain") {
      const p = painByName.get(e.name);
      if (p) {
        return {
          ...base,
          negative_outcome: p.negative_outcome,
          root_causes: p.root_causes,
        };
      }
    } else if (layer === "outcomes") {
      const o = outcomeByName.get(e.name);
      if (o) {
        return { ...base, measured_by: o.measured_by };
      }
    } else if (layer === "features") {
      const f = featureByName.get(e.name);
      if (f) {
        return {
          ...base,
          positive_outcome: f.positive_outcome,
          first_principles: f.first_principles,
        };
      }
    }
    // Objective + any unmatched fallthrough: name-only legacy mode.
    return base;
  });

  // ── Generate cross-layer correlations ───────────────────────────
  // Soft-fail kept so partial generation lands (entities still
  // persist) BUT we now SURFACE the warning in the response so the
  // client can show a "first-run correlations failed — retry?"
  // banner. Otherwise the user discovers the empty side panel by
  // accident.
  let correlations: Awaited<ReturnType<typeof linkCorrelations>> = [];
  let correlationWarning: string | null = null;
  try {
    correlations = await linkCorrelations(ctx, itemRefs);
    if (correlations.length === 0) {
      correlationWarning =
        "The correlation step returned 0 edges meeting the strength threshold. Click 'Generate correlations' in the side panel to retry.";
    }
  } catch (err) {
    correlationWarning = `Correlation step failed: ${sanitizeErrorMessage(err)}. Retry from the side panel.`;
    console.warn(
      "[room/generate] correlation stage failed (non-fatal):",
      correlationWarning,
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
    const edgeRows = correlations.map((c) => {
      // agent_feedback is jsonb — we layer in:
      //   • mechanism: the specific lever name (LLM-emitted)
      //   • derived_from_annotation: single resolved provenance entry
      //     so the side panel can render an annotation chip beside the
      //     mechanism pill. Persisted as the resolved record (not just
      //     the index) so the UI doesn't need to re-load annotations.
      const feedback: Record<string, unknown> = {};
      if (c.mechanism) feedback.mechanism = c.mechanism.slice(0, 60);
      if (c.derived_from_annotation) {
        feedback.derived_from_annotation = c.derived_from_annotation;
      }
      return {
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
        agent_feedback: feedback,
      };
    });
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

  // ── Phase 8b — Within-layer links (sibling mechanism relationships) ──
  // Sparse second pass — emits composes_with / interferes_with pairs
  // among features only. Soft-fail throughout; missing within-layer
  // edges don't block room finalization.
  try {
    const withinLayerLinks = await linkWithinLayer(ctx, itemRefs);
    if (withinLayerLinks.length > 0) {
      const lateralRows = withinLayerLinks.map((l) => ({
        space_id: spaceId,
        parent_sub_objective_id: subObjectiveId,
        source_entity_id: l.sourceId,
        target_entity_id: l.targetId,
        relationship_type: l.kind, // "composes_with" | "interferes_with"
        // "structural" distinguishes lateral relationships from the
        // "causal" cross-layer edges. The wire overlay reads
        // relationship_type directly to render lateral wires with
        // different geometry/style, but persisting dimension keeps
        // analytics queries clean ("show me all structural lateral
        // signals").
        dimension: "structural",
        source_tag: "inferred",
        strength: l.strength,
        // composes_with → positive (build-on), interferes_with → negative
        // (collision). Maps cleanly into the existing polarity enum.
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
          "[room/generate] within-layer edge insert failed:",
          lateralInsert.error.message,
        );
      } else {
        edgeCount += (lateralInsert.data ?? []).length;
      }
    }
  } catch (err) {
    console.warn(
      "[room/generate] within-layer link generation failed (non-fatal):",
      sanitizeErrorMessage(err),
    );
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

  // Phase 10a — log room_generated for the Lab Notebook. The room
  // panel renders this as the room's "birthday" event; the All-rooms
  // view surfaces it as the room's appearance on the canvas timeline.
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId,
    action: "room_generated",
    metadata: {
      mode,
      room_layer_counts: {
        pain: pain.length,
        features: features.length,
        outcomes: outcomes.length,
      },
      edge_count: edgeCount,
      correlation_warning: correlationWarning,
    },
  });

  // ── K3 — Auto-trigger sub-objective annotation generation ──
  // The sub-objective's own text (title + description) deserves
  // its own Annotation Lens, parallel to the parent objective's
  // lens. Auto-fire on first room generation; skip when the sub
  // already has annotations OR was regenerated (annotations stay
  // valid across room regen since they derive from the sub text,
  // not the room contents). Soft-fail: a failure here doesn't
  // affect the room generation response.
  if (mode === "initial") {
    const { data: subAnnRow } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("id", subObjectiveId)
      .maybeSingle();
    const hasSubAnnotations =
      Array.isArray(subAnnRow?.annotations) &&
      (subAnnRow!.annotations as unknown[]).length > 0;
    if (!hasSubAnnotations) {
      const focusText = [sub.title, sub.description ?? ""]
        .filter((s) => s && s.trim().length > 0)
        .join("\n\n");
      if (focusText.trim().length >= 12) {
        try {
          const subAnnotations = await generateObjectiveAnnotations({
            objective: focusText,
            subObjectives: [],
          });
          if (subAnnotations.length > 0) {
            await db
              .from("improvement_goals")
              .update({ annotations: subAnnotations })
              .eq("id", subObjectiveId);
          }
        } catch (err) {
          console.warn(
            "[room/generate] sub-objective annotation gen failed (non-fatal):",
            sanitizeErrorMessage(err),
          );
        }
      }
    }
  }

  return NextResponse.json({
    summary: {
      pain_count: pain.length,
      outcome_count: outcomes.length,
      feature_count: features.length,
      edge_count: edgeCount,
    },
    // null when correlations populated cleanly; populated string
    // when the LLM correlation step failed OR returned 0 edges.
    // The client surfaces this as a banner so the user knows to
    // retry from the side panel.
    correlation_warning: correlationWarning,
  });
}

// ── K2 Wire 4 — cross-room findings prompt block ──────────────────
//
// Renders the space's cached cross-room findings (themes / recurring
// mechanisms / orphan annotations) as a compact block the new
// room's prompts can read. Designed for SHORT inclusion — only the
// signal density that actually changes what the LLM should emit.
//
// Skipped entirely when no analysis cache exists (first room in a
// space) or when only Tier 1 findings exist that don't matter for
// generation (e.g., low-severity orphans).

function buildCrossRoomFindingsBlock(
  analysis: CrossRoomAnalysisState | null,
): string {
  if (!analysis || !Array.isArray(analysis.findings)) return "";
  const live = analysis.findings.filter(
    (f) => f.disposition !== "dismissed",
  );
  if (live.length === 0) return "";

  // Themes — load-bearing recurring concepts.
  const themes = live
    .filter((f) => f.analysis_key === "distill_concepts")
    .slice(0, 3);
  // Recurring mechanisms — same lever in ≥2 rooms.
  const recurring = live
    .filter((f) => f.analysis_key === "shared_mechanisms")
    .slice(0, 4);
  // Orphan annotations — high-weight lens readings NO room derived
  // from. These are gap candidates the new room could fill.
  const orphans = live
    .filter(
      (f) =>
        f.analysis_key === "orphan_annotations" &&
        (f.severity === "high" || f.severity === "critical"),
    )
    .slice(0, 3);

  if (themes.length === 0 && recurring.length === 0 && orphans.length === 0) {
    return "";
  }

  const lines: string[] = [
    "CROSS-ROOM CONTEXT (what other rooms in this space have already produced — RESPECT, don't re-propose):",
  ];
  if (themes.length > 0) {
    lines.push("  Recurring themes:");
    for (const t of themes) {
      lines.push(`    • ${t.title}${t.summary ? ` — ${t.summary}` : ""}`);
    }
  }
  if (recurring.length > 0) {
    lines.push(
      "  Mechanisms already used in sibling rooms (don't redundantly re-design):",
    );
    for (const r of recurring) {
      lines.push(`    • ${r.title}`);
    }
  }
  if (orphans.length > 0) {
    lines.push(
      "  Parent-objective readings NO sibling room covers (gap-fill candidates if relevant):",
    );
    for (const o of orphans) {
      lines.push(`    • ${o.title}`);
    }
  }
  return `\n\n${lines.join("\n")}\n`;
}
