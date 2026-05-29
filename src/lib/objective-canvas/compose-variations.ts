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
import type { MechanismSpec } from "./enrich-mechanism-spec";
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
  /** K4 Wire 2 — pre-rendered learnings block (from
   *  buildLearningsBlock). When the user has concluded or abandoned
   *  experiments in this space, the composition should respect that:
   *  don't propose integrations that depend on a mechanism the user
   *  already concluded didn't work. Optional — empty when no
   *  experiments have terminal status. */
  learningsBlock?: string;
  /** Phase A — the feature's canonical v2 mechanism spec, when one has
   *  been generated. When present, integration_points are grounded in
   *  the spec's concrete system_components + input_data + runtime data
   *  handoffs — the composition shows where the elected variations share
   *  or hand off these named parts, instead of inferring abstract
   *  interlocks from 1-sentence descriptions. Optional. */
  mechanismSpec?: MechanismSpec | null;
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

  // M3 — Effectiveness ladder. When the user has scored elected
  // variations (Phase 4c+ — rubric / ensemble / evidence / simulation
  // / tested), composition should anchor on the highest-scoring
  // variation and treat lower-scored ones as junior partners. Without
  // this, composition treats all elected variations as peers — even
  // when one has been MC-validated at 0.85 and another sits at 0.42.
  //
  // M4 — Empirical overlay (Phase 11.7). When a variation has at
  // least one indicator with an empirical_overlay (from a concluded
  // brief), it's no longer theoretical. Empirical signal outranks
  // theoretical score regardless of magnitude — reality is the prior.
  // Mixed empirical signal across elected variations surfaces as a
  // conflict_open (the user must reconcile the field disagreement).
  type ScoredRow = {
    index: number;
    name: string;
    score: number;
    method: string | null;
    topEmpirical: {
      indicator: string;
      observed_lift_pct: number | null;
      observed_direction: string;
      methodology_rigor: number;
    } | null;
  };
  const scoredVariations: ScoredRow[] = [];
  for (let i = 0; i < ctx.electedVariations.length; i++) {
    const v = ctx.electedVariations[i];
    if (typeof v.effectiveness_score !== "number") continue;
    let topEmpirical: ScoredRow["topEmpirical"] = null;
    if (Array.isArray(v.indicator_scores)) {
      for (const ind of v.indicator_scores) {
        const ov = ind.empirical_overlay;
        if (!ov) continue;
        if (
          !topEmpirical ||
          ov.methodology_rigor > topEmpirical.methodology_rigor
        ) {
          topEmpirical = {
            indicator: ind.indicator_text,
            observed_lift_pct: ov.observed_lift_pct,
            observed_direction: ov.observed_direction,
            methodology_rigor: ov.methodology_rigor,
          };
        }
      }
    }
    scoredVariations.push({
      index: i + 1,
      name: v.name,
      score: v.effectiveness_score,
      method: v.evaluation_method ?? null,
      topEmpirical,
    });
  }
  // Sort descending so anchor appears first in the prompt block.
  scoredVariations.sort((a, b) => b.score - a.score);
  const effectivenessBlock =
    scoredVariations.length > 0
      ? `\n\nEFFECTIVENESS LADDER (score 0..1 from prior scoring runs; method tells you what produced it):\n${scoredVariations
          .map((s) => {
            const scoreStr = s.score.toFixed(2);
            const methodHint = s.method ? ` · ${s.method}` : "";
            const empiricalHint = s.topEmpirical
              ? `\n      EMPIRICAL — observed ${
                  s.topEmpirical.observed_lift_pct !== null
                    ? `${s.topEmpirical.observed_lift_pct > 0 ? "+" : ""}${s.topEmpirical.observed_lift_pct.toFixed(0)}% on "${s.topEmpirical.indicator.slice(0, 60)}"`
                    : `${s.topEmpirical.observed_direction} on "${s.topEmpirical.indicator.slice(0, 60)}"`
                } (rigor ${s.topEmpirical.methodology_rigor.toFixed(2)}) — REAL, not theoretical`
              : "";
            return `  [${s.index}] ${s.name} — ${scoreStr}${methodHint}${empiricalHint}`;
          })
          .join(
            "\n",
          )}\n  EFFECTIVENESS RULE for composition:\n    • The HIGHEST-SCORED variation ANCHORS the composition. The unified design's center of gravity sits on its mechanism. Lower-scored variations are JUNIOR PARTNERS — they extend / specialize / safeguard the anchor; they do NOT dilute its core.\n    • EMPIRICAL > theoretical. A variation with empirical_overlay (observed lift from a concluded brief) outranks any theoretical score regardless of magnitude — even a 0.55 empirical beats a 0.85 simulated. Reality is the prior.\n    • MIXED empirical signal (one validated + one refuted in the same composition) is a structural conflict_open. Name it explicitly: "the field signal disagrees with the simulated rank; the user should re-run the failing brief or accept the empirical verdict."\n    • Score gap > 0.30 between anchor and junior: surface in conflicts_open as "junior variation is materially weaker — keep only if its tradeoff is uniquely load-bearing."`
      : "";

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

  const hasEffectiveness = scoredVariations.length > 0;

  // N2 — R&D context propagation. When one or more elected variations
  // were produced by the R&D engine (provenance="rd_iteration"), they
  // carry target_root_cause (the specific pain root_cause they were
  // generated to attack) and constraint_compliance (a 0..1 score for
  // how well they fit operational constraints). Without surfacing
  // these, composition drifts off-target — folding an R&D-iterated
  // candidate in as if it were a generic peer defeats the purpose of
  // having iterated it.
  const rdRows = ctx.electedVariations
    .filter((v) => v.provenance === "rd_iteration")
    .map((v) => {
      const index = ctx.electedVariations.indexOf(v) + 1;
      const target = v.target_root_cause
        ? ` targets: "${v.target_root_cause.slice(0, 100)}"`
        : "";
      const fit =
        typeof v.constraint_compliance === "number"
          ? ` · constraint fit ${v.constraint_compliance.toFixed(2)}`
          : "";
      return `  [${index}] ${v.name} —${target}${fit}`;
    });
  const rdBlock =
    rdRows.length > 0
      ? `\n\nR&D-ITERATED VARIATIONS (these came from the refinement engine — keep them ON-TARGET):\n${rdRows.join("\n")}\n  R&D RULE for composition:\n    • The target_root_cause is the load-bearing reason the iteration was generated. The unified design must STILL clearly attack that root cause — if your description drifts into addressing a different pain, the iteration was wasted.\n    • Low constraint_compliance (<0.6) is a yellow flag: the iteration scored well on mechanism but barely fits the user's operational reality. Either name how the composition CLAWS BACK fit, or surface it in conflicts_open ("R&D candidate X scored 0.45 on constraint fit — keeping it requires loosening constraint Y, the user should confirm").`
      : "";

  // Phase A — mechanism-spec grounding. When the feature has a canonical
  // spec, integration_points reference its named components / data
  // handoffs instead of inferring abstract interlocks from descriptions.
  const ms = ctx.mechanismSpec;
  const hasSpec = !!ms;
  const specBlock = ms
    ? `\n\nMECHANISM SPEC (the feature's canonical build — ground integration_points in these concrete parts):\n- Components to build: ${ms.system_components.map((c) => `${c.name} (${c.category})`).slice(0, 8).join(" · ") || "—"}\n- Input data: ${ms.input_data.slice(0, 6).join(" · ") || "—"}\n- Runtime data handoffs: ${
        ms.runtime_flow
          .filter((r) => r.data && r.data !== "—")
          .map((r) => `${r.component}: ${r.data}`)
          .slice(0, 6)
          .join("  →  ") || "—"
      }\n  SPEC RULE for composition: when components/data are named above, integration_points MUST reference where the elected variations share or hand off these concrete parts (e.g. "[1] and [2] both write to <component>", "[2] consumes the <data> [1] produces") — not abstract "they work together" interlocks. The composed design is built from these components; show the seams.`
    : "";

  const system = `You synthesize multiple elected variations of a strategy-room item into a SINGLE coherent design.

${framing}

THE COMPOSITION IS NOT A LIST. It is a unified description that names how the elected variations interlock. Tell the user what they actually have when they pick these together.

OUTPUT:

1) DESCRIPTION — 2-3 sentences. The unified design read aloud. Not a recap of each variation; the WHOLE that emerges.${
    hasEffectiveness
      ? " When an EFFECTIVENESS LADDER is provided, the description must read as if the highest-scored (or empirically-validated) variation is the ANCHOR — the composition's center of gravity sits there, not on a generic equal-weight blend."
      : ""
  }

2) INTEGRATION_POINTS — 2-4 concrete interlocks. Where do these variations TOUCH each other in practice? What's the data flow / UX path / dependency that ties them?${
    hasSpec
      ? " When a MECHANISM SPEC is provided, anchor each interlock on its named components / data handoffs — show which shared component or data flow ties the variations together."
      : ""
  }

3) CONFLICTS_RESOLVED — 0-3 tensions the composition reconciled. "Variation A wants X; Variation B wants Y; the design handles this by …". Be specific — not "we resolved the tension by being thoughtful."

4) CONFLICTS_OPEN — 0-3 tensions that DO NOT resolve. The user must make a decision the composition can't make for them. THESE ARE LOUD. If you fudge an open conflict into "resolved," the design ships broken.${
    hasEffectiveness
      ? " When the EFFECTIVENESS LADDER shows mixed empirical signal (one validated + one refuted) or a score gap > 0.30, those go HERE — don't quietly bury a real signal disagreement under integration_points."
      : ""
  }

ANTI-PLATITUDE: every output must reference the actual variation names + tradeoffs. Generic synthesis filler is forbidden.

Return strict JSON.`;

  const constraintsBlock = buildConstraintsBlock(ctx.constraints ?? null);

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText.slice(0, 1200)}\n"""\n\nSUB-OBJECTIVE: ${ctx.subObjectiveTitle}\n\nITEM: ${ctx.itemName} (layer: ${ctx.itemLayer})${constraintsBlock}${ctx.learningsBlock ?? ""}\n\nELECTED VARIATIONS (${ctx.electedVariations.length}):\n${variationsBlock}${effectivenessBlock}${rdBlock}${lensBlock}${findingsBlock}${specBlock}\n\nCompose these per the system instructions. The composed design must respect the operational constraints — if integrating the elected variations would exceed budget/time/team, that's a conflict_open, not a conflict_resolved.`;

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
