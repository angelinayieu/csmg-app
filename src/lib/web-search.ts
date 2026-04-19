/**
 * Web Search Integration via Anthropic's native web_search tool.
 *
 * Architecture: Claude decides when to search based on confidence + reliability rules.
 * The research route calls Anthropic with web_search enabled; this module provides:
 *   1. Research depth → tool configuration mapping
 *   2. Response parsing (text blocks, tool_use blocks, search results, citations)
 *
 * Cost: $0.01 per search (Anthropic pricing). Controlled via max_uses per depth level.
 */

// ── Research depth configuration ──

export type ResearchDepth = "training" | "light" | "standard" | "deep";

export const DEPTH_CONFIG: Record<
  ResearchDepth,
  { maxUses: number; searchEnabled: boolean; label: string }
> = {
  training: { maxUses: 0, searchEnabled: false, label: "Training knowledge only" },
  light: { maxUses: 5, searchEnabled: true, label: "Light research (3-5 searches)" },
  standard: { maxUses: 10, searchEnabled: true, label: "Standard research (6-10 searches)" },
  deep: { maxUses: 20, searchEnabled: true, label: "Deep research (12-20 searches)" },
};

/**
 * Build the tools array for the Anthropic messages API.
 * Returns empty array for training-only depth (no web search).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getResearchTools(depth: ResearchDepth, maxUsesOverride?: number): any[] {
  const config = DEPTH_CONFIG[depth];
  if (!config.searchEnabled) return [];

  return [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: maxUsesOverride ?? config.maxUses,
    },
  ];
}

// ── Response parsing ──

export interface Citation {
  url: string;
  title: string;
  citedText: string;
}

export interface ParsedResearchResponse {
  /** Combined text output from all text blocks (contains the JSON) */
  jsonOutput: string;
  /** Number of web searches Claude actually performed */
  searchesPerformed: number;
  /** Map of search query → result URLs */
  sourceUrls: Map<string, string[]>;
  /** All citations from Claude's text blocks */
  citations: Citation[];
}

/**
 * Parse Anthropic's response content blocks into structured data.
 *
 * Claude's response contains interleaved blocks:
 *   - type: "text"                  → Claude's reasoning and JSON output
 *   - type: "server_tool_use"       → search query Claude chose
 *   - type: "web_search_tool_result" → search results with URLs
 *   - type: "text" with citations   → Claude's answer referencing sources
 *
 * This function extracts all text (for JSON parsing), counts searches,
 * collects URLs per query, and gathers citations with source URLs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseResearchResponse(content: any[]): ParsedResearchResponse {
  const textParts: string[] = [];
  let searchesPerformed = 0;
  const sourceUrls = new Map<string, string[]>();
  const citations: Citation[] = [];
  let lastQuery = "";

  for (const block of content) {
    // Text blocks — accumulate for JSON extraction
    if (block.type === "text") {
      textParts.push(block.text ?? "");

      // Extract citations if present
      if (Array.isArray(block.citations)) {
        for (const cite of block.citations) {
          if (cite.url) {
            citations.push({
              url: cite.url,
              title: cite.title ?? "",
              citedText: cite.cited_text ?? "",
            });
          }
        }
      }
    }

    // Server tool use — Claude initiated a web search
    if (block.type === "server_tool_use" && block.name === "web_search") {
      const query = block.input?.query ?? "";
      lastQuery = query;
      if (query && !sourceUrls.has(query)) {
        sourceUrls.set(query, []);
      }
    }

    // Web search results — collect URLs
    if (block.type === "web_search_tool_result") {
      searchesPerformed++;
      const resultContent = Array.isArray(block.content) ? block.content : [];
      for (const r of resultContent) {
        if (r.type === "web_search_result" && r.url) {
          const urls = sourceUrls.get(lastQuery) ?? [];
          urls.push(r.url);
          sourceUrls.set(lastQuery, urls);
        }
      }
    }
  }

  return {
    jsonOutput: textParts.join("\n"),
    searchesPerformed,
    sourceUrls,
    citations,
  };
}

/**
 * Extract JSON object from a string that may contain markdown fencing or
 * interleaved prose. Uses the same fallback chain as llm.ts:
 *   1. Direct JSON.parse of the entire string
 *   2. Extract from ```json ... ``` fence
 *   3. Find outermost { ... } boundaries
 */
export function extractJSON<T = unknown>(raw: string): T {
  // Try direct parse
  try {
    return JSON.parse(raw) as T;
  } catch {
    // continue
  }

  // Try markdown fence
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }

  // Try outermost braces
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1)) as T;
    } catch {
      // continue
    }
  }

  throw new Error(
    `Failed to extract JSON from response. Preview: ${raw.slice(0, 300)}`
  );
}

/**
 * Attempt to repair truncated JSON (e.g. from max_tokens cutoff).
 * Strategy: find the JSON start, then progressively try closing brackets/braces
 * at reasonable truncation points (after the last complete array element or object field).
 */
export function repairAndExtractJSON<T = unknown>(raw: string): T {
  // Find the JSON object start
  let jsonStr = raw;

  // Strip markdown fence opening if present
  const fenceStart = raw.indexOf("```json");
  if (fenceStart !== -1) {
    jsonStr = raw.slice(fenceStart + 7);
  } else {
    const fenceStart2 = raw.indexOf("```");
    if (fenceStart2 !== -1) {
      jsonStr = raw.slice(fenceStart2 + 3);
    }
  }

  // Find first {
  const objStart = jsonStr.indexOf("{");
  if (objStart === -1) {
    throw new Error(`No JSON object found in truncated response`);
  }
  jsonStr = jsonStr.slice(objStart);

  // Count open brackets/braces and try to close them
  // Find the last position that could be a valid truncation point
  // (after a comma, closing bracket/brace, or string value)
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  let lastGoodPos = 0;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{") closers.push("}");
    else if (ch === "[") closers.push("]");
    else if (ch === "}" || ch === "]") {
      closers.pop();
      lastGoodPos = i;
    } else if (ch === ",") {
      lastGoodPos = i;
    }
  }

  // If nothing needs closing, the JSON is complete
  if (closers.length === 0) {
    try { return JSON.parse(jsonStr) as T; } catch { /* fall through */ }
  }

  // Try closing at the last good position (trimming the incomplete element)
  // Find last complete element boundary
  const truncated = jsonStr.slice(0, lastGoodPos + 1);

  // Remove trailing comma if present
  const trimmed = truncated.replace(/,\s*$/, "");

  // Close all remaining open brackets/braces
  const suffix = closers.reverse().join("");
  const repaired = trimmed + suffix;

  try {
    const result = JSON.parse(repaired) as T;
    console.log(`[Research] Successfully repaired truncated JSON (${closers.length} brackets closed)`);
    return result;
  } catch {
    // Last resort: try closing from the very end of the string
    const lastResort = jsonStr.replace(/,\s*$/, "") + closers.join("");
    try {
      return JSON.parse(lastResort) as T;
    } catch {
      throw new Error(
        `Failed to repair truncated JSON. Preview: ${raw.slice(0, 300)}`
      );
    }
  }
}
