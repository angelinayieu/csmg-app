// ── compose-ui-plans — Sonnet + UI agent skill → N distinct TechSpecUiPlans ─
//
// The pre-step before "Build prototype": from any selected card text, draft
// N UI-plan variants the user can pick between. Each variant is FORCED onto a
// different design axis (glass tier × hero pattern × density × motion) so the
// fork is genuinely distinct, not three slight phrasings of the same plan.
// Reuses loadUiSkillSystem so the plans speak the app's one design vocabulary.
//
// One bounded call PER variant, fired in parallel (was a single 8k-token call
// that drafted all N at once — slow, and truncated mid-JSON near the cap →
// "Couldn't draft this plan."). See composeOneVariant + composeUiPlans below.

import { getAnthropicClient } from "@/lib/anthropic";
import { BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";
import { loadUiSkillSystem } from "@/lib/objective-canvas/ui-skill-system";
import type { TechSpecUiPlan } from "./types";

// Sonnet-4-6 (was BEST_TUNABLE_CLAUDE_MODEL = opus-4-1). Opus-4-1 took 50–85s
// AND intermittently returned degenerate/truncated JSON on this nested plan
// schema → the route 502'd → "Couldn't draft this plan." on the board. Sonnet
// is ~3–5× faster, reliable on structured JSON, and still honors the custom
// temperature from the rail's AI settings. Mirrors the same opus-4-1 → Sonnet
// migration already done in the converge-diverge route.
const PLAN_MODEL = BEST_FAST_CLAUDE_MODEL;

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
  /** One entry per requested slant, IN SLANT ORDER. `null` = that variant's
   *  call failed; the board renders the survivors and marks the null slots
   *  "error" (it already null-checks each variant), so one flaky variant no
   *  longer kills the whole fork. */
  variants: Array<{
    label: string;
    plan: TechSpecUiPlan;
  } | null>;
}

/** Pull a JSON object out of the model's reply (fence or raw). */
function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : text).trim();
  const start = body.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in reply");
  return JSON.parse(body.slice(start));
}

/** One parallel call → one variant's plan (+ the shared title/overview). The
 *  output is a single bounded plan (≤ ~3.5k tokens) so it can't hit the 8k-cap
 *  truncation cliff the old single-batch call risked, and a flaky/overloaded
 *  variant rejects on its own without taking the others down. */
async function composeOneVariant(args: {
  anthropic: ReturnType<typeof getAnthropicClient>;
  system: string;
  source: string;
  slant: { label: string; brief: string };
  temperature: number;
}): Promise<{ title: string; overview: string; plan: TechSpecUiPlan }> {
  const user = [
    `SOURCE TEXT (the idea this UI plan explores):`,
    args.source,
    "",
    `Design slant — "${args.slant.label}": ${args.slant.brief}`,
    "",
    `Return a single JSON object of shape:`,
    `{
  "title": string,            // short product-level title for the idea
  "overview": string,         // 1-2 sentence problem framing
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
}`,
    "",
    `Keep it COMPACT — this renders on a small card and seeds (not replaces) the`,
    `later prototype build: at most 4 screens, 8 components, 4 interaction_notes,`,
    `4 reduction_log entries, 3 inspiration_cues. Every string is a terse phrase`,
    `(a few words), never a paragraph. Honor the slant's design_language tuple.`,
    `Use realistic concrete component names; never invent CSS selectors. JSON only.`,
  ].join("\n");

  const resp = await args.anthropic.messages.create(
    {
      // 6000 is a safety ceiling, not a target — the COMPACT instruction keeps a
      // well-formed plan to ~1.5k tokens. The headroom means a verbose reply
      // still finishes instead of truncating mid-JSON (the 4k cap clipped one
      // variant in testing → "Couldn't draft this plan." for that card).
      model: PLAN_MODEL,
      max_tokens: 6000,
      temperature: args.temperature,
      system: args.system,
      messages: [{ role: "user", content: user }],
    },
    { timeout: 3 * 60 * 1000 },
  );
  // A max_tokens stop means the JSON is cut off mid-object — fail loudly so
  // this variant is dropped rather than fed to JSON.parse as garbage.
  if (resp.stop_reason === "max_tokens") {
    throw new Error("variant truncated at max_tokens");
  }
  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  const parsed = extractJson(text) as {
    title?: string;
    overview?: string;
    plan?: TechSpecUiPlan;
  };
  if (!parsed || !parsed.plan || typeof parsed.plan !== "object") {
    throw new Error("variant missing plan");
  }
  return {
    title: typeof parsed.title === "string" ? parsed.title : "",
    overview: typeof parsed.overview === "string" ? parsed.overview : "",
    plan: parsed.plan,
  };
}

export async function composeUiPlans(args: ComposeArgs): Promise<ComposeResult> {
  const count = Math.max(1, Math.min(5, Math.round(args.count || 3)));
  const uiSkillPrefix = await loadUiSkillSystem();
  const anthropic = getAnthropicClient();
  const slants = VARIANT_SLANTS.slice(0, count);
  const temperature = typeof args.temperature === "number" ? args.temperature : 0.5;
  const source = args.sourceText.trim().slice(0, 4000);
  const system = uiSkillPrefix + "\n\n" + SYSTEM;

  // One parallel call per variant. This replaces a single 8k-token call that
  // drafted ALL N plans at once — that call took 50–150s and, when its output
  // neared the cap, truncated mid-JSON → the route 502'd → "Couldn't draft this
  // plan." on the board. Bounded per-variant calls run concurrently (wall-clock
  // ~= one variant, not the sum) and settle independently.
  const settled = await Promise.allSettled(
    slants.map((slant) =>
      composeOneVariant({ anthropic, system, source, slant, temperature }),
    ),
  );

  let title = "";
  let overview = "";
  const variants: ComposeResult["variants"] = slants.map((slant, i) => {
    const r = settled[i];
    if (r.status !== "fulfilled") {
      console.warn(
        `[ui-plan] variant "${slant.label}" failed:`,
        r.reason instanceof Error ? r.reason.message : String(r.reason),
      );
      return null;
    }
    if (!title && r.value.title) title = r.value.title;
    if (!overview && r.value.overview) overview = r.value.overview;
    // Force the slant label so the card chips line up with the requested order.
    return { label: slant.label, plan: r.value.plan };
  });

  // Every variant failed → surface a hard error so the route 502s and the board
  // marks the cards "error" (same contract as before). A partial success still
  // returns 200 with `null` holes the board renders as per-card errors.
  if (!variants.some(Boolean)) {
    throw new Error("all UI-plan variants failed");
  }
  return {
    title: title || "UI plan",
    overview: overview || source.slice(0, 240),
    variants,
  };
}
