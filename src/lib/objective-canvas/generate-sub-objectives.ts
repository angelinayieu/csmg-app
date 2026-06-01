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
import { computeLayerPositionLabel, type ObjectiveStack } from "./layer-model";

interface LlmShape {
  category?: unknown;
  proposals?: Array<{
    title?: unknown;
    summary?: unknown;
    rationale?: unknown;
    confidence?: unknown;
    recommended?: unknown;
    lens_coverage?: unknown;
    layer_ordinals?: unknown;
    layer_position_label?: unknown;
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
  /** O2 — Recent concept memory feed. Distinct from priorConcepts:
   *  activity-ranked (recency × cross-space spread) rather than
   *  similarity-ranked. Surfaces what's hot in the user's mind. The
   *  proposer reads this as an ambient attention signal — bias toward
   *  natural overlap, ignore when no overlap exists. */
  recentConcepts?: Array<{
    display_name: string;
    description: string | null;
    entity_count: number;
    space_count: number;
  }>;
  /** Phase 11.A.4 — when the space's ObjectiveStack has been
   *  generated, pass it here so JOB 3 (layer tagging) fires + each
   *  proposal carries layer_ordinals + layer_position_label.
   *  Undefined preserves legacy behavior (no layer tags). */
  objectiveStack?: ObjectiveStack;
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

  const hasLayerStack =
    !!opts.objectiveStack && opts.objectiveStack.layers.length > 0;

  const raw = await llmJSON<LlmShape>({
    system: buildSystemPrompt(intent, opts.hcdMode === true, hasLayerStack),
    user: buildUserPrompt({
      objective: opts.objective,
      clarifying: opts.clarifying,
      ragBlock: opts.ragBlock,
      intent,
      existingProposals: opts.existingProposals,
      lens,
      uncoveredLensIndices: opts.uncoveredLensIndices,
      priorConcepts: opts.priorConcepts,
      recentConcepts: opts.recentConcepts,
      objectiveStack: opts.objectiveStack,
    }),
    responseSchema: buildResponseSchema(hasLens, hasLayerStack),
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
    // Phase 11.A.4 — forward layer tags through the normalizer when
    // the LLM emitted them. The normalizer validates ordinals + caps
    // the label length; missing fields drop cleanly.
    layer_ordinals: p?.layer_ordinals,
    layer_position_label: p?.layer_position_label,
  }));
  const proposals = normalizeProposals(idAssigned);

  // Phase 11.A.4 (accuracy pass) — STACK-AWARE layer validation.
  // normalizeProposals only clamps ordinals to 1..6, trusts the LLM's
  // free-text label, and sorts ordinals ascending (losing which layer
  // is PRIMARY). Mirror the rigor of tagCardsToLayers: keep only the
  // stack's REAL ordinals (drop hallucinated layers), preserve the
  // LLM's emitted ORDER so layer_ordinals[0] is the primary-effect
  // layer the picker groups by, cap at 2, and RECOMPUTE the label so
  // it can never disagree with the ordinals. No-op without a stack.
  let finalProposals = proposals;
  if (hasLayerStack) {
    const validOrdinals = new Set(
      opts.objectiveStack!.layers.map((l) => l.ordinal),
    );
    const rawOrdinalsById = new Map<string, unknown>(
      idAssigned.map((p) => [p.id, p.layer_ordinals] as [string, unknown]),
    );
    finalProposals = proposals.map((p) => {
      const source = rawOrdinalsById.get(p.id);
      const candidates: unknown[] = Array.isArray(source)
        ? source
        : (p.layer_ordinals ?? []);
      const seen = new Set<number>();
      const kept: number[] = [];
      for (const v of candidates) {
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const o = Math.round(v);
        if (validOrdinals.has(o) && !seen.has(o)) {
          seen.add(o);
          kept.push(o); // preserve LLM order — primary first
          if (kept.length === 2) break;
        }
      }
      if (kept.length === 0) {
        // Every emitted ordinal was hallucinated / out-of-stack — drop
        // the tag rather than mis-place it. Surfaces honestly as
        // untagged until a re-tag pass runs.
        const cleaned: SubObjectiveProposal = { ...p };
        delete cleaned.layer_ordinals;
        delete cleaned.layer_position_label;
        return cleaned;
      }
      return {
        ...p,
        layer_ordinals: kept,
        layer_position_label: computeLayerPositionLabel(kept),
      };
    });
  }

  // Category: trim, drop trailing punctuation, cap at ~24 chars.
  let category =
    typeof raw?.category === "string" ? raw.category.trim() : "";
  category = category.replace(/[.!?,]+$/g, "").slice(0, 24).trim();

  return { proposals: finalProposals, category, temperature, intent };
}
