/**
 * Candidate gathering — fetches all active improvement_goals across all users
 * and decorates each with the priority-relevant signals the scorer needs.
 *
 * Called once per coordinator tick. Designed to be a single logical pass over
 * the DB (a handful of batched reads), not N per-goal round-trips.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoalCandidate } from "./scoring";
import type { SuggestedObjective } from "@/types/goals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

interface GoalRow {
  id: string;
  space_id: string;
  user_id: string;
  title: string;
  deadline: string | null;
  status: string;
}

interface SpaceRow {
  id: string;
  synthesis_data: Record<string, unknown> | null;
}

interface AgentRow {
  id: string;
  source_goal_id: string | null;
}

interface AgentRunRow {
  agent_id: string;
  started_at: string;
}

/**
 * Return every active goal in the system as a scored candidate.
 *
 * Safety caps: at most 200 active goals per tick. Beyond that, we rely on the
 * fallback Vercel cron + priority rotation on subsequent ticks.
 */
export async function gatherGoalCandidates(db: Db): Promise<GoalCandidate[]> {
  // 1. All active goals, newest first
  const { data: goalRows, error: goalsErr } = await db
    .from("improvement_goals")
    .select("id, space_id, user_id, title, deadline, status")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(200);

  if (goalsErr || !goalRows || goalRows.length === 0) {
    if (goalsErr) console.warn("[coordinator/candidates] goals query:", goalsErr);
    return [];
  }

  const goals = goalRows as GoalRow[];
  const spaceIds = Array.from(new Set(goals.map((g) => g.space_id)));

  // 2. Synthesis data per space (for stale_score, suggested_objectives)
  const { data: spaceRows } = await db
    .from("spaces")
    .select("id, synthesis_data")
    .in("id", spaceIds);

  const synthBySpace = new Map<string, Record<string, unknown>>();
  for (const s of (spaceRows ?? []) as SpaceRow[]) {
    if (s.synthesis_data) synthBySpace.set(s.id, s.synthesis_data);
  }

  // 3. Bound researcher agents for these goals
  const goalIds = goals.map((g) => g.id);
  const { data: agentRows } = await db
    .from("agents")
    .select("id, source_goal_id")
    .in("source_goal_id", goalIds)
    .eq("kind", "researcher");

  const agentsByGoal = new Map<string, string>();
  for (const a of (agentRows ?? []) as AgentRow[]) {
    if (a.source_goal_id) agentsByGoal.set(a.source_goal_id, a.id);
  }

  // 4. Last-run-per-agent for recency penalty. One query with a big IN clause;
  //    Postgres handles this fine for our scale (≤200 agents).
  const agentIds = Array.from(agentsByGoal.values());
  const lastRunByAgent = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: runRows } = await db
      .from("agent_runs")
      .select("agent_id, started_at")
      .in("agent_id", agentIds)
      .order("started_at", { ascending: false })
      .limit(1000);

    // First row we see per agent (desc sort) is the latest.
    for (const r of (runRows ?? []) as AgentRunRow[]) {
      if (!lastRunByAgent.has(r.agent_id)) {
        lastRunByAgent.set(r.agent_id, r.started_at);
      }
    }
  }

  const now = Date.now();

  // 5. Project into candidates
  return goals.map<GoalCandidate>((g) => {
    const synth = synthBySpace.get(g.space_id);

    // stale_score: prefer synthesis_data.cascade_state.stale_score if present
    let staleScore: number | undefined;
    const cascade = synth?.cascade_state as Record<string, unknown> | undefined;
    if (cascade && typeof cascade.stale_score === "number") {
      staleScore = cascade.stale_score as number;
    }

    // convergence_score: best-effort match suggested_objectives by title
    let convergenceScore: number | undefined;
    const suggestions = (synth?.suggested_objectives ?? []) as SuggestedObjective[];
    const matched = suggestions.find(
      (s) => s.title && g.title && s.title.trim().toLowerCase() === g.title.trim().toLowerCase()
    );
    if (matched && typeof matched.convergence_score === "number") {
      convergenceScore = matched.convergence_score;
    }

    // days_since_last_research
    const agentId = agentsByGoal.get(g.id);
    const lastRunIso = agentId ? lastRunByAgent.get(agentId) : undefined;
    const daysSinceLastResearch = lastRunIso
      ? (now - new Date(lastRunIso).getTime()) / 86_400_000
      : null;

    return {
      goalId: g.id,
      spaceId: g.space_id,
      userId: g.user_id,
      goalTitle: g.title,
      deadline: g.deadline,
      staleScore,
      convergenceScore,
      daysSinceLastResearch,
      goalStatus: g.status,
    };
  });
}
