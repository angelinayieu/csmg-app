// ── wireTwinProposalAndMechanisms ─────────────────────────────────────
//
// One-shot helper called from the strategy-refresh route after a strategy
// is persisted. Performs three tied actions:
//
//   1. materialize mechanisms[] from the recommendation's
//      InfrastructureProposal[] (idempotent — safe on regen)
//   2. extract a TwinProposalJustification from the recommendation
//   3. INSERT a twin_proposals row with the justification + mechanism IDs
//
// Returns the proposal_id → mechanism_ids[] map so the caller can pass it
// to generateAppsAndInterventions, which sets apps.parent_mechanism_id.
//
// Failure semantics: each step is best-effort. A failure to insert the
// twin_proposal does NOT block app generation — the GET endpoint's
// extraction fallback still produces a renderable proposal from
// synthesis_data. Errors are logged for observability.

import type {
  StrategicRecommendation,
  InfrastructureProposal,
  TwinProposalJustification,
} from "@/types/strategy";
import { extractTwinProposalFromStrategy } from "./extract-twin-proposal";
import { materializeMechanismsFromStrategy } from "./materialize-mechanisms";

export interface WireTwinProposalArgs {
  spaceId: string;
  userId: string;
  recommendation: StrategicRecommendation;
  proposals: InfrastructureProposal[];
  strategyVersion?: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
}

export interface WireTwinProposalResult {
  /** proposal_id → mechanism row IDs created/found for it. */
  mechanismIdsByProposal: Map<string, string[]>;
  /** Number of mechanism rows newly inserted. */
  mechanismsInserted: number;
  /** ID of the newly inserted twin_proposals row, or null on failure. */
  twinProposalId: string | null;
  /** The justification we wrote (or attempted to). */
  justification: TwinProposalJustification | null;
}

export async function wireTwinProposalAndMechanisms(
  args: WireTwinProposalArgs,
): Promise<WireTwinProposalResult> {
  const { spaceId, userId, recommendation, proposals, strategyVersion, db } = args;

  // ── 1. mechanisms ────────────────────────────────────────────────────
  let mechanismIdsByProposal = new Map<string, string[]>();
  let mechanismsInserted = 0;
  try {
    const mechResult = await materializeMechanismsFromStrategy({
      spaceId,
      userId,
      strategyVersion: strategyVersion ?? null,
      proposals,
      db,
    });
    mechanismIdsByProposal = mechResult.mechanismIdsByProposal;
    mechanismsInserted = mechResult.insertedCount;
  } catch (err) {
    console.warn("[wire-twin-proposal] materializeMechanisms failed (non-fatal):", err);
  }

  // ── 2. justification (extracted from existing strategy shape) ────────
  // When PR 3c lands and the strategy LLM emits TwinProposalJustification
  // natively, this falls back to the extracted shape only when the LLM
  // didn't include one — for now, every twin_proposal is extractor-built.
  const justification = extractTwinProposalFromStrategy(recommendation);
  if (justification) {
    // Populate mechanism_ids from the materialization result so the panel
    // can show "this proposal commits to N mechanisms".
    const allMechIds = Array.from(mechanismIdsByProposal.values()).flat();
    justification.mechanism_ids = allMechIds;
  }

  // ── 3. twin_proposals row ────────────────────────────────────────────
  // Supersede any prior proposed rows BEFORE inserting so regenerations
  // don't accumulate competing "proposed" proposals. The migration
  // 20260511_twin_proposals_supersede.sql adds 'superseded' to the
  // user_status check so this update is legal.
  let twinProposalId: string | null = null;
  if (justification) {
    try {
      const supersededAt = new Date().toISOString();
      const { error: supErr } = await db
        .from("twin_proposals")
        .update({
          user_status: "superseded",
          rejected_at: supersededAt,
          rejection_reason: "Superseded by regenerated strategy",
        })
        .eq("space_id", spaceId)
        .eq("user_id", userId)
        .eq("user_status", "proposed");
      if (supErr) {
        console.warn("[wire-twin-proposal] supersede prior proposed failed (non-fatal):", supErr);
      }

      const allMechIds = Array.from(mechanismIdsByProposal.values()).flat();
      const { data: inserted, error } = (await db
        .from("twin_proposals")
        .insert({
          space_id: spaceId,
          user_id: userId,
          justification,
          mechanism_ids: allMechIds,
          source_strategy_version: strategyVersion ?? null,
          user_status: "proposed",
        })
        .select("id")
        .single()) as { data: { id: string } | null; error: unknown };
      if (error) {
        console.warn("[wire-twin-proposal] twin_proposals insert failed:", error);
      } else if (inserted) {
        twinProposalId = inserted.id;
      }
    } catch (err) {
      console.warn("[wire-twin-proposal] twin_proposals insert threw:", err);
    }
  }

  return {
    mechanismIdsByProposal,
    mechanismsInserted,
    twinProposalId,
    justification,
  };
}
