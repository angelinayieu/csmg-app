// ── /api/spaces/[id]/scenarios ───────────────────────────────────────
//
// R5 Phase A — scenarios CRUD.
//
//   GET  /api/spaces/[id]/scenarios
//     List scenarios for this space. Returns ScenarioMeta[] (no
//     action_list). Use the detail endpoint for the full object.
//     Filter: ?status=draft|testing|applied|rejected|superseded
//
//   POST /api/spaces/[id]/scenarios
//     Body: { parent_snapshot_id, label, description?, actions: ScenarioAction[] }
//     Creates a scenario + derives deltas via applyScenarioActions.
//     Both the scenario row AND the derived scenario_deltas rows are
//     written in one request. Returns the created scenario + deltas.
//
// See src/types/scenario.ts for the action discriminant union.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { applyScenarioActions } from "@/lib/twin/snapshot-capture";
import type {
  ScenarioAction,
  ScenarioMeta,
  ScenarioStatus,
} from "@/types/scenario";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const VALID_STATUS: ScenarioStatus[] = [
  "draft",
  "testing",
  "applied",
  "rejected",
  "superseded",
];

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((space as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  let query = db
    .from("scenarios")
    .select(
      "id, space_id, parent_snapshot_id, status, label, action_count, delta_count, applied_at, post_snapshot_id, created_at, updated_at",
    )
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (statusFilter && VALID_STATUS.includes(statusFilter as ScenarioStatus)) {
    query = query.eq("status", statusFilter);
  }
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const scenarios: ScenarioMeta[] = (data ?? []) as ScenarioMeta[];
  return NextResponse.json({ scenarios });
}

interface CreateBody {
  parent_snapshot_id?: unknown;
  label?: unknown;
  description?: unknown;
  actions?: unknown;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((space as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const parentSnapshotId =
    typeof body.parent_snapshot_id === "string" ? body.parent_snapshot_id : null;
  const label =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim().slice(0, 200)
      : null;
  const description =
    typeof body.description === "string"
      ? body.description.trim().slice(0, 2000)
      : null;
  const actions = Array.isArray(body.actions)
    ? (body.actions as ScenarioAction[])
    : null;

  if (!parentSnapshotId) {
    return NextResponse.json(
      { error: "parent_snapshot_id is required" },
      { status: 400 },
    );
  }
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (!actions || actions.length === 0) {
    return NextResponse.json(
      { error: "actions must be a non-empty array" },
      { status: 400 },
    );
  }

  // Load parent snapshot — must belong to this space + user.
  const { data: snapshot } = await db
    .from("twin_snapshots")
    .select("id, space_id, user_id, entities, edges, cycles, bridges")
    .eq("id", parentSnapshotId)
    .maybeSingle();
  if (!snapshot) {
    return NextResponse.json(
      { error: "parent snapshot not found" },
      { status: 404 },
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshotRow = snapshot as any;
  if (snapshotRow.space_id !== spaceId) {
    return NextResponse.json(
      { error: "parent snapshot belongs to a different space" },
      { status: 400 },
    );
  }
  if (snapshotRow.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Replay actions to derive deltas. Pure function; doesn't hit DB.
  const replay = applyScenarioActions(
    Array.isArray(snapshotRow.entities) ? snapshotRow.entities : [],
    Array.isArray(snapshotRow.edges) ? snapshotRow.edges : [],
    Array.isArray(snapshotRow.cycles) ? snapshotRow.cycles : [],
    Array.isArray(snapshotRow.bridges) ? snapshotRow.bridges : [],
    actions,
  );

  // Insert scenario row.
  const { data: inserted, error: insErr } = await db
    .from("scenarios")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      parent_snapshot_id: parentSnapshotId,
      status: "draft" as ScenarioStatus,
      label,
      description,
      action_list: actions,
      action_count: actions.length,
      delta_count: replay.deltas.length,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return NextResponse.json(
      { error: insErr?.message ?? "insert failed" },
      { status: 500 },
    );
  }
  const scenarioId = (inserted as { id: string }).id;

  // Bulk-insert derived deltas. Soft-fail at the deltas layer — the
  // scenario row exists even if deltas can't persist (UI can re-derive
  // from the action_list). But log loudly.
  if (replay.deltas.length > 0) {
    const deltaRows = replay.deltas.map((d) => ({
      scenario_id: scenarioId,
      target_kind: d.target_kind,
      target_id: d.target_id,
      op: d.op,
      field: d.field,
      old_value: d.old_value,
      new_value: d.new_value,
      action_index: d.action_index,
    }));
    const { error: deltaErr } = await db
      .from("scenario_deltas")
      .insert(deltaRows);
    if (deltaErr) {
      console.warn(
        `[scenarios] delta insert failed for scenario ${scenarioId}:`,
        deltaErr,
      );
    }
  }

  return NextResponse.json({
    scenarioId,
    actionCount: actions.length,
    deltaCount: replay.deltas.length,
    skipped: replay.skipped,
  });
}
