// ── compute-macro-chain ────────────────────────────────────────────
//
// The cross-LEVEL chain — the data-flow spine the tech spec needs:
//
//   MACRO-problem → micro-problem(s) → micro-mechanism(s)
//                 → micro-outcome(s) → MACRO-outcome
//
// Built entirely on artifacts that already exist (verified against the
// live graph, 2026-05-29):
//   • MACRO-problem      ← a `macro_problems` analysis finding (Step 2 of
//                          MACRO_ROLLUP): body.layer_ordinal + references
//                          .item_ids (the room pains it groups).
//   • micro-problem      ← those pain entities.
//   • micro-mechanism    ← pain→feature edges (real: 4 in the sample room).
//   • micro-outcome      ← feature→outcome edges (real: 4 in the sample room).
//   • MACRO-outcome      ← the top outcome layer; flagged `objective_edge`
//                          when a real outcome→objective edge anchors the
//                          roll-up (real: 1 in the sample room), else
//                          `top_layer` (structural attachment — labelled
//                          honestly, NOT a fabricated link).
//
// Pure function over CrossRoomState — no component coupling, no LLM, no DB.
// Replicates compute-chains.ts's edge composition (pain↔feature,
// feature↔outcome are bidirectional in the data) over EdgeSnapshot.
//
// COORDINATION: new file. Does not touch the in-flight brief builder
// (Step 1) or enrich-mechanism-spec (Step 2). When those commit, this
// chain renders alongside the per-mechanism specs in the deliverable.

import type {
  AnalysisFinding,
  CrossRoomState,
  ItemSnapshot,
} from "./analyses/types";

export interface MacroChainOutcome {
  id: string;
  name: string;
  /** min(painFeature, featureOutcome) hop strength — the chain is only
   *  as strong as its weakest hop (mirrors compute-chains.ts). */
  composite: number;
}

export interface MacroChainMechanism {
  id: string;
  name: string;
  outcomes: MacroChainOutcome[];
}

export interface MacroChainHop {
  microProblem: { id: string; name: string };
  mechanisms: MacroChainMechanism[];
}

export interface MacroChain {
  macroProblem: {
    /** The macro_problems finding id. */
    id: string;
    name: string;
    summary: string;
    layerOrdinal: number;
    layerName: string;
  };
  /** One per micro-problem (room pain) the macro-problem groups. */
  hops: MacroChainHop[];
  /** Where the chain terminates + how that terminus was derived. */
  macroOutcome: {
    name: string;
    /** `objective_edge` = a real outcome→objective edge anchors it;
     *  `top_layer` = structural attachment to the top outcome layer
     *  (honest: no computed edge, the room operates under that layer). */
    basis: "objective_edge" | "top_layer";
  };
  /** True when ≥1 micro-problem reached a full mechanism→outcome chain.
   *  False = the macro-problem's rooms aren't fully wired yet (honest
   *  partial state, surfaced rather than hidden). */
  complete: boolean;
}

/**
 * Assemble the cross-level chains for a space from the macro_problems
 * findings + the room graph. One MacroChain per (non-dismissed)
 * macro_problems finding.
 */
export function computeMacroChains(
  state: CrossRoomState,
  findings: AnalysisFinding[],
): MacroChain[] {
  const itemById = new Map<string, ItemSnapshot>();
  for (const it of state.items) itemById.set(it.id, it);

  // ── Compose the room graph once (pain→feature, feature→outcome,
  //    outcome→objective). Edges are bidirectional in the data, so we
  //    normalize by entity layer, exactly like compute-chains.ts. ──
  const featuresByPain = new Map<string, Array<{ featureId: string; strength: number }>>();
  const outcomesByFeature = new Map<string, Array<{ outcomeId: string; strength: number }>>();
  const outcomesWithObjectiveEdge = new Set<string>();

  for (const e of state.edges) {
    const s = itemById.get(e.source_entity_id);
    const t = itemById.get(e.target_entity_id);
    if (!s || !t) continue;
    const strength = e.strength ?? 0;

    if (
      (s.layer === "pain" && t.layer === "features") ||
      (s.layer === "features" && t.layer === "pain")
    ) {
      const pain = s.layer === "pain" ? s : t;
      const feature = s.layer === "features" ? s : t;
      const arr = featuresByPain.get(pain.id) ?? [];
      arr.push({ featureId: feature.id, strength });
      featuresByPain.set(pain.id, arr);
    } else if (
      (s.layer === "features" && t.layer === "outcomes") ||
      (s.layer === "outcomes" && t.layer === "features")
    ) {
      const feature = s.layer === "features" ? s : t;
      const outcome = s.layer === "outcomes" ? s : t;
      const arr = outcomesByFeature.get(feature.id) ?? [];
      arr.push({ outcomeId: outcome.id, strength });
      outcomesByFeature.set(feature.id, arr);
    } else if (
      (s.layer === "outcomes" && t.layer === "objective") ||
      (s.layer === "objective" && t.layer === "outcomes")
    ) {
      const outcome = s.layer === "outcomes" ? s : t;
      outcomesWithObjectiveEdge.add(outcome.id);
    }
  }

  // ── Layer-name lookup + the top outcome layer (the macro terminus). ──
  const stack = state.layers;
  const layerNameByOrdinal = new Map<number, string>();
  let topOutcomeLayerName = "Objective outcome";
  if (stack?.layers?.length) {
    for (const l of stack.layers) layerNameByOrdinal.set(l.ordinal, l.name);
    const outcomeLayer =
      [...stack.layers]
        .filter((l) => l.archetype === "outcome" || l.archetype === "output")
        .sort((a, b) => b.ordinal - a.ordinal)[0] ??
      [...stack.layers].sort((a, b) => b.ordinal - a.ordinal)[0];
    if (outcomeLayer) topOutcomeLayerName = outcomeLayer.name;
  }

  const macroFindings = findings.filter(
    (f) => f.analysis_key === "macro_problems" && f.disposition !== "dismissed",
  );

  const chains: MacroChain[] = [];
  for (const f of macroFindings) {
    const layerOrdinal =
      typeof f.body?.layer_ordinal === "number" ? f.body.layer_ordinal : 0;
    const macroName =
      typeof f.body?.name === "string" && f.body.name.trim()
        ? (f.body.name as string)
        : f.title;
    const painIds = f.references?.item_ids ?? [];

    const hops: MacroChainHop[] = [];
    let anyComplete = false;
    let anyObjectiveEdge = false;

    for (const painId of painIds) {
      const pain = itemById.get(painId);
      if (!pain) continue;
      const mechanisms: MacroChainMechanism[] = [];
      for (const { featureId, strength: pf } of featuresByPain.get(painId) ?? []) {
        const feat = itemById.get(featureId);
        if (!feat) continue;
        const outcomes: MacroChainOutcome[] = [];
        for (const { outcomeId, strength: fo } of outcomesByFeature.get(featureId) ?? []) {
          const out = itemById.get(outcomeId);
          if (!out) continue;
          if (outcomesWithObjectiveEdge.has(out.id)) anyObjectiveEdge = true;
          outcomes.push({ id: out.id, name: out.name, composite: Math.min(pf, fo) });
        }
        if (outcomes.length > 0) anyComplete = true;
        mechanisms.push({ id: feat.id, name: feat.name, outcomes });
      }
      hops.push({ microProblem: { id: pain.id, name: pain.name }, mechanisms });
    }

    chains.push({
      macroProblem: {
        id: f.id,
        name: macroName,
        summary: f.summary,
        layerOrdinal,
        layerName: layerNameByOrdinal.get(layerOrdinal) ?? `Layer ${layerOrdinal}`,
      },
      hops,
      macroOutcome: {
        name: topOutcomeLayerName,
        basis: anyObjectiveEdge ? "objective_edge" : "top_layer",
      },
      complete: anyComplete,
    });
  }

  return chains;
}
