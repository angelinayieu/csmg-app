// POST /api/spaces/[id]/twin-proposal/swap-rank
//   Phase B (intake redesign) — change which ranked strategy is the
//   "primary" / hero. This is a pure presentation change: we don't
//   regenerate strategies, we just reorder which one the on-canvas
//   StrategyHeroCard surfaces (and which one the strategy detail
//   page shows as `is_primary`).
//
// Body: { target_rank: number }   // 1-indexed; must be in 1..N where
//   N === synthesis_data.strategy_batch.strategies.length.
//
// Behavior:
//   1. Load `spaces.synthesis_data.strategy_batch`.
//   2. Find the entry whose `rank` matches target_rank.
//   3. Swap that entry's position with the current is_primary entry —
//      both their `rank` values AND their `is_primary` flags are
//      updated. The synthesis_data jsonb is rewritten in-place.
//   4. Return the new active entry so the caller can refresh its UI.
//
// Why this approach (rather than persisting a separate
// `pinned_strategy_rank` column):
//   - synthesis_data already carries strategies[].rank as the source
//     of truth for ordering — keeping the swap there means the
//     hero shape and the detail page (both read from
//     synthesis_data.strategy_batch.strategies[0]) stay automatically
//     in sync without any additional read paths.
//   - No DB schema change needed; pure JSON edit.
//   - Restores cleanly on regenerate (next strategy-refresh produces
//     a fresh strategy_batch with rank assignments from the LLM).

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";
import type { StrategyBatch, StrategyBatchEntry } from "@/types/strategy-batch";

export const maxDuration = 10;

interface SwapBody {
  target_rank?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body } = await safeJsonParse(request);
  const targetRankRaw = (body as SwapBody | null)?.target_rank;
  if (typeof targetRankRaw !== "number" || !Number.isFinite(targetRankRaw)) {
    return NextResponse.json(
      { error: "target_rank must be a number" },
      { status: 400 },
    );
  }
  const targetRank = Math.floor(targetRankRaw);
  if (targetRank < 1) {
    return NextResponse.json(
      { error: "target_rank must be >= 1" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load synthesis_data ────────────────────────────────────────────
  const { data: spaceRow, error: loadErr } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .single();
  if (loadErr || !spaceRow) {
    return NextResponse.json(
      { error: `Failed to load space: ${loadErr?.message ?? "not found"}` },
      { status: 500 },
    );
  }

  const synthData = (spaceRow.synthesis_data ?? {}) as Record<string, unknown>;
  const batch = synthData.strategy_batch as StrategyBatch | undefined;
  if (!batch || !Array.isArray(batch.strategies) || batch.strategies.length === 0) {
    return NextResponse.json(
      { error: "No strategy_batch found — generate a strategy first" },
      { status: 404 },
    );
  }

  if (targetRank > batch.strategies.length) {
    return NextResponse.json(
      {
        error: `target_rank ${targetRank} exceeds available strategies (${batch.strategies.length})`,
      },
      { status: 400 },
    );
  }

  // ── Find current primary + target entries ─────────────────────────
  const targetEntryIdx = batch.strategies.findIndex(
    (e: StrategyBatchEntry) => e.rank === targetRank,
  );
  if (targetEntryIdx === -1) {
    return NextResponse.json(
      { error: `No entry with rank ${targetRank}` },
      { status: 404 },
    );
  }

  const primaryIdx = batch.strategies.findIndex(
    (e: StrategyBatchEntry) => e.is_primary === true,
  );
  // Fallback to rank=1 if no primary flag is set anywhere.
  const currentPrimaryIdx =
    primaryIdx >= 0
      ? primaryIdx
      : batch.strategies.findIndex((e: StrategyBatchEntry) => e.rank === 1);

  if (currentPrimaryIdx === -1) {
    return NextResponse.json(
      { error: "Couldn't determine current primary strategy" },
      { status: 500 },
    );
  }

  // No-op when user clicks the already-active rank.
  if (currentPrimaryIdx === targetEntryIdx) {
    return NextResponse.json({
      ok: true,
      no_op: true,
      active_rank: targetRank,
      active_title: batch.strategies[targetEntryIdx].recommendation?.title ?? "",
    });
  }

  // ── Swap ranks + is_primary flags ─────────────────────────────────
  // Take a defensive copy so we mutate a fresh array (avoids supabase
  // serializer surprises if the row is shared by reference elsewhere).
  const newStrategies: StrategyBatchEntry[] = batch.strategies.map((e) => ({
    ...e,
  }));

  const cur = newStrategies[currentPrimaryIdx];
  const tgt = newStrategies[targetEntryIdx];

  // Swap the two entries' rank numbers + their is_primary flags.
  // Keeping the array order stable means strategies[0] is no longer
  // necessarily rank-1 — that's intentional; consumers should sort
  // by rank or filter by is_primary.
  const curRank = cur.rank;
  const tgtRank = tgt.rank;
  newStrategies[currentPrimaryIdx] = { ...cur, rank: tgtRank, is_primary: false };
  newStrategies[targetEntryIdx] = { ...tgt, rank: curRank, is_primary: true };

  const newBatch: StrategyBatch = {
    ...batch,
    strategies: newStrategies,
  };

  // ── Mirror to legacy `strategic_recommendation` for back-compat ────
  // The legacy single-strategy reader reads from
  // synthesis_data.strategic_recommendation; keeping it in lockstep
  // with strategy_batch's new primary means existing consumers
  // (app-generator pre-Tier-2, validators, older UI surfaces) all
  // see the swapped strategy without code changes.
  const newPrimary = newStrategies.find((e) => e.is_primary === true);
  const updatedSynthData: Record<string, unknown> = {
    ...synthData,
    strategy_batch: newBatch,
  };
  if (newPrimary) {
    updatedSynthData.strategic_recommendation = {
      ...((synthData.strategic_recommendation as Record<string, unknown>) ?? {}),
      recommendation: newPrimary.recommendation,
      ranked_strategies: newPrimary.ranked_strategies,
    };
  }

  const { error: writeErr } = await db
    .from("spaces")
    .update({ synthesis_data: updatedSynthData })
    .eq("id", spaceId);

  if (writeErr) {
    return NextResponse.json(
      { error: `Failed to persist swap: ${writeErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    active_rank: targetRank,
    active_title: newPrimary?.recommendation?.title ?? "",
    active_summary:
      (newPrimary?.recommendation as { summary?: string } | undefined)?.summary ??
      "",
    total_ranks: newStrategies.length,
  });
}
