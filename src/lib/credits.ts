import type { SupabaseClient } from "@supabase/supabase-js";
import { TIERS, type AnalysisTier } from "./tiers";
import { retrySupabaseQuery } from "./supabase-retry";

/**
 * When NEXT_PUBLIC_BYPASS_CREDITS=true, all credit checks pass and
 * deductions are no-ops. Useful during development without Stripe.
 */
const BYPASS =
  process.env.NEXT_PUBLIC_BYPASS_CREDITS === "true" ||
  process.env.BYPASS_CREDITS === "true";

/**
 * Retry-wrap for transient Supabase outages (Vercel alert
 * 2026-04-28 16:40 UTC: profiles + auth endpoints intermittent).
 * 3 attempts, 100ms / 400ms / 1600ms backoff with ±50% jitter —
 * total worst-case wall time ~2.1s. Retries on:
 *   - "fetch failed" / ECONNRESET / ETIMEDOUT
 *   - PostgREST connection errors (PGRST00*, 08*)
 *   - 502 / 503 / 504 responses
 * Does NOT retry on auth/RLS denials or constraint violations.
 *
 * See src/lib/supabase-retry.ts for the predicate.
 */

export async function getBalance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string
): Promise<number> {
  if (BYPASS) return 9999;

  const { data } = await retrySupabaseQuery<{ credit_balance?: number }>(
    () =>
      supabase
        .from("profiles")
        .select("credit_balance")
        .eq("id", userId)
        .single(),
    {
      // Tighter per-attempt timeout than the 4s default. getBalance is
      // called from /api/credits/balance which has maxDuration=15;
      // safeAuth ahead of us spends up to ~4.2s, leaving ~10s here.
      // 3 × 2500ms + 500ms backoff ≈ 8s worst case keeps us under the
      // route ceiling with ~2s buffer.
      attemptTimeoutMs: 2500,
      onRetry: (err, attempt, delayMs) =>
        console.warn(
          `[credits.getBalance] retry ${attempt} after ${delayMs}ms (transient Supabase error):`,
          err instanceof Error ? err.message : err,
        ),
    },
  );

  return data?.credit_balance ?? 0;
}

export async function checkCredits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  tier: AnalysisTier
): Promise<{ hasCredits: boolean; balance: number; required: number }> {
  if (BYPASS) {
    return { hasCredits: true, balance: 9999, required: TIERS[tier].credits };
  }

  const balance = await getBalance(supabase, userId);
  const required = TIERS[tier].credits;
  return { hasCredits: balance >= required, balance, required };
}

/**
 * Reserve credits for an analysis (atomic with database inserts)
 */
export async function reserveCredits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  tier: AnalysisTier
): Promise<{ reservationId: string; success: boolean; error?: string }> {
  if (BYPASS) {
    return { reservationId: "bypass", success: true };
  }

  const cost = TIERS[tier].credits;
  const balance = await getBalance(supabase, userId);

  if (balance < cost) {
    return {
      success: false,
      reservationId: "",
      error: `Insufficient credits. Need ${cost}, have ${balance}.`,
    };
  }

  try {
    const { data, error } = await retrySupabaseQuery<{ id: string }>(
      () =>
        supabase
          .from("credit_reservations")
          .insert({
            user_id: userId,
            tier,
            amount: cost,
            status: "reserved",
          })
          .select("id")
          .single(),
      {
        onRetry: (err, attempt, delayMs) =>
          console.warn(
            `[credits.reserveCredits] retry ${attempt} after ${delayMs}ms (transient Supabase error):`,
            err instanceof Error ? err.message : err,
          ),
      },
    );

    if (error) {
      return { success: false, reservationId: "", error: error.message ?? "reservation failed" };
    }

    if (!data) {
      return { success: false, reservationId: "", error: "reservation insert returned no row" };
    }

    return { reservationId: data.id, success: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, reservationId: "", error: errMsg };
  }
}

/**
 * Commit a credit reservation using atomic SQL decrement.
 * Uses credit_balance = credit_balance - amount to prevent race conditions.
 */
export async function commitReservation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  reservationId: string,
  rootSpaceId?: string
): Promise<{ newBalance: number; success: boolean; error?: string }> {
  if (BYPASS) {
    return { newBalance: 9999, success: true };
  }

  try {
    // Get reservation details
    const { data: reservation, error: fetchErr } = await retrySupabaseQuery<{
      user_id: string;
      amount: number;
      tier: string;
    }>(
      () =>
        supabase
          .from("credit_reservations")
          .select("*")
          .eq("id", reservationId)
          .eq("status", "reserved")
          .single(),
      {
        onRetry: (err, attempt, delayMs) =>
          console.warn(
            `[credits.commitReservation:fetch] retry ${attempt} after ${delayMs}ms:`,
            err instanceof Error ? err.message : err,
          ),
      },
    );

    if (fetchErr || !reservation) {
      const errMsg = fetchErr?.message ?? "Reservation not found or already processed";
      return { newBalance: 0, success: false, error: errMsg };
    }

    // Atomic decrement: prevents race conditions
    const { data: updated, error: updateErr } = await retrySupabaseQuery<number>(
      () =>
        supabase.rpc("deduct_credits", {
          p_user_id: reservation.user_id,
          p_amount: reservation.amount,
        }),
      {
        onRetry: (err, attempt, delayMs) =>
          console.warn(
            `[credits.commitReservation:rpc] retry ${attempt} after ${delayMs}ms:`,
            err instanceof Error ? err.message : err,
          ),
      },
    );

    if (updateErr) {
      return { newBalance: 0, success: false, error: updateErr.message ?? "deduct_credits failed" };
    }

    const newBalance = typeof updated === "number" ? updated : 0;

    // If RPC returned -1, insufficient balance
    if (newBalance < 0) {
      return { newBalance: 0, success: false, error: "Insufficient credits" };
    }

    // Log the transaction. Ledger writes are best-effort — we already
    // deducted credits via the atomic RPC above, so a ledger blip
    // shouldn't roll back the user's debit.
    await retrySupabaseQuery(
      () =>
        supabase.from("credit_ledger").insert({
          user_id: reservation.user_id,
          amount: -reservation.amount,
          reason: `analysis_${reservation.tier}`,
          space_id: rootSpaceId ?? null,
          balance_after: newBalance,
        }),
    ).catch(() => {});

    // Mark reservation as committed
    await retrySupabaseQuery(
      () =>
        supabase
          .from("credit_reservations")
          .update({ status: "committed", committed_at: new Date().toISOString() })
          .eq("id", reservationId),
    ).catch(() => {});

    return { newBalance, success: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { newBalance: 0, success: false, error: errMsg };
  }
}

/**
 * Cancel a credit reservation (reverse the hold, no charge)
 */
export async function cancelReservation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  reservationId: string
): Promise<{ success: boolean; error?: string }> {
  if (BYPASS) {
    return { success: true };
  }

  try {
    // Cancellation is critical — if it fails, the user's reservation
    // hangs in 'reserved' state and they can't retry without
    // appearing to be double-charged. Retry on transient failures.
    const { error } = await retrySupabaseQuery(
      () =>
        supabase
          .from("credit_reservations")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
          .eq("id", reservationId),
      {
        onRetry: (err, attempt, delayMs) =>
          console.warn(
            `[credits.cancelReservation] retry ${attempt} after ${delayMs}ms:`,
            err instanceof Error ? err.message : err,
          ),
      },
    );

    if (error) {
      return { success: false, error: error.message ?? "cancellation failed" };
    }

    return { success: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errMsg };
  }
}

/**
 * Deduct credits atomically using SQL-level decrement.
 * Falls back to read-modify-write if the RPC isn't deployed yet.
 */
export async function deductCredits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  tier: AnalysisTier,
  spaceId?: string
): Promise<{ newBalance: number; success: boolean }> {
  if (BYPASS) {
    return { newBalance: 9999, success: true };
  }

  const cost = TIERS[tier].credits;

  // Try atomic decrement via RPC first
  const { data: newBalance, error } = await supabase.rpc("deduct_credits", {
    p_user_id: userId,
    p_amount: cost,
  });

  if (!error && typeof newBalance === "number" && newBalance >= 0) {
    // RPC worked — log transaction
    await supabase.from("credit_ledger").insert({
      user_id: userId,
      amount: -cost,
      reason: `analysis_${tier}`,
      space_id: spaceId ?? null,
      balance_after: newBalance,
    });
    return { newBalance, success: true };
  }

  // Fallback: read-modify-write (if RPC not deployed yet)
  const balance = await getBalance(supabase, userId);
  if (balance < cost) {
    return { newBalance: balance, success: false };
  }

  const fallbackBalance = balance - cost;
  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ credit_balance: fallbackBalance })
    .eq("id", userId);

  if (updateErr) {
    return { newBalance: balance, success: false };
  }

  // Best-effort ledger logging
  await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount: -cost,
    reason: `analysis_${tier}`,
    space_id: spaceId ?? null,
    balance_after: fallbackBalance,
  }).then(() => {}, () => {});

  return { newBalance: fallbackBalance, success: true };
}

/**
 * Add credits atomically using SQL-level increment.
 */
export async function addCredits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  amount: number,
  reason: string
): Promise<number> {
  if (BYPASS) return 9999;

  // Atomic increment via RPC
  const { data: newBalance, error } = await supabase.rpc("add_credits", {
    p_user_id: userId,
    p_amount: amount,
  });

  if (error || typeof newBalance !== "number") {
    // Fallback: read-then-write (less safe but functional if RPC not yet deployed)
    const balance = await getBalance(supabase, userId);
    const fallbackBalance = balance + amount;
    await supabase
      .from("profiles")
      .update({ credit_balance: fallbackBalance })
      .eq("id", userId);

    await supabase.from("credit_ledger").insert({
      user_id: userId,
      amount,
      reason,
      balance_after: fallbackBalance,
    }).then(() => {}, () => {});

    return fallbackBalance;
  }

  await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount,
    reason,
    balance_after: newBalance,
  }).then(() => {}, () => {});

  return newBalance;
}
