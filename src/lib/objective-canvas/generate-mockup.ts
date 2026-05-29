// ── Generate HTML mockup for an elected variation (Phase 12) ──
//
// Asks the LLM to imagine a STATIC HTML page that shows what the
// variation's interface would look like — landing screen, primary
// affordances, sample content. No scripts (we strip them on the
// way out). No external resources (no <img src>, no <link href>).
// Pure inline-CSS + semantic HTML so it renders in a sandboxed
// iframe via srcdoc with sandbox="".
//
// The mockup is a sketch, not a real implementation — its job is to
// give the user a visual sense of the variation so they can show
// stakeholders / probe whether the interface matches the mental
// model behind the mechanism. Apple-tier design language is
// requested but not enforced — the LLM does its best with inline
// CSS.

import { llmJSON } from "@/lib/llm";
import type { ItemVariation } from "./expand-item-detail";
import type { OperationalConstraints } from "./constraints";
import type { MechanismSpec } from "./enrich-mechanism-spec";

export interface MockupResult {
  title: string;
  html: string;
}

interface MockupLlmShape {
  title?: unknown;
  html?: unknown;
}

const MOCKUP_SCHEMA = {
  name: "VariationMockup",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      html: { type: "string" },
    },
    required: ["title", "html"],
  },
} as const;

export interface GenerateMockupArgs {
  variation: ItemVariation;
  entityName: string;
  /** Pain text the variation addresses, if known — gives the
   *  mockup something concrete to position against. */
  painText?: string | null;
  /** Parent room title — frames the mockup ("for X room") so the
   *  LLM stays anchored. */
  roomTitle?: string | null;
  constraints?: OperationalConstraints | null;
  /** Op C — output format. "fullscreen" (default) = full HTML doc
   *  for the modal's iframe. "thumbnail" = 480×320 single-screen
   *  version meant for inline display below an expanded variation
   *  row on the CategoryCard. The two formats are persisted in
   *  separate fields so the user can flip between them without
   *  re-spending an LLM call. */
  format?: "fullscreen" | "thumbnail";
  /** Phase A — the parent feature's v2 mechanism spec, when generated.
   *  When present, the mockup RENDERS what the spec says the user sees
   *  (user_visible_behavior + runtime_flow[].user_sees + the UI
   *  components) rather than re-imagining an interface from the 1-line
   *  description. Optional — null when no spec exists. */
  mechanismSpec?: MechanismSpec | null;
}

export async function generateVariationMockup(
  args: GenerateMockupArgs,
): Promise<MockupResult> {
  const format = args.format ?? "fullscreen";
  const formatBlock =
    format === "thumbnail"
      ? `\n\nTHUMBNAIL FORMAT — additional constraints:\n- Set <body style="width: 480px; height: 320px; margin: 0; padding: 16px; overflow: hidden;"> so the iframe fits the inline preview without scrollbars.\n- Show ONE moment: the single screen that best characterizes what this mechanism does for the user. Not a navigation hub, not a multi-section layout.\n- Big primary affordance + 1-2 lines of supporting context + minimal chrome.\n- Typography: 14-16px body, 18-22px primary heading, 12px metadata. Generous line height (1.5+).\n- Color: 1 accent color used sparingly (one primary button, maybe one badge). Everything else greyscale.\n- The user will see this as a small preview embedded in their workspace — make it READ at small size, not be busy.`
      : "";

  const sys = `You design static HTML interface mockups. Output ONE complete HTML document that renders in a sandboxed iframe.

CONSTRAINTS — VIOLATIONS WILL BE STRIPPED AT INGEST:
- NO <script> tags anywhere, NO inline event handlers (onclick=, onload=, etc.), NO javascript: hrefs.
- NO external resources — no <img src=...>, no <link rel=stylesheet>, no <iframe src=>, no fonts from URLs.
- All styling MUST be inline CSS or a single <style> block inside <head>. Use system font stack (system-ui, -apple-system, etc.).
- Use semantic HTML (header, main, section, nav, article, footer).
- Use simple SVG icons inline when you need glyphs — keep them lightweight.

DESIGN BIAS:
- Apple-tier visual restraint: lots of whitespace, soft shadows, hairline borders, rounded corners (12-20px), muted palette, generous line height (1.5+).
- ${format === "thumbnail" ? "480×320 viewport — see THUMBNAIL FORMAT below" : "1200px max content width, centered."}
- Show CONCRETE sample content matching the variation's domain. Avoid lorem ipsum.
- Mockup is one screen / one moment — primary affordance + supporting context. Not a full app.
- GROUNDING: when a "WHAT THE USER SEES" block is provided below, the mockup MUST depict those exact moments + affordances — it is a visual of THIS mechanism's real interface (per its spec), not a reimagined one. Render the named UI components; show the user-visible runtime moment.${formatBlock}

OUTPUT JSON:
{
  "title": "Short label (5-8 words) for this mockup, e.g. 'Intentional Browsing Prompter — onboarding'",
  "html": "<!DOCTYPE html><html>...</html>"  // ONE complete document
}`;

  const ct = args.constraints;
  const constraintsBlock = ct
    ? `\n\nOPERATIONAL CONSTRAINTS the user is working under:\n- Time horizon: ${ct.time_horizon}\n- Budget tier: ${ct.budget_tier}\n- Team size: ${ct.team_size}\n- Risk tolerance: ${ct.risk_tolerance}${ct.compliance_requirements && ct.compliance_requirements.length > 0 ? `\n- Compliance: ${ct.compliance_requirements.join(", ")}` : ""}\n\nLet these shape the mockup's depth (fewer details for short time horizon, simpler UI for solo team, etc.).`
    : "";

  const ms = args.mechanismSpec;
  const specBlock = ms
    ? `\n\nWHAT THE USER SEES (from the mechanism spec — render THIS, don't invent a different interface):\n- User-visible behavior: ${ms.user_visible_behavior.slice(0, 300)}\n- Moments the user sees (runtime): ${
        ms.runtime_flow
          .filter((r) => r.user_sees && r.user_sees !== "—")
          .map((r) => r.user_sees)
          .slice(0, 6)
          .join("  →  ") || "—"
      }\n- Interface components to show: ${
        (ms.system_components.some((c) => c.category.toLowerCase() === "ui")
          ? ms.system_components.filter(
              (c) => c.category.toLowerCase() === "ui",
            )
          : ms.system_components
        )
          .map((c) => c.name)
          .slice(0, 6)
          .join(" · ") || "—"
      }`
    : "";

  const user = `Design a static HTML mockup for this variation:

VARIATION
- Name: ${args.variation.name}
- Description: ${args.variation.description}
- Tradeoff: ${args.variation.tradeoff}

CONTEXT
- Mechanism (entity): ${args.entityName}${args.roomTitle ? `\n- Room: ${args.roomTitle}` : ""}${args.painText ? `\n- Pain it addresses: ${args.painText}` : ""}${constraintsBlock}${specBlock}

Produce one complete HTML document showing the most representative screen of this variation's interface — what a user would see at the key moment of interacting with it.`;

  const raw = await llmJSON<MockupLlmShape>({
    system: sys,
    user,
    responseSchema: MOCKUP_SCHEMA,
    temperature: 0.5,
    maxTokens: 4500,
  });

  const title =
    typeof raw.title === "string" && raw.title.trim().length > 0
      ? raw.title.trim().slice(0, 120)
      : `${args.variation.name} mockup`;
  const html =
    typeof raw.html === "string" ? sanitizeHtml(raw.html) : "<p>(empty)</p>";

  return { title, html };
}

// ── HTML sanitizer ────────────────────────────────────────────────
//
// Belt-and-suspenders defence in depth. The system prompt forbids
// scripts + on* handlers + external resources, but the LLM
// occasionally slips. We strip:
//   - <script>...</script> blocks (including line breaks)
//   - on* attribute handlers (onclick, onerror, onload, etc.)
//   - javascript:/data:text/html in href/src attributes
//   - <iframe>, <object>, <embed> tags entirely (extra paranoid)
//
// The output still renders inside a sandbox="" iframe, so even if
// something slipped through, no script execution is possible. This
// sanitizer is for hygienic readability + defence-in-depth.

export function sanitizeHtml(html: string): string {
  let out = html;
  // Drop <script>...</script> blocks (greedy across newlines).
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  // Drop standalone <script ...> tags that lack closing.
  out = out.replace(/<script\b[^>]*\/?>/gi, "");
  // Drop event handler attributes (on* = "..." or '...' or bareword).
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
  // Neutralize javascript: + data:text/html in href/src.
  out = out.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=""');
  out = out.replace(/(href|src)\s*=\s*("|')\s*data:text\/html[^"']*\2/gi, '$1=""');
  // Drop dangerous tags.
  out = out.replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, "");
  out = out.replace(/<object\b[\s\S]*?<\/object\s*>/gi, "");
  out = out.replace(/<embed\b[^>]*\/?>/gi, "");
  return out;
}
