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

export async function deductCredits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  tier: AnalysisTier,
  spaceId?: string
): Promise<{ newBalance: number; success: boolean }> {
  const cost = TIERS[tier].credits;
  const balance = await getBalance(supabase, userId);

  if (balance < cost) {
    return { newBalance: balance, success: false };
  }

  const newBalance = balance - cost;

  // Update profile balance
  await supabase
    .from("profiles")
    .update({ credit_balance: newBalance })
    .eq("id", userId);

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

export async function addCredits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  amount: number,
  reason: string
): Promise<number> {
  const balance = await getBalance(supabase, userId);
  const newBalance = balance + amount;

  await supabase
    .from("profiles")
    .update({ credit_balance: newBalance })
    .eq("id", userId);

  await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount,
    reason,
    balance_after: newBalance,
  });

  return newBalance;
}
