import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { id: goalId } = await params;

  // 1. Fetch the goal and verify ownership
  const { data: goal, error: goalError } = await db
    .from("improvement_goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .single();

  if (goalError || !goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  // 2. Fetch the parent space
  const { data: parentSpace, error: spaceError } = await db
    .from("spaces")
    .select("id, name, depth_level, space_prefix, input_text")
    .eq("id", goal.space_id)
    .eq("user_id", user.id)
    .single();

  if (spaceError || !parentSpace) {
    return NextResponse.json({ error: "Parent space not found" }, { status: 404 });
  }

  // 2b. Enforce depth cap (max 3 levels: Objective → Sub-Objective → Task)
  const parentDepth = parentSpace.depth_level ?? 0;
  if (parentDepth >= 3) {
    return NextResponse.json(
      { error: "Maximum analysis depth reached (3 levels). Consider consolidating existing sub-spaces." },
      { status: 400 }
    );
  }

  // 3. Build context description from the goal
  const contextParts = [goal.title];
  if (goal.description) contextParts.push(goal.description);
  if (goal.metric_name) {
    contextParts.push(
      `Metric: ${goal.metric_name}${goal.metric_unit ? ` (${goal.metric_unit})` : ""} — ` +
      `baseline ${goal.baseline_value ?? 0}, target ${goal.target_value}`
    );
  }
  const description = contextParts.join(". ");

  // 4. Generate space prefix from goal title (first 2-3 uppercase letters)
  const prefixBase = goal.title
    .replace(/[^a-zA-Z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w: string) => w[0]?.toUpperCase() ?? "")
    .join("");
  const spacePrefix = prefixBase.length >= 2 ? prefixBase.slice(0, 3) : "GS";

  // 5. Create the new sub-space
  const { data: newSpace, error: createError } = await db
    .from("spaces")
    .insert({
      user_id: user.id,
      name: goal.title,
      description,
      space_prefix: spacePrefix,
      parent_space_id: parentSpace.id,
      depth_level: (parentSpace.depth_level ?? 0) + 1,
      input_text: description,
      entity_count: 0,
      edge_count: 0,
      cycle_count: 0,
      synthesis_data: {},
    })
    .select("id")
    .single();

  if (createError || !newSpace) {
    console.error("[GoalSubSpace] Space creation failed:", createError);
    return NextResponse.json({ error: "Failed to create sub-space" }, { status: 500 });
  }

  // 6. Link source entity to sub-space (critical missing step)
  // Find entity that matches the goal by name similarity
  const { data: parentEntities } = await db
    .from("entities")
    .select("id, entity_id, name")
    .eq("space_id", parentSpace.id);

  let linkedEntityId: string | null = null;
  if (parentEntities?.length) {
    const titleLower = goal.title.toLowerCase();
    const metricLower = (goal.metric_name ?? "").toLowerCase();

    const match = parentEntities.find((e: { name: string }) => {
      const nameLower = e.name.toLowerCase();
      return (
        nameLower.includes(titleLower) ||
        titleLower.includes(nameLower) ||
        (metricLower && (nameLower.includes(metricLower) || metricLower.includes(nameLower)))
      );
    });

    if (match) {
      linkedEntityId = match.id;
      await db
        .from("entities")
        .update({ has_sub_space: true, sub_space_id: newSpace.id, is_decomposable: true })
        .eq("id", match.id);

      // Set originated_from_entity_id on the sub-space
      await db
        .from("spaces")
        .update({ originated_from_entity_id: match.id })
        .eq("id", newSpace.id);
    }
  }

  // 7. Update the goal description to reference the new space
  await db
    .from("improvement_goals")
    .update({
      description: goal.description
        ? `${goal.description}\n\n[Sub-space: ${newSpace.id}]`
        : `[Sub-space: ${newSpace.id}]`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", goalId);

  // 8. Log changelog entry on the parent space (non-critical)
  await db
    .from("space_changelog")
    .insert({
      space_id: parentSpace.id,
      version: 1,
      change_type: "sub_space_created",
      summary: `Sub-space created from goal: ${goal.title}`,
      details: {
        goal_id: goalId,
        sub_space_id: newSpace.id,
        goal_title: goal.title,
        linked_entity_id: linkedEntityId,
      },
    })
    .then(() => {}, () => {});

  return NextResponse.json(
    {
      spaceId: newSpace.id,
      goalId,
      parentSpaceId: parentSpace.id,
      name: goal.title,
      depthLevel: parentDepth + 1,
      linkedEntityId,
    },
    { status: 201 }
  );
}
