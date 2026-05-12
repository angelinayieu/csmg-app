// ── /api/spaces/[id]/preflight/overrides ─────────────────────────────
//
// Edit endpoint for the preflight page (Phase C). Writes user-driven
// changes to the `environment_overrides` table. The preflight
// aggregator reads from this table on next render, so any override
// surfaced through this endpoint propagates automatically.
//
// POST   /api/spaces/[id]/preflight/overrides
//   body: { override_kind, target_id, value, reasoning? }
//   → inserts (or upserts on (space_id, override_kind, target_id)) and
//     returns the new override row
//
// DELETE /api/spaces/[id]/preflight/overrides?id={override_id}
//   → removes one override (revert action)
//
// Auth: owner-only via safeAuth. The override row is stamped with the
// authenticated user_id; non-owner POSTs are 404.
//
// Why upsert: each (override_kind, target_id) pair represents ONE
// user choice. Toggling an opt-in plan item ON then OFF should not
// stack two rows; the second write replaces the first. The
// aggregator only needs to see the latest state per pair.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// All valid override_kind values from PreflightOverride. Validated
// here so an LLM client passing a typo doesn't poison the table with
// rows the aggregator can't interpret.
const VALID_OVERRIDE_KINDS = new Set([
  "reclassify_variable",
  "add_variable",
  "remove_variable",
  "set_observability",
  "adjust_goal",
  "approve_preview_bridge",
  "reject_preview_bridge",
  "toggle_plan_item",
  "set_condition",
  "request_baseline_measurement",
]);

interface OverridePostBody {
  override_kind?: string;
  target_id?: string;
  value?: unknown;
  reasoning?: string | null;
}

interface OverrideRow {
  id: string;
  space_id: string;
  override_kind: string;
  target_id: string | null;
  override_value: unknown;
  reasoning: string | null;
  created_at: string;
  created_by: string | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body, error: parseErr } = await safeJsonParse(request);
  if (parseErr) return parseErr;

  const b = (body ?? {}) as OverridePostBody;
  const overrideKind = typeof b.override_kind === "string" ? b.override_kind : null;
  const targetId = typeof b.target_id === "string" ? b.target_id : null;

  if (!overrideKind || !VALID_OVERRIDE_KINDS.has(overrideKind)) {
    return NextResponse.json(
      { error: `Invalid override_kind. Must be one of: ${[...VALID_OVERRIDE_KINDS].join(", ")}` },
      { status: 400 },
    );
  }
  if (!targetId) {
    return NextResponse.json(
      { error: "target_id is required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Upsert pattern: (space_id, override_kind, target_id) is the natural
  // key for "one user choice per target." When the user toggles or
  // re-edits, replace the row instead of stacking. Falls back to a
  // delete-then-insert sequence — Supabase's upsert with onConflict
  // requires a unique constraint we don't currently have on this combo.
  // The cost is one extra round-trip; acceptable for an edit endpoint.
  const { error: delErr } = await db
    .from("environment_overrides")
    .delete()
    .eq("space_id", spaceId)
    .eq("override_kind", overrideKind)
    .eq("target_id", targetId);
  if (delErr) {
    console.warn(
      `[preflight-overrides] delete-prior failed (proceeding with insert):`,
      delErr.message ?? delErr,
    );
  }

  const { data: inserted, error: insertErr } = await db
    .from("environment_overrides")
    .insert({
      space_id: spaceId,
      override_kind: overrideKind,
      target_id: targetId,
      override_value: b.value ?? null,
      reasoning: typeof b.reasoning === "string" ? b.reasoning : null,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      {
        error: "Failed to write override",
        detail: insertErr?.message ?? "(unknown)",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, override: inserted as OverrideRow });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const overrideId = url.searchParams.get("id");
  const all = url.searchParams.get("all") === "true";

  if (!overrideId && !all) {
    return NextResponse.json(
      { error: "?id={override_id} or ?all=true is required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ?all=true — clear every override for this space. Used by the
  // Re-plan button on the preflight page when the user wants a clean
  // slate (the LLM-derived defaults instead of their accumulated edits).
  if (all) {
    const { data: deleted, error: delErr } = await db
      .from("environment_overrides")
      .delete()
      .eq("space_id", spaceId)
      .select("id");
    if (delErr) {
      return NextResponse.json(
        { error: "Failed to clear overrides", detail: delErr.message },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      deleted_count: ((deleted as Array<unknown> | null) ?? []).length,
    });
  }

  const { error: delErr } = await db
    .from("environment_overrides")
    .delete()
    .eq("id", overrideId)
    .eq("space_id", spaceId);

  if (delErr) {
    return NextResponse.json(
      { error: "Failed to delete override", detail: delErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
