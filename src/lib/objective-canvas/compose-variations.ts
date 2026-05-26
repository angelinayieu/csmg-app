// ── Compose Variations ─────────────────────────────────────────────
//
// When the user elects ≥2 variations on the same item, the system
// synthesizes them into a single coherent design. This is the
// answer to the "all 5 variations look viable simultaneously"
// question — variations stop being mutually-exclusive
// alternatives and become composable substrates.
//
// Output: a ComposedDesign with:
//   • description       — one paragraph: the unified design
//   • integration_points — concrete interlocks
//   • conflicts_resolved — tensions the composition reconciled
//   • conflicts_open     — tensions that REMAIN, loud, surfaced
//                           as a banner so the user makes the call
//
// Cached on entities.expanded_detail.composed_design. Invalidated
// when elections change (source_variation_ids mismatch detects this).
//
// Uses the same annotation lens the original expansion saw — the
// composition stays grounded in the parent objective's semantics.

import { llmJSON } from "@/lib/llm";
import type {
  ComposedDesign,
  ItemVariation,
} from "./expand-item-detail";
import type { ObjectiveAnnotation } from "./generate-annotations";
import {
  buildConstraintsBlock,
  type OperationalConstraints,
} from "./constraints";

export interface ComposeContext {
  /** Item title + layer for framing. */
  itemName: string;
  itemLayer: "pain" | "features" | "outcomes" | "objective";
  /** The variations the user elected. ≥2 required. */
  electedVariations: ItemVariation[];
  /** Domain grounding. */
  subObjectiveTitle: string;
  coreObjectiveText: string;
  /** Parent objective annotations — keep composition aligned with
   *  the same lens the original variations were derived from. */
  annotations?: ObjectiveAnnotation[];
  /** C — operational constraints. Composition respects them: the
   *  composed design must be reachable for the user's time / budget
   *  / team. Otherwise we hand them a fantasy. */
  constraints?: OperationalConstraints | null;
  /** Closed read loop — Analysis Workbench findings that touch THIS
   *  item / room. The disposition is LOAD-BEARING here: when the
   *  user has DISMISSED a duplicate_variation finding involving
   *  these elected variations, the composition must NOT re-raise it
   *  as a conflict_open (the user already declared the duplicate
   *  intentional). When OPEN or ACKNOWLEDGED, the composition
   *  should either reconcile the signal via integration_points →
   *  conflicts_resolved, or surface it as conflicts_open.
   *
   *  Caller filters out `resolved` (user closed it), `distill_concepts`
   *  (theme-level, not composition-shaping), `orphan_annotations` +
   *  `recommend_next_move` (space-level / meta), and keeps only
   *  findings whose references touch this entity or its room.
   *
   *  Soft signal — empty / undefined tolerated. */
  crossRoomFindings?: Array<{
    kind:
      | "pain_uncovered"
      | "pain_cross_addressed"
      | "contradiction"
      | "duplicate_variation"
      | "shared_mechanism"
      | "annotation_overlap";
    /** The finding's headline — short, ≤ 80 chars. */
    title: string;
    /** One-sentence summary the LLM ingests. */
    summary: string;
    /** Optional surgical hint pulled from the finding body. */
    hint?: string;
    /** User's stance — drives whether this becomes a conflict_open
     *  (open / acknowledged) or stays a quiet contextual signal
     *  (dismissed). `resolved` is filtered upstream and never
     *  reaches the generator. */
    disposition: "open" | "acknowledged" | "dismissed";
  }>;
}

const LAYER_FRAMING: Record<ComposeContext["itemLayer"], string> = {
  pain:
    "These are alternative readings of the same pain. The composition should describe a UNIFIED reading that explains why the pain manifests in multiple shapes.",
  features:
    "These are implementation patterns / mechanisms the user wants to combine. The composition should describe a UNIFIED feature design that integrates the elected patterns into one coherent build.",
  outcomes:
    "These are measurement patterns the user wants to capture together. The composition should describe a UNIFIED measurement strategy that uses each elected pattern as part of a triangulated signal.",
  objective:
    "These are interpretations of the objective. The composition should describe a UNIFIED reading that holds the elected framings together.",
};

export async function composeVariations(
  ctx: ComposeContext,
): Promise<ComposedDesign> {
  if (ctx.electedVariations.length < 2) {
    throw new Error("composeVariations requires ≥2 elected variations");
  }

  const framing = LAYER_FRAMING[ctx.itemLayer];

  const variationsBlock = ctx.electedVariations
    .map(
      (v, i) =>
        `  [${i + 1}] ${v.name} (${v.kind})\n      description: ${v.description}\n      tradeoff: ${v.tradeoff}`,
    )
    .join("\n\n");

  // Lens block — same shape as the variation expansion, kept compact
  // since composition needs the highest-weight readings only.
  const ranked = (ctx.annotations ?? [])
    .slice()
    .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
    .slice(0, 6);
  const lensBlock =
    ranked.length > 0
      ? `\n\nPARENT OBJECTIVE LENS (the readings the composition must respect):\n${ranked
          .map((a, i) => {
            const lines = [`  [${i + 1}] "${a.phrase}"`];
            if (a.reading) lines.push(`        reading: ${a.reading}`);
            if (a.tensions?.length) {
              const t = a.tensions[0];
              lines.push(`        ${t.kind}: ${t.note}`);
            }
            return lines.join("\n");
          })
          .join("\n")}`
      : "";

  // Cross-room findings block — disposition-aware. Sort by kind so
  // structural conflicts (contradictions, uncovered pains) appear
  // before consistency hints. Cap at 6 to bound prompt cost.
  const KIND_ORDER: Record<
    NonNullable<ComposeContext["crossRoomFindings"]>[number]["kind"],
    number
  > = {
    pain_uncovered: 0,
    contradiction: 1,
    pain_cross_addressed: 2,
    duplicate_variation: 3,
    shared_mechanism: 4,
    annotation_overlap: 5,
  };
  const findings = ctx.crossRoomFindings ?? [];
  const findingsBlock =
    findings.length > 0
      ? `\n\nCROSS-ROOM FINDINGS (the analysis workbench's diagnostic signals on this item / room — DISPOSITION IS LOAD-BEARING for composition):\n${[
          ...findings,
        ]
          .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
          .slice(0, 6)
          .map((f) => {
            const hint = f.hint ? ` — ${f.hint.slice(0, 140)}` : "";
            return `  [${f.kind} · ${f.disposition}] ${f.title.slice(0, 100)}\n      ${f.summary.slice(0, 220)}${hint}`;
          })
          .join(
            "\n",
          )}\n  CROSS-ROOM RULE for composition:\n    • DISMISSED findings (any kind): the user already declared their stance — this duplicate / contradiction / overlap is INTENTIONAL. Do NOT re-raise as conflicts_open. Quietly proceed; mention in the description ONLY if it strengthens the unified read.\n    • OPEN or ACKNOWLEDGED findings: either reconcile via integration_points (then list under conflicts_resolved) OR escalate to conflicts_open if the composition genuinely cannot resolve it. Pretending to resolve a real contradiction silently ships a broken design.\n    • A "contradiction" finding touching this item's elected variations is the strongest signal — the composition must address it explicitly.`
      : "";

  const system = `You synthesize multiple elected variations of a strategy-room item into a SINGLE coherent design.

${framing}

THE COMPOSITION IS NOT A LIST. It is a unified description that names how the elected variations interlock. Tell the user what they actually have when they pick these together.

OUTPUT:

1) DESCRIPTION — 2-3 sentences. The unified design read aloud. Not a recap of each variation; the WHOLE that emerges.

2) INTEGRATION_POINTS — 2-4 concrete interlocks. Where do these variations TOUCH each other in practice? What's the data flow / UX path / dependency that ties them?

3) CONFLICTS_RESOLVED — 0-3 tensions the composition reconciled. "Variation A wants X; Variation B wants Y; the design handles this by …". Be specific — not "we resolved the tension by being thoughtful."

4) CONFLICTS_OPEN — 0-3 tensions that DO NOT resolve. The user must make a decision the composition can't make for them. THESE ARE LOUD. If you fudge an open conflict into "resolved," the design ships broken.

ANTI-PLATITUDE: every output must reference the actual variation names + tradeoffs. Generic synthesis filler is forbidden.

Return strict JSON.`;

  const constraintsBlock = buildConstraintsBlock(ctx.constraints ?? null);

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText.slice(0, 1200)}\n"""\n\nSUB-OBJECTIVE: ${ctx.subObjectiveTitle}\n\nITEM: ${ctx.itemName} (layer: ${ctx.itemLayer})${constraintsBlock}\n\nELECTED VARIATIONS (${ctx.electedVariations.length}):\n${variationsBlock}${lensBlock}${findingsBlock}\n\nCompose these per the system instructions. The composed design must respect the operational constraints — if integrating the elected variations would exceed budget/time/team, that's a conflict_open, not a conflict_resolved.`;

  const raw = await llmJSON<{
    description?: unknown;
    integration_points?: unknown;
    conflicts_resolved?: unknown;
    conflicts_open?: unknown;
  }>({
    system,
    user,
    responseSchema: {
      name: "compose_variations",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          integration_points: {
            type: "array",
            items: { type: "string" },
          },
          conflicts_resolved: {
            type: "array",
            items: { type: "string" },
          },
          conflicts_open: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "description",
          "integration_points",
          "conflicts_resolved",
          "conflicts_open",
        ],
      },
    },
    temperature: 0.4,
    maxTokens: 1400,
  });

  function trimList(raw: unknown, max: number, perItemMax: number): string[] {
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[])
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().slice(0, perItemMax))
      .slice(0, max);
  }

  return {
    description:
      typeof raw?.description === "string"
        ? raw.description.trim().slice(0, 600)
        : "",
    integration_points: trimList(raw?.integration_points, 4, 240),
    conflicts_resolved: trimList(raw?.conflicts_resolved, 3, 240),
    conflicts_open: trimList(raw?.conflicts_open, 3, 240),
    source_variation_ids: ctx.electedVariations.map((v) => v.id),
    generated_at: new Date().toISOString(),
  };
}
