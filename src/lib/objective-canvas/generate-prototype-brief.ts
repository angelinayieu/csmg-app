// ── Prototype Brief Generator ──────────────────────────────────────
//
// The L3 surface — where theory hits reality. A prototype brief is
// the answer to:
//
//   "Given my CONSTRAINTS, what's the smallest experiment that would
//    let me know if this VARIATION actually resolves this OPEN
//    QUESTION?"
//
// Three inputs, one output. Without all three, the brief drifts into
// generic "build an MVP" advice:
//   • Without constraint: prescribes 4-week prototypes the user can't
//     afford.
//   • Without variation: vague "test the concept" with no design.
//   • Without open question: solution-in-search-of-problem.
//
// Output is domain-adaptive: the same call produces a paper mockup
// brief for an app, a 7-day tracker for journaling, a reading plan
// for book analysis, a 1-week field experiment for passion-chasing.

import { llmJSON } from "@/lib/llm";
import type { ItemVariation } from "./expand-item-detail";
import {
  buildConstraintsBlock,
  type OperationalConstraints,
} from "./constraints";

/** Domain signatures the LLM picks based on the objective context.
 *  Drives the artifact_type the brief emits — same call, different
 *  output template per domain.
 *
 *  "app_product"   — app / SaaS / tool building
 *  "journaling"    — personal reflection / mental practice
 *  "book_analysis" — learning / reading / study
 *  "passion_arc"   — career / direction / exploration
 *  "research"      — academic / investigative
 *  "operations"    — process improvement / workflow
 *  "generic"       — fallback when domain unclear */
export type DomainKind =
  | "app_product"
  | "journaling"
  | "book_analysis"
  | "passion_arc"
  | "research"
  | "operations"
  | "generic";

export interface PrototypeBrief {
  /** Stable id, deterministic from variation_id + open_question hash. */
  id: string;
  /** Source variation id this brief belongs to. */
  variation_id: string;
  /** The open question the experiment answers. */
  open_question: string;
  /** Domain signature the LLM picked. */
  domain: DomainKind;

  /** "If X, then Y, because Z." — one sentence. */
  hypothesis: string;
  /** The observable that disambiguates: what number / signal / sense
   *  tells us the hypothesis held. */
  signal_to_watch: string;
  /** When to stop. Explicit failure threshold. */
  kill_criteria: string;
  /** Effort + time + cost estimate, domain-adapted. */
  build_estimate: string;
  /** Domain-adaptive: actual prototype CONTENT, not just talk.
   *  For app: a 5-screen flow description.
   *  For journaling: a 7-day prompt template.
   *  For book analysis: a structured reading plan.
   *  Markdown-ish formatted plaintext, 200-500 words. */
  artifact_type: string;
  artifact_body: string;

  /** What the user will LEARN — the binary outcome that updates
   *  their model. The whole point of the experiment. */
  learning_target: string;

  generated_at: string;
}

export interface PrototypeBriefContext {
  /** The variation being tested. */
  variation: ItemVariation;
  /** The single open question this brief addresses. One brief per
   *  question — composing them into a single brief loses the
   *  binary-outcome property. */
  open_question: string;
  /** Item context — for prompt grounding. */
  itemName: string;
  itemLayer: "pain" | "features" | "outcomes" | "objective";
  /** The user's situation. Without it the brief is fantasy. */
  constraints: OperationalConstraints | null;
  /** Domain grounding. */
  subObjectiveTitle: string;
  coreObjectiveText: string;
  /** Polish-2 — composition state on the parent item. When the
   *  variation is part of a composed design with open conflicts, the
   *  brief surfaces those so the experiment can be framed to ALSO
   *  inform the conflict resolution. Optional — null when no
   *  composition exists (variation is being tested in isolation). */
  composedDesign?: {
    description: string;
    conflicts_open: string[];
    conflicts_resolved: string[];
  } | null;
  /** Polish-2 — sibling prototype briefs on the same item. When the
   *  user has other briefs in flight, the LLM knows the experiment
   *  load + can scope this one to NOT duplicate signals already
   *  being captured elsewhere. */
  siblingBriefs?: Array<{
    variation_id: string;
    open_question: string;
    signal_to_watch: string;
  }>;
}

const DOMAIN_TEMPLATES: Record<DomainKind, string> = {
  app_product: `For app/product domain, the artifact_body should be a CONCRETE PROTOTYPE SPEC:
  - 3-6 numbered screens or interaction states (no fluff: "Screen 1: …")
  - For each: what's on it, what the user does, what happens next
  - Data model touched (1-2 lines max)
  - Build estimate in solo-dev-days
  Mockups not required — text-spec is enough for a developer to act.`,

  journaling: `For journaling/reflection domain, the artifact_body should be a 7-DAY PRACTICE TEMPLATE:
  - One prompt per day, prompts evolve across the week (not 7 copies of "how do you feel?")
  - A tracking line: what to record after each session (single sentence template)
  - A checkpoint at day 3 + day 7: "if X, continue / if Y, switch"
  No special tools — pen + paper or a notes app.`,

  book_analysis: `For book/learning domain, the artifact_body should be a STRUCTURED READING PLAN:
  - Reading sequence (chapters/sections + order)
  - 2-3 questions per session that test the variation's reading approach
  - A post-reading capture template
  - Concrete success signal: "can I explain X in plain language without the book"`,

  passion_arc: `For passion/career domain, the artifact_body should be a 1-WEEK FIELD EXPERIMENT:
  - 3-5 concrete actions (talk to N people, write for X minutes, attend Y event)
  - What to OBSERVE during each action — internal signal + external response
  - A short reflection prompt for end-of-week
  - Decision rule: "if I felt X, continue / if Y, pivot"`,

  research: `For research/investigative domain, the artifact_body should be a MICRO-STUDY DESIGN:
  - Method (1 paragraph)
  - Sample / data source (specific)
  - Analysis plan (concrete)
  - Pre-registered hypothesis + falsifier`,

  operations: `For operations/workflow domain, the artifact_body should be a PILOT ROLLOUT:
  - Scope (which team / process / segment)
  - Before/after metric
  - Duration
  - Rollback plan`,

  generic: `Generic artifact_body: a numbered list of 4-7 concrete steps the user does THIS WEEK. Every step must be observable + bounded.`,
};

export async function generatePrototypeBrief(
  ctx: PrototypeBriefContext,
): Promise<PrototypeBrief> {
  const constraintsBlock = buildConstraintsBlock(ctx.constraints);
  const variationContext = `VARIATION BEING TESTED:
  Name: ${ctx.variation.name}
  Description: ${ctx.variation.description}
  Tradeoff: ${ctx.variation.tradeoff}
  Kind: ${ctx.variation.kind ?? "alternative"}
  How directly it addresses the pain: ${((ctx.variation.addresses_pain ?? 0.5) * 100).toFixed(0)}/100`;

  const system = `You design the ONE smallest experiment that would let the user answer their open question about a variation they're considering, within their actual operational constraints.

This is NOT a "build an MVP" suggestion. It is a specific, time-bounded test with a binary outcome.

THE TRIPLE: constraint × variation × open_question = ONE brief.
  - Constraint forces the experiment into the user's actual life (not "build a full app with analytics").
  - Variation gives the experiment a specific design to test (not "try gamification").
  - Open question gives the experiment its TARGET — the binary outcome that updates the user's beliefs (not "see what happens").

OUTPUT:

1) DOMAIN — one of: "app_product" | "journaling" | "book_analysis" | "passion_arc" | "research" | "operations" | "generic". Pick from the parent objective context. Drives the artifact_body shape.

2) HYPOTHESIS — single sentence. "If [variation property], then [observable result], because [mechanism]." Reference the open question DIRECTLY.

3) SIGNAL_TO_WATCH — the specific number / behavior / sense the user observes during/after the experiment that answers the open question. Single sentence. Be concrete: "reply rate ≥ X%", "self-reported energy at noon", "ability to explain concept without notes" — NOT "engagement" or "user satisfaction."

4) KILL_CRITERIA — explicit threshold for "this didn't work, stop here and pivot." Single sentence. Numeric or behavioral, not vague.

5) BUILD_ESTIMATE — domain-adapted cost line. Honest about effort. Must fit within the user's time horizon + budget tier.

6) ARTIFACT_TYPE — short label (4-8 words) naming what the user is actually producing: "5-screen paper prototype", "7-day journaling template", "structured reading plan", "5-call discovery week", etc.

7) ARTIFACT_BODY — the actual prototype content, domain-adapted (template instructions below). 200-500 words. NOT a description of WHAT to build — it IS what to build, ready to act on.

8) LEARNING_TARGET — single sentence. What the user will know after running this that they don't know now. The binary update.

DOMAIN TEMPLATES (use the one matching your chosen domain):

${Object.entries(DOMAIN_TEMPLATES)
  .map(([k, v]) => `${k}:\n${v}`)
  .join("\n\n")}

ANTI-PLATITUDE:
- "Build an MVP" — banned, too vague.
- "Survey users" — banned unless the survey questions are spelled out.
- "Test with users" — banned unless N + recruit channel + question are specified.
- Every artifact_body line must be ACTIONABLE THIS WEEK.

The user must be able to execute this brief without further LLM help. If they need to come back and ask "ok how exactly?", you've failed.

Return strict JSON.`;

  // Polish-2: composition state on the parent item. When the
  // variation is part of a composed design with open conflicts, the
  // brief should be FRAMED to also inform conflict resolution where
  // possible. We pass the composition description + open conflicts;
  // resolved ones aren't needed (the LLM doesn't need to re-solve
  // them).
  const compositionBlock = ctx.composedDesign
    ? `\n\nPARENT COMPOSITION (this variation is part of a composed design across multiple elected variations):\n  Description: ${ctx.composedDesign.description.slice(0, 280)}${
        ctx.composedDesign.conflicts_open.length > 0
          ? `\n  Open conflicts the design can't resolve:\n${ctx.composedDesign.conflicts_open
              .slice(0, 3)
              .map((c) => `    • ${c.slice(0, 180)}`)
              .join("\n")}\n  WHEN POSSIBLE, frame signal_to_watch to ALSO inform one of these open conflicts — the user gets two updates for one experiment.`
          : ""
      }`
    : "";

  // Polish-2: sibling briefs. Don't duplicate signal already being
  // captured by another experiment on this item.
  const siblingBlock =
    ctx.siblingBriefs && ctx.siblingBriefs.length > 0
      ? `\n\nSIBLING BRIEFS ALREADY IN FLIGHT ON THIS ITEM (avoid duplicating their signal_to_watch):\n${ctx.siblingBriefs
          .slice(0, 3)
          .map(
            (s) =>
              `  • Q: "${s.open_question.slice(0, 80)}" → watching: ${s.signal_to_watch.slice(0, 80)}`,
          )
          .join("\n")}`
      : "";

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText.slice(0, 1000)}\n"""\n\nSUB-OBJECTIVE: ${ctx.subObjectiveTitle}\nITEM: ${ctx.itemName} (layer: ${ctx.itemLayer})${constraintsBlock}\n\n${variationContext}${compositionBlock}${siblingBlock}\n\nOPEN QUESTION (the binary target):\n"""\n${ctx.open_question}\n"""\n\nDesign the prototype brief per the system instructions.`;

  const raw = await llmJSON<{
    domain?: unknown;
    hypothesis?: unknown;
    signal_to_watch?: unknown;
    kill_criteria?: unknown;
    build_estimate?: unknown;
    artifact_type?: unknown;
    artifact_body?: unknown;
    learning_target?: unknown;
  }>({
    system,
    user,
    responseSchema: {
      name: "prototype_brief",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          domain: {
            type: "string",
            enum: [
              "app_product",
              "journaling",
              "book_analysis",
              "passion_arc",
              "research",
              "operations",
              "generic",
            ],
          },
          hypothesis: { type: "string" },
          signal_to_watch: { type: "string" },
          kill_criteria: { type: "string" },
          build_estimate: { type: "string" },
          artifact_type: { type: "string" },
          artifact_body: { type: "string" },
          learning_target: { type: "string" },
        },
        required: [
          "domain",
          "hypothesis",
          "signal_to_watch",
          "kill_criteria",
          "build_estimate",
          "artifact_type",
          "artifact_body",
          "learning_target",
        ],
      },
    },
    temperature: 0.5,
    maxTokens: 2000,
  });

  function s(raw: unknown, max: number): string {
    return typeof raw === "string" ? raw.trim().slice(0, max) : "";
  }

  const domain: DomainKind =
    raw?.domain === "app_product" ||
    raw?.domain === "journaling" ||
    raw?.domain === "book_analysis" ||
    raw?.domain === "passion_arc" ||
    raw?.domain === "research" ||
    raw?.domain === "operations"
      ? raw.domain
      : "generic";

  return {
    id: briefId(ctx.variation.id, ctx.open_question),
    variation_id: ctx.variation.id,
    open_question: ctx.open_question,
    domain,
    hypothesis: s(raw?.hypothesis, 320),
    signal_to_watch: s(raw?.signal_to_watch, 240),
    kill_criteria: s(raw?.kill_criteria, 240),
    build_estimate: s(raw?.build_estimate, 200),
    artifact_type: s(raw?.artifact_type, 80),
    artifact_body: s(raw?.artifact_body, 4000),
    learning_target: s(raw?.learning_target, 240),
    generated_at: new Date().toISOString(),
  };
}

/** Deterministic brief id from variation + question. Survives
 *  cache invalidation (composed_design invalidates per election
 *  set; briefs invalidate per variation/question pair). */
function briefId(variationId: string, openQuestion: string): string {
  const qSlug = openQuestion
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  return `pb_${variationId}_${qSlug || "q"}`;
}
