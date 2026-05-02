// POST /api/canvas/card-web-search
//
// Arc 5B.5. Card-focused web search. Opt-in — the sidecar does NOT auto-
// fire this on shape selection because each search costs $0.01 per
// Anthropic docs. User must explicitly click "Search the web" in the Web
// tab.
//
// The card's primary_text + thread ancestors form the search intent. We
// let Claude decide the specific query (it's often smarter than we are
// at turning a raw thought into a good search string). Returns parsed
// results with URLs + citations.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { getAnthropicClient } from "@/lib/anthropic";
import {
  getResearchTools,
  parseResearchResponse,
  extractJSON,
  type Citation,
} from "@/lib/web-search";
import { buildKgContext, renderKgContext } from "@/lib/kg-context";

export const maxDuration = 60;

interface CardWebSearchRequest {
  spaceId: string;
  shape_id: string;
  primary_text: string;
  thread_ancestors?: Array<{ author: string | null; text: string; depth: number }>;
}

export interface CardWebSearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string | null;
}

export interface CardWebSearchResponse {
  results: CardWebSearchResult[];
  searches_performed: number;
  summary: string;
}

/** Structured output we ask Claude to return alongside the searches. */
interface ClaudeWebOutput {
  summary: string;
  highlights: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}

const SYSTEM_PROMPT = `You are a research companion sitting beside a knowledge canvas.

The user has selected a card and asked you to search the web for relevant context. You have access to a web_search tool — use it 2-4 times with focused queries that target the specific claim or question in the card.

After searching, summarise what you found in 2 sentences, then return the 3-5 most relevant sources you cited. Prefer authoritative or recent sources.

Return strict JSON in this exact shape:
{
  "summary": "2-sentence synthesis of what the web says that the user didn't already know",
  "highlights": [
    { "title": "...", "url": "...", "snippet": "50-80 word excerpt of the most useful content" }
  ]
}

Do NOT add preamble, reasoning, or markdown fences around the JSON.`;

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<CardWebSearchRequest>(request);
  if (parseError) return parseError;

  const { spaceId, primary_text, thread_ancestors = [] } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  if (typeof primary_text !== "string" || primary_text.trim().length < 3) {
    return NextResponse.json(
      { error: "primary_text too short to search" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Web search unavailable (missing ANTHROPIC_API_KEY)" },
      { status: 503 },
    );
  }

  const ancestorBlock =
    thread_ancestors.length > 0
      ? `Conversation history:\n${thread_ancestors
          .map((a, i) => `  Turn ${i + 1}: ${a.text.slice(0, 300)}`)
          .join("\n")}`
      : "";

  // ── Phase 1: KG context (broad mode, query=card text) ──────────
  // Web search currently sees only the card's own text + a few
  // ancestors. By prepending KG grounding we let Claude know what's
  // already in the user's space — so it doesn't search for things
  // the canvas already answers, and so its searches target the
  // gaps. Soft-fails: a web search without KG context is still
  // useful, we just don't want to 500 the request.
  let kgGrounding = "";
  try {
    const kgCtx = await buildKgContext(supabase, {
      spaceId,
      mode: "broad",
      query: primary_text,
    });
    kgGrounding = renderKgContext(kgCtx, {
      header:
        "## What the user's knowledge graph already knows (target your searches at the gaps)",
    });
  } catch (err) {
    console.warn("[card-web-search] KG context fetch failed:", err);
  }

  const userMessage = `${kgGrounding ? `${kgGrounding}\n\n---\n\n` : ""}${ancestorBlock}

Card content:
"${primary_text.slice(0, 1500)}"

Search the web for context that would help the user think more rigorously about this. Return the structured JSON output described in the system prompt.`;

  try {
    const anthropic = getAnthropicClient();
    const tools = getResearchTools("light", 4); // cap at 4 searches per call

    const stream = anthropic.messages.stream(
      {
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        max_tokens: 3000,
        tools,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      },
      { timeout: 55 * 1000 },
    );
    const response = await stream.finalMessage();
    const parsed = parseResearchResponse(response.content);

    let structured: ClaudeWebOutput;
    try {
      structured = extractJSON<ClaudeWebOutput>(parsed.jsonOutput);
    } catch {
      // Fallback: surface citations directly even if the structured JSON
      // didn't parse (the user still wants URLs, not nothing).
      structured = {
        summary: parsed.jsonOutput.slice(0, 400),
        highlights: [],
      };
    }

    // Merge structured highlights with citations so we always return URLs
    // when Claude's JSON was incomplete but searches did land.
    const results: CardWebSearchResult[] = [];
    const seenUrls = new Set<string>();

    for (const h of structured.highlights ?? []) {
      if (!h.url || seenUrls.has(h.url)) continue;
      seenUrls.add(h.url);
      results.push({
        title: h.title || extractDomain(h.url) || "Untitled",
        url: h.url,
        snippet: h.snippet || "",
        domain: extractDomain(h.url),
      });
    }
    // If highlights was empty, synthesise from raw citations.
    if (results.length === 0) {
      const uniqueCitations: Citation[] = [];
      for (const c of parsed.citations) {
        if (!c.url || seenUrls.has(c.url)) continue;
        seenUrls.add(c.url);
        uniqueCitations.push(c);
        if (uniqueCitations.length >= 5) break;
      }
      for (const c of uniqueCitations) {
        results.push({
          title: c.title || extractDomain(c.url) || "Untitled",
          url: c.url,
          snippet: c.citedText.slice(0, 240),
          domain: extractDomain(c.url),
        });
      }
    }

    const payload: CardWebSearchResponse = {
      results: results.slice(0, 5),
      searches_performed: parsed.searchesPerformed,
      summary: structured.summary ?? "",
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.warn("[canvas/card-web-search]", err);
    return NextResponse.json(
      { error: `Web search failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
