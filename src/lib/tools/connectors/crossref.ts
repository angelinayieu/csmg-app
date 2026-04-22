// ── Crossref connector ──
//
// Free, no-auth. Queries Crossref's REST API for scholarly works
// matching a natural-language query. Each hit carries DOI + title +
// author list + publish date + type. Authority defaults to
// "peer_reviewed" for journal-article / book-chapter types and
// "reference" for datasets / monographs. This is the highest-authority
// free source for academic provenance — when Stage-4 ranking weights
// evidence quality, Crossref hits should outweigh generic web matches.
//
// Crossref asks for a mailto header per their polite pool policy;
// we supply it if `CROSSREF_MAILTO` env is set, otherwise use a
// generic app identifier. No rate limit enforcement here — the v1
// registry is called infrequently from canvas-triggered lookups.

import type {
  ToolConnector,
  ToolInput,
  ToolResult,
  ToolHit,
  SourceAuthority,
} from "../types";

const ENDPOINT = "https://api.crossref.org/works";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

interface CrossrefResponse {
  status?: string;
  message?: {
    items?: Array<{
      DOI?: string;
      URL?: string;
      title?: string[];
      abstract?: string;
      type?: string;
      publisher?: string;
      author?: Array<{ given?: string; family?: string }>;
      issued?: { "date-parts"?: number[][] };
      published?: { "date-parts"?: number[][] };
      score?: number;
    }>;
  };
  message_version?: string;
}

const PEER_REVIEWED_TYPES = new Set([
  "journal-article",
  "proceedings-article",
  "book-chapter",
  "book",
  "review-article",
]);

export const crossrefConnector: ToolConnector = {
  id: "crossref",
  domain: "academic",
  label: "Crossref",
  description:
    "Academic DOI lookups with peer-reviewed authority signal. Free REST; returns title + authors + publish date + DOI.",
  requiresAuth: false,

  async call(input: ToolInput): Promise<ToolResult> {
    const started = Date.now();
    const limit = Math.min(input.maxResults ?? DEFAULT_LIMIT, MAX_LIMIT);
    const mailto = process.env.CROSSREF_MAILTO ?? "interaxis-app@noreply";

    const params = new URLSearchParams({
      query: input.query,
      rows: String(limit),
      sort: "score",
      order: "desc",
      mailto,
    });
    if (input.freshnessSince) {
      // Crossref accepts from-pub-date filter as YYYY, YYYY-MM, or YYYY-MM-DD.
      params.set("filter", `from-pub-date:${input.freshnessSince.slice(0, 10)}`);
    }

    try {
      const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": `interaxis/1.0 (mailto:${mailto})`,
        },
      });
      if (!res.ok) {
        return emptyResult(started, `Crossref HTTP ${res.status}`);
      }
      const body = (await res.json()) as CrossrefResponse;
      const items = body.message?.items ?? [];

      const hits: ToolHit[] = items.map((item) => {
        const title = (item.title ?? [])[0] ?? null;
        const doi = item.DOI ?? null;
        const permalink =
          item.URL ?? (doi ? `https://doi.org/${doi}` : "");
        const authors = (item.author ?? [])
          .map((a) => [a.given, a.family].filter(Boolean).join(" "))
          .filter((s) => s.length > 0);
        const publishedAt = resolvePublishedAt(item);
        const authority = authorityForType(item.type);
        // Crossref score is unbounded (0..∞). Normalize by dividing by
        // a plausible ceiling (60 ≈ strong match). Clamp to [0.1, 1].
        const rawScore = typeof item.score === "number" ? item.score : 0;
        const relevance = Math.max(0.1, Math.min(1, rawScore / 60));
        const snippetSource = item.abstract ?? (authors.length > 0 ? authors.join(", ") : null);

        return {
          url: permalink || `https://crossref.org/works/${doi ?? "unknown"}`,
          title,
          snippet: snippetSource?.slice(0, 400) ?? null,
          publishedAt,
          authority,
          relevance,
          metadata: {
            doi,
            type: item.type ?? null,
            publisher: item.publisher ?? null,
            authors,
          },
        };
      });

      return {
        toolId: "crossref",
        hits,
        error: null,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return emptyResult(
        started,
        err instanceof Error ? err.message : "Crossref fetch failed",
      );
    }
  },
};

function resolvePublishedAt(item: {
  issued?: { "date-parts"?: number[][] };
  published?: { "date-parts"?: number[][] };
}): string | null {
  const parts =
    item.issued?.["date-parts"]?.[0] ?? item.published?.["date-parts"]?.[0];
  if (!parts || parts.length === 0) return null;
  const [y, m = 1, d = 1] = parts;
  if (!y) return null;
  // Pad to ISO. Crossref sometimes gives year-only; we default to Jan 1.
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function authorityForType(type: string | undefined): SourceAuthority {
  if (!type) return "reference";
  if (PEER_REVIEWED_TYPES.has(type)) return "peer_reviewed";
  if (type.includes("dataset") || type.includes("report")) return "official";
  return "reference";
}

function emptyResult(started: number, error: string): ToolResult {
  return {
    toolId: "crossref",
    hits: [],
    error,
    durationMs: Date.now() - started,
  };
}
