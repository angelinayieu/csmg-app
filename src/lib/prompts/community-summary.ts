// ── Community summary prompts (D8 — docs/KG_DEPTH_CRITIQUE.md §9) ────
//
// Bottom-up rollup prompts for hierarchical community summaries.
// Adapted from Microsoft GraphRAG paper Appendix §E.2 ("Community
// Summary Generation"), with three substantive changes for our domain:
//
//   1. Output focuses on STRATEGIC IMPLICATIONS, not just structural
//      summary — we're a strategy-optimization product, not a
//      sensemaking corpus retrieval system. The findings sections are
//      shaped to surface leverage points, risk points, and
//      intervention opportunities.
//   2. Includes typed-edge reasoning (polarity, dynamics, conditions)
//      since our edges carry causal semantics theirs don't.
//   3. The HIGHER-LEVEL prompt explicitly references SUB-COMMUNITY
//      summaries by their titles + ratings, so level-1 summaries
//      compress level-0 summaries rather than re-summarizing entities
//      directly. This is the bottom-up roll-up pattern (§3.1.5 of the
//      paper) — the scale advantage they document (9-43× token
//      reduction) comes from this recursion.
//
// Two prompts:
//   - LEAF_SYSTEM: used for level-MAX (or any community whose children
//     are empty). Reads entities + edges directly.
//   - ROLLUP_SYSTEM: used for higher-level communities. Reads child
//     community summaries + a small entity sample for grounding.
//
// Both prompts produce the same output schema (defined in the
// migration comment): { title, summary, rating, rating_explanation,
// findings: [{summary, explanation}] }. The ROLLUP version adds a
// "what changes at this level" finding that surfaces emergent
// properties not visible in any single sub-community.

// ── Leaf-level prompt ──

export const COMMUNITY_LEAF_SUMMARY_SYSTEM = `You are summarizing a tightly-connected sub-region of a strategic knowledge graph for downstream consumption by a strategy-optimization engine.

You will receive a list of entities and their relationships within ONE community of the graph. The community was identified by graph-topology clustering — entities here share more edges with each other than with the rest of the graph.

Your job: produce a structured rollup that captures (a) what this community IS, (b) what STRATEGIC IMPLICATIONS it carries, and (c) where the LEVERAGE POINTS within it live. Future stages — strategy synthesis, scenario simulation, twin proposals — will read your summary instead of re-reading raw entities, so the summary must stand on its own.

Output strict JSON:
{
  "title": "<short noun phrase, 4–10 words, names what holds this community together>",
  "summary": "<2–4 sentences describing the community's role in the larger system. Reference specific entities/edges; do NOT make broad generalizations.>",
  "rating": <number 0–10 — strategic importance of this community for the user's goal>,
  "rating_explanation": "<one sentence explaining the rating>",
  "findings": [
    {
      "summary": "<short headline>",
      "explanation": "<one paragraph that names which entities + edges support the finding>"
    }
  ]
}

Findings rules:
- Produce 3–6 findings, ranked by strategic relevance (most important first).
- At least ONE finding must surface a LEVERAGE POINT: an entity within this community where a small intervention would produce outsized effect. Cite which incoming/outgoing edges make it leverage-worthy.
- At least ONE finding must surface a RISK or TENSION: a fragility, contradiction, or tradeoff visible from the edges (look for negative polarity, conditional/threshold dynamics, or trades-off-against relationships).
- Cite entities by their entity_id (e.g., "C5") and edges by source→target. Don't invent entity names.

Rating rubric:
- 9–10: contains the user's master bottleneck or a fundamental cycle gating overall outcomes
- 7–8: contains 2+ leverage points or a critical tradeoff
- 5–6: structurally important but distant from the user's primary goal
- 3–4: peripheral; useful context only
- 0–2: orphan / disconnected / minimal strategic content

Rules:
- Do NOT include information not supported by the entities/edges shown.
- Do NOT speculate beyond what's structurally evident in the input.
- A single bad summary corrupts every higher-level rollup that builds on it. Honesty > comprehensiveness.`;

// ── Roll-up prompt ──

export const COMMUNITY_ROLLUP_SUMMARY_SYSTEM = `You are summarizing a HIGHER-LEVEL region of a strategic knowledge graph by composing the summaries of its sub-communities.

You will receive:
1. A list of CHILD community summaries — each child is a tightly-connected sub-region, already summarized at its own level.
2. A SAMPLE of entities + relationships at this level for grounding (not the full set).

Your job: produce a rollup that captures (a) what these sub-communities have in common, (b) what EMERGES at this scale that wasn't visible inside any single child, and (c) what STRATEGIC IMPLICATIONS the union carries that the child summaries individually don't surface.

This is the GraphRAG pattern (Edge et al. 2024 §3.1.5): higher-level summaries are composed from lower-level summaries, NOT re-summarized from raw entities. The compression is what gives this substrate its scale advantage.

Output strict JSON (same schema as leaf summaries):
{
  "title": "<short noun phrase naming the higher-level region>",
  "summary": "<2–4 sentences describing what unites the child communities and what the larger region IS>",
  "rating": <number 0–10 — strategic importance of this larger region for the user's goal>,
  "rating_explanation": "<one sentence>",
  "findings": [
    {
      "summary": "<headline>",
      "explanation": "<one paragraph; cite child community titles and entity_ids where relevant>"
    }
  ]
}

Findings rules:
- 3–6 findings. The first finding MUST be an EMERGENT property — something true at this level that's not true in any single child community alone (e.g., a tradeoff that only appears when you consider two sub-systems together).
- Other findings can roll up cross-cutting leverage points, conflicts between child communities, or strategic patterns visible only at this scale.
- Reference children by their TITLES (which you'll see in the input). Cite specific entity_ids when you need finer grounding.

Rating compose rule:
- The parent rating should generally be ≥ max(child ratings) when emergent strategic value is present
- Lower than max(child ratings) is rare but valid when the children individually matter more in isolation than together
- Explain the composition logic in rating_explanation

Rules:
- Do NOT re-summarize child content verbatim. The summary lives at a HIGHER level of abstraction.
- Do NOT introduce facts not present in either the child summaries or the sample entities.
- If two child summaries appear to contradict, surface the contradiction as a finding rather than papering over it.`;

// ── Output schema (TS mirror of the JSON the LLM produces) ──

export interface CommunityFinding {
  summary: string;
  explanation: string;
}

export interface CommunitySummary {
  title: string;
  summary: string;
  rating: number;
  rating_explanation: string;
  findings: CommunityFinding[];
}

// ── Validator ──
//
// Lenient — extracts what's there, drops malformed fields rather than
// throwing. Matches the soft-fail pattern in
// src/lib/validation/llm-validators.ts.

export function validateCommunitySummary(data: unknown): CommunitySummary {
  if (typeof data !== "object" || data === null) {
    return emptySummary();
  }
  const obj = data as Record<string, unknown>;

  const findings: CommunityFinding[] = [];
  if (Array.isArray(obj.findings)) {
    for (const f of obj.findings) {
      if (typeof f !== "object" || f === null) continue;
      const fr = f as Record<string, unknown>;
      const s = typeof fr.summary === "string" ? fr.summary.trim() : "";
      const e = typeof fr.explanation === "string" ? fr.explanation.trim() : "";
      if (s.length > 0 && e.length > 0) {
        findings.push({
          summary: s.slice(0, 500),
          explanation: e.slice(0, 4000),
        });
      }
    }
  }

  const ratingRaw = obj.rating;
  let rating = 0;
  if (typeof ratingRaw === "number" && Number.isFinite(ratingRaw)) {
    rating = Math.max(0, Math.min(10, ratingRaw));
  }

  return {
    title:
      typeof obj.title === "string" && obj.title.trim().length > 0
        ? obj.title.trim().slice(0, 200)
        : "Untitled community",
    summary:
      typeof obj.summary === "string" && obj.summary.trim().length > 0
        ? obj.summary.trim().slice(0, 4000)
        : "",
    rating,
    rating_explanation:
      typeof obj.rating_explanation === "string"
        ? obj.rating_explanation.trim().slice(0, 500)
        : "",
    findings,
  };
}

function emptySummary(): CommunitySummary {
  return {
    title: "Untitled community",
    summary: "",
    rating: 0,
    rating_explanation: "",
    findings: [],
  };
}
