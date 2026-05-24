// Screen-generation prompt builder.
//
// Critical design move: GROUND the image prompt in the artifact's
// ACTUAL data (name, type, key metrics, intervention list, layer
// ontology, target outcomes). The difference between a generic
// "dashboard mockup" and a screen that READS as a real prototype
// for THIS user's THIS specific output is everything the prompt
// carries.
//
// Anti-patterns this prompt actively fights:
//   1. Lorem ipsum / placeholder text — every label must come from
//      the artifact context. If we don't have a real label, omit
//      the section rather than fabricate one.
//   2. Generic stock-photo aesthetic — we ask for clean wireframe
//      / Figma-style instead of marketing-site polish.
//   3. Skeuomorphic gradients — we want flat, premium, calm.
//   4. Mismatched aspect ratios — we hard-code the mockup's framing
//      to match the requested artifact_type.

export type ArtifactType = "mobile" | "web" | "twin" | "custom";
export type AspectRatio = "portrait" | "landscape" | "square";

/**
 * The structured context we pass to the image-generation prompt.
 * Every field is optional EXCEPT target_label so we can degrade
 * gracefully when the user generates from a partially-populated row.
 */
export interface ScreenGenerationContext {
  // The artifact this screen represents
  target_label: string;
  target_kind: "app" | "variation" | "strategy" | "twin" | "intervention" | "generic";

  // Light context — anything we know about the target
  target_summary?: string | null;
  app_type?: string | null;
  status?: string | null;

  // Key signals to anchor the mockup's content
  intervention_titles?: string[];
  metric_names?: string[];          // outcome metrics for the dashboard / app
  goal_summary?: string | null;     // the optimization point this serves
  posture?: string | null;          // strategy posture if applicable
  // Top entities (claims) the artifact addresses — used for headline copy
  top_entity_names?: string[];

  // User-provided constraints
  custom_brief?: string | null;

  // Aspect ratio derived from artifact_type
  artifact_type: ArtifactType;
  aspect_ratio: AspectRatio;
}

/**
 * Maps each artifact type to:
 *   - The mockup framing prompt (mobile vs. web vs. dashboard)
 *   - The default aspect ratio
 *   - The OpenAI gpt-image-1 `size` parameter
 */
export const ARTIFACT_TYPE_SPEC: Record<
  ArtifactType,
  {
    aspect: AspectRatio;
    // gpt-image-1 supports: 1024x1024 (square), 1024x1536 (portrait),
    // 1536x1024 (landscape), or 'auto'. Use these literals.
    size: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
    framingDescription: string;
  }
> = {
  mobile: {
    aspect: "portrait",
    size: "1024x1536",
    framingDescription:
      "a high-fidelity mobile app screen shown inside a thin minimalist phone frame. " +
      "Status bar at top, single primary action visible, vertical stack of components, " +
      "rounded card surfaces with generous corner radii, generous bottom safe-area.",
  },
  web: {
    aspect: "landscape",
    size: "1536x1024",
    framingDescription:
      "a high-fidelity web application dashboard inside a minimalist browser-chrome " +
      "frame (single muted URL bar, no decorative tabs). Sidebar on the left for " +
      "navigation, main content area on the right with cards + a hero chart, " +
      "generous whitespace, structured 12-column grid feel.",
  },
  twin: {
    aspect: "landscape",
    size: "1536x1024",
    framingDescription:
      "a high-fidelity digital-twin operations dashboard. Top strip shows live state " +
      "tiles for the entity's key metrics, center contains a topology / node-link " +
      "diagram of the twin's mechanisms, right rail shows recent events + projected " +
      "outcomes. Operations-grade, dark UI permitted if it matches the data density.",
  },
  custom: {
    aspect: "landscape",
    size: "1536x1024",
    framingDescription:
      "a high-fidelity prototype that best fits the user-provided brief below. " +
      "Pick the format (mobile / web / dashboard / printed report) that the brief " +
      "implies; default to a web dashboard if ambiguous.",
  },
};

const STYLE_BLOCK = `
STYLE
- High-fidelity, premium product-design quality. Read as a real screen, not a wireframe sketch.
- Calm, restrained palette: predominantly neutral grays, white, and one accent color used sparingly for primary actions and key metrics.
- Generous whitespace. 12-column grid feel. Tight typography hierarchy.
- Flat (no skeuomorphism), modest shadows for elevation only.
- All copy is REAL — every label, button, metric, and chip should reflect the artifact context below.
- Never invent generic placeholder text like "Lorem ipsum" or "Sample Data".
- No watermarks, no app-store badges, no logos beyond what's implied by the artifact label.
`.trim();

const ANTI_PATTERN_BLOCK = `
DO NOT
- Do not include any fake brand logos, app-store badges, or watermarks.
- Do not render lorem ipsum, sample data, or "X / Y / Z" placeholders.
- Do not depict real people or photographic faces.
- Do not produce a gradient-heavy marketing-site aesthetic — this is an internal tool prototype.
- Do not over-cluster — favor 5–8 distinct elements over 20 small ones.
`.trim();

/**
 * Build the final prompt sent to gpt-image-1. The prompt has 4
 * sections: framing (artifact_type) → context (the artifact's data)
 * → style → anti-patterns. The image model reads the whole thing
 * as a single instruction.
 */
export function buildScreenGenerationPrompt(
  ctx: ScreenGenerationContext,
): string {
  const spec = ARTIFACT_TYPE_SPEC[ctx.artifact_type];

  // ── Context block ─────────────────────────────────────────────────
  // Each line is added ONLY when we have real data — empty fields are
  // skipped so the model isn't asked to fill in placeholders.
  const contextLines: string[] = [];
  contextLines.push(
    `Title of the artifact: "${ctx.target_label}" (a ${ctx.target_kind}${
      ctx.app_type ? ` of type ${ctx.app_type}` : ""
    }).`,
  );
  if (ctx.target_summary) {
    contextLines.push(`Purpose: ${ctx.target_summary}`);
  }
  if (ctx.goal_summary) {
    contextLines.push(
      `Optimization point this artifact serves: ${ctx.goal_summary}`,
    );
  }
  if (ctx.posture) {
    contextLines.push(`Strategic posture: ${ctx.posture}.`);
  }
  if (ctx.intervention_titles && ctx.intervention_titles.length > 0) {
    contextLines.push(
      `Key interventions to surface (render each as a labeled card / chip / row): ${ctx.intervention_titles
        .slice(0, 5)
        .map((s) => `"${s}"`)
        .join(", ")}.`,
    );
  }
  if (ctx.metric_names && ctx.metric_names.length > 0) {
    contextLines.push(
      `Metrics to display prominently (render with current and target values, treat numerical content as plausible but unfilled): ${ctx.metric_names
        .slice(0, 4)
        .map((s) => `"${s}"`)
        .join(", ")}.`,
    );
  }
  if (ctx.top_entity_names && ctx.top_entity_names.length > 0) {
    contextLines.push(
      `Key concepts this serves (use these as section / nav labels): ${ctx.top_entity_names
        .slice(0, 5)
        .map((s) => `"${s}"`)
        .join(", ")}.`,
    );
  }
  if (ctx.status) {
    contextLines.push(
      `Status badge to render somewhere visible: "${ctx.status.toUpperCase()}".`,
    );
  }

  // ── Custom brief (if user provided) ──
  let customBriefBlock = "";
  if (ctx.custom_brief && ctx.custom_brief.trim().length > 0) {
    customBriefBlock = `\n\nUSER BRIEF (TAKE PRECEDENCE OVER DEFAULT FRAMING WHERE THEY CONFLICT)\n${ctx.custom_brief.trim()}`;
  }

  return [
    `Generate ${spec.framingDescription}`,
    ``,
    `ARTIFACT CONTEXT`,
    ...contextLines,
    customBriefBlock,
    ``,
    STYLE_BLOCK,
    ``,
    ANTI_PATTERN_BLOCK,
  ]
    .join("\n")
    .trim();
}

/**
 * Auto-recommend an artifact_type from light heuristics:
 *   - app_type contains "mobile" / "ios" / "android" → mobile
 *   - app_type contains "web" / "dashboard" / "tool" → web
 *   - target_kind is 'twin' → twin
 *   - target_kind is 'strategy' → twin (strategy needs the dashboard view)
 *   - otherwise → web (the safe default)
 *
 * Used to PRE-SELECT a chip in the GenerateScreenModal; the user can
 * always override.
 */
export function recommendArtifactType(opts: {
  target_kind?: string | null;
  app_type?: string | null;
}): ArtifactType {
  const t = (opts.target_kind ?? "").toLowerCase();
  const a = (opts.app_type ?? "").toLowerCase();
  if (a.includes("mobile") || a.includes("ios") || a.includes("android")) {
    return "mobile";
  }
  if (a.includes("web") || a.includes("dashboard") || a.includes("tool")) {
    return "web";
  }
  if (t === "twin" || t === "strategy") {
    return "twin";
  }
  return "web";
}
