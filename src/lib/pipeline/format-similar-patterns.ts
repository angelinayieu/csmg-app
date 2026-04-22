// ── Cross-space pattern retrieval for the strategy LLM ──
//
// Problem: the `memory_items` pgvector store is populated by every
// decompose + deepen + app-generate pass, and has been for months.
// Ambient retrieval uses it. Synthesis does not. Strategy does not.
// So the strategy LLM generates recommendations for space N as if
// the user never analyzed spaces 1..N-1 — no pattern recognition,
// no cross-domain transfer, no "this looks like the churn problem
// you solved at space X."
//
// This helper closes that loop for the strategy path:
//
//   1. Build a compact problem statement from the active goal + top
//      entities in the current space.
//   2. Query memory_items via pgvector, restricted to THIS user's
//      scope but filtering OUT the current space (same-space hits
//      would duplicate what the rich-KG block already supplies).
//   3. Rank + cap the remaining hits; emit as a prose block with
//      disciplined formatting (no JSON dumps, no echo-back).
//
// The discipline principles from format-kg-rich-context apply here
// too — the goal is to ground, not drown. If memory is empty, return
// null and the caller skips the block entirely.

import type { SupabaseClient } from "@supabase/supabase-js";
import { retrieveKg } from "@/lib/memory/retrieve";
import type { Entity } from "@/types";
import type { ImprovementGoal } from "@/types/goals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/** Hard cap on patterns emitted. The strategy prompt already carries
 *  a rich KG block + baseline + prior-run digest — the pattern block
 *  should complement, not dominate. */
const MAX_PATTERNS = 8;

/** Similarity floor. Items below this are semantically distant
 *  enough that they're more likely to confuse the LLM than help it
 *  reason by analogy. */
const MIN_SIMILARITY = 0.55;

/** Over-fetch factor — retrieveKg returns top-k by rank, but we
 *  need to filter out current-space hits after retrieval. Over-
 *  fetching lets us discard same-space hits without running out. */
const OVERFETCH = 3;

export interface FormatSimilarPatternsOpts {
  /** Active objective the LLM is generating strategy for. Its
   *  title + description anchor the query. */
  goal: ImprovementGoal | null;
  /** Top entities in the current space — used to broaden the query
   *  beyond the goal title, so retrieval picks up pattern hits that
   *  share substance even if the goal wording differs. */
  topEntities: Entity[];
  /** Current space id. Hits with `scope_ref_id = currentSpaceId` are
   *  dropped — they'd duplicate the rich-KG block. */
  currentSpaceId: string;
  /** User id — memory is per-owner. */
  userId: string;
}

/**
 * Returns a markdown prose block the caller prepends to the strategy
 * LLM user prompt, OR null when there's nothing worth grounding
 * against (first-time user, or no hits above similarity floor).
 */
export async function formatSimilarPatternsBlock(
  db: AnyDb,
  opts: FormatSimilarPatternsOpts,
): Promise<string | null> {
  const { goal, topEntities, currentSpaceId, userId } = opts;

  // Query assembly. If the user has an active goal with a title, anchor
  // on that. Otherwise, synthesize from top entity names — this is
  // common on fresh spaces where the goal wasn't authored explicitly.
  const goalBits: string[] = [];
  if (goal?.title) goalBits.push(goal.title);
  if (goal?.description) {
    const d = goal.description.trim();
    if (d.length > 0) goalBits.push(d.slice(0, 280));
  }

  const entityBits = topEntities
    .slice(0, 6)
    .map((e) => e.name)
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0);

  const query = [...goalBits, ...entityBits].join(" · ").trim();
  if (query.length < 6) return null;

  let hits;
  try {
    hits = await retrieveKg(db, {
      owner_id: userId,
      query_text: query,
      k: MAX_PATTERNS * OVERFETCH,
    });
  } catch (err) {
    console.warn("[format-similar-patterns] retrieveKg failed:", err);
    return null;
  }

  if (!hits || hits.length === 0) return null;

  // Filter out same-space items (rich KG block owns those) and
  // anything below the similarity floor.
  const external = hits
    .filter((h) => h.item.scope_ref_id !== currentSpaceId)
    .filter((h) => h.similarity >= MIN_SIMILARITY)
    .slice(0, MAX_PATTERNS);

  if (external.length === 0) return null;

  const lines: string[] = [];
  lines.push("## Similar patterns from your past work");
  lines.push(
    "These items were retrieved from your other spaces with high semantic " +
      "similarity to the current problem. Use them as reference analogies — " +
      "what worked, what risks repeat — not as constraints.",
  );
  lines.push("");

  for (const hit of external) {
    const kind = hit.item.kind;
    const sim = hit.similarity.toFixed(2);
    const text = hit.item.text.trim().replace(/\s+/g, " ");
    const short = text.length > 240 ? `${text.slice(0, 237)}…` : text;
    lines.push(`- [${kind}, sim ${sim}] ${short}`);
  }

  return lines.join("\n");
}
