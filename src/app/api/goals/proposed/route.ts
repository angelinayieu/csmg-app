// GET /api/goals/proposed?space_id=<uuid>
//
// Wave A — fetch the user's auto-detected, awaiting-review objectives,
// hydrated with the entities the LLM tagger linked to each goal.
// Consumed by the per-space objectives page's "Auto-detected" section
// and by the Lab when it needs to ground simulations in objective data.
//
// Query params:
//   space_id  — required. Scopes to one project.
//
// Response: { proposed: ProposedGoalHydrated[] }

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { ProposedGoalHydrated } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const spaceId = searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json(
      { error: "space_id query param required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Load proposed goals for this space
  const { data: goals, error: goalsErr } = (await db
    .from("improvement_goals")
    .select(
      "id, space_id, title, description, objective_type, source, status, metric_name, metric_unit, target_value, baseline_value, deadline, created_at, proposed_at, auto_detection_rationale, auto_detection_confidence, auto_detection_input_type, parent_goal_id",
    )
    .eq("user_id", user.id)
    .eq("space_id", spaceId)
    .eq("status", "proposed")
    .order("proposed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })) as {
    data: Array<Omit<ProposedGoalHydrated, "linked_entities">> | null;
    error: unknown;
  };

  if (goalsErr) {
    console.error("[goals proposed list] error:", goalsErr);
    return NextResponse.json(
      { error: "Failed to fetch proposed goals" },
      { status: 500 },
    );
  }

  const goalRows = goals ?? [];
  if (goalRows.length === 0) {
    return NextResponse.json({ proposed: [] });
  }

  const goalIds = goalRows.map((g) => g.id);

  // 2. Load entity_objectives junction for these goals
  const { data: links } = (await db
    .from("entity_objectives")
    .select("entity_id, goal_id, confidence, rationale")
    .in("goal_id", goalIds)
    .order("confidence", { ascending: false })) as {
    data: Array<{
      entity_id: string;
      goal_id: string;
      confidence: number;
      rationale: string | null;
    }> | null;
  };

  const linkRows = links ?? [];

  // 3. Hydrate entity info in one round-trip
  const entityIds = Array.from(new Set(linkRows.map((l) => l.entity_id)));
  const entityById = new Map<
    string,
    {
      name: string;
      description: string | null;
      entity_category: string | null;
    }
  >();

  if (entityIds.length > 0) {
    const { data: entityRows } = (await db
      .from("entities")
      .select("id, name, description, entity_category")
      .in("id", entityIds)) as {
      data: Array<{
        id: string;
        name: string;
        description: string | null;
        entity_category: string | null;
      }> | null;
    };
    for (const e of entityRows ?? []) {
      entityById.set(e.id, {
        name: e.name,
        description: e.description,
        entity_category: e.entity_category,
      });
    }
  }

  // 4. Group links by goal
  const linksByGoal = new Map<string, typeof linkRows>();
  for (const l of linkRows) {
    const bucket = linksByGoal.get(l.goal_id) ?? [];
    bucket.push(l);
    linksByGoal.set(l.goal_id, bucket);
  }

  // 5. Emit hydrated shape
  const hydrated: ProposedGoalHydrated[] = goalRows.map((g) => {
    const goalLinks = linksByGoal.get(g.id) ?? [];
    return {
      ...g,
      linked_entities: goalLinks
        .map((l) => {
          const e = entityById.get(l.entity_id);
          if (!e) return null;
          return {
            entity_id: l.entity_id,
            entity_name: e.name,
            entity_description: e.description,
            entity_category: e.entity_category,
            confidence: l.confidence,
            rationale: l.rationale,
          };
        })
        .filter(
          (e): e is NonNullable<typeof e> => e !== null,
        ),
    };
  });

  return NextResponse.json({ proposed: hydrated });
}
