// ── Auto-inversion generator ──
// When research surfaces high-impact hidden signals, the default synthesis
// behavior is: wait for the next /synthesize call to generate assumption_inversions.
// This leaves a window where signals live orphaned without contrarian treatment.
// This helper runs a fast heuristic pass at research time: for every high-impact
// signal, produce a stub inversion hypothesis pointing at the signal's related
// internal entities. The full synthesis pass can later replace / refine these.

import type {
  AssumptionInversion,
  Axiom,
  HiddenSignalData,
  RichLeveragePoint,
  RichRiskPoint,
  RichBottleneck,
} from "@/types/synthesis";

interface AutoInversionInput {
  hidden_signals?: HiddenSignalData[];
  leverage_points?: RichLeveragePoint[];
  risk_points?: RichRiskPoint[];
  master_bottleneck?: RichBottleneck | null;
  axioms?: Axiom[];
  existing_inversions?: AssumptionInversion[];
}

const HIGH_IMPACT_THRESHOLD = 0.6;

/**
 * Is this signal worth inverting? High trajectory impact OR a structural risk
 * type that implies the current analysis may be missing something important.
 */
function isHighImpact(s: HiddenSignalData): boolean {
  if (typeof s.trajectory_impact === "number" && s.trajectory_impact >= HIGH_IMPACT_THRESHOLD) return true;
  return s.signal_type === "structural_risk" || s.signal_type === "missing_metric";
}

/**
 * For each high-impact signal, find the most-plausible existing finding (leverage
 * / risk / bottleneck) to target for inversion. Prefer matching on shared entity
 * references — if a signal names entities C5, C12, and there's a leverage_point
 * at C5, invert that leverage_point's implicit assumption.
 */
function pickInversionTarget(
  signal: HiddenSignalData,
  leverage: RichLeveragePoint[],
  risks: RichRiskPoint[],
  bottleneck: RichBottleneck | null,
): { target_type: AssumptionInversion["target_type"]; target_entity_id: string } | null {
  const signalEntities = signal.related_internal_entities ?? [];
  if (signalEntities.length === 0) return null;

  // Prefer bottleneck match (highest leverage inversion)
  if (bottleneck?.entity_id && signalEntities.includes(bottleneck.entity_id)) {
    return { target_type: "master_bottleneck", target_entity_id: bottleneck.entity_id };
  }
  // Then leverage points
  for (const lp of leverage) {
    if (lp.entity_id && signalEntities.includes(lp.entity_id)) {
      return { target_type: "leverage_point", target_entity_id: lp.entity_id };
    }
  }
  // Then risks
  for (const rp of risks) {
    if (rp.entity_id && signalEntities.includes(rp.entity_id)) {
      return { target_type: "risk_point", target_entity_id: rp.entity_id };
    }
  }
  // No match — fall through. Caller can use the first signal entity as a weak anchor.
  return null;
}

/**
 * Generate a stub inversion for a signal. Low-plausibility by default since this
 * is heuristic — the follow-up /synthesize pass should refine these with domain
 * grounding. The value here is: no high-impact signal ever slips through the
 * analysis without at least a placeholder contrarian reading.
 */
function buildStubInversion(
  signal: HiddenSignalData,
  target: { target_type: AssumptionInversion["target_type"]; target_entity_id: string },
): AssumptionInversion {
  const signalLabel = signal.signal_name || signal.description?.slice(0, 80) || "hidden signal";
  return {
    target_type: target.target_type,
    target_entity_id: target.target_entity_id,
    original_assumption: `The current finding treats ${target.target_entity_id} as ${target.target_type === "leverage_point" ? "a genuine lever" : target.target_type === "risk_point" ? "a contained risk" : "the primary constraint"}. This assumes the mechanism described in that finding actually dominates the outcome.`,
    inverted_claim: `What if "${signalLabel}" is the real dominant mechanism — not the one currently cited? ${signal.description ?? ""}`.trim(),
    case_for_inversion: `Research surfaced this as a ${signal.signal_type?.replace(/_/g, " ") ?? "signal"} with trajectory impact ${typeof signal.trajectory_impact === "number" ? signal.trajectory_impact.toFixed(2) : "unknown"}. ${signal.analogous_precedent ? `Analogous case: ${signal.analogous_precedent}.` : "No named precedent — inversion rests on the signal's structural nature rather than historical example."} Detection method: ${signal.detection_method ?? "research synthesis"}.`,
    what_would_change: `If correct, the current framing of ${target.target_entity_id} becomes a second-order effect. Actions designed around the cited mechanism would miss the real driver. Re-run synthesis to produce domain-grounded action alternatives.`,
    test: `Observe whether outcomes track more closely with "${signalLabel}" than with the current finding over a short iteration window.`,
    plausibility: "unlikely_but_consequential",
    source: "auto_from_research",
  };
}

/**
 * Build a stub inversion specifically targeting a HIDDEN axiom. These are the
 * highest-leverage inversions — if a hidden axiom is false, the whole analysis
 * collapses. We auto-generate one per HIDDEN axiom so the user never ships a
 * strategy resting on unexamined foundations.
 */
function buildAxiomInversion(axiom: Axiom): AssumptionInversion {
  return {
    target_type: "axiom",
    target_entity_id: axiom.axiom_id,
    original_assumption: axiom.claim,
    inverted_claim: `What if "${axiom.claim}" is false? ${axiom.if_false ? `The analysis says: ${axiom.if_false}` : "The whole structure built on this axiom would need to be rebuilt."}`,
    case_for_inversion: axiom.visibility === "HIDDEN"
      ? `This axiom is HIDDEN — the user/situation never explicitly stated it, but the entire analysis implicitly depends on it being true. Hidden axioms are the single most dangerous category of assumption because no current action validates them. Load-bearing=${axiom.load_bearing}, scope=${axiom.scope}.`
      : `This axiom is ${axiom.visibility.toLowerCase()} but load-bearing=${axiom.load_bearing}. If it fails the following collapses: ${axiom.if_false || "multiple layers of the decomposition"}.`,
    what_would_change: axiom.if_false
      ? `Specific collapse: ${axiom.if_false}. Actions and findings that rest on this axiom would need to be reclassified.`
      : "Any findings, leverage points, or action items that silently depend on this assumption become invalid. A follow-up synthesis pass should reclassify them.",
    test: axiom.validation_path || `Identify a cheap observation that would decisively confirm or refute "${axiom.claim}" before investing in the strategy.`,
    plausibility: axiom.visibility === "HIDDEN" ? "coin_flip" : "unlikely_but_consequential",
    source: "auto_from_axiom",
  };
}

export function generateAutoInversions(input: AutoInversionInput): AssumptionInversion[] {
  const leverage = input.leverage_points ?? [];
  const risks = input.risk_points ?? [];
  const bottleneck = input.master_bottleneck ?? null;
  const axioms = input.axioms ?? [];
  const existing = input.existing_inversions ?? [];

  const generated: AssumptionInversion[] = [];
  const seenTargets = new Set(existing.map((i) => `${i.target_type}:${i.target_entity_id}`));

  // ── Priority 1: HIDDEN axioms ──
  // These are the highest-leverage inversions — if a hidden axiom fails, everything
  // downstream needs to be rebuilt. Always generate one per HIDDEN axiom.
  const hiddenAxioms = axioms.filter((a) => a.visibility === "HIDDEN");
  for (const ax of hiddenAxioms) {
    const key = `axiom:${ax.axiom_id}`;
    if (seenTargets.has(key)) continue;
    generated.push(buildAxiomInversion(ax));
    seenTargets.add(key);
    if (generated.length >= 3) break;
  }

  // ── Priority 2: High-impact hidden signals → entity-targeted inversions ──
  if (generated.length < 3) {
    const signals = (input.hidden_signals ?? []).filter(isHighImpact);
    for (const signal of signals) {
      const target = pickInversionTarget(signal, leverage, risks, bottleneck);
      if (!target) continue;
      const key = `${target.target_type}:${target.target_entity_id}`;
      if (seenTargets.has(key)) continue;
      generated.push(buildStubInversion(signal, target));
      seenTargets.add(key);
      if (generated.length >= 3) break;
    }
  }

  // ── Priority 3: Critical (non-hidden) load-bearing axioms ──
  // Backup — if we still have room, cover the critical-visibility axioms too.
  if (generated.length < 3) {
    const criticalNonHidden = axioms.filter((a) => a.load_bearing === "critical" && a.visibility !== "HIDDEN");
    for (const ax of criticalNonHidden) {
      const key = `axiom:${ax.axiom_id}`;
      if (seenTargets.has(key)) continue;
      generated.push(buildAxiomInversion(ax));
      seenTargets.add(key);
      if (generated.length >= 3) break;
    }
  }

  // Preserve existing (LLM-grounded) inversions first; append auto-generated stubs
  // after so the UI prioritizes the higher-quality ones.
  return [...existing, ...generated];
}
