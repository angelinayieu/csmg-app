// ── POST /api/pipeline/decompose-why-chain ───────────────────────────
//
// Adds recursive CAUSAL depth to an already-decomposed space. Without
// this pass, hierarchical decomposition bottoms out at "threads" —
// specific intervention-able concepts — but those threads only have
// ~2 hops of upstream structure. Backward BFS from goals then
// terminates far short of actual root causes and the Kaufman-style
// fan-in diagram we promised never materializes.
//
// What it does:
//   1. Pick the highest-importance threads in the space (default top 6).
//   2. For each thread, call the why-chain LLM once to produce 3 levels
//      of upstream drivers + explicit fan-in edges.
//   3. Write the drivers as entities (layer=claim, entity_category=relational)
//      and the causal edges (relation_type=causes, dimension=causal) so
//      root-tracer's backward BFS will now traverse into them.
//   4. Emit a `why_chain_deepened` structural event so the painter can
//      render the new drivers without a refetch.
//
// Idempotent-ish: we skip threads that already have any why_chain drivers
// attached (checked via provenance.source='why_chain' + parent_thread_id).
// Re-running on a space that's already been deepened is a cheap no-op.
//
// Temporal slot in the chain:
//   decompose-hierarchical → [THIS ENDPOINT] → research → synthesize
//     → root-trace → materialize-signatures → space-strategizer → …
//
// This endpoint is safe to skip: if it fails entirely, root-trace just
// operates on the shallower graph and the strategizer still works. All
// writes are soft-fail; errors get logged, not thrown.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { sanitizeEntity, sanitizeEdge, resilientInsert } from "@/lib/sanitize";
import {
  deepenWhyChainBatch,
  type ThreadInput,
  type WhyChainResult,
} from "@/lib/pipeline/why-chain-deepener";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type { WhyChainDeepenedEvent } from "@/types/pipeline-events";

export const maxDuration = 300;
export const runtime = "nodejs";

// ── Importance ranking for thread selection ──────────────────────────
//
// LLM calls cost money and latency; we can't deepen every thread in a
// dense hierarchical graph. These weights match the coercion order in
// `sanitize.ts` so `fundamental` threads get deepened before `moderate`
// ones. Ties broken by centrality (if populated) then id order.

const IMPORTANCE_WEIGHT: Record<string, number> = {
  fundamental: 4,
  critical: 3,
  important: 2,
  moderate: 1,
  minor: 0,
};

interface WhyChainRequest {
  space_id: string;
  run_id?: string | null;
  /** Limit on threads to deepen in this call. Default 6 — enough to
   *  make BFS meaningful, bounded so a single call stays < 30s typical. */
  max_threads?: number;
  /** Only deepen these specific thread ids (overrides importance pick).
   *  Useful for "user clicked 'go deeper' on this thread". */
  thread_ids?: string[];
  /** Short goal summary passed into the prompt for grounding. If omitted,
   *  we derive one from the space's primary_goal / name. */
  user_goal_summary?: string;
  /** Concurrency of LLM calls. Default 3. */
  concurrency?: number;
  /** Skip DB writes; return the planned driver/edge set in the response. */
  dry_run?: boolean;
  /** Reasoning model override (llmJSON model param). */
  model?: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Partial<WhyChainRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const maxThreads = Math.min(20, Math.max(1, body?.max_threads ?? 6));
  const concurrency = Math.min(8, Math.max(1, body?.concurrency ?? 3));
  const dryRun = body?.dry_run === true;
  const runId = body?.run_id ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const startedAt = Date.now();

  try {
    // ── Load threads + parent context in one pass ──────────────────────
    //
    // We only need thread-layer entities (depth=2) with their parent
    // domain/system names for the prompt frame. Rather than a multi-join
    // query, fetch all relevant entities once and resolve parents in
    // memory — the total row count per space is small (< 300 typically)
    // so the round-trip cost of extra joins outweighs the in-memory walk.
    const { data: rawEntities, error: entError } = await db
      .from("entities")
      .select("id, entity_id, name, description, layer, depth, importance, provenance")
      .eq("space_id", spaceId);

    if (entError) {
      console.error("[why-chain] entity load failed:", entError);
      return NextResponse.json({ error: "Failed to load entities" }, { status: 500 });
    }

    interface EntityRow {
      id: string;
      entity_id: string;
      name: string;
      description: string | null;
      layer: string | null;
      depth: number | null;
      importance: string | null;
      provenance: Record<string, unknown> | null;
    }
    const entities = (rawEntities ?? []) as EntityRow[];
    if (entities.length === 0) {
      return NextResponse.json({
        space_id: spaceId,
        message: "No entities in space; nothing to deepen.",
        deepened: 0,
      });
    }

    // Fetch the composes edges so we can walk parent links for each thread.
    const { data: rawEdges } = await db
      .from("edges")
      .select("source_entity_id, target_entity_id, relationship_type")
      .eq("space_id", spaceId)
      .eq("relationship_type", "composes");

    interface EdgeRow {
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string;
    }
    const composesEdges = (rawEdges ?? []) as EdgeRow[];

    // Map: child_uuid → parent_uuid (composes = parent → child, so we
    // invert to look up a thread's parent domain).
    const parentOf = new Map<string, string>();
    for (const e of composesEdges) {
      // composes: source = parent, target = child.
      parentOf.set(e.target_entity_id, e.source_entity_id);
    }

    const byUuid = new Map<string, EntityRow>();
    for (const e of entities) byUuid.set(e.id, e);

    // Threads = entities at depth 2 OR layer="thread". We accept either
    // because depth is authoritative in Phase 10+ but legacy rows may
    // still rely on the layer string.
    const threads = entities.filter(
      (e) => e.depth === 2 || (e.layer ?? "").toLowerCase() === "thread",
    );

    if (threads.length === 0) {
      return NextResponse.json({
        space_id: spaceId,
        message: "No thread-layer entities found; run decompose-hierarchical first.",
        deepened: 0,
      });
    }

    // ── Idempotency guard: skip already-deepened threads ──────────────
    //
    // If any entity exists with provenance.source='why_chain' and
    // parent_thread_id pointing at a given thread, we consider that
    // thread done. Cheaper than a second round-trip: we already have
    // all entities loaded.
    const deepenedThreadUuids = new Set<string>();
    for (const e of entities) {
      const prov = e.provenance;
      if (!prov || typeof prov !== "object") continue;
      if ((prov as Record<string, unknown>).source !== "why_chain") continue;
      const parentId = (prov as Record<string, unknown>).parent_thread_id;
      if (typeof parentId === "string") deepenedThreadUuids.add(parentId);
    }

    // ── Thread selection ──────────────────────────────────────────────
    let selectedThreads: EntityRow[];
    if (Array.isArray(body?.thread_ids) && body!.thread_ids!.length > 0) {
      const wanted = new Set(body!.thread_ids!);
      selectedThreads = threads.filter(
        (t) => (wanted.has(t.id) || wanted.has(t.entity_id)) && !deepenedThreadUuids.has(t.id),
      );
    } else {
      selectedThreads = threads
        .filter((t) => !deepenedThreadUuids.has(t.id))
        .sort(
          (a, b) =>
            (IMPORTANCE_WEIGHT[b.importance ?? "moderate"] ?? 1) -
            (IMPORTANCE_WEIGHT[a.importance ?? "moderate"] ?? 1),
        )
        .slice(0, maxThreads);
    }

    if (selectedThreads.length === 0) {
      return NextResponse.json({
        space_id: spaceId,
        message: "All threads already deepened, or selection filtered to none.",
        deepened: 0,
        skipped_already_deepened: threads.length - (threads.length - deepenedThreadUuids.size),
      });
    }

    // ── Derive goal-summary for grounding ─────────────────────────────
    //
    // Prefer explicit input → space.primary_goal → first improvement_goal
    // description → space.name. We never fabricate context the user
    // didn't provide; if we genuinely have nothing, we pass undefined.
    let userGoalSummary = body?.user_goal_summary?.trim() || undefined;
    if (!userGoalSummary) {
      const { data: spaceRow } = await db
        .from("spaces")
        .select("name, primary_goal")
        .eq("id", spaceId)
        .maybeSingle();
      if (spaceRow?.primary_goal) userGoalSummary = String(spaceRow.primary_goal);
      else if (spaceRow?.name) userGoalSummary = String(spaceRow.name);
    }

    // ── Build ThreadInput bundles with parent names ───────────────────
    //
    // We walk up the composes chain twice: thread → domain → system.
    // If a link is missing, we just leave the corresponding frame
    // field undefined (the prompt degrades gracefully).
    const threadInputs: ThreadInput[] = selectedThreads.map((t) => {
      const domainUuid = parentOf.get(t.id) ?? null;
      const systemUuid = domainUuid ? parentOf.get(domainUuid) ?? null : null;
      const domainRow = domainUuid ? byUuid.get(domainUuid) : null;
      const systemRow = systemUuid ? byUuid.get(systemUuid) : null;
      return {
        entity_id: t.entity_id,
        name: t.name,
        description: t.description ?? "",
        parent_domain_id: domainRow?.entity_id,
        parent_domain_name: domainRow?.name,
        parent_system_name: systemRow?.name,
        importance: t.importance ?? "moderate",
      };
    });

    // ── Run the deepener ──────────────────────────────────────────────
    console.log(
      `[why-chain] deepening ${threadInputs.length} threads (concurrency=${concurrency}, model=${body?.model ?? "default"})`,
    );
    const results: WhyChainResult[] = await deepenWhyChainBatch(
      threadInputs,
      { userGoalSummary, model: body?.model },
      concurrency,
    );

    // ── Aggregate entities + edges across threads ─────────────────────
    //
    // We collect everything before sanitizing so sanitize sees a coherent
    // batch (matters for edge resolution via entityIdMap).
    const rawEntitiesToInsert: unknown[] = [];
    const rawEdgesToInsert: unknown[] = [];
    const topDrivers: WhyChainDeepenedEvent["topDrivers"] = [];
    let driversTotal = 0;
    let fanInTotal = 0;
    let userControllable = 0;
    let external = 0;

    for (const r of results) {
      driversTotal += r.stats.drivers_total;
      fanInTotal += r.stats.fan_in_count;
      userControllable += r.stats.user_controllable_count;
      external += r.stats.external_count;
      for (const e of r.entities) rawEntitiesToInsert.push(e);
      for (const ed of r.edges) rawEdgesToInsert.push(ed);

      // Pick a representative: the single highest-confidence
      // user_controllable driver from this thread (falls back to
      // highest-confidence any-reason if none). These are the
      // intervention-point candidates the UI wants to surface first.
      const ucCandidates = r.entities.filter(
        (e) => e.provenance.stop_reason === "user_controllable",
      );
      const pool = ucCandidates.length > 0 ? ucCandidates : r.entities;
      const top = pool.sort((a, b) => b.confidence - a.confidence)[0];
      if (top) {
        topDrivers.push({
          entityId: top.entity_id, // display id — resolves to uuid after insert
          name: top.name,
          stopReason: top.provenance.stop_reason,
          causeLevel: top.provenance.cause_level,
          threadId: r.thread_id,
        });
      }
    }

    if (dryRun) {
      return NextResponse.json({
        space_id: spaceId,
        dry_run: true,
        threads_selected: threadInputs.length,
        drivers_total: driversTotal,
        fan_in_total: fanInTotal,
        user_controllable: userControllable,
        external,
        sample_driver: topDrivers[0] ?? null,
        per_thread: results.map((r) => ({ thread_id: r.thread_id, ...r.stats })),
        duration_ms: Date.now() - startedAt,
      });
    }

    // ── Sanitize + insert entities ────────────────────────────────────
    //
    // We seed entityIdMap with existing thread UUIDs BEFORE inserting so
    // driver→thread edges can resolve immediately. Thread display ids
    // come from the entity_id column (not the UUID).
    const entityIdMap = new Map<string, string>();
    for (const e of entities) entityIdMap.set(e.entity_id, e.id);

    let entitiesInserted = 0;
    const sanitizedEntities = rawEntitiesToInsert.map((e) =>
      sanitizeEntity(e, spaceId),
    );
    if (sanitizedEntities.length > 0) {
      const { data: entityData } = await resilientInsert(
        db,
        "entities",
        sanitizedEntities,
        "id, entity_id",
      );
      for (const row of (entityData ?? []) as Array<{ id: string; entity_id: string }>) {
        entityIdMap.set(row.entity_id, row.id);
      }
      entitiesInserted = (entityData ?? []).length;
    }

    // ── Sanitize + insert edges ───────────────────────────────────────
    const sanitizedEdges = rawEdgesToInsert
      .map((e) => sanitizeEdge(e, spaceId, entityIdMap))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    let edgesInserted = 0;
    if (sanitizedEdges.length > 0) {
      const { inserted } = await resilientInsert(db, "edges", sanitizedEdges, "id");
      edgesInserted = inserted;
    }

    // ── Update space row counts ───────────────────────────────────────
    //
    // Best-effort — we don't fail the endpoint if this write fails.
    // Real counts come from fresh SELECTs anyway; this just keeps the
    // denormalized column warm so list views don't need a join.
    try {
      const { count: entityCount } = await db
        .from("entities")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId);
      const { count: edgeCount } = await db
        .from("edges")
        .select("*", { count: "exact", head: true })
        .eq("space_id", spaceId);
      await db
        .from("spaces")
        .update({
          entity_count: entityCount ?? undefined,
          edge_count: edgeCount ?? undefined,
        })
        .eq("id", spaceId);
    } catch (err) {
      console.warn("[why-chain] space count update failed (non-critical):", err);
    }

    // ── Emit structural event ─────────────────────────────────────────
    //
    // topDrivers needs entityId RESOLVED to UUID — the painter otherwise
    // can't cross-reference with the entity table. If a driver failed
    // to insert it doesn't appear in topDrivers (dropped silently).
    if (runId && entitiesInserted > 0) {
      const resolvedTopDrivers = topDrivers
        .map((d) => {
          const uuid = entityIdMap.get(d.entityId);
          if (!uuid) return null;
          return { ...d, entityId: uuid };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .slice(0, 10);

      const event: WhyChainDeepenedEvent = {
        type: "why_chain_deepened",
        threads: threadInputs.map((t) => ({ threadId: t.entity_id, threadName: t.name })),
        driversAdded: entitiesInserted,
        causalEdgesAdded: edgesInserted,
        userControllableCount: userControllable,
        externalCount: external,
        fanInEdgeCount: fanInTotal,
        topDrivers: resolvedTopDrivers,
      };
      await emitStructuralEvent(db, runId, event);
    }

    return NextResponse.json({
      space_id: spaceId,
      threads_deepened: threadInputs.length,
      entities_inserted: entitiesInserted,
      edges_inserted: edgesInserted,
      drivers_total: driversTotal,
      fan_in_total: fanInTotal,
      user_controllable: userControllable,
      external,
      per_thread: results.map((r) => ({ thread_id: r.thread_id, ...r.stats })),
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[why-chain] failed:", err);
    return NextResponse.json(
      { error: `Why-chain deepen failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── GET — read-only: enumerate drivers for a space ────────────────────
//
// Useful for the Root-Cause tree UI that wants to render the whole
// thread×driver graph. Returns all entities whose provenance.source =
// "why_chain" with parent_thread_id and cause_level.

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
    .select("id, entity_id, name, description, importance, confidence, provenance")
    .eq("space_id", spaceId)
    .eq("entity_type", "causal_driver");

  if (error) {
    console.error("[why-chain GET] query failed:", error);
    return NextResponse.json({ error: "Failed to load drivers" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    entity_id: string;
    name: string;
    description: string | null;
    importance: string | null;
    confidence: number | null;
    provenance: Record<string, unknown> | null;
  }>;

  // Enrich: pull stop_reason / cause_level / parent_thread_id out of
  // provenance so the client doesn't have to parse the JSONB itself.
  const drivers = rows.map((r) => {
    const p = r.provenance ?? {};
    return {
      id: r.id,
      entity_id: r.entity_id,
      name: r.name,
      description: r.description,
      importance: r.importance,
      confidence: r.confidence,
      parent_thread_id: (p as Record<string, unknown>).parent_thread_id ?? null,
      parent_driver_id: (p as Record<string, unknown>).parent_driver_id ?? null,
      cause_level: (p as Record<string, unknown>).cause_level ?? null,
      stop_reason: (p as Record<string, unknown>).stop_reason ?? null,
      polarity: (p as Record<string, unknown>).polarity ?? null,
      why_it_causes: (p as Record<string, unknown>).why_it_causes ?? null,
    };
  });

  return NextResponse.json({
    space_id: spaceId,
    count: drivers.length,
    drivers,
  });
}
