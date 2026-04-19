/**
 * UPF selector — the one function every domain calls (Phase 4c).
 *
 * Given a list of candidate ProxyDescriptors and a snapshot of user consent,
 * returns the descriptor with the highest information-per-friction ratio, or
 * null if none pass consent / budget. The same function is used from:
 *
 *   - synthesis-view.tsx      → "recommended next question"
 *   - strategy cascade        → tracker proposal ranking
 *   - (future) edge queue     → which low-confidence edge to probe heavier
 *   - (future) chat intake    → next probe when user pauses
 *
 * Keep this file *boring* and deterministic: identical inputs must always
 * produce identical ordering. All randomness lives outside.
 */

import type {
  ProxyDescriptor,
  ProxyScore,
  ConsentSnapshot,
} from "./types";
import {
  applyPosteriorAttenuation,
  type PosteriorLookup,
  type ConstructPosterior,
} from "./posterior";

/** Prevents divide-by-zero for zero-friction descriptors. */
const FRICTION_EPSILON = 0.05;

export interface SelectNextResult {
  /** The top pick, or null if none passed filtering. */
  top: ProxyDescriptor | null;
  /**
   * Ranked list, including filtered descriptors (with `filtered_by_consent:
   * true`), so callers that want to render "the alternative we would have
   * picked if you allowed X" can do so without re-running the scorer.
   */
  ranked: Array<{ descriptor: ProxyDescriptor; score: ProxyScore }>;
}

function passesConsent(
  d: ProxyDescriptor,
  consent: ConsentSnapshot | null
): boolean {
  if (!consent) return true;
  // No personal data required — always passes.
  if (d.data_categories.length === 0) return true;
  const allowed = new Set(consent.allowed_categories);
  return d.data_categories.every((c) => allowed.has(c));
}

function passesBudget(
  d: ProxyDescriptor,
  consent: ConsentSnapshot | null
): boolean {
  if (!consent?.daily_friction_budget) return true;
  return d.friction_cost <= consent.daily_friction_budget;
}

/**
 * Given every construct this proxy probes, pick the one whose posterior
 * reduces the info-bit multiplier LEAST — i.e. the most-uncertain construct.
 * Rationale: a proxy that still touches any unknown stays informative.
 * Tracked alongside the proxy's own construct_id so descriptors that don't
 * populate probes_constructs behave exactly as before.
 */
function pickDominantPosterior(
  d: ProxyDescriptor,
  posteriorLookup?: PosteriorLookup
): { posterior: ConstructPosterior | undefined; observedTotal: number } {
  if (!posteriorLookup) return { posterior: undefined, observedTotal: 0 };

  const probedIds =
    d.probes_constructs && d.probes_constructs.length > 0
      ? d.probes_constructs
      : [d.construct_id];

  let dominant: ConstructPosterior | undefined;
  let observedTotal = 0;
  for (const cid of probedIds) {
    const p = posteriorLookup(cid);
    if (!p) continue;
    observedTotal += p.observation_count;
    // Max variance wins (most-uncertain construct dominates). Missing
    // posterior entries are treated as prior = implicit max.
    if (!dominant || p.variance > dominant.variance) dominant = p;
  }
  // If ANY probed construct has no posterior, we treat the proxy as "still
  // has unknowns" and return no dominant posterior (full nominal bits).
  for (const cid of probedIds) {
    if (!posteriorLookup(cid)) return { posterior: undefined, observedTotal };
  }
  return { posterior: dominant, observedTotal };
}

function toScore(
  d: ProxyDescriptor,
  filteredByConsent: boolean,
  posteriorLookup?: PosteriorLookup
): ProxyScore {
  // Phase 4c-final upgrade: look across ALL probed constructs, not just the
  // proxy's own construct_id. Use the most-uncertain one to attenuate.
  const { posterior, observedTotal } = pickDominantPosterior(d, posteriorLookup);
  const effectiveBits = applyPosteriorAttenuation(
    d.expected_info_bits,
    posterior
  );
  const value_per_friction = effectiveBits / (d.friction_cost + FRICTION_EPSILON);

  let rationale =
    (d.metadata?.rationale as string | undefined) ?? "baseline score";
  if (observedTotal > 0) {
    rationale += ` · ${observedTotal} prior observation${observedTotal === 1 ? "" : "s"}`;
  }

  return {
    descriptor_id: d.id,
    value_per_friction,
    expected_info_bits: effectiveBits,
    friction_cost: d.friction_cost,
    rationale,
    filtered_by_consent: filteredByConsent,
  };
}

/**
 * Core selector. Ties are broken by (a) lower friction first (cheaper),
 * then (b) lexicographic descriptor id for full determinism.
 *
 * `posteriorLookup` is optional — when provided, each descriptor's nominal
 * info-bits are attenuated by the posterior variance for its construct_id,
 * so proxies of well-known constructs rank lower (Phase 4c-final).
 */
export function selectNextProxy(
  descriptors: ProxyDescriptor[],
  consent: ConsentSnapshot | null = null,
  posteriorLookup?: PosteriorLookup
): SelectNextResult {
  const scored = descriptors.map((d) => {
    const filtered = !passesConsent(d, consent) || !passesBudget(d, consent);
    return { descriptor: d, score: toScore(d, filtered, posteriorLookup) };
  });

  const ranked = [...scored].sort((a, b) => {
    // Filtered descriptors always sink.
    if (a.score.filtered_by_consent !== b.score.filtered_by_consent) {
      return a.score.filtered_by_consent ? 1 : -1;
    }
    if (b.score.value_per_friction !== a.score.value_per_friction) {
      return b.score.value_per_friction - a.score.value_per_friction;
    }
    if (a.descriptor.friction_cost !== b.descriptor.friction_cost) {
      return a.descriptor.friction_cost - b.descriptor.friction_cost;
    }
    return a.descriptor.id.localeCompare(b.descriptor.id);
  });

  const top =
    ranked.length > 0 && !ranked[0].score.filtered_by_consent
      ? ranked[0].descriptor
      : null;

  return { top, ranked };
}
