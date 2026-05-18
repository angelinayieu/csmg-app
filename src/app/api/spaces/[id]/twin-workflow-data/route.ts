// ── GET /api/spaces/[id]/twin-workflow-data ─────────────────────────
//
// Lazy companion to /twin-page-bundle. The bundle endpoint is lean —
// it returns derived summaries (macro, mechanisms-with-layer-dist,
// pain metrics, narrator/coach output) but NOT the raw entities /
// edges / cycles / synthesis_data that the System-tab workflow needs.
//
// The System tab calls this only when the user activates it. Keeping
// these payloads out of the bundle keeps the Overview cache compact
// (a single cache row stays under ~30KB instead of ballooning to
// 100-500KB once we drag in the full graph).
//
// No caching here — the workflow data changes mostly when the canvas
// changes, and the System tab will re-fetch when those events fire.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type {
  TwinMacroState,
  ProposedTwinSpec,
  TwinState,
} from "@/types/twin";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface TwinWorkflowData {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  synthesis_data: SynthesisData | null;
  active_goal: ImprovementGoal | null;
  proposed_spec: ProposedTwinSpec | null;
  current_twin_state: TwinState;
  twin_macro: TwinMacroState;
  space_maturity: string | null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [spaceRes, entRes, edgeRes, cycleRes, goalRes, proposalRes] =
    await Promise.all([
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
        .from("twin_proposals")
        .select("proposed_spec")
        .eq("space_id", spaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if ((spaceRes.data as Space).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const space = spaceRes.data as Space;
  const entities = (entRes.data ?? []) as Entity[];
  const edges = (edgeRes.data ?? []) as Edge[];
  const cycles = (cycleRes.data ?? []) as Cycle[];
  const activeGoal = (goalRes?.data ?? null) as ImprovementGoal | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proposedSpec = (proposalRes?.data as any)?.proposed_spec ?? null;

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

  const payload: TwinWorkflowData = {
    entities,
    edges,
    cycles,
    synthesis_data: synthesisData,
    active_goal: activeGoal,
    proposed_spec: proposedSpec as ProposedTwinSpec | null,
    current_twin_state: twinState,
    twin_macro: twinState.macro,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    space_maturity: (space as any).maturity ?? null,
  };

  return NextResponse.json({ data: payload });
}
