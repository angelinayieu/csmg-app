// ── Reaction (Phase 11) ──
//
// Persistent, named interpretation of 2-6 entities' intersection. Produced
// by the combination interpretation endpoint (and optionally edited by the
// user). Keyed by a canonical sorted hash of participant UUIDs so equal
// reactions across callers dedupe.

export type ReactionType = "emergent" | "reinforcing" | "tension" | "trivial";
export type ReactionSourceTag = "user" | "llm" | "inferred";

export interface Reaction {
  id: string;
  space_id: string;
  name: string;
  reaction_type: ReactionType;
  entity_ids: string[];
  canonical_key: string;
  probability: number;
  ci_low: number | null;
  ci_high: number | null;
  mechanism: string | null;
  implication: string | null;
  probes: string[] | null;
  source_tag: ReactionSourceTag;
  provenance: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Deterministic canonical key for a set of entity UUIDs — matches the
 * Postgres trigger output so client can compute it locally for lookups.
 */
export function canonicalKey(entityIds: string[]): string {
  return [...entityIds].sort().join("|");
}
