// ── Objective board version history ───────────────────────────────
//
// GET  /api/objective/[spaceId]/board/history → { versions: [{id,label,created_at}] }
// POST /api/objective/[spaceId]/board/history → { ok, id, created_at }
//   body: { snapshot: unknown, label?: string }
//
// Append-only snapshot history (newest first) in `objective_board_snapshots`,
// pruned to the last MAX_VERSIONS per space. Distinct from the LATEST board
// (objective_boards) — this is the timeline of checkpoints you can restore.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";

export const maxDuration = 15;
const MAX_VERSIONS = 40;

interface Ctx {
  params: Promise<{ spaceId: string }>;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  if (!(await verifySpaceOwnership(supabase, spaceId, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

   
  const db = supabase as any;
  try {
    const { data } = await db
      .from("objective_board_snapshots")
      .select("id, label, created_at")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(MAX_VERSIONS);
    return NextResponse.json({ versions: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: `Load failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  if (!(await verifySpaceOwnership(supabase, spaceId, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: body, error: parseError } = await safeJsonParse<{
    snapshot: unknown;
    label?: string;
  }>(req);
  if (parseError) return parseError;
  if (!body.snapshot || typeof body.snapshot !== "object")
    return NextResponse.json({ error: "snapshot required" }, { status: 400 });

   
  const db = supabase as any;
  try {
    const { data: inserted, error: insErr } = await db
      .from("objective_board_snapshots")
      .insert({
        space_id: spaceId,
        snapshot: body.snapshot,
        label: typeof body.label === "string" ? body.label.slice(0, 80) : null,
        created_by: user.id,
      })
      .select("id, created_at")
      .single();
    if (insErr)
      return NextResponse.json({ error: "Save failed" }, { status: 500 });

    // Prune everything older than the most recent MAX_VERSIONS.
    try {
      const { data: stale } = await db
        .from("objective_board_snapshots")
        .select("id")
        .eq("space_id", spaceId)
        .order("created_at", { ascending: false })
        .range(MAX_VERSIONS, MAX_VERSIONS + 500);
       
      const toDelete = (stale ?? []).map((r: any) => r.id);
      if (toDelete.length)
        await db.from("objective_board_snapshots").delete().in("id", toDelete);
    } catch {
      /* prune is best-effort */
    }

    return NextResponse.json({
      ok: true,
      id: inserted?.id,
      created_at: inserted?.created_at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Save failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
