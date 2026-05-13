// ── POST /api/synergy/strategy-blocks/[id]/design-test ──
//
// For a hypothesis block: generates a concrete experimental design
// (title + method + steps + success/refute signals + effort scale)
// and persists into block.meta.experiment so the UI can render it
// inline beneath the hypothesis.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  DESIGN_TEST_SCHEMA,
  DESIGN_TEST_SYSTEM,
} from "@/lib/synergy/strategy-ops-prompts";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ExperimentResult {
  title: string;
  design: string;
  steps: string[];
  success_signal: string;
  refute_signal: string;
  effort: "hours" | "days" | "weeks";
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: block, error: loadErr } = await db
    .from("synergy_strategy_blocks")
    .select("id, block_type, body, meta, strategy_id")
    .eq("id", id)
    .single();
  if (loadErr || !block) {
    return NextResponse.json({ error: "Block not found" }, { status: 404 });
  }
  if (block.block_type !== "hypothesis") {
    return NextResponse.json(
      {
        error: `Design test is only defined for hypothesis blocks (got ${block.block_type})`,
      },
      { status: 400 },
    );
  }

  // Pull the parent strategy's statement so the LLM has the overarching
  // goal context — sharpens the experimental scope ("we're testing X
  // in service of Y").
  const { data: strategy } = await db
    .from("synergy_strategies")
    .select("statement, pitch")
    .eq("id", block.strategy_id)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (block.meta ?? {}) as Record<string, any>;
  const userMsg = `Hypothesis:
Claim: ${block.body}
Rationale: ${meta.rationale ?? "(no rationale given)"}

Broader strategy:
Statement: ${strategy?.statement ?? "(no statement)"}
Pitch: ${strategy?.pitch ?? "(no pitch)"}`;

  let experiment: ExperimentResult;
  try {
    const parsed = await llmJSON<{ experiment: ExperimentResult }>({
      system: DESIGN_TEST_SYSTEM,
      user: userMsg,
      maxTokens: 1000,
      temperature: 0.4,
      responseSchema: DESIGN_TEST_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
    experiment = {
      title: parsed.experiment.title.trim().slice(0, 200),
      design: parsed.experiment.design.trim().slice(0, 600),
      steps: parsed.experiment.steps
        .map((s) => s.trim().slice(0, 240))
        .filter((s) => s.length > 0)
        .slice(0, 4),
      success_signal: parsed.experiment.success_signal.trim().slice(0, 300),
      refute_signal: parsed.experiment.refute_signal.trim().slice(0, 300),
      effort: parsed.experiment.effort,
    };
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/strategy-blocks/[id]/design-test] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  const newMeta = { ...meta, experiment };
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
}
