// ── POST /api/brainstorm/research/surface ─────────────────────────
//
// Kicks off the surface research pass for a space. Triggered by
// /api/brainstorm/start in fire-and-forget mode — the user is
// redirected into the clarifying card immediately while this runs
// in the background. The clarifying UI polls
// /api/brainstorm/research/status to know when the bundle lands.
//
// Idempotent: if surface_research is already populated for the
// space, returns the existing bundle. Re-running with mode=force
// re-issues the search.
//
// Body: { spaceId, mode?: "default" | "force" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  runSurfacePass,
  type SurfaceBundle,
} from "@/lib/research/research-service";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  spaceId?: string;
  mode?: "default" | "force";
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const force = body?.mode === "force";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Load space + ownership check.
  const { data: space, error: fetchError } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, surface_research")
    .eq("id", spaceId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: "DB error", detail: fetchError.message },
      { status: 500 },
    );
  }
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Idempotent short-circuit.
  const existing = space.surface_research as SurfaceBundle | null;
  if (!force && existing && (existing as { status?: string }).status) {
    return NextResponse.json({ surface_research: existing, cached: true });
  }

  const objective: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // Mark as pending so the polling client sees something while
  // the search runs.
  await db
    .from("spaces")
    .update({
      surface_research: { status: "pending", started_at: new Date().toISOString() },
    })
    .eq("id", spaceId);

  let bundle: SurfaceBundle;
  try {
    bundle = await runSurfacePass({ objective });
  } catch (err) {
    bundle = {
      status: "error",
      sources: [],
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };
    console.warn(
      "[research/surface] runSurfacePass threw:",
      sanitizeErrorMessage(err),
    );
  }

  // Persist the result.
  const writeRes = await db
    .from("spaces")
    .update({ surface_research: bundle })
    .eq("id", spaceId);
  if (writeRes.error) {
    console.warn(
      "[research/surface] failed to persist bundle:",
      writeRes.error.message,
    );
    // Don't fail the request — return the bundle anyway for the
    // immediate client. The next poll will see the unsaved state
    // but the bundle is in-flight in memory.
  }

  return NextResponse.json({ surface_research: bundle });
}
