// ── GET /api/cycles/[id]/detail ──
//
// Backs the canvas cycle-expansion drawer. Returns:
//   - Full cycle row (classification, intervention_point, growth_type,
//     cycle_time, estimated_multiplier, entity_ids list)
//   - Hydrated entity rows for the member list so the drawer can
//     render names + categories + leverage/risk flags inline

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "cycle id required" }, { status: 400 });
  }

  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: cycle, error: cycleError } = await db
    .from("cycles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (cycleError) {
    console.error("[cycles/detail] cycle fetch failed:", cycleError);
    return NextResponse.json({ error: "Cycle lookup failed" }, { status: 500 });
  }
  if (!cycle) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  const spaceId = cycle.space_id as string;
  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // `cycle.entity_ids` stores the ordered ring. Rows may reference
  // either the UUID (post-2026-04) or the semantic entity_id (older).
  // Fetch by both and union.
  const rawIds = Array.isArray(cycle.entity_ids) ? (cycle.entity_ids as string[]) : [];
  let memberEntities: unknown[] = [];
  if (rawIds.length > 0) {
    const [byUuid, byCode] = await Promise.all([
      db.from("entities").select("*").in("id", rawIds),
      db.from("entities").select("*").eq("space_id", spaceId).in("entity_id", rawIds),
    ]);
    const seen = new Set<string>();
    const merged: Array<Record<string, unknown>> = [];
    for (const row of [...(byUuid.data ?? []), ...(byCode.data ?? [])]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any;
      if (seen.has(r.id as string)) continue;
      seen.add(r.id as string);
      merged.push(r);
    }
    memberEntities = merged;
  }

  return NextResponse.json({ cycle, memberEntities });
}
