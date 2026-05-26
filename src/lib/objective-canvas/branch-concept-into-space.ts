// ── Branch Canonical Concept Into Space ────────────────────────────
//
// Bridges a cross-space canonical concept into the user's current
// space by generating a new sub-objective seeded by the concept's
// known structure + prior usage. The LLM's job is small but
// specific: take what the concept IS (display_name + description +
// where it's been used) and frame it as a sub-objective the user
// could fork in the CURRENT space, with the CURRENT objective's
// context.
//
// One LLM call. Output is the same shape as a regular sub-objective
// proposal (title + summary + rationale) so the existing
// /sub-objectives/add route can insert it via the same path.
//
// Why an LLM call vs. just copying the concept name verbatim:
//   • The concept might be domain-shifted from prior spaces. A
//     concept like "Cortisol Stress Loop" used in a health space
//     needs to be reframed when branched into a productivity space.
//   • The summary should reference both the cross-space history AND
//     the current objective's specifics so the new card is
//     immediately useful, not generic.

import { llmJSON } from "@/lib/llm";

export interface ConceptForBranching {
  /** canonical_concepts.display_name. */
  display_name: string;
  /** canonical_concepts.description. */
  description: string | null;
  /** Cross-space evidence — how many of the user's prior spaces
   *  touched this concept. Surfaced in the bridge prompt so the
   *  LLM can write a more grounded rationale. */
  space_count: number;
  /** Optional — short blurbs from the user's prior entities linked
   *  to this concept (entity names + space names). Helps the LLM
   *  write something specific about HOW the user has used the
   *  concept before. Caller passes up to ~6. */
  prior_usages?: Array<{ entity_name: string; space_name: string }>;
  /** Optional domain tags from the canonical row. Surfaces as a
   *  faint hint about the concept's home domain. */
  domain_tags?: string[];
}

export interface BranchConceptContext {
  concept: ConceptForBranching;
  /** The current space's objective text — the LLM bridges the
   *  concept into THIS context. */
  currentObjectiveText: string;
}

export interface BranchedSubObjectiveProposal {
  /** ≤6 words, noun phrase. References the concept's display_name
   *  but adapted to the current objective's domain when appropriate. */
  title: string;
  /** 1 sentence describing what the new sub-objective IS in the
   *  context of the current space. */
  summary: string;
  /** 1 sentence on WHY this sub-objective is load-bearing for the
   *  current objective, referencing the cross-space history. */
  rationale: string;
}

const SYSTEM_PROMPT = `You bridge a CANONICAL CONCEPT (from the user's cross-space knowledge graph) into a NEW sub-objective for their CURRENT space.

The user has already worked with this concept in other spaces. They want to bring it into the current objective's context — not as a copy-paste of the concept's name, but as a NEW sub-objective adapted to THIS space's domain.

OUTPUT:

1) TITLE — noun phrase, ≤6 words. Reference the concept's name when natural, but adapt to the current domain. Examples:
     • Concept "Attention Residue" in a productivity-app objective → "Attention residue surface" or "Task-switching residue"
     • Concept "Cortisol Stress Loop" in a project-management objective → "Stress feedback loop" (drop the bio-specific framing)
     • If the concept's name already fits the domain, reuse it verbatim — that's the strongest cross-KG link.

2) SUMMARY — 1 sentence describing what this sub-objective IS as a state of the current space's world. Not what you'll DO; what will be TRUE when the sub-objective is delivered.

3) RATIONALE — 1 sentence on WHY this is load-bearing for the current objective. When the concept has been used in multiple prior spaces, reference that cross-space history briefly (e.g., "your prior work on X in N spaces has framed this as central").

ANTI-PLATITUDE:
- Don't write "Apply concept X" — that's instruction, not a sub-objective.
- Don't ignore the current objective — the bridge MUST reference the user's domain.
- Don't be coy about the cross-space history when it exists — name the count, surface the carry-over.

Return strict JSON.`;

function buildUserPrompt(ctx: BranchConceptContext): string {
  const c = ctx.concept;
  const lines: string[] = [
    "CANONICAL CONCEPT TO BRANCH:",
    `  Name: ${c.display_name}`,
  ];
  if (c.description) {
    lines.push(`  Description: ${c.description.slice(0, 280)}`);
  }
  if (c.domain_tags && c.domain_tags.length > 0) {
    lines.push(`  Home domain tags: ${c.domain_tags.slice(0, 4).join(", ")}`);
  }
  lines.push(`  Cross-space evidence: used in ${c.space_count} of your prior spaces`);
  if (c.prior_usages && c.prior_usages.length > 0) {
    lines.push("  Prior usages (sample):");
    for (const u of c.prior_usages.slice(0, 5)) {
      lines.push(`    • "${u.entity_name}" in space "${u.space_name}"`);
    }
  }

  return `${lines.join("\n")}

CURRENT SPACE OBJECTIVE:
"""
${ctx.currentObjectiveText.slice(0, 1200)}
"""

Bridge the concept into a single sub-objective for the current objective per the system instructions.`;
}

export async function branchConceptIntoSpace(
  ctx: BranchConceptContext,
): Promise<BranchedSubObjectiveProposal> {
  const raw = await llmJSON<{
    title?: unknown;
    summary?: unknown;
    rationale?: unknown;
  }>({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(ctx),
    responseSchema: {
      name: "branch_concept_into_space",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["title", "summary", "rationale"],
      },
    },
    temperature: 0.45,
    maxTokens: 600,
  });

  function s(raw: unknown, max: number): string {
    return typeof raw === "string" ? raw.trim().slice(0, max) : "";
  }

  // Verb-prefix safety net — same rule as the main decompose path so
  // the new sub-objective doesn't break the noun-phrase convention.
  const verbPrefix =
    /^(develop|implement|create|design|build|enhance|establish|drive|deliver|provide|enable|generate|produce|conduct)\s+(a\s+|the\s+)?/i;
  let title = s(raw?.title, 80);
  const stripped = title.replace(verbPrefix, "").trim();
  if (stripped.length > 0 && stripped !== title) {
    title = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  }

  return {
    title,
    summary: s(raw?.summary, 240),
    rationale: s(raw?.rationale, 280),
  };
}
