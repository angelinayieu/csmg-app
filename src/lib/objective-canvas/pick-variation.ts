// ── Pick Representative Variation ──────────────────────────────────
//
// Shared helper used by Cooperation Plan v2 Fix D (enrich-chains) and
// Fix E (mechanism-spec) to pick the one variation a downstream stage
// should treat as "the" mechanism for a feature.
//
// Why a shared helper: autopilot fires mechanism-spec + enrich-chains
// for every feature regardless of user disposition, so most features
// pass through these stages WITHOUT any elected variation. Filtering
// strictly by disposition === "elected" returns [] in that common case
// and downstream prompts run unanchored (the bug the cooperation plan
// closes). The shared helper encodes the canonical fallback:
//
//   1. Prefer ELECTED variations. If multiple, take the one with the
//      highest effectiveness_score (ties broken by array order).
//   2. Otherwise fall back to the TOP-SCORED variation regardless of
//      disposition. The autopilot has just scored every variation, so
//      this is the agent's best guess at "the mechanism the user
//      would pick."
//   3. Return undefined ONLY when no variation has been scored yet
//      (pre-autopilot state, or scoring failed for the feature).
//      Callers degrade gracefully — the spec/chain runs generic.
//
// This is intentionally a pure read-side helper. Disposition mutation
// stays user-driven (the canvas never auto-elects per
// AUTOPILOT_RESTRUCTURE_SPEC.md); we just stop ignoring the score
// signal when the user hasn't yet committed.

import type { ItemVariation } from "./expand-item-detail";

/**
 * Pick the variation a downstream stage should use as "the" mechanism
 * for a feature. Returns undefined when no variation has a score and
 * none are elected.
 */
export function pickRepresentativeVariation(
  variations: ItemVariation[] | undefined | null,
): ItemVariation | undefined {
  if (!variations || variations.length === 0) return undefined;

  // Defensive: only consider variations with a real name. ItemVariation.name
  // is typed as a required string but DB rows can carry malformed data
  // (legacy migrations, JSONB partial writes). An empty-name variation
  // passed downstream produces meaningless grounding — the mechanism-spec
  // prompt renders "CHOSEN MECHANISM:" with no name and the chain
  // narrative cites no chosen mechanism. By filtering here, every caller
  // can trust the return is usable. Also fixes a metadata mismatch where
  // the mechanism-spec route would log representative_source: "top_scored"
  // while electedVariations ended up empty after a name-length filter.
  const named = variations.filter(
    (v) => typeof v?.name === "string" && v.name.trim().length > 0,
  );
  if (named.length === 0) return undefined;

  const elected = named.filter((v) => v.disposition === "elected");
  if (elected.length > 0) {
    // Prefer elected. If multiple, the one with the highest
    // effectiveness_score wins (the user elected several; respect
    // their election but still pick the strongest for downstream
    // grounding). Undefined effectiveness_score sorts as 0 — an
    // elected-but-unscored variation still beats nothing.
    return [...elected].sort(
      (a, b) => (b.effectiveness_score ?? 0) - (a.effectiveness_score ?? 0),
    )[0];
  }

  // Fallback: top-scored regardless of disposition. Number.isFinite
  // excludes NaN — `typeof NaN === "number"` is true in JS, and a
  // poisoned score from a legacy/malformed row would otherwise cascade:
  //   - in mechanism-spec, NaN < 0.4 is false → acceptOnFirstAttempt
  //     wrongly stays off for a "weak" variation
  //   - in enrich-mechanism-spec, Math.max(specificity, NaN) returns NaN,
  //     Math.min(..., NaN) returns NaN, NaN >= QUALITY_THRESHOLD is false
  //     → the spec retries every time
  // Returns undefined when NO variation has a finite score AND none are
  // elected — covers the pre-autopilot state and the post-score-failure
  // case. Downstream callers MUST tolerate undefined (the spec / chain
  // runs without a representative variation).
  const scored = named
    .filter(
      (v) =>
        typeof v.effectiveness_score === "number" &&
        Number.isFinite(v.effectiveness_score),
    )
    .sort(
      (a, b) => (b.effectiveness_score ?? 0) - (a.effectiveness_score ?? 0),
    );
  return scored[0];
}
