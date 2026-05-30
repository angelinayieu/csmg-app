// ── build-macro-summary-props ─────────────────────────────────────
//
// Pure transform: the board's existing data (objective text + the
// ObjectiveStack + the sub-objectives' layer tags + the cross-room
// analysis findings) → props for <MacroSummaryCard> (the Goal card's
// Overview face). No new fetches.
//
// macro problems come from the `macro_problems` Tier-2 roll-up findings
// (analyses/distill-macro-problems.ts), grouped by layer_ordinal. They're
// empty until that roll-up has been run — the card degrades gracefully.

import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";
import type {
  MacroSummaryLayer,
  MacroSubProblem,
} from "@/components/objective/macro-summary-card";

interface SubLite {
  title: string;
  layerOrdinals?: number[];
}

export function buildMacroSummaryProps(input: {
  objective: string;
  subs: SubLite[];
  objectiveStack: ObjectiveStack;
  analysis?: CrossRoomAnalysisState | null;
}): { distilledObjective: string; layers: MacroSummaryLayer[] } {
  const { objective, subs, objectiveStack, analysis } = input;

  // Group the rolled-up macro sub-problems by layer ordinal.
  const problemsByOrdinal = new Map<number, MacroSubProblem[]>();
  for (const f of analysis?.findings ?? []) {
    if (f.analysis_key !== "macro_problems") continue;
    const ord =
      typeof f.body?.layer_ordinal === "number"
        ? (f.body.layer_ordinal as number)
        : null;
    if (ord == null) continue;
    const arr = problemsByOrdinal.get(ord) ?? [];
    arr.push({ name: f.title, description: f.summary || undefined });
    problemsByOrdinal.set(ord, arr);
  }

  const layers: MacroSummaryLayer[] = [...objectiveStack.layers]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((l) => ({
      ordinal: l.ordinal,
      name: l.name,
      gloss: (l.description ?? "").trim().slice(0, 140) || l.archetype,
      subObjectives: subs
        .filter(
          (s) =>
            Array.isArray(s.layerOrdinals) && s.layerOrdinals.includes(l.ordinal),
        )
        .map((s) => s.title),
      macroProblems: problemsByOrdinal.get(l.ordinal) ?? [],
    }));

  // Real distilled objective from the macro_problems roll-up (a special
  // finding with body.kind === "distilled_objective"). Falls back to the
  // first sentence of the objective text only until the roll-up has run.
  let distilled = "";
  for (const f of analysis?.findings ?? []) {
    if (f.analysis_key !== "macro_problems") continue;
    const body = (f.body ?? {}) as Record<string, unknown>;
    if (body.kind === "distilled_objective") {
      distilled = typeof body.text === "string" ? body.text : f.title;
      break;
    }
  }

  return {
    distilledObjective: distilled || firstSentence(objective),
    layers,
  };
}

function firstSentence(s: string): string {
  const t = (s ?? "").trim();
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim().slice(0, 240);
}
