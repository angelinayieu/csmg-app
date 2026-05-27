// ── HCD Persona Generator (Phase 11.8) ────────────────────────────
//
// When `hcd_mode=true` on a space, scoring runs need a stable set
// of personas to evaluate variations from multiple user perspectives.
// This module produces 3-5 personas per sub-objective room, anchored
// in the room's pain entities + clarifying-answers context.
//
// Why stable (not regenerated per scoring run):
//   The persona axis of the rubric is meaningless if the personas
//   themselves shift between scoring runs — variation A and B can't
//   be compared if they were scored against different personas.
//   Personas are generated ONCE per sub-objective when scoring first
//   fires with hcd_mode=true; subsequent runs reuse them.
//
// Persistence: improvement_goals.synthesis_data.hcd_personas (JSONB
// slice, no new column). Caller decides when to regenerate (user can
// hit a "Regenerate personas" button to force refresh).
//
// Why this matters for the user's vision:
//   The user explicitly said HCD should mean "thinking in the
//   perspective of multiple users, feelings, etc. — need more
//   sophisticated prompting for if HCD on." This module IS that
//   sophisticated prompting — instead of a generic HCD bias mixin
//   on variation generation (Phase 11), HCD on scoring means each
//   variation gets evaluated as if by 3-5 actual people with
//   different roles, contexts, goals, pains, and values.

import { llmJSON } from "@/lib/llm";

export interface HCDPersona {
  /** Stable id — derived from name hash at generation time. */
  id: string;
  /** Display name like "Sarah, mid-career manager" or "Diego, dad of two." */
  name: string;
  /** One-line role/identity descriptor. */
  role: string;
  /** 1-2 sentence context — life situation, constraints, environment. */
  context: string;
  /** 2-3 personal goals THIS persona is pursuing (NOT the project's
   *  goals — this is what's in their head when they encounter the
   *  variation). */
  goals: string[];
  /** 2-3 pains specific to THIS persona. Distinct from the room's
   *  pain entities (which are the project-level frictions); these
   *  are the persona's own struggles. */
  pains: string[];
  /** 2-3 values this persona prioritizes (e.g., "predictability,"
   *  "social connection," "efficiency"). Drives the scoring axis. */
  values: string[];
  /** Accessibility considerations — limited time, motor constraint,
   *  language, low-vision, etc. Empty when not applicable. */
  accessibility_needs?: string;
  /** ISO timestamp — when this persona was generated. */
  generated_at: string;
}

export interface PersonaGenerationContext {
  /** Sub-objective title — anchors persona selection. */
  sub_objective_title: string;
  /** Parent objective text — broader context. */
  core_objective_text: string;
  /** Room's pain entities — informs WHAT problems personas face. */
  room_pains: Array<{ name: string; negative_outcome?: string }>;
  /** User's clarifying answers when available — informs WHO the
   *  audience actually is per the user's domain framing. */
  clarifying_answers?: Array<{ question: string; answer: string }>;
}

const SYSTEM_PROMPT = `You are an HCD persona designer. Given an objective + its pain entities + any clarifying answers, generate 3-5 distinct user personas that span the realistic audience for this objective.

Each persona must be:
  - SPECIFIC: name, role, life-situation context. Not "User A" — "Sarah, 38, mid-career manager."
  - DIFFERENT FROM EACH OTHER: pick personas that DISAGREE in how they'd evaluate solutions. If two personas would rate everything the same way, drop one and pick a third with a different value system.
  - GROUNDED IN THE PAINS: each persona's pains[] should reflect AT LEAST ONE of the room's pain entities, but in this persona's own language and context.
  - VALUE-DIVERSE: personas should prioritize DIFFERENT things (one values predictability, one values novelty; one prioritizes efficiency, one prioritizes connection). Value variance is the entire point.

For EACH persona return:
  - name: "FirstName, age, role" format
  - role: one-line identity
  - context: 1-2 sentences — life situation, environmental constraints
  - goals: 2-3 personal goals (THEIR goals, not the project's)
  - pains: 2-3 friction points in their daily life relevant to the room
  - values: 2-3 things they prioritize (verbs or short phrases)
  - accessibility_needs: only when genuinely relevant (motor limits, time poverty, language, low-vision, etc.); empty string otherwise

Generate 3-5 personas (3 minimum, 5 maximum). If the audience is genuinely narrow, return 3. If the objective spans multiple stakeholder types, return 5. NEVER return identical personas with cosmetic name changes — diversity of perspective is the asset.

Return JSON matching the schema. No prose outside.`;

function buildUserPrompt(ctx: PersonaGenerationContext): string {
  const painsBlock = ctx.room_pains.length > 0
    ? ctx.room_pains
        .slice(0, 6)
        .map(
          (p) =>
            `  • ${p.name}${p.negative_outcome ? ` — ${p.negative_outcome}` : ""}`,
        )
        .join("\n")
    : "  [No pain entities provided.]";

  const clarifyingBlock = ctx.clarifying_answers && ctx.clarifying_answers.length > 0
    ? ctx.clarifying_answers
        .slice(0, 8)
        .map((qa) => `  Q: ${qa.question}\n  A: ${qa.answer}`)
        .join("\n")
    : "  [No clarifying answers — generate personas from objective + pains alone.]";

  return `PARENT OBJECTIVE:
"""
${ctx.core_objective_text.slice(0, 1000)}
"""

SUB-OBJECTIVE (room scope — the specific cut of the objective these personas will evaluate):
"""
${ctx.sub_objective_title}
"""

ROOM PAINS (the frictions personas will be evaluating solutions against):
${painsBlock}

CLARIFYING ANSWERS (user's framing of who/what — anchor persona selection here):
${clarifyingBlock}

Generate 3-5 distinct personas. Maximize value-system diversity across them.`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    personas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          context: { type: "string" },
          goals: { type: "array", items: { type: "string" } },
          pains: { type: "array", items: { type: "string" } },
          values: { type: "array", items: { type: "string" } },
          accessibility_needs: { type: "string" },
        },
        required: [
          "name",
          "role",
          "context",
          "goals",
          "pains",
          "values",
          "accessibility_needs",
        ],
      },
    },
  },
  required: ["personas"],
} as const;

/** Generate 3-5 HCD personas for one sub-objective room. Soft-fails
 *  on LLM errors by returning an empty array — callers should treat
 *  empty as "scoring without persona stratification" rather than
 *  blocking. */
export async function generateHCDPersonas(
  ctx: PersonaGenerationContext,
): Promise<HCDPersona[]> {
  const now = new Date().toISOString();
  let raw: {
    personas?: Array<{
      name?: unknown;
      role?: unknown;
      context?: unknown;
      goals?: unknown;
      pains?: unknown;
      values?: unknown;
      accessibility_needs?: unknown;
    }>;
  };
  try {
    raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(ctx),
      responseSchema: { name: "hcd_personas", schema: RESPONSE_SCHEMA },
      temperature: 0.6,
      maxTokens: 2400,
    });
  } catch (err) {
    console.warn(
      "[generate-personas] LLM failed (returning empty set):",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }

  const personas: HCDPersona[] = [];
  for (const p of raw?.personas ?? []) {
    const name = typeof p?.name === "string" ? p.name.trim().slice(0, 100) : "";
    if (name.length === 0) continue;
    const role = typeof p?.role === "string" ? p.role.trim().slice(0, 120) : "";
    const context =
      typeof p?.context === "string" ? p.context.trim().slice(0, 300) : "";
    const goals = Array.isArray(p?.goals)
      ? (p.goals as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .slice(0, 4)
          .map((s) => s.trim().slice(0, 160))
      : [];
    const pains = Array.isArray(p?.pains)
      ? (p.pains as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .slice(0, 4)
          .map((s) => s.trim().slice(0, 160))
      : [];
    const values = Array.isArray(p?.values)
      ? (p.values as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .slice(0, 4)
          .map((s) => s.trim().slice(0, 80))
      : [];
    const accessibility_needs =
      typeof p?.accessibility_needs === "string" &&
      p.accessibility_needs.trim().length > 0
        ? p.accessibility_needs.trim().slice(0, 200)
        : undefined;
    // Stable id from name — sha-1ish via simple hash so the same
    // generated persona name always produces the same id (re-runs
    // can match against prior persona ids when names overlap).
    const id = `persona_${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 32)}`;
    personas.push({
      id,
      name,
      role,
      context,
      goals,
      pains,
      values,
      accessibility_needs,
      generated_at: now,
    });
    if (personas.length >= 5) break;
  }
  return personas;
}
