// ── Analysis: cross-room contradictions (Tier 2 — LLM) ────────────
//
// The genuine "this strategy isn't internally coherent" surface.
// Detects pairs of ELECTED variations across DIFFERENT rooms whose
// elections can't simultaneously hold without a resolution.
//
// Canonical example:
//   Room A · Pain "Privacy concerns" → elected "Anonymized data
//     collection"
//   Room B · Feature "Personalization Engine" → elected
//     "Personalized recommendations via PII"
// → Elections contradict — you can't anonymize AND personalize via
//   PII at the same time. Surface as a friction finding so the
//   user reconciles before the chain ships broken.
//
// Two-phase detection:
//   1. Pre-filter (no LLM) — pairs across-room, both-elected, share
//      ≥1 lens phrase. Caps at 12 pairs to bound LLM token cost.
//   2. LLM classify — which pre-filtered pairs are GENUINE
//      contradictions vs convergent / independent.
//
// On-demand (Tier 2). One LLM call per scan; idempotent against
// state_hash like the other Tier-2 modules.

import { llmJSON } from "@/lib/llm";
import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "cross_room_contradictions";

interface ElectedVariationRef {
  /** Stable triple — id of the room + item + variation. */
  room_id: string;
  room_title: string;
  item_id: string;
  item_name: string;
  item_layer: "pain" | "features" | "outcomes" | "objective";
  variation_id: string;
  variation_name: string;
  variation_description: string;
  variation_kind: string;
  /** Lowercase + trimmed phrases this variation derives from.
   *  Used for the pre-filter overlap check. */
  lens_phrases: string[];
}

interface CandidatePair {
  a: ElectedVariationRef;
  b: ElectedVariationRef;
  /** Lens phrases both members derive from. ≥1 by pre-filter
   *  construction. Drives the LLM's "look here for the tension"
   *  prompt context. */
  shared_phrases: string[];
}

interface LlmContradictionShape {
  contradictions?: Array<{
    /** Integer index into the candidate-pair array we sent in. */
    pair_index?: unknown;
    /** 3-6 word headline naming the tension. */
    title?: unknown;
    /** 1-2 sentences explaining why the pair contradicts. */
    explanation?: unknown;
    severity?: unknown;
    resolution_hints?: unknown;
  }>;
}

export const crossRoomContradictions: AnalysisModule = {
  key: KEY,
  label: "Cross-room contradictions",
  description:
    "Pairs of elected variations across rooms that can't hold simultaneously — surface so you reconcile before the chain ships broken.",
  category: "friction",
  tier: 2,
  trigger: "on_demand",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    if (state.rooms.length < 2) return [];

    // ── Phase 1: flatten elected variations across all rooms ──
    const electeds: ElectedVariationRef[] = [];
    const roomTitleById = new Map<string, string>(
      state.rooms.map((r) => [r.id, r.title]),
    );
    for (const item of state.items) {
      if (item.elected_variation_ids.length === 0) continue;
      const ed = item.expanded_detail;
      if (!ed || !Array.isArray(ed.variations)) continue;
      const variationById = new Map(ed.variations.map((v) => [v.id, v]));
      for (const vid of item.elected_variation_ids) {
        const v = variationById.get(vid);
        if (!v) continue;
        // Persisted provenance carries verbatim phrases — see
        // expand-item-detail.ts derived_from_annotations field.
        const lensPhrases: string[] = Array.isArray(
          v.derived_from_annotations,
        )
          ? v.derived_from_annotations
              .map((p) =>
                typeof p?.phrase === "string"
                  ? p.phrase.trim().toLowerCase()
                  : "",
              )
              .filter((p): p is string => p.length > 0)
          : [];
        electeds.push({
          room_id: item.room_id,
          room_title: roomTitleById.get(item.room_id) ?? "?",
          item_id: item.id,
          item_name: item.name,
          item_layer: item.layer,
          variation_id: v.id,
          variation_name: v.name,
          variation_description: v.description,
          variation_kind: v.kind ?? "alternative",
          lens_phrases: lensPhrases,
        });
      }
    }
    if (electeds.length < 2) return [];

    // ── Pre-filter: cross-room + share ≥1 lens phrase ──
    // Convergent elections (same room, same lens) often don't
    // contradict — they're the user committing to a theme.
    // Cross-room overlap is where strategy drift hides.
    const pairs: CandidatePair[] = [];
    for (let i = 0; i < electeds.length; i++) {
      for (let j = i + 1; j < electeds.length; j++) {
        const a = electeds[i];
        const b = electeds[j];
        if (a.room_id === b.room_id) continue;
        if (a.lens_phrases.length === 0 || b.lens_phrases.length === 0) {
          continue;
        }
        // Phrase overlap = strongest pre-LLM signal of "same theme,
        // potentially-conflicting frames." Other heuristics (kind
        // mismatch, opposing facets) are noisier — defer to a
        // follow-up if this filter under-recalls.
        const setB = new Set(b.lens_phrases);
        const shared: string[] = [];
        for (const p of a.lens_phrases) {
          if (setB.has(p)) shared.push(p);
        }
        if (shared.length === 0) continue;
        pairs.push({ a, b, shared_phrases: shared });
      }
    }
    if (pairs.length === 0) return [];

    // Rank by shared-phrase count descending; cap at 12 to keep the
    // LLM prompt bounded (~50 tokens per pair × 12 ≈ 600 tokens of
    // candidate block, plus framing).
    pairs.sort(
      (x, y) => y.shared_phrases.length - x.shared_phrases.length,
    );
    const candidates = pairs.slice(0, 12);

    // ── Phase 2: LLM classifies which pairs are real contradictions ──
    const candidateBlock = candidates
      .map(
        (p, idx) =>
          `  [${idx + 1}] ROOM A "${p.a.room_title}"\n      ${p.a.item_layer} item "${p.a.item_name}" elected variation "${p.a.variation_name}" (${p.a.variation_kind})\n      desc: ${p.a.variation_description.slice(0, 200)}\n      ROOM B "${p.b.room_title}"\n      ${p.b.item_layer} item "${p.b.item_name}" elected variation "${p.b.variation_name}" (${p.b.variation_kind})\n      desc: ${p.b.variation_description.slice(0, 200)}\n      shared lens phrases: ${p.shared_phrases.slice(0, 3).join(" · ")}`,
      )
      .join("\n\n");

    const system = `You read pairs of ELECTED design-pattern variations the user has committed to across different sub-objective rooms, and identify pairs that CONTRADICT — where holding both as elected creates a logical / operational tension that requires resolution.

A REAL contradiction means:
  • Both members are elected (user has committed to both)
  • They make claims that can't simultaneously be true / actionable AT THE STRATEGY LEVEL
  • The conflict isn't trivially resolvable by parallel execution
  • Example: "Anonymized data collection" in one room + "Personalized recommendations via PII" in another → cannot both hold
  • Counter-example: "Streak-based gamification" + "Mastery progression" → these are convergent, not contradictory

NOT a contradiction:
  • Same theme expressed differently in two rooms — convergent
  • Tension that's actually a productive design tradeoff already accounted for
  • Variations that touch different surfaces of the user's life
  • Variations on different abstraction layers (a pain root cause + a feature mechanism that addresses it are not contradictory by default)

OUTPUT for each pair you classify as a contradiction:
  • pair_index — 1-based index into the input list
  • title — 3-6 words naming the tension (e.g. "Anonymization vs personalization")
  • explanation — 1-2 sentences naming exactly why they conflict, referencing the variation names
  • severity — "high" when the contradiction blocks shipping; "medium" when it can be deferred but should be flagged
  • resolution_hints — 1-3 concrete short ways the user could reconcile (e.g. "Pseudonymized data with explicit opt-in")

Skip non-contradictions silently. Emit empty contradictions[] if none.

ANTI-PLATITUDE: "they could conflict in some scenarios" is forbidden. Be specific or skip. Severity must be defensible.

Return strict JSON.`;

    const user = `PARENT OBJECTIVE:\n"""\n${state.core_objective_text.slice(0, 800)}\n"""\n\nCANDIDATE PAIRS (${candidates.length} elected-variation pairs across different rooms, sharing ≥1 lens phrase):\n${candidateBlock}\n\nIdentify pairs that genuinely CONTRADICT per the system instructions.`;

    const raw = await llmJSON<LlmContradictionShape>({
      system,
      user,
      responseSchema: {
        name: "cross_room_contradictions",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            contradictions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  pair_index: { type: "number" },
                  title: { type: "string" },
                  explanation: { type: "string" },
                  severity: {
                    type: "string",
                    enum: ["high", "medium"],
                  },
                  resolution_hints: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: [
                  "pair_index",
                  "title",
                  "explanation",
                  "severity",
                  "resolution_hints",
                ],
              },
            },
          },
          required: ["contradictions"],
        },
      },
      temperature: 0.35,
      maxTokens: 1500,
    });

    const out: AnalysisFinding[] = [];
    const now = new Date().toISOString();
    const seenPairKeys = new Set<string>();

    for (const c of raw?.contradictions ?? []) {
      // Index validation — pair_index is 1-based; clamp & reject
      // out-of-range to harden against LLM hallucination.
      const rawIdx =
        typeof c?.pair_index === "number" && Number.isFinite(c.pair_index)
          ? Math.floor(c.pair_index)
          : NaN;
      if (!Number.isFinite(rawIdx) || rawIdx < 1 || rawIdx > candidates.length) {
        continue;
      }
      const pair = candidates[rawIdx - 1];

      const title =
        typeof c?.title === "string" ? c.title.trim().slice(0, 80) : "";
      if (!title) continue;
      const explanation =
        typeof c?.explanation === "string" ? c.explanation.trim().slice(0, 400) : "";
      const severity: "high" | "medium" =
        c?.severity === "high" ? "high" : "medium";
      const resolutionHints = Array.isArray(c?.resolution_hints)
        ? (c.resolution_hints as unknown[])
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim().slice(0, 160))
            .slice(0, 3)
        : [];

      // Deterministic finding id from the pair tuple — survives
      // rescans + lets mergeFindings preserve user disposition
      // across re-runs.
      const pairKey = [pair.a.variation_id, pair.b.variation_id]
        .sort()
        .join("|");
      if (seenPairKeys.has(pairKey)) continue;
      seenPairKeys.add(pairKey);
      const findingId = `${KEY}__${hashShort(pairKey)}`;

      out.push({
        id: findingId,
        analysis_key: KEY,
        category: "friction",
        severity,
        tier: 2,
        title,
        summary: explanation.slice(0, 220) || `${pair.a.variation_name} ↔ ${pair.b.variation_name}`,
        body: {
          pair: [
            {
              room_id: pair.a.room_id,
              room_title: pair.a.room_title,
              item_id: pair.a.item_id,
              item_name: pair.a.item_name,
              item_layer: pair.a.item_layer,
              variation_id: pair.a.variation_id,
              variation_name: pair.a.variation_name,
            },
            {
              room_id: pair.b.room_id,
              room_title: pair.b.room_title,
              item_id: pair.b.item_id,
              item_name: pair.b.item_name,
              item_layer: pair.b.item_layer,
              variation_id: pair.b.variation_id,
              variation_name: pair.b.variation_name,
            },
          ],
          explanation,
          resolution_hints: resolutionHints,
          shared_lens_phrases: pair.shared_phrases.slice(0, 3),
        },
        references: {
          room_ids: [pair.a.room_id, pair.b.room_id],
          item_ids: [pair.a.item_id, pair.b.item_id],
        },
        disposition: "open",
        generated_at: now,
      });
    }
    return out;
  },
};

/** Cheap string hash for stable finding ids. Mirrors the
 *  hash pattern used by itemsHash() in cluster-proposals.ts so
 *  the codebase keeps one source of truth for this idiom. */
function hashShort(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
