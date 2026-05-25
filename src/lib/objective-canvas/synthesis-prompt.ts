// ── Synthesis (arbitration) prompt ──
//
// Takes two versions of annotations (typically v1 + v2) and runs
// per-annotation arbitration: for each phrase that appears in either
// version, the AI decides which version's reading is stronger and
// records WHY. The output is vfinal + an arbitration_record[].
//
// Quality bar: every decision must include a 1-sentence justification.
// "Why I picked v2's reading": <one specific reason rooted in the
// rigor framework — anti-vagueness, specificity, mechanism>. If
// keeping fields FROM the other version (e.g. v2's analogies + v1's
// crystal), that's recorded in kept_from_other.

import type { ObjectiveAnnotation } from "./generate-annotations";
import type { AnnotationSubObjectiveRef } from "./annotations-prompt";

export interface BuildSynthesisArgs {
  objective: string;
  v1: ObjectiveAnnotation[];
  v2: ObjectiveAnnotation[];
  subObjectives: AnnotationSubObjectiveRef[];
}

export function buildSynthesisSystemPrompt(): string {
  return `You arbitrate between two versions of the SAME objective's annotations: v1 and v2. For each phrase that appears in either version, you pick the stronger reading and explain why.

PER-PHRASE ARBITRATION RULES:
- For each phrase present in v1, v2, or both: emit ONE final annotation in vfinal.annotations[] AND ONE arbitration_record[] entry.
- The arbitration_record entry:
    { phrase, picked_from: "v1" | "v2", why: one sentence, kept_from_other: short string | null }
- "why" must cite a SPECIFIC rigor dimension: anti-vagueness, specificity-to-text, causal-mechanism named, pre-mortem rigor, distant-domain analogy quality, evidence anchoring, or steelmanned rival quality.
- "kept_from_other" names ONE thing from the rival version you preserved in vfinal (e.g. "v1's crystal 'Worth'", "v2's Hospitality analogy"). Null if nothing from the other version is preserved.

JUDGMENT HEURISTICS — apply in order:
1. SPECIFICITY — does the version reference something concrete from the user's text?
2. MECHANISM — does the WHY name a causal chain, or just restate the claim?
3. PRE-MORTEM RIGOR — is fragility tripartite (when/why/sign) with no vague hedges?
4. DOMAIN DISTANCE — do the analogies span structurally distant domains?
5. ANTI-VAGUENESS — any forbidden phrases ("not universally applicable", "may not always work")? Auto-disqualified.
6. NEW INSIGHTS — did v2 surface phrases v1 missed (probe 6)? Include those in vfinal even if v1 didn't have them.

EDGE CASES:
- Phrase exists only in v2 — include it in vfinal; picked_from = "v2"; why = why the new phrase deserves an annotation.
- Phrase exists only in v1 (v2 dropped it) — include only if v2's drop was wrong; explain the decision.
- Both versions are similarly strong — pick v2 by default (it's the more-considered draft) but mark why; preserve specific fields from v1 via kept_from_other.

Return strict JSON.`;
}

export function buildSynthesisUserPrompt(args: BuildSynthesisArgs): string {
  const subBlock =
    args.subObjectives.length > 0
      ? `\n\nSUB-OBJECTIVES:\n${args.subObjectives
          .map(
            (s, i) =>
              `  ${i + 1}. [id: ${s.id}] ${s.title}${
                s.description ? ` — ${s.description.slice(0, 200)}` : ""
              }`,
          )
          .join("\n")}`
      : "";

  return `CORE OBJECTIVE:
"""
${args.objective}
"""${subBlock}

VERSION 1 (initial):
${JSON.stringify(args.v1, null, 2)}

VERSION 2 (deepened):
${JSON.stringify(args.v2, null, 2)}

Arbitrate per phrase. Produce vfinal with the chosen annotations AND an arbitration_record[] explaining each decision.`;
}
