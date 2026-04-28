// ── Ontology Research Agent ──────────────────────────────────────
//
// Generates a custom per-space layer ontology when no starter
// matches the user's topic. Called by plan-generator.ts when the
// initial planner-pass declared ontology_source="research_agent"
// but didn't populate substantive layers.
//
// For v1: a focused second LLM call with a strong system prompt
// that demands rigorous, well-justified, hierarchically-ordered
// layers grounded in the topic's literature. Each layer carries a
// "why_included" rationale + the layer's typical_node_kinds.
//
// For v2: integrate with src/lib/pipeline/deep-research-engine.ts
// for actual literature search before proposing layers — so the
// research_trace.sources_consulted carries real citations rather
// than the LLM's training-data recall.
//
// The trust boundary is preserved at the ontology level: the LLM
// proposes structure; downstream consumers (entity extraction,
// per-edge response models, evidence pooling) honor that structure
// with their own deterministic / parser machinery.

import { llmJSON, MODEL_DEFAULTS } from "@/lib/llm";
import type {
  KgPlanLayerOntologyProposal,
} from "@/types/kg-generation-plan";
import type { PlanGeneratorPaper } from "./plan-generator";

// ── Inputs ────────────────────────────────────────────────────────

export interface OntologyResearchInput {
  prompt: string;
  scope_summary: string;
  domain_classification: string;
  papers: PlanGeneratorPaper[];
}

// ── System prompt ────────────────────────────────────────────────

const ONTOLOGY_RESEARCH_SYSTEM = `You are the Ontology Research Agent for InterAxis Laboratory. Your single job: propose a per-space layer ontology for a knowledge graph that will be used to model + simulate the user's topic.

A layer ontology is an ORDERED HIERARCHY of conceptual layers, most fundamental → most emergent. Examples:
- Mind-body cognition: Molecular → Circuit → Cognitive → Behavioral → Performance
- Sleep optimization: Circadian → Autonomic → Cognitive → Behavioral
- Nutrition: Biochemistry → Physiology → Behavior → Outcome
- Materials science: Atomic → Crystal → Microstructure → Property → Performance
- Org performance: Individual → Team → Workflow → Org → Outcome

Required properties for a good ontology:
1. ORDERED — lower ordinals are more fundamental / upstream; higher ordinals are more emergent / downstream / outcome-side.
2. DISTINCT — each layer covers a clearly different conceptual scope. No two layers should overlap meaningfully.
3. WELL-JUSTIFIED — each layer carries a "why_included" explaining what KIND of node would live there, with examples.
4. APPROPRIATE GRANULARITY — usually 4-7 layers. Fewer = too coarse (downstream filtering useless). More = too fine (cognitively overwhelming).
5. GROUNDED IN THE TOPIC — layers reflect how researchers in this domain actually decompose the problem. Not abstract philosophy.
6. NODE-KIND APPROPRIATE — typical_node_kinds for each layer drives the +Variable button's contextual picker downstream. Use kinds like: outcome, mediator, modifier, intervention_kernel, condition, instrument, composite.

Process:
1. Read the prompt + scope + domain + paper excerpts.
2. Identify what mechanisms / variables researchers in this domain typically organize their thinking around.
3. Propose 4-7 layers in fundamental → emergent order.
4. For each layer: ordinal, slug (snake_case machine id), label (human title), description, color (distinct hex), typical_node_kinds, example_nodes (4-6 grounded examples), why_included (the rigorous justification).
5. Self-rate planner_confidence 0..1 based on whether you had enough signal (papers + clear domain) vs whether you're guessing.

Output: respond with a single JSON object matching the OntologyResearchOutput schema:
{
  "layers": [
    {"ordinal": 1, "slug": "...", "label": "...", "description": "...",
     "color": "#XXXXXX", "typical_node_kinds": [...],
     "example_nodes": [...], "why_included": "..."},
    ...
  ],
  "research_trace": {
    "sources_consulted": [...],   // paper file_ids + free-text source identifiers you drew on
    "reasoning_summary": "...",    // 2-4 sentences explaining the structural choice
    "planner_confidence": 0.XX
  }
}

No prose around it. No markdown fences. Just JSON.`;

// ── Output shape (LLM schema) ─────────────────────────────────────

interface OntologyResearchOutput {
  layers: Array<{
    ordinal: number;
    slug: string;
    label: string;
    description: string;
    color: string;
    typical_node_kinds: string[];
    example_nodes: string[];
    why_included: string;
  }>;
  research_trace: {
    sources_consulted: string[];
    reasoning_summary: string;
    planner_confidence: number;
  };
}

// ── Main entry ────────────────────────────────────────────────────

export async function generateOntologyViaResearch(
  input: OntologyResearchInput,
): Promise<KgPlanLayerOntologyProposal> {
  const userPrompt = buildOntologyUserPrompt(input);

  const result = await llmJSON<OntologyResearchOutput>({
    system: ONTOLOGY_RESEARCH_SYSTEM,
    user: userPrompt,
    model: MODEL_DEFAULTS.anthropic.reasoning,
    maxTokens: 6000,
    // Lower temperature: ontology design wants consistency, not
    // creativity. Multiple runs on the same topic should converge.
    temperature: 0.2,
    validator: validateOntology,
    fallback: minimalFallbackOntology(),
  });

  // Coerce into KgPlanLayerOntologyProposal shape.
  return {
    layers: result.layers.map((l) => ({
      ordinal: l.ordinal,
      slug: l.slug,
      label: l.label,
      description: l.description,
      color: l.color,
      typical_node_kinds: l.typical_node_kinds,
      example_nodes: l.example_nodes,
      why_included: l.why_included,
    })),
    ontology_source: "research_agent",
    source_metadata: {
      research_trace: {
        agent_model: MODEL_DEFAULTS.anthropic.reasoning,
        sources_consulted: result.research_trace.sources_consulted,
        reasoning_summary: result.research_trace.reasoning_summary,
        planner_confidence: result.research_trace.planner_confidence,
      },
    },
  };
}

// ── User prompt builder ──────────────────────────────────────────

function buildOntologyUserPrompt(input: OntologyResearchInput): string {
  const parts: string[] = [];
  parts.push(`# User prompt\n${input.prompt}`);
  parts.push(`# Scope summary\n${input.scope_summary}`);
  parts.push(`# Domain classification\n${input.domain_classification}`);

  if (input.papers.length > 0) {
    parts.push(
      `# Paper excerpts (${input.papers.length})\n` +
        input.papers
          .map(
            (p, i) =>
              `## Paper ${i + 1} — ${p.title}\nfile_id: ${p.ingested_file_id}\nexcerpt:\n${p.excerpt.slice(0, 2500)}`,
          )
          .join("\n\n"),
    );
  } else {
    parts.push(
      `# Paper excerpts\n(none — propose ontology from prompt + scope + your training-data domain knowledge; flag low planner_confidence accordingly)`,
    );
  }

  parts.push(
    `# Output\nA single JSON object matching OntologyResearchOutput. No prose. No fences.`,
  );

  return parts.join("\n\n");
}

// ── Validation ───────────────────────────────────────────────────

function validateOntology(data: unknown): OntologyResearchOutput {
  if (!data || typeof data !== "object") {
    throw new Error("ontology research: response is not an object");
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.layers) || d.layers.length === 0) {
    throw new Error("ontology research: missing or empty layers array");
  }
  if (d.layers.length < 3 || d.layers.length > 9) {
    // Soft warn — accept but flag in research_trace
    // (validator can't push to trace easily; let downstream surface).
  }
  if (!d.research_trace || typeof d.research_trace !== "object") {
    // Coerce
    d.research_trace = {
      sources_consulted: [],
      reasoning_summary: "",
      planner_confidence: 0.4,
    };
  }
  return d as unknown as OntologyResearchOutput;
}

function minimalFallbackOntology(): OntologyResearchOutput {
  // Returned when the LLM hard-fails. Falls back to general_causal
  // structure so the downstream plan still has SOMETHING coherent.
  return {
    layers: [
      {
        ordinal: 1,
        slug: "cause",
        label: "Cause",
        description: "Root drivers — interventions, exposures, structural conditions.",
        color: "#DC2626",
        typical_node_kinds: ["intervention_kernel", "condition"],
        example_nodes: [],
        why_included:
          "Fallback layer — research-agent generation soft-failed. Re-run planning to get a topic-specific ontology.",
      },
      {
        ordinal: 2,
        slug: "mechanism",
        label: "Mechanism",
        description: "Proximate processes activated by the cause.",
        color: "#7C3AED",
        typical_node_kinds: ["mediator"],
        example_nodes: [],
        why_included: "Fallback layer.",
      },
      {
        ordinal: 3,
        slug: "mediator",
        label: "Mediator",
        description: "Intermediate measurable variables.",
        color: "#0891B2",
        typical_node_kinds: ["mediator", "instrument"],
        example_nodes: [],
        why_included: "Fallback layer.",
      },
      {
        ordinal: 4,
        slug: "outcome",
        label: "Outcome",
        description: "Final variables of interest.",
        color: "#D97706",
        typical_node_kinds: ["outcome"],
        example_nodes: [],
        why_included: "Fallback layer.",
      },
    ],
    research_trace: {
      sources_consulted: [],
      reasoning_summary:
        "Research-agent ontology generation soft-failed; fell back to general 4-layer causal scaffold. User should re-run planning for a topic-specific ontology.",
      planner_confidence: 0.1,
    },
  };
}
