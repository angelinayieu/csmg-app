// App patch primitives — the seam agents, research loops, and whiteboard edits
// all go through. Every mutation records an app_versions row so nothing happens
// invisibly.
//
// Design rules:
//  - All primitives are idempotent where it makes sense (no-op if nothing to change).
//  - Signal + hint appends are CAPPED to prevent unbounded JSONB growth.
//  - `changed_by` is mandatory — we want to be able to trace every patch to a source.
//  - Failures are logged but don't throw into the caller; the upstream write
//    (edge accept, research loop, etc.) must not be blocked by an app-update
//    failure. These are audit/side-effect updates, not primary work.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type {
  AppRow,
  AppConfig,
  AppState,
  AppStaleReason,
  AppVersionChangeType,
} from "@/types/app";
import { asAppConfig, asAppState } from "@/types/app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

const MAX_SIGNALS = 20;   // cap recent_signals array length
const MAX_HINTS = 15;     // cap agent_hints array length

// ── Version recorder ──────────────────────────────────────────────────

interface RecordVersionArgs {
  db: DB;
  appId: string;
  configSnapshot: AppConfig | unknown;
  stateSnapshot: AppState | unknown;
  changeType: AppVersionChangeType;
  changedBy: string;
  changeSummary: string;
  changePayload?: Record<string, unknown> | null;
}

async function recordAppVersion(args: RecordVersionArgs): Promise<void> {
  try {
    const { data: maxVer } = await args.db
      .from("app_versions")
      .select("version")
      .eq("app_id", args.appId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxVer?.version ?? 0) + 1;

    await args.db.from("app_versions").insert({
      app_id: args.appId,
      version: nextVersion,
      config_snapshot: args.configSnapshot,
      state_snapshot: args.stateSnapshot,
      change_type: args.changeType,
      changed_by: args.changedBy,
      change_summary: args.changeSummary,
      change_payload: args.changePayload ?? null,
    });
  } catch (err) {
    console.warn("[app-updates] version record failed:", err);
  }
}

// ── Fetch helper ──────────────────────────────────────────────────────

async function fetchApp(db: DB, appId: string): Promise<AppRow | null> {
  const { data } = (await db.from("apps").select("*").eq("id", appId).maybeSingle()) as {
    data: AppRow | null;
  };
  return data;
}

// ── Deep merge helper (shallow object + preserved nested arrays) ──────
//
// We don't want a generic deep merger here — AppConfig has specific fields
// that must NEVER be blindly merged (e.g. agent_hints is an array that must
// be appended to, not overwritten). Callers should use the specific
// append/patch helpers below rather than this.

function mergeConfig(prior: AppConfig, patch: Partial<AppConfig>): AppConfig {
  return {
    ...prior,
    ...patch,
    // Preserve arrays that must append rather than replace, unless the
    // caller explicitly passed them in the patch (an explicit value wins).
    agent_hints: patch.agent_hints ?? prior.agent_hints,
    channels: patch.channels ?? prior.channels,
    surfaced_metrics: patch.surfaced_metrics ?? prior.surfaced_metrics,
    serves_objectives: patch.serves_objectives ?? prior.serves_objectives,
    tags: patch.tags ?? prior.tags,
    theme: patch.theme ?? prior.theme,
    manifest: patch.manifest ?? prior.manifest,
  };
}

function mergeState(prior: AppState, patch: Partial<AppState>): AppState {
  return {
    ...prior,
    ...patch,
    health_breakdown: patch.health_breakdown
      ? { ...prior.health_breakdown, ...patch.health_breakdown }
      : prior.health_breakdown,
    recent_signals: patch.recent_signals ?? prior.recent_signals,
    last_agent_update: patch.last_agent_update ?? prior.last_agent_update,
  };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Patch an App's config JSONB. Merges shallowly — for arrays you own
 * (recent_signals, agent_hints), prefer the `append*` helpers below.
 *
 * Returns the updated AppRow (or null if the app wasn't found).
 */
export async function patchAppConfig(
  db: DB,
  appId: string,
  patch: Partial<AppConfig>,
  changedBy: string,
  summary: string
): Promise<AppRow | null> {
  const app = await fetchApp(db, appId);
  if (!app) return null;

  const nextConfig = mergeConfig(asAppConfig(app.config), patch);

  const { data: updated, error } = await db
    .from("apps")
    .update({
      config: nextConfig as unknown as Database["public"]["Tables"]["apps"]["Update"]["config"],
      last_updated_by: changedBy,
    })
    .eq("id", appId)
    .select("*")
    .single();

  if (error) {
    console.warn("[app-updates] patchAppConfig failed:", error);
    return null;
  }

  const row = updated as AppRow;
  await recordAppVersion({
    db,
    appId,
    configSnapshot: row.config,
    stateSnapshot: row.state,
    changeType: changedBy.startsWith("agent:") ? "agent_update" : "user_edit",
    changedBy,
    changeSummary: summary,
    changePayload: { patched_fields: Object.keys(patch) },
  });

  return row;
}

/**
 * Patch an App's state JSONB. Same merge semantics as patchAppConfig.
 */
export async function patchAppState(
  db: DB,
  appId: string,
  patch: Partial<AppState>,
  changedBy: string,
  summary: string
): Promise<AppRow | null> {
  const app = await fetchApp(db, appId);
  if (!app) return null;

  const nextState = mergeState(asAppState(app.state), patch);

  const { data: updated, error } = await db
    .from("apps")
    .update({
      state: nextState as unknown as Database["public"]["Tables"]["apps"]["Update"]["state"],
      last_updated_by: changedBy,
    })
    .eq("id", appId)
    .select("*")
    .single();

  if (error) {
    console.warn("[app-updates] patchAppState failed:", error);
    return null;
  }

  const row = updated as AppRow;
  await recordAppVersion({
    db,
    appId,
    configSnapshot: row.config,
    stateSnapshot: row.state,
    changeType: changedBy.startsWith("agent:") ? "agent_update" : "user_edit",
    changedBy,
    changeSummary: summary,
    changePayload: { patched_fields: Object.keys(patch) },
  });

  return row;
}

/**
 * Append a signal to an App's state.recent_signals. Caps the array at
 * MAX_SIGNALS; oldest entries are dropped.
 *
 * Signals surface as small notifications on the app card — "risk detected",
 * "new opportunity", etc. Agents are the primary writers.
 */
export async function appendAppSignal(
  db: DB,
  appId: string,
  signal: NonNullable<AppState["recent_signals"]>[number],
  changedBy: string
): Promise<AppRow | null> {
  const app = await fetchApp(db, appId);
  if (!app) return null;

  const prior = asAppState(app.state);
  const prev = prior.recent_signals ?? [];
  const withAppended = [...prev, signal];
  const capped = withAppended.slice(Math.max(0, withAppended.length - MAX_SIGNALS));

  const nextState: AppState = { ...prior, recent_signals: capped };

  const { data: updated, error } = await db
    .from("apps")
    .update({
      state: nextState as unknown as Database["public"]["Tables"]["apps"]["Update"]["state"],
      last_updated_by: changedBy,
    })
    .eq("id", appId)
    .select("*")
    .single();

  if (error) {
    console.warn("[app-updates] appendAppSignal failed:", error);
    return null;
  }

  const row = updated as AppRow;
  await recordAppVersion({
    db,
    appId,
    configSnapshot: row.config,
    stateSnapshot: row.state,
    changeType: "agent_update",
    changedBy,
    changeSummary: `Signal: ${signal.kind} — ${signal.message.slice(0, 80)}`,
    changePayload: { signal_kind: signal.kind },
  });

  return row;
}

/**
 * Append an agent hint to config.agent_hints (also capped).
 * Hints are higher-level "what to look at first" annotations — they live
 * with the app's *definition*, not its runtime state.
 */
export async function appendAgentHint(
  db: DB,
  appId: string,
  hint: NonNullable<AppConfig["agent_hints"]>[number],
  changedBy: string
): Promise<AppRow | null> {
  const app = await fetchApp(db, appId);
  if (!app) return null;

  const priorConfig = asAppConfig(app.config);
  const prev = priorConfig.agent_hints ?? [];
  const withAppended = [...prev, hint];
  const capped = withAppended.slice(Math.max(0, withAppended.length - MAX_HINTS));

  const nextConfig: AppConfig = { ...priorConfig, agent_hints: capped };

  const { data: updated, error } = await db
    .from("apps")
    .update({
      config: nextConfig as unknown as Database["public"]["Tables"]["apps"]["Update"]["config"],
      last_updated_by: changedBy,
    })
    .eq("id", appId)
    .select("*")
    .single();

  if (error) {
    console.warn("[app-updates] appendAgentHint failed:", error);
    return null;
  }

  const row = updated as AppRow;
  await recordAppVersion({
    db,
    appId,
    configSnapshot: row.config,
    stateSnapshot: row.state,
    changeType: "agent_update",
    changedBy,
    changeSummary: `Agent hint from ${hint.agent}: ${hint.hint.slice(0, 80)}`,
    changePayload: { agent: hint.agent },
  });

  return row;
}

/**
 * Batch-mark apps as stale with a reason. Called by staleness-triggers when
 * the KG changes, research fires, whiteboard edits, etc.
 *
 * Records ONE app_versions row per stale app (change_type='staleness_refresh').
 */
export async function markAppsStale(
  db: DB,
  appIds: string[],
  reason: AppStaleReason,
  changedBy: string,
  summary?: string
): Promise<number> {
  if (appIds.length === 0) return 0;
  const nowIso = new Date().toISOString();

  const { data: updated, error } = await db
    .from("apps")
    .update({
      stale_reason: reason,
      stale_since: nowIso,
      last_updated_by: changedBy,
    })
    .in("id", appIds)
    .select("id, config, state");

  if (error) {
    console.warn("[app-updates] markAppsStale failed:", error);
    return 0;
  }

  const rows = (updated ?? []) as Array<Pick<AppRow, "id" | "config" | "state">>;
  const summaryText = summary ?? `Marked stale: ${reason}`;

  // Parallel version records — fast when there are only a few stale apps,
  // and rare even at scale (staleness flaps only fire per user action).
  await Promise.all(
    rows.map((r) =>
      recordAppVersion({
        db,
        appId: r.id,
        configSnapshot: r.config,
        stateSnapshot: r.state,
        changeType: "staleness_refresh",
        changedBy,
        changeSummary: summaryText,
        changePayload: { reason },
      })
    )
  );

  return rows.length;
}

/**
 * Reconcile an App with the current synthesis data for its space.
 *
 * Recomputes `state.headline` and `state.health_breakdown` from the latest
 * leverage/risk overlap against `dominant_entity_codes`, appends a "refreshed"
 * signal, then clears the stale flag. Used by both:
 *   - POST /api/apps/:id/refresh (user-facing hover button)
 *   - `reconcile_app` action handler (widget-facing)
 *
 * Single source of truth for "reconcile now" semantics. Does NOT run the
 * pipeline — that's what `request_agent_refresh` is for.
 */
export async function reconcileAppWithKG(
  db: DB,
  app: AppRow,
  changedBy: string
): Promise<AppRow | null> {
  // Load current synthesis for the app's space.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", app.space_id)
    .maybeSingle();

  const synth = (spaceRow?.synthesis_data as Record<string, unknown> | null) ?? null;

  const leveragePoints = Array.isArray(synth?.leverage_points)
    ? (synth!.leverage_points as Array<{ entity_id?: string }>)
    : [];
  const riskPoints = Array.isArray(synth?.risk_points)
    ? (synth!.risk_points as Array<{ entity_id?: string }>)
    : [];

  const leverageCodes = new Set(
    leveragePoints.map((p) => p.entity_id).filter(Boolean) as string[]
  );
  const riskCodes = new Set(
    riskPoints.map((p) => p.entity_id).filter(Boolean) as string[]
  );

  const dominantCodes = app.dominant_entity_codes ?? [];
  const myLeverage = dominantCodes.filter((c) => leverageCodes.has(c));
  const myRisks = dominantCodes.filter((c) => riskCodes.has(c));

  const coverage =
    dominantCodes.length > 0
      ? Math.round(
          ((myLeverage.length + myRisks.length) / dominantCodes.length) * 100
        )
      : null;
  const momentum =
    myLeverage.length > myRisks.length
      ? 75
      : myLeverage.length === myRisks.length
        ? 50
        : 35;
  const riskPct =
    dominantCodes.length > 0
      ? Math.round((myRisks.length / dominantCodes.length) * 100)
      : 0;

  const priorState = asAppState(app.state);

  const refreshSignal: NonNullable<AppState["recent_signals"]>[number] = {
    kind: myRisks.length > myLeverage.length ? "risk" : "insight",
    message: app.stale_reason
      ? `Reconciled after ${describeStaleReason(app.stale_reason)} — ${myLeverage.length} leverage · ${myRisks.length} risk in dominant factors`
      : `Reconciled — ${myLeverage.length} leverage · ${myRisks.length} risk in dominant factors`,
    at: new Date().toISOString(),
  };

  // Apply state recompute + append signal in one pass (single version row).
  await patchAppState(
    db,
    app.id,
    {
      headline:
        coverage != null
          ? `${coverage}% of factors actively tracked`
          : priorState.headline,
      health_breakdown: {
        coverage: coverage ?? priorState.health_breakdown?.coverage,
        momentum,
        risk: riskPct,
      },
      recent_signals: [...(priorState.recent_signals ?? []), refreshSignal].slice(-20),
    },
    changedBy,
    "Reconciled with current KG"
  );

  // Clear staleness + bump last_refreshed_at + record version row.
  return clearAppStaleness(
    db,
    app.id,
    changedBy,
    app.stale_reason
      ? `Reconciled: was stale (${app.stale_reason})`
      : "Manual reconcile"
  );
}

function describeStaleReason(reason: string): string {
  switch (reason) {
    case "kg_changed": return "KG changes";
    case "new_research": return "new research";
    case "user_feedback": return "your feedback";
    case "strategy_regen": return "strategy regeneration";
    case "whiteboard_edit": return "a whiteboard edit";
    default: return reason;
  }
}

/**
 * Clear the stale flag on an app and record a "refreshed" version row.
 * Called from POST /api/apps/:id/refresh and reconcileAppWithKG.
 */
export async function clearAppStaleness(
  db: DB,
  appId: string,
  changedBy: string,
  summary = "App refreshed"
): Promise<AppRow | null> {
  const { data: updated, error } = await db
    .from("apps")
    .update({
      stale_reason: null,
      stale_since: null,
      last_refreshed_at: new Date().toISOString(),
      last_updated_by: changedBy,
    })
    .eq("id", appId)
    .select("*")
    .single();

  if (error) {
    console.warn("[app-updates] clearAppStaleness failed:", error);
    return null;
  }

  const row = updated as AppRow;
  await recordAppVersion({
    db,
    appId,
    configSnapshot: row.config,
    stateSnapshot: row.state,
    changeType: "staleness_refresh",
    changedBy,
    changeSummary: summary,
    changePayload: { stale_cleared: true },
  });

  return row;
}
