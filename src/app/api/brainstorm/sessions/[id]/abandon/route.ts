// ── POST /api/brainstorm/sessions/[id]/abandon ──────────────────────
//
// Flip a session to status='abandoned'. Called when:
//   • User closes the panel while a runner is still in-flight
//   • Runner errored hard mid-pipeline (the route can self-mark)
//
// Idempotent — abandoning an already-settled session is a no-op
// (status check on the row, not in the helper).
//
// Body: none required.
// Returns: { ok: true, status: "abandoned" | "settled" } — settled means
//          the runner won the race before close.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { abandon } from "@/lib/brainstorm/sessions";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { id: sessionId } = await ctx.params;
  if (!sessionId) {
    return NextResponse.json({ error: "session id required" }, { status: 400 });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = auth.supabase as any;
    const { data: row } = await db
      .from("objective_brainstorm_sessions")
      .select("user_id, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    if (row.user_id !== auth.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (row.status === "settled") {
      // Settled wins — don't downgrade. Useful for the race where
      // the runner returns while the user is closing the panel.
      return NextResponse.json({ ok: true, status: "settled" });
    }
    if (row.status === "abandoned") {
      return NextResponse.json({ ok: true, status: "abandoned" });
    }
    await abandon(db, sessionId);
    return NextResponse.json({ ok: true, status: "abandoned" });
  } catch (err) {
    return NextResponse.json(
      { error: `abandon failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
