// POST /api/spaces/[id]/rank-nodes
//
// The live alignment ranker behind the Goal sidebar. Fetches the space's
// ultimate goal (server-side), then ranks the board's nodes (sent by the
// client) by how they relate to it — each classified convergent (commits /
// narrows toward the goal) vs divergent (opens / explores away) with a 0-1
// score (importance × alignment × quality) and a short reason.
//
// Returns BOTH the goal (for the sidebar header) and the ranking, so the
// sidebar needs one call. Soft-fails: bad goal fetch → sensible fallback;
// empty/zero nodes → ranked: []. Nodes are referenced by index so the model
// never has to echo ids back.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON, detectCreditError, BEST_TUNABLE_CLAUDE_MODEL } from "@/lib/llm";

export const maxDuration = 45;

interface Ctx {
  params: Promise<{ id: string }>;
}

interface Body {
  nodes?: unknown;
}

export type RankDirection = "convergent" | "divergent";
export interface RankedNode {
  id: string;
  direction: RankDirection;
  score: number;
  reason: string;
}
export interface RankNodesResponse {
  goal: { title: string; description: string };
  ranked: RankedNode[];
}

const MAX_NODES = 40;

const RESPONSE_SCHEMA = {
  name: "node_ranking",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ranked: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            i: { type: "number" },
            direction: { type: "string", enum: ["convergent", "divergent"] },
            score: { type: "number" },
            reason: { type: "string" },
          },
          required: ["i", "direction", "score", "reason"],
        },
      },
    },
    required: ["ranked"],
  },
} as const;

export async function POST(req: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  // Client nodes: [{ id, text }] → bounded, de-duped on text.
  const rawNodes = Array.isArray(body.nodes) ? body.nodes : [];
  const nodes: { id: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const n of rawNodes) {
    if (!n || typeof n !== "object") continue;
    const id = (n as { id?: unknown }).id;
    const text = (n as { text?: unknown }).text;
    if (typeof id === "string" && typeof text === "string" && text.trim()) {
      const t = text.trim().slice(0, 220);
      if (!seen.has(t)) {
        seen.add(t);
        nodes.push({ id, text: t });
        if (nodes.length >= MAX_NODES) break;
      }
    }
  }

  // ── Fetch the goal server-side (soft-fail to a sensible fallback). ──
   
  const db = supabase as any;
  let goal = { title: "Your objective", description: "" };
  try {
    const { data: space } = await db
      .from("spaces")
      .select("name, description, input_text, primary_goal, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (space) {
       
      const ps = (space.synthesis_data as any)?.objective_canvas?.prompt_sharpening;
      goal = {
        title:
          ps?.distilled_title ||
          space.primary_goal ||
          space.name ||
          "Your objective",
        description: ps?.sharpened_prompt || space.description || space.input_text || "",
      };
    }
  } catch {
    /* fallback goal stands */
  }

  if (nodes.length === 0) {
    return NextResponse.json({ goal, ranked: [] } satisfies RankNodesResponse);
  }

  try {
    const result = await llmJSON({
      system:
        "You rank a whiteboard's nodes by how they relate to the user's GOAL. " +
        "For EACH node, by its index i, decide:\n" +
        "- direction: 'convergent' if it commits toward / narrows down to the goal, " +
        "'divergent' if it opens up / explores away from it.\n" +
        "- score: 0-1 combining importance × alignment-to-goal × quality (higher = " +
        "more central + better aligned + sharper).\n" +
        "- reason: a ≤10-word justification.\n" +
        "Return exactly one entry per node.",
      user:
        `GOAL: ${goal.title}\n${goal.description}\n\nNODES:\n` +
        nodes.map((n, i) => `[${i}] ${n.text}`).join("\n"),
      maxTokens: 1800,
      temperature: 0.3,
      provider: "anthropic",
      model: BEST_TUNABLE_CLAUDE_MODEL,
      responseSchema: RESPONSE_SCHEMA as unknown as {
        name: string;
        schema: Record<string, unknown>;
      },
    });

    const rawRanked = (result as {
      ranked?: Array<{ i?: number; direction?: string; score?: number; reason?: string }>;
    }).ranked ?? [];

    const ranked: RankedNode[] = rawRanked
      .map((r) => {
        const node = typeof r.i === "number" ? nodes[r.i] : undefined;
        if (!node) return null;
        return {
          id: node.id,
          direction: r.direction === "divergent" ? "divergent" : "convergent",
          score: typeof r.score === "number" ? Math.min(1, Math.max(0, r.score)) : 0.5,
          reason: typeof r.reason === "string" ? r.reason.trim() : "",
        } as RankedNode;
      })
      .filter((r): r is RankedNode => r !== null)
      .sort((a, b) => b.score - a.score);

    return NextResponse.json({ goal, ranked } satisfies RankNodesResponse);
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/spaces/[id]/rank-nodes] error:", err);
    // Soft-fail: still return the goal so the sidebar header renders.
    return NextResponse.json({ goal, ranked: [] } satisfies RankNodesResponse);
  }
}
