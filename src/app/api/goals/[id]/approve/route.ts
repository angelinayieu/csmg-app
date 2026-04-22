// POST /api/goals/[id]/approve
//
// Wave A — promote a 'proposed' (auto-detected) objective to 'active'.
//
// Enforces that by the time a goal goes live, metric_name + target_value
// are set. The user supplies them in the request body (or they may
// already be on the proposed row if an admin pre-filled them).
//
// Optional body fields:
//   metric_name, metric_unit, target_value, baseline_value, deadline
//   title, description  (user can edit the auto-detected text)
//   keep_entity_links   (subset of currently-linked entity_ids to keep;
//                        omitted links get source='refined' and confidence
//                        halved — or get deleted if keep list is [])
//
// Response: the updated goal row + the final entity_objectives set.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { ApproveGoalInputSchema } from "@/lib/schemas/goal-approval";
import {
  upsertMemoryItemsBatch,
  buildObjectiveInput,
} from "@/lib/memory/writer";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: goalId } = await ctx.params;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = ApproveGoalInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load the current goal + verify ownership + current state.
  const { data: goal } = (await db
    .from("improvement_goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: {
      id: string;
      status: string;
      metric_name: string | null;
      metric_unit: string | null;
      target_value: number | null;
      baseline_value: number | null;
      title: string;
      description: string | null;
      space_id: string;
    } | null;
  };

  if (!goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }
  if (goal.status !== "proposed") {
    return NextResponse.json(
      { error: `Goal is already ${goal.status}; only 'proposed' goals can be approved.` },
      { status: 409 },
    );
  }

  // Enforce metric + target are present on the final row (either from
  // the input body or from the existing proposed row). Without them the
  // goal isn't actionable.
  const finalMetricName = input.metric_name ?? goal.metric_name;
  const finalTargetValue =
    input.target_value !== undefined ? input.target_value : goal.target_value;

  if (!finalMetricName || finalMetricName.trim().length === 0) {
    return NextResponse.json(
      {
        error:
          "metric_name is required to approve a goal. Pass it in the body or set it on the proposed row first.",
      },
      { status: 400 },
    );
  }
  if (finalTargetValue === null || finalTargetValue === undefined) {
    return NextResponse.json(
      {
        error:
          "target_value is required to approve a goal. Pass it in the body or set it on the proposed row first.",
      },
      { status: 400 },
    );
  }

  // Build the update payload. Only set fields that were supplied OR that
  // need default population.
  const update: Record<string, unknown> = {
    status: "active",
    metric_name: finalMetricName,
    target_value: finalTargetValue,
    resolved_by: user.id,
  };
  if (input.metric_unit !== undefined) update.metric_unit = input.metric_unit;
  if (input.baseline_value !== undefined)
    update.baseline_value = input.baseline_value;
  if (input.deadline !== undefined) update.deadline = input.deadline;
  if (input.title !== undefined) update.title = input.title;
  if (input.description !== undefined) update.description = input.description;

  const { data: updated, error: updErr } = (await db
    .from("improvement_goals")
    .update(update)
    .eq("id", goalId)
    .eq("user_id", user.id)
    .select("*")
    .single()) as {
    data: {
      id: string;
      title: string;
      description: string | null;
      auto_detection_rationale: string | null;
    } | null;
    error: unknown;
  };

  if (updErr || !updated) {
    console.error("[goal approve] update failed:", updErr);
    return NextResponse.json(
      { error: "Failed to approve goal" },
      { status: 500 },
    );
  }

  // Optional entity-link refinement. If the user passed keep_entity_links,
  // we retain only those AND mark their source='refined'. Links not in
  // the keep list are deleted. If keep_entity_links is undefined, we
  // leave the junction untouched.
  if (input.keep_entity_links !== undefined) {
    const keepSet = new Set(input.keep_entity_links);
    const { data: currentLinks } = (await db
      .from("entity_objectives")
      .select("id, entity_id")
      .eq("goal_id", goalId)) as {
      data: Array<{ id: string; entity_id: string }> | null;
    };

    const toDelete: string[] = [];
    const toRefineEntityIds: string[] = [];
    for (const link of currentLinks ?? []) {
      if (keepSet.has(link.entity_id)) {
        toRefineEntityIds.push(link.entity_id);
      } else {
        toDelete.push(link.id);
      }
    }

    if (toDelete.length > 0) {
      await db.from("entity_objectives").delete().in("id", toDelete);
    }
    if (toRefineEntityIds.length > 0) {
      await db
        .from("entity_objectives")
        .update({ source: "refined" })
        .eq("goal_id", goalId)
        .in("entity_id", toRefineEntityIds);
    }
  }

  // Re-index the approved goal in memory (its text may have changed via
  // title/description edits).
  try {
    await upsertMemoryItemsBatch(db, [
      buildObjectiveInput(user.id, {
        id: updated.id,
        title: updated.title,
        description: updated.description ?? updated.auto_detection_rationale,
      }),
    ]);
  } catch (memErr) {
    console.warn("[goal approve] memory re-index failed (non-fatal):", memErr);
  }

  // Wave B — flag apps serving this newly-active goal. Their
  // assumptions may need re-validation now that the goal is live.
  // Non-fatal.
  try {
    const { notifyGoalChanged } = await import("@/lib/apps/notify");
    await notifyGoalChanged(
      db,
      goalId,
      "proposed_to_active",
      `user:approve:${user.id}`,
    );
  } catch (notifyErr) {
    console.warn(
      "[goal approve] app staleness notify failed (non-fatal):",
      notifyErr,
    );
  }

  // Wave C — log the user event so the digest agent sees this pattern.
  try {
    const { recordUserEvent } = await import("@/lib/user-events/record");
    await recordUserEvent(db, {
      user_id: user.id,
      event_type: "goal.approved",
      source: `user:approve:${user.id}`,
      ref_kind: "goal",
      ref_id: goalId,
      space_id: goal.space_id,
      payload: {
        auto_detected: true, // proposed goals are always auto-detected
        has_metric: finalMetricName != null,
      },
    });
  } catch {
    /* telemetry non-fatal */
  }

  // Wave D L2.2 — spawn a goal-bound researcher agent for this
  // newly-active goal. Pre-Wave D, approval created an active goal that
  // the research loop had no way to pick up because no agent was bound.
  // Now the next /api/cron/research-loop tick will find this agent and
  // start producing findings scoped to this goal.
  try {
    const { ensureAgent } = await import("@/lib/agents/run-tracker");
    await ensureAgent(db, {
      spaceId: goal.space_id,
      userId: user.id,
      kind: "researcher",
      sourceGoalId: goalId,
      goalTitle: updated.title,
    });
  } catch (seedErr) {
    console.warn(
      "[goal approve] goal-bound agent seed failed (non-fatal):",
      seedErr,
    );
  }

  // Return the final goal + its surviving entity links so the review UI
  // can confirm what landed.
  const { data: finalLinks } = await db
    .from("entity_objectives")
    .select("id, entity_id, confidence, source, rationale")
    .eq("goal_id", goalId);

  return NextResponse.json({
    goal: updated,
    links: finalLinks ?? [],
  });
}
