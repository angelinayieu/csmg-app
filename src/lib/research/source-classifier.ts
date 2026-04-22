// ── Source classifier ──
//
// Deterministic URL → source-type classifier. No LLM. Pure function.
// Runs on every candidate evidence URL before persistence so:
//
//   • `reliability_prior` on `evidence_items` reflects a real authority
//     signal (peer-reviewed paper ≠ random blog) rather than the 0.5
//     default that currently lands on every row.
//   • Recency decays predictably on authority-weighted sources
//     (a 2025 Nature paper still >> a 2025 HackerNews comment).
//   • The research-first decision layer (strategy-refresh) can filter
//     priors by authority before using empirical distributions — low-
//     authority hits ≠ usable base rates.
//
// Shape: the DB-persisted `source_type` is one of 8 canonical values
// (matches the existing CHECK constraint). An in-memory `source_subtype`
// carries our richer taxonomy for ranking decisions; it does not
// persist today — if we want to surface it later, a small ALTER TABLE
// adding a nullable subtype column will do.

export type DbSourceType =
  | "academic"
  | "news"
  | "government"
  | "blog"
  | "earnings"
  | "social"
  | "organization"
  | "unknown";

/** Richer taxonomy for ranking. In-memory only. */
export type SourceSubtype =
  | "peer_reviewed_paper"
  | "preprint"
  | "academic_database"
  | "government_primary"
  | "government_agency_blog"
  | "supranational_body"            // OECD / IMF / UN / WHO
  | "corporate_filing"               // 10-K, 10-Q, annual reports
  | "earnings_transcript"
  | "peer_reviewed_industry_report"  // Gartner / Forrester (paywalled, strong method)
  | "industry_benchmark_dataset"     // OpenView, ProfitWell, Stripe reports, Crunchbase data
  | "trade_publication"              // Stratechery, a16z content, WSJ Pro
  | "news_mainstream"                // Reuters, BBC, NYT, Bloomberg
  | "news_local"
  | "case_study_academic"            // HBS cases
  | "case_study_industry"            // YC library, startup post-mortems
  | "technical_documentation"        // vendor docs, RFCs, specs
  | "github_repo"
  | "expert_blog"                    // known expert personal blog (signal)
  | "company_blog"                   // vendor content marketing
  | "community_forum_consensus"      // HN/Reddit threads with multiple expert replies
  | "community_forum_single"
  | "podcast_transcript"
  | "social_post"                    // Twitter/LinkedIn
  | "aggregator"                     // content farms, unsigned summaries
  | "unknown";

export interface SourceClassification {
  source_type: DbSourceType;
  source_subtype: SourceSubtype;
  authority_tier: "high" | "moderate" | "low";
  /** 0..1 prior on how reliable this source generally is, before
   *  considering the specific quote extracted. */
  reliability_prior: number;
  /** 0..1 recency score. 1.0 = within the last year; 0.5 = 5 years
   *  old; 0.2 = 20+ years. NULL published_at → 0.4 (unknown). */
  recency_score: number;
  /** Netloc extracted from the URL for display + dedup. */
  domain_name: string;
  /** First-hand reporting vs synthesized coverage. Primary sources
   *  count extra when evidence is contested (dueling sources). */
  is_primary_source: boolean;
}

// ── Domain lookup tables ──
// Declaratively encoded so adding a new known source is 1 line.
// Regex matches netloc; first hit wins. Keep authority/subtype
// tuples tight so someone reading this file can audit decisions.

interface DomainRule {
  pattern: RegExp;
  subtype: SourceSubtype;
  sourceType: DbSourceType;
  authority: "high" | "moderate" | "low";
  reliability: number;
  primary: boolean;
}

const DOMAIN_RULES: DomainRule[] = [
  // Academic databases + paper hosts
  { pattern: /^(www\.)?(nature|science|cell|nejm|lancet|bmj)\.com$/, subtype: "peer_reviewed_paper", sourceType: "academic", authority: "high", reliability: 0.92, primary: true },
  { pattern: /(^|\.)jstor\.org$/, subtype: "academic_database", sourceType: "academic", authority: "high", reliability: 0.88, primary: true },
  { pattern: /(^|\.)arxiv\.org$/, subtype: "preprint", sourceType: "academic", authority: "moderate", reliability: 0.75, primary: true },
  { pattern: /(^|\.)(biorxiv|medrxiv|chemrxiv)\.org$/, subtype: "preprint", sourceType: "academic", authority: "moderate", reliability: 0.72, primary: true },
  { pattern: /(^|\.)(pubmed|ncbi\.nlm\.nih)\.gov$/, subtype: "academic_database", sourceType: "academic", authority: "high", reliability: 0.90, primary: true },
  { pattern: /(^|\.)(openalex\.org|api\.semanticscholar\.org|semanticscholar\.org)$/, subtype: "academic_database", sourceType: "academic", authority: "high", reliability: 0.88, primary: false },
  { pattern: /(^|\.)(crossref\.org|doi\.org)$/, subtype: "academic_database", sourceType: "academic", authority: "high", reliability: 0.88, primary: false },
  { pattern: /(^|\.)pnas\.org$/, subtype: "peer_reviewed_paper", sourceType: "academic", authority: "high", reliability: 0.92, primary: true },
  { pattern: /(^|\.)(plos|frontiersin|mdpi)\.org$/, subtype: "peer_reviewed_paper", sourceType: "academic", authority: "moderate", reliability: 0.78, primary: true },
  { pattern: /\.edu$/, subtype: "academic_database", sourceType: "academic", authority: "moderate", reliability: 0.75, primary: true },

  // Government + international bodies
  { pattern: /\.gov$/, subtype: "government_primary", sourceType: "government", authority: "high", reliability: 0.90, primary: true },
  { pattern: /\.gov\.[a-z]{2,3}$/, subtype: "government_primary", sourceType: "government", authority: "high", reliability: 0.88, primary: true },
  { pattern: /\.gc\.ca$/, subtype: "government_primary", sourceType: "government", authority: "high", reliability: 0.88, primary: true },
  { pattern: /(^|\.)(oecd|imf|worldbank|un)\.org$/, subtype: "supranational_body", sourceType: "government", authority: "high", reliability: 0.87, primary: true },
  { pattern: /(^|\.)(who|cdc|ecdc|fda|ema)\.(int|gov|europa\.eu)$/, subtype: "supranational_body", sourceType: "government", authority: "high", reliability: 0.90, primary: true },
  { pattern: /(^|\.)(eurostat|europa)\.eu$/, subtype: "government_primary", sourceType: "government", authority: "high", reliability: 0.88, primary: true },

  // SEC + corporate filings + earnings
  { pattern: /(^|\.)sec\.gov$/, subtype: "corporate_filing", sourceType: "earnings", authority: "high", reliability: 0.93, primary: true },
  { pattern: /(^|\.)(seekingalpha|fool|motleyfool)\.com$/, subtype: "earnings_transcript", sourceType: "earnings", authority: "moderate", reliability: 0.60, primary: false },

  // Peer-reviewed industry + research databases
  { pattern: /(^|\.)(gartner|forrester|idc|mckinsey|bcg|bain)\.com$/, subtype: "peer_reviewed_industry_report", sourceType: "organization", authority: "high", reliability: 0.80, primary: true },

  // Industry benchmark datasets
  { pattern: /(^|\.)(openviewpartners|priceintelligently|chartmogul|profitwell)\.com$/, subtype: "industry_benchmark_dataset", sourceType: "organization", authority: "moderate", reliability: 0.72, primary: true },
  { pattern: /(^|\.)(crunchbase|pitchbook|cbinsights)\.com$/, subtype: "industry_benchmark_dataset", sourceType: "organization", authority: "moderate", reliability: 0.70, primary: true },

  // Trade publications (editorial standards, known voices)
  { pattern: /(^|\.)(stratechery|platformer|benedictevans)\.com$/, subtype: "trade_publication", sourceType: "blog", authority: "moderate", reliability: 0.68, primary: false },
  { pattern: /(^|\.)a16z\.com$/, subtype: "trade_publication", sourceType: "organization", authority: "moderate", reliability: 0.65, primary: false },
  { pattern: /(^|\.)(techcrunch|theinformation|axios)\.com$/, subtype: "news_mainstream", sourceType: "news", authority: "moderate", reliability: 0.62, primary: false },

  // News mainstream
  { pattern: /(^|\.)(reuters|bloomberg|wsj|ft|nytimes|washingtonpost|bbc|economist|ap)\.com$/, subtype: "news_mainstream", sourceType: "news", authority: "moderate", reliability: 0.75, primary: true },
  { pattern: /(^|\.)bbc\.co\.uk$/, subtype: "news_mainstream", sourceType: "news", authority: "moderate", reliability: 0.75, primary: true },
  { pattern: /(^|\.)(npr|cnn|foxnews|theguardian)\.com$/, subtype: "news_mainstream", sourceType: "news", authority: "moderate", reliability: 0.65, primary: true },

  // Case study sources
  { pattern: /(^|\.)hbs\.edu$/, subtype: "case_study_academic", sourceType: "academic", authority: "high", reliability: 0.82, primary: true },
  { pattern: /(^|\.)(ycombinator|paulgraham)\.com$/, subtype: "case_study_industry", sourceType: "blog", authority: "moderate", reliability: 0.68, primary: true },

  // Technical docs + repos
  { pattern: /(^|\.)(github|gitlab|bitbucket)\.com$/, subtype: "github_repo", sourceType: "organization", authority: "moderate", reliability: 0.65, primary: true },
  { pattern: /(^|\.)(mozilla|w3|ietf)\.org$/, subtype: "technical_documentation", sourceType: "organization", authority: "high", reliability: 0.85, primary: true },
  { pattern: /(^|\.)readthedocs\.io$/, subtype: "technical_documentation", sourceType: "organization", authority: "moderate", reliability: 0.70, primary: true },

  // Community forums
  { pattern: /(^|\.)news\.ycombinator\.com$/, subtype: "community_forum_consensus", sourceType: "social", authority: "low", reliability: 0.45, primary: false },
  { pattern: /(^|\.)reddit\.com$/, subtype: "community_forum_consensus", sourceType: "social", authority: "low", reliability: 0.40, primary: false },
  { pattern: /(^|\.)stackoverflow\.com$/, subtype: "community_forum_consensus", sourceType: "social", authority: "moderate", reliability: 0.65, primary: false },
  { pattern: /(^|\.)indiehackers\.com$/, subtype: "community_forum_single", sourceType: "social", authority: "low", reliability: 0.45, primary: true },

  // Social
  { pattern: /(^|\.)(twitter|x)\.com$/, subtype: "social_post", sourceType: "social", authority: "low", reliability: 0.30, primary: true },
  { pattern: /(^|\.)linkedin\.com$/, subtype: "social_post", sourceType: "social", authority: "low", reliability: 0.35, primary: true },

  // Known aggregators / low-signal
  { pattern: /(^|\.)(medium|substack)\.com$/, subtype: "expert_blog", sourceType: "blog", authority: "low", reliability: 0.45, primary: false },
  { pattern: /(^|\.)(wikipedia|wikimedia)\.org$/, subtype: "aggregator", sourceType: "organization", authority: "moderate", reliability: 0.62, primary: false },
];

const RECENCY_ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function recencyFromPublishedAt(publishedAt: string | null | undefined): number {
  if (!publishedAt) return 0.4; // unknown recency
  const ts = new Date(publishedAt).getTime();
  if (!Number.isFinite(ts)) return 0.4;
  const ageYears = (Date.now() - ts) / RECENCY_ONE_YEAR_MS;
  if (ageYears <= 1) return 1.0;
  if (ageYears <= 2) return 0.85;
  if (ageYears <= 5) return 0.65;
  if (ageYears <= 10) return 0.45;
  if (ageYears <= 20) return 0.25;
  return 0.15;
}

function extractNetloc(url: string): string {
  try {
    const u = new URL(url.trim());
    return u.hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Classify a URL into source type, authority tier, and reliability
 * prior. Pure function; no network calls.
 */
export function classifySource(
  url: string,
  publishedAt?: string | null,
): SourceClassification {
  const domain_name = extractNetloc(url);
  const recency_score = recencyFromPublishedAt(publishedAt);

  if (!domain_name) {
    return {
      source_type: "unknown",
      source_subtype: "unknown",
      authority_tier: "low",
      reliability_prior: 0.3,
      recency_score,
      domain_name: "",
      is_primary_source: false,
    };
  }

  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(domain_name)) {
      return {
        source_type: rule.sourceType,
        source_subtype: rule.subtype,
        authority_tier: rule.authority,
        reliability_prior: rule.reliability,
        recency_score,
        domain_name,
        is_primary_source: rule.primary,
      };
    }
  }

  // Unknown domain — default to low authority, but differentiate by TLD
  if (/\.(org|io|co)$/.test(domain_name)) {
    return {
      source_type: "organization",
      source_subtype: "company_blog",
      authority_tier: "low",
      reliability_prior: 0.42,
      recency_score,
      domain_name,
      is_primary_source: false,
    };
  }

  return {
    source_type: "unknown",
    source_subtype: "unknown",
    authority_tier: "low",
    reliability_prior: 0.35,
    recency_score,
    domain_name,
    is_primary_source: false,
  };
}

/**
 * Weighted score combining reliability × recency. Used for ranking
 * candidate evidence items when multiple support the same claim.
 */
export function scoreSource(c: SourceClassification): number {
  return c.reliability_prior * (0.7 + 0.3 * c.recency_score);
}
