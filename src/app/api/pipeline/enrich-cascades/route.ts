import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { runCascadeForSpace } from "@/lib/graph/run-cascade";

export const maxDuration = 30;

/**
 * POST /api/pipeline/enrich-cascades
 *
 * Runs cascade detection for a space and persists the result to
 * `reasoning_results` with reasoning_type='cascade'. Safe to call repeatedly —
 * each invocation appends a new row so history is preserved.
 *
 * Use this to backfill cascades on spaces that were decomposed before the
 * auto-cascade wiring landed, or to refresh the cascade view without running
 * full Re-evaluate (which also costs credits and calls the LLM).
 *
 * This endpoint does NOT consume credits — it's purely algorithmic.
 */
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  try {
    const body = await request.json();
    spaceId = body.spaceId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const report = await runCascadeForSpace(db, spaceId, { source: "backfill" });
    if (!report) {
      return NextResponse.json(
        { ok: false, reason: "Space has no entities" },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      seeds_analyzed: report.seeds_analyzed,
      paths: report.paths.length,
      total_affected_entities: report.total_affected_entities,
      systemic_pressure_points: report.systemic_pressure_points.length,
      computed_at: report.computed_at,
    });
  } catch (err) {
    console.error("[enrich-cascades] failed:", err);
    return NextResponse.json(
      { error: "Cascade computation failed." },
      { status: 500 }
    );
  }
}
