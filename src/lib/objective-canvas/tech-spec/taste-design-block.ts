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
  const hasContent = designMd.trim().length > 0;
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
    return o as unknown as ComposeInput;
  }
  const voice = (o.voice as Record<string, unknown>) ?? {};
  const vocab = (o.vocabulary as Record<string, unknown>) ?? {};
  const sources = Array.isArray(o.sources) ? (o.sources as unknown[]) : [];
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

  if (!sections.length) return "";
  return `# DESIGN.md (taste profile for this space)\n\n${sections.join(
    "\n\n",
  )}\n\nWhen the brief is silent, default to these.`;
}

/** Emit a tailwind.config.ts code block keyed off the trusted brand tokens
 *  in appleVibe, with voice tone surfaced as a top comment so the model can
 *  reason over it. We do NOT derive colors from natural language. */
function renderTailwindConfig(p: ComposeInput): string {
  // If there's nothing taste-bearing AND we'd just emit the bare brand
  // tokens, return empty so we don't bloat the prompt.
  const hasAnyTaste =
    p.voiceTone ||
    p.voiceStyle ||
    p.coined.length ||
    p.tensions.length ||
    p.noGos.length;
  if (!hasAnyTaste) return "";

  const voiceComment = p.voiceTone
    ? `// Voice: ${p.voiceTone}${p.voiceStyle ? ` — ${p.voiceStyle.replace(/\n+/g, " ").slice(0, 200)}` : ""}`
    : "// Voice: (none synthesized yet)";

  const noGoComment = p.noGos.length
    ? `// Anti-patterns: ${p.noGos.join(" · ").slice(0, 240)}`
    : "";

  // Brand tokens — copied from appleVibe so the prototype can reach them by
  // semantic name. Stage colors omitted (room-internal, not surface taste).
  const json = JSON.stringify(
    {
      theme: {
        extend: {
          colors: {
            surface: {
              base: appleVibe.surface.base,
              card: appleVibe.surface.card,
              chip: appleVibe.surface.chip,
            },
            text: {
              primary: appleVibe.text.primary,
              secondary: appleVibe.text.secondary,
              tertiary: appleVibe.text.tertiary,
              faint: appleVibe.text.faint,
            },
            accent: {
              DEFAULT: appleVibe.accent.primary,
              hover: appleVibe.accent.primaryHover,
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
${voiceComment}${noGoComment ? `\n${noGoComment}` : ""}

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
