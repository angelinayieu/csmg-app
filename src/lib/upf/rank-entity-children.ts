/**
 * UPF — "rank the decomposed children to probe first" (Phase 4c-final).
 *
 * Convenience wrapper around rollUpChildrenToParent + selectNextProxy that
 * answers the question: "given this parent entity (bottleneck, leverage
 * point, whatever), which child proxy should the user collect data for
 * first, honoring their consent manifest?"
 *
 * Intended consumers (future):
 *   - The bottleneck / leverage cards in the synthesis view → inline
 *     "deeper probe: [child name]" suggestion.
 *   - The strategy cascade → when a proposal targets a decomposed parent,
 *     surface the top child as an observation anchor.
 *   - The intelligence radar → schedule the next observation automatically
 *     against the top child instead of picking LLM-default metrics.
 */

import type { Entity } from "@/types";
import type { ConsentSnapshot, ProxyScore, ProxyDescriptor } from "./types";
import { rollUpChildrenToParent } from "./rollup";
import { selectNextProxy } from "./select-next";

export interface RankedChildResult {
  /** The rolled-up parent descriptor (info/friction reflect aggregate child surface). */
  parent: ProxyDescriptor;
  /** Ranked children, honoring consent (consent-filtered sink to the bottom). */
  ranked: Array<{
    descriptor: ProxyDescriptor;
    score: ProxyScore;
    entity_id: string;
    entity_name: string;
  }>;
  /** The child the selector would probe first (null if all were filtered or no children). */
  topChild: {
    descriptor: ProxyDescriptor;
    score: ProxyScore;
    entity_id: string;
    entity_name: string;
  } | null;
  /** IDs of children dropped because they require data categories the user hasn't opted in to. */
  consent_filtered_entity_ids: string[];
}

/**
 * Rank the decomposed children of `parent` by value-per-friction, applying
 * consent filtering. Returns both the ranked list (for UI) and the rolled-up
 * parent descriptor (for further upstream scoring).
 */
export function rankEntityChildren(
  parent: Entity,
  children: Entity[],
  consent: ConsentSnapshot | null = null
): RankedChildResult {
  const { descriptor: parentDescriptor } = rollUpChildrenToParent(
    parent,
    children
  );

  if (children.length === 0) {
    return {
      parent: parentDescriptor,
      ranked: [],
      topChild: null,
      consent_filtered_entity_ids: [],
    };
  }

  // Build a child-descriptor list in the order matching `children` so we can
  // attach entity_id / name back after the selector re-sorts.
  const byDescriptorId = new Map<string, Entity>();
  const childDescriptors = children.map((c) => {
    // Reuse the roll-up's own derivation so scoring is consistent.
    const d = rollUpChildrenToParent(c, []).descriptor;
    byDescriptorId.set(d.id, c);
    return d;
  });

  const { top, ranked } = selectNextProxy(childDescriptors, consent);

  const enriched = ranked.map((r) => {
    const ent = byDescriptorId.get(r.descriptor.id);
    return {
      descriptor: r.descriptor,
      score: r.score,
      entity_id: ent?.entity_id ?? "",
      entity_name: ent?.name ?? "",
    };
  });

  const topEnriched = top
    ? enriched.find((r) => r.descriptor.id === top.id) ?? null
    : null;

  const consent_filtered_entity_ids = enriched
    .filter((r) => r.score.filtered_by_consent)
    .map((r) => r.entity_id)
    .filter(Boolean);

  return {
    parent: parentDescriptor,
    ranked: enriched,
    topChild: topEnriched,
    consent_filtered_entity_ids,
  };
}
