// ── /api/spaces/[id]/scenarios/[scenarioId] ──────────────────────────
//
// R5 Phase A — single-scenario detail + lifecycle.
//
//   GET    — full scenario row + all scenario_deltas for it
//   PATCH  — update status / label / description. Valid status moves:
//              draft → testing | rejected
//              testing → applied | rejected | draft
//              applied → superseded
//              rejected → (terminal; do not re-open — create new)
//              superseded → (terminal)
//   DELETE — sets status='rejected'. Hard-delete is NOT exposed — the
//            scenario row + its deltas stay for audit even after a
//            user dismisses. Callers who really want hard-delete can
//            issue a Supabase RPC; the API refuses by design.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { Scenario, ScenarioDelta, ScenarioStatus } from "@/types/scenario";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; scenarioId: string }>;
}

const VALID_STATUS: ScenarioStatus[] = [
  "draft",
  "testing",
  "applied",
  "rejected",
  "superseded",
];

// Status-move table — keep in sync with the comment at top.
const ALLOWED_MOVES: Record<ScenarioStatus, ScenarioStatus[]> = {
  draft: ["testing", "rejected"],
  testing: ["applied", "rejected", "draft"],
  applied: ["superseded"],
  rejected: [],
  superseded: [],
};

async function loadScenario(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  scenarioId: string,
  userId: string,
): Promise<{ row: Scenario; deltas: ScenarioDelta[] } | { error: NextResponse }> {
  const { data: scenario } = await db
    .from("scenarios")
    .select("*")
    .eq("id", scenarioId)
    .maybeSingle();
  if (!scenario) {
    return {
      error: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  const row = scenario as Scenario;
  if (row.space_id !== spaceId) {
    return {
      error: NextResponse.json(
        { error: "Scenario belongs to a different space" },
        { status: 400 },
      ),
    };
  }
  if (row.user_id !== userId) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  const { data: deltasData } = await db
    .from("scenario_deltas")
    .select("*")
    .eq("scenario_id", scenarioId)
    .order("action_index", { ascending: true });
  const deltas: ScenarioDelta[] = (deltasData ?? []) as ScenarioDelta[];
  return { row, deltas };
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId, scenarioId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const result = await loadScenario(db, spaceId, scenarioId, user.id);
  if ("error" in result) return result.error;

  return NextResponse.json({
    scenario: result.row,
    deltas: result.deltas,
  });
}

interface PatchBody {
  status?: unknown;
  label?: unknown;
  description?: unknown;
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId, scenarioId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const result = await loadScenario(db, spaceId, scenarioId, user.id);
  if ("error" in result) return result.error;
  const row = result.row;

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {};

  if (typeof body.label === "string" && body.label.trim().length > 0) {
    updates.label = body.label.trim().slice(0, 200);
  }
  if (typeof body.description === "string") {
    updates.description = body.description.trim().slice(0, 2000);
  }
  if (typeof body.status === "string") {
    const nextStatus = body.status as ScenarioStatus;
    if (!VALID_STATUS.includes(nextStatus)) {
      return NextResponse.json(
        { error: `invalid status "${body.status}"` },
        { status: 400 },
      );
    }
    if (nextStatus !== row.status) {
      const allowed = ALLOWED_MOVES[row.status];
      if (!allowed.includes(nextStatus)) {
        return NextResponse.json(
          {
            error: `cannot transition from ${row.status} to ${nextStatus}`,
          },
          { status: 400 },
        );
      }
      updates.status = nextStatus;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
  }

  const { data: updated, error } = await db
    .from("scenarios")
    .update(updates)
    .eq("id", scenarioId)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ scenario: updated as Scenario });
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId, scenarioId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const result = await loadScenario(db, spaceId, scenarioId, user.id);
  if ("error" in result) return result.error;

  // Soft-delete — flip status to rejected. The row + its deltas stay.
  const { error } = await db
    .from("scenarios")
    .update({ status: "rejected" as ScenarioStatus })
    .eq("id", scenarioId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, softDeleted: true });
}
