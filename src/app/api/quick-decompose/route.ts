import { NextResponse } from "next/server";
import { checkCredits, deductCredits } from "@/lib/credits";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { sanitizeEntity, resilientInsert } from "@/lib/sanitize";
import type { Entity, Edge } from "@/types";

export const maxDuration = 60;

/**
 * Quick Decompose — lightweight companion to /api/reevaluate.
 *
 * Picks 2-3 under-specified but important entities and breaks each into
 * 2-4 child entities in a single LLM call. No research, no embeddings,
 * no expansion records. Just structural decomposition fast.
 *
 * Used by the header "Quick Decompose" button. Costs 1 credit.
 */

interface QuickDecomposeResult {
  decompositions: Array<{
    parent_entity_id: string;   // existing entity_id like "C1"
    children: Array<{
      entity_id: string;        // NEW entity_id — must be unique, e.g. "C1_sub1"
      name: string;
      description: string;
      entity_type?: string;
      entity_category?: string;
      importance?: "fundamental" | "critical" | "important" | "moderate" | "minor";
    }>;
  }>;
}

const MAX_TARGETS = 3;
const MAX_CHILDREN_PER_TARGET = 4;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;
  const { spaceId, targetEntityIds } = body as {
    spaceId?: string;
    targetEntityIds?: string[];
  };
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  try {
    // Credits — 1 credit (quick tier, single LLM call)
    const creditCheck = await checkCredits(db, user.id, "quick");
    if (!creditCheck.hasCredits) {
      return NextResponse.json(
        { error: `Insufficient credits. Need ${creditCheck.required}, have ${creditCheck.balance}.` },
        { status: 402 }
      );
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Fetch current state
    const [entitiesRes, edgesRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
    ]);
    const entities = (entitiesRes.data ?? []) as Entity[];
    const edges = (edgesRes.data ?? []) as Edge[];

    if (entities.length === 0) {
      return NextResponse.json({ error: "No entities to decompose" }, { status: 400 });
    }

    // UUID ↔ entity_id maps
    const entityIdToUuid = new Map<string, string>();
    const uuidToEntityId = new Map<string, string>();
    for (const e of entities) {
      entityIdToUuid.set(e.entity_id, e.id);
      uuidToEntityId.set(e.id, e.entity_id);
    }

    // Degree count — used for heuristic target selection
    const entityDegree = new Map<string, number>();
    for (const e of entities) entityDegree.set(e.entity_id, 0);
    for (const e of edges) {
      const src = uuidToEntityId.get(e.source_entity_id) ?? "";
      const tgt = uuidToEntityId.get(e.target_entity_id) ?? "";
      if (src) entityDegree.set(src, (entityDegree.get(src) ?? 0) + 1);
      if (tgt) entityDegree.set(tgt, (entityDegree.get(tgt) ?? 0) + 1);
    }

    // Pick targets — user-provided wins; else heuristic.
    // Heuristic priority:
    //   1. is_decomposable flag set
    //   2. importance = fundamental or critical
    //   3. thin description (< 80 chars)
    //   4. moderate-or-better connectivity (so decomposition has context)
    const importanceRank: Record<string, number> = {
      fundamental: 4, critical: 3, important: 2, moderate: 1, minor: 0,
    };

    let targets: Entity[] = [];
    if (targetEntityIds && targetEntityIds.length > 0) {
      targets = entities.filter((e) => targetEntityIds.includes(e.entity_id));
    } else {
      targets = [...entities]
        .map((e) => ({
          e,
          score:
            (e.is_decomposable ? 100 : 0) +
            (importanceRank[e.importance ?? "moderate"] ?? 1) * 10 +
            ((e.description?.length ?? 0) < 80 ? 5 : 0) +
            Math.min(5, entityDegree.get(e.entity_id) ?? 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_TARGETS)
        .map((x) => x.e);
    }

    if (targets.length === 0) {
      return NextResponse.json({ error: "No suitable entities to decompose" }, { status: 400 });
    }

    // Build target context for the LLM
    const targetBlock = targets
      .map((t) => {
        const connections = edges
          .filter((e) => e.source_entity_id === t.id || e.target_entity_id === t.id)
          .slice(0, 8)
          .map((e) => {
            const src = uuidToEntityId.get(e.source_entity_id) ?? "?";
            const tgt = uuidToEntityId.get(e.target_entity_id) ?? "?";
            return `  - ${src} → ${tgt} [${e.relationship_type}]`;
          })
          .join("\n");
        return `${t.entity_id}: ${t.name}
  description: ${t.description ?? "(none)"}
  category: ${t.entity_category ?? "concept"}  importance: ${t.importance ?? "moderate"}
  connections:
${connections || "  (none)"}`;
      })
      .join("\n\n");

    // LLM call — decompose each target into 2-4 children
    const result = await llmJSON<QuickDecomposeResult>({
      system: `You are a systems decomposition expert. Given a set of high-level entities, break each one into 2-${MAX_CHILDREN_PER_TARGET} concrete sub-components that together constitute the parent.

Rules:
- Children must be meaningfully distinct — no synonyms, no pure renamings
- Each child must be a concrete mechanism, structure, or variable — NOT vague abstractions
- child entity_id MUST be of the form "<PARENT_ID>_sub<N>" (e.g., "C1_sub1", "C1_sub2")
- description: 1-2 sentences, state what this child is and why it matters
- entity_category: one of "concept", "actor", "process", "resource", "outcome", "constraint", "artifact"
- importance: propagate from parent; children of a critical parent are typically "important"

Do NOT do any research. Base decomposition purely on the parent's name, description, and existing connections.

Return ONLY valid JSON.`,
      user: `Decompose the following ${targets.length} entities into concrete sub-components.

${targetBlock}

Return JSON:
{
  "decompositions": [
    {
      "parent_entity_id": "C1",
      "children": [
        {"entity_id": "C1_sub1", "name": "…", "description": "…", "entity_type": "concept", "entity_category": "process", "importance": "important"},
        {"entity_id": "C1_sub2", "name": "…", "description": "…", "entity_type": "concept", "entity_category": "process", "importance": "important"}
      ]
    }
  ]
}`,
      maxTokens: 4096,
      temperature: 0.3,
    });

    // Build existing entity_id set for uniqueness checks
    const existingEntityIds = new Set(entities.map((e) => e.entity_id));

    // Flatten children → entity insert records (sanitized)
    const newEntityRecords: ReturnType<typeof sanitizeEntity>[] = [];
    const parentChildPairs: Array<{ parentEntityId: string; childEntityId: string }> = [];

    for (const decomp of result.decompositions ?? []) {
      const parentEntityId = decomp.parent_entity_id;
      if (!entityIdToUuid.has(parentEntityId)) continue;
      const parent = entities.find((e) => e.entity_id === parentEntityId);
      if (!parent) continue;

      const takenForParent = new Set<string>();
      for (const child of (decomp.children ?? []).slice(0, MAX_CHILDREN_PER_TARGET)) {
        // Ensure unique entity_id
        let cid = child.entity_id?.trim() || `${parentEntityId}_sub${takenForParent.size + 1}`;
        let n = 1;
        while (existingEntityIds.has(cid) || takenForParent.has(cid)) {
          cid = `${parentEntityId}_sub${takenForParent.size + 1}_${n++}`;
        }
        takenForParent.add(cid);
        existingEntityIds.add(cid);

        // Phase 10: depth-monotonic decomposition. Child sits one layer
        // below the parent (parent depth + 1, capped at 4). sanitizeEntity
        // derives the canonical layer label from this integer.
        const parentDepthVal =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          typeof (parent as any).depth === "number"
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              Math.max(0, Math.min(4, (parent as any).depth))
            : 2;
        const childDepthVal = Math.min(4, parentDepthVal + 1);

        newEntityRecords.push(
          sanitizeEntity(
            {
              entity_id: cid,
              name: child.name,
              description: child.description,
              entity_type: child.entity_type ?? "concept",
              entity_category: child.entity_category ?? parent.entity_category ?? "concept",
              importance: child.importance ?? "important",
              source_tag: "predicted",
              confidence: 0.7,
              is_decomposable: false,
              depth: childDepthVal,
            },
            spaceId
          )
        );
        parentChildPairs.push({ parentEntityId, childEntityId: cid });
      }
    }

    if (newEntityRecords.length === 0) {
      return NextResponse.json({
        added_entities: 0,
        added_edges: 0,
        message: "LLM returned no valid decompositions",
      });
    }

    // Insert entities
    const { inserted: addedEntities, data: insertedRows } = await resilientInsert(
      db,
      "entities",
      newEntityRecords,
      "id, entity_id"
    );

    // Map new entity_id → UUID
    const newEntityUuids = new Map<string, string>();
    for (const row of insertedRows) {
      if (row.entity_id && row.id) newEntityUuids.set(row.entity_id, row.id);
    }

    // Build "part_of" edges: child → parent
    const edgeRecords = parentChildPairs
      .map(({ parentEntityId, childEntityId }) => {
        const parentUuid = entityIdToUuid.get(parentEntityId);
        const childUuid = newEntityUuids.get(childEntityId);
        if (!parentUuid || !childUuid) return null;
        return {
          space_id: spaceId,
          source_entity_id: childUuid,
          target_entity_id: parentUuid,
          relationship_type: "part_of",
          dimension: "structural",
          source_tag: "predicted",
          strength: 0.8,
          polarity: "positive",
          confidence: 0.8,
          conditions: "Decomposition: child is a constituent of parent",
          is_tradeoff: false,
          is_part_of_cycle: false,
          dynamics: null,
          dynamics_properties: null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const { inserted: addedEdges } = edgeRecords.length > 0
      ? await resilientInsert(db, "edges", edgeRecords, "id")
      : { inserted: 0 };

    // Mark parents as expanded/decomposable-handled
    const parentUuidsToUpdate = [...new Set(
      parentChildPairs
        .map(({ parentEntityId }) => entityIdToUuid.get(parentEntityId))
        .filter((x): x is string => !!x)
    )];
    if (parentUuidsToUpdate.length > 0) {
      await db
        .from("entities")
        .update({ is_decomposable: false })
        .in("id", parentUuidsToUpdate);
    }

    // Update space counts
    const [newEntCountRes, newEdgeCountRes] = await Promise.all([
      db.from("entities").select("id", { count: "exact", head: true }).eq("space_id", spaceId),
      db.from("edges").select("id", { count: "exact", head: true }).eq("space_id", spaceId),
    ]);

    await db
      .from("spaces")
      .update({
        entity_count: newEntCountRes.count ?? entities.length + addedEntities,
        edge_count: newEdgeCountRes.count ?? edges.length + addedEdges,
        updated_at: new Date().toISOString(),
      })
      .eq("id", spaceId);

    // Changelog
    await db.from("space_changelog").insert({
      space_id: spaceId,
      version: 1,
      change_type: "quick_decomposition",
      summary: `Quick decompose: +${addedEntities} entities, +${addedEdges} part_of edges across ${targets.length} parents`,
      details: {
        added_entities: addedEntities,
        added_edges: addedEdges,
        parents: targets.map((t) => t.entity_id),
      },
    });

    // Deduct credits (quick tier)
    await deductCredits(db, user.id, "quick", spaceId);

    return NextResponse.json({
      added_entities: addedEntities,
      added_edges: addedEdges,
      parents_decomposed: targets.map((t) => t.entity_id),
    });
  } catch (err) {
    console.error("Quick decompose error:", err);
    return NextResponse.json(
      { error: "Quick decompose failed. Please try again." },
      { status: 500 }
    );
  }
}
