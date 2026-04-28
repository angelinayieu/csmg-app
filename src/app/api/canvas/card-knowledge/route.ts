// POST /api/canvas/card-knowledge
//
// Arc 5B.4. Card-focused knowledge-graph context lookup. Returns:
//   • relatedEntities — 6-8 semantically closest entities (vector retrieval)
//   • axioms — Tier-7 axioms that overlap the card's content (textual match
//             against synthesis_data.axioms[])
//   • convergences — insight convergences relevant to the card's content
//
// The axiom + convergence match is keyword-based on the card's primary_text
// — cheaper than a second LLM round-trip and reliable enough because the
// synthesis_data keys are already condensed, high-signal strings.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { retrieveEntities } from "@/lib/memory/retrieve";

export const maxDuration = 15;

interface CardKnowledgeRequest {
  spaceId: string;
  shape_id: string;
  shape_type: string;
  primary_text: string;
  thread_ancestors?: Array<{ author: string | null; text: string; depth: number }>;
}

interface CardKnowledgeEntity {
  id: string;
  entity_id: string;
  name: string;
  description: string;
  entity_category: string | null;
  score: number;
  /** Variant count — when this entry collapses N near-duplicates,
   *  variantCount = N+1. UI surfaces this as a "(N variants)" pill so
   *  the user can see that the underlying KG has multiple slightly-
   *  different rows (e.g. "habit stack" + "habit stacks" + "Habit
   *  Stacks") that we collapsed into one display row. Click-through
   *  could expand the variants. */
  variantCount?: number;
  /** Names of the collapsed variants (excluding the canonical one).
   *  Surfaced in hover/tooltip so the user knows what was merged. */
  variantNames?: string[];
}

interface CardKnowledgeAxiom {
  id: string;
  name: string;
  statement: string;
  tier: string | null;
}

interface CardKnowledgeConvergence {
  id: string;
  insight: string;
  supporting_count: number;
}

interface CardKnowledgeResponse {
  relatedEntities: CardKnowledgeEntity[];
  axioms: CardKnowledgeAxiom[];
  convergences: CardKnowledgeConvergence[];
}

/**
 * Normalize an entity name for variant clustering. Aggressive on
 * surface-level differences (case, plural -s/-es, whitespace,
 * leading articles, possessives) but preserves semantic distinctness
 * (different roots remain distinct).
 *
 * Examples:
 *   "Habit stacks" / "Habit Stacks" / "habit stack" / "habit-stacks"
 *     → all collapse to "habit stack"
 *   "Habits" → "habit" (collapses with "habit")
 *   "Optimization of habit stacks" → stays distinct (different root noun)
 *   "User engagement" / "User engagements" → both → "user engagement"
 */
function normalizeNameForVariant(name: string): string {
  let s = name.toLowerCase().trim();
  // Strip leading articles
  s = s.replace(/^(the|a|an)\s+/i, "");
  // Collapse whitespace + non-alphanumeric to single space
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  // Strip simple plural endings on each word
  const words = s.split(" ").map((w) => {
    if (w.length < 4) return w; // too short to safely de-pluralize
    if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
    if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
    if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  });
  return words.join(" ");
}

/**
 * Collapse near-duplicate entity rows by normalized name. Keeps
 * the highest-scoring entry as canonical, attaches the others as
 * `variantNames`. Designed so the user sees ONE row per concept
 * with a clear count of how many surface variants the underlying
 * KG has — instead of 4 rows of "Habit stacks / Habit Stacks /
 * habit stack / habits" cluttering the UI.
 *
 * IMPORTANT: only merges entries whose NORMALIZED name AND whose
 * description start similarly. If two entries share a normalized
 * name but have meaningfully different descriptions, we keep them
 * separate — that's the "different contextual behaviors" case the
 * user explicitly called out (e.g. "habit stack" the user-defined
 * concept vs "habit stack" used in a workplace context).
 */
function collapseNearDuplicates<
  T extends {
    name: string;
    description: string;
    score: number;
  },
>(entries: T[]): Array<T & { variantCount: number; variantNames: string[] }> {
  const groups = new Map<
    string,
    Array<T & { _normName: string }>
  >();
  for (const e of entries) {
    const norm = normalizeNameForVariant(e.name);
    if (!norm) continue;
    const existing = groups.get(norm);
    if (existing) {
      existing.push({ ...e, _normName: norm });
    } else {
      groups.set(norm, [{ ...e, _normName: norm }]);
    }
  }

  const result: Array<T & { variantCount: number; variantNames: string[] }> =
    [];
  for (const [, items] of groups) {
    // Within each name-group, sub-cluster by description similarity.
    // Items with descriptions starting with the same first 60 chars
    // collapse together; items with meaningfully different
    // descriptions stay separate.
    const subClusters: Array<typeof items> = [];
    for (const item of items) {
      const descKey = (item.description || "").trim().toLowerCase().slice(0, 60);
      let placed = false;
      for (const cluster of subClusters) {
        const clusterDescKey = (cluster[0].description || "")
          .trim()
          .toLowerCase()
          .slice(0, 60);
        // Empty-vs-empty descriptions cluster together
        if (descKey === clusterDescKey) {
          cluster.push(item);
          placed = true;
          break;
        }
      }
      if (!placed) subClusters.push([item]);
    }

    for (const cluster of subClusters) {
      cluster.sort((a, b) => b.score - a.score);
      const canonical = cluster[0];
      const variants = cluster.slice(1);
      // Drop the internal _normName field before returning. Cast
      // through `unknown` per TS's compositional rule — Omit<T & X, K>
      // is structurally narrower than T but TS can't prove the
      // overlap without an explicit unknown intermediate.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _normName, ...canonicalEntry } = canonical;
      const canonicalAsT = canonicalEntry as unknown as T;
      result.push({
        ...canonicalAsT,
        variantCount: cluster.length,
        variantNames: variants.map((v) => v.name),
      });
    }
  }

  // Re-sort the deduped list by score so the top-scoring entries
  // surface first (regardless of which name-group they came from).
  result.sort((a, b) => b.score - a.score);
  return result;
}

/** Cheap keyword-match scorer: counts shared lowercase words (>3 chars). */
function scoreOverlap(query: string, candidate: string): number {
  const qSet = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
  if (qSet.size === 0) return 0;
  const cWords = candidate.toLowerCase().split(/[^a-z0-9]+/);
  let hits = 0;
  for (const w of cWords) {
    if (qSet.has(w)) hits++;
  }
  return hits;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<CardKnowledgeRequest>(request);
  if (parseError) return parseError;

  const { spaceId, primary_text, thread_ancestors = [] } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Build the retrieval query — primary text + ancestors collapsed so the
  // vector search sees the full conversational scope.
  const queryText = [
    primary_text,
    ...thread_ancestors.map((a) => a.text),
  ]
    .join(" ")
    .slice(0, 1500);

  if (queryText.trim().length < 3) {
    return NextResponse.json({
      relatedEntities: [],
      axioms: [],
      convergences: [],
    });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // ── Entity retrieval via vector store (memory_items) ──────────────
    const hits = await retrieveEntities(db, {
      owner_id: user.id,
      query_text: queryText,
      k: 8,
      min_salience: 0,
    });

    // Hydrate name/description from the entities table (same pattern as
    // /api/canvas/ambient). MemoryHit wraps { item, similarity } — the
    // entity row id lives on item.ref_id (primary entity FK for kind="entity"
    // items). scope_ref_id is space-scoped, not entity-id.
    const entityIds = hits
      .map((h) => h.item.ref_id)
      .filter((id): id is string => !!id);
    let entityRows: Array<{
      id: string;
      entity_id: string | null;
      name: string;
      description: string | null;
      entity_category: string | null;
    }> = [];
    if (entityIds.length > 0) {
      const { data } = await db
        .from("entities")
        .select("id, entity_id, name, description, entity_category")
        .in("id", entityIds);
      entityRows = (data ?? []) as typeof entityRows;
    }
    const byId = new Map(entityRows.map((e) => [e.id, e]));

    const rawRelated: CardKnowledgeEntity[] = hits
      .map((h) => {
        const row = byId.get(h.item.ref_id);
        if (!row) return null;
        return {
          id: row.id,
          entity_id: row.entity_id ?? row.id,
          name: row.name,
          description: row.description ?? "",
          entity_category: row.entity_category ?? null,
          score: h.similarity,
        };
      })
      .filter((e): e is CardKnowledgeEntity => e !== null);

    // Variant collapse — without this the UI shows surface duplicates
    // like "Habit stacks / Habit Stacks / habit stack / Habits" as
    // separate rows. We collapse by normalized name (case-/plural-
    // /article-insensitive) AND description-prefix similarity, so
    // genuinely different concepts that happen to share a name stay
    // separate. Each collapsed group surfaces a `variantCount` +
    // `variantNames[]` so the UI can render "(3 variants)" and
    // tooltip the merged surface forms.
    const relatedEntities = collapseNearDuplicates(rawRelated);

    // ── Axioms + convergences from synthesis_data JSONB ───────────────
    const { data: spaceRow } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const sd = (spaceRow?.synthesis_data ?? null) as Record<string, unknown> | null;

    const axiomList = Array.isArray(sd?.axioms) ? (sd.axioms as unknown[]) : [];
    const convergenceList = Array.isArray(sd?.insight_convergences)
      ? (sd.insight_convergences as unknown[])
      : [];

    // Score each axiom against the query text; return top 4.
    const scoredAxioms = axiomList
      .map((a) => {
        const ax = a as { id?: string; name?: string; statement?: string; tier?: string };
        const score = scoreOverlap(queryText, `${ax.name ?? ""} ${ax.statement ?? ""}`);
        return { ax, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    const axioms: CardKnowledgeAxiom[] = scoredAxioms.map(({ ax }) => ({
      id: ax.id ?? `ax-${Math.random().toString(36).slice(2, 8)}`,
      name: ax.name ?? "Unnamed axiom",
      statement: ax.statement ?? "",
      tier: ax.tier ?? null,
    }));

    // Similar pattern for convergences.
    const scoredConvergences = convergenceList
      .map((c) => {
        const cv = c as {
          id?: string;
          insight?: string;
          pattern?: string;
          supporting_signals?: unknown[];
        };
        const insightText = cv.insight ?? cv.pattern ?? "";
        const score = scoreOverlap(queryText, insightText);
        return { cv, insightText, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const convergences: CardKnowledgeConvergence[] = scoredConvergences.map(
      ({ cv, insightText }) => ({
        id: cv.id ?? `cv-${Math.random().toString(36).slice(2, 8)}`,
        insight: insightText,
        supporting_count: Array.isArray(cv.supporting_signals)
          ? cv.supporting_signals.length
          : 0,
      }),
    );

    const payload: CardKnowledgeResponse = {
      relatedEntities,
      axioms,
      convergences,
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.warn("[canvas/card-knowledge]", err);
    return NextResponse.json(
      {
        error: `Knowledge lookup failed: ${sanitizeErrorMessage(err)}`,
        relatedEntities: [],
        axioms: [],
        convergences: [],
      },
      { status: 500 },
    );
  }
}
