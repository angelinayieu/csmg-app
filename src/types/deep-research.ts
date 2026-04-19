/**
 * Deep Research Types
 *
 * Types for the OpenAI o3-deep-research / o4-mini-deep-research integration.
 * These models perform multi-hop web search, document extraction, and
 * evidence-grounded synthesis in a single background call.
 */

// ── Run metadata ──

export type DeepResearchStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type DeepResearchModel =
  | "o4-mini-deep-research"
  | "o3-deep-research";

export interface DeepResearchRunConfig {
  spaceId: string;
  /** Original user prompt or system-generated research brief */
  prompt: string;
  /** Model to use — o4-mini for most runs, o3 for high-value investigations */
  model: DeepResearchModel;
  /** Max tool calls (controls cost/latency) */
  maxToolCalls: number;
  /** Focus areas to prioritize in research */
  focusAreas?: string[];
  /** Entity context from the knowledge graph */
  entityContext?: string;
  /** Existing findings to build on (continuation research) */
  existingFindings?: string;
}

// ── Tool call trace ──

export interface DeepResearchToolCall {
  id: string;
  type: "web_search_call" | "code_interpreter_call" | "mcp_tool_call" | "file_search_call";
  status: string;
  action?: {
    type: string;
    query?: string;
    url?: string;
    code?: string;
  };
}

// ── Citations ──

export interface DeepResearchCitation {
  url: string;
  title: string;
  startIndex: number;
  endIndex: number;
  /** Text span from the report that this citation covers */
  citedText?: string;
}

// ── Claims extracted from report ──

export type ClaimStatus = "proposed" | "supported" | "contested" | "refuted";
export type ClaimType = "mechanism" | "assertion" | "prediction" | "assumption" | "finding";

export interface ExtractedClaim {
  claimText: string;
  claimType: ClaimType;
  confidence: number;
  supportingCitationIndices: number[];
  /** Entity IDs from the KG that this claim relates to */
  relatedEntityIds?: string[];
}

// ── Evidence items ──

export type SourceType =
  | "academic"
  | "news"
  | "government"
  | "blog"
  | "earnings"
  | "social"
  | "organization"
  | "unknown";

export interface EvidenceItem {
  url: string;
  title: string;
  sourceType: SourceType;
  publishedAt?: string;
  quote?: string;
  spanStart?: number;
  spanEnd?: number;
  reliabilityPrior: number;
  recencyScore: number;
}

// ── Parsed output ──

export interface DeepResearchOutput {
  /** The full report text from the model */
  reportText: string;
  /** Inline citations with URL, title, and character offsets */
  citations: DeepResearchCitation[];
  /** Tool calls made during research (search queries, pages opened, code run) */
  toolTrace: DeepResearchToolCall[];
  /** Structured claims extracted from the report */
  claims: ExtractedClaim[];
  /** Evidence items grounded to sources */
  evidence: EvidenceItem[];
  /** Summary stats */
  stats: {
    totalSearches: number;
    totalPagesOpened: number;
    totalCodeRuns: number;
    totalCitations: number;
    uniqueDomains: string[];
    totalDurationMs: number;
  };
}

// ── Stored run record ──

export interface DeepResearchRun {
  id: string;
  spaceId: string;
  status: DeepResearchStatus;
  model: DeepResearchModel;
  prompt: string;
  /** OpenAI response ID for polling */
  responseId: string | null;
  /** Parsed output (null until completed) */
  output: DeepResearchOutput | null;
  /** Entities created from this run */
  entitiesCreated: number;
  /** Edges created from this run */
  edgesCreated: number;
  /** Claims extracted from this run */
  claimsExtracted: number;
  config: DeepResearchRunConfig;
  error?: string;
  startedAt: string;
  completedAt?: string;
}
