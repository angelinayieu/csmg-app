// ── Cross-room Analysis: types ────────────────────────────────────
//
// Shared shapes for the analysis workbench. Every analysis module
// produces AnalysisFinding[] (cheap or LLM-driven). The orchestrator
// collects them into a CrossRoomAnalysisState that lives under
// spaces.synthesis_data.cross_room_analysis (no migration).

import type { ObjectiveAnnotation } from "../generate-annotations";
import type { AnnotationProvenance } from "../layered-generation";
import type {
  ExpandedItemDetail,
  ItemVariation,
  ComposedDesign,
} from "../expand-item-detail";
import type { OperationalConstraints } from "../constraints";
import type { IntentPreference } from "../decision-log";

/** Buckets a finding belongs to — drives the workbench's facet tabs. */
export type AnalysisCategory =
  | "friction"
  | "redundancy"
  | "gap"
  | "bottleneck"
  | "priority"
  | "structure"
  | "theme";

/** How loud a finding should be. critical = top-of-strip; info = quiet. */
export type AnalysisSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

/** User can mark a finding as one of these. Persisted with the
 *  finding so it survives rescans (matched by analysis_key + key
 *  references, not by id). */
export type FindingDisposition =
  | "open"
  | "acknowledged"
  | "resolved"
  | "dismissed";

/** A single finding produced by an analysis module. */
export interface AnalysisFinding {
  /** Stable id — deterministic from analysis_key + sorted references
   *  so the same finding gets the same id across rescans. */
  id: string;
  analysis_key: string;
  category: AnalysisCategory;
  severity: AnalysisSeverity;
  tier: 1 | 2 | 3;
  /** Short headline (≤ 80 chars). */
  title: string;
  /** One-sentence summary. */
  summary: string;
  /** Free-shape body — per-analysis (e.g. shared mechanism stores the
   *  mechanism text + room ids it appears in). */
  body: Record<string, unknown>;
  /** Cross-references to rooms + items the finding touches. */
  references: {
    room_ids: string[];
    item_ids: string[];
  };
  /** User state — defaulted "open" on first emit. */
  disposition: FindingDisposition;
  generated_at: string;
}

/** Cached scan output persisted on the space. */
export interface CrossRoomAnalysisState {
  /** Hash of the input state — when it changes, cached findings are stale. */
  state_hash: string;
  scanned_at: string;
  findings: AnalysisFinding[];
}

// ── Input state — what analyses read ──────────────────────────────

/** Per-item snapshot used by analyses. Variations + elections are
 *  pre-extracted so analyses don't all have to parse expanded_detail. */
export interface ItemSnapshot {
  id: string;
  room_id: string;
  name: string;
  layer: "pain" | "features" | "outcomes" | "objective";
  causal_chain: Record<string, unknown> | null;
  expanded_detail: ExpandedItemDetail | null;
  /** Convenience: ids of variations the user elected. */
  elected_variation_ids: string[];
  /** Convenience: 1-based lens indices this item derives from.
   *  WARNING: indices are FRAGILE — they reference positional slots
   *  in the weight-sorted lens at GENERATION time. If annotations
   *  are regenerated (deepen / synthesize), the weight order can
   *  shift and these indices will point at different annotations.
   *  Prefer derived_from_annotation_phrases for cross-system
   *  matching (coverage, orphan detection, etc); keep indices only
   *  for display continuity. */
  derived_from_annotation_indices: number[];
  /** Phase-2 stability fix — the actual phrase strings the LLM
   *  cited, persisted alongside indices on every item. Robust to
   *  lens reordering. ALL coverage / orphan / overlap analyses
   *  SHOULD match on this, not on indices. Lowercase + trimmed
   *  for case-insensitive matching at compute time. */
  derived_from_annotation_phrases: string[];
}

export interface EdgeSnapshot {
  id: string;
  room_id: string;
  source_entity_id: string;
  target_entity_id: string;
  strength: number | null;
  mechanism: string | null;
  derived_from_annotation: AnnotationProvenance | null;
}

export interface RoomSnapshot {
  id: string;
  title: string;
  description: string | null;
  top_negative_outcome: string | null;
  generated_at: string | null;
}

/** Everything an analysis module needs. The state loader assembles
 *  this once per scan. */
export interface CrossRoomState {
  space_id: string;
  core_objective_text: string;
  /** Parent objective annotations, weight-sorted. Index N in this
   *  array corresponds to 1-based lens index N+1 throughout the
   *  system (mirrors the generator's lensForResolution). */
  parent_annotations: ObjectiveAnnotation[];
  constraints: OperationalConstraints | null;
  rooms: RoomSnapshot[];
  items: ItemSnapshot[];
  edges: EdgeSnapshot[];
  /** Per-user decision-log signal — election-rate-per-intent across
   *  the user's history. Optional: only populated when the caller
   *  passes a userId to loadCrossRoomState. Analyses that read it
   *  should tolerate undefined for back-compat with older callers. */
  user_intent_preferences?: IntentPreference[];
}

// ── Analysis module shape ─────────────────────────────────────────

/** Where in the user flow this analysis fires. */
export type AnalysisTrigger =
  | "auto_on_scan" // Tier 1 — runs synchronously during scan
  | "on_demand"; // Tier 2/3 — user clicks "Run"

export interface AnalysisModule {
  key: string;
  label: string;
  description: string;
  category: AnalysisCategory;
  tier: 1 | 2 | 3;
  trigger: AnalysisTrigger;
  /** Pure function over CrossRoomState. Tier 1 stays sync-shaped via
   *  Promise.resolve; Tier 2/3 awaits an LLM call. */
  run(state: CrossRoomState): Promise<AnalysisFinding[]>;
}

// ── Helpers re-exported for analysis modules ──────────────────────

export type {
  ObjectiveAnnotation,
  AnnotationProvenance,
  ExpandedItemDetail,
  ItemVariation,
  ComposedDesign,
  OperationalConstraints,
  IntentPreference,
};
