// ── Causal Chain Enrichment ───────────────────────────────────────
//
// Phase 11.4 — turns shallow (Pain × Feature × Outcome) labels into
// a sophisticated causal narrative. For each chain, one LLM call
// produces:
//
//   • narrative              — 1-2 paragraph mechanism story:
//                              HOW does the Feature address the Pain,
//                              HOW does that produce the Outcome,
//                              what's the moment-to-moment causal flow
//   • chain_strength         — 0..1 end-to-end plausibility. Combines
//                              mechanism credibility, mediator
//                              dependability, and outcome closure.
//   • mediators[]            — variables that moderate the chain's
//                              strength (e.g., "user adherence",
//                              "task complexity"). Each carries an
//                              "amplifies / dampens / conditional"
//                              effect + a one-sentence assumption.
//   • causal_flow_rationale  — why THIS path (Pain → Feature → Outcome),
//                              not Pain → Outcome directly. Names
//                              what the Feature uniquely contributes.
//   • outcome_closes_loop    — how the Outcome actually addresses the
//                              Pain. Forces the LLM to articulate the
//                              closure rather than assert it.
//   • weak_points[]          — 1-3 places this chain could fail. Used
//                              by the Lab page's "weak points" surface
//                              + the R&D engine to target refinements.
//
// Why this matters: the previous chain representation was just
// (Pain entity) → (Feature entity, mechanism="short string") →
// (Outcome entity). Users couldn't see HOW the chain worked. The
// Portfolio strip surfaced "unaddressed dimensions" because there
// was no way to know which items genuinely interlocked.
//
// Storage: writes go into the existing edges.agent_feedback JSONB
// column. No new DB columns. The shape is additive: existing
// `mechanism` string stays; new fields slot in alongside.
//
// Performance: ~3-5s per chain (one strict-JSON LLM call). Called
// in parallel-safe loops by the room/enrich-chains endpoint and
// the canvas autopilot Step 2.

import { llmJSON } from "@/lib/llm";
import {
  buildConstraintsBlock,
  type OperationalConstraints,
} from "./constraints";

export interface ChainMediator {
  /** Short noun phrase — e.g., "user adherence", "task complexity". */
  name: string;
  /** Why this mediator matters — one sentence. */
  assumption: string;
  /** How the mediator affects the chain. */
  effect: "amplifies" | "dampens" | "conditional";
}

export interface ChainEnrichment {
  /** 1-2 paragraph mechanism story (≤ ~600 chars). */
  narrative: string;
  /** 0..1 end-to-end plausibility. */
  chain_strength: number;
  /** Variables that moderate the chain (3-5 typical). */
  mediators: ChainMediator[];
  /** Why this Pain → Feature → Outcome path, not direct. */
  causal_flow_rationale: string;
  /** How the Outcome closes the loop on the Pain. */
  outcome_closes_loop: string;
  /** 1-3 places this chain could fail. */
  weak_points: string[];
  /** ISO timestamp this enrichment was generated. */
  enriched_at: string;
  /** Which tier produced this enrichment — for the MethodBadge. */
  evaluation_method: "rubric" | "evidence";
}

export interface EnrichChainInput {
  pain: {
    name: string;
    negative_outcome?: string;
    root_causes?: string[];
  };
  feature: {
    name: string;
    positive_outcome?: string;
    first_principles?: string[];
  };
  outcome: {
    name: string;
    measured_by?: string;
    indicators?: string[];
  };
  /** Mechanism string from the existing edge — when present, frames
   *  the prompt around expanding it. Empty falls back to "infer the
   *  mechanism." */
  pain_feature_mechanism?: string;
  feature_outcome_mechanism?: string;
  /** Sub-objective title + core objective text for domain grounding. */
  sub_objective_title: string;
  core_objective_text: string;
  /** User's operational constraints — affects feasibility of the
   *  proposed chain + which mediators are credible. */
  constraints: OperationalConstraints | null;
}

const SYSTEM_PROMPT = `You are a causal-mechanism analyst. Your job is to turn a labelled chain (Pain × Feature × Outcome) into a sophisticated end-to-end causal narrative.

For each chain, you must produce:

1. narrative (1-2 paragraphs, ≤600 chars)
   Tell the causal story end-to-end. HOW does the Feature engage with the Pain's root causes? HOW does that engagement produce the Outcome? Be mechanistic, not aspirational. Use phrases like "by X, which causes Y, which observably produces Z." Avoid generic descriptions.

2. chain_strength (0.0 to 1.0)
   End-to-end plausibility. 0.0 = the causal chain breaks at some link or contradicts evidence. 1.0 = each link is well-established and the chain closes cleanly. Be strict — most chains land 0.4-0.8. A 0.9+ chain has overwhelming prior support.

3. mediators (3-5 entries)
   Variables that moderate this chain's strength. For each: name (noun phrase), assumption (why it matters), effect (amplifies / dampens / conditional). Examples: "user adherence" (dampens if low), "task complexity" (conditional — only relevant for complex tasks), "time of day" (amplifies for morning users). Don't just list inputs — name what specifically modulates the link.

4. causal_flow_rationale (1-2 sentences)
   Why this Pain → Feature → Outcome path, not just Pain → Outcome directly? What does the Feature uniquely contribute? If the Feature is just a label and the Outcome would happen anyway, say so (and chain_strength should drop).

5. outcome_closes_loop (1-2 sentences)
   How does this Outcome actually address the Pain? An Outcome that doesn't close the loop is worthless — name the mechanism by which moving the Outcome reduces the Pain. If the Outcome is just a metric that correlates with the Pain but doesn't cause its reduction, say so.

6. weak_points (1-3 strings)
   Places this chain could fail. Specific. "Won't work if the user disables notifications" — not "depends on user behavior." Used to target refinement.

Constraints on your judgment:
- Be strict about chain_strength. Padding scores is dishonest.
- Mediators should be ACTIONABLE — variables a designer or researcher could measure or change. Not platitudes.
- If the chain genuinely doesn't work (Feature doesn't address Pain, or Outcome doesn't close the loop), score chain_strength ≤0.3 and write weak_points that explain what's broken.

Return JSON matching the response schema. No prose outside the JSON.`;

function buildUserPrompt(ctx: EnrichChainInput): string {
  const constraintsBlock = ctx.constraints
    ? `\n${buildConstraintsBlock(ctx.constraints)}\n`
    : "";

  const painRootCauses = ctx.pain.root_causes && ctx.pain.root_causes.length > 0
    ? `\n  root_causes: ${ctx.pain.root_causes.slice(0, 5).join(" · ")}`
    : "";
  const featurePrinciples =
    ctx.feature.first_principles && ctx.feature.first_principles.length > 0
      ? `\n  first_principles: ${ctx.feature.first_principles.slice(0, 5).join(" · ")}`
      : "";
  const outcomeIndicators =
    ctx.outcome.indicators && ctx.outcome.indicators.length > 0
      ? `\n  indicators: ${ctx.outcome.indicators.slice(0, 5).join(" · ")}`
      : "";
  const pfMech = ctx.pain_feature_mechanism
    ? `\n  current mechanism (Pain ← Feature): "${ctx.pain_feature_mechanism}"`
    : "";
  const foMech = ctx.feature_outcome_mechanism
    ? `\n  current mechanism (Feature → Outcome): "${ctx.feature_outcome_mechanism}"`
    : "";

  return `PARENT OBJECTIVE:
"""
${ctx.core_objective_text.slice(0, 800)}
"""

SUB-OBJECTIVE (room scope):
"""
${ctx.sub_objective_title}
"""

THE CHAIN TO ENRICH:

[PAIN] ${ctx.pain.name}${
    ctx.pain.negative_outcome
      ? `\n  negative_outcome: ${ctx.pain.negative_outcome}`
      : ""
  }${painRootCauses}

[FEATURE / MECHANISM] ${ctx.feature.name}${
    ctx.feature.positive_outcome
      ? `\n  positive_outcome: ${ctx.feature.positive_outcome}`
      : ""
  }${featurePrinciples}

[OUTCOME] ${ctx.outcome.name}${
    ctx.outcome.measured_by ? `\n  measured_by: ${ctx.outcome.measured_by}` : ""
  }${outcomeIndicators}

EXISTING EDGE STRINGS (you're expanding these, not replacing them):${pfMech}${foMech}
${constraintsBlock}
Produce the enrichment per the system instructions. Be strict on chain_strength — most chains land 0.4-0.8.`;
}

const ENRICHMENT_SCHEMA = {
  name: "chain_enrichment",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      narrative: { type: "string" },
      chain_strength: { type: "number" },
      mediators: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            assumption: { type: "string" },
            effect: {
              type: "string",
              enum: ["amplifies", "dampens", "conditional"],
            },
          },
          required: ["name", "assumption", "effect"],
        },
      },
      causal_flow_rationale: { type: "string" },
      outcome_closes_loop: { type: "string" },
      weak_points: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "narrative",
      "chain_strength",
      "mediators",
      "causal_flow_rationale",
      "outcome_closes_loop",
      "weak_points",
    ],
  },
};

/** Single-chain enrichment. Soft-fails on LLM error — returns null
 *  so the caller can keep iterating. The endpoint handles the
 *  per-chain failure as "this chain stays at its prior enrichment
 *  (or unenriched)" without aborting the whole room. */
export async function enrichChain(
  ctx: EnrichChainInput,
): Promise<ChainEnrichment | null> {
  let raw: {
    narrative?: unknown;
    chain_strength?: unknown;
    mediators?: Array<{
      name?: unknown;
      assumption?: unknown;
      effect?: unknown;
    }>;
    causal_flow_rationale?: unknown;
    outcome_closes_loop?: unknown;
    weak_points?: unknown[];
  };
  try {
    raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(ctx),
      responseSchema: ENRICHMENT_SCHEMA,
      temperature: 0.3,
      maxTokens: 1400,
    });
  } catch (err) {
    console.warn(
      "[enrich-chain] LLM failed (soft-fail):",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  // ── Clean + validate ──
  const narrative =
    typeof raw?.narrative === "string"
      ? raw.narrative.trim().slice(0, 800)
      : "";
  if (!narrative) return null;

  const chain_strength =
    typeof raw?.chain_strength === "number" &&
    Number.isFinite(raw.chain_strength)
      ? Math.max(0, Math.min(1, raw.chain_strength))
      : 0.5;

  const mediators: ChainMediator[] = [];
  for (const m of raw?.mediators ?? []) {
    const name =
      typeof m?.name === "string" ? m.name.trim().slice(0, 60) : "";
    const assumption =
      typeof m?.assumption === "string"
        ? m.assumption.trim().slice(0, 200)
        : "";
    const effect =
      m?.effect === "amplifies" ||
      m?.effect === "dampens" ||
      m?.effect === "conditional"
        ? (m.effect as ChainMediator["effect"])
        : "conditional";
    if (!name || !assumption) continue;
    mediators.push({ name, assumption, effect });
    if (mediators.length >= 6) break;
  }

  const causal_flow_rationale =
    typeof raw?.causal_flow_rationale === "string"
      ? raw.causal_flow_rationale.trim().slice(0, 400)
      : "";

  const outcome_closes_loop =
    typeof raw?.outcome_closes_loop === "string"
      ? raw.outcome_closes_loop.trim().slice(0, 400)
      : "";

  const weak_points = Array.isArray(raw?.weak_points)
    ? raw.weak_points
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .map((s) => s.trim().slice(0, 200))
        .slice(0, 3)
    : [];

  return {
    narrative,
    chain_strength,
    mediators,
    causal_flow_rationale,
    outcome_closes_loop,
    weak_points,
    enriched_at: new Date().toISOString(),
    evaluation_method: "rubric",
  };
}

// ── Complementary chain proposer ──────────────────────────────────
//
// For items in lanes that aren't touched by any chain (the "9
// unaddressed dimensions" problem from the Portfolio strip), this
// asks the LLM "given these orphans, what mechanism would credibly
// link this orphaned X to that orphaned Y?" The threshold is lower
// than the original linkCorrelations pass (0.4 vs ~0.5) because
// we're explicitly trying to close gaps. Each proposal comes
// pre-enriched so we don't pay for two LLM rounds per new chain.
//
// Cap at 3 new chains per orphan to prevent runaway insertion. The
// caller decides what to do with the proposals — typically inserts
// edges + applies the enrichment in one go.

export interface OrphanItem {
  id: string;
  name: string;
  layer: "pain" | "features" | "outcomes";
  /** Brief context to ground the LLM (the entity's causal_chain). */
  context_blurb?: string;
}

export interface ProposedComplementaryChain {
  /** Lane endpoints. Each is an entity id. Both must be set. */
  pain_id: string | null;
  feature_id: string | null;
  outcome_id: string | null;
  /** Proposed strength (0..1). Already-validated against the 0.4
   *  threshold by the LLM. */
  strength: number;
  /** Edge mechanism strings (for the new edges to be inserted). */
  pain_feature_mechanism?: string;
  feature_outcome_mechanism?: string;
  /** Pre-computed enrichment — same shape as enrichChain() output.
   *  Lets the caller insert the new chain + write the enrichment in
   *  one pass without a second LLM round. */
  enrichment: ChainEnrichment;
}

export interface ProposeComplementaryInput {
  /** Items in lanes that currently have no edge touching them. */
  orphans: OrphanItem[];
  /** Already-existing items in each lane so the proposer can pick
   *  endpoints (orphan + existing) when no orphan-to-orphan link
   *  fits. Slim shape — id + name only. */
  existing_pains: Array<{ id: string; name: string }>;
  existing_features: Array<{ id: string; name: string }>;
  existing_outcomes: Array<{ id: string; name: string }>;
  /** Same room grounding as enrichChain. */
  sub_objective_title: string;
  core_objective_text: string;
  constraints: OperationalConstraints | null;
  /** Max new chains per orphan. Default 3. */
  max_per_orphan?: number;
  /** Minimum strength threshold for a proposal to be kept. Default 0.4
   *  (aggressive coverage per scoping decision). */
  min_strength?: number;
}

const COMPLEMENTARY_SYSTEM_PROMPT = `You are a causal-mechanism analyst proposing NEW chains to close gaps in a sub-objective room.

You'll receive:
  • ORPHAN ITEMS — pains/features/outcomes in this room that no chain currently touches
  • EXISTING ITEMS — items in each lane that already have chains (for context)

For each orphan, propose 1-3 new chains that include it. Each chain MUST have all three endpoints (pain + feature + outcome). When an orphan is in one lane, pick endpoints from existing items in the other two lanes (or other orphans when a credible link exists).

For each proposal, also generate the FULL enrichment in the same call (narrative, chain_strength, mediators, causal_flow_rationale, outcome_closes_loop, weak_points). Do NOT propose weak chains — if you can't credibly link an orphan to anything in the room with chain_strength ≥0.4, omit it entirely. Closing a gap with a bad chain is worse than leaving it open.

Rules:
- Be specific about WHY each new link works. No filler mechanisms like "addresses through general improvement."
- chain_strength ≥0.4 minimum; ≥0.6 preferred.
- Mediators should be domain-relevant, not platitudes.
- weak_points should name the specific failure mode.

Return JSON matching the response schema. No prose outside.`;

function buildComplementaryUserPrompt(
  input: ProposeComplementaryInput,
): string {
  const constraintsBlock = input.constraints
    ? `\n${buildConstraintsBlock(input.constraints)}\n`
    : "";

  const orphanByLayer: Record<string, OrphanItem[]> = {
    pain: [],
    features: [],
    outcomes: [],
  };
  for (const o of input.orphans) {
    if (orphanByLayer[o.layer]) orphanByLayer[o.layer].push(o);
  }

  const fmt = (items: Array<{ id: string; name: string }>, label: string) =>
    items.length > 0
      ? `${label}:\n${items
          .slice(0, 8)
          .map((i) => `  • [id=${i.id}] ${i.name}`)
          .join("\n")}`
      : `${label}: (none)`;

  const orphanBlocks = (["pain", "features", "outcomes"] as const)
    .map((lane) => {
      const list = orphanByLayer[lane];
      if (list.length === 0) return null;
      const label = lane === "pain" ? "PAINS" : lane === "features" ? "FEATURES" : "OUTCOMES";
      return `${label} (orphans):\n${list
        .map(
          (o) =>
            `  • [id=${o.id}] ${o.name}${o.context_blurb ? ` — ${o.context_blurb.slice(0, 120)}` : ""}`,
        )
        .join("\n")}`;
    })
    .filter((s): s is string => s !== null)
    .join("\n\n");

  return `PARENT OBJECTIVE:
"""
${input.core_objective_text.slice(0, 800)}
"""

SUB-OBJECTIVE (room scope):
"""
${input.sub_objective_title}
"""

ORPHANS (need at least one chain to touch each):

${orphanBlocks}

EXISTING ITEMS (pick endpoints from these when an orphan needs to chain to something already in the room):

${fmt(input.existing_pains, "Existing pains")}

${fmt(input.existing_features, "Existing features")}

${fmt(input.existing_outcomes, "Existing outcomes")}
${constraintsBlock}
Propose ${input.max_per_orphan ?? 3} or fewer NEW chains per orphan (only those with chain_strength ≥${input.min_strength ?? 0.4}). Each proposal must include all three endpoints + the full enrichment. Skip orphans you can't credibly close.`;
}

const COMPLEMENTARY_SCHEMA = {
  name: "complementary_chains",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            pain_id: { type: "string" },
            feature_id: { type: "string" },
            outcome_id: { type: "string" },
            strength: { type: "number" },
            pain_feature_mechanism: { type: "string" },
            feature_outcome_mechanism: { type: "string" },
            enrichment: {
              type: "object",
              additionalProperties: false,
              properties: {
                narrative: { type: "string" },
                chain_strength: { type: "number" },
                mediators: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: { type: "string" },
                      assumption: { type: "string" },
                      effect: {
                        type: "string",
                        enum: ["amplifies", "dampens", "conditional"],
                      },
                    },
                    required: ["name", "assumption", "effect"],
                  },
                },
                causal_flow_rationale: { type: "string" },
                outcome_closes_loop: { type: "string" },
                weak_points: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: [
                "narrative",
                "chain_strength",
                "mediators",
                "causal_flow_rationale",
                "outcome_closes_loop",
                "weak_points",
              ],
            },
          },
          required: [
            "pain_id",
            "feature_id",
            "outcome_id",
            "strength",
            "enrichment",
          ],
        },
      },
    },
    required: ["proposals"],
  },
};

export async function proposeComplementaryChains(
  input: ProposeComplementaryInput,
): Promise<ProposedComplementaryChain[]> {
  if (input.orphans.length === 0) return [];

  const minStrength = input.min_strength ?? 0.4;

  let raw: {
    proposals?: Array<{
      pain_id?: unknown;
      feature_id?: unknown;
      outcome_id?: unknown;
      strength?: unknown;
      pain_feature_mechanism?: unknown;
      feature_outcome_mechanism?: unknown;
      enrichment?: {
        narrative?: unknown;
        chain_strength?: unknown;
        mediators?: Array<{
          name?: unknown;
          assumption?: unknown;
          effect?: unknown;
        }>;
        causal_flow_rationale?: unknown;
        outcome_closes_loop?: unknown;
        weak_points?: unknown[];
      };
    }>;
  };
  try {
    raw = await llmJSON({
      system: COMPLEMENTARY_SYSTEM_PROMPT,
      user: buildComplementaryUserPrompt(input),
      responseSchema: COMPLEMENTARY_SCHEMA,
      temperature: 0.45,
      maxTokens: 2800,
    });
  } catch (err) {
    console.warn(
      "[enrich-chain/complementary] LLM failed (soft-fail):",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }

  const now = new Date().toISOString();
  const out: ProposedComplementaryChain[] = [];

  // ── Validate every proposal — drop weak or malformed ──
  for (const p of raw?.proposals ?? []) {
    const pain_id = typeof p?.pain_id === "string" ? p.pain_id : null;
    const feature_id = typeof p?.feature_id === "string" ? p.feature_id : null;
    const outcome_id = typeof p?.outcome_id === "string" ? p.outcome_id : null;
    if (!pain_id || !feature_id || !outcome_id) continue;

    const strength =
      typeof p?.strength === "number" && Number.isFinite(p.strength)
        ? Math.max(0, Math.min(1, p.strength))
        : 0;
    if (strength < minStrength) continue;

    const e = p?.enrichment;
    if (!e) continue;
    const narrative =
      typeof e.narrative === "string" ? e.narrative.trim().slice(0, 800) : "";
    if (!narrative) continue;

    const chain_strength =
      typeof e.chain_strength === "number" && Number.isFinite(e.chain_strength)
        ? Math.max(0, Math.min(1, e.chain_strength))
        : strength;
    if (chain_strength < minStrength) continue;

    const mediators: ChainMediator[] = [];
    for (const m of e.mediators ?? []) {
      const name =
        typeof m?.name === "string" ? m.name.trim().slice(0, 60) : "";
      const assumption =
        typeof m?.assumption === "string"
          ? m.assumption.trim().slice(0, 200)
          : "";
      const effect =
        m?.effect === "amplifies" ||
        m?.effect === "dampens" ||
        m?.effect === "conditional"
          ? (m.effect as ChainMediator["effect"])
          : "conditional";
      if (!name || !assumption) continue;
      mediators.push({ name, assumption, effect });
      if (mediators.length >= 6) break;
    }

    const causal_flow_rationale =
      typeof e.causal_flow_rationale === "string"
        ? e.causal_flow_rationale.trim().slice(0, 400)
        : "";
    const outcome_closes_loop =
      typeof e.outcome_closes_loop === "string"
        ? e.outcome_closes_loop.trim().slice(0, 400)
        : "";
    const weak_points = Array.isArray(e.weak_points)
      ? e.weak_points
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .map((s) => s.trim().slice(0, 200))
          .slice(0, 3)
      : [];

    out.push({
      pain_id,
      feature_id,
      outcome_id,
      strength,
      pain_feature_mechanism:
        typeof p.pain_feature_mechanism === "string"
          ? p.pain_feature_mechanism.trim().slice(0, 240)
          : undefined,
      feature_outcome_mechanism:
        typeof p.feature_outcome_mechanism === "string"
          ? p.feature_outcome_mechanism.trim().slice(0, 240)
          : undefined,
      enrichment: {
        narrative,
        chain_strength,
        mediators,
        causal_flow_rationale,
        outcome_closes_loop,
        weak_points,
        enriched_at: now,
        evaluation_method: "rubric",
      },
    });
  }

  return out;
}
