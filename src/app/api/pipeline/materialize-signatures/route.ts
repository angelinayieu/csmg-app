// POST /api/pipeline/materialize-signatures
//
// Batch endpoint that seeds NodeSignatures for every entity in a space
// that doesn't already have one. Deterministic, no LLM calls — pure
// function of entity + its edges + its axis memberships.
//
// WHY THIS EXISTS
// ───────────────
// The space-strategizer's `uncertainty` and `controllability_spread`
// signals both read from NodeSignature.basis. If signatures don't
// exist, those two signals return null and the ranker silently
// degrades (2/9 signals missing = garbage composite scores). This
// endpoint ensures every entity in the space has at minimum a seeded
// signature BEFORE the strategizer plans.
//
// TEMPORAL SLOT
// ─────────────
//   intake → frame-extractor ∥ decompose → research → synthesize
//     → [THIS ENDPOINT]         ← seeds signatures from current graph
//     → space-strategizer       ← reads uncertainty + controllability
//     → executors (space_work_queue)
//     → strategy-refresh
//
// Seed is cheap enough (no model calls) to run every cycle. We only
// seed entities that don't have a signature yet; re-seeding would
// overwrite deepen-path work done by executors, which is wrong.
// Callers who want to force a re-seed can pass force=true.
//
// GET variant returns a summary of signature coverage for a space
// (how many entities have signatures, avg residual_uncertainty, etc.)
// so the UI can surface "N of M nodes signed" without loading the
// full entity list.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  seedNodeSignature,
  persistSignature,
  loadAxisMembershipsByEntityId,
} from "@/lib/pipeline/signature-materializer";
import type { Entity, Edge } from "@/types";
import type { NodeSignature } from "@/types/node-signature";

export const maxDuration = 60;
export const runtime = "nodejs";

interface MaterializeRequest {
  space_id: string;
  force?: boolean;           // re-seed entities that already have signatures
  entity_ids?: string[];     // restrict to a subset (otherwise whole space)
  run_id?: string | null;    // optional pipeline_runs.id for event attribution
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Partial<MaterializeRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const force = body?.force === true;
  const entityFilter = Array.isArray(body?.entity_ids) && body!.entity_ids!.length > 0
    ? body!.entity_ids!
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load the entity working set ─────────────────────────────────────
  //
  // We only select the columns we actually need. `node_signature` is
  // JSONB and can be large — load it only to decide whether to skip.
  let entityQuery = db
    .from("entities")
    .select("id, name, entity_category, importance, node_signature")
    .eq("space_id", spaceId);
  if (entityFilter) entityQuery = entityQuery.in("id", entityFilter);

  const { data: entityRows, error: entErr } = await entityQuery;
  if (entErr) {
    console.error("[materialize-signatures] entity load failed:", entErr);
    return NextResponse.json({ error: "Failed to load entities" }, { status: 500 });
  }
  const entities = (entityRows ?? []) as Array<
    Pick<Entity, "id" | "name" | "entity_category" | "importance"> & {
      node_signature: NodeSignature | null;
    }
  >;

  if (entities.length === 0) {
    return NextResponse.json({
      space_id: spaceId,
      total_entities: 0,
      seeded: 0,
      skipped_existing: 0,
      failed: 0,
    });
  }

  // Partition: candidates (need seed) vs already-seeded
  const candidates = force
    ? entities
    : entities.filter((e) => !e.node_signature);
  const skippedExisting = entities.length - candidates.length;

  if (candidates.length === 0) {
    return NextResponse.json({
      space_id: spaceId,
      total_entities: entities.length,
      seeded: 0,
      skipped_existing: skippedExisting,
      failed: 0,
      message: "All entities already have signatures; pass force=true to re-seed.",
    });
  }

  // ── Load edges touching any candidate ──────────────────────────────
  //
  // Single query for the whole batch — fetch every edge in the space
  // and group client-side. For large spaces this is cheaper than N
  // per-entity queries (the .in() predicate returns the same rows
  // regardless of whether candidates is 1 or 1000).
  const candidateIds = candidates.map((e) => e.id);
  const { data: edgeRows, error: edgeErr } = await db
    .from("edges")
    .select("id, source_entity_id, target_entity_id, relationship_type, relation_type")
    .eq("space_id", spaceId);
  if (edgeErr) {
    console.error("[materialize-signatures] edge load failed:", edgeErr);
    return NextResponse.json({ error: "Failed to load edges" }, { status: 500 });
  }
  const allEdges = (edgeRows ?? []) as Edge[];

  const edgesByEntity = new Map<string, Edge[]>();
  for (const id of candidateIds) edgesByEntity.set(id, []);
  for (const e of allEdges) {
    const src = e.source_entity_id;
    const tgt = e.target_entity_id;
    if (src && edgesByEntity.has(src)) edgesByEntity.get(src)!.push(e);
    if (tgt && edgesByEntity.has(tgt) && tgt !== src) edgesByEntity.get(tgt)!.push(e);
  }

  // ── Load axis memberships once for the whole space ─────────────────
  //
  // Returns map entityId → axes[]. Uses pipeline_run_events from the
  // last few runs; missing entities simply get no ring 3, which is
  // fine.
  const axisMap = await loadAxisMembershipsByEntityId(db, spaceId);

  // ── Seed loop ───────────────────────────────────────────────────────
  //
  // Soft-fail per entity: one bad entity shouldn't sink the whole
  // batch. We count seeded/failed separately so the caller can see the
  // breakdown. Persistence is awaited sequentially because Supabase's
  // JS client isn't great at deep parallel writes on a single session.
  let seeded = 0;
  let failed = 0;
  const failures: Array<{ entity_id: string; error: string }> = [];

  for (const ent of candidates) {
    try {
      const edges = edgesByEntity.get(ent.id) ?? [];
      const axisMemberships = axisMap.get(ent.id) ?? [];

      // seedNodeSignature takes the full Entity shape. The partial we
      // loaded is missing columns we don't use (notes, created_at,
      // etc.) — cast is safe because the seeder only reads id,
      // entity_category, importance.
      const sig = seedNodeSignature({
        entity: ent as unknown as Entity,
        edges,
        axisMemberships,
      });

      const ok = await persistSignature(db, ent.id, sig);
      if (ok) {
        seeded++;
      } else {
        failed++;
        failures.push({ entity_id: ent.id, error: "persist returned false" });
      }
    } catch (err) {
      failed++;
      failures.push({
        entity_id: ent.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    space_id: spaceId,
    total_entities: entities.length,
    candidates: candidates.length,
    seeded,
    skipped_existing: skippedExisting,
    failed,
    failures: failures.slice(0, 10), // cap so response doesn't balloon
    run_id: body?.run_id ?? null,
  });
}

// ── GET — coverage summary ────────────────────────────────────────────
//
// Cheap aggregate so the UI can show "47 of 62 nodes signed · avg
// residual 0.42" without loading all 62 entities. Uses a couple of
// head-count queries and one JSONB aggregate.

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { count: totalEntities } = await db
    .from("entities")
    .select("id", { count: "exact", head: true })
    .eq("space_id", spaceId);

  // Pull the node_signature column for the space so we can compute
  // residual_uncertainty in aggregate. Bounded because entities per
  // space rarely exceeds a few hundred.
  const { data: sigRows } = await db
    .from("entities")
    .select("id, node_signature, resolution_zoom")
    .eq("space_id", spaceId);

  const rows = (sigRows ?? []) as Array<{
    id: string;
    node_signature: NodeSignature | null;
    resolution_zoom: number | null;
  }>;

  let signed = 0;
  let residualSum = 0;
  let zoomSum = 0;
  let zoomCount = 0;
  let ringsSum = 0;

  for (const r of rows) {
    if (r.node_signature) {
      signed++;
      residualSum += r.node_signature.residual_uncertainty ?? 0;
      ringsSum += r.node_signature.rings ?? 0;
    }
    if (typeof r.resolution_zoom === "number") {
      zoomSum += r.resolution_zoom;
      zoomCount++;
    }
  }

  return NextResponse.json({
    space_id: spaceId,
    total_entities: totalEntities ?? 0,
    signed,
    unsigned: (totalEntities ?? 0) - signed,
    coverage: totalEntities && totalEntities > 0 ? signed / totalEntities : 0,
    avg_residual_uncertainty: signed > 0 ? residualSum / signed : null,
    avg_rings: signed > 0 ? ringsSum / signed : null,
    avg_resolution_zoom: zoomCount > 0 ? zoomSum / zoomCount : null,
  });
}
