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

    // Phase-2 (glossary-link) — group by CONCEPT_SLUG when present.
    // The slug is stable across both annotation rewordings AND across
    // rooms (the LLM is now instructed to mirror canonical concept
    // names in generated items, so phrase wording can diverge while
    // the slug stays identical). Falls back to phrase, then index.
    //
    // Build the byPhrase map keyed on whichever identifier won:
    // we lookup display data by the corresponding annotation later,
    // and a slug→phrase map is built alongside so the finding still
    // names the user-visible phrase, not the internal slug.
    const byPhrase = new Map<
      string, // lowercased phrase OR slug — see annBySlug/annByPhrase lookups below
      { room_ids: Set<string>; item_ids: Set<string> }
    >();
    const annBySlug = new Map<string, (typeof state.parent_annotations)[number]>();
    for (const ann of state.parent_annotations) {
      if (ann.concept_slug) annBySlug.set(ann.concept_slug, ann);
    }

    // Pass 1 — concept_slug match (strongest, post-Phase-2 items only).
    for (const item of state.items) {
      for (const slug of item.derived_from_annotation_concept_slugs) {
        const ann = annBySlug.get(slug);
        if (!ann) continue;
        const key = ann.phrase.trim().toLowerCase();
        const g = byPhrase.get(key) ?? {
          room_ids: new Set<string>(),
          item_ids: new Set<string>(),
        };
        g.room_ids.add(item.room_id);
        g.item_ids.add(item.id);
        byPhrase.set(key, g);
      }
    }

    // Pass 2 — phrase match. Always run as a complement to slug
    // matching: it catches pre-Phase-2 items, items where the LLM
    // didn't echo a slug, and items that share a phrase but no slug
    // (legacy rooms). Same map, same buckets — no double-counting.
    for (const item of state.items) {
      for (const phrase of item.derived_from_annotation_phrases) {
        const g = byPhrase.get(phrase) ?? {
          room_ids: new Set<string>(),
          item_ids: new Set<string>(),
        };
        g.room_ids.add(item.room_id);
        g.item_ids.add(item.id);
        byPhrase.set(phrase, g);
      }
    }

    // Legacy fallback — when NO items carry phrases yet (data from
    // before the Phase-2 stability fix shipped), fall through to
    // index matching so existing rooms don't silently produce zero
    // findings. Drops out cleanly as items get regenerated with
    // phrase data attached.
    if (byPhrase.size === 0) {
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
      const ranked = [...state.parent_annotations]
        .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
        .slice(0, 8);
      for (const [idx, g] of byIndex.entries()) {
        const ann = ranked[idx - 1];
        if (ann) {
          byPhrase.set(ann.phrase.trim().toLowerCase(), g);
        }
      }
    }

    const findings: AnalysisFinding[] = [];
    const now = new Date().toISOString();
    // Build a phrase → annotation lookup for display data (reading,
    // weight, etc.). Case-insensitive match on lowercased phrase key.
    const annByPhrase = new Map<string, (typeof state.parent_annotations)[number]>();
    for (const ann of state.parent_annotations) {
      annByPhrase.set(ann.phrase.trim().toLowerCase(), ann);
    }

    for (const [phraseKey, g] of byPhrase.entries()) {
      if (g.room_ids.size < 2) continue;
      const ann = annByPhrase.get(phraseKey);
      if (!ann) continue; // phrase doesn't match any current annotation
      const roomCount = g.room_ids.size;
      const severity = roomCount >= 3 ? "high" : "medium";
      const phrase = ann.phrase;
      const reading = ann.reading;
      findings.push({
        // Stable id — phrase-based, so re-emits across runs dedupe
        // even when the annotation's index moves around.
        id: `${KEY}__${phraseKey.replace(/[^a-z0-9]/g, "-").slice(0, 40)}`,
        analysis_key: KEY,
        category: "structure",
        severity,
        tier: 1,
        title: `"${phrase}" seeds ${roomCount} rooms`,
        summary: `${reading ? reading.slice(0, 120) : "Load-bearing reading"} — drives items in ${roomCount} rooms.`,
        body: {
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
