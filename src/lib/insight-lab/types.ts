// ── Insight Lab — shared types ─────────────────────────────────────────
//
// The lab runs algorithm "stacks" (ordered lists of registered algorithms)
// over a space's graph and produces a flat list of `Insight` rows. Each
// insight carries provenance back to the step that produced it so the UI
// (and later, the auto-experimenter agent) can explain why an insight
// surfaced.
//
// The contract here is deliberately narrow:
//   - `AlgoDef` per algorithm with its own input/output types
//   - `runStack` plumbs unknown through, each AlgoDef knows its own shape
//   - `Insight` is the lingua franca — every algorithm's native output
//     gets converted into Insight[] via `toInsights` for ranking/scoring

import type { Entity, Edge, Space } from "@/types";

// ── Algorithm registry ─────────────────────────────────────────────────

export type AlgoCategory = "structural" | "semantic" | "hybrid";

/** Catalog of registered algorithms. Extending this requires (1) adding
 *  the id here, (2) registering an `AlgoDef` in registry.ts, (3) optionally
 *  adding an InsightKind below if the algorithm produces a new shape. */
export type AlgoId =
  | "preliminary-insights";

/** Insight discriminator. Each algorithm produces one or more kinds.
 *  Adding a kind here also requires extending the `kind` CHECK constraint
 *  in the lab_insights migration. */
export type InsightKind =
  | "hub"
  | "bridge"
  | "cluster"
  | "cycle"
  | "community"
  | "cascade"
  | "pathway"
  | "tier";

// ── Insights ───────────────────────────────────────────────────────────

export interface Provenance {
  algoId: AlgoId;
  /** Position of the producing step within the stack (0-indexed). */
  stepIdx: number;
  /** Optional native algorithm output for this insight. Useful for
   *  debug + future re-scoring without re-running the algorithm. */
  raw?: unknown;
}

export interface Insight {
  /** Stable per-experiment id. Same insight in two re-runs of the same
   *  stack on the same graph produces the same id, so persistence can
   *  upsert via (experiment_id, insight_key). */
  id: string;
  kind: InsightKind;
  /** One-line human-readable summary. The string the goal-match scorer
   *  embeds and the UI displays. */
  summary: string;
  /** Entities this insight references. Soft links — entities may be
   *  deleted after persistence. */
  entityIds: string[];
  /** Kind-specific structured detail (degree, jaccard, length, ...). */
  detail?: Record<string, unknown>;
  provenance: Provenance;
}

// ── Stack configuration ────────────────────────────────────────────────

export interface StackStep {
  algoId: AlgoId;
  /** Per-step parameter overrides. Merged on top of `AlgoDef.defaultParams`. */
  params?: Record<string, unknown>;
}

export interface StackConfig {
  id: string;
  name: string;
  description?: string;
  steps: StackStep[];
}

// ── Run context ────────────────────────────────────────────────────────

/** Everything an algorithm might need from the space. Adapters in
 *  registry entries pull only the slice they care about. */
export interface SpaceCtx {
  space: Space;
  entities: Entity[];
  edges: Edge[];
}

// ── Algorithm definition ───────────────────────────────────────────────

export interface AlgoDef<
  TIn = unknown,
  TParams extends Record<string, unknown> = Record<string, unknown>,
  TOut = unknown,
> {
  id: AlgoId;
  name: string;
  description: string;
  category: AlgoCategory;
  /** Defaults are merged with any per-step overrides; result is passed
   *  to `run`. Empty object is fine for parameter-less algorithms. */
  defaultParams: TParams;
  /** Pull the slice of the graph this algorithm needs. */
  adapter: (ctx: SpaceCtx) => TIn;
  /** Run the algorithm on the adapted input. Sync or async. */
  run: (input: TIn, params: TParams) => Promise<TOut> | TOut;
  /** Convert the algorithm's native output into flat Insight[]. */
  toInsights: (output: TOut, ctx: SpaceCtx, stepIdx: number) => Insight[];
}

/** Type-erased AlgoDef used by the registry map and executor. The
 *  `defineAlgo` helper in registry.ts preserves concrete types at the
 *  registration site while exposing this looser shape to consumers. */
export type AnyAlgoDef = AlgoDef<unknown, Record<string, unknown>, unknown>;

// ── Stack execution result ─────────────────────────────────────────────

export interface StepResult {
  stepIdx: number;
  algoId: AlgoId;
  insightCount: number;
  durationMs: number;
  error?: string;
}

export interface StackResult {
  stackId: string;
  spaceId: string;
  insights: Insight[];
  stepResults: StepResult[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}
