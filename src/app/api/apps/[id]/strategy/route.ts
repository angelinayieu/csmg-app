// GET    /api/apps/:id/strategy        → latest active sub-strategy + version log
// POST   /api/apps/:id/strategy        → generate a new sub-strategy version
// PATCH  /api/apps/:id/strategy        → status transitions (Tier 3.5: draft → active)
//
// Tier 3 endpoint. The route is a thin wrapper around
// `generateAppStrategy` with auth + ownership guards. Heavy lifting
// (LLM call, validation, DB writes, audit log) lives in the generator.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { hydrateAppStrategy } from "@/types/app-strategy";
import type { AppStrategyRow, AppStrategyVersionRow } from "@/types/app-strategy";

export const maxDuration = 120;

// ── GET ────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check + scope load via a single app row read (RLS
  // additionally guards app_strategies but we want a clear 404 vs 403).
  const { data: appRow } = await db
    .from("apps")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (!appRow) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }
  if (appRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Active sub-strategy (at most one per app via partial unique index).
  // Drafts are NOT returned by GET — they need to be promoted explicitly
  // via PATCH (future work). Today: the generator persists 'active' on
  // success and 'draft' only when quality gates fail; the UI surfaces
  // both via /api/apps/:id which includes the latest row regardless.
  const { data: activeRow } = await db
    .from("app_strategies")
    .select("*")
    .eq("app_id", id)
    .eq("status", "active")
    .maybeSingle();

  // Version history — recent activity for the audit trail. Capped at 20.
  const { data: versions } = await db
    .from("app_strategy_versions")
    .select("*")
    .eq("app_id", id)
    .order("changed_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    strategy: activeRow
      ? hydrateAppStrategy(activeRow as AppStrategyRow)
      : null,
    versions: (versions ?? []) as AppStrategyVersionRow[],
  });
}

// ── POST ──────────────────────────────────────────────────────────────
//
// Body (all optional):
//   {
//     trigger_reason?: string,           // free-form 1-sentence "why now"
//     deviation_focus_hint?: string,     // when caller knows it's deviation-driven
//     is_deviation_driven?: boolean,     // tags audit row as deviation_triggered
//   }
//
// Behavior:
//   - 200 with the new active strategy on success
//   - 200 with status=draft when quality gates failed (still persisted; UI
//     should surface "needs review")
//   - 502 when the LLM call fails after retries

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body } = await safeJsonParse<{
    trigger_reason?: string;
    deviation_focus_hint?: string;
    is_deviation_driven?: boolean;
  }>(request);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check before paying the LLM cost.
  const { data: appRow } = await db
    .from("apps")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (!appRow) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }
  if (appRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const triggerReason =
    typeof body?.trigger_reason === "string" && body.trigger_reason.trim().length > 0
      ? body.trigger_reason.trim()
      : "Manual regeneration via API";

  try {
    const { generateAppStrategy } = await import("@/lib/pipeline/app-strategy-generator");
    const result = await generateAppStrategy({
      db,
      appId: id,
      triggeredBy: `user:${user.id}:api`,
      triggerReason,
      deviationFocusHint:
        typeof body?.deviation_focus_hint === "string" ? body.deviation_focus_hint : null,
      isDeviationDriven: body?.is_deviation_driven === true,
    });

    return NextResponse.json({
      strategy: result.app_strategy,
      superseded_id: result.superseded_id,
      is_active: result.is_active,
      retry_count: result.retry_count,
    });
  } catch (err) {
    console.error(`[POST /api/apps/${id}/strategy] generation failed:`, err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Sub-strategy generation failed",
      },
      { status: 502 },
    );
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────
//
// Status transitions on an existing sub-strategy. Tier 3.5 supports:
//   draft → active   — user reviewed quality issues and accepts the spec
//
// Refused transitions:
//   active → draft   — re-generation is the way to make changes; flipping
//                      a live spec back to draft would silently break
//                      widgets that bind to it
//   * → archived     — kept for future "retire this app's spec" flow;
//                      not exposed through the API yet
//
// Body: { strategy_id: string, status: "active" }
//
// Behavior:
//   - 200 with the updated strategy on success
//   - 400 when the transition isn't allowed
//   - 404 when the strategy_id isn't found or doesn't belong to the user

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{
    strategy_id?: string;
    status?: string;
  }>(request);
  if (parseError) return parseError;

  const strategyId = typeof body?.strategy_id === "string" ? body.strategy_id : null;
  const targetStatus = typeof body?.status === "string" ? body.status : null;
  if (!strategyId || !targetStatus) {
    return NextResponse.json(
      { error: "strategy_id and status required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check + load current row.
  const { data: row } = await db
    .from("app_strategies")
    .select("*")
    .eq("id", strategyId)
    .eq("app_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) {
    return NextResponse.json(
      { error: "Sub-strategy not found or not owned" },
      { status: 404 },
    );
  }

  // Tier 3.5: only the draft → active transition is supported. Other
  // transitions either don't exist (active → draft) or aren't exposed
  // yet (active/draft → archived).
  if (!(row.status === "draft" && targetStatus === "active")) {
    return NextResponse.json(
      {
        error:
          `Transition ${row.status} → ${targetStatus} is not allowed. ` +
          "Only draft → active is supported.",
      },
      { status: 400 },
    );
  }

  // Block promotion when error-level quality issues exist — same gate
  // the panel enforces, but server-side is the source of truth.
  const issues = (row.quality?.issues ?? []) as Array<{ severity: string }>;
  const hasErrors = issues.some((i) => i.severity === "error");
  if (hasErrors) {
    return NextResponse.json(
      {
        error:
          "Cannot promote: sub-strategy has unresolved error-level issues. " +
          "Regenerate to produce a clean spec first.",
      },
      { status: 400 },
    );
  }

  // Supersede any prior active row first (mirrors generator's flow).
  // We do this even though the panel only surfaces promote when no
  // active exists — a race between auto-gen + manual promote could
  // produce two actives without the supersede step.
  const { data: priorActive } = await db
    .from("app_strategies")
    .select("id")
    .eq("app_id", id)
    .eq("status", "active")
    .maybeSingle();
  if (priorActive && priorActive.id !== strategyId) {
    await db
      .from("app_strategies")
      .update({ status: "superseded" })
      .eq("id", priorActive.id);
    await db.from("app_strategy_versions").insert({
      app_strategy_id: priorActive.id,
      app_id: id,
      change_type: "superseded",
      change_summary: "Superseded by promoted draft",
      changed_by: `user:${user.id}:promote`,
    });
  }

  // Promote the draft.
  const { data: promoted, error: updErr } = await db
    .from("app_strategies")
    .update({ status: "active" })
    .eq("id", strategyId)
    .select("*")
    .single();
  if (updErr || !promoted) {
    return NextResponse.json(
      { error: updErr?.message ?? "Update failed" },
      { status: 500 },
    );
  }

  // Audit log entry — distinct change_type so the version timeline
  // shows promote events clearly.
  await db.from("app_strategy_versions").insert({
    app_strategy_id: strategyId,
    app_id: id,
    change_type: "user_edit",
    change_summary: "Promoted draft to active",
    changed_by: `user:${user.id}:promote`,
  });

  return NextResponse.json({
    strategy: hydrateAppStrategy(promoted as AppStrategyRow),
  });
}
