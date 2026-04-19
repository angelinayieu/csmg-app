// Per-user App preferences — a personalization layer on top of an App's
// canonical manifest. Merged at render time by src/lib/apps/preferences.ts;
// the canonical manifest stays agent-authored, never clobbered.
//
// Scope: either specific to an app_id, or templated to an app_type.
// See migration 20260429_user_app_preferences.sql.

import type { Database } from "./database.types";
import type { AppType } from "./app";
import type { AppLayoutKind, WidgetType } from "./app-manifest";

export type AppPreferencesRow =
  Database["public"]["Tables"]["user_app_preferences"]["Row"];
export type AppPreferencesInsert =
  Database["public"]["Tables"]["user_app_preferences"]["Insert"];
export type AppPreferencesUpdate =
  Database["public"]["Tables"]["user_app_preferences"]["Update"];

/**
 * Structured shape for the `preferences` JSONB column.
 *
 * Every field is OPTIONAL. A missing key means "use the manifest's value".
 * Adding a new preference key should never require a migration — the column
 * is JSONB and consumers read defensively.
 */
export interface AppPreferences {
  /** Hide specific widgets by id. Renderer drops matching widgets from the layout. */
  hidden_widget_ids?: string[];

  /**
   * Per-widget overrides, keyed by widget id. Shallow-merges into the
   * widget's own config. Unknown keys are passed through to the widget.
   */
  widget_overrides?: Record<
    string,
    {
      /** Override slot hint (column/span/order) per widget. */
      slot?: {
        column?: 1 | 2 | 3 | 4;
        span?: 1 | 2 | 3 | 4;
        order?: number;
      };
      /** Override widget config values (merged shallowly). */
      config?: Record<string, unknown>;
      /** Force expanded/collapsed initial state. */
      initial_expanded?: boolean;
    }
  >;

  /**
   * Layout-level overrides — applied to manifest.layout.
   * Useful for "this user prefers compact density on every dashboard".
   */
  layout?: {
    kind?: AppLayoutKind;
    columns?: 1 | 2 | 3 | 4;
    density?: "cozy" | "compact" | "comfortable";
  };

  /**
   * Theme overrides — applied to config.theme.
   * Keep narrow; don't let preferences become a full stylesheet.
   */
  theme?: {
    accent?: string;
    icon?: string;
  };

  /** User-authored pinned widget ids — hoisted to the top on render. */
  pinned_widget_ids?: string[];
}

/**
 * Interaction counters (the second JSONB column). Keys are widget ids;
 * values are interaction counts since the last reset. Agents read these
 * to decide what to propose (e.g. pin a frequently-clicked widget).
 */
export type InteractionCounts = Record<string, number>;

/** Widget types are excluded from some merges (e.g. divider preferences don't apply). */
export const NON_CONFIGURABLE_WIDGET_TYPES: WidgetType[] = ["divider"];

/**
 * Helper: safely coerce the JSONB preferences column.
 */
export function asAppPreferences(v: unknown): AppPreferences {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as AppPreferences;
}

export function asInteractionCounts(v: unknown): InteractionCounts {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: InteractionCounts = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
  }
  return out;
}

/** Re-export for convenience at call sites. */
export type { AppType };
