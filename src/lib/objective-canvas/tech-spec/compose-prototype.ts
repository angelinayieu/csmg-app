// ── compose-prototype — Opus + UI agent skill → interactive HTML ─────
//
// Server-only. Turns a TechSpec into a self-contained, INTERACTIVE HTML/CSS
// prototype (no JavaScript), and refines it from user feedback. Reuses
// getAnthropicClient (Opus), loadUiSkillSystem() (the UI agent skill), and
// sanitizeHtml (the same sanitizer the variation mockups use — strips
// <script>, event handlers, dangerous tags). The client renders the result
// in an iframe with sandbox="" — belt + suspenders.

import { getAnthropicClient } from "@/lib/anthropic";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { loadUiSkillSystem } from "@/lib/objective-canvas/ui-skill-system";
import { sanitizeHtml } from "@/lib/objective-canvas/generate-mockup";
import type { TasteDesignContext } from "./taste-design-block";
import type { TechSpec } from "./types";

const OPUS_MODEL = BEST_CLAUDE_MODEL;

const BASE_RULES =
  "Hard rules: ONE self-contained <!DOCTYPE html> document with a single inline <style> block. NO JavaScript, NO <script>, NO external resources (no CDN, web fonts, or image URLs) — system fonts + CSS only. Make it feel REAL: concrete copy and realistic placeholder data (never lorem ipsum), the key components from the UI plan, and CSS-only interactivity (hover/focus states, label-driven :checked tabs/toggles, <details>). Honor the design language (glass tier, density, motion intent, accent, hero pattern) and surface at least one non-happy-path state (empty/loading) somewhere. Return ONLY the HTML document — no prose, no markdown fence.";

const TASTE_RULE =
  "When a DESIGN.md and/or tailwind.config.ts block is provided below, treat them as the project-level taste contract. The user's vocabulary terms (marked \"yours\") must appear verbatim where natural; their anti-patterns must not appear at all; the brand color/radius/shadow tokens in tailwind.config.ts must shape the inline <style> block (use the same hex values, no purple/Inter clichés unless the contract explicitly calls for them).";

const GENERATE_SYSTEM = `You are a senior product designer + front-end engineer. Produce a high-fidelity, INTERACTIVE prototype of this product's primary screen(s) from its technical spec + UI plan. ${BASE_RULES} ${TASTE_RULE}`;

const REFINE_SYSTEM = `You are a senior product designer + front-end engineer iterating on an existing HTML prototype. Apply the user's feedback precisely while preserving everything that works. ${BASE_RULES} ${TASTE_RULE}`;

/** Pre-pend the DESIGN.md + tailwind.config.ts blocks before the SPEC. The
 *  model reads them as project facts. Empty input → empty output. */
function tasteContextBlock(ctx: TasteDesignContext | null | undefined): string {
  if (!ctx || !ctx.hasContent) return "";
  const parts: string[] = [];
  if (ctx.designMd) parts.push(ctx.designMd);
  if (ctx.tailwindConfig)
    parts.push(`## tailwind.config.ts\n\n${ctx.tailwindConfig}`);
  return parts.join("\n\n") + "\n\n";
}

function specBrief(spec: TechSpec): string {
  return JSON.stringify(
    {
      title: spec.title,
      overview: spec.overview,
      target_users: spec.target_users,
      ui_plan: spec.ui_plan,
      features: spec.features.map((f) => ({
        name: f.name,
        description: f.description,
      })),
    },
    null,
    2,
  );
}

/** Pull the HTML out of the model's reply (fence or raw doc). */
function extractHtml(text: string): string {
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = text.search(/<!DOCTYPE|<html/i);
  if (start >= 0) return text.slice(start).trim();
  return text.trim();
}

async function opusHtml(system: string, user: string): Promise<string> {
  const uiSkillPrefix = await loadUiSkillSystem();
  const anthropic = getAnthropicClient();
  const resp = await anthropic.messages.create(
    {
      model: OPUS_MODEL,
      max_tokens: 8000,
      system: uiSkillPrefix + "\n\n" + system,
      messages: [{ role: "user", content: user }],
    },
    { timeout: 5 * 60 * 1000 },
  );
  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  return sanitizeHtml(extractHtml(text));
}

/** Generate the first interactive prototype from a TechSpec. Optional taste
 *  context is prepended as DESIGN.md + tailwind.config.ts blocks. */
export function composePrototypeHtml(
  spec: TechSpec,
  taste?: TasteDesignContext | null,
): Promise<string> {
  return opusHtml(
    GENERATE_SYSTEM,
    `${tasteContextBlock(taste)}Build the interactive prototype for this product.\n\nSPEC + UI PLAN:\n${specBrief(
      spec,
    )}`,
  );
}

/** Regenerate the prototype with the user's feedback applied. */
export function refinePrototypeHtml(
  currentHtml: string,
  feedback: string,
  spec: TechSpec | null,
  taste?: TasteDesignContext | null,
): Promise<string> {
  const existingPrototype = currentHtml.trim()
    ? `CURRENT PROTOTYPE HTML:\n${currentHtml.slice(0, 24000)}\n\n`
    : "CURRENT PROTOTYPE HTML:\nNone available. Treat this as a retry after a failed first build; generate the full prototype from the product context and user feedback.\n\n";
  return opusHtml(
    REFINE_SYSTEM,
    tasteContextBlock(taste) +
      existingPrototype +
      (spec ? `PRODUCT CONTEXT:\n${specBrief(spec)}\n\n` : "") +
      `USER FEEDBACK:\n${feedback}\n\nReturn the full revised HTML document.`,
  );
}
