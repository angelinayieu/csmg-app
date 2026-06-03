// ── Objective board snapshot CRUD ─────────────────────────────────
//
// GET  /api/objective/[spaceId]/board → { snapshot, schema_version, updated_at } | { snapshot: null }
// PUT  /api/objective/[spaceId]/board → { ok, updated_at }
//   body: { snapshot: unknown, schema_version?: number }
//
// Persists the objective whiteboard (collapsed room cards + AI insight
// cards + manual notes/arrows) so arrangements survive reload + sync
// across devices.
//
// Storage: the existing first-class `canvases` table with scope='objective',
// anchored to the space's ROOT improvement_goal (parent_goal_id IS NULL) —
// that's how this codebase identifies "the objective" of a space. No new
// table: the canvases registry was purpose-built for exactly this
// (universal | project | objective | app). Distinct from the project canvas
// (scope='project', space_canvases) so the two boards never collide.
//
// If the space has no root goal yet (very early stage), persistence is a
// graceful no-op — the client keeps its localStorage mirror until an
// anchor exists.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";

export const maxDuration = 15;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/** The space's objective is its root improvement_goal (no parent). */
async function resolveRootGoalId(
  db: AnyDb,
  spaceId: string,
): Promise<string | null> {
  const { data } = await db
    .from("improvement_goals")
    .select("id")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return Array.isArray(data) && data.length > 0
    ? (data[0]?.id as string)
    : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const db = supabase as AnyDb;
  try {
    const rootGoalId = await resolveRootGoalId(db, spaceId);
    if (!rootGoalId) return NextResponse.json({ snapshot: null });

    const { data, error } = await db
      .from("canvases")
      .select("snapshot, schema_version, updated_at")
      .eq("scope", "objective")
      .eq("scope_ref_type", "improvement_goal")
      .eq("scope_ref_id", rootGoalId)
      .eq("archived", false)
      .maybeSingle();

    if (error) {
      console.error("[objective/board/GET]", error);
      return NextResponse.json({ error: "Load failed" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ snapshot: null });
    return NextResponse.json({
      snapshot: data.snapshot,
      schema_version: data.schema_version,
      updated_at: data.updated_at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Load failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: body, error: parseError } = await safeJsonParse<{
    snapshot: unknown;
    schema_version?: number;
  }>(request);
  if (parseError) return parseError;

  if (!body.snapshot || typeof body.snapshot !== "object") {
    return NextResponse.json({ error: "snapshot required" }, { status: 400 });
  }

  const db = supabase as AnyDb;
  try {
    const rootGoalId = await resolveRootGoalId(db, spaceId);
    // No anchor yet → soft no-op; the client keeps its local mirror.
    if (!rootGoalId) {
      return NextResponse.json({ ok: false, reason: "no_objective_anchor" });
    }

    const schemaVersion = body.schema_version ?? 1;

    // The canvases uniqueness is a PARTIAL index (archived = false), which
    // can't be an upsert onConflict target — so update-or-insert explicitly
    // (mirrors the table's own sync trigger).
    const { data: updated, error: updErr } = await db
      .from("canvases")
      .update({
        snapshot: body.snapshot,
        schema_version: schemaVersion,
        updated_by: user.id,
      })
      .eq("scope", "objective")
      .eq("scope_ref_type", "improvement_goal")
      .eq("scope_ref_id", rootGoalId)
      .eq("archived", false)
      .select("updated_at");

    if (updErr) {
      console.error("[objective/board/PUT:update]", updErr);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }
    if (Array.isArray(updated) && updated.length > 0) {
      // Mark the space modified so its home-library card brief regenerates
      // with the latest board state (what the user saved/decided). Fire-and-
      // forget; spaces has no updated_at trigger, so the brief's own write
      // won't re-bump this → no regen loop.
      void db
        .from("spaces")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", spaceId);
      return NextResponse.json({ ok: true, updated_at: updated[0].updated_at });
    }

    const { data: inserted, error: insErr } = await db
      .from("canvases")
      .insert({
        owner_id: user.id,
        scope: "objective",
        scope_ref_type: "improvement_goal",
        scope_ref_id: rootGoalId,
        title: "Objective board",
        snapshot: body.snapshot,
        schema_version: schemaVersion,
        updated_by: user.id,
      })
      .select("updated_at")
      .single();

    if (insErr) {
      console.error("[objective/board/PUT:insert]", insErr);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }
    void db
      .from("spaces")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", spaceId);
    return NextResponse.json({ ok: true, updated_at: inserted.updated_at });
  } catch (err) {
    return NextResponse.json(
      { error: `Save failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
