// ── Typed inspiration search ──────────────────────────────────────
//
// Thin wrapper around `searchTavily` that narrows results to a
// domain allowlist per inspiration *kind*. The Inspiration sidebar
// in the Objective Canvas drawer renders two adjacent rails —
// "Technical" (precedents, case studies, papers) and "Design"
// (UI patterns, interaction references) — and each one wants
// reference material from a different slice of the web.
//
// Reference: MECHANISM_EXPERIENCE_SPEC.md §4a.
//
// Coordination: this file does NOT modify `tavily-client.ts`; it
// only consumes the optional `includeDomains` param added there.
// Safe to ship alongside the parallel session's web-search fixes.

import {
  searchTavily,
  type SearchTavilyOpts,
  type TavilyBundle,
} from "./tavily-client";

export type InspirationCategory = "technical" | "design";

// Curated per-category allowlists. Picked for signal density, not
// breadth — Tavily already searches the open web by default, so
// narrowing here is what makes the rail feel categorically *right*.
// Add to these as we observe what users find useful.
const DOMAIN_ALLOWLIST: Record<InspirationCategory, string[]> = {
  technical: [
    "github.com",
    "arxiv.org",
    "ncbi.nlm.nih.gov",
    "nature.com",
    "science.org",
    "ieee.org",
    "acm.org",
    "stackoverflow.com",
    "huggingface.co",
    "developer.mozilla.org",
  ],
  design: [
    "mobbin.com",
    "dribbble.com",
    "ui.shadcn.com",
    "linear.app",
    "vercel.com",
    "ramp.com",
    "apple.com",
    "developer.apple.com",
    "figma.com",
    "behance.net",
    "lawsofux.com",
    "nngroup.com",
  ],
};

export interface SearchTavilyTypedOpts {
  category: InspirationCategory;
  query: string;
  maxResults?: number;
  depth?: SearchTavilyOpts["depth"];
}

/**
 * Run a Tavily query restricted to a category's domain allowlist.
 * Inherits soft-fail behavior from `searchTavily` — returns a
 * `failed: true` bundle on missing key, timeout, or HTTP error.
 */
export async function searchTavilyTyped(
  opts: SearchTavilyTypedOpts,
): Promise<TavilyBundle> {
  return searchTavily(opts.query, {
    depth: opts.depth ?? "basic",
    topic: "general",
    maxResults: opts.maxResults ?? 5,
    includeAnswer: false,
    includeDomains: DOMAIN_ALLOWLIST[opts.category],
  });
}

/**
 * Run both typed queries in parallel. Convenience for callers
 * (like the /item/research route) that need both rails populated.
 */
export async function searchTavilyTechnicalAndDesign(opts: {
  technicalQuery: string;
  designQuery: string;
  maxResultsPerRail?: number;
  depth?: SearchTavilyOpts["depth"];
}): Promise<{ technical: TavilyBundle; design: TavilyBundle }> {
  const [technical, design] = await Promise.all([
    searchTavilyTyped({
      category: "technical",
      query: opts.technicalQuery,
      maxResults: opts.maxResultsPerRail,
      depth: opts.depth,
    }),
    searchTavilyTyped({
      category: "design",
      query: opts.designQuery,
      maxResults: opts.maxResultsPerRail,
      depth: opts.depth,
    }),
  ]);
  return { technical, design };
}
