/**
 * Tracker classification — post-hoc, zero-LLM.
 *
 * Takes the structured metadata from a TrackerRowInsert (source_kind, label,
 * measurement_method) and assigns:
 *   - depth_tier: how expensive this proxy is to measure (light/mid/heavy)
 *   - friction_cost: 1-10 user-effort score
 *   - data_category: which sensitivity bucket this touches
 *
 * Kept as a pure function so it can be called anywhere (build-tracker-rows,
 * future UPF selectors, test fixtures).
 */

import type { DataCategory, DepthTier } from "@/types/consent";
import type { TrackerSourceKind } from "@/lib/strategy/build-tracker-rows";

export interface TrackerClassification {
  depth_tier: DepthTier;
  friction_cost: number;
  data_category: DataCategory;
}

// ── Depth tier by source kind ──
// Rationale: leading indicators are designed to be checkable in <15 min (light);
// perspective/tactic metrics are domain-level operational metrics (mid);
// target/lagging/goal are outcome measurements that require real instrumentation
// or commitment (heavy).
const TIER_BY_SOURCE: Record<
  TrackerSourceKind,
  { tier: DepthTier; friction: number }
> = {
  leading_indicator: { tier: "light", friction: 2 },
  perspective_key_metric: { tier: "mid", friction: 5 },
  micro_tactic_metric: { tier: "mid", friction: 4 },
  lagging_indicator: { tier: "heavy", friction: 8 },
  target_objective: { tier: "heavy", friction: 8 },
  goal: { tier: "heavy", friction: 9 },
};

// ── Keyword classifier for data_category ──
// Order matters: earlier patterns win ties on hit count. Financial is first
// because dollar signs and MRR/CAC/LTV acronyms are unambiguous.
const CATEGORY_KEYWORDS: Array<{ cat: DataCategory; patterns: RegExp[] }> = [
  {
    cat: "financial",
    patterns: [
      /\brevenue\b/i,
      /\bspend(?:ing)?\b/i,
      /\bbudget\b/i,
      /\bprofit\b/i,
      /\bcost\b/i,
      /\bpricing\b/i,
      /\bcash\b/i,
      /\b(?:mrr|arr|ltv|cac|roi|ebitda|runway)\b/i,
      /\$/,
    ],
  },
  {
    cat: "health_signals",
    patterns: [
      /\bsleep\b/i,
      /\bhrv\b/i,
      /\bheart[- ]?rate\b/i,
      /\bsteps?\b/i,
      /\bweight\b/i,
      /\bcortisol\b/i,
      /\bbiomarker/i,
      /\bbiological\b/i,
      /\bmedical\b/i,
      /\bcardio\b/i,
      /\brest(?:ing)?[- ]?pulse\b/i,
    ],
  },
  {
    cat: "mood_energy",
    patterns: [
      /\bmood\b/i,
      /\benergy\b/i,
      /\bfocus\b/i,
      /\bstress\b/i,
      /\banxiety\b/i,
      /\bmotivation\b/i,
      /\bwell[- ]?being\b/i,
      /\bmorale\b/i,
    ],
  },
  {
    cat: "relationships",
    patterns: [
      /\brelationship/i,
      /\bpartner\b/i,
      /\bsocial\b/i,
      /\bfriend/i,
      /\bconversation/i,
      /\bcommunity\b/i,
      /\btrust\b/i,
    ],
  },
  {
    cat: "creative_output",
    patterns: [
      /\bwriting\b/i,
      /\bcommit/i,
      /\bpublish/i,
      /\bart\b/i,
      /\bdesign\b/i,
      /\bcreat/i,
      /\blines? of code\b/i,
    ],
  },
  {
    cat: "time_tracking",
    patterns: [
      /\bhours?\b/i,
      /\bminutes?\b/i,
      /\bcalendar\b/i,
      /\bscheduled?\b/i,
      /\btime spent\b/i,
      /\bduration\b/i,
      /\bdeep work\b/i,
    ],
  },
  {
    cat: "environment",
    patterns: [
      /\btemperature\b/i,
      /\bweather\b/i,
      /\blocation\b/i,
      /\bcommute\b/i,
      /\boffice\b/i,
      /\bambient\b/i,
    ],
  },
  {
    cat: "professional_performance",
    patterns: [
      /\bdeliverable/i,
      /\bproject\b/i,
      /\bwork\b/i,
      /\btask\b/i,
      /\bperformance\b/i,
      /\boutput\b/i,
      /\bshipped\b/i,
      /\breview\b/i,
      /\bvelocity\b/i,
      /\bthroughput\b/i,
    ],
  },
];

export function classifyTracker(args: {
  sourceKind: TrackerSourceKind;
  label: string;
  measurementMethod?: string | null;
}): TrackerClassification {
  const tierConfig = TIER_BY_SOURCE[args.sourceKind] ?? { tier: "mid", friction: 5 };
  const searchText = `${args.label ?? ""} ${args.measurementMethod ?? ""}`.toLowerCase();

  let dataCategory: DataCategory = "generic";
  let bestHits = 0;
  for (const { cat, patterns } of CATEGORY_KEYWORDS) {
    let hits = 0;
    for (const p of patterns) if (p.test(searchText)) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      dataCategory = cat;
    }
  }

  return {
    depth_tier: tierConfig.tier,
    friction_cost: tierConfig.friction,
    data_category: dataCategory,
  };
}
