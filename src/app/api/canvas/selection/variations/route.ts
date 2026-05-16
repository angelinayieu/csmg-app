// ── POST /api/canvas/selection/variations ──
//
// Generates alternative framings of entities in a selection.
// Per-item scope: each input entity gets its own set of variations
// inserted as child entities with `parent_of` edges.
//
// Body: { spaceId: string, entityIds: string[] }
// Returns: { created: { variation_ids: string[], edge_ids: string[] } }

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { generateVariations } from "@/lib/canvas/selection-actions-llm";

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
  if (entityIds.length === 0) {
    return NextResponse.json({ created: { variation_ids: [], edge_ids: [] } });
  }
  // Cap at 6 — variations is per-item and N parallel LLM calls is
  // not free. The popover's selection-size guidance limits this in
  // practice; the server cap is a safety net.
  if (entityIds.length > 6) {
    return NextResponse.json(
      { error: "Variations supports up to 6 entities per call" },
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
    // Load parent entities
    const { data: parents } = await db
      .from("entities")
      .select("id, entity_id, name, description")
      .eq("space_id", spaceId)
      .in("entity_id", entityIds);
    if (!parents || parents.length === 0) {
      return NextResponse.json(
        { error: "No matching entities" },
        { status: 404 },
      );
    }

    // Fire variations for each parent in parallel — bounded by the
    // 6-entity cap above so we don't blow past LLM rate limits.
    const variationSets = await Promise.all(
      (
        parents as Array<{
          id: string;
          entity_id: string;
          name: string;
          description: string | null;
        }>
      ).map(async (p) => ({
        parent: p,
        variations: await generateVariations(p),
      })),
    );

    // Insert new entities + edges. Each variation gets its own
    // entity row (entity_id auto-generated, source_tag='inferred',
    // entity_category from the LLM, depth = parent.depth + 1).
    const newEntities: Array<Record<string, unknown>> = [];
    const newEdges: Array<Record<string, unknown>> = [];
    for (const set of variationSets) {
      for (const v of set.variations) {
        const newEntityId = `${set.parent.entity_id}__var_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        newEntities.push({
          space_id: spaceId,
          entity_id: newEntityId,
          name: v.name.slice(0, 200),
          description: v.description?.slice(0, 1000) ?? null,
          entity_type: "concept",
          entity_category: v.entity_category,
          source_tag: "inferred",
          layer: null,
          depth: 1,
          authority_level: "unverified",
          confidence: 0.55,
          is_leverage_point: false,
          is_risk_point: false,
          blast_radius: 0,
        });
        newEdges.push({
          space_id: spaceId,
          source_entity_id: set.parent.entity_id,
          target_entity_id: newEntityId,
          relationship_type: "has_variation",
          dimension: "logical",
          source_tag: "inferred",
          strength: 0.5,
          polarity: "neutral",
          confidence: 0.55,
          is_tradeoff: false,
          is_part_of_cycle: false,
          is_low_confidence: false,
        });
      }
    }

    const insertedEntityIds: string[] = [];
    if (newEntities.length > 0) {
      const { data: inserted } = await db
        .from("entities")
        .insert(newEntities)
        .select("id");
      for (const row of (inserted ?? []) as Array<{ id: string }>) {
        insertedEntityIds.push(row.id);
      }
    }

    const insertedEdgeIds: string[] = [];
    if (newEdges.length > 0) {
      const { data: insertedEdges } = await db
        .from("edges")
        .insert(newEdges)
        .select("id");
      for (const row of (insertedEdges ?? []) as Array<{ id: string }>) {
        insertedEdgeIds.push(row.id);
      }
    }

    return NextResponse.json({
      created: {
        variation_ids: insertedEntityIds,
        edge_ids: insertedEdgeIds,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `variations failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
