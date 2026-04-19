/**
 * Goal-scoped research runner.
 *
 * Wraps the existing `/api/pipeline/research` route with goal-aware parameters:
 * the goal's title + metric drive the focus areas, and `goalId` is passed
 * through so the route's objective-aware prompts kick in.
 *
 * Called from the `execute-goal-research` Inngest function. Returns a small
 * stats object the agent-run tracker records for observability.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

interface GoalRow {
  id: string;
  space_id: string;
  user_id: string;
  title: string;
  description: string | null;
  metric_name: string;
  metric_unit: string | null;
  target_value: number;
  baseline_value: number;
  current_value: number;
  deadline: string | null;
  status: string;
}

export interface GoalResearchOutcome {
  findings: Array<{ kind: string; id: string }>;
  artifacts: string[];
  credits: number;
  skipped?: "goal_missing" | "goal_inactive" | "http_error";
  httpStatus?: number;
  error?: string;
}

interface RunOpts {
  db: Db;
  goalId: string;
  spaceId: string;
  userId: string;
  reason: string;
  baseUrl: string;
  serviceRoleKey: string;
}

function deriveFocusAreas(goal: GoalRow): string[] {
  const areas: string[] = [];
  if (goal.title) areas.push(goal.title.slice(0, 120));
  if (goal.metric_name) areas.push(`metric:${goal.metric_name}`);
  if (goal.description) areas.push(goal.description.slice(0, 160));
  return areas.slice(0, 5);
}

function buildInputSummary(goal: GoalRow): string {
  const target = goal.target_value;
  const baseline = goal.baseline_value;
  const unit = goal.metric_unit ?? "";
  const delta = target - baseline;
  const direction = delta >= 0 ? "increase" : "decrease";
  const parts = [
    `Goal: ${goal.title}.`,
    goal.description ? `Context: ${goal.description}` : "",
    `Metric: ${goal.metric_name}${unit ? ` (${unit})` : ""}.`,
    `Move from ${baseline} to ${target} (${direction} ${Math.abs(delta)}).`,
    goal.deadline ? `Deadline: ${goal.deadline}.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

export async function runResearchForGoal(opts: RunOpts): Promise<GoalResearchOutcome> {
  // 1. Load the goal — bail if gone or inactive.
  const { data: goalRow } = await opts.db
    .from("improvement_goals")
    .select(
      "id, space_id, user_id, title, description, metric_name, metric_unit, target_value, baseline_value, current_value, deadline, status"
    )
    .eq("id", opts.goalId)
    .maybeSingle();

  if (!goalRow) {
    return { findings: [], artifacts: [], credits: 0, skipped: "goal_missing" };
  }
  const goal = goalRow as GoalRow;
  if (goal.status !== "active") {
    return { findings: [], artifacts: [], credits: 0, skipped: "goal_inactive" };
  }

  // 2. Invoke the existing research pipeline. Mirrors the auth pattern used by
  //    `src/lib/pipeline/self-improving-loop.ts` (bearer service-role key +
  //    x-cron-secret). The research route uses `safeAuth` under SSR cookies;
  //    these headers are best-effort for environments where the route has
  //    been explicitly wired to accept service-role callers.
  const researchUrl = `${opts.baseUrl}/api/pipeline/research`;
  const body = {
    spaceIds: [opts.spaceId],
    inputSummary: buildInputSummary(goal),
    researchDepth: "standard" as const,
    focus_areas: deriveFocusAreas(goal),
    goalId: opts.goalId,
    triggeredBy: `coordinator:${opts.reason}`,
  };

  let httpStatus = 0;
  try {
    const res = await fetch(researchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.serviceRoleKey}`,
        "x-cron-secret": process.env.CRON_SECRET ?? "",
        "x-agent-user-id": opts.userId,
      },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      return {
        findings: [],
        artifacts: [],
        credits: 0,
        skipped: "http_error",
        httpStatus,
        error: typeof json.error === "string" ? json.error : `HTTP ${res.status}`,
      };
    }

    // Best-effort: the research route returns different shapes over time.
    // Tally up anything that looks like a finding / artifact.
    const findings: Array<{ kind: string; id: string }> = [];
    const externalEntities = (json.external_entities as Array<{ entity_id?: string }>) ?? [];
    for (const e of externalEntities) {
      if (e?.entity_id) findings.push({ kind: "external_entity", id: e.entity_id });
    }
    const bridges = (json.potential_bridges as Array<{ external_entity_id?: string }>) ?? [];
    for (const b of bridges) {
      if (b?.external_entity_id) findings.push({ kind: "bridge", id: b.external_entity_id });
    }

    const artifacts: string[] = [];
    if (findings.some((f) => f.kind === "external_entity")) artifacts.push("external_entities");
    if (findings.some((f) => f.kind === "bridge")) artifacts.push("bridges");

    return {
      findings,
      artifacts,
      credits: typeof json.credits_used === "number" ? (json.credits_used as number) : 0,
    };
  } catch (err) {
    return {
      findings: [],
      artifacts: [],
      credits: 0,
      skipped: "http_error",
      httpStatus,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Figure out a base URL usable for internal fetches from Inngest. */
export function resolveInternalBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
