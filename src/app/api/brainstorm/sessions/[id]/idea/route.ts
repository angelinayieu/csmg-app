// ── POST /api/brainstorm/sessions/[id]/idea ─────────────────────────
//
// Append a user-added idea (sticky-note) to the brainstorm session's
// user_added_ideas JSONB array. Phase 4b-3 of BRAINSTORM_MODULE_SPEC.md.
//
// Body: { id, text }            (text required, 3..400 chars; id optional)
// Returns: { ok: true, idea: BrainstormUserIdea }
//
// Phase 4b-3 scope: PERSIST. Phase 5b will add per-idea LLM scoring
// (run them through the same critique pass as ranked candidates so
// they show coverage/diversity/preference/critique sub-scores on the
// same axes). For now, scored_with_session=false → panel renders the
// sticky as "your idea" without score chips.

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { appendUserIdea } from "@/lib/brainstorm/sessions";
import type { BrainstormUserIdea } from "@/lib/brainstorm/session-types";

export const runtime = "nodejs";

interface Body {
  id?: string;
  text?: string;
  /** Optional title/body split. When provided, `text` is treated as
   *  the body and this becomes the headline. Defaults to the first
   *  60 chars of text. */
  title?: string;
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

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < 3) {
    return NextResponse.json(
      { error: "text must be at least 3 characters" },
      { status: 400 },
    );
  }
  if (text.length > 400) {
    return NextResponse.json(
      { error: "text capped at 400 characters" },
      { status: 400 },
    );
  }

  const ideaId =
    typeof body?.id === "string" && body.id.length > 0
      ? body.id
      : `idea-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const title =
    typeof body?.title === "string" && body.title.trim().length > 0
      ? body.title.trim().slice(0, 80)
      : text.slice(0, 60);

  const idea: BrainstormUserIdea = {
    id: ideaId,
    title,
    body: text,
    added_at: new Date().toISOString(),
    scored_with_session: false,
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = auth.supabase as any;
    // Verify ownership first — appendUserIdea is soft-fail, so an
    // unauthorized append would silently no-op. Better to 403 cleanly.
    const { data: row } = await db
      .from("objective_brainstorm_sessions")
      .select("user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    if (row.user_id !== auth.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const ok = await appendUserIdea(db, sessionId, idea);
    if (!ok) {
      return NextResponse.json(
        { error: "append failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, idea });
  } catch (err) {
    return NextResponse.json(
      { error: `idea failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
