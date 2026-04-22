// ── Source retrieval strategy ──
//
// Given (question_type, domain) → a prioritized source plan. Tells
// the research layer WHERE to look for evidence, not just whether
// to look. A prediction-about-B2B-SaaS-churn should hit industry
// benchmark datasets (OpenView / ProfitWell) before it hits news.
// A diagnosis-in-medical-context should hit peer-reviewed paper DBs
// before it hits blogs.
//
// This is the non-LLM decision layer — a lookup table per axis of
// the (question_type × domain) matrix. When the matrix is empty for
// a given input, a domain-agnostic default applies.
//
// Pairs with:
//   • source-classifier.ts for classifying retrieved URLs
//   • multi-source-retrieval.ts which CONSUMES this plan to fan out
//     parallel searches

import type { SourceSubtype } from "./source-classifier";

/** The question type emitted by our classifier (aligned with
 *  QuestionType from axis-prompts.ts but re-declared here to avoid
 *  a cross-module dep that only shares a string union). */
export type QuestionType =
  | "decision"
  | "prediction"
  | "diagnosis"
  | "design"
  | "exploration"
  | "analysis"
  | "evaluation"
  | "synthesis";

/** Coarse domain taxonomy. Aligned with what domain-detector.ts
 *  produces so an upstream classification can slot in directly. */
export type CoarseDomain =
  | "business"              // B2B, B2C, SaaS, startups, product
  | "finance_macro"         // economics, markets, policy
  | "medical"               // clinical, pharma, public health
  | "science_hard"          // physics, chemistry, biology
  | "science_cognitive"     // psychology, neuroscience, behavioral
  | "engineering"           // software, systems, infra
  | "policy_legal"          // law, regulation, governance
  | "personal"              // life decisions, habits, relationships
  | "cultural_social"       // sociology, anthropology, org dynamics
  | "creative"              // art, design, writing
  | "generic";              // unknown / domain-agnostic

export interface SourceRetrievalPlan {
  /** Preferred subtypes in ranked order. Retrieval tries these first,
   *  collecting results until budget is exhausted. */
  primary: SourceSubtype[];
  /** Fallback subtypes when primary returns insufficient material. */
  secondary: SourceSubtype[];
  /** Last-resort subtypes — cast a wider net if nothing strong
   *  surfaced. */
  fallback: SourceSubtype[];
  /** Web-search query modifiers to append. `site:` restrictions,
   *  filetype filters, quoted terms. */
  query_modifiers: string[];
  /** Specific domains to DIRECTLY scrape / API-pull (higher-signal
   *  than generic search). */
  scraping_targets: string[];
  /** Evidence budget — how many items to attempt to ground per run.
   *  Scales with reasoning depth upstream. */
  target_evidence_count: number;
  /** Minimum acceptable reliability_prior. Below this, discard the
   *  result even if it matched a search. Strict domains (medical /
   *  policy) set this high; exploratory domains lower. */
  min_reliability_prior: number;
}

// ── Default plan — used when (type, domain) doesn't have a specific
// row in the matrix below. Intentionally conservative. ──

const DEFAULT_PLAN: SourceRetrievalPlan = {
  primary: ["peer_reviewed_paper", "academic_database", "government_primary"],
  secondary: ["news_mainstream", "trade_publication", "case_study_industry"],
  fallback: ["expert_blog", "company_blog", "community_forum_consensus"],
  query_modifiers: [],
  scraping_targets: [],
  target_evidence_count: 8,
  min_reliability_prior: 0.45,
};

// ── Specific plans — keyed on `${type}:${domain}`. First hit wins. ──

const SPECIFIC_PLANS: Record<string, Partial<SourceRetrievalPlan>> = {
  // Business — predictions want benchmarks FIRST, then case studies
  "prediction:business": {
    primary: [
      "industry_benchmark_dataset",
      "peer_reviewed_industry_report",
      "corporate_filing",
    ],
    secondary: ["case_study_industry", "trade_publication", "earnings_transcript"],
    fallback: ["news_mainstream", "expert_blog"],
    query_modifiers: [
      `"benchmark" OR "typical" OR "median" -site:medium.com`,
      `site:openviewpartners.com OR site:priceintelligently.com OR site:chartmogul.com`,
    ],
    scraping_targets: ["openviewpartners.com", "crunchbase.com", "sec.gov"],
    target_evidence_count: 10,
    min_reliability_prior: 0.5,
  },
  // Business — decisions benefit from precedent cases
  "decision:business": {
    primary: ["case_study_academic", "case_study_industry", "industry_benchmark_dataset"],
    secondary: ["peer_reviewed_industry_report", "trade_publication"],
    fallback: ["news_mainstream", "community_forum_consensus"],
    query_modifiers: [
      `"case study" OR "post-mortem" OR "lessons learned"`,
      `site:hbs.edu OR site:ycombinator.com`,
    ],
    scraping_targets: ["ycombinator.com/library"],
    target_evidence_count: 8,
    min_reliability_prior: 0.5,
  },
  // Business — diagnosis wants failure patterns + post-mortems
  // (post-mortems are a subset of case_study_industry — the
  // classifier doesn't distinguish them today, so we piggyback on
  // the same subtype but use query modifiers to narrow retrieval.)
  "diagnosis:business": {
    primary: ["case_study_industry", "peer_reviewed_industry_report"],
    secondary: ["trade_publication", "expert_blog"],
    fallback: ["community_forum_consensus"],
    query_modifiers: [
      `"post-mortem" OR "root cause" OR "why we failed"`,
    ],
    scraping_targets: [],
    target_evidence_count: 8,
    min_reliability_prior: 0.45,
  },

  // Medical — strictest reliability gate
  "prediction:medical": {
    primary: ["peer_reviewed_paper", "government_primary", "supranational_body"],
    secondary: ["academic_database", "preprint"],
    fallback: ["case_study_academic"],
    query_modifiers: [
      `"randomized controlled trial" OR "meta-analysis" OR "systematic review"`,
      `site:pubmed.ncbi.nlm.nih.gov OR site:cochranelibrary.com`,
    ],
    scraping_targets: ["pubmed.ncbi.nlm.nih.gov", "who.int", "cdc.gov"],
    target_evidence_count: 12,
    min_reliability_prior: 0.7,
  },
  "diagnosis:medical": {
    primary: ["peer_reviewed_paper", "case_study_academic", "supranational_body"],
    secondary: ["academic_database", "preprint"],
    fallback: ["technical_documentation"],
    query_modifiers: [
      `"differential diagnosis" OR "presentation" OR "clinical features"`,
    ],
    scraping_targets: ["pubmed.ncbi.nlm.nih.gov"],
    target_evidence_count: 10,
    min_reliability_prior: 0.7,
  },

  // Macro finance / economics — official statistics first
  "prediction:finance_macro": {
    primary: ["government_primary", "supranational_body", "corporate_filing"],
    secondary: ["peer_reviewed_paper", "news_mainstream"],
    fallback: ["trade_publication"],
    query_modifiers: [
      `site:fred.stlouisfed.org OR site:bls.gov OR site:bea.gov OR site:imf.org`,
    ],
    scraping_targets: ["fred.stlouisfed.org", "bls.gov", "imf.org"],
    target_evidence_count: 10,
    min_reliability_prior: 0.65,
  },

  // Hard science — peer review is the floor
  "analysis:science_hard": {
    primary: ["peer_reviewed_paper", "academic_database", "preprint"],
    secondary: ["technical_documentation", "case_study_academic"],
    fallback: ["expert_blog"],
    query_modifiers: [
      `site:arxiv.org OR site:nature.com OR site:science.org`,
    ],
    scraping_targets: ["arxiv.org", "openalex.org"],
    target_evidence_count: 10,
    min_reliability_prior: 0.65,
  },
  "prediction:science_hard": {
    primary: ["peer_reviewed_paper", "preprint", "academic_database"],
    secondary: ["expert_blog", "technical_documentation"],
    fallback: ["trade_publication"],
    query_modifiers: [
      `"experimental results" OR "prediction" OR "threshold"`,
    ],
    scraping_targets: ["arxiv.org"],
    target_evidence_count: 10,
    min_reliability_prior: 0.6,
  },

  // Cognitive science — mix of papers + applied case studies
  "prediction:science_cognitive": {
    primary: ["peer_reviewed_paper", "academic_database"],
    secondary: ["case_study_academic", "trade_publication"],
    fallback: ["expert_blog"],
    query_modifiers: [
      `"effect size" OR "meta-analysis" OR "replication"`,
    ],
    scraping_targets: ["pubmed.ncbi.nlm.nih.gov"],
    target_evidence_count: 10,
    min_reliability_prior: 0.6,
  },

  // Engineering — docs, RFCs, code lead
  "design:engineering": {
    primary: ["technical_documentation", "github_repo", "peer_reviewed_paper"],
    secondary: ["community_forum_consensus", "expert_blog"],
    fallback: ["company_blog"],
    query_modifiers: [
      `site:github.com OR site:stackoverflow.com OR site:ietf.org`,
    ],
    scraping_targets: [],
    target_evidence_count: 8,
    min_reliability_prior: 0.5,
  },
  "diagnosis:engineering": {
    primary: ["technical_documentation", "github_repo", "community_forum_consensus"],
    secondary: ["expert_blog"],
    fallback: [],
    query_modifiers: [
      `"root cause" OR "bug" OR "regression"`,
    ],
    scraping_targets: [],
    target_evidence_count: 6,
    min_reliability_prior: 0.45,
  },

  // Policy / legal — government + regulators first
  "analysis:policy_legal": {
    primary: ["government_primary", "supranational_body", "peer_reviewed_paper"],
    secondary: ["news_mainstream", "trade_publication"],
    fallback: ["expert_blog"],
    query_modifiers: [
      `site:sec.gov OR site:ftc.gov OR site:europa.eu`,
    ],
    scraping_targets: ["sec.gov", "eur-lex.europa.eu"],
    target_evidence_count: 10,
    min_reliability_prior: 0.65,
  },

  // Personal — case studies + community patterns
  "decision:personal": {
    primary: ["case_study_industry", "expert_blog", "peer_reviewed_paper"],
    secondary: ["community_forum_consensus", "trade_publication"],
    fallback: ["community_forum_single"],
    query_modifiers: [
      `"how I decided" OR "framework" OR "experience"`,
    ],
    scraping_targets: [],
    target_evidence_count: 6,
    min_reliability_prior: 0.4,
  },

  // Cultural / org dynamics — mix of social science + case studies
  "analysis:cultural_social": {
    primary: ["peer_reviewed_paper", "case_study_academic"],
    secondary: ["trade_publication", "expert_blog"],
    fallback: ["community_forum_consensus"],
    query_modifiers: [
      `"organizational behavior" OR "culture" OR "norms"`,
    ],
    scraping_targets: [],
    target_evidence_count: 8,
    min_reliability_prior: 0.5,
  },
};

/**
 * Produce a source retrieval plan for this (type, domain) pair.
 * Falls back to DEFAULT_PLAN when no specific row exists, merging
 * any partial specific plan over the default.
 */
export function planSourceRetrieval(
  questionType: QuestionType,
  domain: CoarseDomain,
): SourceRetrievalPlan {
  const specific = SPECIFIC_PLANS[`${questionType}:${domain}`];
  if (!specific) return DEFAULT_PLAN;
  return { ...DEFAULT_PLAN, ...specific };
}

/**
 * Ranking helper: given a retrieved evidence item's subtype, how
 * well does it match a plan? Primary = 1.0, secondary = 0.6,
 * fallback = 0.3, not-in-plan = 0.1.
 *
 * Lets the extractor sort results by plan-alignment before capping
 * to `target_evidence_count`.
 */
export function subtypeRank(
  subtype: SourceSubtype,
  plan: SourceRetrievalPlan,
): number {
  if (plan.primary.includes(subtype)) return 1.0;
  if (plan.secondary.includes(subtype)) return 0.6;
  if (plan.fallback.includes(subtype)) return 0.3;
  return 0.1;
}
