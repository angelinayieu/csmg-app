// ── compose-ui-plans — Opus + UI agent skill → N distinct TechSpecUiPlans ─
//
// The pre-step before "Build prototype": from any selected card text, draft
// N UI-plan variants the user can pick between. Each variant is FORCED onto a
// different design axis (glass tier × hero pattern × density × motion) so the
// fork is genuinely distinct, not three slight phrasings of the same plan.
// Reuses loadUiSkillSystem so the plans speak the app's one design vocabulary.

import { getAnthropicClient } from "@/lib/anthropic";
import { BEST_TUNABLE_CLAUDE_MODEL } from "@/lib/llm";
import { loadUiSkillSystem } from "@/lib/objective-canvas/ui-skill-system";
import type { TechSpecUiPlan } from "./types";

// Tunable Opus — we pass a custom temperature from the rail's AI settings,
// which the frontier Opus rejects (see reference_claude_model_constraints).
const OPUS_MODEL = BEST_TUNABLE_CLAUDE_MODEL;

/** Four pre-built design slants so the variants diverge on different axes,
 *  not just rewording the same plan. Stretched to N by wrapping. */
const VARIANT_SLANTS: Array<{
  label: string;
  brief: string;
}> = [
  {
    label: "Focused",
    brief:
      "Comfortable density, plate glass, decision hero pattern, still motion. Lead with ONE primary action; minimize chrome. Empty + loading states are explicit.",
  },
  {
    label: "Dense control",
    brief:
      "Dense layout, float glass, metric hero pattern, breathing motion. Pack working surfaces side-by-side; surface counts/deltas inline.",
  },
  {
    label: "Narrative",
    brief:
      "Airy density, hero glass, flow hero pattern, reveal motion. A guided left→right unfurl with story beats; one component per screen-fold.",
  },
  {
    label: "Evidence-led",
    brief:
      "Comfortable density, card glass, evidence hero pattern, responsive motion. Every result is paired with the inputs/source that produced it.",
  },
  {
    label: "Before/after",
    brief:
      "Comfortable density, float glass, before_after hero pattern, breathing motion. Two-column compare-view as the primary surface; success metric in the gutter.",
  },
];

const SYSTEM = `You are a senior product designer + interaction architect. Given a product idea and a forced design slant, draft a complete UI plan (design language + screens + components + interactions + reduction log) the engineering team could build directly. Speak the app's design-language vocabulary. Return JSON only.`;

interface ComposeArgs {
  sourceText: string;
  count: number;
  /** Sampling temperature — passed through from the rail's AI settings. */
  temperature?: number;
}

interface ComposeResult {
  title: string;
  overview: string;
  variants: Array<{
    label: string;
    plan: TechSpecUiPlan;
  }>;
}

/** Pull a JSON object out of the model's reply (fence or raw). */
function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : text).trim();
  const start = body.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in reply");
  return JSON.parse(body.slice(start));
}

export async function composeUiPlans(args: ComposeArgs): Promise<ComposeResult> {
  const count = Math.max(1, Math.min(5, Math.round(args.count || 3)));
  const uiSkillPrefix = await loadUiSkillSystem();
  const anthropic = getAnthropicClient();

  const slants = VARIANT_SLANTS.slice(0, count);

  const user = [
    `SOURCE TEXT (the idea the variants explore):`,
    args.sourceText.trim().slice(0, 4000),
    "",
    `Draft ${count} DISTINCT UI plans, each pinned to one of these slants:`,
    ...slants.map((s, i) => `  ${i + 1}. "${s.label}" — ${s.brief}`),
    "",
    `Return a single JSON object of shape:`,
    `{
  "title": string,            // one short product-level title shared by all variants
  "overview": string,         // 1-2 sentence problem framing
  "variants": [               // exactly ${count} entries, IN THE SLANT ORDER above
    {
      "label": string,        // the slant label verbatim
      "plan": {
        "design_language": {
          "glass_tier": "plate"|"card"|"float"|"hero",
          "accent_intent": "signal"|"warning"|"growth"|"insight"|"neutral",
          "density": "airy"|"comfortable"|"dense",
          "motion_intent": "still"|"breathing"|"reveal"|"responsive",
          "hero_pattern": "metric"|"flow"|"cycle"|"before_after"|"evidence"|"decision"
        },
        "screens": [ { "name": string, "purpose": string, "key_components": string[], "states": string[] } ],
        "component_inventory": string[],
        "interaction_notes": string[],
        "reduction_log": string[],   // "Kept X — because Y" / "Cut Z — because W"
        "inspiration_cues": string[] // [] when none
      }
    }
  ]
}`,
    "",
    `Make the variants genuinely DIFFERENT (different design_language tuples + different screen sets), not three rephrasings of one plan. Use realistic concrete component names; never invent CSS selectors.`,
  ].join("\n");

  const resp = await anthropic.messages.create(
    {
      model: OPUS_MODEL,
      max_tokens: 8000,
      temperature: typeof args.temperature === "number" ? args.temperature : 0.5,
      system: uiSkillPrefix + "\n\n" + SYSTEM,
      messages: [{ role: "user", content: user }],
    },
    { timeout: 5 * 60 * 1000 },
  );
  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  const parsed = extractJson(text) as ComposeResult;
  if (!parsed || !Array.isArray(parsed.variants)) {
    throw new Error("invalid plans payload");
  }
  // Trim to requested count + force the slant label so card chips line up.
  parsed.variants = parsed.variants.slice(0, count).map((v, i) => ({
    label: v.label || slants[i]?.label || `Variant ${i + 1}`,
    plan: v.plan,
  }));
  if (!parsed.title) parsed.title = "UI plan";
  if (!parsed.overview) parsed.overview = args.sourceText.slice(0, 240);
  return parsed;
}
