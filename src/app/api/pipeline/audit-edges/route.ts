// ── POST /api/pipeline/audit-edges ───────────────────────────────────
//
// Runs the edge-auditor consensus agent over every edge in a space.
// The auditor is an INDEPENDENT reviewer — it did not propose any of
// these edges — so its verdict (endorse / dispute / abstain) becomes
// external evidence on each edge's quality. Verdicts are persisted
// into the `edges.agent_feedback` JSONB ledger introduced in
// migration 20260424_agent_consensus.sql.
//
// Temporal slot in the synthesize handoff chain:
//   decompose-hierarchical → decompose-why-chain → research →
//     synthesize → [THIS ENDPOINT] → root-trace →
//     materialize-signatures → space-strategizer → strategy-refresh
//
// The strategizer's multi-profile ranker already overweights
// convergence_count + agent_convergence_count; this endpoint
// supplies a *second* convergence axis (edge-level) so low-confidence
// edges feeding a candidate lose strategizer weight implicitly, and
// the UI can surface contentious edges independently.
//
// Soft-fail throughout: if the LLM batches fail, we still write out
// whatever verdicts we got, skip bad ones, and emit no event. The
// pipeline keeps moving.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { auditEdges, mergeAgentFeedback } from "@/lib/pipeline/edge-auditor";
import type { EdgeAuditorPromptInput } from "@/lib/prompts/edge-auditor";

export const maxDuration = 300;
export const runtime = "nodejs";

// ── Auditor agent identity ───────────────────────────────────────────
//
// Matches AGENT_IDS in src/lib/agents/registry.ts. Hard-coded to
// "edge_auditor" — if we ever run multiple edge-auditor variants
// (e.g. causal-specialist vs. temporal-specialist) we'd extend the
// registry + pass variant via body. Today: one auditor.

const AUDITOR_AGENT_ID = "edge_auditor";

interface AuditEdgesRequest {
  space_id: string;
  run_id?: string | null;
  /** Limit number of edges audited in this call. Default: all. */
  max_edges?: number;
  /** Model override (forwarded to llmJSON). */
  model?: string;
  /** Don't write; return the verdict set so the caller can inspect. */
  dry_run?: boolean;
  /** If true, re-audit edges that already have an entry from this agent.
   *  Default false — cheaper to skip idempotent work. */
  force_reaudit?: boolean;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Partial<AuditEdgesRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const dryRun = body?.dry_run === true;
  const forceReaudit = body?.force_reaudit === true;
  const maxEdges = Math.max(0, body?.max_edges ?? 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const startedAt = Date.now();

  try {
    // ── Load edges + entities in parallel ─────────────────────────────
    const [edgeResp, entityResp, spaceResp] = await Promise.all([
      db
        .from("edges")
        .select(
          "id, source_entity_id, target_entity_id, relationship_type, dimension, polarity, confidence, reasoning, agent_feedback",
        )
        .eq("space_id", spaceId),
      db
        .from("entities")
        .select("id, entity_id, name, importance, entity_category")
        .eq("space_id", spaceId),
      db.from("spaces").select("name, primary_goal").eq("id", spaceId).maybeSingle(),
    ]);

    if (edgeResp.error) {
      console.error("[audit-edges] edge load failed:", edgeResp.error);
      return NextResponse.json({ error: "Failed to load edges" }, { status: 500 });
    }
    if (entityResp.error) {
      console.error("[audit-edges] entity load failed:", entityResp.error);
      return NextResponse.json({ error: "Failed to load entities" }, { status: 500 });
    }

    interface EdgeRow {
      id: string;
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string | null;
      dimension: string | null;
      polarity: string | null;
      confidence: number | null;
      reasoning: string | null;
      agent_feedback: Record<string, unknown> | null;
    }
    interface EntityRow {
      id: string;
      entity_id: string;
      name: string;
      importance: string | null;
      entity_category: string | null;
    }

    const edges = (edgeResp.data ?? []) as EdgeRow[];
    const entities = (entityResp.data ?? []) as EntityRow[];

    if (edges.length === 0) {
      return NextResponse.json({
        space_id: spaceId,
        message: "No edges in space; nothing to audit.",
        edges_audited: 0,
      });
    }

    // UUID → display-id lookup so the auditor prompt only sees semantic ids.
    const displayIdByUuid = new Map<string, string>();
    for (const e of entities) displayIdByUuid.set(e.id, e.entity_id);

    // ── Idempotency filter ────────────────────────────────────────────
    //
    // Default behavior: skip edges where this auditor already left a
    // verdict. We check both endorsements and disputes. force_reaudit
    // bypasses this for cases like re-running after a critic correction.
    const targetEdges = edges.filter((e) => {
      if (forceReaudit) return true;
      const fb = e.agent_feedback ?? {};
      const endorseHit =
        Array.isArray((fb as { endorsements?: unknown[] }).endorsements) &&
        (fb as { endorsements: unknown[] }).endorsements.some(
          (x) => (x as { agent_id?: string })?.agent_id === AUDITOR_AGENT_ID,
        );
      const disputeHit =
        Array.isArray((fb as { disputes?: unknown[] }).disputes) &&
        (fb as { disputes: unknown[] }).disputes.some(
          (x) => (x as { agent_id?: string })?.agent_id === AUDITOR_AGENT_ID,
        );
      return !(endorseHit || disputeHit);
    });

    // Cap the batch if requested. This keeps cost predictable on huge spaces.
    const cappedEdges = maxEdges > 0 ? targetEdges.slice(0, maxEdges) : targetEdges;

    if (cappedEdges.length === 0) {
      return NextResponse.json({
        space_id: spaceId,
        message: "All edges already audited by this agent.",
        edges_audited: 0,
        skipped: edges.length - targetEdges.length,
      });
    }

    // Build prompt inputs. Keys = edge UUIDs so we can round-trip to
    // DB rows without needing source/target lookups on the way back.
    const promptEdges: EdgeAuditorPromptInput["edges"] = cappedEdges
      .map((e) => {
        const src = displayIdByUuid.get(e.source_entity_id);
        const tgt = displayIdByUuid.get(e.target_entity_id);
        // Skip edges whose endpoints we can't resolve (cross-space, stale, etc).
        if (!src || !tgt) return null;
        return {
          edge_key: e.id,
          source_entity_id: src,
          target_entity_id: tgt,
          relationship_type: e.relationship_type ?? "relates_to",
          dimension: e.dimension,
          polarity: e.polarity,
          confidence: e.confidence,
          reasoning: e.reasoning,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (promptEdges.length === 0) {
      return NextResponse.json({
        space_id: spaceId,
        message: "No edges had resolvable endpoints for audit.",
        edges_audited: 0,
      });
    }

    const userGoalSummary =
      (spaceResp?.data as { primary_goal?: string; name?: string } | null)?.primary_goal ||
      (spaceResp?.data as { primary_goal?: string; name?: string } | null)?.name ||
      undefined;

    // ── Run the auditor ───────────────────────────────────────────────
    console.log(
      `[audit-edges] auditing ${promptEdges.length} edges in ${Math.ceil(promptEdges.length / 70)} batches (model=${body?.model ?? "default"})`,
    );
    const result = await auditEdges({
      input: {
        userGoalSummary,
        entities: entities.map((e) => ({
          entity_id: e.entity_id,
          name: e.name,
          entity_category: e.entity_category,
          importance: e.importance,
        })),
        edges: promptEdges,
      },
      model: body?.model,
    });

    if (dryRun) {
      return NextResponse.json({
        space_id: spaceId,
        dry_run: true,
        stats: result.stats,
        summaries: result.summaries,
        sample_verdicts: result.verdicts.slice(0, 10),
        duration_ms: Date.now() - startedAt,
      });
    }

    // ── Merge verdicts into each edge's agent_feedback ───────────────
    //
    // Group verdicts by edge uuid, then issue one UPDATE per row.
    // Edges table can have thousands of rows; we update only those
    // that got a verdict, not the full set. Concurrency-limited so
    // we don't slam the DB pool.
    const verdictsByEdge = new Map<string, typeof result.verdicts>();
    for (const v of result.verdicts) {
      const arr = verdictsByEdge.get(v.edge_key) ?? [];
      arr.push(v);
      verdictsByEdge.set(v.edge_key, arr);
    }

    const edgeByUuid = new Map<string, EdgeRow>();
    for (const e of edges) edgeByUuid.set(e.id, e);

    let endorsedWrites = 0;
    let disputedWrites = 0;
    let writeFailures = 0;

    const WRITE_CONCURRENCY = 6;
    const writeTargets = Array.from(verdictsByEdge.entries()).filter(
      ([, vs]) => vs.some((v) => v.verdict !== "abstain"),
    );
    let writeCursor = 0;
    const writers = Array.from({ length: Math.min(WRITE_CONCURRENCY, writeTargets.length) }, async () => {
      while (writeCursor < writeTargets.length) {
        const idx = writeCursor++;
        const entry = writeTargets[idx];
        if (!entry) break;
        const [edgeId, verdicts] = entry;
        const row = edgeByUuid.get(edgeId);
        if (!row) continue;

        const nextFeedback = mergeAgentFeedback(
          row.agent_feedback,
          AUDITOR_AGENT_ID,
          verdicts,
        );
        for (const v of verdicts) {
          if (v.verdict === "endorse") endorsedWrites++;
          else if (v.verdict === "dispute") disputedWrites++;
        }
        const { error: updateErr } = await db
          .from("edges")
          .update({ agent_feedback: nextFeedback })
          .eq("id", edgeId);
        if (updateErr) {
          writeFailures++;
          console.warn(`[audit-edges] failed to write feedback for edge ${edgeId}:`, updateErr);
        }
      }
    });
    await Promise.all(writers);

    return NextResponse.json({
      space_id: spaceId,
      run_id: body?.run_id ?? null,
      stats: {
        ...result.stats,
        rows_written: endorsedWrites + disputedWrites,
        endorsements_persisted: endorsedWrites,
        disputes_persisted: disputedWrites,
        write_failures: writeFailures,
      },
      summaries: result.summaries,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[audit-edges] failed:", err);
    return NextResponse.json(
      { error: `Edge audit failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── GET — read-only: fetch current feedback ledger for a space ───────
//
// Returns each edge's agent_feedback so UIs can render contention
// badges without having to query the full `edges` table themselves.

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
    .from("edges")
    .select("id, source_entity_id, target_entity_id, relationship_type, agent_feedback")
    .eq("space_id", spaceId);

  if (error) {
    console.error("[audit-edges GET] query failed:", error);
    return NextResponse.json({ error: "Failed to load edge feedback" }, { status: 500 });
  }

  interface FeedbackRow {
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string | null;
    agent_feedback: Record<string, unknown> | null;
  }

  const rows = (data ?? []) as FeedbackRow[];
  let contentedCount = 0;
  let endorsedOnlyCount = 0;
  let disputedOnlyCount = 0;
  let unreviewedCount = 0;

  const feedback = rows.map((r) => {
    const fb = r.agent_feedback ?? {};
    const endorsements = Array.isArray((fb as { endorsements?: unknown[] }).endorsements)
      ? (fb as { endorsements: unknown[] }).endorsements
      : [];
    const disputes = Array.isArray((fb as { disputes?: unknown[] }).disputes)
      ? (fb as { disputes: unknown[] }).disputes
      : [];
    if (endorsements.length > 0 && disputes.length > 0) contentedCount++;
    else if (endorsements.length > 0) endorsedOnlyCount++;
    else if (disputes.length > 0) disputedOnlyCount++;
    else unreviewedCount++;
    return {
      edge_id: r.id,
      source_entity_id: r.source_entity_id,
      target_entity_id: r.target_entity_id,
      relationship_type: r.relationship_type,
      endorsement_count: endorsements.length,
      dispute_count: disputes.length,
      feedback: { endorsements, disputes },
    };
  });

  return NextResponse.json({
    space_id: spaceId,
    count: feedback.length,
    summary: {
      edges_total: feedback.length,
      contested: contentedCount,
      endorsed_only: endorsedOnlyCount,
      disputed_only: disputedOnlyCount,
      unreviewed: unreviewedCount,
    },
    feedback,
  });
}
