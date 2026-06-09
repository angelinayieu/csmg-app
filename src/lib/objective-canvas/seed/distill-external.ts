// ── distill-external ─────────────────────────────────────────────────
//
// Turn `seed.internal` (the engine) into `seed.external` (the card face — the
// one thing the user sees). This is where weak output is prevented. The rules:
//
//   1. EXTERNAL, not internal — say what to BUILD / what the user SEES, never the
//      optimization reason (comprehension, legibility — those stay internal).
//   2. STATED AS A DIFFERENCE — position against real alternatives. A deliverable
//      with no named alternative is a platitude → rejected.
//   3. QUANTIFY switch-value — how much better than the user's current tool.
//   4. COLLAPSE redundancy, DRILL to the actionable micro (not macro restatement).
//   5. ONE do-next.
//
// SERVER-ONLY. Soft-fails to a minimal external so the card still shows something.

import { llmJSON, BEST_CLAUDE_MODEL } from "@/lib/llm";
import { rankConnections } from "./rank-connections";
import type { SeedExternal, SeedInternal } from "./seed-types";

const DISTILL_SCHEMA = {
  name: "seed_external",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["deliverable", "vsAlternatives", "valueToSwitch", "doNext", "confidence"],
    properties: {
      deliverable: {
        type: "string",
        description:
          "What to BUILD or what the user SEES, in user terms — the external product, not the internal reason. ≤ 16 words. e.g. 'Verb-path cards: the unit is a relationship, not a node'.",
      },
      vsAlternatives: {
        type: "string",
        description:
          "Position against the real existing alternatives + their specific failure. MANDATORY. ≤ 28 words. e.g. 'Every incumbent (Wikipedia, Obsidian) is noun-first → their graphs feel empty on arrival'.",
      },
      valueToSwitch: {
        type: "number",
        description: "0–100: how much better than the user's current tool, net of switching cost.",
      },
      doNext: {
        type: "string",
        description: "The single next move, concrete + fork-ready. ≤ 12 words.",
      },
      confidence: { type: "number", description: "0–1 honest confidence this is real + non-obvious." },
    },
  },
} as const;

function block(label: string, lines: string[]): string {
  return lines.length ? `${label}\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
}

export async function distillExternal(internal: SeedInternal): Promise<SeedExternal> {
  const topLevers = [...internal.leveragePoints].sort((a, b) => b.score - a.score).slice(0, 4);
  const topPrinciples = [...internal.firstPrinciples].sort((a, b) => b.score - a.score).slice(0, 3);
  // The strongest cross-cluster bridges. The non-obvious insight usually lives in
  // an EDGE between two ideas' details, not in any single node — so feed these as
  // candidate theses (the #1 bridge is often the contrarian framing).
  const conns = rankConnections(internal.reasoningGraph, 4);

  const system = [
    "You distill a strategy engine's internal reasoning into the ONE external deliverable a founder acts on.",
    "HARD RULES:",
    "1. EXTERNAL, not internal. Say what to BUILD or what the user SEES — never the optimization reason (comprehension, legibility, 'people get it fast' are INTERNAL; do not surface them).",
    "2. STATED AS A DIFFERENCE. The deliverable MUST be positioned against the real alternatives + their specific failure. A deliverable with no named alternative is a platitude — reject it and find the contrarian framing.",
    "3. MINE THE STRONGEST CONNECTION. The non-obvious insight usually lives in a cross-cluster BRIDGE (an edge between two ideas), not in any single lever. Treat the ranked connections as candidate theses — if the #1 bridge yields a sharper, less-obvious deliverable than the top lever alone, lead with it.",
    "4. QUANTIFY switch-value (0–100): how much better than what the user already uses.",
    "5. COLLAPSE redundancy; DRILL to the actionable micro (not a macro restatement). If two points entail each other, keep one.",
    "6. ONE do-next.",
    "Lead with the non-obvious. If the best you can produce is generic best-practice, say so via low confidence. Return the seed_external tool only.",
  ].join("\n");

  const user = [
    `OBJECTIVE\n${internal.sharpenedObjective || "(none)"}`,
    block("TOP LEVERAGE POINTS", topLevers.map((l) => `${l.label}${l.meadows ? ` [${l.meadows}]` : ""}${l.rationale ? ` — ${l.rationale}` : ""}`)),
    block(
      "STRONGEST CONNECTIONS (candidate theses — the insight is often in the bridge, not the node)",
      conns.map((c) => `${c.sourceKeyword} ↔ ${c.targetKeyword} (${c.score})${c.bridgesTypes ? " [cross-type bridge]" : ""}${c.why ? ` — ${c.why}` : ""}`),
    ),
    block("FIRST PRINCIPLES (the irreducible truths)", topPrinciples.map((p) => `${p.label}: ${p.statement}`)),
    block("VARIABLES", internal.canonicalVariables.slice(0, 8).map((v) => v.label)),
    block("CONSTRAINTS", internal.constraints.map((c) => `${c.label} (${c.kind})`)),
    block("EXISTING ALTERNATIVES (position against these)", internal.alternatives.map((a) => `${a.name} — fails at: ${a.failure}`)),
    block("ANALOGOUS EXAMPLES", internal.analogousExamples.map((a) => `${a.name} (${a.relation}) → ${a.implication}`)),
    "Produce the external deliverable: what to build, stated as a difference vs the alternatives, drawn from the strongest connection where it sharpens the insight, with switch-value + one do-next.",
  ].filter(Boolean).join("\n\n");

  try {
    const out = await llmJSON<SeedExternal>({
      system,
      user,
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 900,
      temperature: 0.5,
      responseSchema: DISTILL_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
    return {
      deliverable: String(out?.deliverable ?? "").trim().slice(0, 160) || topLevers[0]?.label || "—",
      vsAlternatives: String(out?.vsAlternatives ?? "").trim().slice(0, 240),
      valueToSwitch: Math.max(0, Math.min(100, Number(out?.valueToSwitch) || 0)),
      doNext: String(out?.doNext ?? "").trim().slice(0, 120),
      confidence: Math.max(0, Math.min(1, Number(out?.confidence) || 0.5)),
    };
  } catch (err) {
    console.warn("[distill-external] failed (soft):", err);
    // Fallback: the top lever, un-distilled (better than blank).
    return {
      deliverable: topLevers[0]?.label || internal.sharpenedObjective.slice(0, 80) || "—",
      vsAlternatives: "",
      valueToSwitch: 0,
      doNext: "",
      confidence: 0.3,
    };
  }
}
