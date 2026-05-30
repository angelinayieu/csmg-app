// ── Canvas AI Scanner — hybrid recommendations (Phase 2) ──
//
// Given an idea (a sticky note's text), rank which canvas operations would
// most help. HYBRID per CANVAS_AI_SCANNER_PLAN.md §3d:
//   Stage 1 — heuristicScan(): instant, rule-based, free. Shown immediately.
//   Stage 2 — refineScan(): an LLM pass (/api/canvas/scan-operations) re-ranks
//             + tailors the reasons. Soft-fails to the heuristic ranking.
//
// Only WIRED text operations are recommended (they run on a bare string today);
// entity/room ops join once Phase 3 lands a scratch-entity scaffold.

import {
  menuOperations,
  type OperationTarget,
} from "./canvas-operations";

export interface ScoredOperation {
  id: string;
  label: string;
  intent: string;
  /** One-line, idea-tailored "why this op" copy shown under the label. */
  reason: string;
  /** 0..1 relevance — drives ordering + the "recommended" highlight. */
  score: number;
}

/** Instant, rule-based ranking over the wired text operations. */
export function heuristicScan(target: OperationTarget): ScoredOperation[] {
  const text = target.text.trim();
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const isQuestion =
    /\?\s*$/.test(text) ||
    /^(how|what|why|which|should|can|when|where|who|is|are|do)\b/.test(lower);
  const hasVerb =
    /\b(build|launch|ship|improve|create|make|design|add|reduce|increase|grow|fix|automate|enable|integrate|optimi[sz]e)\b/.test(
      lower,
    );
  const isShort = words.length <= 4;
  const isBroad = words.length >= 6 && !isQuestion;
  const isSystemic =
    /\b(system|process|flow|pipeline|architecture|stack|loop|end-to-end|workflow)\b/.test(
      lower,
    );
  const isTechnical =
    /\b(api|data|algorithm|schema|model|service|function|database|latency|throughput|index|cache|query)\b/.test(
      lower,
    );

  const score: Record<string, number> = {
    questions: (isQuestion ? 0.92 : 0.42) + (isShort ? 0.14 : 0),
    decompose: (isBroad ? 0.86 : 0.5) + (words.length > 10 ? 0.1 : 0),
    variations: (isQuestion ? 0.34 : 0.62) + (hasVerb ? 0.08 : 0),
    make_plan: (hasVerb ? 0.82 : 0.46) + (isQuestion ? -0.12 : 0),
    make_technical: (isTechnical ? 0.32 : 0.58) + (hasVerb ? 0.06 : 0),
    layers: (isBroad ? 0.6 : 0.42) + (isSystemic ? 0.2 : 0),
    data_flow:
      (isTechnical || isSystemic ? 0.5 : 0.36) +
      (/\b(data|pipeline|process|flow|input|output|source|stream|scale)\b/.test(
        lower,
      )
        ? 0.22
        : 0),
  };
  const reason: Record<string, string> = {
    questions: isQuestion
      ? "It reads as an open question — clarify it"
      : "Pin down what to clarify first",
    decompose: isBroad
      ? "Broad idea — break it into parts"
      : "Surface its principles and pieces",
    variations: "Explore alternative angles",
    make_plan: hasVerb ? "Actionable — turn it into steps" : "Sketch the steps",
    make_technical: isTechnical
      ? "Push the technical detail further"
      : "Ground it in concrete tech",
    layers: "See it as a substrate→outcome stack",
    data_flow: "Trace inputs → processing → outputs",
  };

  return menuOperations()
    .map((op) => ({
      id: op.id,
      label: op.label,
      intent: op.intent,
      reason: reason[op.id] ?? op.intent,
      score: score[op.id] ?? 0.5,
    }))
    .sort((a, b) => b.score - a.score);
}

/** LLM refine: ask the model which ops best advance THIS idea and why.
 *  Returns null on any failure so the caller keeps the heuristic ranking. */
export async function refineScan(
  target: OperationTarget,
): Promise<ScoredOperation[] | null> {
  const ops = menuOperations();
  if (!target.text.trim() || ops.length === 0) return null;
  try {
    const res = await fetch("/api/canvas/scan-operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: target.text.slice(0, 2000),
        operations: ops.map((o) => ({ id: o.id, intent: o.intent })),
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      recommendations?: Array<{ id?: string; reason?: string }>;
    };
    const recs = json.recommendations ?? [];
    if (!recs.length) return null;
    const byId = new Map(ops.map((o) => [o.id, o]));
    const out: ScoredOperation[] = [];
    recs.forEach((r, i) => {
      const op = r.id ? byId.get(r.id) : undefined;
      if (op) {
        out.push({
          id: op.id,
          label: op.label,
          intent: op.intent,
          reason: r.reason?.trim() || op.intent,
          score: 1 - i * 0.01,
        });
      }
    });
    return out.length ? out : null;
  } catch {
    return null;
  }
}
