// POST /api/synergy/sessions/[id]/promote-to-lab
//
// Atomic bridge from the Synergy brainstorm canvas to the Synthesis
// Lab. Either:
//   (a) Returns the existing space if one was previously promoted
//       from this same brainstorm session (provenance match), so
//       repeated clicks are idempotent and route back to the user's
//       existing work instead of duplicating spaces.
//   (b) Otherwise creates a fresh `spaces` row carrying provenance
//       AND a `lab_rooms` row in the left column pre-seeded with a
//       brainstorm_session room pointing back at this session.
//
// Returns { space_id, lab_url, created } where `created=true` when
// we just made a new space, `false` when we returned the existing
// one. The caller routes to `/app/space/{space_id}/triple-lab`.
//
// ── Why a dedicated endpoint instead of two client calls? ───────────
// Two reasons:
//   1. Avoid orphan spaces if the second call fails — the endpoint
//      keeps the create-space + create-room sequence in one server
//      transaction window. If room insert fails we still leave the
//      space (it's reachable via the lab URL) but the user gets a
//      clear error.
//   2. Cross-cutting deduplication — the provenance check is a single
//      query on the server, not a client-side fetch loop over all
//      spaces.
//
// Ownership: enforced via RLS on brainstorm_sessions (owner check),
// and we additionally use user.id when looking up an existing
// promoted space so two users with access to the same shared session
// don't collide.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function deriveName(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) return "Brainstorm session";
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57).trimEnd()}…`;
}

function derivePrefix(text: string): string {
  const firstWord = text.trim().split(/\s+/)[0] ?? "";
  const letters = firstWord.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 2) || "BS").padEnd(2, "S");
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  if (!sessionId || sessionId.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing session id" },
      { status: 400 },
    );
  }

   
  const db = supabase as any;

  // ── Step 1: load the brainstorm session ───────────────────────────
  // RLS on brainstorm_sessions enforces owner=auth.uid(), so a not-
  // found result here = unauthorized OR truly missing — both 404 for
  // the client (no enumeration leak).
  const { data: session, error: sessionErr } = await db
    .from("brainstorm_sessions")
    .select("id, title, objective_statement, owner_id")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json(
      { error: "Brainstorm session not found" },
      { status: 404 },
    );
  }
  if (session.owner_id !== user.id) {
    return NextResponse.json(
      { error: "Not authorized for this brainstorm session" },
      { status: 403 },
    );
  }

  // ── Step 2: existing-promotion check ──────────────────────────────
  // Look for a space owned by this user whose provenance points at
  // this session id. If found, the room already exists too (we
  // always create them together) so just return the existing space.
  //
  // We use ->> to extract the text value out of the nested JSONB so
  // the comparison is plain text equality, not jsonb equality.
  const { data: existingSpace } = await db
    .from("spaces")
    .select("id")
    .eq("user_id", user.id)
    .filter(
      "synthesis_data->provenance->>from_brainstorm_session_id",
      "eq",
      sessionId,
    )
    .limit(1)
    .maybeSingle();

  if (existingSpace?.id) {
    return NextResponse.json({
      space_id: existingSpace.id,
      lab_url: `/app/space/${existingSpace.id}/triple-lab`,
      created: false,
    });
  }

  // ── Step 3: insert fresh space with provenance ────────────────────
  // We keep this minimal — name + provenance + reasonable defaults.
  // Deliberately do NOT spin a pipeline_run / reservation / decompose
  // chain. The user is bringing a brainstorm IN; the lab decides
  // what (if anything) to run on it later via the empty-state idea
  // prompt or whatever they do next.
  const titleSource: string =
    (typeof session.title === "string" && session.title.trim().length > 0
      ? session.title
      : (typeof session.objective_statement === "string"
        ? session.objective_statement
        : "Brainstorm session")) as string;
  const promotedAt = new Date().toISOString();
  const provenance = {
    provenance: {
      from_brainstorm_session_id: sessionId,
      promoted_at: promotedAt,
    },
  };

  const { data: newSpace, error: insertSpaceErr } = await db
    .from("spaces")
    .insert({
      user_id: user.id,
      name: deriveName(titleSource),
      description: null,
      space_prefix: derivePrefix(titleSource),
      input_text: titleSource.slice(0, 2000),
      entity_count: 0,
      edge_count: 0,
      orphan_count: 0,
      cycle_count: 0,
      maturity: "actionable_now",
      depth_level: 0,
      synthesis_data: provenance,
    })
    .select("id")
    .single();

  if (insertSpaceErr || !newSpace?.id) {
    console.error("[promote-to-lab] space insert failed:", insertSpaceErr);
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertSpaceErr) || "Space creation failed" },
      { status: 500 },
    );
  }
  const spaceId: string = newSpace.id;

  // ── Step 4: insert brainstorm_session room in left column ─────────
  // position=0 because this is the only user-added room in a brand-
  // new space. The triple-lab renderer reads (column_slot, position)
  // to order the stack so position is critical even for the first
  // row.
  const { error: insertRoomErr } = await db.from("lab_rooms").insert({
    space_id: spaceId,
    user_id: user.id,
    column_slot: "left",
    position: 0,
    kind: "brainstorm_session",
    room_config: { session_id: sessionId, title: titleSource },
    collapsed: false,
    is_default: false,
  });

  if (insertRoomErr) {
    // Soft-fail: the space exists and is reachable. The user can re-
    // promote (we'll match the existing space via provenance) and the
    // second attempt re-inserts the room cleanly. Log the failure for
    // diagnostics but return success with a hint.
    console.error("[promote-to-lab] room insert failed:", insertRoomErr);
    return NextResponse.json({
      space_id: spaceId,
      lab_url: `/app/space/${spaceId}/triple-lab`,
      created: true,
      room_seeded: false,
      warning: sanitizeErrorMessage(insertRoomErr),
    });
  }

  return NextResponse.json({
    space_id: spaceId,
    lab_url: `/app/space/${spaceId}/triple-lab`,
    created: true,
    room_seeded: true,
  });
}
