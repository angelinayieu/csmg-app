// ── Tool-registry types (Phase 1 Step 5) ──
//
// Goal (user's original question): rigor via structured connectors
// instead of pure agentic search. Each tool knows its domain, input
// schema, and how to emit canonical records with source metadata —
// authority, publish date, canonical_url — that can ride into
// entities.provenance / edges.provenance so Stage-4 ranking can weight
// by evidence quality rather than treating a blog post the same as a
// peer-reviewed paper.
//
// Design rules:
//   1. Every tool returns ToolResult[] — a flat list of hits, each
//      carrying the authority/recency signals downstream code needs.
//   2. Connectors never throw — errors resolve as an empty result set
//      with a populated `error` field. The registry's call site decides
//      whether to retry or fall back.
//   3. New domain sources (arXiv, PubMed, FRED, Wikidata-SPARQL, etc.)
//      plug in by implementing `ToolConnector` and registering via
//      `registerTool()`. No orchestrator changes required.
//
// Deliberately NOT covered in v1: streaming results, rate-limit budgets,
// cross-tool dedup. Those land when we wire the registry into
// /api/pipeline/research and need to enforce cost caps.

/** Discriminant for authority bucket. Downstream ranking maps to a 0-1 weight. */
export type SourceAuthority =
  | "peer_reviewed"
  | "official"
  | "reference"
  | "news"
  | "blog"
  | "unknown";

export type ToolDomain =
  | "canonical_entity"   // Wikidata, ConceptNet — canonical URIs + type lattices
  | "academic"           // Crossref, OpenAlex, Semantic Scholar — papers
  | "news"               // GDELT, News-API
  | "web"                // Tavily, Exa, Serp — generic web search
  | "patent"             // Google Patents, USPTO
  | "medical"            // PubMed, ClinicalTrials
  | "economic";          // FRED, World Bank, OECD

export interface ToolHit {
  /** Stable canonical URL for this result. */
  url: string;
  /** Display title. */
  title: string | null;
  /** Short summary / abstract / snippet. */
  snippet: string | null;
  /** ISO 8601 publish/created date when known. */
  publishedAt: string | null;
  /** Source-level authority classification. */
  authority: SourceAuthority;
  /** 0..1 relevance score as the tool calculates it. Pipelines can normalize. */
  relevance: number;
  /** Tool-specific extras (DOI, Wikidata QID, author list, etc.). */
  metadata?: Record<string, unknown>;
}

export interface ToolResult {
  toolId: string;
  hits: ToolHit[];
  /** Non-null when the tool failed — hits will be empty. */
  error: string | null;
  /** Wall-clock milliseconds the call took. */
  durationMs: number;
}

export interface ToolInput {
  /** User's search query. Tool normalizes/URL-encodes as needed. */
  query: string;
  /** Hard cap on returned hits. Tools should respect this. */
  maxResults?: number;
  /** Optional ISO 8601 lower-bound for publishedAt filtering. */
  freshnessSince?: string;
  /** Free-form per-tool knobs (author filter, subject filter, etc.). */
  extras?: Record<string, unknown>;
}

export interface ToolConnector {
  readonly id: string;
  readonly domain: ToolDomain;
  readonly label: string;
  readonly description: string;
  /**
   * True when the tool requires no external credentials (e.g. free
   * REST APIs). Used by the registry to filter down to free tools for
   * unauthenticated/trial contexts.
   */
  readonly requiresAuth: boolean;
  call(input: ToolInput): Promise<ToolResult>;
}
