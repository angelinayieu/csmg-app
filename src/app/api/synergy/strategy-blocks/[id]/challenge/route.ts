// ── POST /api/synergy/strategy-blocks/[id]/challenge ──
//
// Adversarial pass. Returns 2-3 weaknesses with severity + suggestion.
// Persists into block.meta.challenges so subsequent reads include them
// without a re-run.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  CHALLENGE_SCHEMA,
  CHALLENGE_SYSTEM,
} from "@/lib/synergy/strategy-ops-prompts";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ChallengeItem {
  weakness: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
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

  if (block.block_type !== "plan_step" && block.block_type !== "hypothesis") {
    return NextResponse.json(
      { error: `Challenge is not supported for block type: ${block.block_type}` },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (block.meta ?? {}) as Record<string, any>;
  const userMsg =
    block.block_type === "plan_step"
      ? `Plan step:\nTitle: ${meta.title ?? "(no title)"}\nDetail: ${block.body}`
      : `Hypothesis:\nClaim: ${block.body}\nRationale: ${meta.rationale ?? "(no rationale)"}`;

  try {
    const parsed = await llmJSON<{ challenges: ChallengeItem[] }>({
      system: CHALLENGE_SYSTEM,
      user: userMsg,
      maxTokens: 800,
      temperature: 0.4,
      responseSchema: CHALLENGE_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });

    const challenges = (parsed.challenges ?? [])
      .map((c) => ({
        weakness: c.weakness.trim().slice(0, 400),
        severity: c.severity,
        suggestion: c.suggestion.trim().slice(0, 400),
      }))
      .filter((c) => c.weakness.length > 0)
      .slice(0, 3);

    if (challenges.length === 0) {
      return NextResponse.json(
        { error: "No challenges returned" },
        { status: 502 },
      );
    }

    const newMeta = { ...meta, challenges };
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
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/strategy-blocks/[id]/challenge] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
