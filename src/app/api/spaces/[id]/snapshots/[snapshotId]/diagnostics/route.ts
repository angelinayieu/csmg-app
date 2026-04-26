// ── /api/spaces/[id]/snapshots/[snapshotId]/diagnostics ──────────────
//
// R5 Phase A · P5 — diagnostics read + rerun.
//
//   GET  — returns the LATEST diagnostics row for this snapshot.
//          Empty { diagnostics: null } when none exist yet (shouldn't
//          happen post-P5 since captureSnapshot auto-runs, but stays
//          defensive for old snapshots).
//          Query: ?history=1 returns an array of all diagnostics rows
//          (most recent first), capped at 20.
//
//   POST — re-run diagnostics against this snapshot. Body:
//            { include_calibration?: boolean }  (default false)
//          Appends a new row to twin_diagnostics — does NOT overwrite
//          the prior row. Drift across re-runs is preserved by design
//          (e.g. a fresh run after a calibration-tolerance change
//          surfaces in history).

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { runTwinDiagnostics } from "@/lib/twin/run-twin-diagnostics";
import type {
  TwinDiagnostics,
  TwinDiagnosticsMeta,
} from "@/types/twin-diagnostics";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // calibration can be slow when enabled

interface Ctx {
  params: Promise<{ id: string; snapshotId: string }>;
}

// Verifies ownership + returns the snapshot row (scalar-only) so the
// caller can be sure the id is addressable before running anything.
async function checkSnapshotOwnership(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  snapshotId: string,
  userId: string,
): Promise<{ ok: true } | { error: NextResponse }> {
  const { data } = await db
    .from("twin_snapshots")
    .select("id, space_id, user_id")
    .eq("id", snapshotId)
    .maybeSingle();
  if (!data) {
    return {
      error: NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 },
      ),
    };
  }
  const row = data as { space_id: string; user_id: string };
  if (row.space_id !== spaceId) {
    return {
      error: NextResponse.json(
        { error: "Snapshot belongs to a different space" },
        { status: 400 },
      ),
    };
  }
  if (row.user_id !== userId) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true };
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId, snapshotId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const check = await checkSnapshotOwnership(db, spaceId, snapshotId, user.id);
  if ("error" in check) return check.error;

  const url = new URL(request.url);
  const historyFlag = url.searchParams.get("history");
  if (historyFlag === "1" || historyFlag === "true") {
    const { data, error } = await db
      .from("twin_diagnostics")
      .select(
        "id, snapshot_id, score, grade, passed, error_count, warning_count, info_count, calibration_status, calibration_score, computed_at",
      )
      .eq("snapshot_id", snapshotId)
      .order("computed_at", { ascending: false })
      .limit(20);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      history: (data ?? []) as TwinDiagnosticsMeta[],
    });
  }

  // Latest only (full row).
  const { data, error } = await db
    .from("twin_diagnostics")
    .select("*")
    .eq("snapshot_id", snapshotId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    diagnostics: (data ?? null) as TwinDiagnostics | null,
  });
}

interface PostBody {
  include_calibration?: unknown;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId, snapshotId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const check = await checkSnapshotOwnership(db, spaceId, snapshotId, user.id);
  if ("error" in check) return check.error;

  const body = (await request.json().catch(() => ({}))) as PostBody;
  const includeCalibration = body.include_calibration === true;

  const result = await runTwinDiagnostics(db, {
    snapshotId,
    includeCalibration,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    diagnosticsId: result.diagnosticsId,
    persisted: result.persisted,
    warning: result.warning,
    quality: result.quality,
    calibration: result.calibration,
  });
}
