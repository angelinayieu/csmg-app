// ── Parallel-path room bundle (server fetcher) ──
//
// Assembles everything the room interior needs in one pass. Lives next
// to the page that consumes it. Pure server function — no React, no
// "use client". Called from page.tsx and passed verbatim to the
// parallel-room-client.tsx for rendering.
//
// Fetch shape (all RLS-gated; no service role here):
//
//   Q1: synergy_rooms row                     [theme, pillars, strategy refs]
//   Q2: both synergy_strategies               [my + their statement/pitch]
//   Q3: both strategies' plan_step blocks     [current generation only]
//   Q4: all plan_step_checkins for this room  [both sides]
//   Q5: strategy_matches row (canonical pair) [theme/pillars/divergence — fallback if room snapshot is stale]
//   Q6: latest room_digests row               [bottom-of-room digest line]
//   Q7: other user's synergy_profile          [display_name + avatar — gated by reveal state in client]
//   Q8: synergy_room_identity_reveals rows    [who has revealed]
//
// Soft-fails: missing identity-reveals table (5c migration not yet
// applied) results in empty `reveals` array — the room still renders
// in anonymous-mode.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

// ── Types ──

export interface ParallelRoomPlanStep {
  block_id: string;
  sort_order: number;
  title: string;
  body: string;
  /** Has THIS user (or "they") checked off this step? */
  checkin: {
    id: string;
    marked_complete_at: string;
    reflection: string | null;
    updated_at: string;
  } | null;
}

export interface ParallelRoomColumn {
  /** "you" or "them" — drives row interactivity downstream. */
  side: "you" | "them";
  user_id: string;
  strategy_id: string;
  strategy_statement: string | null;
  plan_steps: ParallelRoomPlanStep[];
  // For dual-rail summary
  completed: number;
  total: number;
}

export interface ParallelRoomBundle {
  // Room row + canonical shape
  room: {
    id: string;
    shared_theme: string;
    shared_pillars: string[];
    created_at: string;
    archived_at: string | null;
    /** Set by the strategy matcher when one user's regenerated strategy
     *  no longer matches the other. Drives the divergence banner. */
    diverged_at: string | null;
    /** Set by the user via /dismiss-divergence. The banner only renders
     *  when diverged_at is set AND divergence_dismissed_at is null. */
    divergence_dismissed_at: string | null;
  };
  // Pulled from strategy_matches; gives the divergence summary +
  // similarity %. Falls back to the room snapshot if missing.
  similarity_score: number;
  divergence_summary: string | null;
  // Two columns, ordered as [you, them].
  columns: [ParallelRoomColumn, ParallelRoomColumn];
  // Identity reveal state (mutual handshake)
  reveal: {
    you_revealed: boolean;
    they_revealed: boolean;
    both_revealed: boolean;
    /** ISO timestamp of YOUR reveal. Used by the top bar to gate the
     *  24h withdraw window. Null when you haven't revealed. */
    your_revealed_at: string | null;
  };
  // Only populated when both users have revealed
  their_display_name: string | null;
  their_avatar_url: string | null;
  // Stable seed for anonymous avatar (the OTHER user's user_id) —
  // used while reveal is incomplete
  other_user_seed: string;
  // Weekly digest (most recent)
  digest: {
    summary: string;
    week_starting: string;
    you_completions: number;
    them_completions: number;
  } | null;
}

// ── Helper: extract plan_steps from a flat block array, filtered to
// the current generation of a given strategy, sorted by sort_order ──

interface RawBlockRow {
  id: string;
  strategy_id: string;
  generation_id: string;
  block_type: string;
  body: string;
  sort_order: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
}

function planStepsFor(
  strategyId: string,
  currentGen: string | null,
  blocks: RawBlockRow[],
): Array<{
  block_id: string;
  sort_order: number;
  title: string;
  body: string;
}> {
  return blocks
    .filter(
      (b) =>
        b.strategy_id === strategyId &&
        b.block_type === "plan_step" &&
        (!currentGen || b.generation_id === currentGen),
    )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((b) => ({
      block_id: b.id,
      sort_order: b.sort_order,
      title:
        typeof b.meta?.title === "string" && b.meta.title.trim().length > 0
          ? b.meta.title.trim()
          : "(untitled step)",
      body: (b.body ?? "").trim(),
    }));
}

// ── Main entry ──
//
// Returns null if the user is not a member of the room or the room
// isn't a parallel-path room. Caller (page.tsx) handles the redirect /
// 404 in those cases.

export async function loadParallelRoomBundle(
  db: Db,
  roomId: string,
  userId: string,
): Promise<ParallelRoomBundle | null> {
  // ── Q1: room row ──
  const { data: roomRow } = await db
    .from("synergy_rooms")
    .select(
      "id, user_a, user_b, room_kind, strategy_a_id, strategy_b_id, shared_theme, shared_pillars, archived_at, created_at, diverged_at, divergence_dismissed_at",
    )
    .eq("id", roomId)
    .maybeSingle();
  if (!roomRow) return null;
  if (roomRow.room_kind !== "parallel_path") return null;
  if (roomRow.user_a !== userId && roomRow.user_b !== userId) return null;
  if (!roomRow.strategy_a_id || !roomRow.strategy_b_id) return null;

  // Which strategy / user is "you", which is "them"
  const myStrategyId =
    roomRow.user_a === userId
      ? roomRow.strategy_a_id
      : roomRow.strategy_b_id;
  const theirStrategyId =
    roomRow.user_a === userId
      ? roomRow.strategy_b_id
      : roomRow.strategy_a_id;
  const theirUserId =
    roomRow.user_a === userId ? roomRow.user_b : roomRow.user_a;

  // ── Wave 2: parallel reads ──
  const [
    strategiesRes,
    blocksRes,
    checkinsRes,
    matchRes,
    digestRes,
    profileRes,
    revealsRes,
  ] = await Promise.all([
    // Q2: both strategies
    db
      .from("synergy_strategies")
      .select("id, statement, pitch, current_generation_id")
      .in("id", [myStrategyId, theirStrategyId]),
    // Q3: plan_step blocks for both strategies (filter by generation in JS)
    db
      .from("synergy_strategy_blocks")
      .select(
        "id, strategy_id, generation_id, block_type, body, sort_order, meta",
      )
      .in("strategy_id", [myStrategyId, theirStrategyId])
      .eq("block_type", "plan_step"),
    // Q4: check-ins for this room (both users)
    db
      .from("plan_step_checkins")
      .select(
        "id, room_id, user_id, step_block_id, marked_complete_at, reflection, updated_at",
      )
      .eq("room_id", roomId),
    // Q5: strategy_matches row (canonical-ordered)
    (() => {
      const a =
        myStrategyId < theirStrategyId ? myStrategyId : theirStrategyId;
      const b =
        myStrategyId < theirStrategyId ? theirStrategyId : myStrategyId;
      return db
        .from("strategy_matches")
        .select(
          "shared_theme, shared_pillars, divergence_summary, final_score",
        )
        .eq("strategy_a", a)
        .eq("strategy_b", b)
        .maybeSingle();
    })(),
    // Q6: most recent room_digests row
    db
      .from("room_digests")
      .select(
        "summary, week_starting, user_a_completions, user_b_completions",
      )
      .eq("room_id", roomId)
      .order("week_starting", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Q7: their profile (we'll only USE it if both have revealed)
    db
      .from("synergy_profiles")
      .select("display_name, avatar_url")
      .eq("user_id", theirUserId)
      .maybeSingle(),
    // Q8: identity reveals — soft-fail to empty if migration not applied
    db
      .from("synergy_room_identity_reveals")
      .select("user_id, revealed_at")
      .eq("room_id", roomId),
  ]);

  const strategies = (strategiesRes?.data ?? []) as Array<{
    id: string;
    statement: string | null;
    pitch: string | null;
    current_generation_id: string | null;
  }>;
  const myStrategy = strategies.find((s) => s.id === myStrategyId);
  const theirStrategy = strategies.find((s) => s.id === theirStrategyId);

  const blocks = (blocksRes?.data ?? []) as RawBlockRow[];
  const myPlanSteps = planStepsFor(
    myStrategyId,
    myStrategy?.current_generation_id ?? null,
    blocks,
  );
  const theirPlanSteps = planStepsFor(
    theirStrategyId,
    theirStrategy?.current_generation_id ?? null,
    blocks,
  );

  // Check-ins: index by step_block_id (one per user per step)
  interface CheckinRow {
    id: string;
    room_id: string;
    user_id: string;
    step_block_id: string;
    marked_complete_at: string;
    reflection: string | null;
    updated_at: string;
  }
  const checkins = (checkinsRes?.data ?? []) as CheckinRow[];
  const checkinByStep = new Map<string, CheckinRow>();
  for (const c of checkins) {
    // Key is sufficient because step_block_id is unique to a strategy,
    // and only the owning user can have a check-in for it.
    checkinByStep.set(c.step_block_id, c);
  }

  // Reveal state
  interface RevealRow {
    user_id: string;
    revealed_at: string;
  }
  const reveals = (revealsRes?.data ?? []) as RevealRow[];
  const yourRevealRow = reveals.find((r) => r.user_id === userId);
  const youRevealed = yourRevealRow !== undefined;
  const theyRevealed = reveals.some((r) => r.user_id === theirUserId);
  const bothRevealed = youRevealed && theyRevealed;
  const yourRevealedAt = yourRevealRow?.revealed_at ?? null;

  // Match-row fallback for theme/pillars/divergence
  const match = (matchRes?.data ?? null) as {
    shared_theme: string | null;
    shared_pillars: string[] | null;
    divergence_summary: string | null;
    final_score: number | null;
  } | null;

  const digest = (digestRes?.data ?? null) as {
    summary: string;
    week_starting: string;
    user_a_completions: number;
    user_b_completions: number;
  } | null;

  // ── Build columns ──
  const myColumn: ParallelRoomColumn = {
    side: "you",
    user_id: userId,
    strategy_id: myStrategyId,
    strategy_statement: myStrategy?.statement ?? null,
    plan_steps: myPlanSteps.map((s) => {
      const c = checkinByStep.get(s.block_id);
      // A check-in is "yours" only if user_id matches; defensive filter
      return {
        ...s,
        checkin:
          c && c.user_id === userId
            ? {
                id: c.id,
                marked_complete_at: c.marked_complete_at,
                reflection: c.reflection,
                updated_at: c.updated_at,
              }
            : null,
      };
    }),
    completed: 0, // recomputed below
    total: myPlanSteps.length,
  };
  myColumn.completed = myColumn.plan_steps.filter(
    (s) => s.checkin !== null,
  ).length;

  const theirColumn: ParallelRoomColumn = {
    side: "them",
    user_id: theirUserId,
    strategy_id: theirStrategyId,
    strategy_statement: theirStrategy?.statement ?? null,
    plan_steps: theirPlanSteps.map((s) => {
      const c = checkinByStep.get(s.block_id);
      return {
        ...s,
        checkin:
          c && c.user_id === theirUserId
            ? {
                id: c.id,
                marked_complete_at: c.marked_complete_at,
                reflection: c.reflection,
                updated_at: c.updated_at,
              }
            : null,
      };
    }),
    completed: 0,
    total: theirPlanSteps.length,
  };
  theirColumn.completed = theirColumn.plan_steps.filter(
    (s) => s.checkin !== null,
  ).length;

  // ── Their profile (gated) ──
  const theirProfile = (profileRes?.data ?? null) as {
    display_name: string | null;
    avatar_url: string | null;
  } | null;

  // Convert final_score (0-100 raw) to a similarity % — already on
  // that scale, but defensively clamp.
  const similarityScore = Math.max(
    0,
    Math.min(100, Math.round(match?.final_score ?? 0)),
  );

  return {
    room: {
      id: roomRow.id,
      shared_theme:
        roomRow.shared_theme ?? match?.shared_theme ?? "Parallel path",
      shared_pillars:
        (roomRow.shared_pillars ?? match?.shared_pillars ?? []) as string[],
      created_at: roomRow.created_at,
      archived_at: roomRow.archived_at,
      diverged_at: roomRow.diverged_at ?? null,
      divergence_dismissed_at: roomRow.divergence_dismissed_at ?? null,
    },
    similarity_score: similarityScore,
    divergence_summary: match?.divergence_summary ?? null,
    columns: [myColumn, theirColumn],
    reveal: {
      you_revealed: youRevealed,
      they_revealed: theyRevealed,
      both_revealed: bothRevealed,
      your_revealed_at: yourRevealedAt,
    },
    their_display_name: bothRevealed ? theirProfile?.display_name ?? null : null,
    their_avatar_url: bothRevealed ? theirProfile?.avatar_url ?? null : null,
    other_user_seed: theirUserId,
    digest: digest
      ? {
          summary: digest.summary,
          week_starting: digest.week_starting,
          // Map the canonical user_a/user_b digest columns to "you"/"them"
          // perspective based on the room's user_a position.
          you_completions:
            roomRow.user_a === userId
              ? digest.user_a_completions
              : digest.user_b_completions,
          them_completions:
            roomRow.user_a === userId
              ? digest.user_b_completions
              : digest.user_a_completions,
        }
      : null,
  };
}
