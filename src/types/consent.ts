/**
 * Phase 4a: User consent manifest.
 *
 * The user declares which categories of personal data they're comfortable having
 * the app track. The strategy-confirm flow filters tracker creation against this
 * manifest so we never materialize metrics that touch a data category the user
 * hasn't opted into.
 *
 * Foundational for the Unified Proxy Framework (UPF). Later phases (active proxy
 * selection, calibration, information-gain) consume `friction_budget` and
 * `escalation_policy` to choose the cheapest proxy under the user's constraints.
 */

export type DataCategory =
  | "mood_energy"
  | "time_tracking"
  | "financial"
  | "health_signals"
  | "relationships"
  | "professional_performance"
  | "creative_output"
  | "environment"
  | "generic";

export type DepthTier = "light" | "mid" | "heavy";

export type EscalationPolicy =
  | "ask_each_time"
  | "auto_if_value_above_x"
  | "never_escalate";

export interface ConsentManifest {
  user_id: string;
  consent_map: Partial<Record<DataCategory, boolean>>;
  friction_budget: number; // 1-10; how much friction/day the user tolerates
  escalation_policy: EscalationPolicy;
  updated_at: string;
  created_at?: string;
}

export const ALL_DATA_CATEGORIES: DataCategory[] = [
  "mood_energy",
  "time_tracking",
  "professional_performance",
  "creative_output",
  "generic",
  "financial",
  "health_signals",
  "relationships",
  "environment",
];

export const DATA_CATEGORY_META: Record<
  DataCategory,
  {
    label: string;
    description: string;
    /** Whether this category is opted-in for a brand-new user. */
    default_allow: boolean;
    /** Rough sensitivity grouping — used by the UI to group checkboxes. */
    sensitivity: "low" | "medium" | "high";
  }
> = {
  mood_energy: {
    label: "Mood & energy",
    description: "Self-reported mood, energy, focus, stress",
    default_allow: true,
    sensitivity: "low",
  },
  time_tracking: {
    label: "Time & schedule",
    description: "Calendar entries, time logs, how long tasks took",
    default_allow: true,
    sensitivity: "low",
  },
  professional_performance: {
    label: "Work performance",
    description: "Work output, project completion, deliverables shipped",
    default_allow: true,
    sensitivity: "low",
  },
  creative_output: {
    label: "Creative output",
    description: "Writing, code commits, artistic production",
    default_allow: true,
    sensitivity: "low",
  },
  generic: {
    label: "Generic counts & scores",
    description: "Non-personal metrics like quality scores, completion counts",
    default_allow: true,
    sensitivity: "low",
  },
  financial: {
    label: "Financial metrics",
    description: "Revenue, spending, budgets, account balances",
    default_allow: false,
    sensitivity: "high",
  },
  health_signals: {
    label: "Health signals",
    description: "Sleep quality, HRV, steps, heart rate, biological data",
    default_allow: false,
    sensitivity: "high",
  },
  relationships: {
    label: "Relationships",
    description: "Social quality, conversations, connection frequency",
    default_allow: false,
    sensitivity: "high",
  },
  environment: {
    label: "Environment",
    description: "Location, weather, commute, ambient conditions",
    default_allow: false,
    sensitivity: "medium",
  },
};

/** Returns the default consent_map seeded for a brand-new user. */
export function defaultConsentMap(): Record<DataCategory, boolean> {
  const out = {} as Record<DataCategory, boolean>;
  for (const cat of ALL_DATA_CATEGORIES) {
    out[cat] = DATA_CATEGORY_META[cat].default_allow;
  }
  return out;
}

/**
 * Given a partial consent_map loaded from the DB, return a complete map with
 * defaults applied for any categories missing from the stored value.
 */
export function completeConsentMap(
  stored: Partial<Record<DataCategory, boolean>> | null | undefined,
): Record<DataCategory, boolean> {
  const defaults = defaultConsentMap();
  if (!stored) return defaults;
  return { ...defaults, ...stored };
}
