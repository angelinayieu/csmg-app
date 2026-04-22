// ── Cross-space Recent Activity (Phase 53) ──
//
// GET /api/recent-activity?limit=20
//   → { events: RecentActivityEvent[] }
//
// Returns the most recent `space_changelog` rows across every space the
// caller owns, joined with the space name so the dashboard feed can
// render "Saved reaction 'Y' in {Space X}" without an extra round-trip.
//
// Reads:
//   - change_type (stock enum: manual_edit / reevaluation / synthesis_refresh / ...)
//   - details.subtype (Phase 52 discriminator for manual_edit events)
//
// RLS scoping:
//   - space_changelog has RLS on space_id → user's spaces only, implicit
//   - spaces join uses RLS too
//
// Not a SQL view because we want `subtype` flattened to a top-level
// field in the response shape (cheaper on the client).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { KnowledgeEventSubtype } from "@/lib/changelog/log-knowledge-event";

export const maxDuration = 10;

export interface RecentActivityEvent {
  id: string;
  space_id: string;
  space_name: string;
  /** Stock enum value. */
  change_type: string;
  /** Phase 52 subtype when present. Falls back to change_type for legacy rows. */
  subtype: KnowledgeEventSubtype | string;
  summary: string;
  /** Full details JSON — caller picks fields. */
  details: Record<string, unknown>;
  created_at: string;
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  void user;

  const url = new URL(request.url);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("space_changelog")
    .select("id, space_id, change_type, summary, details, created_at, spaces(name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[recent-activity]", error);
    return NextResponse.json({ events: [] });
  }

  const events: RecentActivityEvent[] = ((data ?? []) as Array<{
    id: string;
    space_id: string;
    change_type: string;
    summary: string;
    details: Record<string, unknown> | null;
    created_at: string;
    spaces: { name: string } | null;
  }>).map((r) => {
    const details = r.details ?? {};
    const subtype =
      (typeof details.subtype === "string" ? details.subtype : null) ??
      r.change_type;
    return {
      id: r.id,
      space_id: r.space_id,
      space_name: r.spaces?.name ?? "(space)",
      change_type: r.change_type,
      subtype: subtype as KnowledgeEventSubtype | string,
      summary: r.summary,
      details,
      created_at: r.created_at,
    };
  });

  return NextResponse.json({ events });
}
