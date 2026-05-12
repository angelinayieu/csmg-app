// Convenience wrapper: load latest StrategicRecommendation, build entity
// name lookup, extract ladder drafts, persist. Designed for after() use
// from the twin-proposal approve route.
//
// Soft-fail throughout.

import type {
  StrategicRecommendation,
  RankedStrategy,
} from "@/types/strategy";
import type { SynthesisData } from "@/types/synthesis";
import { extractHypothesisLadders } from "./extract-hypothesis-ladders";
import { persistHypothesisLadders } from "./persist-hypothesis-ladders";

export interface PersistHypothesisLaddersFromSpaceArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  userId: string;
  sourceStrategyVersion?: number | null;
}

export async function persistHypothesisLaddersFromSpace(
  args: PersistHypothesisLaddersFromSpaceArgs,
): Promise<{ ok: boolean; inserted: number; error?: string }> {
  const { db, spaceId, userId, sourceStrategyVersion = null } = args;

  try {
    const [spaceRes, entitiesRes] = await Promise.all([
      db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", spaceId)
        .maybeSingle(),
      db
        .from("entities")
        .select("entity_id, name")
        .eq("space_id", spaceId),
    ]);

    const synthesisData = parseSynthesisData(
      (spaceRes?.data as { synthesis_data?: unknown } | null)
        ?.synthesis_data ?? null,
    );
    const ranked = extractRankedStrategies(synthesisData);
    const top = ranked[0];
    if (!top) {
      return { ok: false, inserted: 0, error: "No ranked strategy found" };
    }

    // entity_id → name lookup so the mechanism chain renders human-
    // readable. Row shape from select('entity_id, name'): { entity_id, name }.
    const entityNames = new Map<string, string>();
    const entityRows = (entitiesRes?.data ?? []) as Array<{
      entity_id?: string;
      name?: string;
    }>;
    for (const e of entityRows) {
      if (e.entity_id && e.name) entityNames.set(e.entity_id, e.name);
    }

    const drafts = extractHypothesisLadders({
      spaceId,
      recommendation: top.recommendation,
      entityNames,
      sourceStrategyVersion,
    });

    return await persistHypothesisLadders({ db, userId, drafts });
  } catch (e) {
    return {
      ok: false,
      inserted: 0,
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
  synth: SynthesisData | null,
): RankedStrategy[] {
  if (!synth) return [];
  const sd = synth as unknown as {
    ranked_strategies?: RankedStrategy[];
    strategic_recommendation?: StrategicRecommendation;
  };
  if (Array.isArray(sd.ranked_strategies) && sd.ranked_strategies.length > 0) {
    return sd.ranked_strategies;
  }
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
