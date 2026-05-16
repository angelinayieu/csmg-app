// D-track Phase β — Cross-layer cascade prediction prompt.
//
// Asks the LLM to identify how changes in each layer of the user's
// domain ontology propagate to adjacent layers. Sibling to the
// deterministic `cross-layer-analysis.ts` (which detects layer
// TENSIONS — internal vs external claim mismatches). This module
// predicts layer CASCADES — directional propagation with lag,
// mechanism, strength.
//
// Output is a structured array that maps 1:1 to rows in the
// `layer_dependencies` table. The caller persists each row + dispatches
// the `interaxis:layer-dependencies-materialized` window event so
// downstream surfaces (LayerStackShape arrows, variant ripple chips)
// refresh.
//
// Why a dedicated prompt rather than rolling into the existing
// strategy prompt:
//   • Cascade reasoning is per-space, not per-strategy — it ought to
//     happen once at synthesize and feed many subsequent strategy
//     variants.
//   • Keeps the strategy prompt focused on producing strategies; the
//     cascade prompt focuses on factual propagation claims.
//   • Lets us re-run cascade prediction independently when the
//     ontology or KG changes without regenerating strategies.

import type { LayerOntologyRow } from "@/types/layer-ontology";
import type { Entity, Edge } from "@/types";

export interface CrossLayerCascadePromptArgs {
  /** Layers in this space, sorted by ordinal asc. */
  ontology: LayerOntologyRow[];
  /**
   * Entities grouped by layer_id (the ontology row id). We pass the
   * entity NAMES (not full rows) — the LLM doesn't need confidence,
   * importance, etc. to reason about layer-level propagation.
   */
  entitiesByLayerId: Map<string, Array<{ entity_id: string; name: string }>>;
  /**
   * Cross-layer edges — pairs of (from_layer_id, to_layer_id, edge
   * count, top edge dimensions). Computed from the entities + edges
   * by the caller via the existing computeCrossLayerEdgeCounts helper.
   * Drives the LLM toward "you have evidence of this propagation in
   * the KG" rather than free-form speculation.
   */
  crossLayerEdgeSummary: Array<{
    from_layer_id: string;
    to_layer_id: string;
    edge_count: number;
    top_dimensions: string[];
  }>;
  /** Optional space name for prompt context. */
  spaceName?: string;
}

/** Shape the LLM must emit. Mirrors LayerDependencyRow without the
 *  DB-managed fields (id, user_id, generated_at, source). */
export interface CrossLayerCascadeLLMOutput {
  cascades: Array<{
    from_layer_id: string;
    to_layer_id: string;
    kind:
      | "causal"
      | "modulatory"
      | "inhibitory"
      | "compensatory"
      | "reinforcing";
    strength: number;
    lag_label: string | null;
    lag_hours: number | null;
    mechanism: string;
    evidence_summary: string | null;
    confidence: number;
  }>;
}

export function getCrossLayerCascadePrompt(args: CrossLayerCascadePromptArgs): {
  system: string;
  user: string;
} {
  const { ontology, entitiesByLayerId, crossLayerEdgeSummary, spaceName } = args;

  // Render the ontology block — one section per layer with its label
  // and a sample of entities so the LLM knows what kind of "thing"
  // belongs to each layer.
  const ontologyBlock = ontology
    .map((layer) => {
      const ents = entitiesByLayerId.get(layer.id) ?? [];
      const sampleNames = ents
        .slice(0, 8)
        .map((e) => `"${e.name}"`)
        .join(", ");
      const more = ents.length > 8 ? ` (+${ents.length - 8} more)` : "";
      return `  ${layer.ordinal}. ${layer.label} (slug: ${layer.slug}, id: ${layer.id})
     ${layer.description ?? "(no description)"}
     Typical entities: ${sampleNames || "(none assigned)"}${more}`;
    })
    .join("\n");

  // Cross-layer edge evidence block — the LLM uses this to anchor its
  // cascade claims in actual graph structure rather than speculation.
  const edgeEvidenceBlock = crossLayerEdgeSummary.length > 0
    ? crossLayerEdgeSummary
        .map((e) => {
          const fromLayer = ontology.find((l) => l.id === e.from_layer_id);
          const toLayer = ontology.find((l) => l.id === e.to_layer_id);
          if (!fromLayer || !toLayer) return null;
          return `  ${fromLayer.label} → ${toLayer.label}: ${e.edge_count} edge${e.edge_count === 1 ? "" : "s"} (dimensions: ${e.top_dimensions.join(", ") || "unknown"})`;
        })
        .filter(Boolean)
        .join("\n")
    : "  (no cross-layer edges yet — propose cascades based on domain knowledge)";

  const system = `You are a cross-layer propagation analyst. Your job is to predict how changes in one ontology layer cascade to adjacent layers within a single domain.

CRITICAL RULES:

1. EVERY cascade you propose MUST name a real mechanism — not just "A affects B" but "A causes B via X". The mechanism is the load-bearing claim; without it, the cascade is empty.

2. PREFER cascades that have edge evidence in the KG (see the "Cross-layer edge evidence" block in the user message). Cascades grounded in observed edges are more trustworthy than pure domain-knowledge inferences. When you propose a cascade with no edge evidence, your confidence MUST be ≤ 0.5.

3. LAGS matter. A behavioral change can hit biomarkers in weeks but cognitive function in months. Always commit to lag_label (e.g. "minutes", "days", "weeks", "months", "varies") and provide lag_hours (numeric estimate) when you're confident. Set lag_hours to null when you can't commit to a number.

4. STRENGTH is per-cascade, not per-layer. A weak (strength: 0.2) causal cascade is more honest than a strong (strength: 0.9) speculation.

5. DIRECTION matters. If A causes B AND B feeds back to A, emit TWO rows (one A→B, one B→A) and mark BOTH with kind: "reinforcing". Don't conflate.

6. SELF-LOOPS forbidden. Every cascade must have from_layer_id ≠ to_layer_id.

7. KIND vocabulary (closed):
   • causal:       A causes B (one-way mechanistic)
   • modulatory:   A scales B's response (A doesn't drive B alone)
   • inhibitory:   A suppresses B (negative propagation)
   • compensatory: A buffers B against perturbation
   • reinforcing:  A and B form a feedback loop (encoded as two rows)

8. CONFIDENCE is your self-rated belief in the cascade, 0..1. Stay calibrated: 0.9 should be reserved for cascades both grounded in edge evidence AND in well-established domain knowledge. 0.5 means "plausible but I haven't seen direct evidence."

OUTPUT FORMAT — JSON only, no prose:
{
  "cascades": [
    {
      "from_layer_id": "<uuid>",
      "to_layer_id": "<uuid>",
      "kind": "causal | modulatory | inhibitory | compensatory | reinforcing",
      "strength": 0.0..1.0,
      "lag_label": "string | null",
      "lag_hours": number | null,
      "mechanism": "1-2 sentence mechanism, naming specific entities when relevant",
      "evidence_summary": "which edges/entities support this | null when speculative",
      "confidence": 0.0..1.0
    }
  ]
}

Emit 5-12 cascades. Cover every layer that has at least one outgoing edge in the evidence block. Skip layers with zero entities.`;

  const user = `${spaceName ? `Space: ${spaceName}\n\n` : ""}LAYER ONTOLOGY (this space's domain hierarchy):

${ontologyBlock}

CROSS-LAYER EDGE EVIDENCE (from the knowledge graph):

${edgeEvidenceBlock}

Produce the cascade predictions as JSON per the format in the system prompt. Ground every cascade in named mechanism + (when available) edge evidence. Stay calibrated on strength + confidence.`;

  return { system, user };
}
