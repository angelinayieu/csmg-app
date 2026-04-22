// POST /api/interventions/[id]/abandon
//
// Wave D L1 — flip an intervention to 'abandoned'. Same pattern as
// /complete but with a different status + different event type so the
// digest learns the user's abandonment patterns separately.
//
// Body: { note?: string } — recommended when abandoning so the user's
// reason is captured for the digest's rejection-pattern analysis.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { abandonIntervention } from "@/lib/interventions/lifecycle";

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

  const result = await abandonIntervention(db, id, user.id, note);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to abandon intervention" },
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
