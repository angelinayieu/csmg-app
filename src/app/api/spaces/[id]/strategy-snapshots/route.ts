// GET /api/spaces/:id/strategy-snapshots — list snapshot versions for a space
// PATCH /api/spaces/:id/strategy-snapshots — rename a snapshot's user_label
//
// Arc 4 Phase A. The strategy_snapshots table has existed for a while (every
// regen writes a new row, old rows get status: "superseded"). Until now we
// had no read endpoint for them — the strategy page only sees the newest
// batch via synthesis_data. This endpoint exposes the lineage so the UI
// can render "v1 (superseded) → v2 (confirmed) → v3 (reviewing)" and let
// the user drag any version onto the canvas as a draggable artifact.
//
// Shape notes:
//   - `label` is always populated at response time: user_label when set,
//     else "v{version}". Keeps the UI free of fallback logic.
//   - `confirmed_version` is the version that owns spaces.strategy_committed_at
//     (i.e. the one currently in synthesis_data). Null pre-confirm.
//   - Ordered newest-first so the strategy-page drawer renders top-down
//     without reversing.
//
// Ownership guarded by user_id eq check; RLS on strategy_snapshots enforces
// the same thing at the row level.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 30;

export interface StrategySnapshotSummary {
  id: string;
  version: number;
  /** user_label ?? `v{version}` — always present */
  label: string;
  /** Raw user_label as stored (null if auto) so the UI can show rename affordance */
  user_label: string | null;
  status: "generated" | "reviewing" | "confirmed" | "superseded";
  trigger: "manual" | "auto_chain" | "resynthesize";
  quality_score: number | null;
  created_at: string;
  /** Count of top-level tactics on this version's recommendation — preview metric for the drawer */
  tactic_count: number | null;
  /** Title pulled off recommendation.core_move.name or .title for preview */
  title: string | null;
}

export interface StrategySnapshotsResponse {
  snapshots: StrategySnapshotSummary[];
  /** Version of the currently-live snapshot (confirmed one), or null if none confirmed yet. */
  confirmed_version: number | null;
  /** Highest version number (latest regen) */
  latest_version: number | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check. Single roundtrip before we fan out.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: rows, error } = await db
    .from("strategy_snapshots")
    .select("id, version, user_label, status, trigger, quality_score, created_at, recommendation")
    .eq("space_id", spaceId)
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load snapshots" },
      { status: 500 },
    );
  }

  const snapshots: StrategySnapshotSummary[] = (rows ?? []).map((r: {
    id: string;
    version: number;
    user_label: string | null;
    status: StrategySnapshotSummary["status"];
    trigger: StrategySnapshotSummary["trigger"];
    quality_score: number | null;
    created_at: string;
    recommendation: Record<string, unknown> | null;
  }) => {
    const rec = r.recommendation ?? {};
    // Preview field extraction — defensive because older snapshot shapes differ
    const coreMove = (rec as { core_move?: { name?: string } }).core_move;
    const title =
      (rec as { title?: string }).title ??
      coreMove?.name ??
      null;
    const tactics = (rec as { micro_tactics?: unknown[] }).micro_tactics;
    const tactic_count = Array.isArray(tactics) ? tactics.length : null;

    return {
      id: r.id,
      version: r.version,
      label: r.user_label ?? `v${r.version}`,
      user_label: r.user_label,
      status: r.status,
      trigger: r.trigger,
      quality_score: r.quality_score,
      created_at: r.created_at,
      tactic_count,
      title,
    };
  });

  const confirmed = snapshots.find((s) => s.status === "confirmed") ?? null;

  const payload: StrategySnapshotsResponse = {
    snapshots,
    confirmed_version: confirmed?.version ?? null,
    latest_version: snapshots[0]?.version ?? null,
  };

  return NextResponse.json(payload);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let body: { snapshot_id?: string; user_label?: string | null } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { snapshot_id, user_label } = body;
  if (!snapshot_id || typeof snapshot_id !== "string") {
    return NextResponse.json(
      { error: "snapshot_id (string) is required" },
      { status: 400 },
    );
  }
  if (user_label !== null && typeof user_label !== "string") {
    return NextResponse.json(
      { error: "user_label must be a string or null" },
      { status: 400 },
    );
  }
  // Clamp label length (DB is text but UI chokes on >80 char labels)
  const normalisedLabel =
    user_label === null ? null : user_label.trim().slice(0, 80) || null;

  // Ownership — ensure the snapshot belongs to a space the user owns.
  const { data: snapshot } = await db
    .from("strategy_snapshots")
    .select("id, space_id")
    .eq("id", snapshot_id)
    .eq("space_id", spaceId)
    .maybeSingle();
  if (!snapshot) {
    return NextResponse.json(
      { error: "Snapshot not found in this space" },
      { status: 404 },
    );
  }
  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error: updateErr } = await db
    .from("strategy_snapshots")
    .update({ user_label: normalisedLabel })
    .eq("id", snapshot_id);
  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message ?? "Rename failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    snapshot_id,
    user_label: normalisedLabel,
    label: normalisedLabel ?? null, // caller derives default label from version
  });
}
