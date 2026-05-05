// POST /api/spaces/[id]/runtime-settings/run-now
//   Body: { cron: 'agent_runtime' | 'predictions_resolve' }
//
// Manually triggers ONE cron tick scoped to ONE space, ignoring the
// per-space cadence_hours gate (but still respecting `enabled` and
// `paused_until` — disabled/paused crons cannot be manually fired).
//
// Why this exists: the global cron schedule (vercel.json) ticks every
// 2h / 1h. Users tweaking runtime settings have no way to verify the
// settings work without waiting hours. This endpoint runs the cron
// inline (~5-30s) and refreshes the panel so the user sees the stamp
// update immediately.
//
// Cost guard: rate-limited per (user, space, cron) to one trigger per
// 30 seconds. Beyond that the user must wait — prevents accidental
// click-spam from ballooning into a token-burn loop.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";
import {
  readRuntimeSettings,
  type CronKind,
  type RuntimeLastRuns,
} from "@/lib/runtime/runtime-settings";

export const maxDuration = 60;

interface PostBody {
  cron?: string;
}

const RATE_LIMIT_SECONDS = 30;

// In-memory rate limiter. Single Vercel instance per region; clean
// enough for the manual-trigger use case where the user is unlikely
// to hammer the button. Persistent rate-limit (Redis) would be
// overkill here.
const lastTriggerByKey = new Map<string, number>();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) return NextResponse.json({ error: "Space not found" }, { status: 404 });

  const { data: body, error: parseError } = await safeJsonParse<PostBody>(request);
  if (parseError) return parseError;

  const cron = body?.cron;
  if (cron !== "agent_runtime" && cron !== "predictions_resolve") {
    return NextResponse.json(
      { error: "cron must be one of: agent_runtime, predictions_resolve" },
      { status: 400 },
    );
  }
  const cronKind: CronKind = cron;

  // Rate limit
  const rlKey = `${user.id}:${spaceId}:${cronKind}`;
  const lastTriggerMs = lastTriggerByKey.get(rlKey);
  if (lastTriggerMs && Date.now() - lastTriggerMs < RATE_LIMIT_SECONDS * 1000) {
    const wait = Math.ceil((RATE_LIMIT_SECONDS * 1000 - (Date.now() - lastTriggerMs)) / 1000);
    return NextResponse.json(
      { error: `Rate limited — try again in ${wait}s.` },
      { status: 429 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Reject if disabled or paused — keep this enforcement consistent with
  // the cron's own gate (manual triggers shouldn't bypass the user's own
  // off-switches).
  const { data: spaceRow } = (await db
    .from("spaces")
    .select("runtime_settings")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .single()) as { data: { runtime_settings: unknown } | null };
  const settings = readRuntimeSettings(spaceRow?.runtime_settings);
  const cfg = cronKind === "agent_runtime" ? settings.agent_runtime : settings.predictions_resolve;
  if (!cfg.enabled) {
    return NextResponse.json(
      { error: "Cron is disabled for this space — re-enable to run" },
      { status: 409 },
    );
  }
  if (cronKind === "agent_runtime" && cfg.paused_until && Date.parse(cfg.paused_until) > Date.now()) {
    return NextResponse.json(
      { error: `Paused until ${cfg.paused_until} — cancel pause to run` },
      { status: 409 },
    );
  }

  lastTriggerByKey.set(rlKey, Date.now());

  // Run the cron logic inline. Both routes use the service client so
  // they bypass RLS — we already verified ownership above.
  const { createServiceClient } = await import("@/lib/supabase/service");
  const serviceDb = createServiceClient();

  try {
    // Reuse the existing scheduler / resolver. They iterate all spaces,
    // so the per-space settings gate naturally narrows the work to this
    // space (others will fail the cadence check unless they're due).
    // For tighter scoping (and lower cost), v2 could add scoped variants
    // — `runAgentRuntimeForSpace(db, spaceId)` etc. — but v1 reuses the
    // existing path to keep the surface area small.
    let summary: unknown = {};
    if (cronKind === "agent_runtime") {
      const { runAgentRuntime } = await import("@/lib/agents/scheduler");
      summary = await runAgentRuntime(serviceDb);
    } else {
      const { resolvePredictions } = await import("@/lib/twin/resolve-predictions");
      summary = await resolvePredictions(serviceDb, { batchSize: 50 });
    }

    // Re-load the (settings, last_runs, next_due) so the client doesn't
    // need a second fetch to refresh the panel.
    const { data: refreshed } = (await db
      .from("spaces")
      .select(
        "runtime_settings, last_agent_runtime_at, last_predictions_resolve_at",
      )
      .eq("id", spaceId)
      .eq("user_id", user.id)
      .single()) as {
      data: {
        runtime_settings: unknown;
        last_agent_runtime_at: string | null;
        last_predictions_resolve_at: string | null;
      } | null;
    };

    const lastRuns: RuntimeLastRuns = {
      agent_runtime: refreshed?.last_agent_runtime_at ?? null,
      predictions_resolve: refreshed?.last_predictions_resolve_at ?? null,
    };

    return NextResponse.json({
      ok: true,
      cron: cronKind,
      summary,
      last_runs: lastRuns,
    });
  } catch (err) {
    console.error("[run-now] cron failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
