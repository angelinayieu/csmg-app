// ── Phase 52 — unified knowledge event logger ──
//
// The audit (after Phase 49) found that `space_changelog` only sees
// ~50% of semantic mutations: decompose / synthesis / research / manual
// edits log, but reactions, brainstorm materializations, file ingests,
// and app state changes do not. Anything reading the changelog (the
// dashboard, scheduled refreshes, future automations) is blind to half
// of what users actually do.
//
// Quick fix without a migration: reuse `space_changelog` with
// `change_type: "manual_edit"` and encode the actual event kind in
// `details.subtype`. A future migration can promote subtypes to
// first-class enum values; nothing in the consumer layer breaks if we
// do that later because `subtype` will still be present.
//
// Subtype taxonomy (consumed by feed surfaces + future automations):
//
//   reaction_saved          — POST /api/canvas/reactions
//   brainstorm_materialized — POST /api/whiteboard/playground/materialize
//   ingest_completed        — file/url ingest pipeline complete
//   app_state_changed       — apps.config or apps.state mutated
//   entity_decomposed       — manual recursive-decompose (canvas rings)
//   entities_undone         — bulk-delete from receipts undo
//
// Adding a new subtype = one line in the SubType union below + call
// sites that emit it. Consumers filter on details.subtype.

import type { Database, Json } from "@/types/database.types";

export type KnowledgeEventSubtype =
  | "reaction_saved"
  | "brainstorm_materialized"
  | "ingest_completed"
  | "app_state_changed"
  | "entity_decomposed"
  | "entities_undone";

export interface LogKnowledgeEventInput {
  spaceId: string;
  subtype: KnowledgeEventSubtype;
  /** Short imperative summary, e.g. "Saved reaction 'Customer LTV emerges from retention'". */
  summary: string;
  /** Optional structured payload merged into details alongside subtype. */
  details?: Record<string, unknown>;
  /**
   * Best-effort: silent on failure. Logging must never break the user
   * action. Errors are console.warn'd but not thrown.
   */
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

/**
 * Append a knowledge event to space_changelog. Failures are swallowed
 * after warning so a hiccup in the changelog never breaks the user
 * action that triggered it.
 */
export async function logKnowledgeEvent(
  supabase: SupabaseLike,
  input: LogKnowledgeEventInput,
): Promise<void> {
  if (!input.spaceId || typeof input.spaceId !== "string") return;
  try {
    const details: Json = {
      subtype: input.subtype,
      ...(input.details ?? {}),
    } as Json;
    type ChangelogInsert = Database["public"]["Tables"]["space_changelog"]["Insert"];
    const row: ChangelogInsert = {
      space_id: input.spaceId,
      change_type: "manual_edit",
      summary: input.summary,
      details,
    };
    await (supabase as SupabaseLike).from("space_changelog").insert(row);
  } catch (err) {
    console.warn("[knowledge-event log] non-fatal:", err);
  }
}
