// ── Deepening prompt ─────────────────────────────────────────────
//
// Takes the current v1 annotations and runs them through 7
// structured probes that force depth in specific dimensions.
// Emits a v2 that EXTENDS v1 (never restates it) — adds distant
// analogies, second-order failure modes, hidden assumptions,
// steelmanned rivals, sensitivity flags, implicit anchors, and
// evidence audits.
//
// The probes are the thinking framework: each one is a question
// the LLM MUST answer before producing v2. Probes go into the
// system prompt; the user-prompt feeds v1's annotations as input.

import {
  GLYPH_KINDS,
  GLYPH_MEANINGS,
} from "@/components/objective/icons/annotation-glyphs";
import type { ObjectiveAnnotation } from "./generate-annotations";
import type { AnnotationSubObjectiveRef } from "./annotations-prompt";

export const PROBES = [
  {
    id: "distant_analogies",
    title: "Distant analogies you haven't considered",
    instruction:
      "For each annotation that already has analogies, identify 1-2 MORE analogies from domains DISTANT from the existing ones. If existing analogies are from Finance + Biology, the new ones must come from e.g. Music / Ritual / Architecture. Cite specific structural relations that transfer.",
  },
  {
    id: "second_order_failure",
    title: "Second-order failure modes",
    instruction:
      "For each annotation with fragility: name the CASCADE — what happens if the first failure mode fires? What other readings collapse? Append to fragility.why and fragility.sign with the second-order chain.",
  },
  {
    id: "hidden_assumptions",
    title: "Unstated assumptions",
    instruction:
      "Surface 1-3 ASSUMPTIONS each annotation is silently riding on that v1 didn't name. Add these to the dimensions[] array (as new factors named 'Assumes: …'). If an assumption is load-bearing, also add it as a tension entry with kind='tension' against the relevant phrase.",
  },
  {
    id: "steelman_rivals",
    title: "Steelman the rival reading",
    instruction:
      "For each annotation, take the not_reading and STRENGTHEN it. Then update the main reading to acknowledge the strengthened rival. If the rival is genuinely strong, lower the confidence score.",
  },
  {
    id: "weakest_link",
    title: "Weakest link in the inference chain",
    instruction:
      "For each annotation with inference_chain[]: identify the HOP with the lowest evidence behind it. Add 'WEAK' as a prefix to that hop's `via` and a 1-sentence note on what evidence would strengthen or refute it.",
  },
  {
    id: "implicit_anchors",
    title: "What v1 anchored on but didn't name",
    instruction:
      "Find phrases the user's text contains that v1 DIDN'T annotate but should have. Add 1-3 NEW annotations (full structure) for these missed phrases. Common omissions: implicit constraints, scope qualifiers, time horizons, audience markers.",
  },
  {
    id: "evidence_audit",
    title: "Evidence audit on each claim",
    instruction:
      "For each annotation's stakes + fragility fields: cite what TYPE of evidence would strengthen the claim (study, user interview, historical precedent, base rate, market signal). Append the evidence-type tag at the end of the field as '[Evidence: …]'.",
  },
] as const;

export interface BuildDeepenPromptArgs {
  objective: string;
  v1: ObjectiveAnnotation[];
  subObjectives: AnnotationSubObjectiveRef[];
}

export function buildDeepenSystemPrompt(): string {
  const probesBlock = PROBES.map(
    (p, i) => `  ${i + 1}. ${p.title.toUpperCase()}\n     ${p.instruction}`,
  ).join("\n\n");

  return `You DEEPEN an existing set of objective annotations through 7 structured probes. v1 already exists. Your job is to produce v2 that EXTENDS v1's depth in specific dimensions — never just restates v1.

THE 7 PROBES — answer each one before emitting v2:

${probesBlock}

OUTPUT SHAPE:
Same as v1 — full ObjectiveAnnotation objects. But every annotation should be MEASURABLY DEEPER than its v1 counterpart in ≥2 dimensions. NEW annotations from probe 6 should match the same structure.

DEPTH HEURISTIC — if v2 looks similar to v1 in your draft, you have failed. Concretely:
  - Every annotation must have ≥1 ADDITIONAL distant-domain analogy compared to v1, OR a stronger pre-mortem, OR surfaced assumptions.
  - At least one NEW annotation from probe 6 must appear (phrases v1 missed).
  - Steelmanned rivals must be visibly stronger than v1's not_reading.

GLYPH KINDS (carry through from v1's set, but pick fresh ones for new analogies):
${GLYPH_KINDS.map((k) => `  "${k}" — ${GLYPH_MEANINGS[k]}`).join("\n")}

Return strict JSON in the SAME schema as initial annotations (analogies[], dimensions[], inference_chain[], fragility{when,why,sign}, tensions[], etc.).`;
}

export function buildDeepenUserPrompt(args: BuildDeepenPromptArgs): string {
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

CURRENT ANNOTATIONS (v1) — extend these, don't restate:
${JSON.stringify(args.v1, null, 2)}

Now apply all 7 probes and emit v2. Every annotation in v2 must be measurably deeper than its v1 counterpart in ≥2 dimensions, AND surface ≥1 new annotation from probe 6 (implicit anchors).`;
}
