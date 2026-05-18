// ── POST /api/spaces/[id]/twin/refresh-coach ──────────────────────
//
// Force-re-runs the Coach agent and surgically patches the bundle
// cache's coach_next_action field. Same surgical-patch pattern as
// refresh-narrator.
//
// Accepts an optional `hint: "alternative"` flag in the request body.
// When set, we look up the previously cached recommendation and pass
// it to the agent so it can pick a meaningfully different action.
//
// Used by:
//   - The "Show different suggestion" button on the Coach card
//   - The window-event-driven dispatcher if a Coach action gets
//     dismissed and needs a fresh suggestion

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import { runCoachAgent } from "@/lib/twin/agents/coach-agent";
import { computeAgentTimings } from "@/lib/twin/compute-agent-inputs";
import type { CoachActionType } from "@/lib/twin/agents/coach-agent";
import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface RefreshCoachRequest {
  /** When "alternative", the agent gets the previous recommendation
   *  as soft guidance to pick something different. */
  hint?: "alternative";
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const body = (await req
    .json()
    .catch(() => ({}))) as RefreshCoachRequest;
  const wantsAlternative = body.hint === "alternative";

  const { data: cacheRow } = await db
    .from("spaces")
    .select("user_id, twin_dashboard_cache")
    .eq("id", spaceId)
    .maybeSingle();

  if (!cacheRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (cacheRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Previous recommendation (only used when hint="alternative").
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const previousRec = (cacheRow.twin_dashboard_cache as any)
    ?.coach_next_action;

  // Fetch coach inputs. Mirrors the bundle endpoint.
  const [
    spaceRes,
    entRes,
    edgeRes,
    cycleRes,
    goalRes,
    mechRes,
    proposalRes,
  ] = await Promise.all([
    db.from("spaces").select("*").eq("id", spaceId).maybeSingle(),
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db.from("cycles").select("*").eq("space_id", spaceId),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("mechanisms")
      .select("kind, status")
      .eq("space_id", spaceId),
    db
      .from("twin_proposals")
      .select("user_status")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const space = spaceRes.data as Space;
  const entities = (entRes.data ?? []) as Entity[];
  const edges = (edgeRes.data ?? []) as Edge[];
  const cycles = (cycleRes.data ?? []) as Cycle[];
  const activeGoal = (goalRes?.data ?? null) as ImprovementGoal | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mechanismRows = (mechRes.data ?? []) as Array<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestProposal = proposalRes?.data as any | null;

  let synthesisData: SynthesisData | null = null;
  const rawSynth = (space as unknown as { synthesis_data?: unknown })
    .synthesis_data ?? null;
  if (rawSynth && typeof rawSynth === "object") {
    synthesisData = rawSynth as SynthesisData;
  } else if (typeof rawSynth === "string") {
    try {
      synthesisData = JSON.parse(rawSynth) as SynthesisData;
    } catch {
      synthesisData = null;
    }
  }

  const twinState = computeTwinState(
    space,
    entities,
    edges,
    cycles,
    synthesisData,
    activeGoal,
  );

  const activeMechanismKinds = mechanismRows
    .filter((m) => m.status === "active")
    .map((m) => m.kind as string);

  // Run the agent. If we have a previous rec AND the user asked for
  // an alternative, thread it in.
  let coachOutput: {
    text: string;
    action_type: CoachActionType;
    target_id: string | null;
    reasoning: string;
  } | null = null;

  // W6 — pull the same days-since timings the bundle endpoint uses
  // so refresh and bundle produce consistent agent outputs.
  const timings = await computeAgentTimings(db, spaceId, user.id);

  try {
    const out = await runCoachAgent({
      spaceName: space.name,
      twinMacro: twinState.macro,
      activeGoalTitle: activeGoal?.title ?? null,
      activeGoalProgress: null, // Phase 3
      daysSinceLastObservation: timings.daysSinceLastObservation,
      daysSinceLastPrediction: timings.daysSinceLastPrediction,
      activeMechanismKinds,
      pendingProposalCount:
        latestProposal?.user_status === "proposed" ? 1 : 0,
      previousRecommendation:
        wantsAlternative && previousRec
          ? {
              text: previousRec.text,
              action_type: previousRec.action_type as CoachActionType,
            }
          : null,
    });
    coachOutput = {
      text: out.text,
      action_type: out.action_type,
      target_id: out.target_id,
      reasoning: out.reasoning,
    };
  } catch (err) {
    console.warn("[refresh-coach] agent failed:", err);
    return NextResponse.json(
      { error: "Coach agent unavailable. Try again in a moment." },
      { status: 502 },
    );
  }

  // Surgical cache patch.
  if (cacheRow.twin_dashboard_cache) {
    const next = {
      ...cacheRow.twin_dashboard_cache,
      coach_next_action: {
        text: coachOutput.text,
        action_type: coachOutput.action_type,
        target_id: coachOutput.target_id,
      },
    };
    await db
      .from("spaces")
      .update({
        twin_dashboard_cache: next,
        twin_dashboard_cache_at: new Date().toISOString(),
      })
      .eq("id", spaceId);
  }

  return NextResponse.json({
    coach_next_action: {
      text: coachOutput.text,
      action_type: coachOutput.action_type,
      target_id: coachOutput.target_id,
    },
  });
}
