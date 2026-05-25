// ── GET /api/brainstorm/annotations/versions?spaceId=... ────────
//
// Returns the parsed annotation version history for the core
// objective of a space. Used by the version chip + compare UI.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { parseVersions } from "@/lib/objective-canvas/annotation-versions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const spaceId = req.nextUrl.searchParams.get("spaceId") ?? "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: coreRows, error: coreErr } = await db
    .from("improvement_goals")
    .select("id, user_id, annotations_versions")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (coreErr) {
    return NextResponse.json(
      { error: "DB error", detail: coreErr.message },
      { status: 500 },
    );
  }
  const core =
    Array.isArray(coreRows) && coreRows.length > 0 ? coreRows[0] : null;
  if (!core || core.user_id !== auth.user.id) {
    return NextResponse.json(
      { error: "No core objective in this space" },
      { status: 404 },
    );
  }

  const versions = parseVersions(core.annotations_versions);
  return NextResponse.json({ versions });
}
