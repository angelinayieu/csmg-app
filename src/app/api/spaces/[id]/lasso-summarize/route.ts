// ── /api/spaces/[id]/lasso-summarize ───────────────────────────────
//
// POST → take a lasso-extracted set of canvas items and return a
//        compact AI summary (title + body) suitable for a
//        SummaryCardShape on the canvas.
//
// Inputs come from `extractShapeContent()` (lib/canvas/extract-shape-content.ts).
// We trust the client to do extraction because:
//   - the canvas is the source of truth for visible state
//   - re-deriving content server-side would require re-loading every
//     backend record the shapes reference (entity rows, snapshot
//     rows, etc.) — wasteful, since the shapes already cache it
//   - extraction is read-only; an attacker who lies about content
//     just gets back a summary based on lies, with no privilege
//     escalation
//
// We do still verify space ownership and rate-limit at the handler
// level (relying on existing safeAuth + verifySpaceOwnership). The
// summary itself is NOT persisted server-side at the moment — it
// lives in the SummaryCardShape's props, persisted via the existing
// canvas snapshot flow. (If this graduates to a feature with cross-
// session listing requirements, promote to a `lasso_summaries` table.)

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { llmGenerate, detectCreditError } from "@/lib/llm";
import { buildKgContext, renderKgContext } from "@/lib/kg-context";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface IncomingItem {
  shapeId: string;
  shapeType: string;
  backendId: string | null;
  backendKind: string | null;
  oneLiner: string;
  content: Record<string, unknown>;
}

interface IncomingBody {
  summaryId?: string;
  sourceLabel?: string;
  items?: IncomingItem[];
}

// Hard cap on items per request — keeps prompt size bounded so we
// don't OOM the LLM context on a runaway lasso. 80 covers the largest
// reasonable selection (e.g. lassoing an entire cascade row + its
// proxy indicators) by a wide margin.
const MAX_ITEMS = 80;
// Hard cap on per-item content payload bytes — defense against a
// rogue client stuffing huge JSON into one item to inflate prompt
// tokens.
const MAX_CONTENT_BYTES_PER_ITEM = 4_000;

const SYSTEM_PROMPT = `You are a research analyst summarizing a slice of a knowledge canvas.

The user has lasso-selected a set of canvas items — each item is one of:
entities, sticky notes, strategies, apps, claims, axioms, reactions, cycles,
bridges, signals, proposals, sources, files, threads, summaries, or other
domain shapes. You will receive each item's TYPE, its short ONE-LINER,
and a CONTENT object with the full props.

Produce a JSON object with two keys:
  - "title": ≤ 8 words. A specific noun phrase that names the synthesis,
    not the action. Good: "Frontend bottleneck on Apple Pay API". Bad:
    "Summary of selected items". Avoid the words "summary" or "selection".
  - "body": 2 to 4 short paragraphs (≤ 600 chars total). Plain prose. No
    bullet lists, no markdown headings. Surface the connective tissue —
    why these items go together, what tension or pattern they reveal,
    what the user is staring at. If the items contradict each other, say
    so. If a strategy appears alongside its supporting entities, name the
    strategy and what the entities corroborate. Use the items' own
    terminology; do not paraphrase domain words into generic ones.

Return ONLY the JSON object. No prose before or after.`;

function trimContent(content: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(content);
  if (json.length <= MAX_CONTENT_BYTES_PER_ITEM) return content;
  // Drop fields with the longest values until we fit. This is an
  // imperfect heuristic but better than truncating mid-string.
  const entries = Object.entries(content).map(([k, v]) => [
    k,
    v,
    JSON.stringify(v).length,
  ] as [string, unknown, number]);
  entries.sort((a, b) => b[2] - a[2]);
  const trimmed: Record<string, unknown> = {};
  let total = 0;
  for (const [k, v, size] of entries) {
    if (total + size > MAX_CONTENT_BYTES_PER_ITEM) {
      // Truncate string values; drop large objects/arrays
      if (typeof v === "string") {
        trimmed[k] = v.slice(0, Math.max(0, MAX_CONTENT_BYTES_PER_ITEM - total - 16)) + "…";
      }
      continue;
    }
    trimmed[k] = v;
    total += size;
  }
  return trimmed;
}

function buildUserPrompt(label: string, items: IncomingItem[]): string {
  const lines: string[] = [];
  lines.push(`Selection summary: ${label} (${items.length} items)`);
  lines.push("");
  lines.push("ITEMS:");
  for (const item of items) {
    const trimmed = trimContent(item.content);
    lines.push(
      `- TYPE=${item.shapeType}${item.backendKind ? ` KIND=${item.backendKind}` : ""}` +
        (item.backendId ? ` ID=${item.backendId}` : ""),
    );
    lines.push(`  ONE-LINER: ${item.oneLiner}`);
    lines.push(`  CONTENT: ${JSON.stringify(trimmed)}`);
  }
  lines.push("");
  lines.push(
    `Return JSON: { "title": "...", "body": "..." }. Title ≤ 8 words; body 2–4 short paragraphs ≤ 600 chars total.`,
  );
  return lines.join("\n");
}

function tryParseJsonResponse(raw: string): { title: string; body: string } | null {
  // Models occasionally wrap JSON in ```json fences or add a leading
  // sentence. Strip both before parsing.
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  // Look for the first { … last } if there's surrounding prose.
  const open = cleaned.indexOf("{");
  const close = cleaned.lastIndexOf("}");
  if (open >= 0 && close > open) cleaned = cleaned.slice(open, close + 1);

  try {
    const parsed = JSON.parse(cleaned) as { title?: unknown; body?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!title && !body) return null;
    return {
      title: title || "AI Summary",
      body: body || "(no body)",
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const parsed = await safeJsonParse<IncomingBody>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length < 2) {
    return NextResponse.json(
      { error: "Selection must include at least 2 items to summarize." },
      { status: 400 },
    );
  }
  const trimmedItems = items.slice(0, MAX_ITEMS);
  const sourceLabel = body.sourceLabel?.slice(0, 200) ?? "selection";

  // ── Phase 1: KG context construction ────────────────────────────
  // Collect any backendIds the lasso pulled out of canvas shapes —
  // entityId, snapshotId, etc. — and use them as the focus for the
  // KG fetcher. The context layer then pulls in 1-hop neighbors,
  // touched community summaries, load-bearing axioms, and convergent
  // concerns. The LLM gets to see the connective tissue around the
  // selection, not just the selected shapes.
  const focusEntityIds = trimmedItems
    .filter((it) => it.backendKind === "entity" && !!it.backendId)
    .map((it) => it.backendId as string);

  // Lexical query hint = the source label + a few one-liners. Drives
  // the lexical similarity scorer in the fetcher when picking primary
  // entities. A very rough proxy until pgvector lands.
  const queryHint =
    `${sourceLabel} | ` +
    trimmedItems
      .slice(0, 8)
      .map((it) => it.oneLiner)
      .join(" | ")
      .slice(0, 600);

  let kgGrounding = "";
  let kgTokenEstimate = 0;
  try {
    const kgCtx = await buildKgContext(supabase, {
      spaceId,
      mode: "summarize",
      query: queryHint,
      focusEntityIds,
    });
    kgGrounding = renderKgContext(kgCtx, {
      header:
        "## Surrounding knowledge graph (use as grounding for the synthesis below)",
    });
    kgTokenEstimate = kgCtx.estimatedTokens;
  } catch (err) {
    // Soft-fail: if the KG fetch errors, we'd rather summarize the
    // selection alone than 500 the whole request.
    console.warn("[lasso-summarize] KG context fetch failed:", err);
  }

  const selectionPrompt = buildUserPrompt(sourceLabel, trimmedItems);
  const userPrompt = kgGrounding
    ? `${kgGrounding}\n\n---\n\n${selectionPrompt}`
    : selectionPrompt;

  let raw: string;
  try {
    raw = await llmGenerate({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      // Anthropic Claude Sonnet handles synthesis/connective-tissue
      // prompts noticeably better than GPT-4o for this size of input.
      // Falls back to OpenAI if the Anthropic key isn't configured —
      // see llm.ts withRetry; if Anthropic 5xx's the caller sees a
      // 502 from us instead, which is fine for a manual user action.
      provider: "anthropic",
      maxTokens: 1024,
      temperature: 0.4,
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: `LLM credit exhausted (${credit.provider}): ${credit.message}` },
        { status: 402 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[lasso-summarize] llm call failed:", message);
    return NextResponse.json(
      { error: `LLM call failed: ${message.slice(0, 240)}` },
      { status: 502 },
    );
  }

  const parsed2 = tryParseJsonResponse(raw);
  if (!parsed2) {
    // Fallback: ship the raw output as the body so the user at least
    // sees something. Title becomes a generic placeholder.
    return NextResponse.json({
      title: `${trimmedItems.length}-item synthesis`,
      body: raw.slice(0, 1200) || "(empty response)",
      generatedAt: new Date().toISOString(),
      degraded: true,
      kg_grounding_tokens: kgTokenEstimate,
    });
  }

  return NextResponse.json({
    title: parsed2.title,
    body: parsed2.body,
    generatedAt: new Date().toISOString(),
    summaryId: body.summaryId ?? null,
    sourceCount: trimmedItems.length,
    // Phase 1 observability: how much KG grounding the model saw.
    // Future: surface this in the canvas HUD ("✦ +2.3k tokens of
    // graph context informed this summary").
    kg_grounding_tokens: kgTokenEstimate,
  });
}
