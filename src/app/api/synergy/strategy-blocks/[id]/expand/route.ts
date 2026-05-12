// ── POST /api/synergy/strategy-blocks/[id]/expand ──
//
// Block-level "Expand" op. Dispatches by block_type:
//   plan_step  → returns 2-4 sub_steps; stored in meta.sub_steps
//   hypothesis → returns 2-3 supporting_rationales; stored in meta
//
// Other block types return 400 ("expand isn't defined for this kind").

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  EXPAND_HYPOTHESIS_SCHEMA,
  EXPAND_HYPOTHESIS_SYSTEM,
  EXPAND_PLAN_STEP_SCHEMA,
  EXPAND_PLAN_STEP_SYSTEM,
} from "@/lib/synergy/strategy-ops-prompts";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: block, error: loadErr } = await db
    .from("synergy_strategy_blocks")
    .select("id, block_type, body, meta")
    .eq("id", id)
    .single();
  if (loadErr || !block) {
    return NextResponse.json({ error: "Block not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (block.meta ?? {}) as Record<string, any>;

  if (block.block_type === "plan_step") {
    const userMsg = `Plan step:
Title: ${meta.title ?? "(no title)"}
Detail: ${block.body}`;

    try {
      const parsed = await llmJSON<{
        sub_steps: Array<{ title: string; detail: string }>;
      }>({
        system: EXPAND_PLAN_STEP_SYSTEM,
        user: userMsg,
        maxTokens: 800,
        temperature: 0.5,
        responseSchema: EXPAND_PLAN_STEP_SCHEMA as {
          name: string;
          schema: Record<string, unknown>;
        },
      });

      const subSteps = (parsed.sub_steps ?? [])
        .map((s) => ({
          title: s.title.trim().slice(0, 160),
          detail: s.detail.trim().slice(0, 400),
        }))
        .filter((s) => s.title.length > 0)
        .slice(0, 4);
      if (subSteps.length === 0) {
        return NextResponse.json({ error: "No sub-steps returned" }, { status: 502 });
      }

      // Append to existing sub_steps (preserve prior expansions);
      // user can undo via inline edit (3.5e+ — for now they replace).
      const newMeta = { ...meta, sub_steps: subSteps };
      const { data: updated, error: updateErr } = await db
        .from("synergy_strategy_blocks")
        .update({ meta: newMeta })
        .eq("id", id)
        .select("id, block_type, body, sort_order, meta, created_at")
        .single();
      if (updateErr || !updated) {
        return NextResponse.json(
          { error: sanitizeErrorMessage(updateErr) },
          { status: 500 },
        );
      }
      return NextResponse.json({ block: updated });
    } catch (err) {
      return handleLlmError(err);
    }
  }

  if (block.block_type === "hypothesis") {
    const userMsg = `Hypothesis:
Claim: ${block.body}
Rationale: ${meta.rationale ?? "(no rationale)"}`;

    try {
      const parsed = await llmJSON<{ supporting_rationales: string[] }>({
        system: EXPAND_HYPOTHESIS_SYSTEM,
        user: userMsg,
        maxTokens: 600,
        temperature: 0.5,
        responseSchema: EXPAND_HYPOTHESIS_SCHEMA as {
          name: string;
          schema: Record<string, unknown>;
        },
      });

      const rationales = (parsed.supporting_rationales ?? [])
        .map((s) => s.trim().slice(0, 400))
        .filter((s) => s.length > 0)
        .slice(0, 3);
      if (rationales.length === 0) {
        return NextResponse.json(
          { error: "No supporting rationales returned" },
          { status: 502 },
        );
      }

      const newMeta = { ...meta, supporting_rationales: rationales };
      const { data: updated, error: updateErr } = await db
        .from("synergy_strategy_blocks")
        .update({ meta: newMeta })
        .eq("id", id)
        .select("id, block_type, body, sort_order, meta, created_at")
        .single();
      if (updateErr || !updated) {
        return NextResponse.json(
          { error: sanitizeErrorMessage(updateErr) },
          { status: 500 },
        );
      }
      return NextResponse.json({ block: updated });
    } catch (err) {
      return handleLlmError(err);
    }
  }

  return NextResponse.json(
    { error: `Expand is not supported for block type: ${block.block_type}` },
    { status: 400 },
  );
}

function handleLlmError(err: unknown) {
  const credit = detectCreditError(err);
  if (credit.isCredit) {
    return NextResponse.json(
      { error: credit.message, code: "credits_exhausted" },
      { status: 402 },
    );
  }
  console.error("[/api/synergy/strategy-blocks/[id]/expand] LLM error:", err);
  return NextResponse.json(
    { error: sanitizeErrorMessage(err) },
    { status: 500 },
  );
}
