// ── KG Context — shared types ──────────────────────────────────────
//
// The Phase 1 "Context Construction Layer". One canonical shape for
// KG-augmented prompt context, used by every reasoning endpoint.
//
// Today (pre-Phase-1) every endpoint hand-rolls its own prompt:
//   - materialize passes raw text
//   - recursive-decompose passes a single entity
//   - strategy-refresh passes top-N entities + claims via
//     formatRichKgContextForStrategy
//   - lasso-summarize passes flattened shape props
// 90% of the structural KG (edges, communities, axioms, convergences)
// reaches the LLM in 0% of those calls.
//
// `KgContext` is the unified payload `buildKgContext()` produces.
// `renderKgContext()` turns it into prompt text. Endpoints stop
// hand-rolling and start asking for the slice of the graph relevant
// to their reasoning task.
//
// Migration path:
//   1. lasso-summarize → buildKgContext (proof of concept; this PR)
//   2. recursive-decompose → buildKgContext (focusEntityId mode)
//   3. materialize → buildKgContext (broad mode)
//   4. strategy-refresh → swap formatRichKgContextForStrategy out

import type { Entity, Edge, Claim } from "@/types";
import type { Axiom, InsightConvergence } from "@/types/synthesis";

// ── Public API ─────────────────────────────────────────────────────

/**
 * What kind of slice of the graph the caller wants. Drives the
 * filtering + ranking heuristics in `buildKgContext()`.
 *
 *   - "broad":     a representative sweep of the most important
 *                  entities + their relationships. For "what is this
 *                  space about" prompts (intake, ambient).
 *   - "deep":      narrow focus around `focusEntityIds[]` — pulls
 *                  1-hop neighbors + immediate claims/axioms. For
 *                  decompose, expand, deepen calls.
 *   - "strategy":  the rich format the strategy engine wants —
 *                  highest-importance entities + their typed edges +
 *                  claims + manifold. Equivalent to today's
 *                  formatRichKgContextForStrategy output once
 *                  migrated.
 *   - "summarize": the slice covered by an explicit shape
 *                  selection. The caller passes pre-extracted shape
 *                  content (see lib/canvas/extract-shape-content)
 *                  and we add the KG context AROUND those shapes —
 *                  communities they touch, axioms they rest on,
 *                  convergences they participate in.
 */
export type KgContextMode = "broad" | "deep" | "strategy" | "summarize";

export interface BuildKgContextOpts {
  spaceId: string;
  mode: KgContextMode;
  /** Free-form natural-language hint about what the caller is
   *  reasoning about — used for relevance scoring (lexical today,
   *  embedding-based once we wire pgvector). Optional. */
  query?: string;
  /** When mode === "deep" or "summarize", these entity ids anchor
   *  the slice. Their 1-hop neighborhood is included. */
  focusEntityIds?: string[];
  /** Shape ids that the user explicitly selected (lasso, click, etc).
   *  Used by mode==="summarize" to propagate the selection signal
   *  into community / convergence membership lookups. */
  focusShapeIds?: string[];
  /** Hard caps. Defaults are sensible per mode; override only when
   *  the caller has a real reason. */
  caps?: Partial<KgContextCaps>;
}

export interface KgContextCaps {
  maxEntities: number;
  maxEdgesPerEntity: number;
  maxClaimsPerEntity: number;
  maxCommunities: number;
  maxAxioms: number;
  maxConvergences: number;
  /** Edges below this confidence are dropped before ranking. */
  edgeConfidenceFloor: number;
  /** Claims below this confidence are dropped. */
  claimConfidenceFloor: number;
}

// ── Output payload ─────────────────────────────────────────────────

export interface KgContext {
  spaceId: string;
  mode: KgContextMode;
  /** The query/hint that scoped this fetch. Empty string when none
   *  was supplied. Surfaced in the renderer header so the LLM knows
   *  the framing. */
  queryHint: string;

  /** Entities ranked by relevance (importance × query similarity ×
   *  centrality). The caller's focusEntityIds always rank first. */
  primaryEntities: Entity[];

  /** Entity ids in primaryEntities, captured for O(1) lookup
   *  downstream. */
  primaryEntityIds: Set<string>;

  /** 1-hop edges connecting primaryEntities to each other AND to
   *  their immediate neighbors (for query-time graph traversal).
   *  Already filtered to confidence ≥ caps.edgeConfidenceFloor. */
  edges: Edge[];

  /** Claims sourced from primaryEntities. */
  claims: Claim[];

  /** Communities (kg_communities rows) whose entity_ids[] include
   *  any of primaryEntityIds. Carries the GraphRAG-style summary
   *  jsonb when present. Sorted by overlap count desc. */
  communities: KgCommunityInfo[];

  /** Axioms (load-bearing claims) extracted during synthesis whose
   *  scope_anchor is one of primaryEntityIds OR whose load_bearing
   *  is "critical" (always include). */
  axioms: Axiom[];

  /** Insight convergences whose shared_entity_ids overlap
   *  primaryEntityIds. Already filtered to strength: "strong" or
   *  "moderate"; weak skipped. */
  convergences: InsightConvergence[];

  /** Token cost estimate computed at build time. Sum of:
   *    primaryEntities.descriptions + edges + claims +
   *    communities.summary + axioms + convergences
   *  Estimated as char/4 (no real tiktoken). Use as a guardrail; not
   *  authoritative. */
  estimatedTokens: number;

  /** Per-section token estimates for observability. */
  sectionTokens: {
    entities: number;
    edges: number;
    claims: number;
    communities: number;
    axioms: number;
    convergences: number;
  };
}

// ── Community info (subset of kg_communities row) ──────────────────

export interface KgCommunityInfo {
  id: string;
  level: number;
  entityIds: string[];
  /** GraphRAG-style summary jsonb: { title, summary, rating,
   *  rating_explanation, findings: [{summary, explanation}] }.
   *  Null when detection succeeded but summarization is pending. */
  summary: KgCommunitySummary | null;
  /** How many of `primaryEntityIds` fall inside this community.
   *  Used for "how relevant is this community to the focus" sort. */
  overlapWithFocus: number;
}

export interface KgCommunitySummary {
  title?: string;
  summary?: string;
  rating?: number;
  rating_explanation?: string;
  findings?: Array<{ summary: string; explanation?: string }>;
}

// ── Renderer options ───────────────────────────────────────────────

export interface RenderKgContextOpts {
  /** Header line written above the rendered block. Defaults to a
   *  generic "use this as grounding" instruction; callers wanting
   *  task-specific framing can override. */
  header?: string;
  /** Drop sections that have no content rather than emitting empty
   *  headers. Default true. */
  suppressEmpty?: boolean;
}
