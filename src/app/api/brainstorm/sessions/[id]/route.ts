// ── GET /api/brainstorm/sessions/[id] ───────────────────────────────
//
// Single-row fetcher for live polling during the runner pipeline.
// Phase 4b-1 streaming pattern: the panel POSTs /sessions/run (long-
// running ~25-30s) AND in parallel polls THIS endpoint every ~1s while
// status='running'. Each poll returns the current row state — as the
// runner appends generations / sets cleanup / sets ranking, the panel
// sees the partial state and renders accumulating candidates.
//
// Matches the project_event_bus_architecture pattern (persist-then-
// emit, 500ms-1s DB poll, soft-fail throughout) without needing true
// SSE — the objective_brainstorm_sessions row IS the event log because every
// stage writes JSONB to a different column.
//
// Returns: { session: BrainstormSession | null }
// RLS-scoped to the current user automatically.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { getSession } from "@/lib/brainstorm/sessions";

export const runtime = "nodejs";

export async function GET(
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
    const session = await getSession(auth.supabase as any, sessionId);
    if (!session) {
      return NextResponse.json({ session: null }, { status: 404 });
    }
    if (session.user_id !== auth.user.id) {
      // RLS would also catch this but a clean 403 is friendlier than
      // a confusing 404-from-RLS.
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    // Cache-Control no-store — polling expects fresh data every call.
    return NextResponse.json(
      { session },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: `fetch failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
