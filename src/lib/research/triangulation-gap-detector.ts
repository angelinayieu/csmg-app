// ── Triangulation gap detector ──
//
// Phase 2 (research-strategy migration). Pure function: given a claim's
// linked evidence, decide whether the claim has enough independent
// supporting sources to be considered triangulated. If not, produce a
// `TriangulationGap` describing what's missing + suggested follow-up
// queries the research orchestrator can fan out next pass.
//
// Why decoupled from claim-producer:
//   1. Keeps persistence and orchestration concerns separate. The
//      producer doesn't need an event-bus dependency to be testable.
//   2. The detector can be re-run later (e.g. by a "refresh gaps"
//      cron) without re-persisting evidence.
//   3. Lets the adversarial pass reuse the same logic in reverse —
//      "this claim is supported by ≥3 sources but has zero
//      contradictors checked" is the inverse signal.
//
// Triangulation policy (configurable, default at the bottom of this
// file): a claim is "triangulated" iff it has ≥`requiredSupportCount`
// distinct high-reliability supporters AND zero high-reliability
// contradictors. Below that bar → gap.
//
// "Distinct" sources matter — three quotes from the same paper count
// as one source for triangulation purposes (we dedup by URL).

import type { ExtractedEvidence } from "./evidence-extractor";

/** Minimal evidence shape the detector actually needs. Lets callers
 *  feed it from in-memory ExtractedEvidence (research path) or from
 *  reconstructed DB rows (post-hoc triangulate path) without coupling
 *  the detector to either source. */
export interface MinimalEvidenceForGap {
  url: string;
  support_type: "supports" | "contradicts" | "contextualizes";
  reliability_prior: number;
}

export interface TriangulationPolicy {
  /** Number of distinct high-reliability supporters required to call
   *  a claim triangulated. Default 2. Phase 2 default; raise to 3
   *  later for stricter promotion. */
  requiredSupportCount: number;
  /** Reliability threshold above which a source is "high-reliability".
   *  Mirrors claim-producer.ts (which uses 0.7 for status promotion). */
  highReliabilityThreshold: number;
  /** Cap on suggested follow-up queries per gap — avoids combinatorial
   *  blow-up when a claim relates to many entities. */
  maxSuggestedQueries: number;
}

export const DEFAULT_TRIANGULATION_POLICY: TriangulationPolicy = {
  requiredSupportCount: 2,
  highReliabilityThreshold: 0.7,
  maxSuggestedQueries: 3,
};

export interface TriangulationGap {
  claimId: string;
  claimText: string;
  currentSupportCount: number;
  requiredSupportCount: number;
  hasContradictor: boolean;
  suggestedQueries: string[];
}

export interface DetectGapInput {
  claimId: string;
  claimText: string;
  /** Either full ExtractedEvidence (in-memory research path) or thin
   *  shape reconstructed from DB rows (post-hoc triangulate path).
   *  The detector only reads url + support_type + reliability_prior. */
  evidence: Array<ExtractedEvidence | MinimalEvidenceForGap>;
  /** Optional: names of entities this claim relates to. Used to seed
   *  better follow-up queries (e.g. "<claim> <entityName> systematic
   *  review"). When empty, queries fall back to the claim text alone. */
  relatedEntityNames?: string[];
  policy?: TriangulationPolicy;
}

/** Coerce either evidence shape to the minimal fields needed. */
function toMinimal(
  ev: ExtractedEvidence | MinimalEvidenceForGap,
): MinimalEvidenceForGap {
  if ("source_classification" in ev) {
    return {
      url: ev.url,
      support_type: ev.support_type,
      reliability_prior: ev.source_classification.reliability_prior,
    };
  }
  return ev;
}

/**
 * Returns a TriangulationGap when the claim doesn't meet the policy,
 * or null when it's already triangulated.
 *
 * Distinct-source counting: dedups supporters by URL so multiple quotes
 * from the same paper don't inflate the count. Contradictor detection
 * uses the same threshold.
 */
export function detectTriangulationGap(
  input: DetectGapInput,
): TriangulationGap | null {
  const policy = input.policy ?? DEFAULT_TRIANGULATION_POLICY;

  // Distinct supporters by URL (a paper that's quoted three times is
  // still one independent source for triangulation purposes).
  const distinctSupportingUrls = new Set<string>();
  let hasContradictor = false;

  for (const raw of input.evidence) {
    const ev = toMinimal(raw);
    if (ev.reliability_prior < policy.highReliabilityThreshold) continue;
    if (ev.support_type === "supports") {
      distinctSupportingUrls.add(ev.url);
    } else if (ev.support_type === "contradicts") {
      hasContradictor = true;
    }
    // "contextualizes" doesn't move triangulation — same convention
    // as claim-producer's posterior.
  }

  const currentSupportCount = distinctSupportingUrls.size;
  if (
    currentSupportCount >= policy.requiredSupportCount &&
    !hasContradictor
  ) {
    // Triangulated: ≥N supporters, zero contradictors → no gap.
    return null;
  }

  return {
    claimId: input.claimId,
    claimText: input.claimText.slice(0, 200),
    currentSupportCount,
    requiredSupportCount: policy.requiredSupportCount,
    hasContradictor,
    suggestedQueries: buildSuggestedQueries(
      input.claimText,
      input.relatedEntityNames ?? [],
      policy.maxSuggestedQueries,
      hasContradictor,
    ),
  };
}

/**
 * Build follow-up queries the research orchestrator can run on the
 * next pass to close the gap. Three flavors:
 *   1. Plain claim text — broad search for any new corroborating source
 *   2. Claim + entity name — narrows to a specific entity context
 *   3. "<claim> systematic review" / "<claim> meta analysis" —
 *      surface high-reliability aggregations, the bar we want to clear
 *
 * When a contradictor was already found, swap query 3 to "<claim>
 * limitations" / "<claim> failed to replicate" — chase the boundary
 * conditions rather than piling more support on a contested claim.
 */
function buildSuggestedQueries(
  claimText: string,
  relatedEntityNames: string[],
  cap: number,
  hasContradictor: boolean,
): string[] {
  const queries: string[] = [];
  const trimmed = claimText.trim().slice(0, 160);

  queries.push(trimmed);
  if (relatedEntityNames.length > 0) {
    queries.push(`${trimmed} ${relatedEntityNames[0]}`);
  }
  queries.push(
    hasContradictor
      ? `${trimmed} limitations failed to replicate`
      : `${trimmed} systematic review meta-analysis`,
  );

  return queries.slice(0, cap);
}
