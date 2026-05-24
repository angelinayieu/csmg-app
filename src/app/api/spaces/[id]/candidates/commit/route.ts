// ── /api/spaces/[id]/candidates/commit ───────────────────────────────
//
// Phase 7c-2. Write-side endpoint for the CandidateReviewDrawer.
//
// POST body shape:
//   {
//     accept: string[]   // candidate ids the user picked
//     reject?: string[]  // candidate ids the user explicitly rejected
//                        //   (defaults to all OTHER pending in the
//                        //    same batch when batchId is provided)
//     batchId?: string   // when present + reject omitted, all pending
//                        //   candidates in this batch NOT in `accept`
//                        //   get auto-rejected. Convenient one-shot
//                        //   "commit the picked, drop the rest" call.
//   }
//
// For each accepted candidate the endpoint dispatches on `kind` to
// materialize into the live KG table:
//
//   kind="entity"     → INSERT into entities
//   kind="edge"       → INSERT into edges
//   kind="claim"      → INSERT into claims
//   kind="variation"  → not yet wired — flagged in response.deferred
//   kind="cycle"      → not yet wired — flagged in response.deferred
//
// The two deferred kinds are kept as "accepted but not materialized"
// rows so the audit log preserves the user's decision; a follow-up
// commit (Phase 7c-4 + later) wires their materialize paths once the
// gating routes start emitting them in production.
//
// Returns a per-candidate result map so the drawer can show "12/15
// committed, 3 deferred" with the exact IDs.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import type { CandidateRow } from "@/lib/pipeline/candidates";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface CommitBody {
  accept?: unknown;
  reject?: unknown;
  batchId?: unknown;
}

type MaterializeOutcome =
  | { status: "committed"; newId: string }
  | { status: "rejected" }
  | { status: "deferred"; reason: string }
  | { status: "error"; message: string };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const parsed = await safeJsonParse<CommitBody>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const accept = sanitizeIdList(body.accept);
  const explicitReject = sanitizeIdList(body.reject);
  const batchId =
    typeof body.batchId === "string" && body.batchId.length > 0
      ? body.batchId
      : null;

  if (accept.length === 0 && explicitReject.length === 0 && !batchId) {
    return NextResponse.json(
      { error: "Provide at least one of: accept[], reject[], or batchId" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch the candidate rows. We pull ALL by id-list (or the batch)
  // so we have the payloads to materialize plus the row ids to mark.
  const targetIds = new Set<string>([...accept, ...explicitReject]);
  let query = db
    .from("pipeline_candidates")
    .select("*")
    .eq("space_id", spaceId)
    .eq("created_by", user.id)
    .eq("status", "pending");
  if (batchId) {
    query = query.eq("batch_id", batchId);
  } else {
    query = query.in("id", Array.from(targetIds));
  }

  const { data: rows, error: readErr } = await query;
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const candidates = (rows as CandidateRow[] | null) ?? [];

  // Build the final accept/reject sets. When a batchId is supplied
  // WITHOUT an explicit reject list, everything in the batch NOT in
  // accept gets implicit-rejected.
  const acceptSet = new Set<string>(accept);
  const rejectSet = new Set<string>(explicitReject);
  if (batchId && explicitReject.length === 0) {
    for (const c of candidates) {
      if (!acceptSet.has(c.id)) rejectSet.add(c.id);
    }
  }

  // Per-candidate outcome map.
  const outcomes: Record<string, MaterializeOutcome> = {};

  // ── Materialize accepted ─────────────────────────────────────────
  for (const c of candidates) {
    if (!acceptSet.has(c.id)) continue;
    outcomes[c.id] = await materializeCandidate(db, spaceId, user.id, c);
  }

  // ── Mark all decided rows ────────────────────────────────────────
  // Single UPDATE per status — cheaper than per-row even if it means
  // two round-trips total. Skips rows that errored during materialize.
  const acceptedIds = Object.entries(outcomes)
    .filter(([, o]) => o.status === "committed" || o.status === "deferred")
    .map(([id]) => id);
  const rejectedIds = Array.from(rejectSet);

  if (acceptedIds.length > 0) {
    await db
      .from("pipeline_candidates")
      .update({ status: "accepted", decided_at: new Date().toISOString() })
      .in("id", acceptedIds);
  }
  if (rejectedIds.length > 0) {
    await db
      .from("pipeline_candidates")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .in("id", rejectedIds);
    for (const id of rejectedIds) outcomes[id] = { status: "rejected" };
  }

  // Summary counts for the drawer to render the toast.
  const summary = Object.values(outcomes).reduce(
    (acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return NextResponse.json({ outcomes, summary });
}

// Cast unknown input to string[] safely. Filters out non-strings and
// trims; defends against the body shape drifting.
function sanitizeIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.length > 0) out.push(x);
  }
  return out;
}

// ── Materializers ────────────────────────────────────────────────────
//
// Each candidate kind has its own materialize path because the live
// KG tables have different shapes. Returns an outcome that the caller
// uses to mark the candidate row (or skip it if errored).

async function materializeCandidate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  c: CandidateRow,
): Promise<MaterializeOutcome> {
  try {
    switch (c.kind) {
      case "entity":
        return await materializeEntity(db, spaceId, userId, c);
      case "edge":
        return await materializeEdge(db, spaceId, c);
      case "claim":
        return await materializeClaim(db, spaceId, c);
      case "variation":
      case "cycle":
        // Not yet wired — the route-side staging for these kinds
        // doesn't exist yet (Phase 7c-4 will add it once the parallel
        // WIP in the route files is resolved). When that lands, add
        // the materialize cases here. For now we accept the row but
        // flag it so the drawer can show a "deferred" notice.
        return {
          status: "deferred",
          reason: `Materialize for kind="${c.kind}" not wired yet`,
        };
    }
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function materializeEntity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  c: CandidateRow,
): Promise<MaterializeOutcome> {
  const p = c.payload as Record<string, unknown>;
  const entityIdSemantic =
    typeof p.entity_id === "string" ? p.entity_id : null;
  // Reproduce the chat-path insert pattern so the materialized entity
  // looks the same as one the user typed in by hand. source_tag is
  // 'explicit' because the user explicitly approved it.
  const { data: inserted, error } = await db
    .from("entities")
    .insert({
      space_id: spaceId,
      entity_id:
        entityIdSemantic ??
        (typeof p.name === "string" ? p.name : "candidate").slice(0, 64),
      name: c.display_name,
      description: c.display_description ?? "",
      entity_category: (p.entity_category as string | undefined) ?? "abstract",
      entity_type: (p.entity_type as string | undefined) ?? "abstract",
      source_tag: "explicit",
      importance: (p.importance as string | undefined) ?? "moderate",
      confidence:
        typeof p.confidence === "number" ? p.confidence : 0.75,
      knowledge_layer:
        (p.knowledge_layer as string | undefined) ?? "internal",
      authority_level:
        (p.authority_level as string | undefined) ?? "moderate",
      causal_role: (p.causal_role as string | undefined) ?? null,
      provenance: {
        source_type: "candidate_review",
        candidate_id: c.id,
        run_id: c.run_id,
        stage: c.stage,
        approved_by: userId,
      },
    })
    .select("id")
    .single();
  if (error) {
    return { status: "error", message: error.message };
  }
  return { status: "committed", newId: (inserted as { id: string }).id };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function materializeEdge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  c: CandidateRow,
): Promise<MaterializeOutcome> {
  const p = c.payload as Record<string, unknown>;
  const sourceId = typeof p.source_entity_id === "string" ? p.source_entity_id : null;
  const targetId = typeof p.target_entity_id === "string" ? p.target_entity_id : null;
  if (!sourceId || !targetId) {
    return {
      status: "error",
      message: "Edge candidate missing source_entity_id or target_entity_id",
    };
  }
  const { data: inserted, error } = await db
    .from("edges")
    .insert({
      space_id: spaceId,
      source_entity_id: sourceId,
      target_entity_id: targetId,
      relationship_type:
        (p.relationship_type as string | undefined) ?? "relates_to",
      dimension: (p.dimension as string | undefined) ?? "abstract",
      confidence:
        typeof p.confidence === "number" ? p.confidence : 0.7,
      description: (p.description as string | undefined) ?? null,
    })
    .select("id")
    .single();
  if (error) return { status: "error", message: error.message };
  return { status: "committed", newId: (inserted as { id: string }).id };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function materializeClaim(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  c: CandidateRow,
): Promise<MaterializeOutcome> {
  const p = c.payload as Record<string, unknown>;
  const { data: inserted, error } = await db
    .from("claims")
    .insert({
      space_id: spaceId,
      claim_text: c.display_name,
      claim_type: (p.claim_type as string | undefined) ?? "hypothesis",
      confidence:
        typeof p.confidence === "number" ? p.confidence : 0.7,
      status: "candidate",
      source_type: "agent",
      source_quote: c.display_description ?? "[review_each]",
    })
    .select("id")
    .single();
  if (error) return { status: "error", message: error.message };
  return { status: "committed", newId: (inserted as { id: string }).id };
}
