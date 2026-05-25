// ── POST /api/brainstorm/space/mode ────────────────────────────────
//
// Switches the Objective Canvas's pipeline_mode mid-flight. The
// runtime gating is at the call sites (room generator auto-fires in
// autopilot, waits for explicit click in review_each).
//
// Body: { spaceId, mode: "autopilot" | "review_each" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  mode?: "autopilot" | "review_each";
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
  if (body?.mode !== "autopilot" && body?.mode !== "review_each") {
    return NextResponse.json(
      { error: "mode must be 'autopilot' or 'review_each'" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership check folded into the update predicate.
  const update = await db
    .from("spaces")
    .update({ pipeline_mode: body.mode })
    .eq("id", spaceId)
    .eq("user_id", auth.user.id)
    .select("id, pipeline_mode")
    .single();

  if (update.error) {
    return NextResponse.json(
      { error: "DB error", detail: update.error.message },
      { status: 500 },
    );
  }
  if (!update.data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    spaceId: update.data.id,
    pipeline_mode: update.data.pipeline_mode,
  });
}
