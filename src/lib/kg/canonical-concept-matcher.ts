// ── Canonical-concept matcher (W6.2) ─────────────────────────────────
//
// Tier 1 (canonical/TBox) write-side. Every newly-minted entity calls
// `findOrCreateCanonicalConcept` to either link to an existing
// canonical_concepts row or atomically create one.
//
// Why this lives outside canonical-code.ts:
//   canonical-code.ts is pure string normalization (zero I/O). This
//   library does the DB find-or-create dance. Keeping them separate
//   lets the backfill script (W6.7) compute codes in batch without
//   touching the DB until the cluster pass.
//
// Concurrency model:
//   The canonical_concepts table has UNIQUE(canonical_code). Concurrent
//   inserts of the same code from two simultaneous decompose runs in
//   different spaces are handled via:
//
//     INSERT ... ON CONFLICT (canonical_code) DO NOTHING RETURNING *
//
//   When `DO NOTHING` fires (someone else won the race), the RETURNING
//   clause yields zero rows. We fall back to a plain SELECT to fetch
//   the winner's row. Net: the call ALWAYS returns the canonical_id,
//   regardless of whether this caller minted the row or not.
//
// What "match" means in V1:
//   Exact canonical_code equality. The matcher returns hits when
//     `input_code === existing.canonical_code`.
//   Alias matching (existing.aliases contains input_code) is V1.5 —
//   easy add via a second query, but only meaningful once the
//   backfill has populated aliases. For now: exact match only.
//   Semantic similarity (embedding distance, lemmatization) is V2
//   and lives in a separate function.
//
// Status field semantics:
//   New rows are inserted with status='pending'. Promotion to
//   status='verified' happens via:
//     • Admin tool (manual curation)
//     • Cron job (auto-promote when space_count >= 3)
//   Neither exists yet; pending rows are still queryable + linkable.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { normalizeCanonicalCode } from "./canonical-code";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<Database> | any;

// ── Public types ────────────────────────────────────────────────────

export interface CanonicalConceptRow {
  id: string;
  canonical_code: string;
  display_name: string;
  description: string | null;
  domain_tags: string[];
  aliases: string[];
  status: "pending" | "verified" | "rejected" | "merged";
  space_count: number;
  entity_count: number;
  last_seen_at: string | null;
  first_observed_space_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FindOrCreateCanonicalConceptArgs {
  /**
   * The source text the canonical_code is derived from (typically the
   * entity's name). The matcher normalizes via canonical-code.ts.
   * When normalization yields null (empty / pure-symbol text), the
   * matcher returns null without touching the DB.
   */
  sourceText: string;
  /**
   * Display name to use if a new row is created. Falls back to
   * sourceText when omitted. Existing rows keep their display_name.
   */
  displayName?: string;
  /** The space ID that triggered this match — populated into
   *  first_observed_space_id on new rows. */
  spaceId: string;
  /** The acting user — populated into created_by on new rows. */
  userId: string;
  /** Optional domain tags to seed on new rows (e.g. ['biological']). */
  domainTags?: string[];
  /**
   * Optional description for new rows. Useful when the caller has
   * richer context (e.g. variable_proposals.proposed_description).
   */
  description?: string;
}

export interface FindOrCreateCanonicalConceptResult {
  /** The matched (or newly-created) canonical_concepts row. */
  concept: CanonicalConceptRow;
  /** True when this call inserted the row; false when it found an
   *  existing match (either pre-existing or won by a concurrent call). */
  wasCreated: boolean;
  /** The normalized canonical_code used for the match. */
  canonicalCode: string;
}

// ── Function ────────────────────────────────────────────────────────

/**
 * Find or atomically create a canonical_concepts row for the given
 * source text. Returns `null` when the source text is unnormalizable
 * (empty / pure-symbol) — caller skips canonical linking in that
 * case.
 *
 * Soft-fail: when an unexpected DB error happens, returns null
 * rather than throwing — callers continue without canonical linking
 * (entity still inserts; canonical_concept_id stays NULL).
 */
export async function findOrCreateCanonicalConcept(
  db: AnyDb,
  args: FindOrCreateCanonicalConceptArgs,
): Promise<FindOrCreateCanonicalConceptResult | null> {
  const canonicalCode = normalizeCanonicalCode(args.sourceText);
  if (!canonicalCode) return null;

  const displayName = args.displayName?.trim() || args.sourceText.trim() || canonicalCode;

  // ── 1. Fast path: try INSERT with ON CONFLICT DO NOTHING ──────────
  //
  // When this is the first writer for `canonical_code`, the INSERT
  // succeeds and RETURNING yields the new row. When someone else won
  // the race (or the row already existed), ON CONFLICT DO NOTHING
  // fires → zero rows returned → fall through to the SELECT path.
  //
  // We use upsert with ignoreDuplicates so the Supabase client emits
  // the right SQL.
  try {
    const { data: inserted } = await db
      .from("canonical_concepts")
      .upsert(
        {
          canonical_code: canonicalCode,
          display_name: displayName,
          description: args.description ?? null,
          domain_tags: args.domainTags ?? [],
          aliases: [],
          status: "pending",
          space_count: 1,
          entity_count: 1,
          last_seen_at: new Date().toISOString(),
          first_observed_space_id: args.spaceId,
          created_by: args.userId,
        },
        { onConflict: "canonical_code", ignoreDuplicates: true },
      )
      .select("*");

    if (Array.isArray(inserted) && inserted.length > 0) {
      return {
        concept: inserted[0] as CanonicalConceptRow,
        wasCreated: true,
        canonicalCode,
      };
    }
  } catch (err) {
    // ignoreDuplicates path can throw on schema mismatches; fall
    // through to SELECT.
    console.warn(
      "[canonical-matcher] insert path threw (falling through to select):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── 2. SELECT path: the conflict (or pre-existing row) wins ──────
  try {
    const { data: existing } = await db
      .from("canonical_concepts")
      .select("*")
      .eq("canonical_code", canonicalCode)
      .maybeSingle();

    if (!existing) {
      // Edge: INSERT silently failed (RLS denial?) and SELECT can't
      // find it. Return null — caller proceeds without linking.
      console.warn(
        `[canonical-matcher] no row found for canonical_code='${canonicalCode}' after insert+select (RLS?). Skipping link.`,
      );
      return null;
    }

    return {
      concept: existing as CanonicalConceptRow,
      wasCreated: false,
      canonicalCode,
    };
  } catch (err) {
    console.warn(
      "[canonical-matcher] select path threw:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Bump space_count / entity_count / last_seen_at on an existing
 * canonical_concepts row after a NEW entity from a (possibly new)
 * space links to it. Caller passes the matcher's result so we can
 * skip the bump on freshly-created rows (their counts already reflect
 * this very entity).
 *
 * Idempotency caveat: V1 counts ALL link calls, not distinct (space,
 * concept) pairs. The denormalized counts will overcount if multiple
 * entities in the same space link to the same concept. The W6.4 read
 * API can correct this on demand via a `SELECT COUNT(DISTINCT
 * space_id) FROM entities WHERE canonical_concept_id = $1`.
 *
 * Soft-fails — bump failure doesn't break the link.
 */
export async function bumpCanonicalConceptTally(
  db: AnyDb,
  args: {
    conceptId: string;
    spaceId: string;
    wasCreated: boolean;
  },
): Promise<void> {
  if (args.wasCreated) return; // Initial INSERT already set counts to 1.

  try {
    // Read existing tally, increment, write back. Two queries instead
    // of a single UPDATE ... = field + 1 because the Supabase JS
    // client doesn't expose raw SQL expressions on UPDATE. Race
    // tolerated — eventual consistency is fine for these denormalized
    // counts (the on-demand recompute corrects).
    const { data: existing } = await db
      .from("canonical_concepts")
      .select("space_count, entity_count, first_observed_space_id")
      .eq("id", args.conceptId)
      .maybeSingle();

    if (!existing) return;

    const row = existing as {
      space_count: number;
      entity_count: number;
      first_observed_space_id: string | null;
    };

    // space_count bumps only if this is a NEW space for this concept.
    // V1 heuristic: bump when first_observed_space_id != args.spaceId.
    // Not perfectly accurate (could over-bump if same space links via
    // multiple entities) but close enough — on-demand recompute fixes.
    const spaceCountBump =
      row.first_observed_space_id !== args.spaceId ? 1 : 0;

    await db
      .from("canonical_concepts")
      .update({
        space_count: row.space_count + spaceCountBump,
        entity_count: row.entity_count + 1,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.conceptId);
  } catch (err) {
    console.warn(
      "[canonical-matcher] tally bump failed (link still recorded):",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * High-level convenience: find-or-create + bump tally + return the
 * concept_id ready to write into entities.canonical_concept_id.
 *
 * Most producers want this combined call. Returns null when source
 * text can't normalize OR DB write fails — caller proceeds without
 * canonical linking on the entity.
 */
export async function linkEntityToCanonicalConcept(
  db: AnyDb,
  args: FindOrCreateCanonicalConceptArgs,
): Promise<string | null> {
  const result = await findOrCreateCanonicalConcept(db, args);
  if (!result) return null;

  await bumpCanonicalConceptTally(db, {
    conceptId: result.concept.id,
    spaceId: args.spaceId,
    wasCreated: result.wasCreated,
  });

  return result.concept.id;
}
