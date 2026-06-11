import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON, BEST_CLAUDE_MODEL, detectCreditError } from "@/lib/llm";
import { inventoryBlock, type KgCollection, type KgNode } from "@/lib/trove/kg";

// Trove map-chat — "talk to the agent through the whiteboard".
//
// The user types into the dock on /trove/map; the agent answers AND returns a
// board plan — which nodes to show and in which visualization form — that the
// client renders onto the tldraw canvas:
//   clusters: grouped islands (default overview)
//   flow:     left→right causal/sequence chain
//   radial:   mind-map around a center node
// links[] adds labeled arrows on top of any mode.

export const maxDuration = 90;

interface Body {
  message?: unknown;
  history?: unknown; // [{role:'user'|'agent', body:string}]
}

const MAP_SCHEMA = {
  name: "trove_map_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: {
        type: "string",
        description: "Conversational answer to the user (2-4 sentences). Reference what you drew.",
      },
      board: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["clusters", "flow", "radial"] },
          title: { type: "string", description: "Short board headline" },
          groups: {
            type: "array",
            description:
              "clusters: one group per island. radial: groups[0].node_ids[0] is the center, remaining groups are spokes. flow: leave empty.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                hue: { type: "integer", description: "0-359" },
                node_ids: { type: "array", items: { type: "string" } },
              },
              required: ["label", "hue", "node_ids"],
            },
          },
          sequence: {
            type: "array",
            items: { type: "string" },
            description: "flow mode only: node ids in causal/temporal order (else empty)",
          },
          links: {
            type: "array",
            description: "Labeled arrows to draw between shown nodes",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                source_id: { type: "string" },
                target_id: { type: "string" },
                label: { type: "string" },
              },
              required: ["source_id", "target_id", "label"],
            },
          },
        },
        required: ["mode", "title", "groups", "sequence", "links"],
      },
    },
    required: ["reply", "board"],
  },
} as const;

export interface MapPlan {
  reply: string;
  board: {
    mode: "clusters" | "flow" | "radial";
    title: string;
    groups: Array<{ label: string; hue: number; node_ids: string[] }>;
    sequence: string[];
    links: Array<{ source_id: string; target_id: string; label: string }>;
  };
}

export async function POST(request: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const parsed = await safeJsonParse<Body>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (!message) return NextResponse.json({ error: "Say something first" }, { status: 400 });

  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role?: string; body?: string }>)
        .filter((m) => typeof m?.body === "string")
        .slice(-8)
    : [];

  const [{ data: nodes }, { data: collections }, { data: edges }] = await Promise.all([
    db
      .from("kg_nodes")
      .select("id, title, kind, causal_role, depth, collection_id")
      .eq("user_id", user.id)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(140),
    db.from("kg_collections").select("id, name, parent_id").eq("user_id", user.id).limit(300),
    db
      .from("kg_edges")
      .select("source_id, target_id, relation, label")
      .eq("user_id", user.id)
      .limit(400),
  ]);

  if (!nodes?.length) {
    return NextResponse.json({
      reply:
        "Your trove is empty so there's nothing to draw yet — add anything in the Library tab (paste text, a link, or an image) or run Sync to pull in your boards, then ask me again.",
      board: { mode: "clusters", title: "Nothing to draw yet", groups: [], sequence: [], links: [] },
    } satisfies MapPlan);
  }

  const edgeLines = (edges ?? [])
    .map((e) => `${e.source_id} -[${e.label || e.relation}]-> ${e.target_id}`)
    .join("\n");

  try {
    const result = await llmJSON<MapPlan>({
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 5000,
      system:
        "You are the whiteboard agent of a personal knowledge graph. The user talks to you " +
        "THROUGH the canvas: every answer comes with a board plan the client draws.\n" +
        "- Choose the visualization form that fits the ask: clusters (themes/overview), " +
        "flow (cause→effect or sequence — fill `sequence` in order), radial (everything " +
        "around one focus — groups[0].node_ids[0] is the center).\n" +
        "- Use ONLY node ids from the inventory. 6-24 nodes; pick the ones that matter, not everything.\n" +
        "- Add labeled `links` for the relationships worth seeing (use real edges below; you " +
        "may add a few NEW insightful links the user hasn't drawn yet — label them clearly).\n" +
        "- The reply should read like a sharp thinking partner, not a UI narration.",
      user:
        `MY KNOWLEDGE NODES:\n${inventoryBlock(nodes as KgNode[], (collections ?? []) as KgCollection[])}\n\n` +
        `EXISTING EDGES:\n${edgeLines || "(none yet)"}\n\n` +
        (history.length
          ? `RECENT CONVERSATION:\n${history.map((m) => `${m.role === "agent" ? "You" : "Me"}: ${m.body}`).join("\n")}\n\n`
          : "") +
        `ME, NOW: ${message}`,
      responseSchema: {
        name: MAP_SCHEMA.name,
        schema: MAP_SCHEMA.schema as unknown as Record<string, unknown>,
      },
    });

    // Drop hallucinated ids so the client never draws a ghost shape.
    const valid = new Set((nodes as Array<{ id: string }>).map((n) => n.id));
    result.board.groups = (result.board.groups ?? [])
      .map((g) => ({ ...g, node_ids: (g.node_ids ?? []).filter((id) => valid.has(id)) }))
      .filter((g) => g.node_ids.length);
    result.board.sequence = (result.board.sequence ?? []).filter((id) => valid.has(id));
    result.board.links = (result.board.links ?? []).filter(
      (l) => valid.has(l.source_id) && valid.has(l.target_id),
    );

    // Hydrate the shown nodes so the client doesn't need a second fetch.
    const shownIds = new Set<string>([
      ...result.board.groups.flatMap((g) => g.node_ids),
      ...result.board.sequence,
    ]);
    const { data: shown } = await db
      .from("kg_nodes")
      .select("id, title, summary, kind, causal_role, depth, hue, media_url, collection_id")
      .in("id", [...shownIds].slice(0, 60));

    return NextResponse.json({ ...result, nodes: shown ?? [] });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json({ error: credit.message, credit: true }, { status: 402 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Map agent failed" },
      { status: 500 },
    );
  }
}
