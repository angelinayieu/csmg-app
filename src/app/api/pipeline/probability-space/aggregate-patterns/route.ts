// ── Pattern aggregation route ──
//
// POST body:
//   { full_rebuild?: boolean, min_occurrences?: number }
//
// Normally aggregation runs automatically after each probability-space analysis
// (see for-node/route.ts). This endpoint exists for manual invocation — e.g.
// after bulk-importing convergent points, or for a one-time rebuild after
// tuning the threshold, or for testing.
//
// Authenticated — any logged-in user can trigger. Library writes are global.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { aggregatePatterns } from "@/lib/probability-space/pattern-aggregator";

export const maxDuration = 120;

export async function POST(request: Request) {
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let fullRebuild = false;
  let minOccurrences: number | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    fullRebuild = body.full_rebuild === true;
    if (typeof body.min_occurrences === "number" && body.min_occurrences >= 1) {
      minOccurrences = body.min_occurrences;
    }
  } catch {
    // Empty body is fine
  }

  try {
    const result = await aggregatePatterns(db, {
      full_rebuild: fullRebuild,
      min_occurrences: minOccurrences,
    });

    console.log(
      `[aggregate-patterns] ${fullRebuild ? "Full rebuild" : "Incremental"}: ${result.patterns_promoted} promoted, ${result.patterns_updated} updated, ${result.processed_points} points processed, ${result.skipped_below_threshold} below threshold, ${result.duration_ms}ms`,
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[aggregate-patterns] Error:", err);
    return NextResponse.json(
      { error: `Pattern aggregation failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// GET: returns current library stats (size, top patterns by occurrence).
export async function GET() {
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const { count } = await db
      .from("pattern_library")
      .select("*", { count: "exact", head: true });

    const { data: top } = await db
      .from("pattern_library")
      .select(
        "signature, canonical_tag, canonical_description, occurrence_count, typical_polarity, typical_reversibility, seen_in_space_ids",
      )
      .order("occurrence_count", { ascending: false })
      .limit(20);

    return NextResponse.json({
      total_patterns: count ?? 0,
      top_patterns: top ?? [],
    });
  } catch (err) {
    console.error("[aggregate-patterns] Stats fetch failed:", err);
    return NextResponse.json(
      { error: `Failed to fetch library stats: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
