// ── GET /api/synergy/matches ──
//
// Returns the requesting user's matches across ALL their sessions,
// ordered by final_score desc. Each row is redacted to enforce the
// "anonymous-until-accepted" privacy boundary:
//
//   Visible to the requester about the OTHER side:
//     - matching component (label_public + description_public + kind/subkind)
//     - the other user's objective_statement (high-level only)
//     - match_kind + score + rationale
//
//   NOT visible:
//     - the other user's display_name, email, avatar, or any PII
//     - the other user's other components
//     - the other user's bio
//
// Pagination via ?cursor=<computed_at_iso>&limit=20 (default 20).
//
// Query params:
//   match_kind: filter by 'a_needs_b' | 'b_needs_a' | 'parallel'
//   min_score:  filter by final_score >= N
//   limit:      page size (max 50)

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 15;

interface MatchRow {
  id: string;
  component_a: string;
  component_b: string;
  match_kind: string;
  cosine_sim: number;
  complementarity_score: number;
  goal_alignment_score: number;
  final_score: number;
  rationale: string;
  computed_at: string;
}

interface ComponentRow {
  id: string;
  owner_id: string;
  session_id: string;
  kind: string;
  subkind: string | null;
  label_public: string;
  description_public: string;
}

interface SessionRow {
  id: string;
  owner_id: string;
  objective_statement: string | null;
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { searchParams } = new URL(request.url);
  const matchKindFilter = searchParams.get("match_kind");
  const minScore = Number(searchParams.get("min_score") ?? "0");
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20")));
  const cursor = searchParams.get("cursor");

  // Fetch matches where either side belongs to the requesting user.
  // RLS gates this read; we additionally pre-filter at the SQL layer
  // for the explicit user-side check (faster than relying on RLS
  // index hits alone).
  // Strategy: query `brainstorm_components` for owned ids, then query
  // matches that mention either side, then redact + project.
  const { data: ownedComponents } = await db
    .from("brainstorm_components")
    .select("id")
    .eq("owner_id", user.id);
  const ownedIds = ((ownedComponents ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ownedIds.length === 0) {
    return NextResponse.json({ matches: [], next_cursor: null });
  }

  let query = db
    .from("component_matches")
    .select(
      "id, component_a, component_b, match_kind, cosine_sim, complementarity_score, goal_alignment_score, final_score, rationale, computed_at",
    )
    .or(
      `component_a.in.(${ownedIds.join(",")}),component_b.in.(${ownedIds.join(",")})`,
    )
    .gte("final_score", minScore)
    .order("final_score", { ascending: false })
    .order("computed_at", { ascending: false })
    .limit(limit + 1); // +1 to detect next page

  if (matchKindFilter && ["a_needs_b", "b_needs_a", "parallel"].includes(matchKindFilter)) {
    query = query.eq("match_kind", matchKindFilter);
  }
  if (cursor) {
    query = query.lt("computed_at", cursor);
  }

  const { data: matchRows, error: matchErr } = await query;
  if (matchErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(matchErr) },
      { status: 500 },
    );
  }
  const matches = (matchRows ?? []) as MatchRow[];

  // Hydrate both components on each row in a single in() query
  const componentIds = new Set<string>();
  for (const m of matches) {
    componentIds.add(m.component_a);
    componentIds.add(m.component_b);
  }
  const { data: componentRows } = await db
    .from("brainstorm_components")
    .select(
      "id, owner_id, session_id, kind, subkind, label_public, description_public",
    )
    .in("id", Array.from(componentIds));
  const componentById = new Map<string, ComponentRow>(
    ((componentRows ?? []) as ComponentRow[]).map((c) => [c.id, c]),
  );

  // Hydrate "their objective" via the session row for the OTHER side
  const otherSessionIds = new Set<string>();
  for (const m of matches) {
    const a = componentById.get(m.component_a);
    const b = componentById.get(m.component_b);
    if (a && a.owner_id !== user.id) otherSessionIds.add(a.session_id);
    if (b && b.owner_id !== user.id) otherSessionIds.add(b.session_id);
  }
  const { data: sessionRows } = await db
    .from("brainstorm_sessions")
    .select("id, owner_id, objective_statement")
    .in("id", Array.from(otherSessionIds));
  const sessionById = new Map<string, SessionRow>(
    ((sessionRows ?? []) as SessionRow[]).map((s) => [s.id, s]),
  );

  // Build redacted response rows
  const hydrated = matches
    .slice(0, limit)
    .map((m) => {
      const a = componentById.get(m.component_a);
      const b = componentById.get(m.component_b);
      if (!a || !b) return null;

      const mineIsA = a.owner_id === user.id;
      const mine = mineIsA ? a : b;
      const theirs = mineIsA ? b : a;
      const theirSession = sessionById.get(theirs.session_id);

      // Flip match_kind from canonical-ordered to "mine→theirs" frame
      // so the UI can say "you produce / they need" directly without
      // gymnastics. Stored kind is in canonical (component_a) frame.
      let theirRole: "complement" | "parallel";
      if (m.match_kind === "parallel") {
        theirRole = "parallel";
      } else {
        // canonical 'a_needs_b' means component_a needs component_b
        const mineNeeds =
          (mineIsA && m.match_kind === "a_needs_b") ||
          (!mineIsA && m.match_kind === "b_needs_a");
        theirRole = mineNeeds ? "complement" : "complement";
      }
      // mine_needs_theirs vs theirs_needs_mine semantics expressed cleanly
      const mineNeedsTheirs =
        (mineIsA && m.match_kind === "a_needs_b") ||
        (!mineIsA && m.match_kind === "b_needs_a");
      const theirsNeedsMine =
        (mineIsA && m.match_kind === "b_needs_a") ||
        (!mineIsA && m.match_kind === "a_needs_b");

      return {
        id: m.id,
        // My side (full info — it's my own component)
        mine: {
          id: mine.id,
          session_id: mine.session_id,
          kind: mine.kind,
          subkind: mine.subkind,
          label_public: mine.label_public,
          description_public: mine.description_public,
        },
        // Their side — redacted: no owner_id, no display_name, no
        // bio. Only the matching component + the high-level objective.
        theirs: {
          // We expose component id so the user can connect on it later
          // (Phase 4c). Their owner_id stays hidden.
          id: theirs.id,
          kind: theirs.kind,
          subkind: theirs.subkind,
          label_public: theirs.label_public,
          description_public: theirs.description_public,
          objective_statement: theirSession?.objective_statement ?? null,
        },
        direction: {
          kind: theirRole,
          mine_needs_theirs: mineNeedsTheirs,
          theirs_needs_mine: theirsNeedsMine,
        },
        scores: {
          final: Math.round(m.final_score),
          complementarity: Math.round(m.complementarity_score),
          goal_alignment: Math.round(m.goal_alignment_score),
          cosine_sim: m.cosine_sim,
        },
        rationale: m.rationale,
        computed_at: m.computed_at,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const nextCursor =
    matches.length > limit ? matches[limit - 1]?.computed_at ?? null : null;

  return NextResponse.json({
    matches: hydrated,
    next_cursor: nextCursor,
  });
}
