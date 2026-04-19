// ── Cross-space objectives index ──
//
// GET /api/objectives/index
//
// Returns EVERYTHING objectives-related across the user's spaces:
//   - accepted objectives (improvement_goals)
//   - pending proposed objectives (proposed_objectives)
//   - pending proposed sub-objectives
//   - recent objective-related changelog entries for context
//
// Used by the global objectives page. One endpoint to fetch everything keeps
// the page responsive on first load.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 15;

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // ── Fetch user's spaces first ──
    const { data: spacesData } = await db
      .from("spaces")
      .select("id, name, description, use_case_template_id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    const spaces = (spacesData ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
      use_case_template_id: string | null;
    }>;

    if (spaces.length === 0) {
      return NextResponse.json({
        objectives: [],
        proposed_objectives: [],
        spaces: [],
      });
    }

    const spaceIds = spaces.map((s) => s.id);

    // ── Parallel fetches ──
    const [objectivesRes, proposedRes] = await Promise.all([
      db.from("improvement_goals")
        .select("id, space_id, title, objective_type, description, metric_name, parent_goal_id, created_at")
        .in("space_id", spaceIds)
        .order("created_at", { ascending: false }),
      db.from("proposed_objectives")
        .select(
          "id, space_id, suggested_title, objective_type, rationale, triggering_excerpt, confidence, parent_objective_id, source, status, created_at",
        )
        .in("space_id", spaceIds)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    // Annotate objectives with their space's name for UI display
    const spaceNameById = new Map(spaces.map((s) => [s.id, s.name]));

    const objectivesWithSpace = (objectivesRes.data ?? []).map((o: { space_id: string }) => ({
      ...o,
      space_name: spaceNameById.get(o.space_id) ?? "(unknown space)",
    }));

    const proposedWithSpace = (proposedRes.data ?? []).map((p: { space_id: string }) => ({
      ...p,
      space_name: spaceNameById.get(p.space_id) ?? "(unknown space)",
    }));

    return NextResponse.json({
      objectives: objectivesWithSpace,
      proposed_objectives: proposedWithSpace,
      spaces: spaces.map((s) => ({ id: s.id, name: s.name })),
    });
  } catch (err) {
    console.error("[objectives/index] Error:", err);
    return NextResponse.json(
      { error: `Fetch failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
