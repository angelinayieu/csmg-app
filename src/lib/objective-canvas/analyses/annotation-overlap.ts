// ── Analysis: annotation overlap (Tier 1) ─────────────────────────
//
// Each item across all rooms can carry derived_from_annotations[]
// (the parent objective's lens readings that seeded it). When the
// SAME annotation index drives items in ≥2 rooms, that annotation
// is a load-bearing thread — surfacing it tells the user "this one
// reading is driving 3 different rooms' decisions; a fix here
// resolves all three."
//
// Tier 1: no LLM. Pure indexed grouping over derived_from_annotations.

import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "annotation_overlap";

export const annotationOverlap: AnalysisModule = {
  key: KEY,
  label: "Annotation overlap",
  description:
    "Parent-objective readings that drive items in ≥2 rooms — single-fix-resolves-multiple-rooms candidates.",
  category: "structure",
  tier: 1,
  trigger: "auto_on_scan",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    if (state.parent_annotations.length === 0) return [];
    if (state.rooms.length < 2) return [];
    if (state.items.length === 0) return [];

    // index (1-based) → { room_ids, item_ids }
    const byIndex = new Map<
      number,
      { room_ids: Set<string>; item_ids: Set<string> }
    >();

    for (const item of state.items) {
      for (const idx of item.derived_from_annotation_indices) {
        const g = byIndex.get(idx) ?? {
          room_ids: new Set<string>(),
          item_ids: new Set<string>(),
        };
        g.room_ids.add(item.room_id);
        g.item_ids.add(item.id);
        byIndex.set(idx, g);
      }
    }

    const findings: AnalysisFinding[] = [];
    const now = new Date().toISOString();
    // The lens the items reference is weight-sorted top-8 in the
    // generator. Match here so the index → annotation lookup aligns.
    const ranked = [...state.parent_annotations]
      .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
      .slice(0, 8);

    for (const [idx, g] of byIndex.entries()) {
      if (g.room_ids.size < 2) continue;
      const ann = ranked[idx - 1];
      if (!ann) continue;
      const roomCount = g.room_ids.size;
      const severity =
        roomCount >= 3 ? "high" : "medium";
      const phrase = ann.phrase;
      const reading = ann.reading;
      findings.push({
        id: `${KEY}__${idx}`,
        analysis_key: KEY,
        category: "structure",
        severity,
        tier: 1,
        title: `"${phrase}" seeds ${roomCount} rooms`,
        summary: `${reading ? reading.slice(0, 120) : "Load-bearing reading"} — drives items in ${roomCount} rooms.`,
        body: {
          annotation_index: idx,
          phrase,
          reading,
          room_count: roomCount,
        },
        references: {
          room_ids: Array.from(g.room_ids),
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
