// ── Wikidata connector ──
//
// Free, no-auth. Uses Wikidata's wbsearchentities action API to resolve
// a natural-language query into canonical entity candidates with QIDs.
// Each hit carries the Wikidata item URL + the item's English label +
// description. Authority fixed to "reference" — Wikidata is curated but
// crowd-sourced, not peer-reviewed.
//
// Why Wikidata for the v1 registry: every domain pipeline eventually
// needs canonical IDs to dedupe entities across runs + link to external
// knowledge graphs. Wikidata is the most-connected free source of such
// IDs. Upgrade path: swap in a SPARQL query when we need property
// chains / transitive relations.

import type {
  ToolConnector,
  ToolInput,
  ToolResult,
  ToolHit,
} from "../types";

const WBSEARCH_ENDPOINT = "https://www.wikidata.org/w/api.php";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

interface WbSearchResponse {
  search?: Array<{
    id: string; // Q-ID
    title: string;
    label?: string;
    description?: string;
    url?: string;
    concepturi?: string;
    match?: { type?: string; text?: string };
  }>;
  error?: { info?: string };
}

export const wikidataConnector: ToolConnector = {
  id: "wikidata",
  domain: "canonical_entity",
  label: "Wikidata",
  description:
    "Canonical entity resolution with QIDs. Free REST; returns label + description + permanent URL per match.",
  requiresAuth: false,

  async call(input: ToolInput): Promise<ToolResult> {
    const started = Date.now();
    const limit = Math.min(input.maxResults ?? DEFAULT_LIMIT, MAX_LIMIT);
    const params = new URLSearchParams({
      action: "wbsearchentities",
      format: "json",
      language: "en",
      uselang: "en",
      search: input.query,
      limit: String(limit),
      type: "item",
      origin: "*",
    });

    const url = `${WBSEARCH_ENDPOINT}?${params.toString()}`;

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        return emptyResult(
          started,
          `Wikidata HTTP ${res.status}`,
        );
      }
      const body = (await res.json()) as WbSearchResponse;
      if (body.error?.info) {
        return emptyResult(started, `Wikidata API: ${body.error.info}`);
      }

      const hits: ToolHit[] = (body.search ?? []).map((row, i) => {
        const qid = row.id;
        const permalink =
          row.concepturi ??
          row.url ??
          `https://www.wikidata.org/wiki/${qid}`;
        return {
          url: permalink,
          title: row.label ?? row.title ?? qid,
          snippet: row.description ?? null,
          publishedAt: null,
          authority: "reference",
          // Wikidata search doesn't expose a score; decay by rank so
          // the first hit reads as highest relevance.
          relevance: Math.max(0.2, 1 - i * 0.08),
          metadata: {
            qid,
            match: row.match ?? null,
          },
        };
      });

      return {
        toolId: "wikidata",
        hits,
        error: null,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return emptyResult(
        started,
        err instanceof Error ? err.message : "Wikidata fetch failed",
      );
    }
  },
};

function emptyResult(started: number, error: string): ToolResult {
  return {
    toolId: "wikidata",
    hits: [],
    error,
    durationMs: Date.now() - started,
  };
}
