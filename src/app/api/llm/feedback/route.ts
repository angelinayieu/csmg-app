// ── PATCH /api/llm/feedback ────────────────────────────────────────
//
// User thumbs-rating on an LLM-produced artifact (variation, composed
// design, prototype brief, recommendation, etc.). Resolves the
// matching llm_call_log row by (artifact_kind, artifact_id), then
// updates its `feedback` column to 'up' | 'down' | null (clear).
//
// Body: { artifactKind, artifactId, feedback: "up"|"down"|null }
//
// The artifact reference was set when the LLM call was logged via
// instrumentedLLMCall (see src/lib/objective-canvas/record-llm-call.ts).
// We always target the MOST RECENT log row for the (kind, id) tuple,
// since regenerations produce multiple rows — the user is rating
// what's currently in front of them.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";

type FeedbackValue = "up" | "down" | null;

interface Body {
  artifactKind?: string;
  artifactId?: string;
  feedback?: FeedbackValue;
}

const ALLOWED_FEEDBACK = new Set(["up", "down", null]);

export async function PATCH(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const artifactKind =
    typeof body?.artifactKind === "string" ? body.artifactKind : "";
  const artifactId =
    typeof body?.artifactId === "string" ? body.artifactId : "";
  if (!artifactKind || !artifactId) {
    return NextResponse.json(
      { error: "artifactKind + artifactId required" },
      { status: 400 },
    );
  }

  const feedback: FeedbackValue =
    body?.feedback === null || ALLOWED_FEEDBACK.has(body?.feedback ?? null)
      ? (body?.feedback ?? null)
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Find the MOST RECENT log row for this artifact. RLS scopes to
  // the current user automatically (policy on llm_call_log).
  const { data: latest, error: lookupErr } = await db
    .from("llm_call_log")
    .select("id")
    .eq("artifact_kind", artifactKind)
    .eq("artifact_id", artifactId)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json(
      { error: "DB error", detail: lookupErr.message },
      { status: 500 },
    );
  }
  if (!latest) {
    return NextResponse.json(
      {
        error: "no matching log row",
        detail:
          "No LLM call has been recorded for this artifact yet — try regenerating once before rating.",
      },
      { status: 404 },
    );
  }

  const { error: updateErr } = await db
    .from("llm_call_log")
    .update({
      feedback,
      feedback_at: feedback === null ? null : new Date().toISOString(),
    })
    .eq("id", latest.id);
  if (updateErr) {
    return NextResponse.json(
      { error: "persist failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, log_id: latest.id, feedback });
}
