// ── POST /api/brainstorm/sessions/[id]/save-to-library ─────────────
//
// Phase 7-Consolidate of BRAINSTORM_MODULE_SPEC.md — write the
// settled session as a canonical `library_objects` row of type
// `brainstorm_cluster` so it surfaces in the existing LibraryPanel
// alongside other saved objects (features / mechanisms / variations /
// deliverables / etc.).
//
// This REPLACES the legacy `/pin` endpoint in spirit. The session row
// stays as-is (it stores the full ranking + plan + generations history
// for re-open); the library row is the addressable HANDLE the rest of
// the canvas uses. Same pattern as canvas-interactions/save-to-library.ts
// for whiteboard cards — one library, one storage layer.
//
// Idempotent: re-saving the same session updates the existing row
// (natural-key dedup in upsertLibraryObject).
//
// Body: none
// Returns: { ok: true, library_object_id }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { getSession, saveSessionToLibrary } from "@/lib/brainstorm/sessions";

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
    const session = await getSession(db, sessionId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    if (session.user_id !== auth.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const libraryObjectId = await saveSessionToLibrary(db, {
      userId: auth.user.id,
      session,
    });
    if (!libraryObjectId) {
      return NextResponse.json(
        { error: "library upsert failed (soft-fail in helper)" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, library_object_id: libraryObjectId });
  } catch (err) {
    return NextResponse.json(
      { error: `save-to-library failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
