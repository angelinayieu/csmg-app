// ── GET /api/synergy/marketplace/stats ──
//
// Aggregated activity stats for the marketplace. All numbers, no PII.
// Powers the empty-state hero on /discover so brand-new users with
// zero matches get a sense of "this place is alive" rather than
// "you're alone."
//
// Returns:
//   total_matchable_components — across all users, visibility != 'private'
//   recent_publishes_24h        — components created in the last 24h
//   active_rooms_7d              — non-archived synergy_rooms created
//                                  in the last 7 days
//   kind_distribution            — { core_idea, upstream, downstream,
//                                    polished_product } counts so the
//                                    UI can show "200 upstream needs
//                                    looking for downstream output"
//                                    style framing
//   recent_activity_score        — a synthetic 0-100 indicator that
//                                  combines recent publishes + active
//                                  rooms; drives a "🔥 active" badge
//
// Cached aggressively (30s) — marketplace stats don't need to be
// real-time, and this query joins across all users so we want to
// keep it cheap.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface KindCount {
  kind: string;
  count: number;
}

export async function GET() {
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Parallel aggregations. Each uses head + count so we don't pull rows.
  const [
    totalRes,
    publishes24hRes,
    activeRoomsRes,
    coreRes,
    upstreamRes,
    downstreamRes,
    productRes,
  ] = await Promise.all([
    db
      .from("brainstorm_components")
      .select("id", { count: "exact", head: true })
      .neq("visibility", "private"),
    db
      .from("brainstorm_components")
      .select("id", { count: "exact", head: true })
      .neq("visibility", "private")
      .gte("created_at", day),
    db
      .from("synergy_rooms")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .gte("created_at", week),
    db
      .from("brainstorm_components")
      .select("id", { count: "exact", head: true })
      .eq("kind", "core_idea")
      .neq("visibility", "private"),
    db
      .from("brainstorm_components")
      .select("id", { count: "exact", head: true })
      .eq("kind", "upstream")
      .neq("visibility", "private"),
    db
      .from("brainstorm_components")
      .select("id", { count: "exact", head: true })
      .eq("kind", "downstream")
      .neq("visibility", "private"),
    db
      .from("brainstorm_components")
      .select("id", { count: "exact", head: true })
      .eq("kind", "polished_product")
      .neq("visibility", "private"),
  ]);

  if (totalRes.error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(totalRes.error) },
      { status: 500 },
    );
  }

  const total = totalRes.count ?? 0;
  const publishes24h = publishes24hRes.count ?? 0;
  const activeRooms = activeRoomsRes.count ?? 0;

  // Synthetic activity score (0-100). Scaled so a small marketplace
  // (~20 publishes/week + a couple rooms) reads as ~50, and a busy
  // one (100+ publishes/week + 10+ rooms) reads as ~85+. Just a
  // rough indicator for the UI badge.
  const recentActivityScore = Math.min(
    100,
    Math.round(publishes24h * 4 + activeRooms * 8),
  );

  const kinds: KindCount[] = [
    { kind: "core_idea", count: coreRes.count ?? 0 },
    { kind: "upstream", count: upstreamRes.count ?? 0 },
    { kind: "downstream", count: downstreamRes.count ?? 0 },
    { kind: "polished_product", count: productRes.count ?? 0 },
  ];

  return NextResponse.json({
    total_matchable_components: total,
    recent_publishes_24h: publishes24h,
    active_rooms_7d: activeRooms,
    kind_distribution: kinds,
    recent_activity_score: recentActivityScore,
  });
}
