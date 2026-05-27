// ── Auto-elect strategy ────────────────────────────────────────────
//
// Pure function over one mechanism's variations[]. Returns either a
// confident election set (the AI is sure) OR an ambiguity packet (the
// AI wants the user to choose). Drives the "🪄 Auto-elect + generate"
// pipeline on the Deliverables strip.
//
// Decision logic per variation `kind`:
//
//   "principle"   — always elect. These are cross-cutting axioms;
//                   score is informational, not gating.
//
//   "additive"    — elect every variation with score ≥ ADDITIVE_FLOOR.
//                   They compose, so multiple electable is fine.
//
//   "alternative" — pick one. Confident when (top − second) ≥
//                   MARGIN AND top ≥ CONFIDENCE_FLOOR. Otherwise the
//                   choice is escalated to the user via an ambiguity
//                   packet.
//
// Mixed-kind mechanisms (rare — usually a generation artifact)
// always escalate, because the user needs to declare intent before
// the rules can apply per group.
//
// Mechanisms with ANY existing elections are SKIPPED entirely —
// auto-elect respects the user's prior manual work. The caller marks
// them as `skipped` so the UI can render "you already elected here."

import type { ItemVariation } from "./expand-item-detail";

/** Tunable thresholds. These are the "AI confidence" knobs — relax
 *  them to let the AI commit more aggressively; tighten them to make
 *  the AI defer to the user more often. */
const MARGIN = 0.1;            // alternative: top - 2nd must clear this
const CONFIDENCE_FLOOR = 0.55; // alternative: top must clear this
const ADDITIVE_FLOOR = 0.5;    // additive: score must clear this to elect

export type AmbiguityReason =
  | "close_scores"
  | "low_confidence"
  | "mixed_kinds"
  | "unscored";

export interface AutoElectChoice {
  variation_id: string;
  variation_name: string;
  description: string;
  tradeoff: string;
  kind: ItemVariation["kind"];
  effectiveness_score?: number;
  evaluation_method?: ItemVariation["evaluation_method"];
}

export interface MechanismDecision {
  entity_id: string;
  entity_name: string;
  sub_objective_id: string;
  sub_objective_title: string;
  /** Either the AI is confident (elections present, ambiguity null)
   *  or it's escalating (ambiguity present, elections empty). */
  status: "confident" | "ambiguous" | "skipped";
  /** Confident path: variation ids to elect. May contain >1 for
   *  additive / principle groups. */
  elections: string[];
  /** Ambiguous path: full candidate cards so the UI can render a
   *  picker without re-fetching the variations. */
  ambiguity?: {
    reason: AmbiguityReason;
    explainer: string;
    choices: AutoElectChoice[];
    /** Selection mode for the picker — drives radio vs checkbox.
     *  "single" for alternative kind (pick one), "multi" for
     *  additive (toggle any subset). */
    selection: "single" | "multi";
    /** AI's suggested default — the top-scored option. The UI can
     *  pre-check this so a one-click "accept defaults" path stays
     *  fast. */
    suggested_default: string[];
  };
}

interface MinimalVariation {
  id: string;
  name: string;
  description: string;
  tradeoff: string;
  kind: ItemVariation["kind"];
  disposition?: ItemVariation["disposition"];
  effectiveness_score?: number;
  evaluation_method?: ItemVariation["evaluation_method"];
}

/** Plan one mechanism's elections. Pure — caller fans out across
 *  all mechanisms in a space. */
export function planMechanismElections(args: {
  entityId: string;
  entityName: string;
  subObjectiveId: string;
  subObjectiveTitle: string;
  variations: MinimalVariation[];
}): MechanismDecision {
  const { entityId, entityName, subObjectiveId, subObjectiveTitle, variations } = args;

  // Respect prior elections — if user already touched this mechanism,
  // don't second-guess them.
  const hasExistingElection = variations.some(
    (v) => v.disposition === "elected",
  );
  if (hasExistingElection) {
    return {
      entity_id: entityId,
      entity_name: entityName,
      sub_objective_id: subObjectiveId,
      sub_objective_title: subObjectiveTitle,
      status: "skipped",
      elections: [],
    };
  }

  // Filter out rejected variations — they're already off the table.
  const candidates = variations.filter((v) => v.disposition !== "rejected");
  if (candidates.length === 0) {
    return {
      entity_id: entityId,
      entity_name: entityName,
      sub_objective_id: subObjectiveId,
      sub_objective_title: subObjectiveTitle,
      status: "skipped",
      elections: [],
    };
  }

  // Group by kind. A clean mechanism has a single kind across all
  // variations; mixed-kind requires user judgment because the rules
  // differ.
  const byKind = new Map<ItemVariation["kind"], MinimalVariation[]>();
  for (const v of candidates) {
    const arr = byKind.get(v.kind) ?? [];
    arr.push(v);
    byKind.set(v.kind, arr);
  }

  const kinds = Array.from(byKind.keys());

  // Mixed-kind → escalate. User needs to declare intent.
  if (kinds.length > 1) {
    return {
      entity_id: entityId,
      entity_name: entityName,
      sub_objective_id: subObjectiveId,
      sub_objective_title: subObjectiveTitle,
      status: "ambiguous",
      elections: [],
      ambiguity: {
        reason: "mixed_kinds",
        explainer:
          `This mechanism has variations of ${kinds.length} different kinds — ` +
          `you'll want to declare which to keep alternative (pick one) vs additive (stack any) ` +
          `before the AI can apply its rules.`,
        choices: candidates.map(toChoice),
        selection: "multi",
        suggested_default: topScored(candidates, 1).map((v) => v.id),
      },
    };
  }

  const kind = kinds[0] ?? "alternative";

  // ── Principle: always elect ──
  if (kind === "principle") {
    return {
      entity_id: entityId,
      entity_name: entityName,
      sub_objective_id: subObjectiveId,
      sub_objective_title: subObjectiveTitle,
      status: "confident",
      elections: candidates.map((v) => v.id),
    };
  }

  // ── Additive: elect everything above floor ──
  if (kind === "additive") {
    const eligible = candidates.filter(
      (v) =>
        typeof v.effectiveness_score === "number" &&
        v.effectiveness_score >= ADDITIVE_FLOOR,
    );
    if (eligible.length > 0) {
      return {
        entity_id: entityId,
        entity_name: entityName,
        sub_objective_id: subObjectiveId,
        sub_objective_title: subObjectiveTitle,
        status: "confident",
        elections: eligible.map((v) => v.id),
      };
    }
    // Nothing cleared the floor — ask the user.
    return {
      entity_id: entityId,
      entity_name: entityName,
      sub_objective_id: subObjectiveId,
      sub_objective_title: subObjectiveTitle,
      status: "ambiguous",
      elections: [],
      ambiguity: {
        reason: "low_confidence",
        explainer:
          `No additive variation scored above the auto-elect floor (${ADDITIVE_FLOOR}). ` +
          `Pick the ones you want — or skip and re-score first.`,
        choices: candidates.map(toChoice),
        selection: "multi",
        suggested_default: topScored(candidates, 1).map((v) => v.id),
      },
    };
  }

  // ── Alternative: confident only if clear winner + above floor ──
  // (Default kind for most generations — variations like "approach A"
  // vs "approach B" where you pick one.)
  const sorted = [...candidates].sort(
    (a, b) =>
      (b.effectiveness_score ?? 0) - (a.effectiveness_score ?? 0),
  );
  const top = sorted[0];
  const second = sorted[1];

  // Unscored top — re-score or pick manually.
  if (
    typeof top?.effectiveness_score !== "number" ||
    !Number.isFinite(top.effectiveness_score)
  ) {
    return {
      entity_id: entityId,
      entity_name: entityName,
      sub_objective_id: subObjectiveId,
      sub_objective_title: subObjectiveTitle,
      status: "ambiguous",
      elections: [],
      ambiguity: {
        reason: "unscored",
        explainer:
          `Variations haven't been scored yet — the AI can't compare them. ` +
          `Run scoring first (or pick manually).`,
        choices: candidates.map(toChoice),
        selection: "single",
        suggested_default: [],
      },
    };
  }

  // Low overall confidence — top isn't strong enough to claim.
  if (top.effectiveness_score < CONFIDENCE_FLOOR) {
    return {
      entity_id: entityId,
      entity_name: entityName,
      sub_objective_id: subObjectiveId,
      sub_objective_title: subObjectiveTitle,
      status: "ambiguous",
      elections: [],
      ambiguity: {
        reason: "low_confidence",
        explainer:
          `Top variation scored ${(top.effectiveness_score * 100).toFixed(0)}/100 ` +
          `— below the auto-elect floor (${(CONFIDENCE_FLOOR * 100).toFixed(0)}). ` +
          `The AI isn't confident enough; pick the one you'd like to commit to.`,
        choices: candidates.map(toChoice),
        selection: "single",
        suggested_default: [top.id],
      },
    };
  }

  // Tight race — top is close to runner-up.
  const margin =
    second && typeof second.effectiveness_score === "number"
      ? top.effectiveness_score - second.effectiveness_score
      : Infinity;
  if (margin < MARGIN) {
    return {
      entity_id: entityId,
      entity_name: entityName,
      sub_objective_id: subObjectiveId,
      sub_objective_title: subObjectiveTitle,
      status: "ambiguous",
      elections: [],
      ambiguity: {
        reason: "close_scores",
        explainer:
          `Top two variations are within ${(margin * 100).toFixed(0)} points of each other ` +
          `— a tight call. The AI defers to you here.`,
        choices: candidates.map(toChoice),
        selection: "single",
        suggested_default: [top.id],
      },
    };
  }

  // Confident pick.
  return {
    entity_id: entityId,
    entity_name: entityName,
    sub_objective_id: subObjectiveId,
    sub_objective_title: subObjectiveTitle,
    status: "confident",
    elections: [top.id],
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function toChoice(v: MinimalVariation): AutoElectChoice {
  return {
    variation_id: v.id,
    variation_name: v.name,
    description: v.description,
    tradeoff: v.tradeoff,
    kind: v.kind,
    effectiveness_score: v.effectiveness_score,
    evaluation_method: v.evaluation_method,
  };
}

function topScored(vs: MinimalVariation[], n: number): MinimalVariation[] {
  return [...vs]
    .sort(
      (a, b) =>
        (b.effectiveness_score ?? 0) - (a.effectiveness_score ?? 0),
    )
    .slice(0, n);
}

// Re-export thresholds so the UI can show them in tooltips without
// hardcoding magic numbers in two places.
export const AUTO_ELECT_THRESHOLDS = {
  margin: MARGIN,
  confidence_floor: CONFIDENCE_FLOOR,
  additive_floor: ADDITIVE_FLOOR,
} as const;
