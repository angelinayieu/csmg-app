// ── Upstream Context Loader ─────────────────────────────────────────
//
// Shared loader for the "what feeds into this card" context block.
// Extracted from /item/expand's inline IIFE so the prototype-brief
// generator + any future surface (compose, expansion-node) gets the
// same data without duplicating ~150 lines of edge-walking.
//
// What "upstream" means:
//   • A FEATURE's upstream = PAINS it addresses (incoming edges from pains)
//   • An OUTCOME's upstream = FEATURES that produce it
//   • An OBJECTIVE's upstream = OUTCOMES that roll up to it
//   • A PAIN has NO upstream (it's the root cause; nothing feeds it)
//
// Each upstream item carries:
//   • name + layer — for prompt grounding
//   • elected_variation_names — which variations the user committed to
//     on the upstream card (strongest signal)
//   • expansion_highlights — top kept expansion-tree nodes on the
//     upstream card (deeper structure the user has explored)
//   • edge_relationship + edge_mechanism + edge_rationale — the
//     correlation edge content connecting upstream → this card. Lets
//     downstream generation EXTEND the named lever instead of
//     inventing parallel mechanisms.
//
// Soft-fail everywhere: every query is `maybeSingle()` or array-with-
// fallback. Empty result → return undefined so the calling prompt
// block stays cleanly omitted instead of injecting noise.

import type { LayerSlug } from "./context-helpers";

export interface UpstreamItem {
  /** The upstream card's title. */
  name: string;
  /** Which lane the upstream item lives in. */
  layer: LayerSlug;
  /** Names of variations the user has elected on this upstream card.
   *  Empty array → user hasn't committed to a direction yet. */
  elected_variation_names: string[];
  /** Short titles of the top 2-3 kept expansion-tree nodes on this
   *  upstream card. */
  expansion_highlights: string[];
  /** Edge content connecting upstream → this card. Only present
   *  when the correlation step emitted a mechanism (empty strings
   *  would bloat the prompt without signal). */
  edge_relationship?: string;
  edge_mechanism?: string;
  edge_rationale?: string;
}

export interface LoadUpstreamArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  /** The DOWNSTREAM entity — we're finding what feeds INTO this one. */
  downstreamEntityId: string;
  /** Scope. Edges live per sub-objective; without this we'd have to
   *  scan the whole space. Required. */
  parentSubObjectiveId: string;
  /** Cap. Default 4 — keeps token budget bounded. Helper sorts by
   *  signal strength (elections × 2 + expansion highlights) and
   *  takes the top N. */
  limit?: number;
}

/** Load the upstream-context block for a downstream entity. Returns
 *  undefined when no incoming edges exist (typical for pains — they
 *  ARE the root cause) or every query fails. Soft-fail by design;
 *  caller's prompt block just stays omitted on undefined. */
export async function loadUpstreamContext(
  args: LoadUpstreamArgs,
): Promise<UpstreamItem[] | undefined> {
  const { db, downstreamEntityId, parentSubObjectiveId } = args;
  const limit = args.limit ?? 4;

  // ── Phase 1 — incoming correlation edges ──
  // Pull edge content too (relationship + mechanism in agent_feedback
  // + rationale in conditions) so downstream generation can extend
  // the named lever the correlation step identified instead of
  // inventing parallel mechanisms.
  const { data: incomingEdges } = await db
    .from("edges")
    .select(
      "source_entity_id, relationship, strength, conditions, agent_feedback",
    )
    .eq("parent_sub_objective_id", parentSubObjectiveId)
    .eq("target_entity_id", downstreamEntityId);
  const edgeRows = (Array.isArray(incomingEdges) ? incomingEdges : []) as Array<{
    source_entity_id: string;
    relationship: string | null;
    strength: number | null;
    conditions: string | null;
    agent_feedback: Record<string, unknown> | null;
  }>;
  const sourceIds = edgeRows
    .map((e) => e.source_entity_id)
    .filter((id, i, arr) => arr.indexOf(id) === i); // dedupe
  if (sourceIds.length === 0) return undefined;

  // Build source_id → edge content map for join below.
  const edgeBySourceId = new Map<
    string,
    { relationship: string; mechanism: string; rationale: string }
  >();
  for (const e of edgeRows) {
    const mechanism =
      typeof e.agent_feedback === "object" &&
      e.agent_feedback !== null &&
      typeof (e.agent_feedback as Record<string, unknown>).mechanism === "string"
        ? ((e.agent_feedback as Record<string, unknown>).mechanism as string)
        : "";
    const rationale = typeof e.conditions === "string" ? e.conditions : "";
    edgeBySourceId.set(e.source_entity_id, {
      relationship: e.relationship ?? "",
      mechanism,
      rationale,
    });
  }

  // ── Phase 2 — hydrate source entities + expanded_detail + layer ──
  const { data: sourceRows } = await db
    .from("entities")
    .select("id, name, layer_ontology_id, expanded_detail")
    .in("id", sourceIds);
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) return undefined;

  // Resolve layer slugs in ONE query (vs. per-source N+1).
  const layerIds = (sourceRows as Array<{ layer_ontology_id: string | null }>)
    .map((r) => r.layer_ontology_id)
    .filter((id): id is string => typeof id === "string");
  const slugByLayerId = new Map<string, LayerSlug>();
  if (layerIds.length > 0) {
    const { data: layerRows } = await db
      .from("layer_ontology")
      .select("id, slug")
      .in("id", layerIds);
    if (Array.isArray(layerRows)) {
      for (const r of layerRows as Array<{ id: string; slug: string }>) {
        if (
          r.slug === "pain" ||
          r.slug === "features" ||
          r.slug === "outcomes" ||
          r.slug === "objective"
        ) {
          slugByLayerId.set(r.id, r.slug);
        }
      }
    }
  }

  // ── Phase 3 — assemble UpstreamItem[] with elections + highlights ──
  type ExpandedDetail = {
    variations?: Array<{ name: string; disposition?: unknown }>;
    expansion_tree?: Array<{ title: string; disposition?: unknown }>;
  };
  const items: UpstreamItem[] = [];
  for (const row of sourceRows as Array<{
    id: string;
    name: string;
    layer_ontology_id: string | null;
    expanded_detail: ExpandedDetail | null;
  }>) {
    const upstreamLayer = row.layer_ontology_id
      ? slugByLayerId.get(row.layer_ontology_id) ?? "features"
      : "features";
    const ed = row.expanded_detail ?? null;
    const electedNames: string[] = Array.isArray(ed?.variations)
      ? ed!.variations
          .filter((v) => v.disposition === "elected")
          .map((v) => v.name)
      : [];
    const highlights: string[] = Array.isArray(ed?.expansion_tree)
      ? ed!.expansion_tree
          .filter((n) => n.disposition === "kept")
          .slice(0, 3)
          .map((n) => n.title)
      : [];
    const edge = edgeBySourceId.get(row.id);
    items.push({
      name: row.name,
      layer: upstreamLayer,
      elected_variation_names: electedNames,
      expansion_highlights: highlights,
      // Only attach edge content when at least the mechanism exists —
      // empty strings just bloat the prompt without signal.
      ...(edge && edge.mechanism.length > 0
        ? {
            edge_relationship: edge.relationship,
            edge_mechanism: edge.mechanism,
            edge_rationale: edge.rationale,
          }
        : {}),
    });
  }

  // Sort by signal strength (elections × 2 + kept expansion nodes),
  // cap at `limit`. Items with no signal still pass through — they're
  // weaker but not noise.
  items.sort((a, b) => {
    const aSignal =
      a.elected_variation_names.length * 2 + a.expansion_highlights.length;
    const bSignal =
      b.elected_variation_names.length * 2 + b.expansion_highlights.length;
    return bSignal - aSignal;
  });
  return items.slice(0, limit);
}

// ── Prompt block renderer ───────────────────────────────────────────

/** Renders the upstream-context block for prompt prepend. Empty when
 *  no items, so callers can template uniformly. The "UPSTREAM RULE"
 *  at the end is the load-bearing instruction: don't drift from the
 *  chain; tie new output to the user's elected upstream choices or
 *  explicitly justify divergence. */
export function buildUpstreamContextBlock(
  items: UpstreamItem[] | undefined,
): string {
  if (!items || items.length === 0) return "";
  const rendered = items
    .map((u) => {
      const elected =
        u.elected_variation_names.length > 0
          ? `\n      elected: ${u.elected_variation_names.slice(0, 4).join(" | ")}`
          : `\n      elected: (nothing committed yet)`;
      const highlights =
        u.expansion_highlights.length > 0
          ? `\n      deepened into: ${u.expansion_highlights.slice(0, 3).join(" · ")}`
          : "";
      const edge =
        u.edge_mechanism && u.edge_mechanism.length > 0
          ? `\n      connects via: ${u.edge_relationship ?? "→"} (mechanism: ${u.edge_mechanism})${u.edge_rationale ? ` — ${u.edge_rationale.slice(0, 140)}` : ""}`
          : "";
      return `  ${u.layer} "${u.name}"${elected}${highlights}${edge}`;
    })
    .join("\n");
  return `\n\nUPSTREAM CHAIN (cards that FEED into this one — your output should compose with their elected choices, not drift away):\n${rendered}\n  UPSTREAM RULE: When upstream has ELECTED variations or DEEPENED nodes, your output should make sense as a downstream response to those choices. If you'd otherwise generate output that ignores upstream elections, either tie it to one OR explicitly justify the divergence. The user is building one coherent bet, not a collection of independent reads.`;
}
