// ── Evaluator (the brain) ────────────────────────────────────────────
//
// Judges the course of action against the FULL factor set (EVALUATOR_PLAN). The
// headline output is NOT a score — it's coverage: what's been considered, how
// deeply, and the decisive thing that has NOT. One cost-disciplined pass
// (§9 "cheap default"): classify+weight → assess vs depth bars → missing-factor
// critic → bias-to-action verdict. Multi-perspective lenses are P2 (on-demand).
//
// Adopts the four sharpenings: depth-not-presence (scores vs depthBar), invert-
// trust (weighting trusted; per-factor scores low-trust w/ confidence+source;
// illegible+decisive+low-grounding → a `probe` question, not a verdict),
// bias-to-action (call + gapKind). SERVER-ONLY. Soft-fails to a minimal eval.

import { llmJSON, BEST_CLAUDE_MODEL } from "@/lib/llm";
import { rankConnections } from "./rank-connections";
import {
  DECISION_ARCHETYPES,
  renderFrameworkForPrompt,
} from "./factor-framework";
import type { SeedEvaluation, SeedFactor, SeedInternal } from "./seed-types";

const EVAL_SCHEMA = {
  name: "seed_evaluation",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["decisionType", "weightingRationale", "factors", "decisiveFactors", "biggestGap", "biggestGapKind", "call", "verdict", "confidence"],
    properties: {
      decisionType: { type: "string", description: "The decision archetype (e.g. consumer_app, b2b_saas, deep_tech, marketplace, feature)." },
      weightingRationale: { type: "string", description: "1–2 sentences: WHY these factors dominate for THIS decision. The high-trust output." },
      factors: {
        type: "array",
        description: "Every default factor assessed + any decision-specific or UNADDRESSED ones you add. Score each against its STRONG-requires bar.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "group", "label", "assessment", "score", "confidence", "status", "weight", "source"],
          properties: {
            key: { type: "string" },
            group: { type: "string", description: "A..I" },
            label: { type: "string" },
            assessment: { type: "string", description: "≤ 1 sentence judgment." },
            score: { type: "number", description: "0–100 (low-trust)." },
            confidence: { type: "number", description: "0–1 grounding of THIS judgment." },
            status: { type: "string", enum: ["strong", "weak", "unaddressed", "unknown"], description: "strong only if it CLEARS the depth bar; addressed-but-shallow = weak; not present = unaddressed." },
            weight: { type: "string", enum: ["decisive", "relevant", "minor"] },
            source: { type: "string", enum: ["evidence", "simulation", "crucible", "value_engine", "judgment"] },
            probe: { type: "string", description: "ONLY for a decisive + low-grounding + illegible factor: the QUESTION to ask the founder instead of a verdict. Omit otherwise." },
            gapKind: { type: "string", enum: ["stop_ship", "two_way_door"], description: "For a weak/unaddressed DECISIVE factor: is the gap a blocker or learnable-by-doing?" },
          },
        },
      },
      decisiveFactors: { type: "array", items: { type: "string" }, description: "keys of the factors that DECIDE this." },
      biggestGap: { type: "string", description: "The single most important UNADDRESSED or weak decisive factor, stated bluntly — the card line + the chat's next question." },
      biggestGapKind: { type: "string", enum: ["stop_ship", "two_way_door"] },
      call: { type: "string", enum: ["go", "refine_first"], description: "Bias-to-action: enough decisive coverage to test cheaply (go), or a stop-ship gap (refine_first)." },
      verdict: { type: "string", description: "Holistic 1–2 sentences: decisive factors + the call + the biggest gap, with the go/refine reasoning." },
      confidence: { type: "number", description: "0–1 overall." },
    },
  },
} as const;

function block(label: string, lines: string[]): string {
  return lines.length ? `${label}\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
}

export async function runEvaluator(internal: SeedInternal): Promise<SeedEvaluation> {
  const nowIso = new Date().toISOString();
  const conns = rankConnections(internal.reasoningGraph, 5);

  const system = [
    "You are the EVALUATOR — a top-tier strategist who judges a course of action against the FULL factor set, weighing qualitative AND quantitative together. Your headline output is NOT a score; it's COVERAGE: what's been considered, how deeply, and the decisive thing that has NOT.",
    "RULES:",
    "1. DEPTH, not presence. Mark a factor `strong` ONLY if it clears the 'STRONG requires' bar. Addressed-but-shallow = `weak`. Not present at all = `unaddressed`. Generic best-practice ≠ strong.",
    "2. WEIGHT first, and explain why. Classify the decision archetype; the decisive factors differ by type (consumer → distribution+timing; deep-tech → feasibility+moat). The weighting + its rationale is your HIGH-CONFIDENCE output.",
    "3. INVERT TRUST. Per-factor scores are low-trust — always attach confidence + source. For a factor that is DECISIVE + low-grounding + illegible (WTP, timing, founder-fit, distribution wedge), do NOT fake a verdict — emit a `probe`: the sharp question the founder must answer. Mark it unaddressed/unknown with low confidence.",
    "4. ADD what's missing. Beyond the default factors, add decision-specific ones, and run a missing-factor critic: name any dimension not considered as an `unaddressed` factor.",
    "5. BIAS TO ACTION. End with a call: `go` if the decisive factors are covered enough to test cheaply (gaps are two-way doors), or `refine_first` if a decisive gap is a stop-ship one-way door. Set gapKind on weak/unaddressed decisive factors.",
    "The most valuable single line is `biggestGap` — the decisive thing not yet considered, stated bluntly. Return the seed_evaluation tool only.",
  ].join("\n");

  const user = [
    `OBJECTIVE\n${internal.sharpenedObjective || "(none)"}`,
    "DECISION ARCHETYPES (pick/adapt one to set the weighting):\n" +
      DECISION_ARCHETYPES.map((a) => `- ${a.key}: ${a.cue} → decisive groups ${a.decisive.join("/")}`).join("\n"),
    "FACTOR FRAMEWORK (assess each against its STRONG-requires bar; add more):\n" + renderFrameworkForPrompt(),
    "── What the engine has produced so far (assess coverage against this) ──",
    block("LEVERAGE POINTS", internal.leveragePoints.map((l) => `${l.label}${l.meadows ? ` [${l.meadows}]` : ""} (${l.score})`)),
    block("FIRST PRINCIPLES", internal.firstPrinciples.map((p) => `${p.label}: ${p.statement}`)),
    block("VARIABLES", internal.canonicalVariables.map((v) => v.label)),
    block("CONSTRAINTS", internal.constraints.map((c) => `${c.label} (${c.kind})`)),
    block("ALTERNATIVES (differentiation)", internal.alternatives.map((a) => `${a.name} — fails at: ${a.failure}`)),
    block("ANALOGOUS", internal.analogousExamples.map((a) => `${a.name} (${a.relation}) → ${a.implication}`)),
    block("STRONGEST CONNECTIONS", conns.map((c) => `${c.sourceKeyword} ↔ ${c.targetKeyword} (${c.score})`)),
    "Evaluate. Where the engine HASN'T produced something a decisive factor needs, that factor is `unaddressed` — say so bluntly in biggestGap.",
  ].filter(Boolean).join("\n\n");

  let raw: {
    decisionType?: string; weightingRationale?: string;
    factors?: Partial<SeedFactor>[];
    decisiveFactors?: string[]; biggestGap?: string; biggestGapKind?: string;
    call?: string; verdict?: string; confidence?: number;
  };
  try {
    raw = await llmJSON({
      system,
      user,
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 3600,
      temperature: 0.35,
      responseSchema: EVAL_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    console.warn("[evaluator] failed (soft):", err);
    return {
      decisionType: "unknown",
      weightingRationale: "",
      factors: [],
      decisiveFactors: [],
      biggestGap: "Evaluation unavailable — answer a few questions in chat to ground the reasoning.",
      call: "refine_first",
      verdict: "",
      confidence: 0.2,
      updatedAt: nowIso,
    };
  }

  const clamp01 = (n: unknown) => Math.max(0, Math.min(1, typeof n === "number" ? n : 0.5));
  const clamp100 = (n: unknown) => Math.max(0, Math.min(100, typeof n === "number" ? n : 0));
  const factors: SeedFactor[] = (raw?.factors ?? [])
    .map((f) => ({
      key: String(f?.key ?? "").trim().slice(0, 48),
      group: String(f?.group ?? "").trim().slice(0, 2) || "A",
      label: String(f?.label ?? "").trim().slice(0, 80),
      assessment: String(f?.assessment ?? "").trim().slice(0, 240),
      score: clamp100(f?.score),
      confidence: clamp01(f?.confidence),
      status: (["strong", "weak", "unaddressed", "unknown"].includes(String(f?.status)) ? f!.status : "unknown") as SeedFactor["status"],
      weight: (["decisive", "relevant", "minor"].includes(String(f?.weight)) ? f!.weight : "relevant") as SeedFactor["weight"],
      source: (["evidence", "simulation", "crucible", "value_engine", "judgment"].includes(String(f?.source)) ? f!.source : "judgment") as SeedFactor["source"],
      probe: typeof f?.probe === "string" && f.probe.trim() ? f.probe.trim().slice(0, 200) : undefined,
      gapKind: f?.gapKind === "stop_ship" || f?.gapKind === "two_way_door" ? f.gapKind : undefined,
    }))
    .filter((f) => f.key && f.label);

  return {
    decisionType: String(raw?.decisionType ?? "unknown").trim().slice(0, 48),
    weightingRationale: String(raw?.weightingRationale ?? "").trim().slice(0, 280),
    factors,
    decisiveFactors: Array.isArray(raw?.decisiveFactors) ? raw.decisiveFactors.map((s) => String(s)).filter(Boolean).slice(0, 8) : [],
    biggestGap: String(raw?.biggestGap ?? "").trim().slice(0, 240),
    biggestGapKind: raw?.biggestGapKind === "stop_ship" || raw?.biggestGapKind === "two_way_door" ? raw.biggestGapKind : undefined,
    call: raw?.call === "go" ? "go" : "refine_first",
    verdict: String(raw?.verdict ?? "").trim().slice(0, 320),
    confidence: clamp01(raw?.confidence),
    updatedAt: nowIso,
  };
}
