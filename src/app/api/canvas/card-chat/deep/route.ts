// POST /api/canvas/card-chat/deep
//
// Arc 5C.3. Stage 2 of the two-stage chat pipeline. Fires in background
// after Stage 1 when the fast endpoint flagged `should_enrich: true`.
//
// This endpoint:
//   1. Loads the space's axioms + insight_convergences + current
//      strategy_snapshot from synthesis_data
//   2. Returns EITHER:
//        - an enriched_response (plain text, deeper than Stage 1), OR
//        - a proposed_change (structured edit the user can Apply/Skip)
//
// Decision for proposed_change: the LLM returns this when the user's
// message expressed intent to *modify* the strategy. It's still LLM-
// guided, not hard-coded — the prompt explains the taxonomy of change
// kinds and asks the model to pick one if warranted.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const maxDuration = 45;

interface CardChatDeepRequest {
  spaceId: string;
  card: {
    shape_id: string;
    shape_type: string;
    primary_text: string;
    thread_ancestors?: Array<{ author: string | null; text: string; depth: number }>;
    tags?: string[];
  };
  user_message: string;
  stage1_response: string;
  prior_turns?: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface CardChatDeepResponse {
  kind: "enriched" | "proposed_change";
  enriched_response?: string;
  preamble?: string;
  proposal?: {
    change_type: "modify_perspective" | "add_tactic" | "remove_tactic" | "adjust_timeline" | "reprioritize" | "pivot";
    target: string;
    target_id?: string;
    current: string;
    proposed: string;
    reasoning: string;
    impact: "low" | "medium" | "high";
    urgency: "low" | "medium" | "high";
  };
}

const SYSTEM_PROMPT = `You are the deep-reasoning second pass of a two-stage AI partner on a knowledge canvas.

You already gave a fast response (Stage 1). Now you have access to the space's grounding layer: axioms, insight convergences, and the current strategy. Use them to go deeper than Stage 1 did.

Return strict JSON in ONE of these two shapes:

(A) Enriched answer — use when the user asked a question or wants deeper reasoning:
{
  "kind": "enriched",
  "enriched_response": "3-6 sentence answer that cites specific axioms or convergences by name where relevant, and goes beyond Stage 1's surface answer"
}

(B) Proposed change — use ONLY when the user expressed intent to MODIFY the strategy (not just discuss it):
{
  "kind": "proposed_change",
  "preamble": "one sentence explaining why this change follows from the user's request",
  "proposal": {
    "change_type": "modify_perspective" | "add_tactic" | "remove_tactic" | "adjust_timeline" | "reprioritize" | "pivot",
    "target": "human-readable label of what's being changed (e.g. a tactic title or perspective name)",
    "target_id": "(optional) stable id of the target if you can identify it",
    "current": "description of the current state",
    "proposed": "description of the new state",
    "reasoning": "why this change improves the strategy",
    "impact": "low" | "medium" | "high",
    "urgency": "low" | "medium" | "high"
  }
}

Rules:
- Prefer (A) when in doubt. A proposed_change is a commitment — only return one if the user explicitly wants to modify the strategy.
- Never include markdown fences, preamble, or commentary outside the JSON.
- target_id is optional — set it only if you can map the change to a specific tactic/perspective id from the provided strategy snapshot.`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<CardChatDeepRequest>(request);
  if (parseError) return parseError;

  const { spaceId, card, user_message, stage1_response, prior_turns = [] } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Pull axioms + convergences + the current strategy snapshot. We cap
  // what we inject so the prompt stays bounded.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  const sd = (spaceRow?.synthesis_data ?? null) as Record<string, unknown> | null;

  const axioms = Array.isArray(sd?.axioms) ? (sd.axioms as unknown[]).slice(0, 10) : [];
  const convergences = Array.isArray(sd?.insight_convergences)
    ? (sd.insight_convergences as unknown[]).slice(0, 6)
    : [];

  // Latest confirmed snapshot for strategy-edit context (lets the LLM
  // pick precise tactic/perspective ids when returning a proposed_change).
  const { data: latestSnapshot } = await db
    .from("strategy_snapshots")
    .select("id, recommendation")
    .eq("space_id", spaceId)
    .in("status", ["confirmed", "reviewing"])
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const strategySummary = (() => {
    if (!latestSnapshot?.recommendation) return "(no strategy yet)";
    const rec = latestSnapshot.recommendation as Record<string, unknown>;
    const tactics = Array.isArray(rec.micro_tactics) ? (rec.micro_tactics as unknown[]).slice(0, 8) : [];
    const perspectives = Array.isArray(rec.perspectives) ? (rec.perspectives as unknown[]).slice(0, 6) : [];
    const tacticLines = tactics.map((t, i) => {
      const tt = t as { id?: string; title?: string; action?: string };
      return `    ${i + 1}. [${tt.id ?? `t${i}`}] ${tt.title ?? tt.action ?? "(unlabelled)"}`;
    });
    const perspLines = perspectives.map((p, i) => {
      const pp = p as { id?: string; name?: string; rationale?: string };
      return `    ${i + 1}. [${pp.id ?? `p${i}`}] ${pp.name ?? "(unnamed)"}`;
    });
    return `Tactics:\n${tacticLines.join("\n") || "    (none)"}\n\nPerspectives:\n${perspLines.join("\n") || "    (none)"}`;
  })();

  const axiomLines =
    axioms.length > 0
      ? axioms
          .map((a, i) => {
            const ax = a as { id?: string; name?: string; statement?: string };
            return `  ${i + 1}. [${ax.id ?? `ax${i}`}] ${ax.name ?? "(unnamed)"} — ${(ax.statement ?? "").slice(0, 200)}`;
          })
          .join("\n")
      : "  (none)";

  const convergenceLines =
    convergences.length > 0
      ? convergences
          .map((c, i) => {
            const cv = c as { insight?: string; pattern?: string };
            return `  ${i + 1}. ${(cv.insight ?? cv.pattern ?? "").slice(0, 200)}`;
          })
          .join("\n")
      : "  (none)";

  const threadBlock =
    (card.thread_ancestors?.length ?? 0) > 0
      ? `Thread history:\n${card.thread_ancestors!
          .map((a, i) => `  ${a.depth === -1 ? "[root]" : a.author ?? `t${i + 1}`}: ${a.text.slice(0, 300)}`)
          .join("\n")}\n`
      : "";

  const priorBlock =
    prior_turns.length > 0
      ? `Prior chat turns:\n${prior_turns
          .map((t) => `  ${t.role === "user" ? "USER" : "YOU"}: ${t.text.slice(0, 300)}`)
          .join("\n")}\n`
      : "";

  const userPrompt = `Card type: ${card.shape_type}
${threadBlock}Card content:
"${card.primary_text.slice(0, 800)}"

${priorBlock}User's message: "${user_message.slice(0, 800)}"

Your Stage 1 reply (for continuity — don't repeat it verbatim):
"${stage1_response.slice(0, 800)}"

── Grounding context ──

Axioms:
${axiomLines}

Convergences:
${convergenceLines}

Current strategy:
${strategySummary}

Now return either the enriched answer or a proposed change, per the system prompt.`;

  try {
    const result = await llmJSON<CardChatDeepResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 1200,
      temperature: 0.5,
      fallback: { kind: "enriched", enriched_response: "" },
    });

    // Validate + narrow
    if (result.kind === "proposed_change" && result.proposal) {
      // Light guardrails on proposal shape
      const p = result.proposal;
      if (
        typeof p.change_type === "string" &&
        typeof p.target === "string" &&
        typeof p.proposed === "string"
      ) {
        return NextResponse.json({
          kind: "proposed_change",
          preamble: result.preamble ?? "I think this part of the strategy should change:",
          proposal: p,
        } satisfies CardChatDeepResponse);
      }
      // Malformed proposal — fall through to enriched.
    }

    return NextResponse.json({
      kind: "enriched",
      enriched_response:
        result.enriched_response && result.enriched_response.trim().length > 0
          ? result.enriched_response.trim()
          : stage1_response, // Fallback: don't overwrite with empty
    } satisfies CardChatDeepResponse);
  } catch (err) {
    console.warn("[canvas/card-chat/deep]", err);
    return NextResponse.json(
      { error: `Deep pass failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
