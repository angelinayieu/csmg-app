// ── POST /api/brainstorm/sessions/[id]/pin ──────────────────────────
//
// Toggle a session's pinned flag. Pinned sessions appear in the
// Brainstorm Library lens; unpinned ones are reachable only by id
// (e.g. via a saved tldraw_page_id when Phase 4b lands).
//
// Body: { pinned: boolean }
// Returns: { ok: true, pinned }
//
// Per BRAINSTORM_MODULE_SPEC.md decision #4: sessions auto-save on
// close; pinning is what surfaces them in the library list. The runner
// also seeds `pinned=false` by default — the Save-to-library button
// in the panel flips it true.

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { setPinned } from "@/lib/brainstorm/sessions";

export const runtime = "nodejs";

interface Body {
  pinned?: boolean;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { id: sessionId } = await ctx.params;
  if (!sessionId) {
    return NextResponse.json({ error: "session id required" }, { status: 400 });
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const pinned = body?.pinned === true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = auth.supabase as any;

    // Verify ownership before mutation — RLS would catch it but a clean
    // 404 is friendlier than a silent no-op.
    const { data: row } = await db
      .from("brainstorm_sessions")
      .select("user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    if (row.user_id !== auth.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const ok = await setPinned(db, sessionId, pinned);
    if (!ok) {
      return NextResponse.json(
        { error: "pin write failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, pinned });
  } catch (err) {
    return NextResponse.json(
      { error: `pin failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
