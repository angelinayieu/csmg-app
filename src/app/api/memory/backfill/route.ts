// POST /api/memory/backfill — full re-index of the current user's memory store.
//
// Safe to call repeatedly. Skips rows whose text is unchanged, so a second
// run after a fresh one is ~10% the cost of the first.
//
// Runtime: dominated by OpenAI embedding latency. Rough estimate:
//   N items / 96 items per batch × ~500ms per batch ≈ 5ms per item.
// A user with 1000 indexable items → ~5 seconds.
//
// This endpoint is the fallback path for write sites that aren't yet
// instrumented with per-row hooks (decompose, weave, strategy). Sprint 5
// will replace the "call this after mutation" discipline with triggers.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { runBackfill } from "@/lib/memory/backfill";

// This can take a while; Next.js edge default is 10s. Bump.
export const maxDuration = 120;

export async function POST() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const report = await runBackfill(db, user.id);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[memory/backfill] error:", err);
    return NextResponse.json(
      { error: "Backfill failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
