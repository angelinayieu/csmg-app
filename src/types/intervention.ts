// First-class Intervention domain type.
//
// Upstream producer: src/lib/pipeline/app-generator.ts materializes these from
// StrategicRecommendation.micro_tactics[] after strategy-refresh.
// Downstream consumers: dashboard "Interventions" column (Sprint 2),
// agent write-back loop (Sprint 3), per-app whiteboard nodes.
//
// Stable identity: (space_id, source_tactic_id) — regen upserts on this pair,
// so that a tactic keeping its id across re-runs keeps its Intervention row.

import type { Database } from "./database.types";

export type InterventionStatus =
  | "proposed"
  | "active"
  | "completed"
  | "superseded"
  | "abandoned";

export type InterventionEffort = "low" | "medium" | "high";
export type InterventionImpact = "low" | "medium" | "high";
export type InterventionTimeframe = "now" | "short_term" | "medium_term" | "long_term";
export type InterventionInfrastructureAction =
  | "build"
  | "strengthen"
  | "connect"
  | "monitor"
  | "configure";
export type InterventionImplementationCategory =
  | "proactive"
  | "reactive"
  | "course_correction";

/** Row shape as stored in Postgres — mirrors database.types.ts `interventions.Row`. */
export type InterventionRow = Database["public"]["Tables"]["interventions"]["Row"];
export type InterventionInsert = Database["public"]["Tables"]["interventions"]["Insert"];
export type InterventionUpdate = Database["public"]["Tables"]["interventions"]["Update"];

/**
 * Domain-level Intervention — what consumers (UI, agents) work with.
 * Adds derived/joined convenience fields on top of the row.
 */
export interface Intervention extends InterventionRow {
  /** Hydrated target entity name (joined from entities table, optional). */
  target_entity_name?: string | null;
  /** Hydrated name of the App this intervention is assigned to (joined, optional). */
  app_name?: string | null;
}
