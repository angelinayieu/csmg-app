// ── taste-design-block — DESIGN.md + tailwind.config.ts from taste-profile ─
//
// v0 / Lovable / Bolt SOTA pattern: a project-root DESIGN.md + tailwind.config.ts
// is the canonical taste vehicle. The model reads both as project facts and
// reasons over a shared token vocabulary instead of inventing its own.
//
// Here we synthesize both, server-side, from the existing taste-profile
// substrate (voice / vocabulary / tensions / no-gos / sources) + the brand's
// appleVibe tokens. Pure — no LLM cost. Composes into the prototype prompt
// before the SPEC block so Opus sees taste BEFORE it sees what to build.
//
// Honest scope: the brand palette comes from appleVibe (already trusted).
// The taste profile contributes voice, vocabulary, tensions, no-gos. We do
// NOT invent palette/spacing tokens from natural language — that hallucinates
// taste. Empty/thin sections are silently omitted, not padded.
//
// Returns hasContent=false when the substrate is genuinely empty, so callers
// can skip the blocks entirely instead of injecting boilerplate.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTasteProfile } from "@/lib/objective-canvas/taste-profile";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface TasteDesignContext {
  /** A DESIGN.md-style markdown block. Empty string when no content. */
  designMd: string;
  /** A tailwind.config.ts code-fence block. Empty string when no content. */
  tailwindConfig: string;
  /** True when at least one block has real content. */
  hasContent: boolean;
}

const EMPTY: TasteDesignContext = {
  designMd: "",
  tailwindConfig: "",
  hasContent: false,
};

/** Fetch the taste-profile for a space and synthesize both blocks. Soft-fails
 *  to EMPTY on any error so the prototype generator stays alive. */
export async function buildTasteDesignContext(
  db: AnyDb,
  spaceId: string,
): Promise<TasteDesignContext> {
  try {
    const found = await getTasteProfile(db, spaceId);
    if (!found) return EMPTY;
    return composeFromSnapshot(found.snapshot);
  } catch (err) {
    console.warn("[taste-design-block] failed (soft):", err);
    return EMPTY;
  }
}

/** Pure composer — testable without a DB. Accepts either a raw
 *  TasteProfileSnapshot or a pre-flattened ComposeInput; normalizer handles
 *  both. */
export function composeFromSnapshot(snapshot: unknown): TasteDesignContext {
  const profile = normalizeForCompose(snapshot);
  const designMd = renderDesignMd(profile);
  const tailwindConfig = renderTailwindConfig(profile);
  const hasContent =
    designMd.trim().length > 0 || tailwindConfig.trim().length > 0;
  return { designMd, tailwindConfig, hasContent };
}

// ── pure renderers ──────────────────────────────────────────────────

interface ComposeInput {
  voiceTone: string;
  voiceStyle: string;
  coined: string[];
  grounded: string[];
  tensions: string[];
  noGos: string[];
  sourceConceptSlugs: string[];
  sourceNarratives: string[];
  styleDominantPalette: string[];
  styleAccentPalette: string[];
  stylePaletteTemperature: string;
  styleTypographyVoice: string;
  styleCompositionDensity: string;
  styleCompositionGrid: string;
  styleRecurringPatterns: string[];
  styleMotionCues: string[];
  styleSignalStrength: number;
  styleSourceCount: number;
}

/** Normalize a TasteProfileSnapshot (or anything snapshot-shaped) to the flat
 *  string lists the renderers want. Defensive on legacy shapes. */
export function normalizeForCompose(raw: unknown): ComposeInput {
  // Accept either a full TasteProfileSnapshot or an already-flat ComposeInput.
  const o = (raw ?? {}) as Record<string, unknown>;
  if (
    Array.isArray(o.coined) &&
    Array.isArray(o.grounded) &&
    typeof o.voiceTone === "string"
  ) {
    const flat = o as unknown as Partial<ComposeInput>;
    return {
      voiceTone: flat.voiceTone ?? "",
      voiceStyle: flat.voiceStyle ?? "",
      coined: flat.coined ?? [],
      grounded: flat.grounded ?? [],
      tensions: flat.tensions ?? [],
      noGos: flat.noGos ?? [],
      sourceConceptSlugs: flat.sourceConceptSlugs ?? [],
      sourceNarratives: flat.sourceNarratives ?? [],
      styleDominantPalette: flat.styleDominantPalette ?? [],
      styleAccentPalette: flat.styleAccentPalette ?? [],
      stylePaletteTemperature: flat.stylePaletteTemperature ?? "unknown",
      styleTypographyVoice: flat.styleTypographyVoice ?? "unknown",
      styleCompositionDensity: flat.styleCompositionDensity ?? "unknown",
      styleCompositionGrid: flat.styleCompositionGrid ?? "unknown",
      styleRecurringPatterns: flat.styleRecurringPatterns ?? [],
      styleMotionCues: flat.styleMotionCues ?? [],
      styleSignalStrength: flat.styleSignalStrength ?? 0,
      styleSourceCount: flat.styleSourceCount ?? 0,
    };
  }
  const voice = (o.voice as Record<string, unknown>) ?? {};
  const vocab = (o.vocabulary as Record<string, unknown>) ?? {};
  const sources = Array.isArray(o.sources) ? (o.sources as unknown[]) : [];
  const style =
    o.style_synthesis && typeof o.style_synthesis === "object"
      ? (o.style_synthesis as Record<string, unknown>)
      : {};
  const termsOf = (bucket: unknown): string[] =>
    Array.isArray(bucket)
      ? (bucket as unknown[])
          .map((entry) => {
            if (typeof entry === "string") return entry;
            if (entry && typeof entry === "object" && "term" in entry) {
              const t = (entry as { term?: unknown }).term;
              return typeof t === "string" ? t : "";
            }
            return "";
          })
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const stringList = (raw: unknown, max: number): string[] =>
    Array.isArray(raw)
      ? (raw as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, max)
      : [];
  const hexList = (raw: unknown, max: number): string[] =>
    Array.isArray(raw)
      ? (raw as unknown[])
          .filter(
            (x): x is string =>
              typeof x === "string" && /^#[0-9a-f]{6}$/.test(x),
          )
          .slice(0, max)
      : [];
  const sourceConceptSlugs = sources
    .flatMap((s) => {
      if (!s || typeof s !== "object") return [];
      const slugs = (s as { conceptSlugs?: unknown }).conceptSlugs;
      return Array.isArray(slugs)
        ? (slugs as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
    })
    .slice(0, 24);
  return {
    voiceTone: typeof voice.tone === "string" ? voice.tone.trim() : "",
    voiceStyle: typeof voice.style === "string" ? voice.style.trim() : "",
    coined: termsOf(vocab.coined).slice(0, 18),
    grounded: termsOf(vocab.grounded).slice(0, 12),
    tensions: stringList(o.tensions, 4),
    noGos: stringList(o.no_gos, 4),
    sourceConceptSlugs,
    sourceNarratives: [],
    styleDominantPalette: hexList(style.dominant_palette, 4),
    styleAccentPalette: hexList(style.accent_palette, 2),
    stylePaletteTemperature:
      typeof style.palette_temperature === "string"
        ? style.palette_temperature
        : "unknown",
    styleTypographyVoice:
      typeof style.typography_voice === "string"
        ? style.typography_voice
        : "unknown",
    styleCompositionDensity:
      typeof style.composition_density === "string"
        ? style.composition_density
        : "unknown",
    styleCompositionGrid:
      typeof style.composition_grid === "string"
        ? style.composition_grid
        : "unknown",
    styleRecurringPatterns: stringList(style.recurring_patterns, 6),
    styleMotionCues: stringList(style.motion_cues, 4),
    styleSignalStrength:
      typeof style.signal_strength === "number" &&
      Number.isFinite(style.signal_strength)
        ? Math.max(0, Math.min(1, style.signal_strength))
        : 0,
    styleSourceCount:
      typeof style.source_count === "number" && style.source_count > 0
        ? Math.floor(style.source_count)
        : 0,
  };
}

function renderDesignMd(p: ComposeInput): string {
  const sections: string[] = [];

  // Voice — the single most important block. The model reads tone first.
  if (p.voiceTone || p.voiceStyle) {
    sections.push(
      `## Voice\n${p.voiceTone ? `**Tone:** ${p.voiceTone}\n` : ""}${
        p.voiceStyle ? `${p.voiceStyle}` : ""
      }`.trim(),
    );
  }

  // Vocabulary — the user's earned + grounded terms. Use these literally.
  if (p.coined.length || p.grounded.length) {
    const lines: string[] = [];
    if (p.coined.length) {
      lines.push(
        `**Yours (use literally):** ${p.coined.map((t) => `\`${t}\``).join(", ")}`,
      );
    }
    if (p.grounded.length) {
      lines.push(
        `**Grounded (use when relevant):** ${p.grounded
          .map((t) => `\`${t}\``)
          .join(", ")}`,
      );
    }
    sections.push(`## Vocabulary\n${lines.join("\n")}`);
  }

  if (p.tensions.length) {
    sections.push(
      `## Tradeoffs the user actively weighs\n${p.tensions
        .map((t) => `- ${t}`)
        .join("\n")}`,
    );
  }

  if (p.noGos.length) {
    sections.push(
      `## Anti-patterns (do NOT do these)\n${p.noGos
        .map((t) => `- ${t}`)
        .join("\n")}`,
    );
  }

  if (p.sourceConceptSlugs.length) {
    sections.push(
      `## Visual references (concept slugs from analyzed images)\n${p.sourceConceptSlugs
        .map((s) => `\`${s}\``)
        .join(", ")}`,
    );
  }

  const visualStyle = renderVisualStyleBlock(p);
  if (visualStyle) sections.push(visualStyle);

  if (!sections.length) return "";
  return `# DESIGN.md (taste profile for this space)\n\n${sections.join(
    "\n\n",
  )}\n\nWhen the brief is silent, default to these.`;
}

function renderVisualStyleBlock(p: ComposeInput): string {
  if (p.styleSourceCount <= 0) return "";
  const lines: string[] = [];
  if (p.styleDominantPalette.length) {
    lines.push(`- Dominant palette: ${p.styleDominantPalette.join(", ")}`);
  }
  if (p.styleAccentPalette.length) {
    lines.push(`- Accent palette: ${p.styleAccentPalette.join(", ")}`);
  }
  const axes = [
    p.stylePaletteTemperature !== "unknown"
      ? `temperature=${p.stylePaletteTemperature}`
      : "",
    p.styleTypographyVoice !== "unknown"
      ? `type=${p.styleTypographyVoice}`
      : "",
    p.styleCompositionDensity !== "unknown"
      ? `density=${p.styleCompositionDensity}`
      : "",
    p.styleCompositionGrid !== "unknown" ? `grid=${p.styleCompositionGrid}` : "",
  ].filter(Boolean);
  if (axes.length) lines.push(`- Visual axes: ${axes.join(", ")}`);
  if (p.styleRecurringPatterns.length) {
    lines.push(`- Recurring UI patterns: ${p.styleRecurringPatterns.join(", ")}`);
  }
  if (p.styleMotionCues.length) {
    lines.push(`- Motion cues: ${p.styleMotionCues.join(", ")}`);
  }
  if (!lines.length) return "";
  return `## Visual style (from ${p.styleSourceCount} analyzed reference${
    p.styleSourceCount === 1 ? "" : "s"
  })\n${lines.join("\n")}`;
}

function hasStrongVisualStyle(p: ComposeInput): boolean {
  return (
    p.styleSignalStrength >= 0.6 &&
    p.styleSourceCount >= 3 &&
    p.styleDominantPalette.length >= 3
  );
}

/** Emit a tailwind.config.ts code block keyed off the trusted brand tokens
 *  in appleVibe, with voice tone surfaced as a top comment so the model can
 *  reason over it. Natural language never creates colors; only analyzed
 *  image references can override the palette, and only above the confidence
 *  gate in hasStrongVisualStyle(). */
function renderTailwindConfig(p: ComposeInput): string {
  // If there's nothing taste-bearing AND we'd just emit the bare brand
  // tokens, return empty so we don't bloat the prompt.
  const hasAnyTaste =
    p.voiceTone ||
    p.voiceStyle ||
    p.coined.length ||
    p.tensions.length ||
    p.noGos.length ||
    p.styleSourceCount > 0;
  if (!hasAnyTaste) return "";

  const voiceComment = p.voiceTone
    ? `// Voice: ${p.voiceTone}${p.voiceStyle ? ` — ${p.voiceStyle.replace(/\n+/g, " ").slice(0, 200)}` : ""}`
    : "// Voice: (none synthesized yet)";

  const noGoComment = p.noGos.length
    ? `// Anti-patterns: ${p.noGos.join(" · ").slice(0, 240)}`
    : "";

  const strongVisual = hasStrongVisualStyle(p);
  const referenceComment =
    p.styleSourceCount > 0
      ? `// Visual references: ${p.styleSourceCount} analyzed, signal=${p.styleSignalStrength.toFixed(
          2,
        )}${strongVisual ? " (palette override active)" : " (brand palette retained)"}`
      : "";

  const referenceAccent =
    p.styleAccentPalette[0] ??
    p.styleDominantPalette[2] ??
    appleVibe.accent.primary;
  const referenceAccentHover =
    p.styleAccentPalette[1] ??
    p.styleDominantPalette[3] ??
    appleVibe.accent.primaryHover;

  // Brand tokens — copied from appleVibe so the prototype can reach them by
  // semantic name. Stage colors omitted (room-internal, not surface taste).
  // When the image-derived style clears the confidence gate, the main surface
  // and accent tokens shift to that empirical reference palette.
  const json = JSON.stringify(
    {
      theme: {
        extend: {
          colors: {
            surface: {
              base: strongVisual
                ? p.styleDominantPalette[0]
                : appleVibe.surface.base,
              card: strongVisual
                ? p.styleDominantPalette[1]
                : appleVibe.surface.card,
              chip: strongVisual
                ? p.styleDominantPalette[2]
                : appleVibe.surface.chip,
            },
            text: {
              primary: appleVibe.text.primary,
              secondary: appleVibe.text.secondary,
              tertiary: appleVibe.text.tertiary,
              faint: appleVibe.text.faint,
            },
            accent: {
              DEFAULT: strongVisual ? referenceAccent : appleVibe.accent.primary,
              hover: strongVisual ? referenceAccentHover : appleVibe.accent.primaryHover,
            },
            reference: {
              dominant: p.styleDominantPalette,
              accent: p.styleAccentPalette,
            },
            stroke: {
              hairline: appleVibe.stroke.hairline,
              soft: appleVibe.stroke.soft,
              medium: appleVibe.stroke.medium,
            },
          },
          borderRadius: {
            sm: `${appleVibe.radius.sm}px`,
            md: `${appleVibe.radius.md}px`,
            lg: `${appleVibe.radius.lg}px`,
            xl: `${appleVibe.radius.xl}px`,
            pill: "9999px",
          },
          boxShadow: {
            card: appleVibe.shadow.card,
            chip: appleVibe.shadow.chip,
            "card-hover": appleVibe.shadow.cardHover,
          },
          fontFamily: {
            sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
          },
        },
      },
    },
    null,
    2,
  );

  return `\`\`\`ts
// tailwind.config.ts — derived from this space's taste-profile.
${voiceComment}${noGoComment ? `\n${noGoComment}` : ""}${
    referenceComment ? `\n${referenceComment}` : ""
  }

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  ${json
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .trim()
    .replace(/^/, "")
    .replace(/\n/g, "\n  ")},
};

export default config;
\`\`\``;
}
