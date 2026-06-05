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
      onRetry: (err, attempt, delayMs) =>
        console.warn(
          `[credits.getBalance] retry ${attempt} after ${delayMs}ms (transient Supabase error):`,
          err instanceof Error ? err.message : err,
        ),
    },
  );

  return data?.credit_balance ?? 0;
}

/**
 * Total SPENDABLE credits = lazily-refilled weekly allowance + purchased
 * credits (the Phase-3 two-bucket model). Use this for affordability checks —
 * getBalance() only reports the purchased bucket and would wrongly reject a
 * user who still has weekly allowance. Pure read (does not persist the refill).
 */
export async function getSpendable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<number> {
  if (BYPASS) return 9999;
  const { data } = await retrySupabaseQuery<number>(
    () => supabase.rpc("get_spendable", { p_user_id: userId }),
    {
      onRetry: (err, attempt, delayMs) =>
        console.warn(
          `[credits.getSpendable] retry ${attempt} after ${delayMs}ms:`,
          err instanceof Error ? err.message : err,
        ),
    },
  );
  return typeof data === "number" ? data : 0;
}

export interface SpendResult {
  success: boolean;
  /** Credits drawn from the weekly plan allowance. */
  fromAllowance: number;
  /** Credits drawn from the purchased (rollover) bucket. */
  fromCredits: number;
  /** Allowance left after the spend. */
  allowanceRemaining: number;
  /** Purchased credit balance after the spend. */
  creditBalance: number;
  required?: number;
  error?: string;
}

/**
 * Atomic two-bucket spend (allowance first, then purchased credits) with lazy
 * weekly refill. The single source of truth for DEBITING — all commit/deduct
 * paths route through here. success=false leaves balances untouched.
 */
export async function spendTwoBucket(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  amount: number,
): Promise<SpendResult> {
  if (BYPASS) {
    return {
      success: true,
      fromAllowance: 0,
      fromCredits: 0,
      allowanceRemaining: 9999,
      creditBalance: 9999,
    };
  }
  const { data, error } = await supabase.rpc("spend_credits_v2", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error || !data) {
    return {
      success: false,
      fromAllowance: 0,
      fromCredits: 0,
      allowanceRemaining: 0,
      creditBalance: 0,
      error: error?.message ?? "spend_credits_v2 returned no row",
    };
  }
  const r = data as {
    success?: boolean;
    from_allowance?: number;
    from_credits?: number;
    allowance_remaining?: number;
    credit_balance?: number;
    required?: number;
    error?: string;
  };
  return {
    success: !!r.success,
    fromAllowance: r.from_allowance ?? 0,
    fromCredits: r.from_credits ?? 0,
    allowanceRemaining: r.allowance_remaining ?? 0,
    creditBalance: r.credit_balance ?? 0,
    required: r.required,
    error: r.error,
  };
}

/**
 * Assign a subscription plan + (re)seed the weekly allowance. Call from the
 * Stripe subscription webhook on create/update. weekly = the plan's
 * weeklyRounds (see plans.ts).
 */
export async function setUserPlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  plan: string,
  weekly: number,
): Promise<void> {
  if (BYPASS) return;
  await supabase.rpc("set_user_plan", {
    p_user_id: userId,
    p_plan: plan,
    p_weekly: weekly,
  });
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

  const balance = await getSpendable(supabase, userId);
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
  const balance = await getSpendable(supabase, userId);

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
 * Reserve an ARBITRARY flat amount of credits (the Phase-2 flat-per-operation
 * charge model), as opposed to reserveCredits() which derives the amount from
 * an AnalysisTier. Reuses the same credit_reservations table + the existing
 * commitReservation()/cancelReservation() (both read the row's `amount`), so
 * this only needs to handle the insert. The operation key is stored in the
 * (unconstrained, NOT-NULL) `tier` column so the committed ledger row reads
 * `analysis_<operation>`, and also in `reason` for clarity.
 *
 * Returns the live balance so callers can surface "need X, have Y".
 */
export async function reserveCreditsAmount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  amount: number,
  operation: string,
): Promise<{ reservationId: string; success: boolean; balance: number; error?: string }> {
  if (BYPASS) {
    return { reservationId: "bypass", success: true, balance: 9999 };
  }
  if (amount <= 0) {
    // Free operation — nothing to hold.
    return { reservationId: "free", success: true, balance: await getSpendable(supabase, userId) };
  }

  const balance = await getSpendable(supabase, userId);
  if (balance < amount) {
    return {
      success: false,
      reservationId: "",
      balance,
      error: `Insufficient credits. Need ${amount}, have ${balance}.`,
    };
  }

  try {
    const { data, error } = await retrySupabaseQuery<{ id: string }>(
      () =>
        supabase
          .from("credit_reservations")
          .insert({
            user_id: userId,
            tier: operation,
            amount,
            status: "reserved",
            reason: `op_${operation}`,
          })
          .select("id")
          .single(),
      {
        onRetry: (err, attempt, delayMs) =>
          console.warn(
            `[credits.reserveCreditsAmount] retry ${attempt} after ${delayMs}ms (transient Supabase error):`,
            err instanceof Error ? err.message : err,
          ),
      },
    );

    if (error || !data) {
      return {
        success: false,
        reservationId: "",
        balance,
        error: error?.message ?? "reservation insert returned no row",
      };
    }
    return { reservationId: data.id, success: true, balance };
  } catch (err) {
    return {
      success: false,
      reservationId: "",
      balance,
      error: err instanceof Error ? err.message : String(err),
    };
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

    // Atomic two-bucket spend: weekly allowance first, then purchased credits,
    // with lazy weekly refill. Prevents race conditions (single SQL function,
    // row-locked). Replaces the credits-only deduct_credits path.
    const spend = await spendTwoBucket(
      supabase,
      reservation.user_id,
      reservation.amount,
    );

    if (!spend.success) {
      return {
        newBalance: spend.creditBalance,
        success: false,
        error: spend.error ?? "Insufficient credits",
      };
    }

    const newBalance = spend.creditBalance;

    // Log the transaction — one ledger row per bucket actually drawn, tagged
    // with `bucket` so allowance vs purchased spend is auditable. Best-effort:
    // the debit already happened atomically, so a ledger blip can't roll it back.
    const ledgerRows: Record<string, unknown>[] = [];
    if (spend.fromAllowance > 0) {
      ledgerRows.push({
        user_id: reservation.user_id,
        amount: -spend.fromAllowance,
        reason: `analysis_${reservation.tier}`,
        space_id: rootSpaceId ?? null,
        balance_after: newBalance,
        bucket: "allowance",
      });
    }
    if (spend.fromCredits > 0) {
      ledgerRows.push({
        user_id: reservation.user_id,
        amount: -spend.fromCredits,
        reason: `analysis_${reservation.tier}`,
        space_id: rootSpaceId ?? null,
        balance_after: newBalance,
        bucket: "credits",
      });
    }
    if (ledgerRows.length > 0) {
      await retrySupabaseQuery(
        () => supabase.from("credit_ledger").insert(ledgerRows),
      ).catch(() => {});
    }

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

  // Route through the two-bucket spend (allowance first, then credits) so the
  // legacy one-shot path enforces the weekly plan limit identically to the
  // reserve→commit path.
  const spend = await spendTwoBucket(supabase, userId, cost);
  if (!spend.success) {
    return { newBalance: spend.creditBalance, success: false };
  }

  const newBalance = spend.creditBalance;
  const ledgerRows: Record<string, unknown>[] = [];
  if (spend.fromAllowance > 0) {
    ledgerRows.push({
      user_id: userId,
      amount: -spend.fromAllowance,
      reason: `analysis_${tier}`,
      space_id: spaceId ?? null,
      balance_after: newBalance,
      bucket: "allowance",
    });
  }
  if (spend.fromCredits > 0) {
    ledgerRows.push({
      user_id: userId,
      amount: -spend.fromCredits,
      reason: `analysis_${tier}`,
      space_id: spaceId ?? null,
      balance_after: newBalance,
      bucket: "credits",
    });
  }
  if (ledgerRows.length > 0) {
    await supabase
      .from("credit_ledger")
      .insert(ledgerRows)
      .then(() => {}, () => {});
  }

  return { newBalance, success: true };
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
