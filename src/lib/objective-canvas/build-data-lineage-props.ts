// ── build-data-lineage-props ──────────────────────────────────────
//
// Pure transform: the board's existing data (the ObjectiveStack +
// sub-objectives' layer tags) → props for <DataLineageView> (the Goal
// card's "Data Flow" face). No new fetches, no LLM.
//
// Composes the base-unit lineage from what already exists:
//   • stages          ← the layer stack (each layer's variables = its data state)
//   • transformInto   ← a sub-objective tagged to the NEXT layer (the mechanism
//                        that produces it), via the Step-1 layer_ordinals seam;
//                        falls back to the next layer's name.
//   • baseUnit/outcome← the substrate + outcome layer names.
//
// NOTE: the crisp coined atomic unit (e.g. "Attention units") would need LLM
// synthesis; deterministically we use the substrate layer's name + its
// variables, so nothing is fabricated.

import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import type { LineageStage } from "@/components/objective/data-lineage-view";

interface SubLite {
  title: string;
  layerOrdinals?: number[];
}

export function buildDataLineageProps(input: {
  objectiveStack: ObjectiveStack;
  subs: SubLite[];
}): {
  baseUnit: string;
  baseCollected: string;
  outcomeLabel: string;
  stages: LineageStage[];
} {
  const { objectiveStack, subs } = input;
  const layers = [...objectiveStack.layers].sort((a, b) => a.ordinal - b.ordinal);

  // A mechanism (sub-objective) operating at a given layer — the thing that
  // produces that layer's data. First tagged sub-objective wins.
  const mechAtLayer = (ordinal: number): string | undefined =>
    subs.find(
      (s) => Array.isArray(s.layerOrdinals) && s.layerOrdinals.includes(ordinal),
    )?.title;

  const stages: LineageStage[] = layers.map((l, i) => {
    const next = layers[i + 1];
    return {
      ordinal: l.ordinal,
      layerName: l.name,
      archetype: l.archetype,
      dataItems: (l.variables ?? [])
        .map((v) => v.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0)
        .slice(0, 5),
      collected: i === 0,
      transformInto: next ? mechAtLayer(next.ordinal) ?? next.name : undefined,
    };
  });

  const base = layers[0];
  const top = layers[layers.length - 1];

  return {
    baseUnit: base?.name ?? "Raw activity",
    baseCollected:
      (base?.variables ?? [])
        .map((v) => v.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0)
        .slice(0, 4)
        .join(", ") || "—",
    outcomeLabel: top?.name ?? "the outcome",
    stages,
  };
}
