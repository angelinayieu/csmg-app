// POST /api/interventions/[id]/complete
//
// Wave D L1 — flip an intervention from 'proposed'/'active' to
// 'completed'. Records a user_event, triggers app health recompute so
// the `delivery_bonus` factor in computeHealthScore finally moves.
//
// Body (optional): { note?: string }.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { completeIntervention } from "@/lib/interventions/lifecycle";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id } = await ctx.params;

  const { data: body } = await safeJsonParse<{ note?: string }>(request);
  const note =
    typeof body?.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, 2000)
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const result = await completeIntervention(db, id, user.id, note);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to complete intervention" },
      { status: result.error === "Intervention not found" ? 404 : 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    intervention_id: result.intervention_id,
    new_status: result.new_status,
    app_health_after: result.app_health_after,
  });
}
