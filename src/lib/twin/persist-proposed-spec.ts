// Capture and persist a ProposedTwinSpec snapshot to twin_proposals.proposed_spec.
//
// Called from the twin-proposal approve route via `after()` so the user gets
// their fast approval response while the snapshot writes asynchronously. The
// snapshot becomes the diff baseline for the workflow display's
// proposed-vs-actual chip strip — without it, the strip falls back to the
// legacy infrastructure-map status pill which can't tell you whether the
// approved twin actually got materialized.
//
// Soft-fail throughout: this is audit machinery, not user-blocking. Any
// error is logged but the approval still stands.

import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type {
  StrategicRecommendation,
  InfrastructureProposal,
  RankedStrategy,
} from "@/types/strategy";
import { computeTwinState } from "./compute-twin-state";
import { snapshotProposedSpec } from "./snapshot-proposed-spec";

interface PersistArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  userId: string;
  proposalId: string;
}

export async function persistProposedSpec(args: PersistArgs): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { db, spaceId, userId, proposalId } = args;

  try {
    // Single round-trip for everything the snapshot needs. Mirrors the
    // pattern at /api/spaces/[id]/twin-state/route.ts:45.
    const [spaceRes, entRes, edgeRes, cycleRes, goalRes] = await Promise.all([
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
    ]);

    if (!spaceRes?.data) {
      return { ok: false, error: "Space not found" };
    }

    const space = spaceRes.data as Space;
    const entities = (entRes.data ?? []) as Entity[];
    const edges = (edgeRes.data ?? []) as Edge[];
    const cycles = (cycleRes.data ?? []) as Cycle[];
    const activeGoal = (goalRes?.data ?? null) as ImprovementGoal | null;

    const synthesisData = parseSynthesisData(
      (space as unknown as { synthesis_data?: unknown }).synthesis_data ?? null,
    );

    // Find the strategic recommendation + matching infrastructure proposals.
    // Strategy proposals live in synthesis_data.ranked_strategies (the wrapper
    // shipped from the strategy engine). We pick rank 1 by convention — the
    // approve route itself doesn't carry which rank was confirmed.
    const ranked = extractRankedStrategies(synthesisData);
    const top = ranked[0];
    if (!top) {
      // No recommendation to snapshot — common for legacy spaces or spaces
      // approved before strategy gen finished. Soft-fail without writing.
      return { ok: false, error: "No ranked strategy found in synthesis_data" };
    }

    const recommendation: StrategicRecommendation = top.recommendation;
    const proposals: InfrastructureProposal[] = top.infrastructure_proposals ?? [];

    // Compute the current twin state to freeze as the comparison baseline.
    const currentTwinState = computeTwinState(
      space,
      entities,
      edges,
      cycles,
      synthesisData,
      activeGoal,
    );

    // Pull source_strategy_version off the existing proposal row so the
    // snapshot carries provenance.
    const { data: proposalRow } = await db
      .from("twin_proposals")
      .select("source_strategy_version, generated_at")
      .eq("id", proposalId)
      .eq("user_id", userId)
      .maybeSingle();

    const proposedSpec = snapshotProposedSpec({
      recommendation,
      proposals,
      currentTwinState,
      proposedAt:
        (proposalRow as { generated_at?: string } | null)?.generated_at ??
        new Date().toISOString(),
      sourceStrategyVersion:
        (proposalRow as { source_strategy_version?: number | null } | null)
          ?.source_strategy_version ?? null,
      activeGoal,
    });

    const { error: updErr } = await db
      .from("twin_proposals")
      .update({ proposed_spec: proposedSpec })
      .eq("id", proposalId)
      .eq("user_id", userId);

    if (updErr) {
      return { ok: false, error: updErr.message ?? "update failed" };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function parseSynthesisData(raw: unknown): SynthesisData | null {
  if (raw && typeof raw === "object") return raw as SynthesisData;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as SynthesisData;
    } catch {
      return null;
    }
  }
  return null;
}

function extractRankedStrategies(
  synthesisData: SynthesisData | null,
): RankedStrategy[] {
  if (!synthesisData) return [];
  // Strategy engine writes the wrapper at synthesis_data.ranked_strategies.
  const sd = synthesisData as unknown as {
    ranked_strategies?: RankedStrategy[];
    strategic_recommendation?: StrategicRecommendation;
  };
  if (Array.isArray(sd.ranked_strategies) && sd.ranked_strategies.length > 0) {
    return sd.ranked_strategies;
  }
  // Fallback: older shape where only a single recommendation was stored.
  if (sd.strategic_recommendation) {
    return [
      {
        rank: 1,
        recommendation: sd.strategic_recommendation,
        ranking_rationale: "Primary strategy",
        infrastructure_proposals: [],
        tradeoff_vs_top: null,
      } as RankedStrategy,
    ];
  }
  return [];
}
