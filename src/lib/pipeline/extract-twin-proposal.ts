// ── Twin Proposal extraction adapter ──────────────────────────────────
//
// Reads an existing StrategicRecommendation (already in synthesis_data) and
// projects it into a TwinProposalJustification shape. Lets the
// <TwinProposalReviewPanel> render today, *before* PR 3b updates the
// strategy-engine prompt to emit this shape natively.
//
// Maps:
//   chosen_approach      ← strategy.summary || key_decision.recommended
//   key_tradeoffs        ← key_decision.alternatives  (option/tradeoff → why)
//                          + first 2 perspective rationales as soft-tradeoffs
//   alternatives_rejected← key_decision.alternatives that explicitly weren't chosen
//   confidence           ← strategy.confidence (already 0-100)
//
// When PR 3b lands, the strategy-engine emits TwinProposalJustification
// directly and this adapter is only used as a fallback for legacy strategies.

import type { StrategicRecommendation } from "@/types/strategy";
import type {
  TwinProposalJustification,
  TwinTradeoff,
  TwinAlternativeRejected,
} from "@/types/strategy";

export function extractTwinProposalFromStrategy(
  strategy: StrategicRecommendation | null | undefined,
): TwinProposalJustification | null {
  if (!strategy) return null;

  const chosen = strategy.summary?.trim()
    || strategy.key_decision?.recommended?.trim()
    || strategy.title?.trim()
    || "Workflow proposed by strategy generator.";

  const tradeoffs: TwinTradeoff[] = [];

  // Alternatives → tradeoff lines (option vs. recommended).
  const alternatives = strategy.key_decision?.alternatives ?? [];
  for (const alt of alternatives.slice(0, 3)) {
    if (!alt?.option || !alt?.tradeoff) continue;
    tradeoffs.push({
      tradeoff: `${strategy.key_decision.recommended} vs. ${alt.option}`,
      chosen_side: strategy.key_decision.recommended,
      why: alt.tradeoff,
    });
  }

  // Top perspectives' rationales → soft tradeoffs (only if we have room).
  if (tradeoffs.length < 3) {
    for (const p of strategy.perspectives ?? []) {
      if (tradeoffs.length >= 3) break;
      if (!p?.rationale) continue;
      tradeoffs.push({
        tradeoff: `Emphasize ${p.name ?? "perspective"}`,
        chosen_side: p.name ?? "this perspective",
        why: p.rationale,
      });
    }
  }

  const alternativesRejected: TwinAlternativeRejected[] = [];
  for (const alt of alternatives) {
    if (!alt?.option || alt.option === strategy.key_decision?.recommended) continue;
    alternativesRejected.push({
      name: alt.option,
      description: alt.tradeoff ?? "",
      why_rejected: alt.tradeoff ?? "Tradeoff not favorable for the current objective.",
    });
  }

  // pre_mortem failure modes are also "things we considered and worked around".
  for (const pm of (strategy.pre_mortem ?? []).slice(0, 2)) {
    if (alternativesRejected.length >= 4) break;
    if (!pm?.narrative) continue;
    alternativesRejected.push({
      name: `Path exposing: ${pm.assumption_exposed?.slice(0, 60) ?? pm.category}`,
      description: pm.narrative,
      why_rejected:
        pm.early_warnings?.length
          ? `Early warning signs: ${pm.early_warnings.slice(0, 2).join("; ")}`
          : `${pm.severity} severity, ${pm.probability} probability — risk profile not acceptable.`,
    });
  }

  return {
    chosen_approach: chosen,
    key_tradeoffs: tradeoffs,
    alternatives_rejected: alternativesRejected,
    confidence: typeof strategy.confidence === "number" ? strategy.confidence : 70,
    mechanism_ids: [],
    generated_at: new Date().toISOString(),
  };
}
