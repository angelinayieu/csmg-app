// ── Research service ──────────────────────────────────────────────
//
// Orchestrates the two-pass research pipeline:
//
//   SURFACE pass — kicks off when the space is created. One broad
//   query. Latency-hidden by the clarifying-questions UI. Skipped
//   silently when the objective lacks enough domain signal.
//
//   DEEP pass — kicks off when the user completes the clarifying
//   loop. 3-5 LLM-generated lens queries derived from the
//   clarifying answers. Becomes the RAG context for decompose +
//   room generation + correlations.
//
// All persistence lives on the caller side; this module is pure
// orchestration + JSON shape contracts. Failure is a non-event —
// the bundle's `status` field tells the consumer how to render it.

import { llmJSON } from "@/lib/llm";
import { embedTexts } from "@/lib/embeddings";
import { cosine } from "@/lib/insight-lab/scoring/cosine";
import {
  searchTavilyMany,
  type TavilyBundle,
  type TavilySource,
} from "./tavily-client";

// ── Shapes persisted on `spaces.{surface,deep}_research` ─────────

export type ResearchStatus =
  | "pending"
  | "complete"
  | "skipped"
  | "error";

export interface ResearchSource {
  title: string;
  url: string;
  /** Concise snippet — kept short so the RAG context fits in token
   *  budget. Tavily content is trimmed to ~600 chars per source. */
  snippet: string;
  score: number;
  /** Lens tag — only present on deep pass sources. Lets the UI
   *  show "this came from a frameworks query" vs "metrics query". */
  lens?: ResearchLens;
}

export interface SurfaceBundle {
  status: ResearchStatus;
  /** ISO timestamps for telemetry. */
  started_at?: string;
  completed_at?: string;
  /** The single broad query that was issued. */
  query?: string;
  /** ≤500 char summary — used as the brief domain-context block
   *  in clarifying + decompose prompts. */
  summary?: string;
  sources: ResearchSource[];
  /** When status === "skipped", why we skipped. */
  skip_reason?: "no_api_key" | "insufficient_specificity" | "empty_objective";
}

export type ResearchLens =
  | "frameworks"
  | "precedents"
  | "mechanisms"
  | "failure_modes"
  | "metrics";

export interface DeepBundle {
  status: ResearchStatus;
  started_at?: string;
  completed_at?: string;
  /** Queries the LLM generated, keyed by lens. Audited. */
  queries?: Partial<Record<ResearchLens, string>>;
  /** Sources flattened from all lens queries, dedup'd by URL,
   *  sorted by score. Lens tag preserved on each. */
  all_sources: ResearchSource[];
  /** Optional sections — the per-lens grouping the UI can render. */
  by_lens?: Partial<Record<ResearchLens, ResearchSource[]>>;
}

// ── Specificity gate ─────────────────────────────────────────────

/**
 * Returns true when the objective has enough domain-signal nouns
 * to make a search query worth issuing. False objectives like
 * "make my app better" trip the gate and skip the surface pass.
 *
 * Heuristic: count rare-ish words (skip stopwords + ultra-common
 * words). ≥3 ⇒ search-worthy.
 */
export function isSearchWorthy(objective: string): boolean {
  const COMMON = new Set([
    "the","a","an","of","to","for","and","or","but","with","without","in","on",
    "at","by","from","up","down","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could","should","may",
    "might","must","shall","can","this","that","these","those","i","my","me",
    "we","our","us","you","your","they","their","them","it","its","make","get",
    "use","using","help","want","need","like","more","less","better","worse",
    "good","bad","app","tool","thing","things","way","ways","just","also",
    "people","user","users","new","best","through","across","when","what",
    "where","why","how","one","two","three","very","really","kind","sort",
  ]);
  const tokens = objective
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !COMMON.has(w));
  // Dedup so "search search search" doesn't pass.
  const unique = new Set(tokens);
  return unique.size >= 3;
}

// ── Source distillation ──────────────────────────────────────────

/** Trim Tavily's content snippets to fit the RAG token budget. */
function distill(
  bundle: TavilyBundle,
  lens?: ResearchLens,
  maxChars = 600,
): ResearchSource[] {
  return bundle.sources.map((s: TavilySource) => ({
    title: s.title,
    url: s.url,
    snippet: s.content.slice(0, maxChars),
    score: s.score,
    lens,
  }));
}

/** Dedup sources by URL across multiple bundles. */
function dedupByUrl(all: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  const out: ResearchSource[] = [];
  for (const s of all) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

// ── Surface pass ─────────────────────────────────────────────────

export interface SurfaceInput {
  objective: string;
}

export async function runSurfacePass(
  input: SurfaceInput,
): Promise<SurfaceBundle> {
  const started_at = new Date().toISOString();

  // Strip pasted-tool artifacts ("Open in Granola …") + boilerplate so
  // neither the query planner nor the relevance gate is polluted by noise.
  const objective = cleanObjectiveForSearch(input.objective);

  if (!objective.trim()) {
    return {
      status: "skipped",
      sources: [],
      skip_reason: "empty_objective",
      started_at,
      completed_at: new Date().toISOString(),
    };
  }
  if (!isSearchWorthy(objective)) {
    return {
      status: "skipped",
      sources: [],
      skip_reason: "insufficient_specificity",
      started_at,
      completed_at: new Date().toISOString(),
    };
  }

  // ── 1. Guided plan: 2-3 targeted queries (not a 300-char raw dump) ──
  // The planner reads the messy objective, finds the real subject, and
  // emits focused phrases. Soft-fails to a trimmed keyword query.
  let queries: string[] = [];
  try {
    queries = await generateSurfaceQueries(objective);
  } catch (err) {
    console.warn(
      "[research/surface] query planning failed, using fallback:",
      err instanceof Error ? err.message : err,
    );
  }
  if (queries.length === 0) {
    queries = [objective.split(/\s+/).slice(0, 14).join(" ")];
  }

  // ── 2. Search each plan query in parallel ──
  const bundles = await searchTavilyMany(queries, {
    depth: "basic",
    maxResults: 5,
    includeAnswer: true,
  });

  const raw = dedupByUrl(bundles.flatMap((b) => distill(b, undefined, 500)));

  if (raw.length === 0) {
    const allFailed = bundles.every((b) => b.failed);
    return {
      status: "skipped",
      sources: [],
      skip_reason: allFailed ? "no_api_key" : "insufficient_specificity",
      query: queries.join("  |  "),
      started_at,
      completed_at: new Date().toISOString(),
    };
  }

  // ── 3. Relevance gate — drop off-topic junk (jobs, novels, libs…) ──
  // Embedding cosine of each result vs the cleaned objective. Soft-fails
  // to the raw (deduped) list capped at 8 if embeddings are unavailable.
  let sources: ResearchSource[];
  try {
    sources = await filterSourcesByRelevance(objective, raw, {
      minCosine: 0.28,
      keepTop: 3,
      max: 8,
    });
  } catch (err) {
    console.warn(
      "[research/surface] relevance filter failed, returning unfiltered:",
      err instanceof Error ? err.message : err,
    );
    sources = raw.slice(0, 8);
  }

  return {
    status: "complete",
    query: queries.join("  |  "),
    summary: bundles.find((b) => b.answer)?.answer ?? undefined,
    sources,
    started_at,
    completed_at: new Date().toISOString(),
  };
}

// ── Surface-pass helpers ─────────────────────────────────────────

/** Strip known export-tool prefixes ("Open in Granola …") + collapse
 *  whitespace so search/embedding operate on the real objective. */
function cleanObjectiveForSearch(objective: string): string {
  return objective
    .replace(/^\s*open in\s+\w+\b[\s—–\-:|]*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

/** Generate 2-3 focused surface-overview queries from a messy objective.
 *  Mirrors the deep-pass planner but lighter (no clarifying answers,
 *  domain-overview intent). Returns trimmed, search-ready phrases. */
async function generateSurfaceQueries(objective: string): Promise<string[]> {
  const raw = await llmJSON<{ queries?: unknown }>({
    system: `You generate targeted web-search queries to research a project's PROBLEM SPACE for an initial overview. Given a messy project description, find the core subject and emit 2-3 specific queries.

RULES:
- Each query: one specific search phrase, ≤12 words, NOT a question.
- Together cover: (1) the domain / state-of-the-field, (2) how existing products or efforts approach it, (3) a key mechanism or metric if relevant.
- Reference the ACTUAL domain and concepts named — never generic ("best practices", "tips for", "guide to", "how to build").
- Ignore pasted-tool artifacts, UI boilerplate, or meta-instructions in the description.
- GOOD: "interest-based social feed ranking algorithms engagement signals"
- BAD: "how to build a social media app"

Return strict JSON: { "queries": string[] }.`,
    user: `PROJECT DESCRIPTION:\n"""\n${objective.slice(0, 1500)}\n"""\n\nGenerate 2-3 search queries.`,
    responseSchema: {
      name: "surface_research_queries",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          queries: { type: "array", items: { type: "string" } },
        },
        required: ["queries"],
      },
    },
    temperature: 0.3,
    maxTokens: 300,
  });
  const arr = Array.isArray(raw?.queries) ? raw.queries : [];
  return arr
    .map((q) => (typeof q === "string" ? q.trim() : ""))
    .filter((q) => q.length >= 6)
    .slice(0, 3);
}

/** Embedding-cosine relevance gate. Drops sources whose meaning is far
 *  from the objective (the jobs/novels/password-lib junk a broad query
 *  returns). Always keeps the top `keepTop` so a strict threshold never
 *  nukes the list to empty; caps at `max`. Sorted most-relevant first. */
async function filterSourcesByRelevance(
  objective: string,
  sources: ResearchSource[],
  opts: { minCosine?: number; keepTop?: number; max?: number } = {},
): Promise<ResearchSource[]> {
  const { minCosine = 0.28, keepTop = 3, max = 8 } = opts;
  if (sources.length === 0) return [];

  const texts = [
    objective.slice(0, 1500),
    ...sources.map((s) => `${s.title}. ${s.snippet.slice(0, 300)}`),
  ];
  const vectors = await embedTexts(texts);
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    return sources.slice(0, max);
  }
  const objVec = vectors[0];

  const scored = sources
    .map((s, i) => ({ source: s, rel: cosine(objVec, vectors[i + 1]) }))
    .sort((a, b) => b.rel - a.rel);

  const passing = scored.filter((x) => x.rel >= minCosine);
  const kept = passing.length >= keepTop ? passing : scored.slice(0, keepTop);
  return kept.slice(0, max).map((x) => x.source);
}

// ── Deep pass ────────────────────────────────────────────────────

export interface DeepInput {
  objective: string;
  /** Q&A from the clarifying loop (skipped items dropped by
   *  caller). Used to generate lens-specific queries. */
  clarifyingAnswers: Array<{ question: string; answer: string }>;
  /** Optional pre-existing surface bundle. When present, the LLM
   *  uses it as additional context for generating better deep
   *  queries (avoids restating what surface already covered). */
  surface?: SurfaceBundle;
}

interface QueryShape {
  frameworks?: string;
  precedents?: string;
  mechanisms?: string;
  failure_modes?: string;
  metrics?: string;
}

/**
 * Run the deep pass: 3-5 lens-specific queries in parallel, then
 * merge + dedup. Each lens targets a different kind of evidence
 * the downstream LLM calls need.
 */
export async function runDeepPass(input: DeepInput): Promise<DeepBundle> {
  const started_at = new Date().toISOString();

  // ── 1. Generate per-lens queries via the LLM ──
  // The LLM looks at the objective + clarifying answers and picks
  // the most useful specific queries to issue. Cheap (~$0.005).
  const clarifyingBlock = input.clarifyingAnswers
    .map((a, i) => `  ${i + 1}. ${a.question} → ${a.answer}`)
    .join("\n");

  const surfaceSummary =
    input.surface?.summary && input.surface.status === "complete"
      ? `\nSURFACE-PASS SUMMARY (broader context, don't restate):\n${input.surface.summary}\n`
      : "";

  const queries = await llmJSON<QueryShape>({
    system: `You generate targeted web search queries for a strategy room. The user is building or analyzing a project and we need 3-5 lens-specific queries to ground the AI's generation in real evidence.

Each lens probes a different kind of evidence:
  frameworks    — established mental models / methodologies / canonical decompositions of this problem
  precedents    — concrete case studies / prior attempts / "how X solved Y"
  mechanisms    — evidence base for specific levers (behavioral, structural, market) likely to be proposed
  failure_modes — documented traps / common reasons interventions in this space fail
  metrics       — KPIs / measurable signals practitioners use to track success in this domain

RULES:
- Each query is a single specific search phrase (≤14 words). NOT a question.
- Reference the user's actual domain, not generic terms.
- ≥3 lenses required, ≤5. Skip a lens (return empty string) if it doesn't apply to this objective.
- Avoid LLM-detectable hedges ("best practices", "tips for", "guide to"). Search for real things.
- BAD: "best practices for user engagement"
- GOOD: "habit loop frameworks behavioral economics product retention"

Return strict JSON with the lens keys.`,
    user: `OBJECTIVE:\n"""\n${input.objective.slice(0, 1500)}\n"""\n\nCLARIFYING ANSWERS:\n${clarifyingBlock || "  (none)"}\n${surfaceSummary}\nGenerate 3-5 lens-specific search queries.`,
    responseSchema: {
      name: "deep_research_queries",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          frameworks: { type: "string" },
          precedents: { type: "string" },
          mechanisms: { type: "string" },
          failure_modes: { type: "string" },
          metrics: { type: "string" },
        },
        required: [
          "frameworks",
          "precedents",
          "mechanisms",
          "failure_modes",
          "metrics",
        ],
      },
    },
    temperature: 0.3,
    maxTokens: 600,
  });

  // ── 2. Issue parallel searches ──
  const lensPairs: Array<{ lens: ResearchLens; q: string }> = [];
  for (const lens of [
    "frameworks",
    "precedents",
    "mechanisms",
    "failure_modes",
    "metrics",
  ] as const) {
    const q = (queries[lens] ?? "").trim();
    if (q.length >= 8) lensPairs.push({ lens, q });
  }

  if (lensPairs.length === 0) {
    return {
      status: "error",
      all_sources: [],
      started_at,
      completed_at: new Date().toISOString(),
    };
  }

  const bundles = await searchTavilyMany(
    lensPairs.map((p) => p.q),
    { depth: "advanced", maxResults: 6, includeAnswer: false },
  );

  // ── 3. Distill + tag by lens, dedup by URL ──
  const by_lens: Partial<Record<ResearchLens, ResearchSource[]>> = {};
  const merged: ResearchSource[] = [];
  for (let i = 0; i < bundles.length; i++) {
    const lens = lensPairs[i]!.lens;
    const distilled = distill(bundles[i]!, lens, 600);
    by_lens[lens] = distilled;
    merged.push(...distilled);
  }
  const all_sources = dedupByUrl(merged).sort((a, b) => b.score - a.score);

  const queriesOut: Partial<Record<ResearchLens, string>> = {};
  for (const p of lensPairs) queriesOut[p.lens] = p.q;

  // Any sources at all → complete. None → error (downstream skips).
  const status: ResearchStatus = all_sources.length > 0 ? "complete" : "error";

  return {
    status,
    queries: queriesOut,
    all_sources,
    by_lens,
    started_at,
    completed_at: new Date().toISOString(),
  };
}

// ── RAG context builder ──────────────────────────────────────────

/**
 * Returns the same dedup'd + ordered source list that
 * `buildRagBlock` renders, but as raw `ResearchSource[]`. Callers
 * use this to map LLM-emitted citation indices (1-based) into
 * actual `{ title, url, snippet, lens }` records for persistence
 * + UI rendering. The indices MUST match buildRagBlock's order
 * since both operate on the same dedup pipeline.
 */
export function collectRagSources(
  surface: SurfaceBundle | null,
  deep: DeepBundle | null,
  maxSources = 12,
): ResearchSource[] {
  const all: ResearchSource[] = [];
  if (deep?.status === "complete") all.push(...(deep.all_sources ?? []));
  if (surface?.status === "complete") all.push(...(surface.sources ?? []));
  return dedupByUrl(all).slice(0, maxSources);
}

/**
 * Render a `RESEARCH CONTEXT` block to prepend to downstream LLM
 * prompts. Pulls from surface + deep, dedups, respects token
 * budget. Returns "" when no useful research exists — caller's
 * prompt continues unchanged.
 */
export function buildRagBlock(
  surface: SurfaceBundle | null,
  deep: DeepBundle | null,
  opts: { maxSources?: number; maxCharsPerSnippet?: number } = {},
): string {
  const maxSources = opts.maxSources ?? 12;
  const maxChars = opts.maxCharsPerSnippet ?? 500;

  const surfaceComplete = surface?.status === "complete";
  const deepComplete = deep?.status === "complete";

  if (!surfaceComplete && !deepComplete) return "";

  const lines: string[] = [];
  lines.push("RESEARCH CONTEXT (real-world sources — cite where applicable):");

  if (surfaceComplete && surface?.summary) {
    lines.push("");
    lines.push("Domain summary:");
    lines.push(`  ${surface.summary.slice(0, 600)}`);
  }

  // Collect + dedup sources from both passes; preserve lens tag.
  const all: ResearchSource[] = [];
  if (deepComplete) all.push(...(deep?.all_sources ?? []));
  if (surfaceComplete) all.push(...(surface?.sources ?? []));
  const deduped = dedupByUrl(all).slice(0, maxSources);

  if (deduped.length > 0) {
    lines.push("");
    lines.push("Sources:");
    deduped.forEach((s, i) => {
      const lensTag = s.lens ? `[${s.lens}] ` : "";
      lines.push(
        `  [${i + 1}] ${lensTag}${s.title}\n      ${s.url}\n      ${s.snippet.slice(0, maxChars)}`,
      );
    });
  }

  lines.push("");
  lines.push(
    "Use these sources to ground claims where possible. When a claim has source support, cite [N] inline. First-principles reasoning is acceptable when no source applies — don't invent citations.",
  );

  return lines.join("\n");
}
