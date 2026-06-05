// ── GET /api/credits/usage ──
//
// Activity feed for the Credits dashboard, derived from the token meter
// (llm_call_log — populated for every AI call regardless of whether credits
// are charged). Returns a 7-day daily series for the sparkline, week totals,
// and the most recent moves. Read-only; RLS scopes to the caller.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const LABELS: Record<string, string> = {
  converge_diverge: "Diverge → converge",
  canvas_op: "Canvas analysis",
  make_technical: "Make technical",
  deep_synthesize: "Deep synthesize",
  "objective:deep_synthesize": "Deep synthesize",
  prompt_sharpening: "Prompt sharpening",
  decompose: "Decompose",
  synthesize: "Synthesize",
  research: "Research",
  research_deep: "Deep research",
};

function labelFor(site: string): string {
  if (LABELS[site]) return LABELS[site];
  const base = site.includes(":") ? site.split(":").pop()! : site;
  return base
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

export async function GET() {
  const { supabase, user, error } = await safeAuth();
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const now = Date.now();
  const since = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

  const { data: rows } = await db
    .from("llm_call_log")
    .select("call_site, total_tokens, created_at, status")
    .eq("user_id", user.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  const list: Array<{
    call_site: string;
    total_tokens: number | null;
    created_at: string;
    status: string;
  }> = Array.isArray(rows) ? rows : [];

  // Seed the 7-day buckets (oldest → newest) so the sparkline is always 7 wide.
  const daily: { d: string; calls: number; tokens: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    daily.push({ d, calls: 0, tokens: 0 });
  }
  const dailyIndex = new Map(daily.map((b, i) => [b.d, i]));

  let weekCalls = 0;
  let weekTokens = 0;
  for (const r of list) {
    if (r.status !== "success") continue;
    weekCalls += 1;
    const tok = typeof r.total_tokens === "number" ? r.total_tokens : 0;
    weekTokens += tok;
    const idx = dailyIndex.get(dayKey(r.created_at));
    if (idx !== undefined) {
      daily[idx].calls += 1;
      daily[idx].tokens += tok;
    }
  }

  const recent = list
    .filter((r) => r.status === "success")
    .slice(0, 6)
    .map((r) => ({
      label: labelFor(r.call_site),
      tokens: typeof r.total_tokens === "number" ? r.total_tokens : 0,
      at: r.created_at,
    }));

  return NextResponse.json({ weekCalls, weekTokens, daily, recent });
}
