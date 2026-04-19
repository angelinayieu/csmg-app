// ── Action Dispatcher ──────────────────────────────────────────────────
//
// Server-side routing of widget-emitted actions. Widgets declare actions
// abstractly (ActionKind); this module maps each to a concrete DB
// mutation. The /api/apps/[id]/action endpoint is a thin wrapper that
// auth-checks then calls dispatchAction().
//
// Design goals:
//   - Agents can introduce new actions without widget changes. Register
//     a handler under a "custom:<name>" key and widgets immediately work.
//   - Every successful action is logged to app_versions. Mirrors the
//     existing PATCH route's versioning discipline.
//   - Handlers receive the current App + SupabaseClient — they own the
//     mutation. Keeps this module about routing, not about SQL.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionKind } from "@/types/app-manifest";
import type { App, AppConfig, AppVersionInsert } from "@/types/app";
import { hydrateApp } from "@/types/app";
import type { AppRow } from "@/types/app";
import {
  appendAppSignal,
  patchAppConfig,
  reconcileAppWithKG,
} from "./app-updates";

// ── Types ──────────────────────────────────────────────────────────────

export interface ActionHandlerContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any> | any;
  userId: string;
  app: App;
  payload: Record<string, unknown>;
}

export interface ActionHandlerResult {
  ok: boolean;
  reason?: string;
  /** Updated App to return to the caller. */
  updated_app?: App;
  /** Optional extra payload for the widget to read (e.g. next-step hint). */
  extra?: Record<string, unknown>;
  /** Version row change-type. Defaults to "user_edit". */
  change_type?: AppVersionInsert["change_type"];
  /** Human summary written into app_versions.change_summary. */
  change_summary?: string;
  /**
   * Handlers that use Sprint 3 primitives (patchAppConfig, patchAppState,
   * appendAppSignal, reconcileAppWithKG) have ALREADY written an
   * app_versions row via those helpers — the dispatcher should skip its
   * own version write to prevent double-logging. Set this to true in those
   * handlers.
   */
  skip_version_log?: boolean;
}

export type ActionHandler = (
  ctx: ActionHandlerContext
) => Promise<ActionHandlerResult>;

// ── Handler registry ───────────────────────────────────────────────────

const handlers = new Map<string, ActionHandler>();

/**
 * Register an action handler. Accepts both built-in kinds and
 * `custom:<name>` dynamic ids.
 */
export function registerActionHandler(
  kind: ActionKind | string,
  handler: ActionHandler
): void {
  handlers.set(kind, handler);
}

export function getActionHandler(kind: string): ActionHandler | undefined {
  return handlers.get(kind);
}

// ── Built-in handlers ─────────────────────────────────────────────────

/**
 * log_observation — append a recent_signal to AppState.
 * Payload: { message: string; kind?: "alert"|"insight"|"opportunity"|"risk" }
 *
 * Delegates to `appendAppSignal` primitive so the 20-cap + version logging
 * happens in one place.
 */
registerActionHandler("log_observation", async (ctx) => {
  const msg = typeof ctx.payload.message === "string" ? ctx.payload.message : null;
  if (!msg) return { ok: false, reason: "message required" };
  const kind =
    typeof ctx.payload.kind === "string" &&
    ["alert", "insight", "opportunity", "risk"].includes(ctx.payload.kind)
      ? (ctx.payload.kind as "alert" | "insight" | "opportunity" | "risk")
      : "insight";

  const updated = await appendAppSignal(
    ctx.db,
    ctx.app.id,
    { kind, message: msg, at: new Date().toISOString() },
    `user:${ctx.userId}`
  );
  if (!updated) return { ok: false, reason: "Failed to append signal" };

  return {
    ok: true,
    updated_app: hydrateApp(updated),
    change_type: "user_edit",
    change_summary: `Logged observation: ${msg.slice(0, 80)}`,
    skip_version_log: true, // appendAppSignal already wrote one
  };
});

/**
 * complete_intervention — mark an intervention row status=completed.
 * Payload: { intervention_id: string }
 */
registerActionHandler("complete_intervention", async (ctx) => {
  const id =
    typeof ctx.payload.intervention_id === "string"
      ? ctx.payload.intervention_id
      : null;
  if (!id) return { ok: false, reason: "intervention_id required" };

  const { error } = await ctx.db
    .from("interventions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("app_id", ctx.app.id);
  if (error) return { ok: false, reason: error.message };

  return {
    ok: true,
    updated_app: ctx.app,
    change_type: "user_edit",
    change_summary: `Completed intervention ${id}`,
  };
});

/**
 * accept_agent_suggestion — merge a pending agent_hint patch into config.
 * Payload: { hint_at: string }  (timestamp identifying which hint)
 */
registerActionHandler("accept_agent_suggestion", async (ctx) => {
  const at = typeof ctx.payload.hint_at === "string" ? ctx.payload.hint_at : null;
  if (!at) return { ok: false, reason: "hint_at required" };

  const hints = ctx.app.config.agent_hints ?? [];
  const hint = hints.find((h) => h.recorded_at === at);
  if (!hint) return { ok: false, reason: "hint not found" };

  // For now: just mark this hint as accepted by removing it. Sprint 3 will
  // widen this to apply a structured patch the agent attaches to the hint.
  const updated = await patchAppConfig(
    ctx.db,
    ctx.app.id,
    { agent_hints: hints.filter((h) => h.recorded_at !== at) },
    `user:${ctx.userId}`,
    `Accepted agent suggestion from ${hint.agent}`
  );
  if (!updated) return { ok: false, reason: "Failed to patch config" };

  return {
    ok: true,
    updated_app: hydrateApp(updated),
    change_type: "user_edit",
    change_summary: `Accepted agent suggestion from ${hint.agent}`,
    skip_version_log: true,
  };
});

/**
 * reject_agent_suggestion — drop a pending agent_hint.
 * Payload: { hint_at: string }
 */
registerActionHandler("reject_agent_suggestion", async (ctx) => {
  const at = typeof ctx.payload.hint_at === "string" ? ctx.payload.hint_at : null;
  if (!at) return { ok: false, reason: "hint_at required" };

  const hints = ctx.app.config.agent_hints ?? [];
  const updated = await patchAppConfig(
    ctx.db,
    ctx.app.id,
    { agent_hints: hints.filter((h) => h.recorded_at !== at) },
    `user:${ctx.userId}`,
    "Dismissed agent suggestion"
  );
  if (!updated) return { ok: false, reason: "Failed to patch config" };

  return {
    ok: true,
    updated_app: hydrateApp(updated),
    change_type: "user_edit",
    change_summary: "Dismissed agent suggestion",
    skip_version_log: true,
  };
});

/**
 * request_agent_refresh — flag the app stale so Sprint 3's agent/research
 * loop picks it up on the next pass. NON-BLOCKING: returns immediately;
 * the app is "requested for update", not "reconciled now".
 *
 * (Previously named `refresh_app` — renamed so the distinction from
 * `reconcile_app` is explicit. `refresh_app` is kept as an alias.)
 */
const requestAgentRefreshHandler: ActionHandler = async (ctx) => {
  const { data: updated, error } = await ctx.db
    .from("apps")
    .update({
      stale_reason: "user_feedback",
      stale_since: new Date().toISOString(),
      last_updated_by: `user:${ctx.userId}`,
    })
    .eq("id", ctx.app.id)
    .select("*")
    .single();
  if (error) return { ok: false, reason: error.message };

  return {
    ok: true,
    updated_app: hydrateApp(updated as AppRow),
    change_type: "staleness_refresh",
    change_summary: "User requested agent refresh",
  };
};
registerActionHandler("request_agent_refresh", requestAgentRefreshHandler);
// Back-compat alias for manifests authored before the rename.
registerActionHandler("refresh_app", requestAgentRefreshHandler);

/**
 * reconcile_app — recompute the app's runtime state against the *current*
 * KG snapshot NOW, without waiting for an agent pass. Clears stale_reason.
 *
 * Shares implementation with POST /api/apps/:id/refresh via
 * `reconcileAppWithKG`. Semantic distinction:
 *   - `reconcile_app`         : synchronous, user-initiated "recompute now"
 *   - `request_agent_refresh` : asynchronous "flag for attention"
 */
registerActionHandler("reconcile_app", async (ctx) => {
  // Need the AppRow, not the hydrated App — reconcile helper takes Row
  // so it can read raw JSONB without re-narrowing.
  const { data: row } = (await ctx.db
    .from("apps")
    .select("*")
    .eq("id", ctx.app.id)
    .single()) as { data: AppRow | null };
  if (!row) return { ok: false, reason: "app not found" };

  const updated = await reconcileAppWithKG(ctx.db, row, `user:${ctx.userId}`);
  if (!updated) return { ok: false, reason: "Failed to reconcile" };

  return {
    ok: true,
    updated_app: hydrateApp(updated),
    change_type: "staleness_refresh",
    change_summary: "App reconciled with current KG",
    skip_version_log: true, // reconcileAppWithKG writes its own versions
  };
});

/**
 * apply_agent_patch — apply a partial AppConfig patch, typically targeting
 * `config.manifest` (the declarative UI spec). This is the seam Sprint 3's
 * agent write-back loop uses: agents emit JSON-patch-shaped updates to the
 * manifest rather than regenerating React code.
 *
 * Payload: { patch: Partial<AppConfig>; agent?: string; note?: string }
 */
registerActionHandler("apply_agent_patch", async (ctx) => {
  const patch = ctx.payload.patch as Partial<AppConfig> | undefined;
  if (!patch || typeof patch !== "object") {
    return { ok: false, reason: "patch (object) required" };
  }
  const agent =
    typeof ctx.payload.agent === "string" && ctx.payload.agent
      ? ctx.payload.agent
      : "unknown";
  const note =
    typeof ctx.payload.note === "string" ? ctx.payload.note : "config patch";

  const updated = await patchAppConfig(
    ctx.db,
    ctx.app.id,
    patch,
    `agent:${agent}`,
    `Agent patch (${agent}): ${note.slice(0, 80)}`
  );
  if (!updated) return { ok: false, reason: "Failed to patch config" };

  return {
    ok: true,
    updated_app: hydrateApp(updated),
    change_type: "agent_update",
    change_summary: `Agent patch (${agent}): ${note.slice(0, 80)}`,
    skip_version_log: true,
  };
});

// Nav-only actions — handled client-side. The server handler is a no-op
// that returns ok:true so client uniformly `await`s every dispatch.
const navHandler: ActionHandler = async (ctx) => ({
  ok: true,
  updated_app: ctx.app,
});
registerActionHandler("open_sub_whiteboard", navHandler);
registerActionHandler("focus_entity", navHandler);
registerActionHandler("focus_intervention", navHandler);
registerActionHandler("focus_goal", navHandler);

// ── Public entry point ────────────────────────────────────────────────

export interface DispatchActionInput {
  kind: ActionKind | string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any> | any;
  userId: string;
  app: App;
  payload?: Record<string, unknown>;
}

/**
 * Dispatch an action and (on success) write an app_versions row.
 * The endpoint wraps this with auth + request parsing.
 */
export async function dispatchAction(
  input: DispatchActionInput
): Promise<ActionHandlerResult> {
  const handler = getActionHandler(input.kind);
  if (!handler) {
    return { ok: false, reason: `Unknown action kind "${input.kind}"` };
  }

  const result = await handler({
    db: input.db,
    userId: input.userId,
    app: input.app,
    payload: input.payload ?? {},
  });

  if (!result.ok || !result.updated_app) return result;

  // Handlers that routed through Sprint 3 primitives have already written
  // their own app_versions row — skip to prevent double-logging.
  if (result.skip_version_log) return result;

  // Write the version row. Mirrors the PATCH route's pattern.
  try {
    const { data: maxVer } = await input.db
      .from("app_versions")
      .select("version")
      .eq("app_id", input.app.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxVer?.version ?? 0) + 1;

    await input.db.from("app_versions").insert({
      app_id: input.app.id,
      version: nextVersion,
      config_snapshot: result.updated_app.config,
      state_snapshot: result.updated_app.state,
      change_summary:
        result.change_summary ?? `Action: ${input.kind}`,
      change_type: result.change_type ?? "user_edit",
      changed_by: `user:${input.userId}`,
      change_payload: { action: input.kind, payload: input.payload ?? {} },
    });
  } catch (verErr) {
    // Non-fatal — version row is audit only.
    // eslint-disable-next-line no-console
    console.warn("[dispatchAction] version insert failed:", verErr);
  }

  return result;
}
