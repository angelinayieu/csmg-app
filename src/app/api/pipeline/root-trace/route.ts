// POST /api/pipeline/root-trace
//
// Backward-traces from every improvement goal in a space along the
// causal edge subgraph (causes/enables/inhibits/moderates/mediates/
// constrains/temporally_precedes), tagging each visited entity with
// causal_depth, converges_chains, is_root_candidate, and root_score.
// Persists results onto the entities table.
//
// WHY THIS EXISTS
// ───────────────
// The strategizer's signals (centrality, intersection_density,
// goal_proximity) measure STRUCTURAL junctions, not causal roots.
// A central node can be a downstream effect-confluence as easily as
// an upstream cause. This endpoint performs the one piece the rest
// of the pipeline was missing: walk BACKWARDS from problems to find
// the deepest-upstream drivers, and flag the nodes where multiple
// goal-chains converge.
//
// TEMPORAL SLOT
// ─────────────
//   intake → frame-extractor ∥ decompose → research → synthesize
//     → [THIS ENDPOINT]          ← backward trace from goals
//     → materialize-signatures   ← seeds w/ causal_depth context
//     → space-strategizer        ← reads causal_depth + convergence_count
//     → executors
//     → strategy-refresh
//
// No LLM calls. Pure graph computation — cheap enough to rerun every
// cycle even on large spaces.
//
// GET variant returns the current root-trace state for a space (top
// roots + counts) without recomputing, so the UI can render the
// Problem→Root tree on read.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { traceRootCauses, persistTraceResults } from "@/lib/pipeline/root-tracer";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type { Entity, Edge } from "@/types";
import type { NodeSignature } from "@/types/node-signature";
import type { RootCauseIdentifiedEvent } from "@/types/pipeline-events";

export const maxDuration = 60;
export const runtime = "nodejs";

interface RootTraceRequest {
  space_id: string;
  run_id?: string | null;
  /** Optional override: trace to these goals instead of the space's
   *  improvement_goals. Useful for scenario analysis ("what if the
   *  goal were X instead?"). */
  goal_entity_ids?: string[];
  /** top-N limit for the emitted event (default 10). */
  top_n?: number;
  /** If true, skip persistence and just return results in the
   *  response body. Useful for preview / UI experimentation. */
  dry_run?: boolean;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Partial<RootTraceRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const topN = Math.min(25, Math.max(1, body?.top_n ?? 10));
  const dryRun = body?.dry_run === true;
  const runId = body?.run_id ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load working set in parallel ────────────────────────────────────
  //
  // Entities + edges + goals in one shot. Node signatures come along
  // on the entities SELECT since they're JSONB columns.
  const [entRes, edgeRes, goalRes] = await Promise.all([
    db.from("entities").select("id, name, space_id, node_signature").eq("space_id", spaceId),
    db
      .from("edges")
      .select("id, source_entity_id, target_entity_id, relation_type, relationship_type")
      .eq("space_id", spaceId),
    db.from("improvement_goals").select("target_entity_id").eq("space_id", spaceId),
  ]);

  if (entRes.error) {
    console.error("[root-trace] entity load failed:", entRes.error);
    return NextResponse.json({ error: "Failed to load entities" }, { status: 500 });
  }

  const entities = (entRes.data ?? []) as Array<
    Pick<Entity, "id" | "name" | "space_id"> & { node_signature: NodeSignature | null }
  >;
  const edges = (edgeRes.data ?? []) as Edge[];

  if (entities.length === 0) {
    return NextResponse.json({
      space_id: spaceId,
      goal_count: 0,
      reachable_count: 0,
      convergence_points: 0,
      root_candidates: 0,
      top_roots: [],
      message: "No entities in space; nothing to trace.",
    });
  }

  // ── Resolve goals ───────────────────────────────────────────────────
  //
  // Priority: explicit override from request → improvement_goals rows.
  // We filter out goals pointing at nonexistent entities (stale FK)
  // because BFS would just skip them silently and users wouldn't know
  // why their trace was empty.
  const entitySet = new Set(entities.map((e) => e.id));
  let goalIds: string[];
  if (Array.isArray(body?.goal_entity_ids) && body!.goal_entity_ids!.length > 0) {
    goalIds = body!.goal_entity_ids!.filter((id) => entitySet.has(id));
  } else {
    goalIds = ((goalRes.data ?? []) as Array<{ target_entity_id: string | null }>)
      .map((g) => g.target_entity_id)
      .filter((v): v is string => typeof v === "string" && entitySet.has(v));
  }

  if (goalIds.length === 0) {
    return NextResponse.json({
      space_id: spaceId,
      goal_count: 0,
      reachable_count: 0,
      convergence_points: 0,
      root_candidates: 0,
      top_roots: [],
      message: "No goals resolved for space; add improvement_goals before tracing.",
    });
  }

  // ── Build signature map for uncertainty_boost in scoring ────────────
  const signatures = new Map<string, NodeSignature>();
  for (const e of entities) {
    if (e.node_signature) signatures.set(e.id, e.node_signature);
  }

  // ── Trace ───────────────────────────────────────────────────────────
  const trace = traceRootCauses(
    {
      entities: entities as unknown as Entity[],
      edges,
      goalEntityIds: goalIds,
      signatures,
    },
    topN,
  );

  // ── Persist (unless dry-run) ───────────────────────────────────────
  let persisted = 0;
  let persistFailed = 0;
  if (!dryRun) {
    const res = await persistTraceResults(db, trace);
    persisted = res.persisted;
    persistFailed = res.failed;
  }

  // ── Emit structural event with entity-name lookup for top roots ────
  //
  // Names make the event self-contained for the canvas painter (no
  // follow-up fetch to resolve "entity X" into something human-readable).
  if (runId && trace.top_roots.length > 0) {
    const event: RootCauseIdentifiedEvent = {
      type: "root_cause_identified",
      goalEntityIds: goalIds,
      reachableCount: trace.reachable_count,
      convergencePoints: trace.convergence_points,
      rootCandidates: trace.root_candidates,
      topRoots: trace.top_roots.map((r) => ({
        entityId: r.entity_id,
        rootScore: r.root_score,
        causalDepth: r.causal_depth,
        convergesChains: r.converges_chains,
      })),
    };
    await emitStructuralEvent(db, runId, event);
  }

  // ── Response ───────────────────────────────────────────────────────
  //
  // Note: we don't return the full per_entity Map — for large spaces
  // that's tens of KB of redundant state already written to the DB.
  // Callers that want per-entity data should re-read entities.
  // Top-N roots are attached because the UI needs them immediately.
  return NextResponse.json({
    space_id: spaceId,
    goal_count: trace.goal_count,
    reachable_count: trace.reachable_count,
    convergence_points: trace.convergence_points,
    root_candidates: trace.root_candidates,
    top_roots: trace.top_roots,
    persisted,
    persist_failed: persistFailed,
    dry_run: dryRun,
    run_id: runId,
  });
}

// ── GET — read-only view ──────────────────────────────────────────────
//
// Returns whatever root-trace state currently lives on entities for
// this space. Used by report renderers and UI tree views that want
// the fan-in diagram without triggering a fresh trace.

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

  const { data, error } = await db
    .from("entities")
    .select("id, name, causal_depth, converges_chains, root_score, is_root_candidate")
    .eq("space_id", spaceId)
    .not("causal_depth", "is", null)
    .order("root_score", { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) {
    console.error("[root-trace GET] query failed:", error);
    return NextResponse.json({ error: "Failed to load trace" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    causal_depth: number | null;
    converges_chains: string[] | null;
    root_score: number | null;
    is_root_candidate: boolean;
  }>;

  // Summary counts — derived from the returned slice, which is
  // capped at 50. A more accurate count would need a second query;
  // we accept the cap here because the UI just needs leading
  // indicators ("~X convergence points") not an exact census.
  let convergencePoints = 0;
  let rootCandidates = 0;
  for (const r of rows) {
    if ((r.converges_chains?.length ?? 0) >= 2) convergencePoints++;
    if (r.is_root_candidate) rootCandidates++;
  }

  return NextResponse.json({
    space_id: spaceId,
    results: rows,
    convergence_points_in_top_50: convergencePoints,
    root_candidates_in_top_50: rootCandidates,
  });
}
