// ── Analysis: shared mechanisms (Tier 1) ──────────────────────────
//
// Groups edges across all rooms by their agent_feedback.mechanism
// text. Any mechanism noun phrase that appears in ≥2 rooms is a
// "shared mechanism" finding — a candidate for build-once-deploy-
// many before the user designs it three times by accident.
//
// Tier 1: no LLM. Pure string grouping over edge mechanisms.

import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "shared_mechanisms";

export const sharedMechanisms: AnalysisModule = {
  key: KEY,
  label: "Shared mechanisms",
  description:
    "Lever names that appear in ≥2 rooms — candidates for build-once-deploy-many before drift sets in.",
  category: "redundancy",
  tier: 1,
  trigger: "auto_on_scan",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    if (state.edges.length === 0 || state.rooms.length < 2) return [];

    // Group: normalized mechanism text → { rooms, edges, sample_items }
    const groups = new Map<
      string,
      {
        original: string;
        room_ids: Set<string>;
        edge_ids: string[];
        item_ids: Set<string>;
      }
    >();

    for (const e of state.edges) {
      if (!e.mechanism) continue;
      const key = normalizeMechanism(e.mechanism);
      if (key.length < 3) continue; // skip junk
      const g = groups.get(key) ?? {
        original: e.mechanism,
        room_ids: new Set<string>(),
        edge_ids: [],
        item_ids: new Set<string>(),
      };
      g.room_ids.add(e.room_id);
      g.edge_ids.push(e.id);
      g.item_ids.add(e.source_entity_id);
      g.item_ids.add(e.target_entity_id);
      groups.set(key, g);
    }

    const findings: AnalysisFinding[] = [];
    const now = new Date().toISOString();

    for (const [key, g] of groups.entries()) {
      if (g.room_ids.size < 2) continue;
      const roomCount = g.room_ids.size;
      const severity =
        roomCount >= 3 ? "high" : roomCount === 2 ? "medium" : "low";
      const rooms = Array.from(g.room_ids);
      const items = Array.from(g.item_ids);
      const roomNames = rooms
        .map((rid) => state.rooms.find((r) => r.id === rid)?.title ?? "?")
        .slice(0, 3)
        .join(", ");
      findings.push({
        id: `${KEY}__${key}`,
        analysis_key: KEY,
        category: "redundancy",
        severity,
        tier: 1,
        title: `"${g.original}" — ${roomCount} rooms`,
        summary: `Same lever named in ${roomCount} rooms (${roomNames}). Build once vs. re-design.`,
        body: {
          mechanism: g.original,
          mechanism_normalized: key,
          room_count: roomCount,
          edge_count: g.edge_ids.length,
        },
        references: {
          room_ids: rooms,
          item_ids: items,
        },
        disposition: "open",
        generated_at: now,
      });
    }

    // Sort by severity then room_count desc for stable display order.
    return findings.sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    });
  },
};

/** Normalize for grouping: lowercase, collapse whitespace, strip
 *  trailing punctuation. Doesn't fuzzy-match — "reward feedback loop"
 *  and "reward feedback loops" hash differently. The point is to
 *  catch the obvious duplicates, not to merge near-synonyms (that's
 *  the smart pass's job). */
function normalizeMechanism(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
