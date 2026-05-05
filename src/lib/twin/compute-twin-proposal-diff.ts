// Compare a frozen ProposedTwinSpec against current entities/edges/twin-state
// and produce the chip-strip render data for the workflow display.
//
// Pure function. No DB writes, no LLM calls. Safe to call on every render.
//
// Why: the existing pill on digital-twin-flowchart.tsx surfaces counts pulled
// straight from the latest strategy's infrastructure_map status — which is
// honest about the current proposal but loses the audit when the strategy
// regenerates or only some of the proposed entities materialize. This diff
// answers the question "did what we promised actually show up?"

import type { Entity } from "@/types";
import type {
  ProposedTwinSpec,
  TwinProposalChip,
  TwinProposalChipKind,
  TwinProposalDiff,
  TwinState,
} from "@/types/twin";

const FIDELITY_HIGH = 0.85;
const FIDELITY_MED = 0.5;

const CHIP_ORDER: TwinProposalChipKind[] = [
  "as_proposed",
  "amplified",
  "missing",
  "extra",
  "baseline",
];

export interface ComputeTwinProposalDiffArgs {
  /** Frozen snapshot from approval time. `null` returns a `no_proposal` diff. */
  proposedSpec: ProposedTwinSpec | null;
  /** Live entities from the space at render time. */
  currentEntities: Entity[];
  /** Current twin state — for health-delta computation. */
  currentTwinState: TwinState;
}

export function computeTwinProposalDiff(
  args: ComputeTwinProposalDiffArgs,
): TwinProposalDiff {
  const { proposedSpec, currentEntities, currentTwinState } = args;

  if (!proposedSpec) {
    // No frozen proposal yet — caller falls back to the legacy "infra-status"
    // pill rendering. We still return a valid diff so the renderer doesn't
    // need null-handling.
    return {
      fidelity: "no_proposal",
      health_delta: 0,
      chips: [],
      counts: emptyCounts(),
    };
  }

  // Build a lookup of current entities so we can ask "did this promised
  // entity_id materialize?" in O(1). The proposal stores entity_ids as
  // strings; entities table key is also entity_id.
  const currentEntityIds = new Set(currentEntities.map((e) => e.entity_id));

  // Walk per-entity intents.
  let promised_new = 0;
  let materialized_new = 0;
  let missing_new = 0;
  let promised_strengthened = 0;
  let materialized_strengthened = 0;
  let baseline = 0;

  // Track which current entities matched a promise, so we can count "extra"
  // (emerged that weren't promised) afterwards. Only count entities marked
  // as proposed strategy components — the prospector / decompose may add
  // many entities that were never strategy-proposed and aren't "extra"
  // promotions in this sense; a future pass can refine this with a
  // proposed-by-strategy tag.
  const matchedFromPromise = new Set<string>();

  for (const intent of proposedSpec.entity_intents) {
    const exists = currentEntityIds.has(intent.entity_id);
    if (intent.intended_status === "needs_building") {
      promised_new++;
      if (exists) {
        materialized_new++;
        matchedFromPromise.add(intent.entity_id);
      } else {
        missing_new++;
      }
    } else if (intent.intended_status === "needs_strengthening") {
      promised_strengthened++;
      if (exists) {
        materialized_strengthened++;
        matchedFromPromise.add(intent.entity_id);
      }
      // If a promised-strengthened entity has disappeared, that's a bigger
      // structural failure; we leave it uncounted on the chip strip until
      // we have a clearer UX answer than "you lost a baseline component".
    } else {
      baseline++;
      if (exists) matchedFromPromise.add(intent.entity_id);
    }
  }

  // "Extra" — entities currently present that the proposal doesn't list.
  // Without a "proposed-by-strategy" tag on entities, we can't reliably
  // separate "emerged from synthesis post-approval" from "decompose found
  // it but strategy didn't claim it". So we report this as 0 for now and
  // surface it once an entity-provenance tag exists. (See the related
  // proposed_by_strategy_id field idea in Phase 3 of the build plan.)
  const extra_new = 0;

  const counts = {
    promised_new,
    materialized_new,
    missing_new,
    extra_new,
    promised_strengthened,
    materialized_strengthened,
    baseline,
  };

  // Chips — render order matters; only include kinds with non-zero count.
  const chipBuilders: Record<TwinProposalChipKind, () => TwinProposalChip | null> = {
    as_proposed: () =>
      materialized_new + materialized_strengthened > 0
        ? {
            kind: "as_proposed",
            count: materialized_new + materialized_strengthened,
            label: "as proposed",
            tooltip: `${materialized_new} new component${materialized_new === 1 ? "" : "s"} built · ${materialized_strengthened} amplified — matches the approved twin proposal`,
          }
        : null,
    amplified: () =>
      // Amplified is reserved for the case where the materialized count
      // EXCEEDED the promised count — i.e. the twin grew beyond what was
      // approved. Without "extra" tracking we can't compute this precisely
      // yet; placeholder for Phase 3.
      null,
    missing: () =>
      missing_new > 0
        ? {
            kind: "missing",
            count: missing_new,
            label: "missing",
            tooltip: `${missing_new} component${missing_new === 1 ? "" : "s"} promised at approval but not yet materialized — regenerate or approve again to retry`,
          }
        : null,
    extra: () => null,
    baseline: () =>
      baseline > 0
        ? {
            kind: "baseline",
            count: baseline,
            label: "baseline",
            tooltip: `${baseline} component${baseline === 1 ? "" : "s"} that already existed when the proposal was approved`,
          }
        : null,
  };

  const chips: TwinProposalChip[] = [];
  for (const kind of CHIP_ORDER) {
    const built = chipBuilders[kind]();
    if (built) chips.push(built);
  }

  // Fidelity = ratio of materialized commitments to total commitments, only
  // counting "needs_building" and "needs_strengthening" intents. Pure
  // baseline entities are excluded — keeping them around isn't a fidelity
  // signal, building/strengthening them is.
  const totalCommitments = promised_new + promised_strengthened;
  let fidelity: TwinProposalDiff["fidelity"] = "high";
  if (totalCommitments > 0) {
    const materializedRatio =
      (materialized_new + materialized_strengthened) / totalCommitments;
    if (materializedRatio < FIDELITY_MED) fidelity = "low";
    else if (materializedRatio < FIDELITY_HIGH) fidelity = "medium";
    else fidelity = "high";
  }

  const health_delta =
    currentTwinState.macro.health_score -
    proposedSpec.twin_state_at_proposal.health_score;

  return {
    fidelity,
    health_delta,
    chips,
    counts,
  };
}

function emptyCounts(): TwinProposalDiff["counts"] {
  return {
    promised_new: 0,
    materialized_new: 0,
    missing_new: 0,
    extra_new: 0,
    promised_strengthened: 0,
    materialized_strengthened: 0,
    baseline: 0,
  };
}
