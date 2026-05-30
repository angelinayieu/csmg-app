// ── GET /api/brainstorm/sessions ────────────────────────────────────
//
// List the current user's brainstorm sessions for the Library lens
// (Phase 5 of BRAINSTORM_MODULE_SPEC.md).
//
// Query params:
//   spaceId      — optional, filter to one space
//   onlyPinned   — "true" to surface only library-pinned sessions
//   limit        — 1..200, default 50
//
// Returns: { sessions: BrainstormSession[] } newest-first.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { listSessions } from "@/lib/brainstorm/sessions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const url = new URL(req.url);
  const spaceId = url.searchParams.get("spaceId") || undefined;
  const onlyPinned = url.searchParams.get("onlyPinned") === "true";
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit ? Number(rawLimit) : undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessions = await listSessions(auth.supabase as any, {
      spaceId,
      onlyPinned,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json(
      { error: `list failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
