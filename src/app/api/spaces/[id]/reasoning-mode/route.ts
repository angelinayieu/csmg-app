// ── /api/spaces/[id]/reasoning-mode ─────────────────────────────────
//
// PATCH → flip generateApps / runLab flags on the space's
//         reasoning_settings JSONB. Used by the canvas top-bar mode
//         chip to cycle Plan-only → Plan+Apps → Plan+Apps+Lab.
//
// Narrow surface area: this route ONLY updates the two output-shape
// flags. Other reasoning_settings fields (lenses, depth, askClarifying,
// etc.) are preserved untouched. We do a read-modify-write rather
// than `update` with the JSONB merge operator so the schema stays
// resilient to additional reasoning_settings fields landing in the
// future without changing this route.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface IncomingBody {
  generateApps?: unknown;
  runLab?: unknown;
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const parsed = await safeJsonParse<IncomingBody>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const generateApps = body.generateApps === true;
  const runLab = body.runLab === true;

  // Defensive: runLab without generateApps is meaningless (lab runs on
  // top of apps). Coerce it false instead of failing loud — this path
  // is mostly hit by the chip cycle, which would never produce that
  // combo, but a manual API hit could.
  const effectiveRunLab = generateApps ? runLab : false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spaceRow, error: readErr } = await db
    .from("spaces")
    .select("reasoning_settings")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const existing =
    (spaceRow?.reasoning_settings as Record<string, unknown> | null) ?? {};
  const updated = {
    ...existing,
    generateApps,
    runLab: effectiveRunLab,
  };

  const { error: writeErr } = await db
    .from("spaces")
    .update({ reasoning_settings: updated })
    .eq("id", spaceId)
    .eq("user_id", user.id);

  if (writeErr) {
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  return NextResponse.json({
    reasoning_settings: updated,
    mode:
      generateApps && effectiveRunLab
        ? "plan-apps-lab"
        : generateApps
          ? "plan-apps"
          : "plan",
  });
}
