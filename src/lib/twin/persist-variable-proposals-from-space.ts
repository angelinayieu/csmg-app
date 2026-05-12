// Convenience wrapper: load the latest StrategicRecommendation for a space,
// extract variable drafts via extract-variable-proposals, persist via
// persist-variable-proposals. Designed to be called via after() from the
// twin-proposal approve route.
//
// Soft-fails throughout. This is audit machinery — never blocks the
// user's approval response.

import type {
  StrategicRecommendation,
  RankedStrategy,
} from "@/types/strategy";
import type { SynthesisData } from "@/types/synthesis";
import { extractVariableProposals } from "./extract-variable-proposals";
import { persistVariableProposals } from "./persist-variable-proposals";

export interface PersistVariableProposalsFromSpaceArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  userId: string;
  /**
   * Optional explicit strategy version. When omitted, we read whatever the
   * latest synthesis_data has. Useful for re-running extraction against an
   * older snapshot.
   */
  sourceStrategyVersion?: number | null;
}

export async function persistVariableProposalsFromSpace(args: PersistVariableProposalsFromSpaceArgs): Promise<{
  ok: boolean;
  inserted: number;
  error?: string;
}> {
  const { db, spaceId, userId, sourceStrategyVersion = null } = args;

  try {
    const { data: spaceRow } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();

    const synthesisData = parseSynthesisData(
      (spaceRow as { synthesis_data?: unknown } | null)?.synthesis_data ?? null,
    );
    const ranked = extractRankedStrategies(synthesisData);
    const top = ranked[0];
    if (!top) {
      return { ok: false, inserted: 0, error: "No ranked strategy found" };
    }

    const drafts = extractVariableProposals({
      spaceId,
      recommendation: top.recommendation,
      sourceStrategyVersion,
      // Sprint W5.5 — pass rankedStrategies so the extractor can walk
      // infrastructure_proposals[].app_variables[] and emit per-app
      // variable proposals alongside the strategy-level ones.
      rankedStrategies: ranked,
    });

    return await persistVariableProposals({ db, userId, drafts });
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

function extractRankedStrategies(synth: SynthesisData | null): RankedStrategy[] {
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
