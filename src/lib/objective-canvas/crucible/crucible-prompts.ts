// ── Crucible prompts ─────────────────────────────────────────────────
//
// The Inquirer + Analyst LLM contracts. Both are forced-tool-call schemas
// (OpenAI-strict shape that also drives the Anthropic structured path via
// llmJSON, exactly like unpack's UNPACK_SCHEMA).
//
//   Inquirer  — generates a BATCH of candidate questions, self-scores each on
//               the question-quality rubric, and returns only the best few. Tags
//               each `audience` (user vs research) + Socratic family. Declares
//               `saturated` when the marginal info-gain has dropped off.
//   Analyst   — classifies each fresh answer into landscape / solution /
//               constraint, extracts the variables in play, and emits terse
//               additions to the running problem-model + a 1–2 sentence summary.
//
// Rubrics are grounded in the methodology research (EVPI / expected info-gain,
// Socratic + Bloom coverage, uncertainty sampling, problem/solution-space
// separation). See the design discussion (2026-06-07).

import type {
  AnswerBucket,
  CrucibleAnswer,
  CrucibleQuestion,
  CrucibleVariable,
  SocraticKind,
} from "./crucible-types";

// ── Schemas ──

export const INQUIRER_SCHEMA = {
  name: "inquirer_questions",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["questions", "saturated", "saturation_reason"],
    properties: {
      questions: {
        type: "array",
        description:
          "The 1–3 HIGHEST-VALUE questions to ask THIS round, already filtered from a larger candidate set by the scoring rubric. Never pad — fewer sharp questions beat more weak ones.",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "audience", "intent", "socratic", "score"],
          properties: {
            text: {
              type: "string",
              description:
                "The question, addressed to the founder. One sentence, concrete, answerable.",
            },
            audience: {
              type: "string",
              enum: ["user", "research"],
              description:
                "'user' = a preference / intention / private constraint ONLY the founder can answer. 'research' = a knowable external fact (market size, incumbent behavior, technical limit) the system should answer itself via web search — never make the founder look these up.",
            },
            intent: {
              type: "string",
              description:
                "≤ 12 words: what answering this teaches us about the best feasible route.",
            },
            socratic: {
              type: "string",
              enum: [
                "clarification",
                "assumptions",
                "evidence",
                "viewpoints",
                "implications",
              ],
              description: "Which Socratic family this question belongs to.",
            },
            score: {
              type: "number",
              description:
                "0–5 self-score = weighted rubric (info-gain ×3 + decision-relevance ×3 + non-redundancy ×2 + answerability ×1 + depth ×1) normalized to 0–5. Only emit questions you'd score ≥ 3.",
            },
          },
        },
      },
      saturated: {
        type: "boolean",
        description:
          "True when the marginal information gain of the BEST next question is low — the leading route is stable and further questions would be diminishing returns. When true, the loop converges.",
      },
      saturation_reason: {
        type: "string",
        description: "≤ 20 words: why we are / aren't saturated yet.",
      },
    },
  },
} as const;

export const ANALYST_SCHEMA = {
  name: "analyst_update",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "classifications",
      "landscape_add",
      "solutions_add",
      "constraints_add",
      "variables_add",
      "summary",
    ],
    properties: {
      classifications: {
        type: "array",
        description: "One entry per answer you were given this turn.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["questionId", "bucket", "variable_slugs"],
          properties: {
            questionId: { type: "string" },
            bucket: {
              type: "string",
              enum: ["landscape", "solution", "constraint"],
              description:
                "landscape = a fact that improves our model of the situation; solution = a proposed way to act (quarantine — don't let it reframe the problem); constraint = a hard limit we must respect.",
            },
            variable_slugs: {
              type: "array",
              description:
                "kebab-case slugs of the variables this answer surfaced (must appear in variables_add or already exist).",
              items: { type: "string" },
            },
          },
        },
      },
      landscape_add: {
        type: "array",
        description:
          "NEW landscape facts learned this turn (≤ 14 words each). Empty if none. Do not repeat facts already in the running model.",
        items: { type: "string" },
      },
      solutions_add: {
        type: "array",
        description: "NEW candidate-solution fragments this turn. Empty if none.",
        items: { type: "string" },
      },
      constraints_add: {
        type: "array",
        description:
          "NEW hard constraints surfaced this turn (≤ 14 words each). Empty if none.",
        items: { type: "string" },
      },
      variables_add: {
        type: "array",
        description:
          "NEW variables (quantities / levers the objective's success turns on) surfaced this turn.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "label", "note"],
          properties: {
            slug: { type: "string", description: "kebab-case ≤ 48 chars" },
            label: { type: "string", description: "≤ 6 words" },
            note: { type: "string", description: "≤ 16 words: what it means here" },
          },
        },
      },
      summary: {
        type: "string",
        description:
          "1–2 sentences: what we now understand + which lever(s) are looking highest-leverage. This replaces the prior summary.",
      },
    },
  },
} as const;

// ── Synthesizer (Phase 2: convergence → ranked leverage points) ──

export const SYNTHESIZER_SCHEMA = {
  name: "crucible_synthesis",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["variables", "constraints", "leverage_points"],
    properties: {
      variables: {
        type: "array",
        description:
          "The canonical set of variables the objective's success turns on (quantities / levers). Reconcile + de-duplicate the running set; keep 3–10.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "label", "note"],
          properties: {
            slug: { type: "string", description: "kebab-case ≤ 48 chars" },
            label: { type: "string", description: "≤ 6 words" },
            note: { type: "string", description: "≤ 16 words: what it means here" },
          },
        },
      },
      constraints: {
        type: "array",
        description:
          "The constraints we must respect or deliberately SET to make this the best feasible idea. 2–8.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "label", "kind", "why"],
          properties: {
            slug: { type: "string", description: "kebab-case ≤ 48 chars" },
            label: { type: "string", description: "≤ 8 words" },
            kind: {
              type: "string",
              enum: ["hard", "soft"],
              description: "hard = immovable (physics/law/budget); soft = a chosen guardrail.",
            },
            why: { type: "string", description: "≤ 18 words" },
          },
        },
      },
      leverage_points: {
        type: "array",
        description:
          "The 3–6 HIGHEST-LEVERAGE places to intervene to make the objective win — the primary output. Each scored on the rubric. A leverage point is a RELATIONSHIP/lever, not a feature.",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "slug",
            "label",
            "rationale",
            "meadows_level",
            "targets",
            "bounded_by",
            "scores",
          ],
          properties: {
            slug: { type: "string", description: "kebab-case ≤ 48 chars" },
            label: { type: "string", description: "≤ 8 words" },
            rationale: {
              type: "string",
              description: "1–2 sentences: why acting HERE moves the objective most.",
            },
            meadows_level: {
              type: "string",
              description:
                "Where it sits on Meadows' ladder — one of: Parameters, Buffers, Stock-flow structure, Delays, Balancing loops, Reinforcing loops, Information flows, Rules, Self-organization, Goals, Paradigm.",
            },
            targets: {
              type: "array",
              description: "Variable slugs (from `variables` above) this lever moves.",
              items: { type: "string" },
            },
            bounded_by: {
              type: "array",
              description: "Constraint slugs (from `constraints` above) that bound this lever.",
              items: { type: "string" },
            },
            scores: {
              type: "object",
              additionalProperties: false,
              required: [
                "meadows",
                "bindingness",
                "fan_out",
                "pareto",
                "feasibility",
                "contradiction",
              ],
              properties: {
                meadows: {
                  type: "number",
                  description:
                    "0–5 Meadows depth: parameters≈1 → feedback loops≈3 → rules≈4 → goals/paradigm≈5.",
                },
                bindingness: {
                  type: "number",
                  description: "0–5 is this the binding constraint (Theory of Constraints)?",
                },
                fan_out: {
                  type: "number",
                  description: "0–5 how many downstream variables/outcomes moving this controls.",
                },
                pareto: {
                  type: "number",
                  description: "0–5 share of the target outcome this drives (critical-few).",
                },
                feasibility: {
                  type: "number",
                  description: "0–5 can THIS team actually move it given the constraints?",
                },
                contradiction: {
                  type: "number",
                  description: "0–5 does it dissolve a trade-off (TRIZ) rather than just trade off?",
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export interface SynthesizerRaw {
  variables: Array<{ slug: string; label: string; note: string }>;
  constraints: Array<{ slug: string; label: string; kind: "hard" | "soft"; why: string }>;
  leverage_points: Array<{
    slug: string;
    label: string;
    rationale: string;
    meadows_level: string;
    targets: string[];
    bounded_by: string[];
    scores: {
      meadows: number;
      bindingness: number;
      fan_out: number;
      pareto: number;
      feasibility: number;
      contradiction: number;
    };
  }>;
}

export function synthesizerSystem(): string {
  return [
    "You are the SYNTHESIZER closing a strategy crucible. The Inquirer + Analyst have interrogated the objective; you now distill the highest-LEVERAGE places to intervene — the primary output.",
    "A leverage point is a RELATIONSHIP / lever in the system, NOT a feature. Rank candidates by this rubric (score each dimension 0–5):",
    "  • Meadows depth ×3 — where on the ladder? parameters (weak) → buffers → stock-flow → delays → balancing loops → reinforcing loops → information flows → rules → self-organization → goals → paradigm (strong). Deeper = more leverage.",
    "  • Constraint-bindingness ×3 — is this the actual binding constraint (Theory of Constraints)? Throughput is set there.",
    "  • Downstream fan-out ×2 — how many other variables/outcomes does moving this control?",
    "  • Pareto outcome-share ×2 — the critical-few share of the target outcome it drives.",
    "  • Feasibility-to-move ×2 — can THIS team actually shift it given the constraints? (Deep but immovable = discount.)",
    "  • Contradiction-resolution ×1 — does it dissolve a trade-off (TRIZ) rather than just trade off?",
    "Tie each leverage point to the variable(s) it moves and the constraint(s) that bound it (by slug). First reconcile the canonical variables + constraints, then score the levers against them.",
    "Be ruthless and concrete — 3–6 real levers, not a laundry list. Ground every judgment in the answers gathered (including the researched facts). Return the crucible_synthesis tool only.",
  ].join("\n");
}

export function synthesizerUser(args: {
  objective: string;
  preamble: string;
  factors: FactorLite[];
  questions: CrucibleQuestion[];
  answers: CrucibleAnswer[];
  landscape: string[];
  solutions: string[];
  constraints: string[];
  variables: CrucibleVariable[];
}): string {
  const parts: string[] = [];
  if (args.preamble) parts.push(args.preamble.trim());
  parts.push(`OBJECTIVE\n${args.objective || "(none on file)"}`);
  parts.push(renderFactors(args.factors));
  parts.push(
    renderModel({
      landscape: args.landscape,
      solutions: args.solutions,
      constraints: args.constraints,
      variables: args.variables,
    }),
  );
  parts.push(renderTranscript(args.questions, args.answers));
  parts.push(
    "Synthesize the canonical variables + constraints, then the 3–6 highest-leverage points (scored). Levers must target real variables and respect the constraints.",
  );
  return parts.join("\n\n");
}

// ── First-principles lens (Phase 3) ──
//
// The second agent PERSONA: instead of "where do we act" (leverage), it asks
// "what irreducible truth does everything rest on". Each candidate principle is
// scored on the first-principle eval rubric — the metric for telling a genuine
// first principle from a restated symptom.

export const FIRST_PRINCIPLES_SCHEMA = {
  name: "crucible_first_principles",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["first_principles"],
    properties: {
      first_principles: {
        type: "array",
        description:
          "2–5 IRREDUCIBLE truths the objective's success rests on. Not restated symptoms, not conventions, not the leverage points reworded — the bedrock beneath them.",
        minItems: 1,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "label", "statement", "grounds_leverage", "grounds_variables", "scores"],
          properties: {
            slug: { type: "string", description: "kebab-case ≤ 48 chars" },
            label: { type: "string", description: "≤ 8 words" },
            statement: {
              type: "string",
              description: "1–2 sentences stating the irreducible truth plainly.",
            },
            grounds_leverage: {
              type: "array",
              description: "Leverage-point slugs that REST ON this principle.",
              items: { type: "string" },
            },
            grounds_variables: {
              type: "array",
              description: "Variable slugs this principle explains.",
              items: { type: "string" },
            },
            scores: {
              type: "object",
              additionalProperties: false,
              required: [
                "irreducibility",
                "counterfactual",
                "necessity",
                "sufficiency",
                "five_whys",
                "independence",
              ],
              properties: {
                irreducibility: {
                  type: "number",
                  description: "0–5 can it be decomposed further / derived from something deeper? bedrock (physics/economics/math) = 5; restated symptom = 0.",
                },
                counterfactual: {
                  type: "number",
                  description: "0–5 if it were false, how much of the reasoning collapses? everything = 5.",
                },
                necessity: { type: "number", description: "0–5 strictly required for the conclusion?" },
                sufficiency: { type: "number", description: "0–5 how much it explains on its own." },
                five_whys: {
                  type: "number",
                  description: "0–5 survives repeated 'why?' without bottoming into another cause.",
                },
                independence: {
                  type: "number",
                  description: "0–5 a truth, NOT 'how it's usually done' (convention/analogy = 0).",
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export interface FirstPrinciplesRaw {
  first_principles: Array<{
    slug: string;
    label: string;
    statement: string;
    grounds_leverage: string[];
    grounds_variables: string[];
    scores: {
      irreducibility: number;
      counterfactual: number;
      necessity: number;
      sufficiency: number;
      five_whys: number;
      independence: number;
    };
  }>;
}

export function firstPrinciplesSystem(): string {
  return [
    "You are the FIRST-PRINCIPLES lens of a strategy crucible. The leverage analysis found WHERE to act; you find the irreducible TRUTHS those levers rest on — the bedrock that, if solved, makes everything downstream follow.",
    "A genuine first principle is NOT a restated symptom, a convention ('that's how it's done'), or an analogy to an existing product. Reduce to physics / economics / human-behavior level truths. Score each candidate 0–5 on:",
    "  • Irreducibility ×3 — can it be decomposed further or derived from something deeper? bedrock = 5; restated symptom = 0.",
    "  • Counterfactual collapse ×3 — if it were false, how much of the reasoning collapses? everything = 5.",
    "  • Necessity ×2 — is it strictly required for the conclusion?",
    "  • Sufficiency ×2 — how much does it explain on its own?",
    "  • 5-Whys survival ×2 — does it survive repeated 'why?' without bottoming into another cause?",
    "  • Independence-from-convention ×1 — is it a truth, not 'how it's usually done'?",
    "Tie each principle to the leverage points that rest on it and the variables it explains (by slug). Be ruthless — 2–5 real principles. The highest-scoring is the deepest leverage of all. Return the crucible_first_principles tool only.",
  ].join("\n");
}

export function firstPrinciplesUser(args: {
  objective: string;
  preamble: string;
  variables: CrucibleVariable[];
  constraintLines: string[];
  leverageLines: string[];
  questions: CrucibleQuestion[];
  answers: CrucibleAnswer[];
}): string {
  const parts: string[] = [];
  if (args.preamble) parts.push(args.preamble.trim());
  parts.push(`OBJECTIVE\n${args.objective || "(none on file)"}`);
  const vars = args.variables.length
    ? "VARIABLES (slug — label)\n" +
      args.variables.map((v) => `- ${v.slug} — ${v.label}`).join("\n")
    : "VARIABLES\n(none)";
  parts.push(vars);
  parts.push(
    args.leverageLines.length
      ? `LEVERAGE POINTS (slug — label)\n${args.leverageLines.join("\n")}`
      : "LEVERAGE POINTS\n(none)",
  );
  if (args.constraintLines.length) {
    parts.push(`CONSTRAINTS\n${args.constraintLines.map((c) => `- ${c}`).join("\n")}`);
  }
  parts.push(renderTranscript(args.questions, args.answers));
  parts.push(
    "Identify the 2–5 irreducible truths beneath these levers. Ground each in the answers gathered; score honestly; the deepest principle should explain why the top lever is the top lever.",
  );
  return parts.join("\n\n");
}

// ── Roadmap (Phase 4: convergence → sub-objectives + seed features) ──
//
// Given the converged picture (objective + leverage points + first principles
// + variables + constraints), coin the sub-objectives (branches that pursue
// clusters of leverage points) and seed the features the user expands next.

export const ROADMAP_SCHEMA = {
  name: "crucible_roadmap",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sub_objectives", "features"],
    properties: {
      sub_objectives: {
        type: "array",
        description:
          "2–4 sub-objectives — distinct branches of the main objective, each pursued through a cluster of leverage points. Not a restatement of the objective; each is a separable sub-goal.",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "title", "rationale", "leverage_slugs"],
          properties: {
            slug: { type: "string", description: "kebab-case ≤ 48 chars" },
            title: { type: "string", description: "≤ 9 words" },
            rationale: { type: "string", description: "1 sentence: what it achieves + why it's distinct." },
            leverage_slugs: {
              type: "array",
              description: "Leverage-point slugs this sub-objective pursues (≥1).",
              items: { type: "string" },
            },
          },
        },
      },
      features: {
        type: "array",
        description:
          "3–8 SEED features — concrete things to build, each operationalizing ONE leverage point. The founder expands these further; keep them sharp, non-generic, and tied to a lever.",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "title", "description", "leverage_slug", "confidence"],
          properties: {
            slug: { type: "string", description: "kebab-case ≤ 48 chars" },
            title: { type: "string", description: "≤ 8 words" },
            description: { type: "string", description: "1–2 sentences: what it is + how it moves the lever." },
            leverage_slug: { type: "string", description: "The leverage-point slug this feature operationalizes." },
            confidence: { type: "number", description: "0–1 honest estimate this is a real, high-value feature." },
          },
        },
      },
    },
  },
} as const;

export interface RoadmapRaw {
  sub_objectives: Array<{
    slug: string;
    title: string;
    rationale: string;
    leverage_slugs: string[];
  }>;
  features: Array<{
    slug: string;
    title: string;
    description: string;
    leverage_slug: string;
    confidence: number;
  }>;
}

export function roadmapSystem(): string {
  return [
    "You close a strategy crucible by turning the leverage analysis into an actionable roadmap. The interrogation found the highest-leverage points + the first principles beneath them; you now coin the sub-objectives + seed the features.",
    "SUB-OBJECTIVES: 2–4 distinct branches of the main objective, each pursued through a cluster of leverage points. Each must be a separable sub-goal — not the objective reworded, not overlapping with its siblings. Tie each to the leverage-point slugs it pursues.",
    "SEED FEATURES: 3–8 concrete things to build, each operationalizing ONE leverage point (cite its slug). Sharp and specific — the founder will expand each further, so give a real starting point, not a generic 'dashboard'. Score confidence honestly (drop anything < 0.5).",
    "Everything must trace to a real leverage-point slug from the provided list. Return the crucible_roadmap tool only.",
  ].join("\n");
}

export function roadmapUser(args: {
  objective: string;
  preamble: string;
  leverageLines: string[];
  principleLines: string[];
  constraintLines: string[];
}): string {
  const parts: string[] = [];
  if (args.preamble) parts.push(args.preamble.trim());
  parts.push(`OBJECTIVE\n${args.objective || "(none on file)"}`);
  parts.push(
    args.leverageLines.length
      ? `LEVERAGE POINTS (slug — label · score)\n${args.leverageLines.join("\n")}`
      : "LEVERAGE POINTS\n(none)",
  );
  if (args.principleLines.length) {
    parts.push(`FIRST PRINCIPLES\n${args.principleLines.map((p) => `- ${p}`).join("\n")}`);
  }
  if (args.constraintLines.length) {
    parts.push(`CONSTRAINTS\n${args.constraintLines.map((c) => `- ${c}`).join("\n")}`);
  }
  parts.push(
    "Coin 2–4 sub-objectives (each pursuing a cluster of the leverage points above) and 3–8 seed features (each operationalizing one leverage point). Trace everything to real leverage-point slugs.",
  );
  return parts.join("\n\n");
}

// ── Raw result shapes (post-validation) ──

export interface InquirerRaw {
  questions: Array<{
    text: string;
    audience: "user" | "research";
    intent: string;
    socratic: SocraticKind;
    score: number;
  }>;
  saturated: boolean;
  saturation_reason: string;
}

export interface AnalystRaw {
  classifications: Array<{
    questionId: string;
    bucket: AnswerBucket;
    variable_slugs: string[];
  }>;
  landscape_add: string[];
  solutions_add: string[];
  constraints_add: string[];
  variables_add: Array<{ slug: string; label: string; note: string }>;
  summary: string;
}

// ── System prompts ──

export function inquirerSystem(): string {
  return [
    "You are the INQUIRER in a strategy crucible. The founder just stated an objective. Your job is to ask the questions that most sharpen the path to the BEST idea that is actually FEASIBLE under real-world conditions — surfacing the highest-leverage points to act on.",
    "Each round you internally brainstorm many candidate questions, SCORE each on this rubric, and return ONLY the top 1–3:",
    "  • Expected info-gain ×3 — imagine the 2–4 likely answers; how much would they shift our model of the best route? Best question ≈ the one whose answer most evenly splits the live hypotheses.",
    "  • Decision-relevance ×3 — does the answer change a downstream decision (a lever, a constraint, a route)? Penalize nice-to-know.",
    "  • Non-redundancy ×2 — is it independent of what we already know? Never re-ask a resolved fact.",
    "  • Answerability ×1 — can it be answered concretely now?",
    "  • Depth ×1 — early rounds establish facts; later rounds force trade-off / evaluation.",
    "Cover different Socratic families across rounds (clarification, assumptions, evidence, viewpoints, implications) — don't ask five clarifications in a row.",
    "AUDIENCE DISCRIMINATION (critical): tag a question 'research' when its answer is a knowable external FACT (market size, what incumbents do, switching costs, a technical/legal limit) — the system answers those itself; NEVER make the founder look up facts. Tag it 'user' only when it's a preference, intention, private resource, or risk appetite that only they can answer.",
    "Set saturated=true when the best remaining question's info-gain is low and the leading route is stable — stop rather than pad.",
    "Return the inquirer_questions tool only.",
  ].join("\n");
}

export function analystSystem(): string {
  return [
    "You are the ANALYST in a strategy crucible. You read the founder's (and the researcher's) answers and update the shared problem-model.",
    "Classify EACH answer into exactly one bucket: landscape (a fact about the situation — market, users, incumbents, resources), solution (a proposed way to act), or constraint (a hard limit). Discipline: keep solutions QUARANTINED — a proposed solution must not silently reframe the problem (converge on the problem before the solution).",
    "Extract the VARIABLES in play — the quantities or levers the objective's success turns on (e.g. 'activation rate', 'atomic-network size', 'time-to-first-value'). These become the things we optimize. Give each a stable kebab-case slug, a ≤6-word label, and a ≤16-word note.",
    "Only ADD what's genuinely new this turn — never restate facts already in the running model. Keep every line terse.",
    "Update the running summary (1–2 sentences): what we now understand and which lever(s) look highest-leverage. Be concrete, never generic.",
    "Return the analyst_update tool only.",
  ].join("\n");
}

// ── User-prompt builders ──

export interface FactorLite {
  slug: string;
  label: string;
  kind: string;
  why?: string;
}

function renderFactors(factors: FactorLite[]): string {
  if (!factors.length) return "OPTIMIZATION FACTORS\n(none on file yet)";
  return (
    "OPTIMIZATION FACTORS (the intake-defined dimensions of success)\n" +
    factors
      .map((f) => `- ${f.slug} [${f.kind}]: ${f.label}${f.why ? ` — ${f.why}` : ""}`)
      .join("\n")
  );
}

function renderTranscript(
  questions: CrucibleQuestion[],
  answers: CrucibleAnswer[],
): string {
  if (!questions.length) return "PRIOR Q&A\n(none yet — this is round 1)";
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const lines = questions.map((q) => {
    const a = byId.get(q.id);
    const ans = a
      ? `\n   A (${a.via}): ${a.text}`
      : q.answered
        ? ""
        : "\n   A: (unanswered)";
    return `Q[${q.id}] (${q.audience}): ${q.text}${ans}`;
  });
  return `PRIOR Q&A\n${lines.join("\n")}`;
}

function renderModel(model: {
  landscape: string[];
  solutions: string[];
  constraints: string[];
  variables: CrucibleVariable[];
}): string {
  const sec = (label: string, items: string[]) =>
    items.length ? `${label}:\n${items.map((i) => `  - ${i}`).join("\n")}` : "";
  const vars = model.variables.length
    ? "VARIABLES IN PLAY:\n" +
      model.variables.map((v) => `  - ${v.label} (${v.slug})`).join("\n")
    : "";
  const parts = [
    sec("LANDSCAPE (known facts)", model.landscape),
    sec("CANDIDATE SOLUTIONS (quarantined)", model.solutions),
    sec("CONSTRAINTS", model.constraints),
    vars,
  ].filter(Boolean);
  return parts.length
    ? `RUNNING PROBLEM-MODEL\n${parts.join("\n")}`
    : "RUNNING PROBLEM-MODEL\n(empty — nothing analyzed yet)";
}

export function inquirerUser(args: {
  objective: string;
  preamble: string;
  factors: FactorLite[];
  /** Sharpening seed questions (round 1 only) — the ranked ambiguities the
   *  prompt_sharpening pass already surfaced. Reuses that work instead of
   *  regenerating it. */
  seedQuestions: string[];
  questions: CrucibleQuestion[];
  answers: CrucibleAnswer[];
  landscape: string[];
  solutions: string[];
  constraints: string[];
  variables: CrucibleVariable[];
  round: number;
  maxRounds: number;
}): string {
  const parts: string[] = [];
  if (args.preamble) parts.push(args.preamble.trim());
  parts.push(`OBJECTIVE\n${args.objective || "(none on file)"}`);
  parts.push(renderFactors(args.factors));
  if (args.round <= 1 && args.seedQuestions.length) {
    parts.push(
      "SEED AMBIGUITIES (already surfaced by the sharpening pass — use as raw material, sharpen or replace them; don't just echo):\n" +
        args.seedQuestions.map((q) => `- ${q}`).join("\n"),
    );
  }
  parts.push(renderTranscript(args.questions, args.answers));
  parts.push(
    renderModel({
      landscape: args.landscape,
      solutions: args.solutions,
      constraints: args.constraints,
      variables: args.variables,
    }),
  );
  parts.push(
    `This is round ${args.round} of at most ${args.maxRounds}. Ask the 1–3 highest-value questions now (score each ≥ 3). If the best question's info-gain is low, set saturated=true instead of padding.`,
  );
  return parts.join("\n\n");
}

export function analystUser(args: {
  objective: string;
  /** The questions just answered + their answers (the turn's new material). */
  freshPairs: Array<{ q: CrucibleQuestion; a: CrucibleAnswer }>;
  landscape: string[];
  solutions: string[];
  constraints: string[];
  variables: CrucibleVariable[];
}): string {
  const pairs = args.freshPairs
    .map(
      ({ q, a }) =>
        `Q[${q.id}] (${q.audience}): ${q.text}\n   A (${a.via}): ${a.text}`,
    )
    .join("\n\n");
  return [
    `OBJECTIVE\n${args.objective || "(none on file)"}`,
    renderModel({
      landscape: args.landscape,
      solutions: args.solutions,
      constraints: args.constraints,
      variables: args.variables,
    }),
    `NEW ANSWERS TO ANALYZE (classify each, extract variables, add only what's new):\n${pairs}`,
  ].join("\n\n");
}

// ── Exploration: diverge (variations) → converge (principle + decisions) ──
//
// The brainstorm engine. divergeAnswers generates K genuinely-different
// candidate resolutions to ONE ambiguity; convergeVariations distills them into
// the INTERSECTION (the invariant = a first-principle candidate) + the
// DIFFERENCES (the decision axes). Same forced-tool-call pattern as the rest.

export const DIVERGE_SCHEMA = {
  name: "diverge_variations",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["variations"],
    properties: {
      variations: {
        type: "array",
        description:
          "3–4 GENUINELY DIFFERENT ways to resolve the ambiguity — not rewordings. Each takes a real, defensible stance. Spread them across the space (don't cluster).",
        minItems: 3,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "value", "rationale", "implication"],
          properties: {
            label: { type: "string", description: "≤ 6 words naming this stance." },
            value: {
              type: "string",
              description: "One line: the concrete resolution this variation proposes.",
            },
            rationale: {
              type: "string",
              description: "1 sentence: why this reading is plausible for THIS objective.",
            },
            implication: {
              type: "string",
              description:
                "≤ 1 sentence: what choosing this implies (a downstream consequence / what it demands).",
            },
          },
        },
      },
    },
  },
} as const;

export const CONVERGE_SCHEMA = {
  name: "converge_principle",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["principle", "decisions", "recommended_index", "recommended_why"],
    properties: {
      principle: {
        type: "string",
        description:
          "The INTERSECTION — what must be true regardless of which variation is chosen. State it as one irreducible truth (a first-principle candidate). 1–2 sentences.",
      },
      decisions: {
        type: "array",
        description:
          "The DIFFERENCES — the axes the variations actually disagree on, i.e. the real choices left to make. Empty only if the variations are identical (they shouldn't be).",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["axis", "options"],
          properties: {
            axis: { type: "string", description: "≤ 6 words naming the choice." },
            options: {
              type: "array",
              description: "The competing options along this axis.",
              items: { type: "string" },
            },
          },
        },
      },
      recommended_index: {
        type: "number",
        description:
          "0-based index of the variation you'd recommend as the strongest default for THIS objective.",
      },
      recommended_why: {
        type: "string",
        description: "≤ 1 sentence: why that one is the strongest default.",
      },
    },
  },
} as const;

export interface DivergeRaw {
  variations: Array<{
    label: string;
    value: string;
    rationale: string;
    implication: string;
  }>;
}

export interface ConvergeRaw {
  principle: string;
  decisions: Array<{ axis: string; options: string[] }>;
  recommended_index: number;
  recommended_why: string;
}

export function divergeSystem(): string {
  return [
    "You are the EXPLORER in a strategy crucible. Given ONE ambiguity about the user's objective, generate 3–4 GENUINELY DIFFERENT ways to resolve it — distinct stances that a thoughtful founder might actually take, spread across the possibility space (not rewordings of one idea).",
    "Each variation takes a clear position, says concretely what it would mean, why it's plausible, and what it implies downstream. Avoid strawmen — every variation should be defensible.",
    "The point is to widen the space so we can later find what's TRUE across all of them (the principle) and where the real CHOICES are (the differences). Return the diverge_variations tool only.",
  ].join("\n");
}

export function convergeSystem(): string {
  return [
    "You are the SYNTHESIZER in a strategy crucible. You are given several genuinely-different resolutions of one ambiguity. Do two things:",
    "1) INTERSECTION → state the invariant that holds no matter which resolution is chosen. This is a first-principle candidate — the bedrock the decision rests on. Make it sharp and irreducible, not a vague summary.",
    "2) DIFFERENCES → name the axes the resolutions actually disagree on; these are the real decisions left to make. List the competing options per axis.",
    "Then recommend the strongest default variation for this objective. Return the converge_principle tool only.",
  ].join("\n");
}

export function divergeUser(args: {
  objective: string;
  preamble: string;
  headline: string;
  question: string;
  factors: FactorLite[];
}): string {
  const parts: string[] = [];
  if (args.preamble) parts.push(args.preamble.trim());
  parts.push(`OBJECTIVE\n${args.objective || "(none on file)"}`);
  parts.push(renderFactors(args.factors));
  parts.push(
    `AMBIGUITY TO EXPLORE\n${args.headline}${args.question ? `\nQuestion: ${args.question}` : ""}`,
  );
  parts.push(
    "Generate 3–4 genuinely different resolutions, spread across the space. Return the diverge_variations tool.",
  );
  return parts.join("\n\n");
}

export function convergeUser(args: {
  objective: string;
  headline: string;
  variations: Array<{ label: string; value: string; rationale: string }>;
}): string {
  const vlines = args.variations
    .map(
      (v, i) => `${i}. ${v.label} — ${v.value}${v.rationale ? ` (${v.rationale})` : ""}`,
    )
    .join("\n");
  return [
    `OBJECTIVE\n${args.objective || "(none on file)"}`,
    `AMBIGUITY\n${args.headline}`,
    `THE VARIATIONS (resolutions to converge over):\n${vlines}`,
    "Extract the intersection (principle) + the differences (decisions), then recommend the strongest default. Return the converge_principle tool.",
  ].join("\n\n");
}
