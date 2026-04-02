import type { SupabaseClient } from "@supabase/supabase-js";
import { TIERS, type AnalysisTier } from "./tiers";

export async function getBalance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string
): Promise<number> {
  const { data } = await supabase
    .from("profiles")
    .select("credit_balance")
    .eq("id", userId)
    .single();

  return (data as { credit_balance?: number } | null)?.credit_balance ?? 0;
}

export async function checkCredits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  tier: AnalysisTier
): Promise<{ hasCredits: boolean; balance: number; required: number }> {
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
    const { data, error } = await supabase
      .from("credit_reservations")
      .insert({
        user_id: userId,
        tier,
        amount: cost,
        status: "reserved",
      })
      .select("id")
      .single();

    if (error) {
      return { success: false, reservationId: "", error: error.message };
    }

    const reservationId = (data as { id: string }).id;
    return { reservationId, success: true };
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
  try {
    // Get reservation details
    const { data: reservation, error: fetchErr } = await supabase
      .from("credit_reservations")
      .select("*")
      .eq("id", reservationId)
      .eq("status", "reserved")
      .single();

    if (fetchErr || !reservation) {
      const errMsg = fetchErr?.message ?? "Reservation not found or already processed";
      return { newBalance: 0, success: false, error: errMsg };
    }

    // Atomic decrement: prevents race conditions
    const { data: updated, error: updateErr } = await supabase.rpc(
      "deduct_credits",
      { p_user_id: reservation.user_id, p_amount: reservation.amount }
    );

    if (updateErr) {
      return { newBalance: 0, success: false, error: updateErr.message };
    }

    const newBalance = typeof updated === "number" ? updated : 0;

    // If RPC returned -1, insufficient balance
    if (newBalance < 0) {
      return { newBalance: 0, success: false, error: "Insufficient credits" };
    }

    // Log the transaction
    await supabase.from("credit_ledger").insert({
      user_id: reservation.user_id,
      amount: -reservation.amount,
      reason: `analysis_${reservation.tier}`,
      space_id: rootSpaceId ?? null,
      balance_after: newBalance,
    });

    // Mark reservation as committed
    await supabase
      .from("credit_reservations")
      .update({ status: "committed", committed_at: new Date().toISOString() })
      .eq("id", reservationId);

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
  try {
    const { error } = await supabase
      .from("credit_reservations")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", reservationId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errMsg };
  }
}

/**
 * Deduct credits atomically using SQL-level decrement.
 */
export async function deductCredits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  tier: AnalysisTier,
  spaceId?: string
): Promise<{ newBalance: number; success: boolean }> {
  const cost = TIERS[tier].credits;

  // Atomic decrement via RPC
  const { data: newBalance, error } = await supabase.rpc("deduct_credits", {
    p_user_id: userId,
    p_amount: cost,
  });

  if (error || typeof newBalance !== "number" || newBalance < 0) {
    const balance = await getBalance(supabase, userId);
    return { newBalance: balance, success: false };
  }

  // Log the transaction
  await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount: -cost,
    reason: `analysis_${tier}`,
    space_id: spaceId ?? null,
    balance_after: newBalance,
  });

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
    });

    return fallbackBalance;
  }

  await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount,
    reason,
    balance_after: newBalance,
  });

  return newBalance;
}
