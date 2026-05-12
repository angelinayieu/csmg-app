// ── POST /api/synergy/strategy-blocks/[id]/mitigate ──
//
// Layers additional mitigations onto a risk block. Persists into
// meta.additional_mitigations (separate from the original mitigation
// so the UI can render them as a "Further mitigations" group).

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  MITIGATE_FURTHER_SCHEMA,
  MITIGATE_FURTHER_SYSTEM,
} from "@/lib/synergy/strategy-ops-prompts";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface MitigationItem {
  tactic: string;
  kind: "prevent" | "detect" | "respond";
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

  if (block.block_type !== "risk") {
    return NextResponse.json(
      {
        error: `Mitigate is only defined for risk blocks (got ${block.block_type})`,
      },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (block.meta ?? {}) as Record<string, any>;
  const userMsg = `Risk:
Title: ${meta.title ?? "(no title)"}
Severity: ${meta.severity ?? "medium"}
Detail: ${block.body}
Existing mitigation: ${meta.mitigation ?? "(none)"}`;

  try {
    const parsed = await llmJSON<{
      additional_mitigations: MitigationItem[];
    }>({
      system: MITIGATE_FURTHER_SYSTEM,
      user: userMsg,
      maxTokens: 600,
      temperature: 0.4,
      responseSchema: MITIGATE_FURTHER_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });

    const mitigations = (parsed.additional_mitigations ?? [])
      .map((m) => ({ tactic: m.tactic.trim().slice(0, 400), kind: m.kind }))
      .filter((m) => m.tactic.length > 0)
      .slice(0, 3);

    if (mitigations.length === 0) {
      return NextResponse.json(
        { error: "No additional mitigations returned" },
        { status: 502 },
      );
    }

    const newMeta = { ...meta, additional_mitigations: mitigations };
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
    console.error("[/api/synergy/strategy-blocks/[id]/mitigate] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
