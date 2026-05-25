// ── Item Detail Expansion ──────────────────────────────────────────
//
// One LLM call that produces the depth surfaces shown in the item
// detail drawer. The current shallow cards name the item but don't
// say much about what it IS; this fills that gap.
//
// Three artifacts per call:
//
//   definition  — 2-3 sentence plain-language explanation that
//                 references the user's domain. Distinct from the
//                 title (the title NAMES; the definition EXPLAINS).
//
//   variations  — 3-5 alternative implementations of the same item,
//                 each with a tradeoff. Surfaces the design space —
//                 "you could do this 4 different ways."
//
//   planning    — assumes[], depends_on[], risks[] — the soft
//                 strategy layer that turns an idea into something
//                 a user can stress-test.
//
// All cached on entities.expanded_detail; called once on first
// drawer open, then never again unless the user explicitly
// regenerates.

import { llmJSON } from "@/lib/llm";

export interface ItemVariation {
  /** Short name for the variation, 3-6 words. */
  name: string;
  /** 1-2 sentence description of how this variant works. */
  description: string;
  /** 1 sentence tradeoff: what you gain, what you give up. */
  tradeoff: string;
}

export interface ItemPlanning {
  /** 2-3 load-bearing assumptions this item relies on. */
  assumes: string[];
  /** 0-3 other items in the room this depends on. Free-text refs
   *  (item names) — the UI doesn't resolve them to entity IDs yet. */
  depends_on: string[];
  /** 2-3 ways this item fails or under-delivers. */
  risks: string[];
}

export interface ExpandedItemDetail {
  /** Plain-language meaning beyond the title. */
  definition: string;
  variations: ItemVariation[];
  planning: ItemPlanning;
  /** ISO timestamp the LLM produced this. */
  generated_at: string;
}

export interface ExpandItemContext {
  /** What kind of item this is — determines tone + framing. */
  layer: "pain" | "features" | "outcomes" | "objective";
  /** The item's title (the lane card heading). */
  name: string;
  /** Existing per-item context from causal_chain. Pulled by caller.
   *  Pain: { negative_outcome, root_causes }
   *  Feature: { positive_outcome, first_principles }
   *  Outcome: { measured_by } */
  causalChain: Record<string, unknown>;
  /** Parent sub-objective title — for domain grounding. */
  subObjectiveTitle: string;
  /** Parent core objective — for top-level grounding. */
  coreObjectiveText: string;
  /** Optional RAG block (research-service.buildRagBlock output).
   *  When present, definition + variations get grounded in real
   *  sources. Optional — falls back to first-principles when absent. */
  ragBlock?: string;
}

// ── Per-layer framing — different prompts for different lane types ──

const LAYER_FRAMING: Record<ExpandItemContext["layer"], string> = {
  pain: `This is a PAIN POINT — an observable EFFECT the user wants to
counter. Your job: explain what this pain ACTUALLY IS in the user's
domain (beyond the title), enumerate ways the same pain manifests
across different products/situations (variations), and surface the
assumptions / dependencies / risks of treating this as a real
problem (planning).`,

  features: `This is a FEATURE — a concrete mechanism / lever the
system provides. Your job: explain what this feature ACTUALLY IS as
a working mechanism (definition), enumerate 3-5 distinct
implementation patterns it could take (variations), and surface the
assumptions, prerequisites, and failure modes that would determine
whether this feature actually fires the intended downstream effect
(planning).`,

  outcomes: `This is an OUTCOME — a desired observable state. Your
job: explain what this outcome ACTUALLY LOOKS LIKE in the user's
world (definition), enumerate 3-5 measurement / sensing patterns
that would each capture it differently (variations), and surface
the assumptions + risks + dependencies that would affect whether
this outcome is the RIGHT one to track (planning).`,

  objective: `This is an OBJECTIVE — the umbrella target. Your job:
explain what this objective MEANS in the user's domain (definition),
enumerate 3-5 valid framings / ways the objective could be
interpreted (variations), and surface the assumptions + dependencies
+ risks of choosing this particular framing (planning).`,
};

export async function expandItemDetail(
  ctx: ExpandItemContext,
): Promise<ExpandedItemDetail> {
  const framing = LAYER_FRAMING[ctx.layer];

  // Pull layer-specific signal from causal_chain into a readable
  // block — the LLM gets to see what's already been said about
  // this item so it doesn't restate the same thing.
  const ccLines: string[] = [];
  const cc = ctx.causalChain ?? {};
  if (ctx.layer === "pain") {
    if (typeof cc.negative_outcome === "string") {
      ccLines.push(`  Negative outcome (downstream): ${cc.negative_outcome}`);
    }
    if (Array.isArray(cc.root_causes)) {
      const rc = (cc.root_causes as unknown[])
        .filter((x): x is string => typeof x === "string")
        .slice(0, 4);
      if (rc.length > 0) {
        ccLines.push(`  Root causes (already identified): ${rc.join(", ")}`);
      }
    }
  } else if (ctx.layer === "features") {
    if (typeof cc.positive_outcome === "string") {
      ccLines.push(`  Positive outcome (downstream): ${cc.positive_outcome}`);
    }
    if (Array.isArray(cc.first_principles)) {
      const fp = (cc.first_principles as unknown[])
        .filter((x): x is string => typeof x === "string")
        .slice(0, 4);
      if (fp.length > 0) {
        ccLines.push(`  First principles (already identified): ${fp.join(", ")}`);
      }
    }
  } else if (ctx.layer === "outcomes") {
    if (typeof cc.measured_by === "string") {
      ccLines.push(`  Measurement signal (already identified): ${cc.measured_by}`);
    }
  }

  const ccBlock = ccLines.length > 0 ? `\n\nEXISTING CONTEXT FOR THIS ITEM:\n${ccLines.join("\n")}` : "";
  const ragBlockOut = ctx.ragBlock && ctx.ragBlock.length > 0 ? `\n\n${ctx.ragBlock}` : "";

  const system = `You expand a single strategy-room item into its detail surface so the user can stop guessing what the AI meant and start reasoning about the bet.

${framing}

OUTPUT THREE THINGS:

1) DEFINITION — 2-3 sentences. Plain language. Explains what this item ACTUALLY IS, distinct from the title. The title NAMES; the definition EXPLAINS. Reference the user's domain. Don't restate the title. Don't restate the existing context already given.

2) VARIATIONS — 3-5 alternative implementations / patterns / framings of the same item. Each variation:
     • name        — 3-6 words. Concrete pattern name.
     • description — 1-2 sentences. How this variant works.
     • tradeoff    — 1 sentence. What you gain, what you give up vs the other variations.
   The variations should span the DESIGN SPACE — different patterns, not different intensities of the same pattern. ❌ BAD: "Light gamification" / "Medium gamification" / "Heavy gamification". ✅ GOOD: "Streak-based" / "Social leaderboard" / "Mastery progression" / "Narrative quests".

3) PLANNING — three short lists:
     • assumes      — 2-3 load-bearing assumptions this item depends on
     • depends_on   — 0-3 other items / capabilities this needs first (free-text references)
     • risks        — 2-3 ways this item under-delivers or fails

ANTI-PLATITUDE: every output must reference something specific from the item, sub-objective, or research context. Generic strategy filler is forbidden.

If research context is provided above, cite it where it informs your output — but you don't need to cite every claim. Definitions and variations benefit most from citations; planning can be first-principles.

Return strict JSON.`;

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText.slice(0, 1500)}\n"""\n\nSUB-OBJECTIVE (room scope):\n"""\n${ctx.subObjectiveTitle}\n"""\n\nITEM:\n  Layer: ${ctx.layer}\n  Title: ${ctx.name}${ccBlock}${ragBlockOut}\n\nExpand this item per the system instructions.`;

  const raw = await llmJSON<{
    definition?: unknown;
    variations?: Array<{
      name?: unknown;
      description?: unknown;
      tradeoff?: unknown;
    }>;
    planning?: {
      assumes?: unknown;
      depends_on?: unknown;
      risks?: unknown;
    };
  }>({
    system,
    user,
    responseSchema: {
      name: "expand_item_detail",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          definition: { type: "string" },
          variations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                tradeoff: { type: "string" },
              },
              required: ["name", "description", "tradeoff"],
            },
          },
          planning: {
            type: "object",
            additionalProperties: false,
            properties: {
              assumes: { type: "array", items: { type: "string" } },
              depends_on: { type: "array", items: { type: "string" } },
              risks: { type: "array", items: { type: "string" } },
            },
            required: ["assumes", "depends_on", "risks"],
          },
        },
        required: ["definition", "variations", "planning"],
      },
    },
    temperature: 0.45,
    maxTokens: 2200,
  });

  // ── Normalize ──
  const definition =
    typeof raw?.definition === "string" ? raw.definition.trim() : "";

  const variations: ItemVariation[] = Array.isArray(raw?.variations)
    ? raw.variations
        .map((v): ItemVariation | null => {
          const name = typeof v?.name === "string" ? v.name.trim() : "";
          if (name.length === 0) return null;
          return {
            name: name.slice(0, 100),
            description:
              typeof v?.description === "string"
                ? v.description.trim().slice(0, 400)
                : "",
            tradeoff:
              typeof v?.tradeoff === "string"
                ? v.tradeoff.trim().slice(0, 300)
                : "",
          };
        })
        .filter((v): v is ItemVariation => v !== null)
        .slice(0, 5)
    : [];

  const planning: ItemPlanning = {
    assumes: Array.isArray(raw?.planning?.assumes)
      ? (raw.planning.assumes as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .slice(0, 4)
      : [],
    depends_on: Array.isArray(raw?.planning?.depends_on)
      ? (raw.planning.depends_on as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .slice(0, 4)
      : [],
    risks: Array.isArray(raw?.planning?.risks)
      ? (raw.planning.risks as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .slice(0, 4)
      : [],
  };

  return {
    definition,
    variations,
    planning,
    generated_at: new Date().toISOString(),
  };
}
