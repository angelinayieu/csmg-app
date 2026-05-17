// ── POST /api/canvas/selection/plan ──
//
// Generates a 3-5 step action plan that ties the selection
// together. Collective scope: one LLM call over all selected
// entities. Each step is inserted as a new entity with
// entity_type='plan_step' linked sequentially via 'precedes'
// edges, and to its source entities via 'derived_from' edges.
//
// Body: { spaceId: string, entityIds: string[] }
// Returns: { plan: { step_entity_ids: string[], edge_ids: string[] } }

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { generatePlan } from "@/lib/canvas/selection-actions-llm";

export const maxDuration = 45;

interface RequestBody {
  spaceId: string;
  entityIds: string[];
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<RequestBody>(request);
  if (parseError) return parseError;

  const { spaceId, entityIds } = body;
  if (typeof spaceId !== "string" || !Array.isArray(entityIds)) {
    return NextResponse.json(
      { error: "spaceId + entityIds[] required" },
      { status: 400 },
    );
  }
  if (entityIds.length < 2) {
    return NextResponse.json(
      { error: "Plan needs ≥2 entities to tie together" },
      { status: 400 },
    );
  }
  if (entityIds.length > 12) {
    return NextResponse.json(
      { error: "Plan supports up to 12 entities per call" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const { data: entities } = await db
      .from("entities")
      .select("id, entity_id, name, description")
      .eq("space_id", spaceId)
      .in("entity_id", entityIds);
    if (!entities || entities.length === 0) {
      return NextResponse.json(
        { error: "No matching entities" },
        { status: 404 },
      );
    }

    const steps = await generatePlan(
      entities as Array<{
        id: string;
        entity_id: string;
        name: string;
        description: string | null;
      }>,
    );
    if (steps.length === 0) {
      return NextResponse.json({
        plan: { step_entity_ids: [], edge_ids: [] },
      });
    }

    // Insert each step as an entity. Generate stable entity_ids so
    // we can build edges in one pass without round-tripping.
    const stepIdMap = new Map<number, string>();
    const newEntities: Array<Record<string, unknown>> = [];
    steps.forEach((s, i) => {
      const entityId = `plan_step_${Date.now()}_${i}_${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      stepIdMap.set(i, entityId);
      newEntities.push({
        space_id: spaceId,
        entity_id: entityId,
        name: `Step ${i + 1} · ${s.name.slice(0, 180)}`,
        description: s.description?.slice(0, 1000) ?? null,
        entity_type: "plan_step",
        entity_category: "process",
        source_tag: "inferred",
        layer: null,
        depth: 0,
        authority_level: "unverified",
        confidence: 0.6,
        is_leverage_point: false,
        is_risk_point: false,
        blast_radius: 0,
      });
    });

    // Sequential 'precedes' edges between consecutive steps; one
    // 'derived_from' edge per step's depends_on input entities.
    const newEdges: Array<Record<string, unknown>> = [];
    for (let i = 0; i < steps.length; i++) {
      const stepEntityId = stepIdMap.get(i);
      if (!stepEntityId) continue;
      // Sequential 'precedes' edge
      if (i > 0) {
        const prev = stepIdMap.get(i - 1);
        if (prev) {
          newEdges.push({
            space_id: spaceId,
            source_entity_id: prev,
            target_entity_id: stepEntityId,
            relationship_type: "precedes",
            dimension: "temporal",
            source_tag: "inferred",
            strength: 0.7,
            polarity: "positive",
            confidence: 0.7,
            is_tradeoff: false,
            is_part_of_cycle: false,
            is_low_confidence: false,
          });
        }
      }
      // Derived-from edges. Only include depends_on values that
      // actually exist in the input set; the LLM occasionally
      // hallucinates references.
      const validDeps = (steps[i].depends_on ?? []).filter((id) =>
        entityIds.includes(id),
      );
      for (const depId of validDeps) {
        newEdges.push({
          space_id: spaceId,
          source_entity_id: depId,
          target_entity_id: stepEntityId,
          relationship_type: "derived_from",
          dimension: "logical",
          source_tag: "inferred",
          strength: 0.6,
          polarity: "positive",
          confidence: 0.65,
          is_tradeoff: false,
          is_part_of_cycle: false,
          is_low_confidence: false,
        });
      }
    }

    const stepIds: string[] = [];
    type InsertedRow = {
      id: string;
      entity_id: string;
      name: string;
      description: string | null;
      entity_category: string | null;
      confidence: number | null;
    };
    let insertedSteps: InsertedRow[] = [];
    if (newEntities.length > 0) {
      const { data } = await db
        .from("entities")
        .insert(newEntities)
        .select("id, entity_id, name, description, entity_category, confidence");
      insertedSteps = (data ?? []) as InsertedRow[];
      for (const row of insertedSteps) stepIds.push(row.id);
    }
    const edgeIds: string[] = [];
    if (newEdges.length > 0) {
      const { data: insertedEdges } = await db
        .from("edges")
        .insert(newEdges)
        .select("id");
      for (const row of (insertedEdges ?? []) as Array<{ id: string }>) {
        edgeIds.push(row.id);
      }
    }

    return NextResponse.json({
      plan: {
        step_entity_ids: stepIds,
        edge_ids: edgeIds,
        entities: insertedSteps,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `plan failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
