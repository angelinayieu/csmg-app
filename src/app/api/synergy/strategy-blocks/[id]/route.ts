// ── PATCH /api/synergy/strategy-blocks/[id] ──
//
// Generic block-level update: body + targeted meta fields. Used by the
// inline-edit flow on plan_step (title + body), risk (title + body +
// mitigation), and hypothesis (claim + rationale). Op endpoints
// (expand / challenge / find-evidence / mitigate) live as sibling
// routes — they handle AI-generated additions, not user edits.
//
// Whitelisted meta keys per block_type prevent the client from
// accidentally clobbering structured fields produced by ops.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  body?: unknown;
  meta_patch?: unknown;
}

// Per-type allowed meta keys for user edits. AI-op-produced keys
// (sub_steps, supporting_rationales, challenges, additional_mitigations,
// supports_block_id) are NOT in here — they evolve via op endpoints.
const ALLOWED_META_KEYS: Record<string, string[]> = {
  plan_step: ["title"],
  risk: ["title", "severity", "mitigation"],
  hypothesis: ["rationale", "evidence_status"],
  evidence: ["source_title", "source_kind", "url", "summary"],
  note: [],
};

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load existing block so we can compute the merged meta and validate
  // the type-specific key whitelist.
  const { data: existing, error: loadErr } = await db
    .from("synergy_strategy_blocks")
    .select("id, block_type, body, meta")
    .eq("id", id)
    .single();
  if (loadErr || !existing) {
    return NextResponse.json({ error: "Block not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};

  if (typeof body.body === "string") {
    update.body = body.body.slice(0, 2000);
  }

  if (body.meta_patch && typeof body.meta_patch === "object") {
    const allowed = ALLOWED_META_KEYS[existing.block_type] ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch = body.meta_patch as Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged = { ...(existing.meta as Record<string, any>) };
    for (const key of Object.keys(patch)) {
      if (!allowed.includes(key)) continue;
      // Lightweight sanitization on common string fields
      const val = patch[key];
      if (typeof val === "string") {
        merged[key] = val.slice(0, 1000);
      } else {
        merged[key] = val;
      }
    }
    update.meta = merged;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await db
    .from("synergy_strategy_blocks")
    .update(update)
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
