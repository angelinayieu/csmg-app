// ── POST /api/synergy/components/embeddings/backfill ──
//
// Re-embeds the caller's brainstorm_components rows where embedding
// IS NULL. During Phase 3 extraction we soft-fail on embed errors so
// the user still gets their typed components even if the OpenAI
// embeddings endpoint hiccups; this backfill catches those gaps.
//
// Owner-scoped: only the caller's own components. Returns a count
// of rows successfully filled.
//
// Batches the embed calls in groups of 32 to stay well under
// OpenAI's per-request limits.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { embedTexts } from "@/lib/embeddings";
import { detectCreditError } from "@/lib/llm";

export const maxDuration = 60;

const BATCH = 32;

interface NullEmbedRow {
  id: string;
  label_public: string;
  description_public: string;
}

export async function POST() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Pull all of the caller's null-embedding rows.
  const { data: rows, error: loadErr } = await db
    .from("brainstorm_components")
    .select("id, label_public, description_public")
    .eq("owner_id", user.id)
    .is("embedding", null);
  if (loadErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(loadErr) },
      { status: 500 },
    );
  }
  const list = (rows ?? []) as NullEmbedRow[];
  if (list.length === 0) {
    return NextResponse.json({ filled: 0, message: "No null embeddings" });
  }

  let filled = 0;
  const failures: string[] = [];

  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const surfaces = batch.map(
      (r) => `${r.label_public}. ${r.description_public}`,
    );
    let embeddings: number[][];
    try {
      // eslint-disable-next-line no-await-in-loop
      embeddings = await embedTexts(surfaces);
    } catch (err) {
      const credit = detectCreditError(err);
      if (credit.isCredit) {
        return NextResponse.json(
          { error: credit.message, code: "credits_exhausted", filled },
          { status: 402 },
        );
      }
      console.error("[backfill embeddings] batch failed:", err);
      failures.push(`batch starting ${batch[0]?.id}: ${(err as Error).message}`);
      continue;
    }
    // Update each row with its embedding. We do these one at a time
    // because Supabase's UPDATE doesn't support a CASE expression
    // through the JS client cleanly. For ~hundreds of rows this is
    // still <1s.
    for (let j = 0; j < batch.length; j++) {
      // eslint-disable-next-line no-await-in-loop
      const { error: updateErr } = await db
        .from("brainstorm_components")
        .update({ embedding: embeddings[j] })
        .eq("id", batch[j].id)
        .eq("owner_id", user.id);
      if (updateErr) {
        failures.push(`${batch[j].id}: ${updateErr.message}`);
        continue;
      }
      filled++;
    }
  }

  return NextResponse.json({
    filled,
    total_null: list.length,
    failures: failures.length > 0 ? failures.slice(0, 10) : undefined,
  });
}
