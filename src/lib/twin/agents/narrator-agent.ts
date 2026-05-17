// ── Narrator agent ─────────────────────────────────────────────────
//
// Generates the plain-English "What this twin is" summary at the
// top of the Twin Detail Page Overview tab. Three short paragraphs:
//
//   1. What the twin currently sees
//   2. Where it's strong + where it's weak
//   3. What to watch for next
//
// Style: plain English, speak to the user ("your twin"), acknowledge
// uncertainty when confidence is medium or below, no jargon, direct.
//
// Cached in spaces.twin_dashboard_cache.narrator_summary. Refreshed
// when key signals shift (bottleneck change, new strategy approved,
// entities ±20%) or on manual user "Refresh" button.

import { llmJSON } from "@/lib/llm";
import type { TwinMacroState } from "@/types/twin";

export interface NarratorInput {
  spaceName: string;
  twinMacro: TwinMacroState;
  topLeverageName: string | null;
  layerCount: number;
  /** Human-readable note about the most recent material change, e.g.
   *  "approved strategy 14d ago" or "30 entities added in the past
   *  3 days" — null when nothing notable recently. */
  recentChangeNote: string | null;
}

export interface NarratorOutput {
  summary: string;
  generated_at: string;
}

export async function runNarratorAgent(
  input: NarratorInput,
): Promise<NarratorOutput> {
  const system = `You are explaining a digital twin to its owner.

Write a summary in EXACTLY three short paragraphs (~150 words total).

Paragraph 1: What the twin currently sees — the headline insight or pattern
Paragraph 2: Where it's strong + where it's weak — be honest about confidence
Paragraph 3: What to watch for next — one observable signal or action

Style requirements:
- Plain English. No jargon. No "synthesis indicates" or "the model reflects"
- Speak to the user ("your twin", not "the twin")
- Acknowledge uncertainty when health < 70 or coverage is thin
- Direct. No throat-clearing like "It appears that..."
- Don't pad. If a section has nothing useful, say so honestly

Return JSON with a single key "summary" containing the full three-paragraph text. Use single newlines between paragraphs.`;

  const macro = input.twinMacro;
  const bottleneck = macro.risk_exposure.bottleneck_name ?? "none yet identified";
  const confidence =
    macro.health_score >= 75 ? "high"
    : macro.health_score >= 50 ? "medium"
    : "low";

  // TwinDynamics splits reinforcing into positive + negative; collapse
  // back to a single count for the narrator (it doesn't need that
  // granularity to write a paragraph).
  const reinforcing =
    macro.dynamics.reinforcing_positive + macro.dynamics.reinforcing_negative;

  const user = `Space: ${input.spaceName}

Health: ${macro.health_score}/100 (${macro.health_label})
Confidence read: ${confidence}

Master bottleneck: ${bottleneck}
Top leverage point: ${input.topLeverageName ?? "none surfaced"}

Coverage: ${macro.coverage.entities_modeled} entities across ${input.layerCount} layers
Reinforcing loops: ${reinforcing}
Dampening loops: ${macro.dynamics.balancing}
Risk points: ${macro.risk_exposure.total_risk_points}

Recent change: ${input.recentChangeNote ?? "no recent material changes"}`;

  const result = await llmJSON<{ summary: string }>({
    system,
    user,
    maxTokens: 500,
    temperature: 0.4,
    responseSchema: {
      name: "twin_narrator_summary",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
    fallback: { summary: "Your twin is still gathering signal." },
  });

  return {
    summary: result.summary,
    generated_at: new Date().toISOString(),
  };
}
