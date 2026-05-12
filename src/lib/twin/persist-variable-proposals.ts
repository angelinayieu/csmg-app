// Persist VariableProposalDraft[] to the variable_proposals table.
//
// Called from the twin-proposal approve route via after() so the user gets
// their fast approval response while these write asynchronously. Soft-fails
// throughout — this is audit machinery, not user-blocking.
//
// On a strategy regen, prior proposals from the same `source_strategy_version`
// (or earlier) are NOT auto-superseded here — that's a separate maintenance
// task. This function ONLY inserts; the GET endpoint can filter to "latest
// version's proposals" by max(source_strategy_version) per space.

import type { VariableProposalDraft } from "@/types/variable-proposals";

export interface PersistVariableProposalsArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string;
  drafts: VariableProposalDraft[];
}

export async function persistVariableProposals(
  args: PersistVariableProposalsArgs,
): Promise<{
  ok: boolean;
  inserted: number;
  error?: string;
}> {
  const { db, userId, drafts } = args;

  if (drafts.length === 0) {
    return { ok: true, inserted: 0 };
  }

  try {
    const rows = drafts.map((d) => ({
      space_id: d.space_id,
      user_id: userId,
      proposed_by: d.proposed_by,
      source_strategy_version: d.source_strategy_version,
      source_field: d.source_field,
      source_perspective_id: d.source_perspective_id,
      proposed_name: d.proposed_name,
      proposed_description: d.proposed_description,
      variable_role: d.variable_role,
      metric_definition: d.metric_definition,
      justification: d.justification,
      confidence: d.confidence,
      depends_on_entity_ids: d.depends_on_entity_ids,
      // user_status, generated_at, timestamps default at the DB layer.
    }));

    const { error, count } = await db
      .from("variable_proposals")
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
