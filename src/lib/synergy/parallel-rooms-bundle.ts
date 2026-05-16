// ── Parallel-path rooms bundle (server fetcher) ──
//
// Assembles the "parallel" half of the Rooms surface for a single
// user. Lives outside the page component so it stays testable + so
// the rooms/page.tsx stays focused on the collab half it already
// fetches.
//
// All reads are RLS-gated — no service-role here. The policies we
// wrote in 20260812_synergy_parallel_paths.sql ensure the user can
// only see their own strategy_matches, their own pending requests,
// and rooms they're a member of.
//
// Strategy: do 4 independent parallel reads first (Q1-Q4), derive the
// "engaged partner pairs" set in JS, then do 4 more parallel reads
// for hydration (Q5-Q8). Total wall time ≈ 2 round trips.

import type {
  ActiveParallelRoomCard,
  ParallelInvitationCard,
  ParallelRoomsSlice,
  SuggestedParallelMatch,
} from "@/app/app/synergy/rooms/rooms-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

interface MyStrategyRow {
  id: string;
  session_id: string;
  statement: string | null;
  status: string;
  matchable: boolean;
  embedding_present: boolean;
}

interface StrategyMatchRow {
  id: string;
  strategy_a: string;
  strategy_b: string;
  cosine_sim: number;
  rerank_score: number;
  shared_theme: string;
  shared_pillars: string[];
  divergence_summary: string | null;
  final_score: number;
}

interface ParallelPathRequestRow {
  id: string;
  from_user: string;
  to_user: string;
  from_strategy: string;
  to_strategy: string;
  message: string | null;
  status: string;
  created_at: string;
  expires_at: string;
}

interface ActiveParallelRoomRow {
  id: string;
  user_a: string;
  user_b: string;
  strategy_a_id: string | null;
  strategy_b_id: string | null;
  shared_theme: string | null;
  shared_pillars: string[] | null;
  created_at: string;
}

/**
 * Build the parallel-path slice of the Rooms bundle for the given user.
 *
 * Soft-failing throughout: every read tolerates a null/error result by
 * defaulting to an empty array. The rooms surface should still render
 * if one underlying table query hiccups.
 */
export async function loadParallelBundle(
  db: Db,
  userId: string,
): Promise<ParallelRoomsSlice> {
  // ── Wave 1: independent parallel reads ──

  const [
    myStrategiesRes,
    activeRoomsRes,
    requestsRes,
  ] = await Promise.all([
    // Q1: my strategies (all states — we use status + matchable to gate
    // empty-state copy)
    db
      .from("synergy_strategies")
      .select(
        "id, session_id, statement, status, matchable, embedding",
      )
      .in(
        "session_id",
        // sub-select via separate query because Supabase JS doesn't do
        // correlated sub-selects cleanly; doing it as a join below
        // would be simpler but RLS won't allow cross-table joins
        // through synergy_strategies. We rely on RLS to scope this
        // to the caller's sessions; an attacker who passes user_id
        // can't read other users' strategies anyway.
        await myStrategySessionIds(db, userId),
      ),
    // Q2: my active parallel_path rooms (RLS gates membership)
    db
      .from("synergy_rooms")
      .select(
        "id, user_a, user_b, strategy_a_id, strategy_b_id, shared_theme, shared_pillars, created_at",
      )
      .eq("room_kind", "parallel_path")
      .is("archived_at", null)
      .or(`user_a.eq.${userId},user_b.eq.${userId}`),
    // Q3: all my parallel_path_requests (both directions, any status —
    // we filter to non-terminal in JS)
    db
      .from("parallel_path_requests")
      .select(
        "id, from_user, to_user, from_strategy, to_strategy, message, status, created_at, expires_at",
      )
      .or(`from_user.eq.${userId},to_user.eq.${userId}`),
  ]);

  const myStrategies: MyStrategyRow[] = (
    (myStrategiesRes?.data ?? []) as Array<{
      id: string;
      session_id: string;
      statement: string | null;
      status: string;
      matchable: boolean;
      // We don't fetch the actual vector — just whether it's present.
      embedding: number[] | null;
    }>
  ).map((r) => ({
    id: r.id,
    session_id: r.session_id,
    statement: r.statement,
    status: r.status,
    matchable: r.matchable,
    embedding_present: r.embedding !== null && r.embedding !== undefined,
  }));

  const activeRooms = (activeRoomsRes?.data ?? []) as ActiveParallelRoomRow[];
  const allRequests = (requestsRes?.data ?? []) as ParallelPathRequestRow[];

  const myStrategyIds = myStrategies.map((s) => s.id);
  const myMatchableStrategyIds = myStrategies
    .filter((s) => s.matchable && s.status === "published" && s.embedding_present)
    .map((s) => s.id);

  // ── Q4: strategy_matches referencing my strategies ──
  let matchesRes: { data: StrategyMatchRow[] | null } | null = null;
  if (myStrategyIds.length > 0) {
    matchesRes = (await db
      .from("strategy_matches")
      .select(
        "id, strategy_a, strategy_b, cosine_sim, rerank_score, shared_theme, shared_pillars, divergence_summary, final_score",
      )
      .or(
        `strategy_a.in.(${myStrategyIds.join(",")}),strategy_b.in.(${myStrategyIds.join(",")})`,
      )
      .order("final_score", { ascending: false })) as {
      data: StrategyMatchRow[] | null;
    };
  }
  const allMatches = (matchesRes?.data ?? []) as StrategyMatchRow[];

  // ── Derive engaged-partner pairs (filter set for suggested) ──
  //
  // A match is "engaged" if there's any of:
  //   - an active room between the two strategies
  //   - a pending or accepted parallel_path_request between the two
  //     strategies (either direction)
  // Engaged matches don't surface as "suggested" — they're either
  // already an active room (shown in Active) or in the request flow.

  const engagedStrategyPairKeys = new Set<string>();
  const pairKey = (a: string, b: string) =>
    a < b ? `${a}::${b}` : `${b}::${a}`;

  for (const r of activeRooms) {
    if (r.strategy_a_id && r.strategy_b_id) {
      engagedStrategyPairKeys.add(pairKey(r.strategy_a_id, r.strategy_b_id));
    }
  }
  // Pending or accepted (not declined/expired) requests count as engaged.
  const liveRequests = allRequests.filter(
    (r) => r.status === "pending" || r.status === "accepted",
  );
  for (const r of liveRequests) {
    engagedStrategyPairKeys.add(pairKey(r.from_strategy, r.to_strategy));
  }

  // ── Wave 2: hydrate the suggested matches' "other side" strategies ──

  const suggestedRaw = allMatches.filter((m) => {
    const key = pairKey(m.strategy_a, m.strategy_b);
    return !engagedStrategyPairKeys.has(key);
  });

  // Collect the OTHER strategy id from each suggested match
  const theirStrategyIds = suggestedRaw.map((m) => {
    return myStrategyIds.includes(m.strategy_a) ? m.strategy_b : m.strategy_a;
  });

  // We need: their strategy's session_id (for owner) and plan_step count.
  // Two parallel queries.
  const [theirStrategiesRes, theirPlanStepCountsRes] = await Promise.all([
    theirStrategyIds.length > 0
      ? db
          .from("synergy_strategies")
          .select("id, session_id, status, matchable, current_generation_id")
          .in("id", theirStrategyIds)
      : Promise.resolve({ data: [] }),
    theirStrategyIds.length > 0
      ? db
          .from("synergy_strategy_blocks")
          .select("strategy_id, generation_id, block_type")
          .in("strategy_id", theirStrategyIds)
          .eq("block_type", "plan_step")
      : Promise.resolve({ data: [] }),
  ]);

  interface TheirStrategy {
    id: string;
    session_id: string;
    status: string;
    matchable: boolean;
    current_generation_id: string | null;
  }
  const theirStrategies = (theirStrategiesRes?.data ?? []) as TheirStrategy[];

  // Plan step count per their strategy (filtered to current generation)
  const planStepCountByStrategy = new Map<string, number>();
  for (const block of (theirPlanStepCountsRes?.data ?? []) as Array<{
    strategy_id: string;
    generation_id: string;
  }>) {
    const strategy = theirStrategies.find((t) => t.id === block.strategy_id);
    if (!strategy) continue;
    if (
      strategy.current_generation_id &&
      block.generation_id !== strategy.current_generation_id
    ) {
      continue;
    }
    planStepCountByStrategy.set(
      block.strategy_id,
      (planStepCountByStrategy.get(block.strategy_id) ?? 0) + 1,
    );
  }

  // ── Wave 2 (cont'd): hydrate active rooms' check-in counts + profiles ──

  const activeRoomIds = activeRooms.map((r) => r.id);
  const otherUserIdsForRooms = activeRooms.map((r) =>
    r.user_a === userId ? r.user_b : r.user_a,
  );

  const [
    checkinCountsRes,
    activeRoomBlockCountsRes,
    activeRoomProfilesRes,
    activeRoomDigestsRes,
  ] = await Promise.all([
    activeRoomIds.length > 0
      ? db
          .from("plan_step_checkins")
          .select("room_id, user_id, marked_complete_at")
          .in("room_id", activeRoomIds)
      : Promise.resolve({ data: [] }),
    // For each active room, we need plan_step counts for BOTH strategies
    activeRooms.length > 0
      ? db
          .from("synergy_strategy_blocks")
          .select("strategy_id, generation_id, block_type")
          .in(
            "strategy_id",
            activeRooms.flatMap((r) =>
              [r.strategy_a_id, r.strategy_b_id].filter(Boolean),
            ) as string[],
          )
          .eq("block_type", "plan_step")
      : Promise.resolve({ data: [] }),
    otherUserIdsForRooms.length > 0
      ? db
          .from("synergy_profiles")
          .select("user_id, display_name, avatar_url")
          .in("user_id", otherUserIdsForRooms)
      : Promise.resolve({ data: [] }),
    // Latest digest per active room (for the card delta tail). We pull
    // ALL digests per room and pick the most recent in JS — Supabase JS
    // doesn't expose window-function aggregates cleanly. The row count
    // is small (≤ ~52 per room per year), so this is fine.
    activeRoomIds.length > 0
      ? db
          .from("room_digests")
          .select(
            "room_id, week_starting, user_a_completions, user_b_completions",
          )
          .in("room_id", activeRoomIds)
          .order("week_starting", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  // We also need each room's strategies' current_generation_id so we
  // only count blocks for the live generation.
  const activeRoomStrategyIds = activeRooms.flatMap((r) =>
    [r.strategy_a_id, r.strategy_b_id].filter(Boolean),
  ) as string[];
  let activeRoomStrategyGens: Map<string, string | null> = new Map();
  if (activeRoomStrategyIds.length > 0) {
    const { data: gens } = await db
      .from("synergy_strategies")
      .select("id, current_generation_id")
      .in("id", activeRoomStrategyIds);
    activeRoomStrategyGens = new Map(
      ((gens ?? []) as Array<{
        id: string;
        current_generation_id: string | null;
      }>).map((g) => [g.id, g.current_generation_id]),
    );
  }

  const blockCountByActiveStrategy = new Map<string, number>();
  for (const block of (activeRoomBlockCountsRes?.data ?? []) as Array<{
    strategy_id: string;
    generation_id: string;
  }>) {
    const gen = activeRoomStrategyGens.get(block.strategy_id);
    if (gen && block.generation_id !== gen) continue;
    blockCountByActiveStrategy.set(
      block.strategy_id,
      (blockCountByActiveStrategy.get(block.strategy_id) ?? 0) + 1,
    );
  }

  // Checkin counts per (room, user) + max marked_complete_at for last_activity
  interface CheckinRow {
    room_id: string;
    user_id: string;
    marked_complete_at: string;
  }
  const checkinsByRoomUser = new Map<string, number>();
  const lastActivityByRoom = new Map<string, string>();
  for (const c of (checkinCountsRes?.data ?? []) as CheckinRow[]) {
    const key = `${c.room_id}::${c.user_id}`;
    checkinsByRoomUser.set(key, (checkinsByRoomUser.get(key) ?? 0) + 1);
    const prev = lastActivityByRoom.get(c.room_id);
    if (!prev || c.marked_complete_at > prev) {
      lastActivityByRoom.set(c.room_id, c.marked_complete_at);
    }
  }

  // Profile lookup
  const profileByUser = new Map<
    string,
    { display_name: string | null; avatar_url: string | null }
  >();
  for (const p of (activeRoomProfilesRes?.data ?? []) as Array<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
  }>) {
    profileByUser.set(p.user_id, {
      display_name: p.display_name,
      avatar_url: p.avatar_url,
    });
  }

  // Latest digest per room — the query ordered DESC by week_starting,
  // so the first row we see for each room is its most recent.
  interface DigestRow {
    room_id: string;
    week_starting: string;
    user_a_completions: number;
    user_b_completions: number;
  }
  const latestDigestByRoom = new Map<string, DigestRow>();
  for (const d of (activeRoomDigestsRes?.data ?? []) as DigestRow[]) {
    if (!latestDigestByRoom.has(d.room_id)) {
      latestDigestByRoom.set(d.room_id, d);
    }
  }

  // ── Wave 2 (cont'd): hydrate incoming invitation matches for theme/pillars ──
  //
  // Each incoming pending request needs the matching strategy_matches
  // row so the card can show shared_theme + shared_pillars +
  // divergence_summary. We already loaded allMatches above; just
  // look them up.

  const incomingPending = allRequests.filter(
    (r) =>
      r.to_user === userId &&
      r.status === "pending" &&
      new Date(r.expires_at).getTime() > Date.now(),
  );

  // ── Assemble ──

  const active: ActiveParallelRoomCard[] = activeRooms.map((r) => {
    const otherUserId = r.user_a === userId ? r.user_b : r.user_a;
    const myStrategyId =
      r.user_a === userId ? r.strategy_a_id : r.strategy_b_id;
    const theirStrategyId =
      r.user_a === userId ? r.strategy_b_id : r.strategy_a_id;
    const myCheckins =
      checkinsByRoomUser.get(`${r.id}::${userId}`) ?? 0;
    const theirCheckins =
      checkinsByRoomUser.get(`${r.id}::${otherUserId}`) ?? 0;
    const myTotal = myStrategyId
      ? blockCountByActiveStrategy.get(myStrategyId) ?? 0
      : 0;
    const theirTotal = theirStrategyId
      ? blockCountByActiveStrategy.get(theirStrategyId) ?? 0
      : 0;
    const profile = profileByUser.get(otherUserId);
    const digest = latestDigestByRoom.get(r.id) ?? null;
    // Perspective swap: the digest stores user_a/user_b raw counts; we
    // expose them as my/their relative to the viewing user.
    const myWeekCount = digest
      ? r.user_a === userId
        ? digest.user_a_completions
        : digest.user_b_completions
      : 0;
    const theirWeekCount = digest
      ? r.user_a === userId
        ? digest.user_b_completions
        : digest.user_a_completions
      : 0;
    return {
      room_id: r.id,
      shared_theme: r.shared_theme ?? "",
      shared_pillars: r.shared_pillars ?? [],
      my_completions: myCheckins,
      my_total_steps: myTotal,
      their_completions: theirCheckins,
      their_total_steps: theirTotal,
      their_display_name: profile?.display_name ?? null,
      their_avatar_url: profile?.avatar_url ?? null,
      other_user_seed: otherUserId,
      last_activity_at: lastActivityByRoom.get(r.id) ?? r.created_at,
      latest_digest: digest
        ? {
            week_starting: digest.week_starting,
            my_week_completions: myWeekCount,
            their_week_completions: theirWeekCount,
          }
        : null,
    };
  });

  const invitations: ParallelInvitationCard[] = incomingPending.map((r) => {
    // Find the strategy_match row for this pair (canonical-ordered)
    const a =
      r.from_strategy < r.to_strategy ? r.from_strategy : r.to_strategy;
    const b =
      r.from_strategy < r.to_strategy ? r.to_strategy : r.from_strategy;
    const match = allMatches.find(
      (m) => m.strategy_a === a && m.strategy_b === b,
    );
    return {
      request_id: r.id,
      shared_theme: match?.shared_theme ?? "",
      shared_pillars: match?.shared_pillars ?? [],
      divergence_summary: match?.divergence_summary ?? null,
      message: r.message,
      created_at: r.created_at,
      expires_at: r.expires_at,
      // Seed the abstract avatar by the request_id, NOT the sender's
      // user_id — so identity doesn't leak across reloads.
      seed: r.id,
    };
  });

  const suggested: SuggestedParallelMatch[] = suggestedRaw
    .map((m) => {
      const myStrategyId = myStrategyIds.includes(m.strategy_a)
        ? m.strategy_a
        : m.strategy_b;
      const theirStrategyId =
        myStrategyId === m.strategy_a ? m.strategy_b : m.strategy_a;
      const myStrategy = myStrategies.find((s) => s.id === myStrategyId);
      const theirStrategy = theirStrategies.find(
        (t) => t.id === theirStrategyId,
      );
      // Filter rule 4: the other side must still be published + matchable
      if (
        !theirStrategy ||
        theirStrategy.status !== "published" ||
        !theirStrategy.matchable
      ) {
        return null;
      }
      return {
        match_id: m.id,
        my_strategy_id: myStrategyId,
        my_strategy_statement: myStrategy?.statement ?? "",
        their_strategy_id: theirStrategyId,
        shared_theme: m.shared_theme,
        shared_pillars: m.shared_pillars,
        divergence_summary: m.divergence_summary,
        final_score: m.final_score,
        // Seed by match_id so identity doesn't leak even across page reloads
        their_seed: m.id,
        their_plan_step_count: planStepCountByStrategy.get(theirStrategyId) ?? 0,
      };
    })
    .filter((x): x is SuggestedParallelMatch => x !== null)
    .slice(0, 12);

  return {
    active: active.sort((a, b) =>
      b.last_activity_at.localeCompare(a.last_activity_at),
    ),
    invitations: invitations.sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    ),
    suggested,
    my_strategies_count: myStrategies.length,
    my_matchable_published_count: myMatchableStrategyIds.length,
  };
}

// ── Helper: my strategy session IDs (small extra query) ──

async function myStrategySessionIds(
  db: Db,
  userId: string,
): Promise<string[]> {
  const { data } = await db
    .from("brainstorm_sessions")
    .select("id")
    .eq("owner_id", userId);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}
