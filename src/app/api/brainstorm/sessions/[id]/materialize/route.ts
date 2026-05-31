// ── POST /api/brainstorm/sessions/[id]/materialize ──────────────────
//
// Route an Objective-Canvas brainstorm session's proposals into the
// SHARED knowledge graph (entities table), reusing the exact same
// pipeline_candidates → materialize machinery the CandidateReviewDrawer
// uses. This is the OC counterpart to the Lab room-materialize path
// (/api/spaces/[id]/lab-rooms/[roomId]/materialize) — but where the Lab
// path runs an LLM noun-phrase extractor over free text, here the
// proposals are ALREADY structured (title + summary), so we map them
// straight to entity candidates with no extraction step.
//
// Why go through pipeline_candidates instead of inserting entities
// directly?
//   - One materializer per kind (materialize-candidates.ts), shared with
//     the Lab commit path. No forked entity-insert code (the user's
//     standing rule: no parallel/orphaned subsystems).
//   - pipeline_candidates rows are an audit trail of what got promoted
//     to the KG and from which brainstorm.
//
// Why stage AND auto-commit in one call (no review drawer)?
//   - In the OC the user's ELECTION in the brainstorm panel is already
//     the human-in-the-loop gate. By the time they hit "→ KG" they've
//     picked the proposals they want. A second review drawer would be
//     redundant. (The Lab path keeps the drawer because its extractor
//     output is noisy and unreviewed.)
//
// Body (all optional):
//   { proposalIds?: string[] }
//     - When provided: materialize exactly these proposals/ideas.
//     - When omitted: default to every green-ribbon item (the
//       ready-to-elect top set) across generated candidates + user
//       ideas. If the session isn't settled yet there is no ranking,
//       so an omitted body yields nothing → 422.
//
// Returns: { batchId, committed, deferred, errored, entityIds[], summary }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { getSession } from "@/lib/brainstorm/sessions";
import {
  stageCandidates,
  type CandidatePayload,
  type CandidateRow,
} from "@/lib/pipeline/candidates";
import {
  materializeCandidate,
  type MaterializeOutcome,
} from "@/lib/pipeline/materialize-candidates";
import type { BrainstormSession } from "@/lib/brainstorm/session-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface Body {
  proposalIds?: unknown;
}

/** One electable thing in a session, normalized across the two sources
 *  (LLM-generated candidates carry title+summary; user-dropped ideas
 *  carry title+body). Keyed by proposal_id / idea id. */
interface Electable {
  id: string;
  title: string;
  description: string;
  /** 0..1 self-reported (candidates) or critique-derived (ideas); falls
   *  back to a neutral mid value when absent. */
  confidence: number;
  /** Carried into provenance so a committed entity traces back to the
   *  intent that produced it. null for user ideas. */
  intentOfOrigin: string | null;
  /** "candidate" | "user_idea" — provenance only. */
  origin: "candidate" | "user_idea";
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { user, error: authError, supabase } = await safeAuth();
  if (authError) return authError;

  const { id: sessionId } = await ctx.params;
  if (!sessionId) {
    return NextResponse.json({ error: "session id required" }, { status: 400 });
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const userId = user.id;

  // ── Load + authorize the session ─────────────────────────────────
  const session = await getSession(db, sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (session.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // ── Build the electable lookup from both sources ─────────────────
  const electables = collectElectables(session);
  if (electables.size === 0) {
    return NextResponse.json(
      { error: "session has no proposals or ideas to materialize" },
      { status: 422 },
    );
  }

  // ── Resolve which ids to materialize ─────────────────────────────
  const requestedIds = sanitizeIdList(body?.proposalIds);
  const targetIds =
    requestedIds.length > 0
      ? requestedIds.filter((id) => electables.has(id))
      : defaultGreenIds(session).filter((id) => electables.has(id));

  if (targetIds.length === 0) {
    return NextResponse.json(
      {
        error:
          requestedIds.length > 0
            ? "none of the requested proposalIds exist in this session"
            : "no green-ribbon proposals to materialize — pass proposalIds explicitly",
      },
      { status: 422 },
    );
  }

  // ── Map proposals → entity candidate payloads ────────────────────
  const payloads: CandidatePayload[] = targetIds.map((id) => {
    const e = electables.get(id)!;
    return {
      kind: "entity",
      displayName: e.title,
      displayDescription: e.description.length > 0 ? e.description : null,
      suggested: true,
      payload: {
        name: e.title,
        description: e.description,
        // Brainstorm proposals don't carry a category — let the
        // materializer default to "abstract" (same as the Lab path).
        entity_category: "abstract",
        entity_type: "abstract",
        confidence: e.confidence,
        // Provenance overrides materializeEntity's default source_type
        // (it spreads payload.provenance LAST), so the committed entity
        // records that it came from this brainstorm session.
        provenance: {
          source_type: "oc_brainstorm",
          source_session_id: sessionId,
          proposal_id: e.id,
          intent_of_origin: e.intentOfOrigin,
          origin: e.origin,
          target_kind: session.target_kind,
        },
      },
    };
  });

  // ── Stage into pipeline_candidates ───────────────────────────────
  const staged = await stageCandidates(db, {
    spaceId: session.space_id,
    runId: null, // user-initiated; no pipeline run owns this batch
    userId,
    stage: "extract",
    candidates: payloads,
  });
  if (staged.inserted === 0) {
    return NextResponse.json(
      { error: "failed to stage candidates (see server logs)" },
      { status: 500 },
    );
  }

  // ── Re-read the rows we just staged ──────────────────────────────
  // stageCandidates returns only a count, not the inserted rows. We
  // need the row ids + the persisted payloads to feed the materializer,
  // so we re-read the batch.
  const { data: rows, error: readErr } = await db
    .from("pipeline_candidates")
    .select("*")
    .eq("space_id", session.space_id)
    .eq("created_by", userId)
    .eq("batch_id", staged.batchId)
    .eq("status", "pending");
  if (readErr) {
    return NextResponse.json(
      { error: `staged but could not re-read batch: ${readErr.message}` },
      { status: 500 },
    );
  }
  const candidates = (rows as CandidateRow[] | null) ?? [];

  // ── Materialize each (election was the gate → auto-commit) ───────
  const outcomes: Record<string, MaterializeOutcome> = {};
  const entityIds: string[] = [];
  for (const c of candidates) {
    const outcome = await materializeCandidate(
      db,
      session.space_id,
      userId,
      c,
    );
    outcomes[c.id] = outcome;
    if (outcome.status === "committed") entityIds.push(outcome.newId);
  }

  // ── Mark committed/deferred rows accepted ────────────────────────
  const acceptedIds = Object.entries(outcomes)
    .filter(([, o]) => o.status === "committed" || o.status === "deferred")
    .map(([id]) => id);
  if (acceptedIds.length > 0) {
    await db
      .from("pipeline_candidates")
      .update({ status: "accepted", decided_at: new Date().toISOString() })
      .in("id", acceptedIds);
  }

  // ── Summary counts for the panel toast ───────────────────────────
  const summary = Object.values(outcomes).reduce(
    (acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return NextResponse.json({
    batchId: staged.batchId,
    committed: entityIds.length,
    deferred: summary.deferred ?? 0,
    errored: summary.error ?? 0,
    entityIds,
    summary,
  });
}

/** Flatten a session's generated candidates + user ideas into one
 *  id-keyed map. Generated candidates win on id collision (they carry
 *  intent provenance), but ids are disjoint in practice. */
function collectElectables(session: BrainstormSession): Map<string, Electable> {
  const map = new Map<string, Electable>();

  for (const gen of session.generations ?? []) {
    for (const c of gen.candidates ?? []) {
      if (typeof c.proposal_id !== "string" || c.proposal_id.length === 0) {
        continue;
      }
      const title = typeof c.title === "string" ? c.title.trim() : "";
      if (title.length === 0) continue;
      map.set(c.proposal_id, {
        id: c.proposal_id,
        title,
        description: typeof c.summary === "string" ? c.summary.trim() : "",
        confidence: typeof c.confidence === "number" ? c.confidence : 0.7,
        intentOfOrigin:
          typeof c.intent_of_origin === "string" ? c.intent_of_origin : null,
        origin: "candidate",
      });
    }
  }

  for (const idea of session.user_added_ideas ?? []) {
    if (typeof idea.id !== "string" || idea.id.length === 0) continue;
    const title = typeof idea.title === "string" ? idea.title.trim() : "";
    if (title.length === 0) continue;
    // Don't clobber a generated candidate that happens to share an id.
    if (map.has(idea.id)) continue;
    map.set(idea.id, {
      id: idea.id,
      title,
      description: typeof idea.body === "string" ? idea.body.trim() : "",
      confidence:
        typeof idea.composite_score === "number" ? idea.composite_score : 0.7,
      intentOfOrigin: null,
      origin: "user_idea",
    });
  }

  return map;
}

/** Default selection when the caller omits proposalIds: every
 *  green-ribbon item (the ready-to-elect set) from the ranking plus any
 *  green user ideas. Empty when the session hasn't been ranked yet. */
function defaultGreenIds(session: BrainstormSession): string[] {
  const ids: string[] = [];
  for (const c of session.ranking?.candidates ?? []) {
    if (c.ribbon === "green" && typeof c.proposal_id === "string") {
      ids.push(c.proposal_id);
    }
  }
  for (const idea of session.user_added_ideas ?? []) {
    if (idea.ribbon === "green" && typeof idea.id === "string") {
      ids.push(idea.id);
    }
  }
  return ids;
}

/** Cast unknown body input to string[] — filters non-strings + empties.
 *  Mirrors the sanitizer in candidates/commit so body drift is safe. */
function sanitizeIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.length > 0) out.push(x);
  }
  return out;
}
