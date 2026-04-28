// ── Plan generator ───────────────────────────────────────────────
//
// Produces the user-reviewable KG generation plan that gates the
// pipeline. The plan is the contract: user reviews + approves, and
// downstream stages read their config from the approved plan rather
// than silent defaults.
//
// Architecture:
//   1. Single comprehensive LLM call produces the full plan body
//      using a strong structured-output system prompt.
//   2. When the topic doesn't match a starter ontology, the planner
//      defers ontology generation to the research-agent helper
//      (see ontology-research-agent.ts) which does deep-research
//      grounding before proposing layers.
//   3. The plan is persisted via the API route (propose-plan); this
//      module is pure (no DB writes) so it can be called from
//      anywhere (initial planning, re-planning, dry-runs).
//
// The generator does NOT touch the SituationFrame today — that
// existing stage continues to run AFTER plan approval, scoped by
// the approved layer ontology + axes. A later optimization will
// fold framing into the plan itself; for v1 we stay additive.
//
// See:
//   - src/types/kg-generation-plan.ts (the plan shape)
//   - supabase/migrations/20260614_kg_generation_plans.sql (DDL)
//   - src/lib/pipeline/ontology-research-agent.ts (companion)

import { llmJSON, MODEL_DEFAULTS } from "@/lib/llm";
import type {
  KgGenerationPlan,
  KgPlanScope,
  KgPlanLayerOntologyProposal,
  KgPlanAxisProposals,
  KgPlanConceptualSkeleton,
  KgPlanResearchPlan,
  KgPlanMethodologyDisclosure,
  KgPlanLimitations,
  KgPlanCostEstimate,
  KgPlanReasoningSettingsProposed,
  KgPlanMode,
  PlanGeneratorInput,
} from "@/types/kg-generation-plan";
import type { LayerOntologyTemplate } from "@/types/layer-ontology";
import { generateOntologyViaResearch } from "./ontology-research-agent";

// ── Output shape ─────────────────────────────────────────────────

/** The body of a plan as produced by the generator. Persisted by
 *  the API route into kg_generation_plans columns. */
export interface PlanGeneratorOutput {
  scope_and_objectives: KgPlanScope;
  layer_ontology_proposal: KgPlanLayerOntologyProposal;
  axis_proposals: KgPlanAxisProposals;
  conceptual_skeleton: KgPlanConceptualSkeleton;
  research_plan: KgPlanResearchPlan;
  methodology_disclosure: KgPlanMethodologyDisclosure;
  limitations: KgPlanLimitations;
  reasoning_settings_proposed: KgPlanReasoningSettingsProposed;
  cost_estimate: KgPlanCostEstimate;
  planner_confidence: number;
}

// ── Inputs to the generator ──────────────────────────────────────

/** Loaded ingested-file metadata the generator uses to populate the
 *  research plan. The route loader resolves these before calling. */
export interface PlanGeneratorPaper {
  ingested_file_id: string;
  title: string;
  /** First N characters of normalized text — the planner reads this
   *  to assess what the paper covers. Limit ~3000 chars per paper
   *  to keep total prompt size manageable. */
  excerpt: string;
  /** Asset class from the ingest pipeline ("research_paper",
   *  "spec_sheet", "web_article", etc.). */
  asset_class: string;
}

export interface PlanGeneratorRunInput extends PlanGeneratorInput {
  /** Loaded paper metadata + excerpts. */
  papers: PlanGeneratorPaper[];
  /** Available starter ontologies, loaded from
   *  layer_ontology_templates. Generator picks one if a strong
   *  match exists; otherwise calls the research agent. */
  starter_ontologies: LayerOntologyTemplate[];
}

// ── System prompt ────────────────────────────────────────────────

const PLAN_GENERATOR_SYSTEM = `You are the KG Generation Planning Agent for InterAxis Laboratory — a scientifically rigorous knowledge-graph + simulation platform for general mind-body modeling.

Your job: given a user's prompt, scope, mode, and any uploaded research papers, produce a comprehensive plan describing EVERYTHING the pipeline is about to do. The user will review the plan in a Plan Review Card and approve (or edit + approve) before any downstream stage runs.

Plan philosophy:
1. The plan is a CONTRACT. Every silent default the pipeline would otherwise pick MUST be surfaced for review. Researchers need agency over the methodology, not just the topic.
2. Be HONEST about limits. If extraction parsers can't handle some metric, say so. If a coverage gap exists, name it. Honest limits build trust.
3. Be DOMAIN-ADAPTIVE. Do NOT default to generic axes (financial / timeline / actors / etc). Propose axes appropriate to THIS topic — for cognitive performance optimization, propose axes like "Cognitive Domains", "Measurement Instruments", "Bell-Curve Dose-Response", "Statistical Techniques". For sleep optimization, propose "Circadian Phase", "Sleep Architecture", "Daytime Cognitive Consequences".
4. Be GROUNDED. When papers are uploaded, the research_plan section MUST reference each paper by ingested_file_id and describe what it covers. Coverage gaps name what's missing.
5. The MODE controls audience tone:
   - consumer: hide methodology disclosure jargon; prefer plain language
   - clinician: show evidence-tier expectations + recommendation criteria
   - researcher: full disclosure — parser versions, trust boundary, prior selection, dose-response model defaults

Layer ontology guidance:
- Prefer a starter ontology when the topic CLEARLY matches one of the provided starters by domain_tags. When matched, set ontology_source="starter" and reference the starter slug in source_metadata.starter_slug.
- When NO starter matches well, set ontology_source="research_agent" and propose your own custom ontology — but use 4-7 layers with clear ordering (most fundamental → most emergent), each with a distinct conceptual scope and a "why_included" justification.
- NEVER default to the legacy 4-value enum (internal/conceptual/external/bridge). The whole point of this is per-topic adaptive layering.

Axis proposals guidance:
- Propose 5-9 axes appropriate to the topic.
- Each axis must be DIFFERENT from a layer — axes are LENSES through which the topic gets analyzed; layers are HIERARCHICAL CATEGORIES of nodes.
- Each axis defines target_cells using the proposed ontology's layer slugs (NOT the legacy enum).
- Avoid generic catalog axes (financial, timeline, actors, causal_scenarios, evidence, assumptions, risk, cultural). Propose topic-specific axes.

Output: respond with a single JSON object matching the PlanGeneratorOutput schema. No prose around it. No markdown code fences. Just JSON.`;

// ── Main generator ───────────────────────────────────────────────

export async function generatePlan(
  input: PlanGeneratorRunInput,
): Promise<PlanGeneratorOutput> {
  const userPrompt = buildUserPrompt(input);

  // Single comprehensive call. The schema validator guards against
  // missing fields; soft-fail returns a minimal viable plan rather
  // than throwing so the API route can still surface SOMETHING for
  // the user to react to.
  const plan = await llmJSON<PlanGeneratorOutput>({
    system: PLAN_GENERATOR_SYSTEM,
    user: userPrompt,
    model: MODEL_DEFAULTS.anthropic.reasoning,
    maxTokens: 12000,
    temperature: 0.35,
    validator: validatePlan,
    fallback: minimalFallbackPlan(input),
  });

  // Post-processing: when the LLM said "research_agent" but didn't
  // actually populate layers (or populated weakly), call the
  // research-agent helper to deep-research and replace.
  if (
    plan.layer_ontology_proposal.ontology_source === "research_agent" &&
    needsResearchAgent(plan.layer_ontology_proposal)
  ) {
    try {
      const researched = await generateOntologyViaResearch({
        prompt: input.prompt,
        scope_summary: plan.scope_and_objectives.goal_parsed.primary_objective,
        domain_classification:
          plan.scope_and_objectives.goal_parsed.domain_classification.label,
        papers: input.papers,
      });
      plan.layer_ontology_proposal = researched;
    } catch (err) {
      // Research agent soft-fail: keep the LLM-proposed ontology + flag
      // it as low-confidence. The user can re-run if unhappy.
      console.warn("[plan-generator] research-agent ontology failed:", err);
      plan.limitations.planner_uncertainties.push(
        "Research-agent ontology generation soft-failed; falling back to single-call planner output. Re-run planning to retry.",
      );
    }
  }

  return plan;
}

// ── User prompt builder ──────────────────────────────────────────

function buildUserPrompt(input: PlanGeneratorRunInput): string {
  const sections: string[] = [];

  sections.push(`# User prompt\n${input.prompt}`);

  sections.push(`# Mode\n${input.mode}`);

  if (input.papers.length > 0) {
    sections.push(
      `# Uploaded papers (${input.papers.length})\n` +
        input.papers
          .map(
            (p, i) =>
              `## Paper ${i + 1} — ${p.title}\nfile_id: ${p.ingested_file_id}\nasset_class: ${p.asset_class}\nexcerpt:\n${p.excerpt.slice(0, 3000)}`,
          )
          .join("\n\n"),
    );
  } else {
    sections.push(
      `# Uploaded papers\n(none — research_plan should be empty + flag this in limitations)`,
    );
  }

  if (input.starter_ontologies.length > 0) {
    sections.push(
      `# Available starter ontologies (prefer when topic clearly matches by domain_tags)\n` +
        input.starter_ontologies
          .map(
            (o) =>
              `- slug: ${o.slug}\n  label: ${o.label}\n  domain_tags: ${o.domain_tags.join(", ")}\n  description: ${o.description}\n  layer_count: ${o.layers.layers.length}`,
          )
          .join("\n"),
    );
  }

  if (input.existing_reasoning_settings) {
    sections.push(
      `# Existing reasoning_settings (use as defaults; propose overrides per the plan)\n` +
        JSON.stringify(input.existing_reasoning_settings, null, 2),
    );
  }

  sections.push(
    `# Output\nRespond with a single JSON object matching the PlanGeneratorOutput schema. No prose, no markdown fences.`,
  );

  return sections.join("\n\n");
}

// ── Validation ───────────────────────────────────────────────────

function validatePlan(data: unknown): PlanGeneratorOutput {
  if (!data || typeof data !== "object") {
    throw new Error("plan generator: response is not an object");
  }
  const d = data as Record<string, unknown>;

  // Spot-check critical fields. Full schema validation is too
  // brittle for v1; we trust the LLM with a strong prompt + soft-
  // checking. Missing fields fall back to safe defaults.
  if (!d.scope_and_objectives) {
    throw new Error("plan generator: missing scope_and_objectives");
  }
  if (!d.layer_ontology_proposal) {
    throw new Error("plan generator: missing layer_ontology_proposal");
  }
  if (!d.axis_proposals) {
    throw new Error("plan generator: missing axis_proposals");
  }

  // Coerce arrays/objects that the LLM might have returned as strings
  // or omitted entirely.
  const out = data as PlanGeneratorOutput;
  out.research_plan = out.research_plan ?? {
    papers: [],
    coverage_gaps: [],
    extraction_order_rationale: "",
  };
  out.limitations = out.limitations ?? {
    known_weak_parsers: [],
    coverage_gaps_acknowledged: [],
    what_wont_be_extractable: [],
    planner_uncertainties: [],
    downstream_stage_caveats: {},
  };
  out.methodology_disclosure = out.methodology_disclosure ?? {
    active_parsers: [
      {
        module: "cohens_d_with_ci_v1",
        version: "1.0",
        handles_metrics: ["cohens_d", "hedges_g", "smd"],
        known_limits: [
          "OR/RR/beta/raw-means not currently parsed numerically",
        ],
      },
    ],
    trust_boundary_explanation:
      "LLMs label spans (semantic judgment); deterministic parsers extract numbers. Each evidence row carries both halves separately.",
    prior_selection_strategy: { default_tier: "robust_map", per_node_overrides: [] },
    dose_response_defaults: {},
    heterogeneity_handling: {
      layers_active: ["statistical_pooling"],
      pooling_method: "random_effects_reml",
      tau_squared_estimator: "REML",
    },
    consensus_profile_selection: {
      profiles_used: ["default"],
      disagreement_handling: "surface_in_card",
    },
  };
  out.conceptual_skeleton = out.conceptual_skeleton ?? {
    anticipated_clusters: [],
    estimated_total_nodes: 0,
    estimated_total_edges: 0,
    estimated_cycles: 0,
    estimated_communities: 0,
  };
  out.cost_estimate = out.cost_estimate ?? {
    tokens_estimate: 0,
    wall_clock_seconds_estimate: 0,
    credits_estimate: 0,
    parallelizable_stages: [],
    expensive_stages_flagged: [],
  };
  out.reasoning_settings_proposed = out.reasoning_settings_proposed ?? {};
  out.planner_confidence =
    typeof out.planner_confidence === "number" ? out.planner_confidence : 0.6;

  return out;
}

// ── Helpers ──────────────────────────────────────────────────────

function needsResearchAgent(prop: KgPlanLayerOntologyProposal): boolean {
  // Research-agent should run when the LLM declared research_agent
  // source but didn't actually populate substantive layers, OR when
  // it populated <3 layers (likely incomplete).
  if (prop.layers.length < 3) return true;
  // Heuristic: if no layer has a "why_included" rationale, the
  // single-call planner gave a thin proposal — research it properly.
  const hasRationale = prop.layers.every(
    (l) => typeof l.why_included === "string" && l.why_included.length > 20,
  );
  if (!hasRationale) return true;
  return false;
}

function minimalFallbackPlan(
  input: PlanGeneratorRunInput,
): PlanGeneratorOutput {
  // Returned when the LLM call hard-fails. The API route will mark
  // the plan as draft + planner_confidence very low; the user sees
  // a minimal stub they can edit + approve manually.
  return {
    scope_and_objectives: {
      goal_verbatim: input.prompt,
      goal_parsed: {
        primary_objective: input.prompt.slice(0, 200),
        target_outcomes: [],
        constraints: [],
        domain_classification: {
          label: "general",
          confidence: 0.1,
          alternatives: [],
        },
      },
      success_criteria: [],
    },
    layer_ontology_proposal: {
      layers: [],
      ontology_source: "user_authored",
      source_metadata: {},
    },
    axis_proposals: { axes: [], axis_source: "plan_generated" },
    conceptual_skeleton: {
      anticipated_clusters: [],
      estimated_total_nodes: 0,
      estimated_total_edges: 0,
      estimated_cycles: 0,
      estimated_communities: 0,
    },
    research_plan: {
      papers: [],
      coverage_gaps: [],
      extraction_order_rationale: "",
    },
    methodology_disclosure: {
      active_parsers: [],
      trust_boundary_explanation: "",
      prior_selection_strategy: { default_tier: "uniform", per_node_overrides: [] },
      dose_response_defaults: {},
      heterogeneity_handling: {
        layers_active: [],
        pooling_method: "",
        tau_squared_estimator: "",
      },
      consensus_profile_selection: {
        profiles_used: [],
        disagreement_handling: "",
      },
    },
    limitations: {
      known_weak_parsers: [],
      coverage_gaps_acknowledged: [],
      what_wont_be_extractable: [],
      planner_uncertainties: [
        "Plan generator soft-failed; user must hand-author this plan or re-run.",
      ],
      downstream_stage_caveats: {},
    },
    reasoning_settings_proposed: {},
    cost_estimate: {
      tokens_estimate: 0,
      wall_clock_seconds_estimate: 0,
      credits_estimate: 0,
      parallelizable_stages: [],
      expensive_stages_flagged: [],
    },
    planner_confidence: 0.05,
  };
}

// ── Convenience: assemble plan body for API route ───────────────

/** Type alias re-exported for the API route's persistence step. */
export type KgGenerationPlanBody = Omit<
  KgGenerationPlan,
  | "id"
  | "space_id"
  | "user_id"
  | "version"
  | "supersedes_id"
  | "status"
  | "approved_at"
  | "approved_by"
  | "rejected_at"
  | "rejection_reason"
  | "situation_frame_draft"
  | "resolved_situation_frame"
  | "created_at"
  | "updated_at"
  | "proposed_at"
> & {
  mode: KgPlanMode;
};
