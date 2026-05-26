// ── Analysis: orphan annotations (Tier 1) ─────────────────────────
//
// Parent-objective annotations the lens emitted, but NO item across
// ANY room derives from. The generator either missed a load-bearing
// reading or the reading is genuinely peripheral.
//
// We surface only HIGH-WEIGHT orphans (top 8 lens slots), since the
// lens itself is the bound — the room generators were given exactly
// these 8 and asked to derive from them.
//
// Tier 1: no LLM. Pure set complement.

import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "orphan_annotations";

export const orphanAnnotations: AnalysisModule = {
  key: KEY,
  label: "Orphan annotations",
  description:
    "Parent-objective readings no room derives from. Generator may have missed a load-bearing reading.",
  category: "gap",
  tier: 1,
  trigger: "auto_on_scan",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    if (state.parent_annotations.length === 0) return [];
    if (state.items.length === 0) return [];

    // Build the SAME weight-sorted top-8 lens the generator built.
    const ranked = [...state.parent_annotations]
      .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
      .slice(0, 8);

    // Phase-2 stability — match on PHRASE, not index. Indices are
    // generation-time positional slots that can shift when
    // annotations are regenerated (deepen/synthesize re-weights the
    // lens). Phrases are persisted alongside indices for exactly
    // this reason. We still emit annotation_index in the body for
    // display continuity, but coverage detection uses phrase
    // equality.
    const usedPhrases = new Set<string>();
    for (const item of state.items) {
      for (const phrase of item.derived_from_annotation_phrases) {
        usedPhrases.add(phrase); // already lowercased + trimmed
      }
    }
    // Indices retained as a fallback for items persisted BEFORE the
    // phrase field was added — keeps coverage accurate during the
    // migration window when some items have phrases and some don't.
    const usedIndices = new Set<number>();
    for (const item of state.items) {
      for (const idx of item.derived_from_annotation_indices) {
        usedIndices.add(idx);
      }
    }

    const findings: AnalysisFinding[] = [];
    const now = new Date().toISOString();

    ranked.forEach((ann, i) => {
      const idx = i + 1;
      const phraseKey = ann.phrase.trim().toLowerCase();
      // An annotation is COVERED if any item's phrases include it
      // OR (legacy fallback) any item's indices match.
      if (usedPhrases.has(phraseKey)) return;
      if (usedPhrases.size === 0 && usedIndices.has(idx)) return;
      const weight = ann.weight ?? 0.5;
      // High-weight orphans are louder. Weight ≥ 0.7 = high severity.
      const severity =
        weight >= 0.7 ? "high" : weight >= 0.5 ? "medium" : "low";
      findings.push({
        id: `${KEY}__${idx}`,
        analysis_key: KEY,
        category: "gap",
        severity,
        tier: 1,
        title: `"${ann.phrase}" — not derived from anywhere`,
        summary: `Lens reading (weight ${weight.toFixed(2)}) was never picked up by any room.${ann.reading ? ` Reading: ${ann.reading.slice(0, 90)}` : ""}`,
        body: {
          annotation_index: idx,
          phrase: ann.phrase,
          reading: ann.reading,
          weight,
          layer_tag: ann.layer_tag,
        },
        references: {
          room_ids: [],
          item_ids: [],
        },
        disposition: "open",
        generated_at: now,
      });
    });

    return findings.sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    });
  },
};
