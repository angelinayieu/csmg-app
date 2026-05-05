// GET   /api/spaces/[id]/runtime-settings
//   Returns the effective settings (defaults filled in for missing keys)
//   plus a derived `next_due` map showing when each cron will next act
//   on this space.
//
// PATCH /api/spaces/[id]/runtime-settings
//   Body: RuntimeSettingsPatch — partial update; clamped + validated
//   server-side via applyUserPatch(). Returns the new effective settings.
//
// Owner-only via verifySpaceOwnership. The cron writers (scheduler.ts,
// resolve-predictions.ts) bypass this route — they update last_runs
// directly via the service client.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";
import {
  readRuntimeSettings,
  applyUserPatch,
  isCronDue,
  type RuntimeSettingsPatch,
  type RuntimeSettings,
  type RuntimeLastRuns,
} from "@/lib/runtime/runtime-settings";

export const maxDuration = 10;

interface RuntimeSettingsResponse {
  settings: RuntimeSettings;
  /** Last-run timestamps from the dedicated columns. Returned alongside
   *  settings so the panel can render "last run 47m ago" without a
   *  second fetch. */
  last_runs: RuntimeLastRuns;
  /** Per-cron derived view: is it due now? in how many seconds? human reason? */
  next_due: {
    agent_runtime: { due: boolean; reason: string; seconds_until_due: number };
    predictions_resolve: { due: boolean; reason: string; seconds_until_due: number };
  };
}

interface SpaceRuntimeRow {
  runtime_settings: unknown;
  last_agent_runtime_at: string | null;
  last_predictions_resolve_at: string | null;
}

async function loadSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
): Promise<{ settings: RuntimeSettings; lastRuns: RuntimeLastRuns }> {
  const { data: row } = (await db
    .from("spaces")
    .select("runtime_settings, last_agent_runtime_at, last_predictions_resolve_at")
    .eq("id", spaceId)
    .eq("user_id", userId)
    .single()) as { data: SpaceRuntimeRow | null };
  return {
    settings: readRuntimeSettings(row?.runtime_settings),
    lastRuns: {
      agent_runtime: row?.last_agent_runtime_at ?? null,
      predictions_resolve: row?.last_predictions_resolve_at ?? null,
    },
  };
}

function buildResponse(
  settings: RuntimeSettings,
  lastRuns: RuntimeLastRuns,
): RuntimeSettingsResponse {
  return {
    settings,
    last_runs: lastRuns,
    next_due: {
      agent_runtime: isCronDue(settings, "agent_runtime", lastRuns),
      predictions_resolve: isCronDue(settings, "predictions_resolve", lastRuns),
    },
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) return NextResponse.json({ error: "Space not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { settings, lastRuns } = await loadSettings(db, spaceId, user.id);
  return NextResponse.json(buildResponse(settings, lastRuns));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) return NextResponse.json({ error: "Space not found" }, { status: 404 });

  const { data: body, error: parseError } = await safeJsonParse<RuntimeSettingsPatch>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { settings: current, lastRuns } = await loadSettings(db, spaceId, user.id);
  const next = applyUserPatch(current, body ?? {});

  const { error: updErr } = await db
    .from("spaces")
    .update({ runtime_settings: next })
    .eq("id", spaceId)
    .eq("user_id", user.id);

  if (updErr) {
    console.error("[runtime-settings PATCH] update failed:", updErr);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }

  return NextResponse.json(buildResponse(next, lastRuns));
}
