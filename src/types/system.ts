// ── System types (Phase 4 — saved subgraph as first-class) ──────────
//
// A `system` is a named, saved subgraph: a curated set of entities
// and the edges between them that the user wants to treat as a
// coherent unit. Mirrors `public.systems` row shape one-to-one with
// camelCase property names plus a few derived helpers.
//
// Why this primitive exists:
//   The codebase has many graph surfaces (per-axis shells, synthesis
//   intersection, root-cause atlas, the merged KG, per-app sub-KGs)
//   but no shared abstraction for "this specific cluster IS a system
//   I care about." Without it, the lab can only experiment against
//   pre-defined scopes (whole space / single entity / single proposal).
//   With it, the user can dissect arbitrary subgraphs they discovered
//   (a cycle, a convergent point, a root-cause subtree) and treat
//   them as the unit of analysis.
//
// See:
//   - supabase/migrations/20260607_systems.sql (schema)
//   - src/lib/systems/classify-system.ts (auto-classification helper)
//   - src/app/api/spaces/[id]/systems/route.ts (list + create)
//   - src/app/api/systems/[id]/route.ts (detail + patch + delete)

/** Provenance — how this system was first surfaced. Drives icon +
 *  labeling on the browse page. */
export type SystemSourceKind =
  | "cycle"
  | "convergent_point"
  | "root_cause_subtree"
  | "mechanism"
  | "user_lasso"
  | "manual";

/** Lifecycle state. Archived systems are hidden from default browse
 *  but preserved (kept around so prior analysis isn't lost). */
export type SystemStatus = "active" | "archived";

/** Per-row label pair for source_kind. UI uses these for chip text
 *  + tooltips so the inference is visible to the user. */
export const SYSTEM_SOURCE_LABEL: Record<SystemSourceKind, string> = {
  cycle: "Feedback loop",
  convergent_point: "Convergence",
  root_cause_subtree: "Root-cause branch",
  mechanism: "Mechanism",
  user_lasso: "User selection",
  manual: "Hand-crafted",
};

/** Auto-classification triple — see classify-system.ts for the
 *  derivation rules. All three booleans are computed at save time
 *  (and on update); not user-editable. */
export interface SystemClassification {
  /** True if any entity has a cross-axis link or bridge to outside
   *  the system. Open systems require external-signal monitoring. */
  is_open: boolean;
  /** True if median edge confidence < 0.5. Probabilistic systems
   *  need MC simulation rather than analytical reasoning. */
  is_probabilistic: boolean;
  /** True if the system contains at least one detected cycle.
   *  Complex systems require iterative experimentation. */
  is_complex: boolean;
}

export interface System extends SystemClassification {
  id: string;
  space_id: string;
  user_id: string;

  name: string;
  description: string | null;

  /** UUID arrays — composition. Edges in `edge_ids` MUST connect
   *  two entities also in `entity_ids` (enforced at write time). */
  entity_ids: string[];
  edge_ids: string[];

  source_kind: SystemSourceKind;
  /** Backref to the source row when single-canonical (cycle.id /
   *  convergent_points.id / mechanisms.id). Null for lasso/manual. */
  source_ref_id: string | null;

  /** Optional improvement-goal this system is being analyzed against.
   *  Lets the systems page show "for goal X" grouping. */
  objective_id: string | null;

  /** Cached summary stats. Updated when entity_ids/edge_ids change. */
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  median_edge_confidence: number | null;

  status: SystemStatus;
  created_at: string;
  updated_at: string;
}

/** POST body for creating a system. Only the curated identity +
 *  composition; classification + summary stats are computed server-
 *  side and never accepted from the client. */
export interface CreateSystemInput {
  name: string;
  description?: string | null;
  entity_ids: string[];
  edge_ids?: string[];
  source_kind: SystemSourceKind;
  source_ref_id?: string | null;
  objective_id?: string | null;
}

/** PATCH body for updating a system. Recomputes classification
 *  whenever entity_ids or edge_ids change. */
export interface UpdateSystemInput {
  name?: string;
  description?: string | null;
  entity_ids?: string[];
  edge_ids?: string[];
  objective_id?: string | null;
  status?: SystemStatus;
}

/** GET /api/spaces/[id]/systems response shape. */
export interface ListSystemsResponse {
  systems: System[];
  computed_at: string;
}

/** GET /api/systems/[id] response — system + hydrated entities/edges
 *  for detail rendering. */
export interface SystemDetailResponse {
  system: System;
  /** Hydrated entity rows for the entity_ids array. */
  entities: import("@/types").Entity[];
  /** Hydrated edge rows for the edge_ids array. */
  edges: import("@/types").Edge[];
  /** Cycles whose entity_ids fully sit inside this system's entity_ids.
   *  Used by the lab to render feedback-loop overlays. */
  contained_cycles: Array<{
    id: string;
    classification: string;
    entity_ids: string[];
  }>;
}
