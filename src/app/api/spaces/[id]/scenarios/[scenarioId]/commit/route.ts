// ── /api/spaces/[id]/scenarios/[scenarioId]/commit ───────────────────
//
// R5 Phase B — commit a scenario to the live KG.
//
// Irreversible. The scenario's action list is replayed against the
// live `entities` / `edges` tables, a post-intervention snapshot is
// captured, and scenario.status flips to "applied".
//
// Body:
//   { confirm: true }  — explicit confirmation token. The client is
//     expected to gate this behind a user confirmation dialog; we
//     refuse without it as a defence-in-depth against an unguarded
//     POST from code paths that didn't mean to commit. Absent or
//     false → 400.
//
// Returns:
//   { ok: true, scenarioId, actionsApplied, actionsSkipped,
//     postSnapshotId, appliedAt }
//
// Notes:
//   - Ownership + status guards happen inside commitScenarioToLiveKG;
//     we forward the caller's user id for the audit trail.
//   - No partial-apply rollback here — Supabase's REST boundary
//     isn't transactional across tables. If any actions fail mid-
//     stream, the scenario stays in its prior status (draft/testing)
//     but some live rows are mutated; `actionsSkipped[]` reports the
//     gap for the UI to surface.
//   - This endpoint is the main HITL gate for the Phase A loop: the
//     irreversible step lives behind an explicit client-side confirm
//     + `confirm: true` body token + ownership check.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { commitScenarioToLiveKG } from "@/lib/twin/commit-scenario";
import type { Scenario } from "@/types/scenario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Ctx {
  params: Promise<{ id: string; scenarioId: string }>;
}

interface CommitBody {
  confirm?: unknown;
  skip_post_snapshot?: unknown;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId, scenarioId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check: the scenario must belong to this space + user.
  const { data: scenarioData } = await db
    .from("scenarios")
    .select("id, space_id, user_id")
    .eq("id", scenarioId)
    .maybeSingle();
  if (!scenarioData) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }
  const sc = scenarioData as Pick<Scenario, "id" | "space_id" | "user_id">;
  if (sc.space_id !== spaceId) {
    return NextResponse.json(
      { error: "Scenario belongs to a different space" },
      { status: 400 },
    );
  }
  if (sc.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // HITL gate: require explicit `{ confirm: true }`. This is the
  // defence-in-depth — the UI always sends it after a confirmation
  // dialog; code paths that POST without thinking get a 400 rather
  // than silently mutating the live KG.
  const body = (await request.json().catch(() => ({}))) as CommitBody;
  if (body.confirm !== true) {
    return NextResponse.json(
      {
        error:
          "commit requires explicit { confirm: true } in the request body",
      },
      { status: 400 },
    );
  }
  const skipPostSnapshot = body.skip_post_snapshot === true;

  // Execute.
  const result = await commitScenarioToLiveKG(db, {
    scenarioId,
    userId: user.id,
    skipPostSnapshot,
  });
  if (result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}
