import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, refreshSpaceCounts } from "@/lib/api-helpers";
import { resilientInsert } from "@/lib/sanitize";
import {
  computeExpansionMaterializations,
  buildExpansionEntityRecords,
  buildExpansionEdgeRecords,
  identifyOrphanEntities,
  computeCrossEntityBridges,
  extractScLikesFromEntities,
} from "@/lib/pipeline/expansion-materializer";
import type { Entity, Edge } from "@/types";
import type { ExpansionRow } from "@/lib/pipeline/expansion-materializer";

export const maxDuration = 120;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  try {
    const body = await request.json();
    spaceId = body.spaceId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // 1. Fetch all non-stale expansions for this space
    const { data: expansionsRaw } = await db
      .from("expansions")
      .select("*")
      .eq("space_id", spaceId)
      .eq("stale", false);

    const expansions = (expansionsRaw ?? []) as ExpansionRow[];

    if (expansions.length === 0) {
      return NextResponse.json({
        error: "No expansions found. Run Entity Expansion first.",
      }, { status: 400 });
    }

    // 2. Fetch parent entities and existing graph
    const [parentEntitiesRes, existingEntitiesRes, existingEdgesRes] = await Promise.all([
      db.from("entities").select("*").in(
        "id",
        expansions.map((e) => e.entity_id)
      ),
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
    ]);

    const parentEntities = (parentEntitiesRes.data ?? []) as Entity[];
    const existingEntities = (existingEntitiesRes.data ?? []) as Entity[];
    const existingEdges = (existingEdgesRes.data ?? []) as Edge[];

    // 3. Compute what to materialize (pass existing edges for inherited connections)
    const result = computeExpansionMaterializations(
      expansions,
      parentEntities,
      existingEntities,
      existingEdges,
    );

    // Note: in the past we early-returned when nothing was pending. We now
    // always fall through to the bridge-backfill pass below, because existing
    // SCs from prior expansions may still lack cross-entity bridges that were
    // introduced by a later code path (e.g. before the bridge detector shipped).
    const hasNewMaterializations = result.entities.length > 0;

    let entitiesInserted = 0;
    const entityIdToUuid = new Map<string, string>();
    for (const e of existingEntities) entityIdToUuid.set(e.entity_id, e.id);

    let totalEdgesInserted = 0;
    const materializedExpansionIds: string[] = [];

    if (hasNewMaterializations) {
      // 4. Insert child entities
      const entityRecords = buildExpansionEntityRecords(spaceId, result.entities);
      const { inserted: ei, data: insertedEntityData } = await resilientInsert(
        db,
        "entities",
        entityRecords,
        "id, entity_id",
      );
      entitiesInserted = ei;
      for (const row of insertedEntityData) {
        if (row.entity_id && row.id) entityIdToUuid.set(row.entity_id, row.id);
      }

      // 5. Insert has_component edges (parent → child)
      const componentEdgeRecords = buildExpansionEdgeRecords(
        spaceId,
        result.parent_component_edges,
        entityIdToUuid,
      );
      if (componentEdgeRecords.length > 0) {
        const { inserted } = await resilientInsert(db, "edges", componentEdgeRecords, "id");
        totalEdgesInserted += inserted;
      }

      // 6. Insert pathway + dynamic edges (child → child)
      const internalEdgeRecords = buildExpansionEdgeRecords(
        spaceId,
        result.edges,
        entityIdToUuid,
      );
      if (internalEdgeRecords.length > 0) {
        const { inserted } = await resilientInsert(db, "edges", internalEdgeRecords, "id");
        totalEdgesInserted += inserted;
      }

      // 7. Mark expansions as materialized
      for (const exp of expansions) {
        const parent = parentEntities.find((p) => p.id === exp.entity_id);
        if (parent && result.entities.some((e) => e.expansion_id === exp.id)) {
          materializedExpansionIds.push(exp.id);
        }
      }
      if (materializedExpansionIds.length > 0) {
        await db
          .from("expansions")
          .update({ materialized_at: new Date().toISOString() })
          .in("id", materializedExpansionIds)
          .then(() => {}, (err: unknown) => console.warn("Failed to mark materialized:", err));
      }
    }

    // 7b. Cross-entity bridge BACKFILL across the entire graph.
    //
    // Runs unconditionally so a user with already-expanded entities (from
    // before the bridge detector existed, or across two separately-expanded
    // branches) gets the similarity edges filled in without having to
    // re-expand anything. Purely additive — dedupe against current edges.
    let bridgesInserted = 0;
    try {
      const { data: afterInsertEntities } = await db
        .from("entities")
        .select("*")
        .eq("space_id", spaceId);
      const { data: afterInsertEdges } = await db
        .from("edges")
        .select("*")
        .eq("space_id", spaceId);

      const freshFull = (afterInsertEntities ?? []) as Entity[];
      const freshEdgesFull = (afterInsertEdges ?? []) as Edge[];
      for (const e of freshFull) entityIdToUuid.set(e.entity_id, e.id);

      const allScs = extractScLikesFromEntities(freshFull);
      // For the backfill pass, "new" = every SC — we want to score the entire
      // SC population against itself. computeCrossEntityBridges dedupes
      // internally by pair-key and respects existing edges in the graph.
      const bridges = computeCrossEntityBridges(allScs, [], freshEdgesFull);
      if (bridges.length > 0) {
        const bridgeRecords = buildExpansionEdgeRecords(spaceId, bridges, entityIdToUuid);
        if (bridgeRecords.length > 0) {
          const { inserted } = await resilientInsert(db, "edges", bridgeRecords, "id");
          bridgesInserted = inserted;
          totalEdgesInserted += inserted;
          console.log(`[materialize-expansions] Backfilled ${inserted} cross-entity bridges`);
        }
      }
    } catch (bridgeErr) {
      console.warn(
        "[materialize-expansions] Bridge backfill failed (non-critical):",
        bridgeErr,
      );
    }

    if (!hasNewMaterializations && bridgesInserted === 0) {
      return NextResponse.json({
        message: "All expansions already materialized; no new bridges detected.",
        stats: result.stats,
        bridges_created: 0,
      });
    }

    // 9. Orphan cleanup — delete materialized entities that ended up with 0 edges
    let orphansRemoved = 0;
    try {
      const [freshEntRes, freshEdgRes] = await Promise.all([
        db.from("entities").select("id, entity_id, provenance").eq("space_id", spaceId),
        db.from("edges").select("source_entity_id, target_entity_id").eq("space_id", spaceId),
      ]);
      const freshEntities = (freshEntRes.data ?? []) as Entity[];
      const freshEdges = (freshEdgRes.data ?? []) as Edge[];

      const orphanIds = identifyOrphanEntities(freshEntities, freshEdges);

      // Only delete orphans that were created by expansion materialization
      const matOrphans = orphanIds.filter((oid) => {
        const ent = freshEntities.find((e) => e.id === oid);
        const prov = ent?.provenance as Record<string, unknown> | null;
        return prov?.source_type === "expansion_materialization";
      });

      if (matOrphans.length > 0) {
        await db.from("entities").delete().in("id", matOrphans);
        orphansRemoved = matOrphans.length;
      }
    } catch (err) {
      console.warn("Orphan cleanup failed (non-critical):", err);
    }

    // 10. Refresh space counts
    await refreshSpaceCounts(db, [spaceId]);

    // 11. Log to changelog
    await db.from("space_changelog").insert({
      space_id: spaceId,
      change_type: "expansion_materialization",
      summary: `Materialized ${entitiesInserted} entities + ${totalEdgesInserted} edges (incl. ${bridgesInserted} bridges) from ${materializedExpansionIds.length} expansions`,
      details: {
        ...result.stats,
        entities_inserted: entitiesInserted,
        edges_inserted: totalEdgesInserted,
        bridges_inserted: bridgesInserted,
        orphans_removed: orphansRemoved,
      },
    }).then(() => {}, () => {});

    return NextResponse.json({
      entities_created: entitiesInserted,
      edges_created: totalEdgesInserted,
      bridges_created: bridgesInserted,
      orphans_removed: orphansRemoved,
      stats: result.stats,
    });
  } catch (err) {
    console.error("Materialization error:", err);
    return NextResponse.json({ error: "Materialization failed" }, { status: 500 });
  }
}
