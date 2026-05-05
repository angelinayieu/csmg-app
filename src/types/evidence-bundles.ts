// Evidence bundles — what the Effect Propagator receives so it stops
// inventing paper citations.
//
// A bundle is a per-entity meta-analysis result: pooled effect across all
// evidence_registries rows attached to that entity, plus the citation list
// the LLM must reference. Built either from the cached pooling_metadata on
// edges.dynamics_properties (fast path) or live-pooled at trace time
// (fallback when cache is missing or stale).

import type { PoolingResult } from "@/lib/evidence/edge-strength-pooler";

export interface EvidenceCitation {
  /** evidence_registries.id (UUID) — the LLM must cite this exact ID */
  evidence_id: string;
  /** ingested_files.id (UUID) — back-link to the source document */
  ingested_file_id: string | null;
  /** Verbatim quote from the source artifact, ≤500 chars */
  quote: string | null;
  /** Page number in the source PDF, when available */
  page: number | null;
}

export interface EntityEvidenceBundle {
  /** Entity_id (text-ID like "C1") this bundle is anchored to */
  attached_entity_id: string;
  entity_name: string;
  /** Random-effects pooled effect across all evidence rows for this entity */
  pooled: PoolingResult;
  /** Effect metric (cohens_d, or, rr, hr, beta, ...) — "mixed" when rows
   *  span different metrics; "unknown" when rows have no metric tag */
  effect_metric: string;
  /** Source citations the LLM may reference. UUID format (un-guessable) */
  citations: EvidenceCitation[];
  /** Did this come from edges.dynamics_properties.pooling_metadata cache,
   *  or was it live-pooled at trace time from evidence_registries directly? */
  source: "edge_cache" | "live_pooled";
}

export interface ChainEvidenceBundles {
  chain_id: string;
  bundles: EntityEvidenceBundle[];
  /** Entity IDs in the chain that have NO evidence attached. Surfaces
   *  honest "speculative" labels in the trace narrative. */
  uncovered_entity_ids: string[];
}
