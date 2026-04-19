// ── Brainstorm materialize ──
//
// POST /api/brainstorm/materialize
//   body: {
//     text,
//     target: { type: "existing", space_id } | { type: "new", name?, description? }
//   }
//
// Creates a new entity from the user's free-form text. If target is an
// EXISTING space, the entity is added there with predicted connections to
// top matches (same flow as /api/whiteboard/playground/materialize). If the
// target is a NEW space, a fresh space is created first (no template) and
// the entity is placed there.
//
// After materialization, the caller is expected to redirect the user to the
// target space.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 60;

type TargetInput =
  | { type: "existing"; space_id: string }
  | { type: "new"; name?: string; description?: string };

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let text: string;
  let target: TargetInput;
  try {
    const body = await request.json();
    text = body.text;
    target = body.target;
    if (typeof text !== "string" || text.trim().length < 3) {
      return NextResponse.json({ error: "text required (>= 3 chars)" }, { status: 400 });
    }
    if (!target || (target.type !== "existing" && target.type !== "new")) {
      return NextResponse.json({ error: "target.type must be 'existing' or 'new'" }, { status: 400 });
    }
    if (target.type === "existing" && typeof target.space_id !== "string") {
      return NextResponse.json({ error: "target.space_id required when type=existing" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // ── Step 1: Ensure we have a target space ──
    let spaceId: string;

    if (target.type === "existing") {
      const isOwner = await verifySpaceOwnership(supabase, target.space_id, user.id);
      if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      spaceId = target.space_id;
    } else {
      // Create a fresh space for this brainstorm thread. No template — default
      // decomposition will apply naturally when content lands in it.
      const name =
        target.name?.trim() ||
        text.trim().split(/\s/).slice(0, 6).join(" ").slice(0, 60) ||
        "Brainstorm";

      const description = target.description?.trim() ?? "Created from a brainstorm session.";

      const { data: newSpace, error: spaceErr } = await db
        .from("spaces")
        .insert({
          user_id: user.id,
          name,
          description,
          space_prefix: "BS",
          input_text: text,
          entity_count: 0,
          edge_count: 0,
          orphan_count: 0,
          cycle_count: 0,
          maturity: "actionable_now",
        })
        .select("id")
        .single();

      if (spaceErr || !newSpace) {
        console.error("[brainstorm/materialize] Space creation failed:", spaceErr);
        return NextResponse.json({ error: "Space creation failed" }, { status: 500 });
      }
      spaceId = newSpace.id;

      // Non-critical changelog
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "brainstorm_seed",
        summary: `Created from brainstorm: "${text.slice(0, 80)}…"`,
        details: { source: "brainstorm" },
      }).then(() => {}, () => {});
    }

    // ── Step 2: Call the existing playground materialize pipeline ──
    // It handles the LLM extraction + predicted edges + insert in a way we
    // don't want to duplicate. Internal fetch so auth/RLS/logging apply.
    const origin = new URL(request.url).origin;
    const cookieHeader = request.headers.get("cookie") ?? "";

    const matRes = await fetch(`${origin}/api/whiteboard/playground/materialize`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ space_id: spaceId, text }),
    });

    if (!matRes.ok) {
      const err = await matRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error ?? `Materialize failed: HTTP ${matRes.status}`, space_id: spaceId },
        { status: 500 },
      );
    }

    const materialized = await matRes.json();

    return NextResponse.json({
      space_id: spaceId,
      created_new_space: target.type === "new",
      entity: materialized.entity,
      predicted_edges: materialized.predicted_edges,
      llm_reasoning: materialized.llm_reasoning,
    });
  } catch (err) {
    console.error("[brainstorm/materialize] Error:", err);
    return NextResponse.json(
      { error: `Materialize failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
