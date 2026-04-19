// Per-user App preferences — read path + merge-into-manifest helper.
//
// This layer is how a user's "hide this widget", "pin that one", "make
// this app compact" persist without touching the canonical manifest the
// agent maintains. Canonical manifest is produced by app-generator.ts and
// patched by Sprint 3's `apply_agent_patch` action; preferences layer
// on top at render time.
//
// Precedence (highest first):
//   1. Per-app preferences (app_id match)
//   2. Per-type preferences (app_type match — template-level defaults)
//   3. Canonical manifest
//
// Scope resolution is the caller's responsibility: `getEffectivePreferences()`
// takes both rows and merges them for consumers.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AppType } from "@/types/app";
import type { AppManifest, WidgetInstance } from "@/types/app-manifest";
import type {
  AppPreferences,
  AppPreferencesRow,
  InteractionCounts,
} from "@/types/app-preferences";
import { asAppPreferences, asInteractionCounts } from "@/types/app-preferences";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

// ── Load ──────────────────────────────────────────────────────────────

export interface LoadedPreferences {
  effective: AppPreferences;          // merged per-app + per-type
  app_row: AppPreferencesRow | null;  // raw per-app row (null if unset)
  type_row: AppPreferencesRow | null; // raw per-type row (null if unset)
  interaction_counts: InteractionCounts;
}

/**
 * Load the effective AppPreferences for a user × app × app_type.
 * Soft-fail: on DB errors returns empty preferences so the renderer still works.
 */
export async function loadAppPreferences(
  db: DB,
  userId: string,
  appId: string,
  appType: AppType
): Promise<LoadedPreferences> {
  try {
    // Two targeted lookups (one by app_id, one by app_type) — both hit
    // indexed columns so this is a cheap pair of single-row selects.
    const [appRes, typeRes] = await Promise.all([
      db
        .from("user_app_preferences")
        .select("*")
        .eq("user_id", userId)
        .eq("app_id", appId)
        .maybeSingle(),
      db
        .from("user_app_preferences")
        .select("*")
        .eq("user_id", userId)
        .eq("app_type", appType)
        .is("app_id", null)
        .maybeSingle(),
    ]);

    const appRow = (appRes.data ?? null) as AppPreferencesRow | null;
    const typeRow = (typeRes.data ?? null) as AppPreferencesRow | null;

    const typePrefs = asAppPreferences(typeRow?.preferences);
    const appPrefs = asAppPreferences(appRow?.preferences);

    return {
      effective: mergePreferences(typePrefs, appPrefs),
      app_row: appRow,
      type_row: typeRow,
      interaction_counts: asInteractionCounts(appRow?.interaction_counts),
    };
  } catch (err) {
    console.warn("[preferences] load failed — falling back to empty:", err);
    return {
      effective: {},
      app_row: null,
      type_row: null,
      interaction_counts: {},
    };
  }
}

/**
 * Shallow-merge two AppPreferences objects. Per-app wins over per-type
 * for scalar fields; array fields are unioned (never lossy).
 */
export function mergePreferences(
  low: AppPreferences,
  high: AppPreferences
): AppPreferences {
  return {
    hidden_widget_ids: unionArrays(low.hidden_widget_ids, high.hidden_widget_ids),
    pinned_widget_ids: unionArrays(low.pinned_widget_ids, high.pinned_widget_ids),
    widget_overrides: {
      ...(low.widget_overrides ?? {}),
      ...(high.widget_overrides ?? {}),
    },
    layout: { ...(low.layout ?? {}), ...(high.layout ?? {}) },
    theme: { ...(low.theme ?? {}), ...(high.theme ?? {}) },
  };
}

function unionArrays<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!a && !b) return undefined;
  const set = new Set<T>();
  for (const v of a ?? []) set.add(v);
  for (const v of b ?? []) set.add(v);
  return Array.from(set);
}

// ── Apply (pure) ──────────────────────────────────────────────────────

/**
 * Return a new AppManifest with the user's preferences applied.
 * Pure — does not mutate the input manifest. Called by the AppRenderer
 * right after the manifest is loaded + validated.
 */
export function applyPreferencesToManifest(
  manifest: AppManifest,
  prefs: AppPreferences
): AppManifest {
  const hidden = new Set(prefs.hidden_widget_ids ?? []);
  const pinned = new Set(prefs.pinned_widget_ids ?? []);
  const overrides = prefs.widget_overrides ?? {};

  // 1. Filter hidden widgets.
  const surviving = manifest.widgets.filter((w) => !hidden.has(w.id));

  // 2. Apply per-widget overrides (slot/config/initial_expanded).
  const overridden = surviving.map((w): WidgetInstance => {
    const o = overrides[w.id];
    if (!o) return w;
    return {
      ...w,
      slot: o.slot ? { ...w.slot, ...o.slot } : w.slot,
      config: o.config
        ? { ...(w.config as Record<string, unknown> ?? {}), ...o.config }
        : w.config,
      initial_expanded:
        o.initial_expanded != null ? o.initial_expanded : w.initial_expanded,
    };
  });

  // 3. Pinned widgets float to the top of column 1 with a very low `order`.
  // Only affects ordering; doesn't move widgets to a different column.
  const promoted = overridden.map((w, i): WidgetInstance => {
    if (!pinned.has(w.id)) return w;
    return {
      ...w,
      slot: {
        ...(w.slot ?? {}),
        order: (w.slot?.order ?? 0) - 1000 + i, // stable ordering among pinned
      },
    };
  });

  // 4. Layout overrides.
  const nextLayout = {
    ...manifest.layout,
    ...(prefs.layout ?? {}),
  };

  return {
    ...manifest,
    widgets: promoted,
    layout: nextLayout,
  };
}

// ── Write path ────────────────────────────────────────────────────────

export interface UpsertPreferencesInput {
  userId: string;
  /** Exactly one of appId / appType must be set. */
  appId?: string | null;
  appType?: AppType | null;
  patch: AppPreferences;
  /** Optional: merge or replace. Default "merge". */
  mode?: "merge" | "replace";
}

/**
 * Upsert a user's preferences for a specific app or app-type.
 * Handles the XOR scope constraint and does a safe read-modify-write
 * when mode === "merge" (the default).
 */
export async function upsertAppPreferences(
  db: DB,
  input: UpsertPreferencesInput
): Promise<AppPreferencesRow | null> {
  const { userId, appId, appType, patch, mode = "merge" } = input;
  if ((!appId && !appType) || (appId && appType)) {
    throw new Error("Exactly one of appId or appType must be provided");
  }

  try {
    let existing: AppPreferencesRow | null = null;
    if (appId) {
      const { data } = await db
        .from("user_app_preferences")
        .select("*")
        .eq("user_id", userId)
        .eq("app_id", appId)
        .maybeSingle();
      existing = (data ?? null) as AppPreferencesRow | null;
    } else if (appType) {
      const { data } = await db
        .from("user_app_preferences")
        .select("*")
        .eq("user_id", userId)
        .eq("app_type", appType)
        .is("app_id", null)
        .maybeSingle();
      existing = (data ?? null) as AppPreferencesRow | null;
    }

    const nextPreferences: AppPreferences =
      mode === "replace"
        ? patch
        : mergePreferences(asAppPreferences(existing?.preferences), patch);

    if (existing) {
      const { data: updated } = await db
        .from("user_app_preferences")
        .update({ preferences: nextPreferences })
        .eq("id", existing.id)
        .select("*")
        .single();
      return (updated ?? null) as AppPreferencesRow | null;
    } else {
      const { data: inserted } = await db
        .from("user_app_preferences")
        .insert({
          user_id: userId,
          app_id: appId ?? null,
          app_type: appType ?? null,
          preferences: nextPreferences,
        })
        .select("*")
        .single();
      return (inserted ?? null) as AppPreferencesRow | null;
    }
  } catch (err) {
    console.warn("[preferences] upsert failed:", err);
    return null;
  }
}

/**
 * Increment interaction counters for a specific widget on a specific app.
 * Cheap atomic-ish update: read-modify-write in one statement via JSONB
 * merge. Agents later consume these counts to propose preference changes.
 */
export async function recordWidgetInteraction(
  db: DB,
  userId: string,
  appId: string,
  widgetId: string
): Promise<void> {
  try {
    // Load the row (or prepare to create it).
    const { data: existing } = await db
      .from("user_app_preferences")
      .select("*")
      .eq("user_id", userId)
      .eq("app_id", appId)
      .maybeSingle();

    const prior = asInteractionCounts((existing as AppPreferencesRow | null)?.interaction_counts);
    const next = { ...prior, [widgetId]: (prior[widgetId] ?? 0) + 1 };

    if (existing) {
      await db
        .from("user_app_preferences")
        .update({
          interaction_counts: next,
          last_interaction_at: new Date().toISOString(),
        })
        .eq("id", (existing as AppPreferencesRow).id);
    } else {
      await db.from("user_app_preferences").insert({
        user_id: userId,
        app_id: appId,
        preferences: {},
        interaction_counts: next,
        last_interaction_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn("[preferences] interaction record failed:", err);
  }
}
