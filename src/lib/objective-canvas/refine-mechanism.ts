// ── Refine Mechanism ──────────────────────────────────────────────
//
// Phase 5b — R&D agent's proposal step. Given a feature card whose
// existing variations have been scored, generate N new candidate
// variations that specifically target the weakest root_cause of the
// target pain.
//
// This is the LLM bridge — pure proposal, no scoring. The caller
// (refine API route) scores the output through scoreVariationsForFeature.
//
// Why a separate file vs. extending expand-item-detail:
//   • Different goal: expand-item-detail generates the FULL drawer
//     surface (definition + variations + planning). This call
//     generates ONLY new variations targeting a specific gap.
//   • Different prompt shape: tighter, more constrained — names a
//     specific root_cause to attack + a list of existing variations
//     to NOT duplicate + constraints to respect.
//   • Different cleanup: each candidate carries provenance="rd_iteration"
//     + target_root_cause so the UI can render the comparison panel
//     and analytics can filter for refinement effectiveness over time.

import { llmJSON } from "@/lib/llm";
import {
  buildConstraintsBlock,
  type OperationalConstraints,
} from "./constraints";
import type { ItemVariation, VariationKind } from "./expand-item-detail";

/** Inputs the refine bridge needs to compose a tight, well-grounded
 *  proposal. Caller is responsible for resolving these from the
 *  room + feature + envelope. */
export interface RefineMechanismContext {
  /** The feature being refined — what it is + its causal chain. */
  feature: {
    name: string;
    /** From entities.causal_chain.positive_outcome. */
    positive_outcome: string;
    /** From entities.causal_chain.first_principles. */
    first_principles: string[];
  };
  /** The target pain this feature most strongly addresses — picked
   *  by the scorer as the lever's target. */
  target_pain: {
    name: string;
    /** From entities.causal_chain.negative_outcome. */
    negative_outcome: string;
    /** From entities.causal_chain.root_causes. */
    root_causes: string[];
  };
  /** The SPECIFIC root_cause the new candidates must address. Picked
   *  by the caller (typically the worst-covered root_cause across
   *  current variations, or the user's manual pick). */
  gap_root_cause: string;
  /** Current variations on this feature. The prompt instructs the
   *  LLM to NOT duplicate these — each new candidate must be a
   *  meaningfully different IV setting. */
  existing_variations: Pick<ItemVariation, "name" | "description" | "tradeoff">[];
  /** Sibling features in the same room with their elected variants —
   *  Phase 3 propagation, same shape as expand-item-detail's
   *  lateralContext. The proposal should COMPOSE with or
   *  DIFFERENTIATE from these neighbor choices. */
  sibling_features?: Array<{
    name: string;
    elected_variation_names: string[];
  }>;
  /** Parent objective + sub-objective text for grounding the
   *  domain language. */
  core_objective_text: string;
  sub_objective_title: string;
  /** User's operational constraints. The prompt frames these as
   *  hard production-time gates. The LATER compliance check
   *  re-grades each candidate quantitatively. */
  constraints: OperationalConstraints | null;
  /** How many candidates to produce. MVP defaults to 3 — few enough
   *  to read at a glance, enough to compare. */
  candidate_count?: number;
}

export interface ProposedMechanismCandidate {
  /** Same shape as ItemVariation for direct insertion into
   *  expanded_detail.variations[]. Caller assigns the id + writes
   *  provenance="rd_iteration" + target_root_cause before persist. */
  name: string;
  description: string;
  tradeoff: string;
  kind: VariationKind;
  addresses_pain: number;
  open_questions: string[];
  /** Optional — when the LLM names the specific approach class,
   *  pass through for the UI. Otherwise undefined. */
  approach_class?: string;
}

const SYSTEM_PROMPT = `You are the R&D agent in a scientific design system. The user is REFINING a single mechanism in their sub-objective room. Each variation of this mechanism is a candidate "setting" of an independent variable being tested against the room's dependent variables (problem ↓, result ↑).

YOUR JOB: propose N NEW candidate variations of THIS specific feature, each one designed to attack a SPECIFIC ROOT CAUSE of the target pain that current variations do not adequately address.

CRITICAL CONSTRAINTS:
1. DO NOT duplicate the existing variations — each candidate must be a structurally different IV setting that pulls a different lever or applies a different principle.
2. EACH candidate must EXPLICITLY address the named gap_root_cause. The "addresses_pain" rating reflects this — a candidate that doesn't directly counter the gap_root_cause should not be emitted.
3. Each candidate is an INDEPENDENT VARIABLE the user could set the feature to — a concrete implementation choice, not a description of what the feature does generally.
4. Respect the user's operational constraints. A candidate that violates time/budget/team/risk/compliance limits is wasted — the user can't run it.
5. Compose with sibling-feature elections when relevant. If a sibling has elected X, your candidate should either build on X, work around X, or explicitly mark its tension with X in the tradeoff.

OUTPUT FOR EACH CANDIDATE:
- name: 3-6 words, noun phrase, names the IMPLEMENTATION CHOICE (e.g. "Session-aware decay weighting", "Implicit signal fusion", "Hybrid retrieval cascade"). NOT generic ("Better personalization") and NOT a restatement of the feature ("Personalization Engine v2").
- description: 1-2 sentences. What this candidate IS as an implementation, not what it does conceptually.
- tradeoff: 1 sentence. What you gain, what you give up — must reference the SPECIFIC gap_root_cause being addressed.
- kind: "alternative" (mutually exclusive choices) — refinement candidates are competing IV settings, not stackable additives.
- addresses_pain: 0..1. How directly does this candidate counter the gap_root_cause specifically. 1.0 = decisive counter. 0.5 = partial. <0.4 = drop, don't emit.
- open_questions: 1-2 short questions whose answers would change whether this is the right call.

Return strict JSON. Quality over quantity — if you can only produce 2 meaningfully distinct candidates targeting the gap, emit 2 not 3.`;

function buildUserPrompt(ctx: RefineMechanismContext): string {
  const N = ctx.candidate_count ?? 3;
  const existingBlock =
    ctx.existing_variations.length > 0
      ? `EXISTING VARIATIONS (do NOT duplicate, each one is "taken"):\n${ctx.existing_variations
          .slice(0, 8)
          .map(
            (v, i) =>
              `  ${i + 1}. "${v.name.trim()}" — ${v.description.trim().slice(0, 120)}\n     tradeoff: ${v.tradeoff.trim().slice(0, 120)}`,
          )
          .join("\n")}\n`
      : "";

  const siblingBlock =
    ctx.sibling_features && ctx.sibling_features.length > 0
      ? `\nSIBLING FEATURES (other mechanisms in this room with their current elections — your candidate should compose with or differentiate from these):\n${ctx.sibling_features
          .filter((s) => s.elected_variation_names.length > 0)
          .slice(0, 3)
          .map(
            (s) =>
              `  "${s.name}" — elected: ${s.elected_variation_names.slice(0, 3).join(" | ")}`,
          )
          .join("\n")}\n`
      : "";

  const constraintsBlock = ctx.constraints
    ? `\n${buildConstraintsBlock(ctx.constraints)}\n`
    : "";

  return `PARENT OBJECTIVE:\n"""\n${ctx.core_objective_text.slice(0, 1200)}\n"""\n\nSUB-OBJECTIVE (room scope):\n"""\n${ctx.sub_objective_title}\n"""\n\nFEATURE BEING REFINED (this is the IV the user is testing):\n  Name: ${ctx.feature.name}\n  positive_outcome: ${ctx.feature.positive_outcome}\n  first_principles: ${ctx.feature.first_principles.slice(0, 5).join(" · ")}\n\nTARGET PAIN (the DV this feature is supposed to minimize):\n  Name: ${ctx.target_pain.name}\n  negative_outcome: ${ctx.target_pain.negative_outcome}\n  root_causes: ${ctx.target_pain.root_causes.slice(0, 6).join(" · ")}\n\nGAP TO TARGET (the specific root_cause current variations don't address):\n  "${ctx.gap_root_cause}"\n${existingBlock}${siblingBlock}${constraintsBlock}\nGenerate ${N} new variation candidates per the system instructions. Each must specifically target "${ctx.gap_root_cause}".`;
}

export async function proposeMechanismCandidates(
  ctx: RefineMechanismContext,
): Promise<ProposedMechanismCandidate[]> {
  const N = ctx.candidate_count ?? 3;
  const raw = await llmJSON<{
    candidates?: Array<{
      name?: unknown;
      description?: unknown;
      tradeoff?: unknown;
      kind?: unknown;
      addresses_pain?: unknown;
      open_questions?: unknown;
      approach_class?: unknown;
    }>;
  }>({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(ctx),
    responseSchema: {
      name: "refine_mechanism_candidates",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidates: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                tradeoff: { type: "string" },
                kind: {
                  type: "string",
                  enum: ["alternative", "additive", "principle"],
                },
                addresses_pain: { type: "number" },
                open_questions: {
                  type: "array",
                  items: { type: "string" },
                },
                approach_class: { type: "string" },
              },
              required: [
                "name",
                "description",
                "tradeoff",
                "kind",
                "addresses_pain",
                "open_questions",
                "approach_class",
              ],
            },
          },
        },
        required: ["candidates"],
      },
    },
    temperature: 0.55,
    maxTokens: 1400,
  });

  const out: ProposedMechanismCandidate[] = [];
  for (const c of raw?.candidates ?? []) {
    const name = typeof c?.name === "string" ? c.name.trim().slice(0, 80) : "";
    const description =
      typeof c?.description === "string" ? c.description.trim().slice(0, 280) : "";
    const tradeoff =
      typeof c?.tradeoff === "string" ? c.tradeoff.trim().slice(0, 240) : "";
    if (!name || !description) continue;
    const kind: VariationKind =
      c?.kind === "additive" || c?.kind === "principle"
        ? (c.kind as VariationKind)
        : "alternative";
    const addresses_pain =
      typeof c?.addresses_pain === "number" && Number.isFinite(c.addresses_pain)
        ? Math.max(0, Math.min(1, c.addresses_pain))
        : 0.5;
    // Drop weak candidates per the system rule (addresses_pain < 0.4
    // means "don't emit"). Belt + suspenders since the prompt
    // already discourages them.
    if (addresses_pain < 0.4) continue;
    const open_questions = Array.isArray(c?.open_questions)
      ? (c.open_questions as unknown[])
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .slice(0, 3)
          .map((s) => s.trim().slice(0, 200))
      : [];
    const approach_class =
      typeof c?.approach_class === "string"
        ? c.approach_class.trim().slice(0, 80)
        : undefined;
    out.push({
      name,
      description,
      tradeoff,
      kind,
      addresses_pain,
      open_questions,
      approach_class,
    });
    if (out.length >= N) break;
  }
  return out;
}
