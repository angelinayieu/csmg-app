// ── POST /api/synergy/strategy-blocks/[id]/find-evidence ──
//
// Proposes 2-3 evidence sources for a block. Each proposal becomes a
// new `evidence` block in the same generation, linked to the source
// via meta.supports_block_id.
//
// MVP: the LLM proposes "what to look for" — title, kind, summary, and
// a concrete Google search query. UI surfaces the search query as a
// clickable link. Phase 5+ can swap to real web fetch via the Responses
// API tool. The schema is forward-compatible — when we wire real
// search, we just populate meta.url alongside the existing fields.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  FIND_EVIDENCE_SCHEMA,
  FIND_EVIDENCE_SYSTEM,
} from "@/lib/synergy/strategy-ops-prompts";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface EvidenceItem {
  source_title: string;
  source_kind:
    | "paper"
    | "article"
    | "github"
    | "dataset"
    | "regulation"
    | "blog"
    | "report";
  summary: string;
  search_query: string;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: block, error: loadErr } = await db
    .from("synergy_strategy_blocks")
    .select("id, strategy_id, generation_id, block_type, body, meta, sort_order")
    .eq("id", id)
    .single();
  if (loadErr || !block) {
    return NextResponse.json({ error: "Block not found" }, { status: 404 });
  }

  if (
    block.block_type !== "plan_step" &&
    block.block_type !== "hypothesis" &&
    block.block_type !== "risk"
  ) {
    return NextResponse.json(
      {
        error: `Find evidence is not supported for block type: ${block.block_type}`,
      },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (block.meta ?? {}) as Record<string, any>;
  const userMsg = `Block type: ${block.block_type}
${meta.title ? `Title: ${meta.title}` : ""}
Body: ${block.body}
${meta.rationale ? `Rationale: ${meta.rationale}` : ""}
${meta.severity ? `Severity: ${meta.severity}` : ""}`.trim();

  let evidence: EvidenceItem[];
  try {
    const parsed = await llmJSON<{ evidence: EvidenceItem[] }>({
      system: FIND_EVIDENCE_SYSTEM,
      user: userMsg,
      maxTokens: 800,
      temperature: 0.5,
      responseSchema: FIND_EVIDENCE_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
    evidence = (parsed.evidence ?? [])
      .map((e) => ({
        source_title: e.source_title.trim().slice(0, 200),
        source_kind: e.source_kind,
        summary: e.summary.trim().slice(0, 400),
        search_query: e.search_query.trim().slice(0, 200),
      }))
      .filter((e) => e.source_title.length > 0)
      .slice(0, 3);
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/strategy-blocks/[id]/find-evidence] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  if (evidence.length === 0) {
    return NextResponse.json(
      { error: "No evidence sources returned" },
      { status: 502 },
    );
  }

  // Find the highest sort_order in this strategy so new evidence blocks
  // land at the end without colliding.
  const { data: maxRow } = await db
    .from("synergy_strategy_blocks")
    .select("sort_order")
    .eq("strategy_id", block.strategy_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextSort = (maxRow?.sort_order ?? block.sort_order ?? 0) + 1;

  const payload = evidence.map((e) => {
    const meta = {
      source_title: e.source_title,
      source_kind: e.source_kind,
      summary: e.summary,
      search_query: e.search_query,
      supports_block_id: block.id,
    };
    return {
      strategy_id: block.strategy_id,
      generation_id: block.generation_id,
      block_type: "evidence" as const,
      body: e.summary,
      sort_order: nextSort++,
      meta,
    };
  });

  const { data: inserted, error: insertErr } = await db
    .from("synergy_strategy_blocks")
    .insert(payload)
    .select("id, block_type, body, sort_order, meta, created_at");
  if (insertErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }

  return NextResponse.json({ evidence_blocks: inserted ?? [] });
}
