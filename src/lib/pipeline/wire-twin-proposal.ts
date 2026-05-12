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
  CalibrationGateSnapshot,
  MechanismHint,
} from "@/types/strategy";
import { extractTwinProposalFromStrategy } from "./extract-twin-proposal";
import { materializeMechanismsFromStrategy } from "./materialize-mechanisms";
// B4 — research-template registry to resolve spaces.use_case_template_id
// → template's preferred_mechanism_kinds. Filtering happens inside
// materializeMechanismsFromStrategy when this Set is non-empty.
import { getResearchTemplate } from "@/lib/templates/mind-body-cognition/seed";

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

  // B4 — resolve template's preferred_mechanism_kinds (if declared)
  // so the materializer can drop strategy-suggested kinds that don't
  // fit this template's domain (e.g. "game" + "ml_personalization"
  // get filtered out for clinical-research templates). Spaces without
  // a template OR templates without preferences fall through to the
  // legacy "all 7 kinds allowed" behavior — full backward compat.
  let preferredKinds: ReadonlySet<MechanismHint> | null = null;
  try {
    const { data: spaceRow } = await db
      .from("spaces")
      .select("use_case_template_id")
      .eq("id", spaceId)
      .maybeSingle();
    const templateSlug = (
      spaceRow as { use_case_template_id?: unknown } | null
    )?.use_case_template_id;
    if (typeof templateSlug === "string" && templateSlug.length > 0) {
      const tpl = getResearchTemplate(templateSlug);
      if (tpl?.preferred_mechanism_kinds?.length) {
        preferredKinds = new Set(tpl.preferred_mechanism_kinds);
      }
    }
  } catch (err) {
    console.warn(
      "[wire-twin-proposal] template-kind lookup failed (non-fatal):",
      err,
    );
  }

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
      preferredKinds,
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

    // Gap B — stamp the reality-calibration snapshot. This is the cache
    // the review panel renders against; the approve route re-queries the
    // live row before flipping statuses so a stale "calibrated" snapshot
    // can't sneak through after a failed re-capture.
    //
    // Soft-fail: if the calibration row is missing (capture ran before
    // the Gap B migration, or calibration stage crashed) we leave
    // calibration_gate undefined. The panel treats undefined as "unknown"
    // — visible but not blocking — so legacy spaces keep working.
    try {
      const { data: calRow } = (await db
        .from("reality_calibrations")
        .select(
          "status, reproduced_count, total_count, aggregate_score, strategy_baseline_id, bypassed_at, computed_at",
        )
        .eq("space_id", spaceId)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle()) as {
        data: {
          status: CalibrationGateSnapshot["status"];
          reproduced_count: number;
          total_count: number;
          aggregate_score: number;
          strategy_baseline_id: string | null;
          bypassed_at: string | null;
          computed_at: string;
        } | null;
      };
      if (calRow) {
        justification.calibration_gate = {
          status: calRow.status,
          reproduced_count: calRow.reproduced_count,
          total_count: calRow.total_count,
          aggregate_score: Number(calRow.aggregate_score),
          strategy_baseline_id: calRow.strategy_baseline_id,
          checked_at: calRow.computed_at,
          bypassed_at: calRow.bypassed_at,
        };
      }
    } catch (err) {
      console.warn(
        "[wire-twin-proposal] calibration snapshot read failed (non-fatal):",
        err,
      );
    }
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
