// Persist HypothesisLadderDraft[] to the hypothesis_ladders table.
//
// Soft-fails throughout. Audit machinery; never user-blocking. Designed
// to be called via after() from the twin-proposal approve route, same
// pattern as persistVariableProposals.

import type { HypothesisLadderDraft } from "@/types/hypothesis-ladders";

export interface PersistHypothesisLaddersArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string;
  drafts: HypothesisLadderDraft[];
}

export async function persistHypothesisLadders(
  args: PersistHypothesisLaddersArgs,
): Promise<{ ok: boolean; inserted: number; error?: string }> {
  const { db, userId, drafts } = args;

  if (drafts.length === 0) {
    return { ok: true, inserted: 0 };
  }

  try {
    const rows = drafts.map((d) => ({
      space_id: d.space_id,
      user_id: userId,
      source: d.source,
      source_strategy_version: d.source_strategy_version,
      source_category: d.source_category,
      claim: d.claim,
      mechanism_chain: d.mechanism_chain,
      falsifier: d.falsifier,
      verdict: d.verdict,
      verdict_rationale: d.verdict_rationale,
      severity: d.severity,
      probability: d.probability,
      related_entity_ids: d.related_entity_ids,
      // user_status, generated_at, timestamps default at DB layer.
    }));

    const { error, count } = await db
      .from("hypothesis_ladders")
      .insert(rows, { count: "exact" });

    if (error) {
      return { ok: false, inserted: 0, error: error.message ?? "insert failed" };
    }
    return { ok: true, inserted: count ?? rows.length };
  } catch (e) {
    return {
      ok: false,
      inserted: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
