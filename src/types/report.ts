// ── Report types (Phase 3 — frozen VP Project snapshots) ──────────
//
// Mirrors `supabase/migrations/20260423_reports.sql`.
//
// A Report is an immutable bundle of everything the VP Project widgets
// need in order to render. See src/lib/apps/frozen-resolver.ts for the
// factory that turns a ReportPayload into a ResolverTable.

import type { App } from "./app";
import type { AppManifest } from "./app-manifest";
import type { Intervention } from "./intervention";
import type { AppStrategy } from "./app-strategy";
import type {
  ExperimentTaxonomy,
  ExperimentVariant,
  VariantWithSlots,
} from "./experiment-taxonomy";
import type { LatentVariable, VariantOutcomeScore } from "./variant-outcomes";
import type { ImprovementGoal } from "./goals";
import type { StrategyBaselineRow, PredictionLedgerRow } from "./prediction";
import type { NodeSignature } from "./node-signature";

/**
 * The full frozen bundle a report captures. Every key maps to one (or a
 * tight group of) DataSourceKind(s) the VP Project widgets bind to.
 *
 * Values are stored as raw DB row shapes so the frozen resolver can hand
 * them back without re-hydration. Anything that needs per-page compose
 * (e.g. DownstreamReality) is composed at freeze time and stored.
 */
export interface ReportPayload {
  /** Full app row at the moment of freeze — used as the default context
   *  for resolvers that read from ctx.app (e.g. literal selectors). */
  app_snapshot: App | null;

  /** synthesis_data from the parent space — powers causal_chains,
   *  ranked_strategies, synthesis_leverage, synthesis_risks,
   *  synthesis_scenarios, action_plan. */
  synthesis: Record<string, unknown> | null;

  interventions: Intervention[];

  /** Sub-strategy (per-app spec) at freeze time, if one existed. */
  app_strategy: AppStrategy | null;

  // ── Phase 3 VP Project sources ────────────────────────────────────
  taxonomy: ExperimentTaxonomy | null;
  variants: ExperimentVariant[];
  active_variant: VariantWithSlots | null;
  latent_variables: LatentVariable[];
  variant_outcome_scores: VariantOutcomeScore[];
  improvement_goals: ImprovementGoal[];

  // ── Digital-twin sources frozen alongside so lab widgets still work
  //    on a frozen report without live DB reads.
  strategy_baseline: StrategyBaselineRow | null;
  predictions: PredictionLedgerRow[];

  // ── Batch 8 — canonical node signatures captured at freeze time ─────
  // Optional so old reports replay cleanly without this field.
  // Resolver wraps each entry into a ConstellationItem at read time.
  node_signature_entities?: Array<{
    id: string;
    name: string;
    node_signature: NodeSignature | null;
  }>;

  /** When this payload was built (ISO). Mirrors reports.generated_at. */
  frozen_at: string;
}

/** One report row. Payload + manifest are both jsonb blobs in Postgres. */
export interface Report {
  id: string;
  space_id: string;
  app_id: string | null;
  user_id: string;
  title: string;
  summary: string | null;
  payload: ReportPayload;
  /** Frozen manifest — when null, the page falls back to the live app.manifest. */
  manifest: AppManifest | null;
  pipeline_version: number | null;
  generated_by: string;
  generated_at: string;
}

/** What the POST /api/reports endpoint accepts. */
export interface CreateReportRequest {
  space_id: string;
  app_id?: string;
  title?: string;
  summary?: string;
}
