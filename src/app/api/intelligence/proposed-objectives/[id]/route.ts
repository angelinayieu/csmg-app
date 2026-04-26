// ── Proposed objective action endpoint ──
//
// POST /api/intelligence/proposed-objectives/[id]
//   body: { action: "accept" | "dismiss", space_id: string }
//
// Accept: promote the proposed objective into `improvement_goals`. Link back
//         to the proposal row so we can trace its origin.
// Dismiss: mark as dismissed.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 20;

type ProposedObjectiveRow = {
  id: string;
  space_id: string;
  suggested_title: string;
  objective_type: string;
  rationale: string;
  parent_objective_id: string | null;
  status: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let action: "accept" | "dismiss";
  let spaceId: string;
  try {
    const body = await request.json();
    if (body.action !== "accept" && body.action !== "dismiss") {
      return NextResponse.json({ error: "action must be 'accept' or 'dismiss'" }, { status: 400 });
    }
    action = body.action;
    spaceId = body.space_id;
    if (typeof spaceId !== "string") {
      return NextResponse.json({ error: "space_id required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Ownership check via space
    const { data: space } = await db.from("spaces").select("user_id").eq("id", spaceId).maybeSingle();
    if (!space || space.user_id !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const { data: proposal } = await db
      .from("proposed_objectives")
      .select("id, space_id, suggested_title, objective_type, rationale, parent_objective_id, status")
      .eq("id", id)
      .maybeSingle() as { data: ProposedObjectiveRow | null };

    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    if (proposal.status !== "pending") {
      return NextResponse.json({ error: `Proposal already ${proposal.status}` }, { status: 400 });
    }

    if (action === "dismiss") {
      await db.from("proposed_objectives")
        .update({ status: "dismissed", dismissed_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({ dismissed: true, id });
    }

    // Accept → create improvement_goals row.
    // user_id is required by the RLS policy (auth.uid() = user_id) and the
    // schema's NOT NULL constraint; forgetting it produces a misleading
    // "new row violates row-level security policy" error.
    const { data: newGoal, error: insertError } = await db
      .from("improvement_goals")
      .insert({
        space_id: proposal.space_id,
        user_id: user.id,
        title: proposal.suggested_title,
        objective_type: proposal.objective_type,
        description: proposal.rationale,
        parent_goal_id: proposal.parent_objective_id,
      })
      .select("id")
      .single();

    if (insertError || !newGoal) {
      console.error("[proposed-objectives] Create goal failed:", insertError);
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to create goal" },
        { status: 500 },
      );
    }

    // Update proposal status
    await db.from("proposed_objectives")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        created_goal_id: newGoal.id,
      })
      .eq("id", id);

    return NextResponse.json({
      accepted: true,
      id,
      created_goal_id: newGoal.id,
    });
  } catch (err) {
    console.error("[proposed-objectives] Error:", err);
    return NextResponse.json(
      { error: `Action failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
