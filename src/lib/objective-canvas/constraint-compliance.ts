// ── Constraint Compliance Check ───────────────────────────────────
//
// Phase 5b — control-variable enforcement for the R&D engine. After
// proposeMechanismCandidates produces N new variants, this mini LLM
// call rates each candidate against the user's operational constraints
// (time / budget / team / risk / compliance) and returns a 0..1
// compliance score per candidate.
//
// The score is a SOFT penalty in the final effectiveness composite:
//   final = structural × specificity × addresses_pain × compliance
// A candidate that respects all constraints scores 1.0 (passes
// through unchanged). A candidate that violates one constraint
// might score 0.5 (visible but ranked lower). A candidate that
// violates multiple core constraints collapses to 0 (visible at
// the bottom — never auto-hidden so the user can see the agent's
// reasoning).
//
// Why a soft penalty + not a hard gate:
//   • Hard gates make the agent feel adversarial — "you can't
//     propose THIS" creates a UX where the user feels constrained
//     by the system instead of by their own reality
//   • Soft penalty lets the user see TRADE-OFFS — "this candidate
//     would work great if you could afford 3 more weeks" is
//     actionable info, not a wall
//   • The compliance score becomes a 4th dimension on the comparison
//     panel alongside structural / specificity / addresses_pain
//
// Performance: one LLM call rates ALL candidates in a single shot.
// Typical: ~3-5s. Models the cost as ~$0.001 per refinement run.

import { llmJSON } from "@/lib/llm";
import {
  type OperationalConstraints,
  buildConstraintsBlock,
} from "./constraints";

export interface ComplianceCheckCandidate {
  /** Stable id for round-tripping the score back to the right
   *  candidate row. Caller assigns this. */
  id: string;
  /** Candidate name (so the LLM knows which one it's rating). */
  name: string;
  /** Candidate description (the substantive content the LLM
   *  judges against constraints). */
  description: string;
  /** Candidate tradeoff (often surfaces resource implications). */
  tradeoff: string;
}

export interface ComplianceResult {
  id: string;
  compliance_score: number;
  /** Short explanation when score < 0.9 — names the specific
   *  constraint(s) the candidate strains. Empty when fully compliant. */
  rationale: string;
  /** Which constraint(s) the candidate primarily strains. Used by
   *  the UI to show "time + budget" tags next to weak compliance
   *  scores. */
  strained_constraints: string[];
}

const SYSTEM_PROMPT = `You are a constraint compliance auditor for a scientific design system. The user has set OPERATIONAL CONSTRAINTS (time / budget / team / risk / compliance) that any proposed mechanism variation must respect.

YOUR JOB: rate each candidate variation on how well it respects the constraints. Output a compliance_score 0..1 per candidate where:
  1.0  → fully respects all constraints
  0.8  → minor strain on one constraint (e.g. "slightly over time, but doable")
  0.5  → moderate violation of one constraint OR strain across multiple
  0.2  → strong violation of one or more constraints
  0.0  → completely incompatible — would require violating a hard constraint (compliance / regulatory)

For non-1.0 scores, list the specific constraints strained in strained_constraints[]: "time", "budget", "team", "risk", or one of the user's compliance requirements verbatim.

The rationale should be ONE sentence explaining the specific friction. Don't moralize; don't repeat the constraint text; just say WHY this candidate strains it.

Return strict JSON.`;

function buildUserPrompt(
  candidates: ComplianceCheckCandidate[],
  constraints: OperationalConstraints,
): string {
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. "${c.name}" (id: ${c.id})\n   ${c.description}\n   tradeoff: ${c.tradeoff}`,
    )
    .join("\n\n");
  return `${buildConstraintsBlock(constraints)}\n\nCANDIDATES TO RATE:\n\n${list}\n\nFor each candidate, return one entry with id + compliance_score + rationale + strained_constraints[].`;
}

export async function checkConstraintCompliance(
  candidates: ComplianceCheckCandidate[],
  constraints: OperationalConstraints | null,
): Promise<ComplianceResult[]> {
  // No constraints captured → everyone passes through at full
  // compliance. Caller treats this as "compliance is unknown,
  // assume compliant" — fair default since we have no rule to
  // enforce.
  if (!constraints || candidates.length === 0) {
    return candidates.map((c) => ({
      id: c.id,
      compliance_score: 1.0,
      rationale: "",
      strained_constraints: [],
    }));
  }

  const raw = await llmJSON<{
    ratings?: Array<{
      id?: unknown;
      compliance_score?: unknown;
      rationale?: unknown;
      strained_constraints?: unknown;
    }>;
  }>({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(candidates, constraints),
    responseSchema: {
      name: "constraint_compliance",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ratings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                compliance_score: { type: "number" },
                rationale: { type: "string" },
                strained_constraints: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: [
                "id",
                "compliance_score",
                "rationale",
                "strained_constraints",
              ],
            },
          },
        },
        required: ["ratings"],
      },
    },
    temperature: 0.2,
    maxTokens: 800,
  });

  // Build a quick id → result lookup so order doesn't matter.
  const byId = new Map<string, ComplianceResult>();
  for (const r of raw?.ratings ?? []) {
    const id = typeof r?.id === "string" ? r.id : "";
    if (!id) continue;
    const score =
      typeof r?.compliance_score === "number" &&
      Number.isFinite(r.compliance_score)
        ? Math.max(0, Math.min(1, r.compliance_score))
        : 1.0;
    const rationale =
      typeof r?.rationale === "string" ? r.rationale.trim().slice(0, 200) : "";
    const strained_constraints = Array.isArray(r?.strained_constraints)
      ? (r.strained_constraints as unknown[])
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .slice(0, 4)
          .map((s) => s.trim().slice(0, 40))
      : [];
    byId.set(id, {
      id,
      compliance_score: score,
      rationale,
      strained_constraints,
    });
  }

  // Map back to caller order. Missing candidates (LLM forgot to
  // rate one) default to full compliance — soft fail.
  return candidates.map(
    (c) =>
      byId.get(c.id) ?? {
        id: c.id,
        compliance_score: 1.0,
        rationale: "",
        strained_constraints: [],
      },
  );
}
