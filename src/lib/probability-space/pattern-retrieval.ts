// ── Pattern Retrieval ──
//
// Given a planned (focal_role, interactor_roles) combination, query the pattern
// library for patterns that may apply. Used by the convergence engine to seed
// the LLM prompt with relevant archetypes before prediction.
//
// Matching strategy, most-specific to least-specific:
//   1. EXACT structural prefix: focal_role + sorted interactor_roles match exactly
//   2. FOCAL_ROLE + OVERLAPPING interactors: at least one interactor role matches
//   3. FOCAL_ROLE only: weakest but still useful when exotic interactor combos
//
// Results ordered by occurrence_count (more observed = more reliable).

import type { RetrievedPattern } from "@/types/convergent-point";
import { signaturePrefix } from "@/types/convergent-point";

export interface PatternRetrievalOptions {
  // Max patterns to return per retrieval call. Default 3 (keeps prompts lean).
  limit?: number;
  // Minimum occurrence_count to consider. Default 2 (aligned with aggregator threshold).
  min_occurrences?: number;
}

interface PatternLibraryRow {
  id: string;
  signature: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signature_detail: any;
  canonical_tag: string;
  canonical_mechanism: string | null;
  typical_polarity: string | null;
  typical_reversibility: string | null;
  example_descriptions: string[] | null;
  occurrence_count: number;
}

/**
 * Retrieve patterns that may apply to a (focal_role, interactor_roles)
 * combination. Uses a cascading match strategy: exact structural signature
 * prefix first, then relaxed matches.
 */
export async function retrievePatterns(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  focal_role: string,
  interactor_roles: string[],
  options: PatternRetrievalOptions = {},
): Promise<RetrievedPattern[]> {
  const limit = options.limit ?? 3;
  const minOccurrences = options.min_occurrences ?? 2;

  const prefix = signaturePrefix(focal_role, interactor_roles);

  // Strategy 1: EXACT prefix match. The `signature` column stores full
  // canonical strings including outcome fields, so we use `signature LIKE
  // 'prefix|%'` — catches any outcome variant for the same structural shape.
  const exactLike = `${prefix}|%`;

  const exact = await db
    .from("pattern_library")
    .select(
      "id, signature, signature_detail, canonical_tag, canonical_mechanism, typical_polarity, typical_reversibility, example_descriptions, occurrence_count",
    )
    .ilike("signature", exactLike)
    .gte("occurrence_count", minOccurrences)
    .order("occurrence_count", { ascending: false })
    .limit(limit);

  const exactRows = (exact.data ?? []) as PatternLibraryRow[];
  if (exactRows.length >= limit) {
    return exactRows.map(toRetrievedPattern);
  }

  // Strategy 2: focal_role match + overlapping interactor set. We use
  // signature_detail JSONB containment — `signature_detail->>'focal_role' = X`
  // AND `signature_detail->'interactor_roles' ?| ARRAY[roles]` (any-overlap).
  // Supabase PostgREST translates this with filter-array syntax.
  const alreadySeen = new Set(exactRows.map((r) => r.signature));

  let relaxedRows: PatternLibraryRow[] = [];
  try {
    // We can't always express the ?| jsonb array-overlap cleanly through
    // PostgREST in one call, so we query by focal_role only then filter in-code.
    const relaxed = await db
      .from("pattern_library")
      .select(
        "id, signature, signature_detail, canonical_tag, canonical_mechanism, typical_polarity, typical_reversibility, example_descriptions, occurrence_count",
      )
      .eq("signature_detail->>focal_role", focal_role)
      .gte("occurrence_count", minOccurrences)
      .order("occurrence_count", { ascending: false })
      .limit(limit * 3);

    const relaxedCandidates = ((relaxed.data ?? []) as PatternLibraryRow[]).filter(
      (r) => !alreadySeen.has(r.signature),
    );

    const targetInteractorSet = new Set(interactor_roles);

    // Score candidates by interactor overlap and take top-(limit - exactRows.length)
    const scored = relaxedCandidates
      .map((r) => {
        const detail = r.signature_detail ?? {};
        const rowInteractors: string[] = Array.isArray(detail.interactor_roles) ? detail.interactor_roles : [];
        const overlap = rowInteractors.filter((ir) => targetInteractorSet.has(ir)).length;
        return { row: r, overlap };
      })
      .sort((a, b) => {
        if (b.overlap !== a.overlap) return b.overlap - a.overlap;
        return b.row.occurrence_count - a.row.occurrence_count;
      })
      .slice(0, limit - exactRows.length)
      .map((s) => s.row);

    relaxedRows = scored;
  } catch (err) {
    console.warn("[pattern-retrieval] Relaxed match failed (non-critical):", err);
  }

  return [...exactRows, ...relaxedRows].map(toRetrievedPattern);
}

function toRetrievedPattern(row: PatternLibraryRow): RetrievedPattern {
  return {
    tag: row.canonical_tag,
    signature: row.signature,
    canonical_mechanism: row.canonical_mechanism ?? "(no canonical mechanism recorded)",
    typical_polarity: row.typical_polarity ?? "neutral",
    typical_reversibility: row.typical_reversibility ?? "easily_reversible",
    example_descriptions: (row.example_descriptions ?? []).slice(0, 3),
    occurrence_count: row.occurrence_count,
  };
}

/**
 * Batch variant: retrieves patterns for multiple (focal_role, interactor_roles)
 * tuples. Used by the route to pre-load patterns for all planned combinations
 * in a single pass. Returns a map keyed by signature prefix.
 *
 * NOTE: in Phase 2 we keep this simple (one query per tuple via Promise.all).
 * If the library grows past ~10k patterns, move to a single query + in-memory
 * match.
 */
export async function retrievePatternsBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tuples: Array<{ focal_role: string; interactor_roles: string[] }>,
  options: PatternRetrievalOptions = {},
): Promise<Map<string, RetrievedPattern[]>> {
  const results = new Map<string, RetrievedPattern[]>();
  await Promise.all(
    tuples.map(async (t) => {
      const key = signaturePrefix(t.focal_role, t.interactor_roles);
      if (results.has(key)) return; // Deduplicate identical prefixes
      const patterns = await retrievePatterns(db, t.focal_role, t.interactor_roles, options);
      results.set(key, patterns);
    }),
  );
  return results;
}
