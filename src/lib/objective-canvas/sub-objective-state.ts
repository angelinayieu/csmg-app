// ── Objective Canvas — sub-objective state helpers ──
//
// Extends the synthesis_data.objective_canvas slice (see
// clarifying-state.ts) with proposal + pick tracking.
//
// Shape:
//   synthesis_data.objective_canvas.sub_objectives = {
//     proposals: [{ id, title, summary, rationale, confidence,
//       recommended }],
//     picked_proposal_ids: [proposalId, ...],
//     picked_goal_ids: [improvement_goalId, ...],
//     generated_at: iso,
//   }
//
// `proposals` are pure AI artefacts (never written to the goals
// table). `picked_goal_ids` are the real improvement_goals rows
// inserted on confirm. `picked_proposal_ids` lets the UI re-mark
// proposals as picked when re-rendered after a refresh.

import {
  patchObjectiveCanvasState,
  readObjectiveCanvasState,
  type ObjectiveCanvasState,
} from "./clarifying-state";

export interface SubObjectiveProposal {
  id: string;
  title: string;
  summary: string;
  rationale: string;
  /** 0–1, LLM self-reported. UI rounds + colors. */
  confidence: number;
  /** True for the top-3 the LLM judged most load-bearing. The picker
   *  pre-checks these. */
  recommended: boolean;
}

export interface SubObjectiveBlock {
  proposals: SubObjectiveProposal[];
  picked_proposal_ids: string[];
  picked_goal_ids: string[];
  generated_at: string;
  /** Short noun phrase (≤3 words) naming what KIND of bucket these
   *  proposals are: "Features" for an app, "Lessons" for a course,
   *  "Bets" for a strategy, etc. LLM-supplied; shown in the picker
   *  header as "5 {category} proposed". Optional for back-compat
   *  with blocks generated before this field existed. */
  category?: string;
}

declare module "./clarifying-state" {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-unused-vars
  interface ObjectiveCanvasState {
    sub_objectives?: SubObjectiveBlock;
  }
}

export function readSubObjectiveBlock(
  state: ObjectiveCanvasState,
): SubObjectiveBlock | undefined {
  return state.sub_objectives;
}

export function writeSubObjectiveBlock(
  synthesisData: unknown,
  block: SubObjectiveBlock,
): Record<string, unknown> {
  return patchObjectiveCanvasState(synthesisData, {
    sub_objectives: block,
  });
}

/**
 * Normalize a raw LLM payload into clean SubObjectiveProposal[].
 * Drops malformed entries; clamps confidence; trims strings; enforces
 * `recommended` to ≤3 even if the LLM marked more.
 */
export function normalizeProposals(
  raw: unknown,
): SubObjectiveProposal[] {
  const items = Array.isArray(raw) ? raw : [];
  const cleaned = items
    .map((p): SubObjectiveProposal | null => {
      if (!p || typeof p !== "object") return null;
      const rec = p as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : "";
      const title = typeof rec.title === "string" ? rec.title.trim() : "";
      if (title.length === 0) return null;
      const summary =
        typeof rec.summary === "string" ? rec.summary.trim() : "";
      const rationale =
        typeof rec.rationale === "string" ? rec.rationale.trim() : "";
      const confidence =
        typeof rec.confidence === "number" && Number.isFinite(rec.confidence)
          ? Math.max(0, Math.min(1, rec.confidence))
          : 0.5;
      const recommended = Boolean(rec.recommended);
      return {
        id,
        title,
        summary,
        rationale,
        confidence,
        recommended,
      };
    })
    .filter((p): p is SubObjectiveProposal => p !== null)
    .slice(0, 8);

  // Cap recommended to top-3 by confidence.
  const sortedByConf = [...cleaned].sort(
    (a, b) => b.confidence - a.confidence,
  );
  const recommendedIds = new Set(
    sortedByConf.slice(0, 3).map((p) => p.id),
  );
  return cleaned.map((p) => ({
    ...p,
    recommended: recommendedIds.has(p.id),
  }));
}

// Re-export so call sites can import from a single module.
export { readObjectiveCanvasState, patchObjectiveCanvasState };
