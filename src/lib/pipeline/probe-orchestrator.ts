// Probe rabbit-hole orchestrator (2026-07-04, Phase B follow-up).
//
// Single LLM call that decomposes a user-provided question targeting a
// specific entity into 2-4 evidence-seeking sub-questions, returning a
// trail tree the canvas can render via probe-trail-shape.
//
// This is INTENTIONALLY narrow scope — MVP. Wiring research-deep into
// each branch is the next iteration; today the trail visualizes the
// agent's plan, not its execution. The user clicks any sub-question
// node to trigger a research run on it (handled by the shape's
// click handlers, not this library).
//
// Contract: never throws. Soft-fails to a fallback trail with one
// "couldn't decompose" sub-question so the canvas always has something
// to render — silent failure on a probe is worse than a quiet error.

import { llmJSON } from "@/lib/llm";
import { randomUUID } from "crypto";

export type ProbeTrailNodeKind =
  | "probe-origin"
  | "decompose-step"
  | "search-step"
  | "result-terminal";

export type ProbeTrailNodeStatus =
  | "idle"
  | "working"
  | "complete"
  | "result"
  | "error";

export interface ProbeTrailNode {
  /** Stable id within the trail. Not a UUID — short slugs OK. */
  id: string;
  parent_id: string | null;
  kind: ProbeTrailNodeKind;
  /** 1-line label rendered under the node. */
  label: string;
  /** Full question text when kind="search-step". Used for downstream
   *  research-deep kickoff if the user clicks the node. */
  question: string | null;
  /** Search-friendly hint (5-10 words) for the literature query. */
  search_hint: string | null;
  /** Phase 2 temporal axis classification (matches research-questions
   *  endpoint). Drives downstream prompt routing if the user expands
   *  this branch into a real research run. */
  temporal_dimension: string | null;
  status: ProbeTrailNodeStatus;
  /** Layout offset relative to the trail's anchor point. The shape
   *  uses these to position TrailNode primitives in its coordinate
   *  system. */
  dx: number;
  dy: number;
}

export interface ProbeTrailEdge {
  from: string; // node id
  to: string;   // node id
  status: "complete" | "working";
}

export interface ProbeTrail {
  id: string;
  source_entity_id: string;
  source_entity_name: string;
  root_question: string;
  nodes: ProbeTrailNode[];
  edges: ProbeTrailEdge[];
  created_at: string;
  /** True when the LLM call returned the canonical 2-4 sub-questions.
   *  False when fallback path fired (LLM error / parse failure). */
  llm_succeeded: boolean;
}

interface LlmOut {
  sub_questions?: Array<{
    question?: string;
    label?: string;
    search_hint?: string;
    temporal_dimension?: string;
  }>;
}

const SYSTEM_PROMPT = `You are decomposing a user's question about ONE specific entity in a knowledge graph into 2-4 evidence-seeking sub-questions. Each sub-question should be answerable by literature, data, or empirical investigation — not by armchair reasoning.

Return strict JSON:
{
  "sub_questions": [
    {
      "question": "1 specific question — falsifiable, scoped, ends with '?'",
      "label": "1-3 word noun phrase to render under the trail node (e.g., 'Dose-response', 'Walker 2017')",
      "search_hint": "1 short phrase suitable for a literature search (5-10 words)",
      "temporal_dimension": "magnitude" | "onset" | "peak" | "persistence" | "dose_time" | "heterogeneity" | "mechanism" | "none"
    }
  ]
}

Rules:
  - 2 to 4 sub-questions. Diverse in angle (mechanism, evidence, alternative explanations, scale, contradictions, timing).
  - Prioritize sub-questions whose answer would resolve a current uncertainty.
  - Avoid generic questions ("what is X?"). Be specific to THIS entity and THIS root question.
  - "label" is what shows on the canvas under each trail node — keep it short and concrete (a paper name, a mechanism name, a test name, NOT the full question).
  - "temporal_dimension" classifies which evidence axis the sub-question targets.`;

function fallbackTrail(opts: {
  source_entity_id: string;
  source_entity_name: string;
  root_question: string;
  reason: string;
}): ProbeTrail {
  const id = `pt_${shortId()}`;
  const probeId = "n_origin";
  const decId = "n_decompose";
  const fallbackId = "n_unknown";
  const resultId = "n_result";

  return {
    id,
    source_entity_id: opts.source_entity_id,
    source_entity_name: opts.source_entity_name,
    root_question: opts.root_question,
    nodes: [
      {
        id: probeId,
        parent_id: null,
        kind: "probe-origin",
        label: "Probe",
        question: opts.root_question,
        search_hint: null,
        temporal_dimension: null,
        status: "complete",
        dx: 60,
        dy: 0,
      },
      {
        id: decId,
        parent_id: probeId,
        kind: "decompose-step",
        label: "Decompose failed",
        question: null,
        search_hint: null,
        temporal_dimension: null,
        status: "error",
        dx: 200,
        dy: 0,
      },
      {
        id: fallbackId,
        parent_id: decId,
        kind: "search-step",
        label: opts.reason.slice(0, 28),
        question: opts.root_question,
        search_hint: null,
        temporal_dimension: "none",
        status: "idle",
        dx: 340,
        dy: 0,
      },
      {
        id: resultId,
        parent_id: fallbackId,
        kind: "result-terminal",
        label: "—",
        question: null,
        search_hint: null,
        temporal_dimension: null,
        status: "idle",
        dx: 480,
        dy: 0,
      },
    ],
    edges: [
      { from: probeId, to: decId, status: "complete" },
      { from: decId, to: fallbackId, status: "complete" },
      { from: fallbackId, to: resultId, status: "complete" },
    ],
    created_at: new Date().toISOString(),
    llm_succeeded: false,
  };
}

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

/**
 * Generate a probe trail. Single LLM call; non-throwing.
 */
export async function generateProbeTrail(opts: {
  source_entity_id: string;
  source_entity_name: string;
  source_entity_description?: string | null;
  source_entity_layer?: string | null;
  root_question: string;
  /** Existing neighborhood relationship strings, for context. Optional. */
  observed_relationships?: string[];
  /** Already-known open questions to avoid duplicating, optional. */
  existing_open_questions?: string[];
}): Promise<ProbeTrail> {
  let raw: LlmOut;
  try {
    const context = {
      target: {
        id: opts.source_entity_id,
        name: opts.source_entity_name,
        description: opts.source_entity_description ?? null,
        layer: opts.source_entity_layer ?? null,
      },
      root_question: opts.root_question,
      observed_relationships: opts.observed_relationships ?? [],
      existing_open_questions: opts.existing_open_questions ?? [],
    };
    raw = await llmJSON<LlmOut>({
      system: SYSTEM_PROMPT,
      user: `Decompose this question into 2-4 sub-questions:\n\n${JSON.stringify(context, null, 2)}`,
      maxTokens: 1500,
      temperature: 0.4,
    });
  } catch (err) {
    return fallbackTrail({
      source_entity_id: opts.source_entity_id,
      source_entity_name: opts.source_entity_name,
      root_question: opts.root_question,
      reason: err instanceof Error ? err.message : "LLM failed",
    });
  }

  const subs = Array.isArray(raw?.sub_questions) ? raw.sub_questions : [];
  if (subs.length === 0) {
    return fallbackTrail({
      source_entity_id: opts.source_entity_id,
      source_entity_name: opts.source_entity_name,
      root_question: opts.root_question,
      reason: "No sub-questions",
    });
  }

  // Build the trail tree. Layout:
  //   • Probe origin at dx=60, dy=0
  //   • Decompose step at dx=200, dy=0
  //   • Sub-questions fan out at dx=340, dy=evenly-spaced
  //   • Result terminal at dx=480, dy=0 (only when more than one sub-q)
  const id = `pt_${shortId()}`;
  const probeId = "n_origin";
  const decId = "n_decompose";
  const resultId = "n_result";

  const subNodes: ProbeTrailNode[] = subs
    .slice(0, 4)
    .map((s, i, arr): ProbeTrailNode | null => {
      const question = typeof s.question === "string" ? s.question.trim() : "";
      const label = typeof s.label === "string" ? s.label.trim() : "";
      if (!question) return null;
      // Vertical fan: 1 sub → dy=0, 2 subs → ±35, 3 → -55,0,55, 4 → -75,-25,25,75
      const count = arr.length;
      const spacing = 50;
      const baseline = -((count - 1) / 2) * spacing;
      const dy = Math.round(baseline + i * spacing);
      return {
        id: `n_sub_${i}`,
        parent_id: decId,
        kind: "search-step",
        label: label || question.slice(0, 24),
        question,
        search_hint: typeof s.search_hint === "string" ? s.search_hint : null,
        temporal_dimension:
          typeof s.temporal_dimension === "string" ? s.temporal_dimension : "none",
        status: "idle",
        dx: 340,
        dy,
      };
    })
    .filter((n): n is ProbeTrailNode => n !== null);

  const nodes: ProbeTrailNode[] = [
    {
      id: probeId,
      parent_id: null,
      kind: "probe-origin",
      label: "Probe",
      question: opts.root_question,
      search_hint: null,
      temporal_dimension: null,
      status: "complete",
      dx: 60,
      dy: 0,
    },
    {
      id: decId,
      parent_id: probeId,
      kind: "decompose-step",
      label: "Decompose",
      question: null,
      search_hint: null,
      temporal_dimension: null,
      status: "complete",
      dx: 200,
      dy: 0,
    },
    ...subNodes,
    {
      id: resultId,
      parent_id: null,
      kind: "result-terminal",
      label: `${subNodes.length} branch${subNodes.length === 1 ? "" : "es"}`,
      question: null,
      search_hint: null,
      temporal_dimension: null,
      status: "result",
      dx: 480,
      dy: 0,
    },
  ];

  // Edges: probe → decompose → each sub-question → result
  const edges: ProbeTrailEdge[] = [
    { from: probeId, to: decId, status: "complete" },
    ...subNodes.map<ProbeTrailEdge>((sn) => ({
      from: decId,
      to: sn.id,
      status: "complete",
    })),
    ...subNodes.map<ProbeTrailEdge>((sn) => ({
      from: sn.id,
      to: resultId,
      status: "complete",
    })),
  ];

  return {
    id,
    source_entity_id: opts.source_entity_id,
    source_entity_name: opts.source_entity_name,
    root_question: opts.root_question,
    nodes,
    edges,
    created_at: new Date().toISOString(),
    llm_succeeded: true,
  };
}
