// ── /api/spaces/[id]/lab-rooms/[roomId]/materialize ──────────────────
//
// Phase 8a. Takes the text content of a user-room (today: scratch_note),
// runs it through an LLM noun-phrase extractor, and stages the
// resulting candidate entities into pipeline_candidates so the
// CandidateReviewDrawer can present them for the user to commit.
//
// This is the FIRST user-initiated path that produces candidates —
// distinct from the chain-pipeline path (Phase 7c-4) which fires
// automatically as a side-effect of decompose/synthesize/etc. Here
// the user clicks "Materialize" in a room body and explicitly says
// "I want these ideas on the whiteboard."
//
// Why route through pipeline_candidates instead of inserting entities
// directly?
//   - Consistency with Phase 7c review_each flow: one drawer, one
//     commit path, one materializer per kind.
//   - User retains veto: noun-phrase extraction is noisy; pre-checking
//     the suggestions and letting the user uncheck duds is far better
//     than dumping 12 cards onto the whiteboard.
//   - Audit log: pipeline_candidates rows record what the user kept
//     vs. rejected. Useful telemetry for tuning the extractor prompt.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  stageCandidates,
  type CandidatePayload,
} from "@/lib/pipeline/candidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// LLM call is the bottleneck — give it 30s wall clock. Noun-phrase
// extraction with a few-hundred-token input is typically <5s, but the
// timeout is a safety net for cold-start + retry behavior.
export const maxDuration = 30;

interface Ctx {
  params: Promise<{ id: string; roomId: string }>;
}

// Shape we expect the LLM to return. Validated below before staging.
interface ExtractorResponse {
  candidates: Array<{
    name: string;
    description?: string;
    /** Pre-check this one for the user? Set false on low-confidence
     *  proposals so opt-in is the right default. */
    suggested?: boolean;
    /** Optional category hint that informs the candidate's entity_type
     *  when committed. Free-form; defaults to "abstract". */
    entity_category?: string;
  }>;
}

const EXTRACTOR_SYSTEM = `You are a precise noun-phrase extractor for a knowledge-graph tool.
Given a free-text note from a user, return the most useful 3-10
distinct concepts the user is implicitly proposing as entities on
their whiteboard.

Rules:
- Each candidate must be a noun-phrase or named concept, not a
  full sentence. "Recursive self-improvement" yes; "the system
  improves itself" no.
- Prefer the user's exact phrasing when reasonable; only paraphrase
  to disambiguate or to expand abbreviations.
- Skip empty filler words and generic determiners ("thing", "stuff",
  "idea"). Skip pure connectives ("but", "however").
- Mark a candidate suggested=false when it's lower-confidence (a
  side-mention, a hedged maybe). The user pre-checks suggested ones
  by default, so this is the gate between "I'd commit it without
  thinking" and "I want the user to look at this twice."
- Description is one short sentence (~12 words) capturing what the
  user seems to mean by the concept. Skip if it would just repeat
  the name.
- entity_category is one of: "concept", "mechanism", "actor",
  "outcome", "method", "metric", "constraint", "abstract" (default).

Respond as JSON: { "candidates": [{ "name": str, "description": str?, "suggested": bool?, "entity_category": str? }] }`;

const FALLBACK_RESPONSE: ExtractorResponse = { candidates: [] };

export async function POST(_request: Request, ctx: Ctx) {
  const { id: spaceId, roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load the room ────────────────────────────────────────────────
  const { data: room, error: roomErr } = await db
    .from("lab_rooms")
    .select("id, kind, room_config")
    .eq("id", roomId)
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (roomErr || !room) {
    return NextResponse.json(
      { error: roomErr?.message ?? "Room not found" },
      { status: 404 },
    );
  }
  // Extract the text content. Different room kinds source their text
  // differently: scratch_note stores it inline in room_config.text;
  // brainstorm_session stores only a session_id and we fetch the
  // session's nodes to build an outline. loadRoomText dispatches per
  // kind (and may hit the DB), so it's async.
  const text = await loadRoomText(db, room.kind as string, room.room_config);
  if (!text || text.trim().length === 0) {
    return NextResponse.json(
      { error: "Room is empty — nothing to materialize" },
      { status: 400 },
    );
  }

  // ── Call the LLM ─────────────────────────────────────────────────
  const llmRes = await llmJSON<ExtractorResponse>({
    system: EXTRACTOR_SYSTEM,
    user: `Note text:\n\n${text.slice(0, 4000)}`, // hard cap so a runaway note doesn't burn tokens
    maxTokens: 800,
    temperature: 0.2,
    fallback: FALLBACK_RESPONSE,
    validator: (data) => {
      // Defensive parse — accept the shape even if the LLM omits some
      // optional fields. Reject anything that isn't an object with a
      // candidates array.
      if (
        data &&
        typeof data === "object" &&
        "candidates" in data &&
        Array.isArray((data as ExtractorResponse).candidates)
      ) {
        return data as ExtractorResponse;
      }
      return FALLBACK_RESPONSE;
    },
  });

  const rawCandidates = llmRes.candidates ?? [];
  // Deduplicate by lowercased name — LLM occasionally proposes the
  // same noun twice with slightly different casing. First wins.
  const seen = new Set<string>();
  const filtered = rawCandidates.filter((c) => {
    if (typeof c.name !== "string" || c.name.trim().length === 0) return false;
    const key = c.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (filtered.length === 0) {
    return NextResponse.json(
      { error: "No candidates extracted from this note" },
      { status: 422 },
    );
  }

  // ── Stage as candidates ──────────────────────────────────────────
  const payloads: CandidatePayload[] = filtered.map((c) => ({
    kind: "entity",
    displayName: c.name.trim(),
    displayDescription:
      typeof c.description === "string" && c.description.trim().length > 0
        ? c.description.trim()
        : null,
    suggested: c.suggested !== false, // default true
    payload: {
      name: c.name.trim(),
      description: c.description ?? "",
      entity_category: c.entity_category ?? "abstract",
      entity_type: c.entity_category ?? "abstract",
      // Provenance hint surfaced on the committed entity so the user
      // can later trace "where did this card come from?" → "the
      // scratch note in the left column."
      provenance_source: "room_materialize",
      provenance_room_id: roomId,
      provenance_room_kind: room.kind,
    },
  }));

  const result = await stageCandidates(db, {
    spaceId,
    runId: null, // user-initiated, no pipeline run owns this batch
    userId: user.id,
    stage: "extract",
    candidates: payloads,
  });

  return NextResponse.json({
    batchId: result.batchId,
    staged: result.inserted,
    extracted: filtered.length,
  });
}

/** Per-kind text loader. scratch_note keeps its text inline in
 *  room_config; brainstorm_session keeps only a session_id, so we fetch
 *  that session's nodes and flatten them into an outline the extractor
 *  can read. Returns "" for kinds we don't know how to read yet. */
async function loadRoomText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  kind: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roomConfig: any,
): Promise<string> {
  if (!roomConfig || typeof roomConfig !== "object") return "";

  if (kind === "scratch_note") {
    return typeof roomConfig.text === "string" ? roomConfig.text : "";
  }

  if (kind === "brainstorm_session") {
    const sessionId =
      typeof roomConfig.session_id === "string" ? roomConfig.session_id : null;
    if (!sessionId) return "";
    return loadBrainstormOutline(db, sessionId);
  }

  return "";
}

// Brainstorm nodes (Synergy track) form a parent/child tree of typed
// idea fragments. We flatten the meaningful ones into a bulleted
// outline — label, plus its note when present — so the same noun-phrase
// extractor used for scratch notes can lift entity candidates out of a
// brainstorm. 'ranking' nodes are score artifacts, not ideas, so we
// skip them.
async function loadBrainstormOutline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sessionId: string,
): Promise<string> {
  const { data: nodes } = await db
    .from("brainstorm_nodes")
    .select("kind, label, meta")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (!Array.isArray(nodes) || nodes.length === 0) return "";

  const lines = (nodes as Array<{ kind: string; label: string; meta: string | null }>)
    .filter((n) => n.kind !== "ranking" && typeof n.label === "string" && n.label.trim().length > 0)
    .map((n) => {
      const label = n.label.trim();
      const meta = typeof n.meta === "string" ? n.meta.trim() : "";
      return meta ? `- ${label}: ${meta}` : `- ${label}`;
    });

  return lines.join("\n");
}
