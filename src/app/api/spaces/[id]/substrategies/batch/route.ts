// POST /api/spaces/:id/substrategies/batch — pre-generate sub-strategies
// for every app in the space that doesn't already have an active one.
//
// Tier 4.5: the lazy per-app generation in Tier 3.5 waits until a user
// opens each app before running generation. For users with 10 apps, that's
// 10 separate 30-60s waits spread over clicks. This endpoint runs them all
// upfront — typically invoked from a "Pre-generate all" button after
// strategy approval.
//
// Implementation strategy:
//   - Enumerate apps for the space that have no active app_strategies row
//   - Run generateAppStrategy for each, one at a time, with a modest
//     concurrency cap (2 parallel). Too much concurrency hits LLM rate
//     limits; sequential is unnecessarily slow.
//   - Failures are isolated — one app's generation failing doesn't stop
//     the others. Failures are logged + reported in the response so the
//     UI can show "3 generated, 1 failed."
//   - Apps with an existing draft get "upgraded" via regeneration (drafts
//     usually mean the last attempt hit quality gates; retrying is cheap).
//   - Apps with an active strategy already are skipped (no-op).
//
// Cost: one LLM call per app, same as lazy-per-open. The user trades off
// "wait once after approval for ~N×30s" vs "wait N times over the next
// few minutes as they click around." Batch is usually the better trade.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { AppRow } from "@/types/app";
import type { AppStrategyRow } from "@/types/app-strategy";

export const maxDuration = 300;

// Concurrency is bounded low — we're IO-bound on the LLM, but generous
// concurrency causes per-key rate limit cascades. 2 is the empirical
// sweet spot when the same space has 5-10 apps.
const CONCURRENCY = 2;

// Per-batch app cap. A space with 30+ apps should not trigger 30 LLM
// calls in one request — we'd hit maxDuration. Excess apps stay lazy.
const MAX_APPS_PER_BATCH = 15;

export interface BatchSubstrategiesResponse {
  requested: number;
  generated: number;
  skipped: number;
  failed: number;
  details: Array<{
    app_id: string;
    app_name: string;
    status: "generated" | "skipped_has_active" | "failed" | "skipped_cap";
    reason?: string;
    strategy_id?: string;
  }>;
  ran_at: string;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Load all apps + existing sub-strategies in parallel. We need the
  // sub-strategy index to compute which apps actually need generation.
  const [{ data: apps }, { data: subs }] = await Promise.all([
    db.from("apps").select("id, name").eq("space_id", spaceId).eq("user_id", user.id),
    db.from("app_strategies").select("app_id, status").eq("space_id", spaceId).eq("user_id", user.id),
  ]);

  const appRows = (apps ?? []) as Pick<AppRow, "id" | "name">[];
  const subRows = (subs ?? []) as Pick<AppStrategyRow, "app_id" | "status">[];
  const activeAppIds = new Set<string>();
  for (const s of subRows) {
    if (s.status === "active") activeAppIds.add(s.app_id);
  }

  // Skip apps with an active spec; draft apps still get regenerated
  // because drafts typically mean "prior attempt hit quality gates."
  const toGenerate: Array<{ id: string; name: string }> = [];
  const skipped: Array<{ id: string; name: string }> = [];
  for (const a of appRows) {
    if (activeAppIds.has(a.id)) {
      skipped.push({ id: a.id, name: a.name });
    } else {
      toGenerate.push({ id: a.id, name: a.name });
    }
  }

  // Apply the cap — safety against a space with 30+ apps DoS-ing the
  // endpoint via maxDuration. Apps beyond the cap stay lazy.
  const capOverflow = toGenerate.length > MAX_APPS_PER_BATCH
    ? toGenerate.slice(MAX_APPS_PER_BATCH)
    : [];
  const capped = toGenerate.slice(0, MAX_APPS_PER_BATCH);

  const details: BatchSubstrategiesResponse["details"] = [];
  for (const a of skipped) {
    details.push({
      app_id: a.id,
      app_name: a.name,
      status: "skipped_has_active",
    });
  }
  for (const a of capOverflow) {
    details.push({
      app_id: a.id,
      app_name: a.name,
      status: "skipped_cap",
      reason: `Batch cap of ${MAX_APPS_PER_BATCH} reached — will lazy-generate on first open`,
    });
  }

  // Dynamic import keeps the prompt + LLM client out of the cold path
  // when the endpoint is hit without work to do (skipped-only response).
  const { generateAppStrategy } = await import("@/lib/pipeline/app-strategy-generator");

  // Batch in groups of CONCURRENCY using Promise.allSettled for
  // isolation — one app's LLM timeout shouldn't block the others.
  let generated = 0;
  let failed = 0;
  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    const slice = capped.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map((a) =>
        generateAppStrategy({
          db,
          appId: a.id,
          triggeredBy: `user:${user.id}:batch_pregen`,
          triggerReason: "Batch pre-generation after strategy approval",
          isDeviationDriven: false,
        }),
      ),
    );
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      const a = slice[j];
      if (s.status === "fulfilled") {
        generated++;
        details.push({
          app_id: a.id,
          app_name: a.name,
          status: "generated",
          strategy_id: s.value.app_strategy.id,
        });
      } else {
        failed++;
        const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
        details.push({
          app_id: a.id,
          app_name: a.name,
          status: "failed",
          reason,
        });
        console.warn(
          `[substrategies/batch] generation failed for ${a.name} (${a.id}): ${reason}`,
        );
      }
    }
  }

  console.log(
    `[substrategies/batch] space=${spaceId} requested=${appRows.length} ` +
    `generated=${generated} skipped=${skipped.length + capOverflow.length} failed=${failed}`,
  );

  const response: BatchSubstrategiesResponse = {
    requested: appRows.length,
    generated,
    skipped: skipped.length + capOverflow.length,
    failed,
    details,
    ran_at: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
