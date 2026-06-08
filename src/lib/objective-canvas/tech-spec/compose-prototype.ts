// ── compose-prototype — Opus + skill stack → interactive HTML ─────
//
// Server-only. Turns a TechSpec into a self-contained, INTERACTIVE HTML/CSS+JS
// prototype, and refines it from user feedback. Skill stack (low → high
// precedence in the system message):
//   1. UI agent skill (cognitive principles / app-type playbooks)
//   2. frontend-design skill (Anthropic anti-slop quality floor)
//   3. shadcn vocabulary primer (canonical 56 primitives)
//   4. project SYSTEM (BASE_RULES + TASTE_RULE)
// And in the user message (per-call): tailwind.config.ts brand tokens +
// DESIGN.md space taste contract, both pre-pended above the SPEC.
//
// T1 SAFETY: iframe is rendered with sandbox="allow-scripts" (no
// allow-same-origin) → null origin. Output goes through sanitizeHtmlT1
// (DOMPurify v3.4.8 + url filter + CSP meta injection), which strips
// external refs, blocks remote loads, and wedges a deny-all CSP at the
// top of <head>. Three independent layers: sanitizer + sandbox + CSP.

import { getAnthropicClient } from "@/lib/anthropic";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { loadUiSkillSystem } from "@/lib/objective-canvas/ui-skill-system";
import { loadFrontendDesignSkill } from "./frontend-design-skill";
import { loadShadcnSkill } from "./shadcn-skill";
import { sanitizeHtmlT1 } from "./sanitize-prototype-t1";
import type { TasteDesignContext } from "./taste-design-block";
import type { TechSpec } from "./types";

const OPUS_MODEL = BEST_CLAUDE_MODEL;

const BASE_RULES =
  "Hard rules: ONE self-contained <!DOCTYPE html> document with inline <style> and (optional) inline <script>. INLINE JavaScript is now PERMITTED — use it to wire interactivity via addEventListener (never inline on* attributes; they will be stripped). " +
  "RUNTIME SANDBOX (CRITICAL — read carefully). The page runs in a null-origin sandboxed iframe with a strict CSP. The following ALL fail and WILL crash your script if reached at the top level, so subsequent addEventListener calls never register and the whole prototype becomes un-clickable: " +
  "(a) localStorage / sessionStorage / IndexedDB — throw SecurityError. Keep ALL state in plain JS variables (`let state = {...}`) or in-memory data structures only. " +
  "(b) fetch / XMLHttpRequest / WebSocket / EventSource — all blocked by CSP `connect-src 'none'`. Do not call them; ship realistic seed data inline as a JS array/object literal. " +
  "(c) Cookies / `document.cookie` — null origin, no-op. " +
  "(d) `window.open` to remote URLs — blocked. Use in-page navigation only. " +
  "(e) NO external resources of any kind — no CDN, no remote scripts, no web fonts (font-src is 'none'), no image URLs (data: URLs are fine for SVG; remote img src will silently 404). " +
  "If you must touch any of the above defensively, wrap it in try/catch so the rest of the script keeps running. " +
  "ALLOWED: alert/confirm/prompt, <form> submit handlers (preventDefault as usual), target=_blank links, addEventListener on any element, requestAnimationFrame, setTimeout/setInterval, CSS transitions/animations. " +
  "Make it feel REAL: concrete copy and realistic placeholder data (never lorem ipsum), the key components from the UI plan, and rich interactivity (real state, animations, keyboard nav). Honor the design language (glass tier, density, motion intent, accent, hero pattern) and surface at least one non-happy-path state (empty/loading) somewhere. Return ONLY the HTML document — no prose, no markdown fence.";

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
  // Load skills in parallel — all cached on first hit. Order in the system
  // message goes lowest precedence → highest:
  //   UI skill (cognitive)  ←  frontend-design (anti-slop)  ←  shadcn primer
  //   (vocab)  ←  project SYSTEM (TASTE_RULE + BASE_RULES)
  const [uiSkillPrefix, frontendDesignPrefix, shadcnPrefix] = await Promise.all([
    loadUiSkillSystem(),
    loadFrontendDesignSkill(),
    loadShadcnSkill(),
  ]);
  const anthropic = getAnthropicClient();
  const resp = await anthropic.messages.create(
    {
      model: OPUS_MODEL,
      // 8000 was too low: these prototypes front-load a large design-token
      // <style> block (dense CSS tokenizes at ~2.2 chars/token), so a ~17KB
      // doc hit the ceiling MID-CSS — before the <body> was ever written.
      // sanitize-html then auto-closed the tags into a valid but BODY-LESS
      // document that renders as "just the background, no components". Give
      // the full single-screen prototype real headroom.
      max_tokens: 16000,
      system: [uiSkillPrefix, frontendDesignPrefix, shadcnPrefix, system]
        .filter(Boolean)
        .join("\n\n"),
      messages: [{ role: "user", content: user }],
    },
    { timeout: 5 * 60 * 1000 },
  );
  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  const raw = extractHtml(text);
  // Truncation / body-less guard. If the model still ran out of budget (or
  // emitted a head-only doc), the raw output won't have a real <body> or a
  // closing </html>. Fail LOUDLY so the card shows an error the user can
  // retry — never silently ship a background-only shell as "ready".
  const looksComplete =
    /<body[\s>]/i.test(raw) && /<\/html\s*>/i.test(raw) && /<\/body\s*>/i.test(raw);
  if (resp.stop_reason === "max_tokens" || !looksComplete) {
    throw new Error(
      "Prototype generation was cut off before the layout finished (the design got too large). Try again — it usually completes on a retry.",
    );
  }
  return sanitizeHtmlT1(raw);
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

/** Regenerate the prototype with the user's feedback applied. `linkedContext`
 *  is the markdown block emitted by hydrateRefineContext (empty when nothing
 *  was wired). */
export function refinePrototypeHtml(
  currentHtml: string,
  feedback: string,
  spec: TechSpec | null,
  taste?: TasteDesignContext | null,
  linkedContext?: string,
): Promise<string> {
  const existingPrototype = currentHtml.trim()
    ? `CURRENT PROTOTYPE HTML:\n${currentHtml.slice(0, 24000)}\n\n`
    : "CURRENT PROTOTYPE HTML:\nNone available. Treat this as a retry after a failed first build; generate the full prototype from the product context and user feedback.\n\n";
  const linked = linkedContext && linkedContext.trim() ? `${linkedContext.trim()}\n\n` : "";
  return opusHtml(
    REFINE_SYSTEM,
    tasteContextBlock(taste) +
      linked +
      existingPrototype +
      (spec ? `PRODUCT CONTEXT:\n${specBrief(spec)}\n\n` : "") +
      `USER FEEDBACK:\n${feedback}\n\nReturn the full revised HTML document.`,
  );
}
