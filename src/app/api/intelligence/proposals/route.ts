// ── Router proposals list + filter ──
//
// GET /api/intelligence/proposals?space_id=X
//   → { proposals: ProposalRow[], proposed_objectives: ProposedObjectiveRow[] }
//
// Returns all PENDING proposals for a space. UI renders these as action
// buttons so users can approve expensive pipeline runs explicitly.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 10;

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) return NextResponse.json({ error: "space_id required" }, { status: 400 });

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const [proposalsRes, objectivesRes] = await Promise.all([
      db.from("router_proposals")
        .select("id, kind, reason, confidence, cost_estimate, triggered_by_content, created_at")
        .eq("space_id", spaceId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20),
      db.from("proposed_objectives")
        .select("id, suggested_title, objective_type, rationale, triggering_excerpt, confidence, parent_objective_id, source, created_at")
        .eq("space_id", spaceId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    return NextResponse.json({
      proposals: proposalsRes.data ?? [],
      proposed_objectives: objectivesRes.data ?? [],
    });
  } catch (err) {
    console.error("[intelligence/proposals] Error:", err);
    return NextResponse.json(
      { error: `Fetch failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
