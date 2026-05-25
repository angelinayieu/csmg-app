// ── Tavily client ──────────────────────────────────────────────────
//
// Thin wrapper around Tavily's search API. Picked Tavily over OpenAI
// web tool / Brave / Perplexity for three reasons:
//
//   1. Purpose-built for AI agents — returns LLM-ready summaries +
//      structured metadata (no scraping needed downstream).
//   2. Predictable cost: $5 / 1k requests at the basic depth.
//   3. Fast: 1-3s per query, low jitter — important because we run
//      these in the background while the user is busy in the UI.
//
// API contract: TAVILY_API_KEY env var. Missing key → returns an
// empty bundle (caller falls through to LLM-only generation per the
// "skip silently on weak results" policy). Never throws on missing
// auth — the rest of the pipeline must continue.

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 12_000;

export interface TavilySource {
  /** Title of the result page. */
  title: string;
  /** URL — always present. */
  url: string;
  /** LLM-ready snippet. Tavily already extracts the relevant
   *  passage; we don't need to re-fetch the page. */
  content: string;
  /** Tavily's relevance score [0,1]. Useful as a soft confidence
   *  signal but not the only filter — we also threshold on
   *  content length below. */
  score: number;
  /** Optional ISO date string if Tavily extracted one. */
  published_date?: string | null;
}

export interface TavilyBundle {
  /** The query that was issued — kept verbatim for audit. */
  query: string;
  /** Concise (≤500 char) LLM-generated answer if Tavily produces
   *  one. Useful as a fallback summary but we generally prefer
   *  the per-source content snippets for RAG. */
  answer: string | null;
  /** Sorted by score descending. Empty array on error / no auth. */
  sources: TavilySource[];
  /** True when the call failed for any reason (network, auth,
   *  timeout). Caller decides whether to retry or skip silently. */
  failed: boolean;
  /** Wall-clock ms — for telemetry and the future "research cost"
   *  panel we'll surface to power users. */
  ms: number;
}

export interface SearchTavilyOpts {
  /** "basic" ≈ $0.005 / request, 5-8 sources. "advanced" ≈ $0.025,
   *  10-15 sources + deeper extraction. Default basic for surface
   *  pass; deep pass uses advanced. */
  depth?: "basic" | "advanced";
  /** Tavily upper limit is 20. Default 8 for basic, 15 for advanced. */
  maxResults?: number;
  /** Set to true to include Tavily's LLM-generated answer in the
   *  bundle. Adds ~300ms. We turn this on for surface pass (need
   *  the summary) and off for deep pass (sources only). */
  includeAnswer?: boolean;
  /** Topic hint — "general" | "news". Default general. */
  topic?: "general" | "news";
}

/**
 * Issue a single Tavily query. Wrapped in a timeout so a slow API
 * doesn't block the room generation pipeline indefinitely.
 *
 * Honest about failure: returns failed=true with empty sources
 * instead of throwing. Callers check the flag and either retry
 * (deep pass) or skip (surface pass).
 */
export async function searchTavily(
  query: string,
  opts: SearchTavilyOpts = {},
): Promise<TavilyBundle> {
  const started = Date.now();
  const apiKey = process.env.TAVILY_API_KEY;

  // Missing key — log once, return empty. Don't crash the pipeline.
  if (!apiKey) {
    console.warn("[tavily] TAVILY_API_KEY not set — returning empty bundle");
    return {
      query,
      answer: null,
      sources: [],
      failed: true,
      ms: 0,
    };
  }

  const depth = opts.depth ?? "basic";
  const maxResults =
    opts.maxResults ?? (depth === "advanced" ? 15 : 8);
  const includeAnswer = opts.includeAnswer ?? false;
  const topic = opts.topic ?? "general";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: depth,
        max_results: maxResults,
        include_answer: includeAnswer,
        topic,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);

    if (!res.ok) {
      console.warn(
        `[tavily] ${res.status} ${res.statusText} for query "${query.slice(0, 60)}…"`,
      );
      return {
        query,
        answer: null,
        sources: [],
        failed: true,
        ms: Date.now() - started,
      };
    }

    const json = (await res.json()) as {
      answer?: string;
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
        published_date?: string | null;
      }>;
    };

    const sources: TavilySource[] = ((json.results ?? []) as Array<{
      title?: string;
      url?: string;
      content?: string;
      score?: number;
      published_date?: string | null;
    }>)
      .filter((r) => typeof r.url === "string" && (r.content ?? "").length > 80)
      .map((r) => ({
        title: typeof r.title === "string" ? r.title.trim() : r.url ?? "",
        url: r.url as string,
        content: (r.content ?? "").trim(),
        score: typeof r.score === "number" ? r.score : 0,
        published_date: r.published_date ?? null,
      }))
      .sort((a, b) => b.score - a.score);

    return {
      query,
      answer: typeof json.answer === "string" ? json.answer.trim() : null,
      sources,
      failed: false,
      ms: Date.now() - started,
    };
  } catch (err) {
    clearTimeout(t);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    console.warn(
      `[tavily] ${isAbort ? "timeout" : "error"} for query "${query.slice(0, 60)}…":`,
      err instanceof Error ? err.message : err,
    );
    return {
      query,
      answer: null,
      sources: [],
      failed: true,
      ms: Date.now() - started,
    };
  }
}

/**
 * Run multiple queries in parallel. Use for the deep pass — we
 * issue 3-5 lens-specific queries at once and merge. Returns one
 * bundle per query in input order.
 */
export async function searchTavilyMany(
  queries: string[],
  opts: SearchTavilyOpts = {},
): Promise<TavilyBundle[]> {
  return Promise.all(queries.map((q) => searchTavily(q, opts)));
}
