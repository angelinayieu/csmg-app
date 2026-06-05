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
  verifySpaceAccess,
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

  // Any participant (owner / editor / viewer) may load the board.
  const role = await verifySpaceAccess(supabase, spaceId, user.id);
  if (!role)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const db = supabase as AnyDb;
  try {
    // Primary: the space-keyed store (always available — drafts + promoted).
    const { data: ob } = await db
      .from("objective_boards")
      .select("snapshot, schema_version, updated_at")
      .eq("space_id", spaceId)
      .maybeSingle();
    if (ob?.snapshot) {
      return NextResponse.json({
        snapshot: ob.snapshot,
        schema_version: ob.schema_version,
        updated_at: ob.updated_at,
      });
    }

    // Legacy fallback: the old canvases row anchored on the root goal, so
    // boards saved before the space-keyed store still load (and migrate on
    // the next save).
    const rootGoalId = await resolveRootGoalId(db, spaceId);
    if (rootGoalId) {
      const { data } = await db
        .from("canvases")
        .select("snapshot, schema_version, updated_at")
        .eq("scope", "objective")
        .eq("scope_ref_type", "improvement_goal")
        .eq("scope_ref_id", rootGoalId)
        .eq("archived", false)
        .maybeSingle();
      if (data?.snapshot) {
        return NextResponse.json({
          snapshot: data.snapshot,
          schema_version: data.schema_version,
          updated_at: data.updated_at,
        });
      }
    }
    return NextResponse.json({ snapshot: null });
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

  // Writes require owner or editor — viewers are read-only.
  const role = await verifySpaceAccess(supabase, spaceId, user.id);
  if (role !== "owner" && role !== "editor")
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
    // Space-keyed upsert — ALWAYS persists (no root-goal anchor required), so
    // drafts and promoted spaces alike survive reload. space_id is the PK, so
    // onConflict is a real unique target (unlike the canvases partial index).
    const { data, error } = await db
      .from("objective_boards")
      .upsert(
        {
          space_id: spaceId,
          snapshot: body.snapshot,
          schema_version: body.schema_version ?? 1,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        },
        { onConflict: "space_id" },
      )
      .select("updated_at")
      .single();

    if (error) {
      console.error("[objective/board/PUT]", error);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }

    // Mark the space modified so its home-library card brief regenerates with
    // the latest board state. Fire-and-forget.
    void db
      .from("spaces")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", spaceId);

    return NextResponse.json({ ok: true, updated_at: data?.updated_at });
  } catch (err) {
    return NextResponse.json(
      { error: `Save failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
