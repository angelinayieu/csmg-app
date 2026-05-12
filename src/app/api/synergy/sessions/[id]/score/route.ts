// ── POST /api/synergy/sessions/[id]/score ──
//
// Promise-score every node on the board against the stated objective.
// Returns the full ranked list and caches it in brainstorm_node_scores
// so the processing page doesn't re-spend an LLM call on every mount.
//
// Requires the session to have an objective_statement — without one
// the score has nothing to anchor to. Returns 412 (precondition) so
// the client knows to send the user to set the objective first.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  SCORE_PROMISE_SCHEMA,
  SCORE_PROMISE_SYSTEM,
} from "@/lib/synergy/process-prompts";

export const maxDuration = 45;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface DbNode {
  id: string;
  parent_id: string | null;
  kind: string;
  label: string;
  meta: string | null;
}

interface RawScore {
  node_id: string;
  score: number;
  why: string;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: session } = await db
    .from("brainstorm_sessions")
    .select("id, title, objective_statement, objective_constraints, objective_success_criteria")
    .eq("id", sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!session.objective_statement) {
    return NextResponse.json(
      {
        error: "Objective required — detect or set an objective before scoring",
        code: "objective_required",
      },
      { status: 412 },
    );
  }

  const { data: nodeRows } = await db
    .from("brainstorm_nodes")
    .select("id, parent_id, kind, label, meta")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  const nodes = (nodeRows ?? []) as DbNode[];
  const scoreable = nodes.filter(
    (n) => n.kind !== "user" && n.kind !== "ranking" && n.kind !== "core",
  );
  if (scoreable.length === 0) {
    return NextResponse.json({ scores: [] });
  }

  // Pre-compute child counts so we can include them in the score table
  // (the rabbit-holes UI surfaces "unexplored" badges from this).
  const childCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.parent_id) {
      childCount.set(n.parent_id, (childCount.get(n.parent_id) ?? 0) + 1);
    }
  }

  const nodeBlock = scoreable
    .map((n) => `id: ${n.id} | [${n.kind}] ${n.label}`)
    .join("\n");
  const userMsg = `Objective: ${session.objective_statement}
Constraints: ${(session.objective_constraints ?? []).join("; ") || "none"}
Success criteria: ${(session.objective_success_criteria ?? []).join("; ") || "none"}

Nodes to score:
${nodeBlock}`;

  let parsed: { scores: RawScore[] };
  try {
    parsed = await llmJSON<{ scores: RawScore[] }>({
      system: SCORE_PROMISE_SYSTEM,
      user: userMsg,
      maxTokens: 4096,
      temperature: 0.2,
      responseSchema: SCORE_PROMISE_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/.../score] LLM error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Only persist scores for nodes that actually exist (the LLM might
  // fabricate ids; defensive filter).
  const validIds = new Set(scoreable.map((n) => n.id));
  const cleaned = (parsed.scores ?? [])
    .filter((s) => validIds.has(s.node_id))
    .map((s) => ({
      session_id: sessionId,
      node_id: s.node_id,
      score: Math.max(0, Math.min(100, s.score)),
      why: s.why.trim().slice(0, 500),
      child_count: childCount.get(s.node_id) ?? 0,
    }));

  // upsert via delete-then-insert keyed on (session_id, node_id).
  // Single statement would be cleaner but Supabase's upsert helper
  // requires a unique constraint that matches the conflict_target,
  // which we have via the composite PK — so use it.
  const { error: upsertErr } = await db
    .from("brainstorm_node_scores")
    .upsert(cleaned, { onConflict: "session_id,node_id" });
  if (upsertErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(upsertErr) },
      { status: 500 },
    );
  }

  // Return enriched results — include the node label so the rabbit-holes
  // card can render without a follow-up join on the client side.
  const labelById = new Map(scoreable.map((n) => [n.id, n]));
  const enriched = cleaned
    .map((s) => {
      const node = labelById.get(s.node_id);
      return {
        node_id: s.node_id,
        score: s.score,
        why: s.why,
        child_count: s.child_count,
        label: node?.label ?? "",
        kind: node?.kind ?? "branch",
      };
    })
    .sort((a, b) => b.score - a.score);

  return NextResponse.json({ scores: enriched });
}
