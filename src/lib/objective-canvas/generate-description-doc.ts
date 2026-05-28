// ── Generate a PR/FAQ-style description doc for a variation (Op A) ──
//
// One-to-two-paragraph product description, structured in the
// Amazon PR/FAQ tradition: write the explanation BEFORE you write
// the implementation. Five fixed headings keep the output coherent
// across variations and let the Deliverables modal render it without
// markdown surprises.
//
// Distinct from the existing fields:
//   - variation.description    — 1-2 sentences (compressed)
//   - variation.tradeoff       — 1 sentence
//   - variation.export_prompt  — markdown framed AS A PROMPT for
//                                 another LLM (different audience,
//                                 different shape)
//   - variation.description_doc (this) — narrative for a human
//                                 reader: stakeholder, teammate,
//                                 future self.
//
// Anti-filler is enforced in the system prompt: banned words list +
// hard section caps. A one-pass critic+rewrite is available as an
// opt-in refine step (default off — single-call MVP keeps cost low).

import { llmJSON } from "@/lib/llm";
import type { ItemVariation } from "./expand-item-detail";
import type { OperationalConstraints } from "./constraints";
import type { MechanismSpec } from "./enrich-mechanism-spec";

export interface DescriptionDocResult {
  doc: string;
}

interface DocLlmShape {
  doc?: unknown;
}

const DOC_SCHEMA = {
  name: "VariationDescriptionDoc",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      doc: { type: "string" },
    },
    required: ["doc"],
  },
} as const;

export interface GenerateDescriptionDocArgs {
  variation: ItemVariation;
  entityName: string;
  objectiveText: string;
  roomTitle?: string | null;
  painText?: string | null;
  constraints?: OperationalConstraints | null;
  /** Other elected variations on the same mechanism — when present,
   *  the doc mentions composition rather than pretending this is
   *  the only one. */
  siblingElections?: Array<{ name: string; description: string }>;
  /** When true, fire a one-pass critic+rewrite to tighten language.
   *  Costs +1 LLM call (~$0.01); doubles latency. Off by default. */
  refine?: boolean;
  /** The parent feature's v2 technical mechanism spec, when one has
   *  been generated. When present, the doc's "How it works" + "How
   *  it's built" + validation sections are GROUNDED in it (mechanism
   *  of action, active ingredients, runtime flow, chosen build method,
   *  validation experiment) instead of re-derived — so the deliverable
   *  carries the same technical depth, no parallel content. */
  mechanismSpec?: MechanismSpec | null;
}

export async function generateVariationDescriptionDoc(
  args: GenerateDescriptionDocArgs,
): Promise<DescriptionDocResult> {
  const draft = await generateDraft(args);
  if (!args.refine) return { doc: draft };
  const refined = await refineDraft(draft);
  return { doc: refined };
}

// ── Generator (single call) ──────────────────────────────────────

async function generateDraft(args: GenerateDescriptionDocArgs): Promise<string> {
  const sys = `You write product description docs in the PR/FAQ style Amazon uses internally — a short, concrete narrative that makes a non-technical reader understand WHAT the thing is, WHO it's for, and WHY it would work, BEFORE any implementation discussion.

OUTPUT JSON: { "doc": "<markdown>" }

DOC SHAPE (use these headings exactly, in this order):

## What it is
One paragraph, 60-110 words. Describe the mechanism as if it already exists. Concrete, present tense ("X does Y", not "X will do Y"). Avoid metaphors that don't pull weight.

## Who it serves
One paragraph, 40-80 words. Name the specific user role / segment whose pain this addresses. Describe a moment in their day this changes. If accessibility or inclusivity widens the user set in a non-obvious way, name that.

## How it works
One paragraph, 60-120 words. The mechanism in three beats: the user does X → the system does Y → the user experiences Z. Reference the tradeoff naturally — don't bury it.

## How it's built
One paragraph + 3-6 bullets, ≤140 words total. The TECHNICAL substance an engineer needs: the active ingredients (the components that carry the effect), what gets built/provisioned (data, UI, logic, or for non-software: materials, schedule, instrument), the runtime flow in brief (which component does what to which data), and the chosen build approach over the alternatives. Be concrete — name components, not categories. This is where the doc earns the word "spec".

## What we'd need to find out
3-5 bullets, each <20 words. The open questions whose answers would change whether this is the right call. If the variation already has open_questions[], integrate them — don't repeat verbatim.

## How we'd know it worked
2-3 bullets, each <20 words. Concrete observable signals — not vanity metrics. Tie to the parent room's success outcome. When a validation experiment is supplied, name it (the test that would confirm the mechanism).

GROUNDING (when a TECHNICAL SPEC is provided below): the "How it works", "How it's built", and "How we'd know it worked" sections MUST draw their substance from it — reuse the mechanism-of-action, active ingredients, runtime flow, chosen build method, and validation experiment verbatim-in-spirit. Do NOT invent parallel technical claims that contradict the spec. When NO spec is provided, write "How it's built" from first principles, still concrete.

RULES:
- Total length 450-700 words. Tight. If you go over, cut.
- No headings beyond the six above. No tables. No code blocks. No emojis.
- BANNED WORDS: innovative, leverage, robust, solution, platform, enables, seamless, holistic, synergy, paradigm, ecosystem, world-class, cutting-edge, best-in-class. Strip these on sight — they signal filler not substance.
- The user has a domain. Reference it where natural; never use "user" as a placeholder for "anyone." When you say "the user", make it concrete in the next clause (e.g., "the user — a solo founder writing weekly investor updates — …").
- If sibling elections exist, mention this variation composes WITH them, not replaces them.`;

  const ct = args.constraints;
  const constraintsBlock = ct
    ? `\n\nOPERATIONAL CONSTRAINTS:\n- Time horizon: ${ct.time_horizon}\n- Budget tier: ${ct.budget_tier}\n- Team size: ${ct.team_size}\n- Risk tolerance: ${ct.risk_tolerance}${ct.compliance_requirements && ct.compliance_requirements.length > 0 ? `\n- Compliance: ${ct.compliance_requirements.join(", ")}` : ""}\n\nLet these shape the doc's depth + ambition (shorter horizon = simpler delivery framing, larger team = more "we" framing, etc.).`
    : "";

  const siblingBlock =
    args.siblingElections && args.siblingElections.length > 0
      ? `\n\nOTHER ELECTED VARIATIONS ON THIS MECHANISM (compose, don't replace):\n${args.siblingElections.map((s) => `- ${s.name}: ${s.description.slice(0, 120)}`).join("\n")}`
      : "";

  const openQ = args.variation.open_questions.length > 0
    ? args.variation.open_questions.join("; ")
    : "(none specified)";

  const ms = args.mechanismSpec;
  const specBlock = ms
    ? `\n\nTECHNICAL SPEC (ground How-it-works / How-it's-built / validation in this — reuse, don't contradict):
- Mechanism of action: ${ms.mechanism_of_action.slice(0, 400)}
- Active ingredients: ${ms.active_ingredients.map((a) => a.name).slice(0, 6).join(" · ") || "—"}
- Runtime flow: ${
        ms.runtime_flow
          .map(
            (r, i) =>
              `${i + 1}) ${r.step}${r.component && r.component !== "—" ? ` [${r.component}]` : ""}`,
          )
          .slice(0, 7)
          .join("  →  ") || "—"
      }
- What to build: ${ms.system_components.map((c) => `${c.name} (${c.category})`).slice(0, 6).join(" · ") || "—"}
- Chosen build method: ${ms.decision_record.chosen || "—"}${ms.decision_record.consequences ? ` (consequences: ${ms.decision_record.consequences.slice(0, 140)})` : ""}
- Validation experiment: ${ms.research_basis.validation_experiment.slice(0, 240) || "—"}`
    : "";

  const user = `Write the description doc for this variation.

OBJECTIVE: ${args.objectiveText.slice(0, 400)}
${args.roomTitle ? `ROOM: ${args.roomTitle}\n` : ""}${args.painText ? `PAIN ADDRESSED: ${args.painText}\n` : ""}
MECHANISM (entity): ${args.entityName}
VARIATION:
- Name: ${args.variation.name}
- Description: ${args.variation.description}
- Tradeoff: ${args.variation.tradeoff}
- Open questions: ${openQ}${specBlock}${constraintsBlock}${siblingBlock}`;

  const raw = await llmJSON<DocLlmShape>({
    system: sys,
    user,
    responseSchema: DOC_SCHEMA,
    temperature: 0.45,
    maxTokens: 2400,
  });

  if (typeof raw.doc !== "string" || raw.doc.trim().length === 0) {
    return "(Empty doc — try regenerating with refine on.)";
  }
  return raw.doc.trim();
}

// ── Refiner (optional one-pass critic+rewrite) ───────────────────

async function refineDraft(draft: string): Promise<string> {
  const sys = `You review a draft product description doc and rewrite it tighter. Check for:
- Filler words: innovative, leverage, robust, solution, platform, enables, seamless, holistic, synergy, paradigm, ecosystem, world-class, cutting-edge, best-in-class
- Passive voice (rewrite active)
- Vague pronouns ("it", "they" without clear antecedents)
- Headings the original didn't use
- Word counts outside section caps (60-110, 40-80, 60-120 for paragraphs; <20 each bullet)
- Hedging language ("could potentially", "may help", "designed to")

Rewrite the doc fixing these. Same SIX-heading shape (What it is / Who it serves / How it works / How it's built / What we'd need to find out / How we'd know it worked) — keep the technical substance of "How it's built" intact, just tighter. Same content intent. Return JSON: { "doc": "<revised markdown>" }.`;

  const raw = await llmJSON<DocLlmShape>({
    system: sys,
    user: draft,
    responseSchema: DOC_SCHEMA,
    temperature: 0.3,
    maxTokens: 2400,
  });

  if (typeof raw.doc !== "string" || raw.doc.trim().length === 0) {
    return draft;
  }
  return raw.doc.trim();
}
