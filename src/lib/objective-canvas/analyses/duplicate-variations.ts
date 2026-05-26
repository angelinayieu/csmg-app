// ── Analysis: duplicate variations (Tier 1) ───────────────────────
//
// Variations live per-item under expanded_detail.variations[]. When
// the SAME variation name (normalized) appears across multiple items
// in DIFFERENT rooms, that's a design pattern echoing — likely the
// user wants ONE coherent implementation, not three.
//
// Stronger signal: when those duplicate variations are ELECTED in
// ≥2 rooms. That's an active commitment to the same pattern in
// places that don't know about each other.
//
// Tier 1: no LLM. Slug normalization + grouping.

import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "duplicate_variations";

export const duplicateVariations: AnalysisModule = {
  key: KEY,
  label: "Duplicate variations",
  description:
    "Same variation name appears in ≥2 rooms. Stronger signal when both elected — pattern echoing without coordination.",
  category: "redundancy",
  tier: 1,
  trigger: "auto_on_scan",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    if (state.items.length === 0 || state.rooms.length < 2) return [];

    // slug → { rooms, items, elected_in_rooms, original_name }
    const groups = new Map<
      string,
      {
        original: string;
        room_ids: Set<string>;
        item_ids: Set<string>;
        elected_room_ids: Set<string>;
      }
    >();

    for (const item of state.items) {
      const variations = item.expanded_detail?.variations ?? [];
      const elected = new Set(item.elected_variation_ids);
      for (const v of variations) {
        const slug = slugify(v.name);
        if (slug.length < 3) continue;
        const g = groups.get(slug) ?? {
          original: v.name,
          room_ids: new Set<string>(),
          item_ids: new Set<string>(),
          elected_room_ids: new Set<string>(),
        };
        g.room_ids.add(item.room_id);
        g.item_ids.add(item.id);
        if (elected.has(v.id)) g.elected_room_ids.add(item.room_id);
        groups.set(slug, g);
      }
    }

    const findings: AnalysisFinding[] = [];
    const now = new Date().toISOString();

    for (const [slug, g] of groups.entries()) {
      if (g.room_ids.size < 2) continue;
      const electedCount = g.elected_room_ids.size;
      // Severity escalates when elections back the duplicate.
      let severity: AnalysisFinding["severity"] = "low";
      if (electedCount >= 2) severity = "high";
      else if (electedCount === 1) severity = "medium";

      const rooms = Array.from(g.room_ids);
      const roomNames = rooms
        .map((rid) => state.rooms.find((r) => r.id === rid)?.title ?? "?")
        .slice(0, 3)
        .join(", ");
      const electedNote =
        electedCount >= 2
          ? ` Elected in ${electedCount} rooms — coordinate before drift.`
          : electedCount === 1
            ? ` Elected in 1 room so far.`
            : "";

      findings.push({
        id: `${KEY}__${slug}`,
        analysis_key: KEY,
        category: "redundancy",
        severity,
        tier: 1,
        title: `"${g.original}" appears in ${g.room_ids.size} rooms`,
        summary: `Variation surfaced in ${roomNames}.${electedNote}`,
        body: {
          variation_slug: slug,
          variation_name: g.original,
          room_count: g.room_ids.size,
          elected_room_count: electedCount,
        },
        references: {
          room_ids: rooms,
          item_ids: Array.from(g.item_ids),
        },
        disposition: "open",
        generated_at: now,
      });
    }

    return findings.sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    });
  },
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
