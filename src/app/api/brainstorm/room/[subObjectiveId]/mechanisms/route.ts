// ── POST /api/brainstorm/room/[subObjectiveId]/mechanisms ─────────
//
// Arc 3.6 — the SECOND half of the checkpoint flow. /room/generate
// with phase:"define" produces problems (pain) + results (outcome) and
// stops. The user reviews / edits / sharpens them. This endpoint then
// generates the mechanisms (features) against the (possibly EDITED)
// problems + results and completes the room.
//
// Why it matters: because Arc 3.2 makes each feature DECLARE its
// bindings (addresses[] {pain, root_cause}, moves[] {outcome,
// indicator}) VERBATIM against the pain's root_causes + the outcome's
// indicators, reconstructing the pain/outcome from their (edited)
// causal_chain means the feature binds to what the USER defined — the
// edit propagates straight into the declared causal chain.
//
// Flow: load existing pain+outcome (require both) → reconstruct
// PainItem[]/OutcomeItem[] → build the same RoomContext the generator
// uses → runMechanismStage → persist features → declared-primary edges
// (shared builder) + supplementary correlations (deduped) + within-
// layer links → stamp room_layers_generated_at → done.
//
// Idempotent: re-running deletes prior features + their edges first.

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  runMechanismStage,
  linkCorrelations,
  linkWithinLayer,
  type RoomContext,
  type RoomCategoryEnum,
  type PainItem,
  type OutcomeItem,
} from "@/lib/objective-canvas/layered-generation";
import { buildDeclaredEdgeRows } from "@/lib/objective-canvas/declared-edges";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import { normalizeRoomCategories } from "@/lib/objective-canvas/generate-categories";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import {
  buildRagBlock,
  type SurfaceBundle,
  type DeepBundle,
} from "@/lib/research/research-service";
import {
  readConstraints,
  buildConstraintsBlock,
} from "@/lib/objective-canvas/constraints";
import {
  loadRecentLearnings,
  buildLearningsBlock,
} from "@/lib/objective-canvas/load-recent-learnings";
import { buildCrossRoomFindingsBlock } from "@/lib/objective-canvas/room-cross-room-block";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";

export const runtime = "nodejs";
export const maxDuration = 90;

interface RouteContext {
  params: Promise<{ subObjectiveId: string }>;
}

interface EntityRow {
  id: string;
  name: string;
  entity_type: string;
  causal_chain: Record<string, unknown> | null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((s): s is string => typeof s === "string");
}

export async function POST(_req: NextRequest, routeCtx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { subObjectiveId } = await routeCtx.params;
  if (!subObjectiveId) {
    return NextResponse.json(
      { error: "subObjectiveId required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Ownership + sub-objective ──
  const { data: sub } = await db
    .from("improvement_goals")
    .select(
      "id, user_id, space_id, title, description, parent_goal_id, room_categories, room_layers_generated_at",
    )
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (!sub || sub.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const spaceId = sub.space_id as string;
  const subObjectiveTitle = (sub.title as string) ?? "";

  // Already complete — nothing to do. The client should regenerate
  // (full reset) if it wants a fresh pass.
  if (sub.room_layers_generated_at) {
    return NextResponse.json({
      summary: { feature_count: 0, edge_count: 0 },
      phase: "complete",
      cached: true,
    });
  }

  // ── Load existing pain + outcome (the reviewed problems/results) ──
  const { data: entityRows } = await db
    .from("entities")
    .select("id, name, entity_type, causal_chain")
    .eq("parent_sub_objective_id", subObjectiveId);
  const entities = (entityRows ?? []) as EntityRow[];
  const painEntities = entities.filter((e) => e.entity_type === "pain_point");
  const outcomeEntities = entities.filter((e) => e.entity_type === "outcome");
  const existingFeatures = entities.filter((e) => e.entity_type === "feature");
  if (painEntities.length === 0 || outcomeEntities.length === 0) {
    return NextResponse.json(
      {
        error:
          "Define problems and results first — this room has no pain/outcome entities to ground mechanisms against.",
      },
      { status: 409 },
    );
  }

  // ── Reconstruct PainItem[] / OutcomeItem[] from causal_chain ──
  // This is where USER EDITS flow into mechanism generation: the
  // feature stage declares bindings against THESE root_causes +
  // indicators, so editing them at the checkpoint changes the chain.
  const pains: PainItem[] = painEntities.map((e) => {
    const cc = e.causal_chain ?? {};
    return {
      name: e.name,
      negative_outcome:
        typeof cc.negative_outcome === "string" ? cc.negative_outcome : "",
      root_causes: stringArray(cc.root_causes),
      influence_rank:
        typeof cc.influence_rank === "number" ? cc.influence_rank : 2.5,
    };
  });
  const outcomes: OutcomeItem[] = outcomeEntities.map((e) => {
    const cc = e.causal_chain ?? {};
    return {
      name: e.name,
      measured_by: typeof cc.measured_by === "string" ? cc.measured_by : "",
      indicators: stringArray(cc.indicators),
    };
  });

  // ── Core objective text + annotations (domain grounding) ──
  const { data: space } = await db
    .from("spaces")
    .select(
      "id, description, input_text, synthesis_data, surface_research, deep_research",
    )
    .eq("id", spaceId)
    .maybeSingle();

  let coreObjectiveText = "";
  let parentAnnotationsRaw: unknown = null;
  if (sub.parent_goal_id) {
    const { data: parent } = await db
      .from("improvement_goals")
      .select("title, description, annotations")
      .eq("id", sub.parent_goal_id)
      .maybeSingle();
    coreObjectiveText =
      (typeof parent?.description === "string" && parent.description.trim()) ||
      (typeof parent?.title === "string" && parent.title.trim()) ||
      "";
    parentAnnotationsRaw = parent?.annotations ?? null;
  } else {
    const { data: rootGoal } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("space_id", spaceId)
      .is("parent_goal_id", null)
      .maybeSingle();
    parentAnnotationsRaw = rootGoal?.annotations ?? null;
  }
  if (!coreObjectiveText) {
    coreObjectiveText =
      (typeof space?.description === "string" && space.description.trim()) ||
      (typeof space?.input_text === "string" && space.input_text.trim()) ||
      "";
  }
  const annotations = normalizeAnnotations(parentAnnotationsRaw);

  // ── Layer ontology — need the features layer id for persistence ──
  const { data: layerRows } = await db
    .from("layer_ontology")
    .select("id, slug")
    .eq("space_id", spaceId);
  const featuresLayerId = ((layerRows ?? []) as Array<{ id: string; slug: string }>).find(
    (r) => r.slug === "features",
  )?.id;
  if (!featuresLayerId) {
    return NextResponse.json(
      { error: "features layer missing for this space" },
      { status: 409 },
    );
  }

  // ── Build the same RoomContext the generator uses ──
  // Categories are already persisted (the define phase wrote them), so
  // we just read room_categories rather than regenerating.
  const roomCategories = normalizeRoomCategories(sub.room_categories);
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
  const hasCategories = Object.keys(categoriesEnum.mechanism).length > 0;

  const state = readObjectiveCanvasState(space?.synthesis_data);
  const clarifyingAnswers: Array<{ question: string; answer: string }> = [];
  if (state.clarifying) {
    for (const q of state.clarifying.questions) {
      const a = state.clarifying.answers[q.id];
      if (a?.status === "answered" && a.value) {
        clarifyingAnswers.push({ question: q.question, answer: a.value });
      }
    }
  }

  const ragBlock = buildRagBlock(
    (space?.surface_research as SurfaceBundle | null) ?? null,
    (space?.deep_research as DeepBundle | null) ?? null,
    { maxSources: 12, maxCharsPerSnippet: 500 },
  );
  const constraints = readConstraints(space?.synthesis_data);
  const cachedAnalysis: CrossRoomAnalysisState | null =
    (space?.synthesis_data?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;
  const learnings = await loadRecentLearnings({
    db,
    userId: auth.user.id,
    spaceId,
    limit: 8,
  });

  const ctx: RoomContext = {
    spaceId,
    userId: auth.user.id,
    subObjectiveId,
    subObjectiveTitle,
    subObjectiveDescription: sub.description,
    coreObjectiveText,
    clarifyingAnswers,
    // layersBySlug is only consumed by the persistence layer, not by
    // generateFeatures — a feature-layer-only map satisfies the type.
    layersBySlug: new Map([
      ["features", { id: featuresLayerId, slug: "features", label: "Features" }],
    ]),
    categories: hasCategories ? categoriesEnum : undefined,
    ragBlock,
    annotations: annotations.length > 0 ? annotations : undefined,
    constraintsBlock: buildConstraintsBlock(constraints),
    crossRoomFindingsBlock: buildCrossRoomFindingsBlock(cachedAnalysis),
    learningsBlock: buildLearningsBlock(learnings, { crossSpace: false }),
  };

  // ── Idempotency: clear prior features + their edges on re-run ──
  if (existingFeatures.length > 0) {
    const featureIds = existingFeatures.map((f) => f.id);
    // Edges touching a feature (declared, correlation, within-layer)
    // all reference a feature on at least one side. Drop both sides.
    await db.from("edges").delete().in("source_entity_id", featureIds);
    await db.from("edges").delete().in("target_entity_id", featureIds);
    await db.from("entities").delete().in("id", featureIds);
  }

  // ── Generate mechanisms (stage C only), fed the reviewed items ──
  let features: Awaited<ReturnType<typeof runMechanismStage>>["features"];
  try {
    ({ features } = await runMechanismStage(ctx, pains, outcomes));
  } catch (err) {
    return NextResponse.json(
      { error: `mechanism generation failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  if (features.length === 0) {
    return NextResponse.json(
      {
        error:
          "No mechanisms could be generated that anchor to the current problems + results. Try sharpening them, then retry.",
      },
      { status: 422 },
    );
  }

  // ── Persist feature entities ──
  const featureRows = features.map((f) => ({
    space_id: spaceId,
    parent_sub_objective_id: subObjectiveId,
    layer_ontology_id: featuresLayerId,
    entity_id: `oc_features_${randomUUID().slice(0, 8)}`,
    name: f.name,
    description: f.positive_outcome,
    entity_type: "feature",
    entity_category: "concrete",
    source_tag: "implicit",
    confidence: 0.65,
    causal_chain: {
      positive_outcome: f.positive_outcome,
      first_principles: f.first_principles,
      addresses: f.addresses ?? [],
      moves: f.moves ?? [],
      sub_category: f.sub_category ?? null,
      derived_from_annotations: f.derived_from_annotations ?? [],
    },
  }));
  const featureInsert = await db
    .from("entities")
    .insert(featureRows)
    .select("id, name");
  if (featureInsert.error) {
    return NextResponse.json(
      { error: "feature insert failed", detail: featureInsert.error.message },
      { status: 500 },
    );
  }
  const insertedFeatures = (featureInsert.data ?? []) as Array<{
    id: string;
    name: string;
  }>;

  // ── Declared-primary edges (shared builder — same as one-shot) ──
  const { rows: declaredEdgeRows, declaredPairs } = buildDeclaredEdgeRows({
    features,
    painEntities: painEntities.map((e) => ({ id: e.id, name: e.name })),
    outcomeEntities: outcomeEntities.map((e) => ({ id: e.id, name: e.name })),
    featureEntities: insertedFeatures,
    spaceId,
    subObjectiveId,
  });
  let edgeCount = 0;
  let declaredEdgeCount = 0;
  if (declaredEdgeRows.length > 0) {
    const dIns = await db.from("edges").insert(declaredEdgeRows).select("id");
    if (dIns.error) {
      console.warn(
        "[room/mechanisms] declared edge insert failed (non-fatal):",
        dIns.error.message,
      );
    } else {
      declaredEdgeCount = (dIns.data ?? []).length;
      edgeCount += declaredEdgeCount;
    }
  }

  // ── itemRefs for the supplementary correlation + within-layer pass ──
  const featureItemById = new Map(insertedFeatures.map((f) => [f.name, f.id]));
  const itemRefs = [
    ...painEntities.map((e) => {
      const cc = e.causal_chain ?? {};
      return {
        id: e.id,
        name: e.name,
        layer: "pain" as const,
        negative_outcome:
          typeof cc.negative_outcome === "string" ? cc.negative_outcome : "",
        root_causes: stringArray(cc.root_causes),
      };
    }),
    ...outcomeEntities.map((e) => {
      const cc = e.causal_chain ?? {};
      return {
        id: e.id,
        name: e.name,
        layer: "outcomes" as const,
        measured_by: typeof cc.measured_by === "string" ? cc.measured_by : "",
      };
    }),
    ...features.map((f) => ({
      id: featureItemById.get(f.name) ?? "",
      name: f.name,
      layer: "features" as const,
      positive_outcome: f.positive_outcome,
      first_principles: f.first_principles,
    })),
  ].filter((r) => r.id);

  // ── Supplementary correlations (deduped against declared) ──
  let correlationWarning: string | null = null;
  try {
    const correlations = await linkCorrelations(ctx, itemRefs);
    const mapPolarity = (
      p: string,
    ): "positive" | "negative" | "neutral" | "conditional" =>
      p === "positive" || p === "negative" || p === "neutral" ? p : "conditional";
    const edgeRows = correlations
      .filter(
        (c) =>
          !declaredPairs.has(`${c.sourceId}|${c.targetId}`) &&
          !declaredPairs.has(`${c.targetId}|${c.sourceId}`),
      )
      .map((c) => {
        const feedback: Record<string, unknown> = {};
        if (c.mechanism) feedback.mechanism = c.mechanism.slice(0, 60);
        if (c.derived_from_annotation)
          feedback.derived_from_annotation = c.derived_from_annotation;
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
    if (edgeRows.length > 0) {
      const cIns = await db.from("edges").insert(edgeRows).select("id");
      if (!cIns.error) edgeCount += (cIns.data ?? []).length;
    }
  } catch (err) {
    correlationWarning = `Correlation step failed: ${sanitizeErrorMessage(err)}. Retry from the side panel.`;
    console.warn("[room/mechanisms] correlation failed (non-fatal):", correlationWarning);
  }

  // ── Within-layer (feature ↔ feature) links ──
  try {
    const within = await linkWithinLayer(ctx, itemRefs);
    if (within.length > 0) {
      const lateralRows = within.map((l) => ({
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
      const lIns = await db.from("edges").insert(lateralRows).select("id");
      if (!lIns.error) edgeCount += (lIns.data ?? []).length;
    }
  } catch (err) {
    console.warn(
      "[room/mechanisms] within-layer failed (non-fatal):",
      sanitizeErrorMessage(err),
    );
  }

  // ── Stamp complete ──
  await db
    .from("improvement_goals")
    .update({ room_layers_generated_at: new Date().toISOString() })
    .eq("id", subObjectiveId);

  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId,
    action: "room_generated",
    metadata: {
      mode: "initial",
      phase: "complete",
      stage: "mechanisms",
      room_layer_counts: {
        pain: painEntities.length,
        features: insertedFeatures.length,
        outcomes: outcomeEntities.length,
      },
      edge_count: edgeCount,
      declared_edge_count: declaredEdgeCount,
      correlation_warning: correlationWarning,
    },
  });

  return NextResponse.json({
    summary: {
      feature_count: insertedFeatures.length,
      edge_count: edgeCount,
    },
    phase: "complete",
    correlation_warning: correlationWarning,
  });
}
