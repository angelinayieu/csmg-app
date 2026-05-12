// ── POST /api/synergy/sessions/[id]/autopilot/round ──
//
// One round of the autopilot loop. Picks the most-recently-created
// unexpanded leaf on the board (not 'user' speech nodes, not 'ranking'
// summaries) and generates 4 variations under it at the requested
// precision. Inserts the new variation rows directly so the row IDs
// are stable across the subsequent client-side auto-save PUT.
//
// The client orchestrates the multi-round loop (see useAutopilot).
// Keeping rounds atomic on the server means cancellation is immediate
// — the client just stops calling.
//
// Body: { precision?: 1-5 }
// Response: { expanded: { id, label }, new_nodes: BrainstormNode[] }
//
// Errors:
//   400 if precision out of range
//   404 if session not found / not owned
//   409 if every node already has children (signals "loop done" to client)
//   402 on provider credit exhaustion

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { schemaForMode, systemForMode } from "@/lib/synergy/prompts";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  precision?: unknown;
}

interface DbNode {
  id: string;
  parent_id: string | null;
  kind: string;
  label: string;
  meta: string | null;
  x: number;
  y: number;
  created_at: string;
}

interface InsertedNode extends DbNode {
  session_id: string;
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const precisionRaw = typeof body.precision === "number" ? body.precision : 3;
  const precision = Math.min(5, Math.max(1, Math.round(precisionRaw)));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // RLS will block reads from a session the user doesn't own; we still
  // check explicitly so we can return 404 instead of an empty array.
  const { data: session } = await db
    .from("brainstorm_sessions")
    .select("id")
    .eq("id", sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: nodeRows, error: nodesErr } = await db
    .from("brainstorm_nodes")
    .select("id, parent_id, kind, label, meta, x, y, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (nodesErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(nodesErr) },
      { status: 500 },
    );
  }
  const nodes = (nodeRows ?? []) as DbNode[];
  if (nodes.length === 0) {
    return NextResponse.json(
      { error: "Board is empty — add a core seed first" },
      { status: 409 },
    );
  }

  // Children count for eligibility check
  const childCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.parent_id) {
      childCount.set(n.parent_id, (childCount.get(n.parent_id) ?? 0) + 1);
    }
  }

  // Eligible = leaf nodes that aren't transient speech (`user`) or a
  // ranking summary. Iterate newest-first so we pick the user's freshest
  // unexpanded thread.
  const eligible = nodes
    .slice()
    .reverse()
    .filter(
      (n) =>
        (childCount.get(n.id) ?? 0) === 0 &&
        n.kind !== "user" &&
        n.kind !== "ranking",
    );
  if (eligible.length === 0) {
    return NextResponse.json(
      { error: "Nothing left to expand — every node already has children" },
      { status: 409 },
    );
  }
  const target = eligible[0];

  const parentNode = target.parent_id
    ? nodes.find((n) => n.id === target.parent_id)
    : undefined;
  const userMsg = parentNode
    ? `Existing context:\nparent: ${parentNode.label}\n\nNew thought:\n${target.label}`
    : target.label;
  const system = systemForMode("variations", precision);
  const schema = schemaForMode("variations");

  let parsed: { variations: Array<{ label: string; rationale: string }> };
  try {
    parsed = await llmJSON({
      system,
      user: userMsg,
      maxTokens: 1500,
      temperature: 0.7,
      responseSchema: schema as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/.../autopilot/round] LLM error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  const variations = (parsed.variations ?? [])
    .map((v) => ({ label: v.label.trim(), rationale: v.rationale.trim() }))
    .filter((v) => v.label.length > 0)
    .slice(0, 4);
  if (variations.length === 0) {
    return NextResponse.json(
      { error: "AI returned no usable variations" },
      { status: 502 },
    );
  }

  // Lay out around the target using the same spiral math as placeNear
  // (without the ring offsets — a single ring of 4 is the typical case).
  const radius = 160;
  const payload = variations.map((v, i) => {
    const angle = (i / variations.length) * 2 * Math.PI - Math.PI / 2;
    const jitterX = (Math.random() - 0.5) * 30;
    const jitterY = (Math.random() - 0.5) * 30;
    return {
      session_id: sessionId,
      parent_id: target.id,
      kind: "variation" as const,
      label: v.label,
      meta: `[Lv ${precision}] ${v.rationale}` || null,
      x: target.x + Math.cos(angle) * radius + jitterX,
      y: target.y + Math.sin(angle) * radius + jitterY,
    };
  });

  const { data: inserted, error: insertErr } = await db
    .from("brainstorm_nodes")
    .insert(payload)
    .select("id, session_id, parent_id, kind, label, meta, x, y, created_at");
  if (insertErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    expanded: { id: target.id, label: target.label },
    new_nodes: (inserted ?? []) as InsertedNode[],
  });
}
