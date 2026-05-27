// ── Objective Canvas — sub-objective proposal generator ──

import { randomUUID } from "crypto";
import { llmJSON } from "@/lib/llm";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildResponseSchema,
  temperatureForIntent,
} from "./decompose-prompt";
import type { ClarifyingBlock } from "./clarifying-state";
import {
  normalizeProposals,
  type SubObjectiveProposal,
  type SubObjectiveIntent,
} from "./sub-objective-state";
import type { ObjectiveAnnotation } from "./generate-annotations";
import type { RelevantCanonicalConcept } from "./canonical-concept-lookup";

interface LlmShape {
  category?: unknown;
  proposals?: Array<{
    title?: unknown;
    summary?: unknown;
    rationale?: unknown;
    confidence?: unknown;
    recommended?: unknown;
    lens_coverage?: unknown;
  }>;
}

export interface GenerateSubObjectivesOptions {
  objective: string;
  clarifying: ClarifyingBlock | null;
  /** Optional RESEARCH CONTEXT block pre-built by
   *  research-service.buildRagBlock(). When present, prepended to
   *  the user prompt so the LLM grounds proposals in real sources. */
  ragBlock?: string;
  /** Variant Lab — intent that steers this generation pass. Default
   *  "initial" preserves legacy behavior. */
  intent?: SubObjectiveIntent;
  /** Phase 11 — when true, the system prompt gets an HCD bias mixin
   *  pushing proposals toward user-role-grounded, prototypable
   *  framings. Sourced from spaces.synthesis_data.objective_canvas.hcd_mode
   *  at the route layer. */
  hcdMode?: boolean;
  /** Variant Lab — proposals from prior batches. Drives the
   *  ANTI-DUPLICATE block in the user prompt. */
  existingProposals?: SubObjectiveProposal[];
  /** Variant Lab — parent objective annotation lens. When provided,
   *  each new proposal emits lens_coverage[] back. */
  annotations?: ObjectiveAnnotation[];
  /** Variant Lab — 1-based annotation indices uncovered by current
   *  elected proposals. Used by the gap_fill intent prompt. */
  uncoveredLensIndices?: number[];
  /** Cross-space KG — canonical concepts the user has already
   *  explored across other spaces, ranked by relevance to this
   *  objective. Drives the "link or diverge" block in the prompt.
   *  Empty / undefined → omitted (legacy single-space behavior). */
  priorConcepts?: RelevantCanonicalConcept[];
}

export interface GeneratedSubObjectives {
  proposals: SubObjectiveProposal[];
  /** LLM-named bucket: "Features", "Lessons", "Bets" — shown above
   *  the picker as "5 {category} proposed". Empty string when the
   *  model didn't supply or the value is too long to surface cleanly. */
  category: string;
  /** Echo-back so caller knows the temperature the LLM saw — used
   *  by the variant lab batch metadata. */
  temperature: number;
  /** Echo-back of the intent used. */
  intent: SubObjectiveIntent;
}

const VERB_PREFIX_PATTERN =
  /^(develop|develop a|develop the|implement|implement a|implement the|create|create a|create the|design|design a|design the|build|build a|build the|enhance|enhance the|establish|establish a|establish the|drive|deliver|provide|enable|generate|produce|conduct|conduct a)\s+/i;

/** Strip a leading action verb from a title and capitalize the
 *  result so we get the noun phrase the prompt was asking for even
 *  if the LLM slipped. Idempotent. */
function stripVerbPrefix(title: string): string {
  const stripped = title.replace(VERB_PREFIX_PATTERN, "").trim();
  if (stripped.length === 0) return title.trim();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export async function generateSubObjectiveProposals(
  opts: GenerateSubObjectivesOptions,
): Promise<GeneratedSubObjectives> {
  const intent: SubObjectiveIntent = opts.intent ?? "initial";
  const temperature = temperatureForIntent(intent);
  const hasLens = (opts.annotations?.length ?? 0) > 0;

  // Weight-sort + cap at 8, matching the room generator's lens
  // projection. Indices the LLM emits in lens_coverage[] resolve
  // against this same ordering.
  const lens = hasLens
    ? [...(opts.annotations ?? [])]
        .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
        .slice(0, 8)
    : undefined;

  const raw = await llmJSON<LlmShape>({
    system: buildSystemPrompt(intent, opts.hcdMode === true),
    user: buildUserPrompt({
      objective: opts.objective,
      clarifying: opts.clarifying,
      ragBlock: opts.ragBlock,
      intent,
      existingProposals: opts.existingProposals,
      lens,
      uncoveredLensIndices: opts.uncoveredLensIndices,
      priorConcepts: opts.priorConcepts,
    }),
    responseSchema: buildResponseSchema(hasLens),
    temperature,
    maxTokens: 2400,
  });

  const items = Array.isArray(raw?.proposals) ? raw.proposals : [];
  // LLM doesn't generate ids — assign client-side.
  // Also enforce the noun-phrase rule client-side as a safety net
  // even though the prompt forbids verb prefixes. Forward
  // lens_coverage through so the normalizer can validate it against
  // the lens size (capped at 5 entries per proposal there).
  const idAssigned = items.map((p) => ({
    ...p,
    id: randomUUID(),
    title:
      typeof p?.title === "string" ? stripVerbPrefix(p.title) : p?.title,
    lens_coverage: p?.lens_coverage,
  }));
  const proposals = normalizeProposals(idAssigned);

  // Category: trim, drop trailing punctuation, cap at ~24 chars.
  let category =
    typeof raw?.category === "string" ? raw.category.trim() : "";
  category = category.replace(/[.!?,]+$/g, "").slice(0, 24).trim();

  return { proposals, category, temperature, intent };
}
