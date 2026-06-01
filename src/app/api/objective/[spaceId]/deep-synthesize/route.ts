// ── POST /api/objective/[spaceId]/deep-synthesize ─────────────────
//
// The "pro Claude" power-move for the objective whiteboard. The user
// multi-selects a mix of post-it notes + free text + cards and presses
// "Deep Synthesize". Opus reads the WHOLE selection, uses web search to
// ground and extend the strongest threads, and returns a small MAP — one
// unifying hub insight + several web-grounded cross-links, each naming the
// exact selected items it draws on. The board forks that into a hub +
// branch cluster of proposed insight cards (see forkSynthesisMap).
//
// Heavier sibling of /connect (gpt-4o, one card, no search). Reuses the
// canonical research path — getAnthropicClient + the native web_search tool
// + the shared response parsers — and the same telemetry wrapper. NOT a
// parallel pipeline; the result lives on the board (snapshot-persisted),
// curated by the human via the hub's Keep/Dismiss.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { getAnthropicClient } from "@/lib/anthropic";
import {
  getResearchTools,
  parseResearchResponse,
  extractJSON,
  repairAndExtractJSON,
} from "@/lib/web-search";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";

export const runtime = "nodejs";
// Opus + several web searches runs long; lift the platform timeout where
// the host honors it (the SDK call carries its own 10-min ceiling).
export const maxDuration = 300;

// "Pro Claude" — the codebase's standard Opus id (also used by llm.ts
// MODEL_DEFAULTS.reasoning + expansion-recommendations). Bump to a newer
// Opus here if the key has access.
const OPUS_MODEL = "claude-opus-4-20250514";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface SelectionItem {
  /** Source kind, for the model's context (e.g. "sticky note", "card"). */
  kind?: string;
  text: string;
}

interface DeepSynthBody {
  selection?: SelectionItem[];
  objectiveTitle?: string;
}

interface RawCitation {
  title?: unknown;
  url?: unknown;
}
interface RawBranch {
  headline?: unknown;
  body?: unknown;
  sourceRefs?: unknown;
  citations?: unknown;
}
interface RawMap {
  hub?: { headline?: unknown; body?: unknown };
  branches?: unknown;
}

const KIND_LABEL: Record<string, string> = {
  note: "sticky note",
  text: "text",
  "artifact-card": "card",
  "room-card": "room",
  "insight-card": "insight",
};

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function selectionBlock(items: SelectionItem[]): string {
  return items
    .map((it, i) => {
      const label = it.kind ? `[${KIND_LABEL[it.kind] ?? it.kind}] ` : "";
      return `${i + 1}. ${label}${it.text.replace(/\s+/g, " ").trim()}`;
    })
    .join("\n");
}

/** Coerce the model's JSON into the strict map the board renders. Clamps
 *  sourceRefs to the real selection size and caps branch/citation counts. */
function normalizeMap(raw: RawMap, selectionCount: number) {
  const hub = {
    headline: str(raw.hub?.headline).trim() || "Synthesis",
    body: str(raw.hub?.body).trim(),
  };
  const branchesIn = Array.isArray(raw.branches)
    ? (raw.branches as RawBranch[])
    : [];
  const branches = branchesIn
    .map((b) => {
      const refs = Array.isArray(b.sourceRefs)
        ? Array.from(
            new Set(
              b.sourceRefs
                .map((r) => Number(r))
                .filter(
                  (r) => Number.isInteger(r) && r >= 1 && r <= selectionCount,
                ),
            ),
          )
        : [];
      const citationsIn = Array.isArray(b.citations)
        ? (b.citations as RawCitation[])
        : [];
      const citations = citationsIn
        .map((c) => ({ title: str(c.title).trim(), url: str(c.url).trim() }))
        .filter((c) => /^https?:\/\//.test(c.url))
        .slice(0, 3);
      return {
        headline: str(b.headline).trim(),
        body: str(b.body).trim(),
        sourceRefs: refs,
        citations,
      };
    })
    .filter((b) => b.headline || b.body)
    .slice(0, 6);
  return { hub, branches };
}

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }

  // Ownership — same explicit user_id check the other objective routes use.
  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: DeepSynthBody;
  try {
    body = (await req.json()) as DeepSynthBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const selection = Array.isArray(body.selection)
    ? body.selection
        .filter(
          (it): it is SelectionItem =>
            !!it && typeof it.text === "string" && it.text.trim().length > 0,
        )
        .slice(0, 24)
    : [];
  if (selection.length < 2) {
    return NextResponse.json(
      { error: "Select at least two items." },
      { status: 400 },
    );
  }

  const objective = str(body.objectiveTitle).trim();
  const system =
    "You are a systems strategist AND researcher helping a user find the non-obvious throughline across items on their strategy whiteboard (sticky notes, free text, and cards). " +
    "Do two things: (1) find the cross-links BETWEEN their items — how they reinforce, tension, gate, or feed each other; (2) use the web_search tool to GROUND and EXTEND the strongest threads with current, concrete external evidence (real examples, data points, prior art, named approaches). Search when external evidence would make a link sharper or more credible; rely on your own reasoning when it would not. " +
    "Be specific to THEIR content — never generic boilerplate. " +
    "Return ONLY a JSON object (no prose, no markdown fence) of exactly this shape: " +
    '{"hub":{"headline":string (the single unifying insight, 6 words or fewer),"body":string (1-2 sentences on the throughline and the practical so-what)},' +
    '"branches":[{"headline":string (one cross-link, <= 8 words),"body":string (1-2 concrete sentences),"sourceRefs":number[] (the 1-based numbers of the selected items this draws on),"citations":[{"title":string,"url":string}] (0-2 web sources you ACTUALLY used for this branch; omit if none)}]}. ' +
    "Produce 3-6 branches. Every branch must reference at least one source by its number. Only include a citation if you actually searched and used that page.";

  const user =
    (objective ? `Objective: ${objective}\n\n` : "") +
    `The user selected these items from their strategy whiteboard:\n\n${selectionBlock(
      selection,
    )}\n\n` +
    "Find the cross-links across them, research the strongest threads, and return the JSON map.";

  const anthropic = getAnthropicClient();
  const tools = getResearchTools("standard", 8);

  try {
    const { map, searchesPerformed } = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: "objective:deep_synthesize",
        modelHint: OPUS_MODEL,
        metadata: { sourceCount: selection.length },
      },
      async () => {
        const stream = anthropic.messages.stream(
          {
            model: OPUS_MODEL,
            max_tokens: 8000,
            tools,
            system,
            messages: [{ role: "user", content: user }],
          },
          { timeout: 10 * 60 * 1000 },
        );
        const final = await stream.finalMessage();
        const parsed = parseResearchResponse(final.content);
        let rawMap: RawMap;
        try {
          rawMap = extractJSON<RawMap>(parsed.jsonOutput);
        } catch {
          // Opus + long search results occasionally hit max_tokens mid-JSON.
          rawMap = repairAndExtractJSON<RawMap>(parsed.jsonOutput);
        }
        return {
          map: normalizeMap(rawMap, selection.length),
          searchesPerformed: parsed.searchesPerformed,
        };
      },
    );

    if (!map.branches.length) {
      return NextResponse.json(
        { error: "No synthesis produced." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      hub: map.hub,
      branches: map.branches,
      searchesPerformed,
    });
  } catch (err) {
    console.error("[objective/deep-synthesize] generation failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
