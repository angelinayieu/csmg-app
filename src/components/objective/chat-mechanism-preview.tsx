"use client";

// ── ChatMechanismPreview ──────────────────────────────────────────
//
// A premium glass card that surfaces a mechanism spec's designed
// experience layer INLINE in the lab notebook chat — so the user
// reads the design without opening the drawer (the drawer being
// invisible per the project's "user only sees chat + brief" rule).
//
// This is the chat-side answer to "does the card UI show a preview".
// It's a compact, designed card derived from:
//   • `RichNarrationMeta` (the metadata every notebook event carries
//     post Step 8 — narration_title, narration_body, narration_facts,
//     narration_deep_link, narration_tags)
//   • `ExperienceBriefSection` (optional — the v3 design payload
//     composed by `composeExperienceBriefSection`)
//
// Designed as a DROP-IN: the parallel notebook redesign per
// `NOTEBOOK_TIMELINE_PLAN.md` imports this and renders it when a
// row's `metadata.narration_deep_link.kind === "drawer"` and a
// mechanism experience is attached.
//
// Style discipline (matches the brief's premium aesthetic):
//   • One restrained accent driven by `accent_intent`
//   • Glass card via `globals.css` `.glass-card`-equivalent inline tokens
//   • Hairline borders only — never bolder
//   • Type does the work: tabular numerals, uppercase tracking-wide
//     eyebrows, restrained weight contrast
//   • No icons on the touchpoints — colored dots only (per user's
//     established UI taste: no cheap stock icons)
//   • Single hero "beat" (the lead interaction sketch), not the
//     whole script — the brief shows the rest; the chat is the
//     headline trailer
//
// Reference: INTAKE_TO_BRIEF_SURFACING_PLAN.md §3.1 (notebook
// redesign), MECHANISM_EXPERIENCE_SPEC.md §3b (Experience tab).

import { memo } from "react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ExperienceBriefSection } from "@/lib/objective-canvas/compose-experience-brief-section";
import type {
  NarrationDeepLink,
  NarrationFact,
  RichNarrationMeta,
} from "@/lib/objective-canvas/compose-rich-narration";

// ─── Accent palette (mirrors mechanism-experience-view.tsx) ──────

type AccentIntent = NonNullable<
  ExperienceBriefSection["accent_intent"]
>;

interface AccentPalette {
  primary: string;
  tint: string;
  ink: string;
}

const ACCENT: Record<AccentIntent, AccentPalette> = {
  signal: {
    primary: "rgba(10,132,255,1)",
    tint: "rgba(10,132,255,0.10)",
    ink: "rgba(28,71,135,0.95)",
  },
  warning: {
    primary: "rgba(217,119,6,1)",
    tint: "rgba(217,119,6,0.10)",
    ink: "rgba(146,64,14,0.95)",
  },
  growth: {
    primary: "rgba(22,163,74,1)",
    tint: "rgba(22,163,74,0.10)",
    ink: "rgba(22,101,52,0.95)",
  },
  insight: {
    primary: "rgba(124,58,237,1)",
    tint: "rgba(124,58,237,0.10)",
    ink: "rgba(67,33,138,0.95)",
  },
  neutral: {
    primary: "rgba(15,23,42,0.78)",
    tint: "rgba(15,23,42,0.05)",
    ink: "rgba(15,23,42,0.62)",
  },
};

// ─── Fact tone (mirrors RichNarrationMeta) ───────────────────────

const FACT_TONE: Record<
  NonNullable<NarrationFact["tone"]>,
  string
> = {
  neutral: appleVibe.text.tertiary,
  positive: "rgba(22,101,52,0.85)",
  warning: "rgba(146,64,14,0.85)",
  insight: "rgba(67,33,138,0.85)",
};

// ─── Public props ────────────────────────────────────────────────

export interface ChatMechanismPreviewProps {
  /** The narration metadata the notebook row carries. Provides title,
   *  body, facts, deep-link, tags. All optional fields — the card
   *  renders only what's present. */
  narration: RichNarrationMeta;
  /** Optional v3 experience payload — when present, the card upgrades
   *  from "headline + facts" to "designed preview" with hero pattern
   *  caption + touchpoints + lead interaction beat. */
  experience?: ExperienceBriefSection | null;
  /** Click handler for the deep-link affordance. The host wires this
   *  to the appropriate navigation behavior (open drawer at the
   *  spec/experience tab, scroll brief to a section, focus a canvas
   *  view). When omitted, the affordance renders unclickable. */
  onDeepLink?: (link: NarrationDeepLink) => void;
}

// ─── Component ───────────────────────────────────────────────────

function ChatMechanismPreviewInner({
  narration,
  experience,
  onDeepLink,
}: ChatMechanismPreviewProps) {
  // Fall back to neutral when no experience is attached — the card
  // still renders a clean headline + facts card.
  const accentIntent: AccentIntent = experience?.accent_intent ?? "neutral";
  const accent = ACCENT[accentIntent];
  const heroCaption = experience?.hero_pattern_caption ?? null;
  const intentSummary = experience?.intent_summary ?? null;
  const leadBeat =
    experience?.interaction_beats?.[0]?.sketch?.trim() ?? null;
  const touchpoints = experience?.touchpoints ?? [];
  const facts = narration.narration_facts ?? [];
  const deepLink = narration.narration_deep_link;

  // Skip render when there's nothing meaningful to show.
  if (
    !narration.narration_title &&
    !narration.narration_body &&
    !experience &&
    facts.length === 0
  ) {
    return null;
  }

  return (
    <div
      role="article"
      aria-label={narration.narration_title ?? "Mechanism preview"}
      style={{
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(18px) saturate(1.5)",
        WebkitBackdropFilter: "blur(18px) saturate(1.5)",
        border: "1px solid rgba(255,255,255,0.5)",
        borderRadius: 20,
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.72) inset, 0 14px 36px -16px rgba(11,18,40,0.20)",
        padding: 16,
        position: "relative",
        overflow: "hidden",
      }}
      className="flex flex-col gap-3"
    >
      {/* Ambient corner halo in the accent tint — same idiom as the
          drawer Experience view. Pointer-events:none keeps it
          decorative. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full"
        style={{
          background: `radial-gradient(circle, ${accent.tint} 0%, transparent 70%)`,
          filter: "blur(10px)",
        }}
      />

      {/* ── Title row ── */}
      {narration.narration_title && (
        <div className="flex items-baseline justify-between gap-2">
          <span
            className="text-[13px] font-semibold leading-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.01em",
            }}
          >
            {narration.narration_title}
          </span>
          {heroCaption && (
            <span
              className="flex-shrink-0 text-[10px] font-medium uppercase tracking-[0.14em]"
              style={{ color: accent.ink }}
            >
              {heroCaption}
            </span>
          )}
        </div>
      )}

      {/* ── Body ── */}
      {narration.narration_body && (
        <p
          className="text-[12.5px] font-light leading-[1.55]"
          style={{
            color: appleVibe.text.secondary,
            letterSpacing: "-0.005em",
          }}
        >
          {narration.narration_body}
        </p>
      )}

      {/* ── Designed preview band — renders only when v3 experience
              is attached. Three sub-rows: intent summary, touchpoints,
              lead interaction beat. ── */}
      {experience && (
        <div
          className="flex flex-col gap-2 rounded-2xl p-3"
          style={{
            background: "rgba(255,255,255,0.55)",
            border: "1px solid rgba(255,255,255,0.65)",
          }}
        >
          {intentSummary && (
            <div className="flex items-baseline gap-1.5">
              <span
                className="font-semibold uppercase"
                style={{
                  color: appleVibe.text.tertiary,
                  fontSize: 9.5,
                  letterSpacing: "0.14em",
                }}
              >
                Designed
              </span>
              <span
                className="text-[11.5px] font-light"
                style={{
                  color: appleVibe.text.primary,
                  letterSpacing: "-0.005em",
                }}
              >
                {intentSummary}
              </span>
            </div>
          )}

          {touchpoints.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
              {touchpoints.map((tp, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block rounded-full"
                    style={{
                      width: 5,
                      height: 5,
                      background:
                        tp.kind === "background" || tp.kind === "ambient"
                          ? appleVibe.text.tertiary
                          : accent.primary,
                      opacity: tp.kind === "background" ? 0.5 : 1,
                    }}
                  />
                  <span
                    className="text-[10px] font-medium uppercase"
                    style={{
                      color: appleVibe.text.secondary,
                      letterSpacing: "0.12em",
                    }}
                  >
                    {tp.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {leadBeat && (
            <div className="flex gap-2">
              <span
                className="flex-shrink-0 font-light"
                style={{
                  fontSize: 10,
                  color: accent.primary,
                  fontVariantNumeric: "tabular-nums",
                  width: 14,
                }}
              >
                1.
              </span>
              <p
                className="text-[11.5px] font-light leading-[1.5]"
                style={{
                  color: appleVibe.text.primary,
                  letterSpacing: "-0.005em",
                }}
              >
                {leadBeat}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Facts row — small chips, restrained color tones per fact tone ── */}
      {facts.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {facts.slice(0, 6).map((f, i) => (
            <span
              key={i}
              className="inline-flex items-baseline gap-1"
              style={{
                color: f.tone ? FACT_TONE[f.tone] : appleVibe.text.tertiary,
              }}
            >
              <span
                className="font-semibold uppercase"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.14em",
                  color: appleVibe.text.tertiary,
                }}
              >
                {f.label}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {f.value}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* ── Deep-link affordance — bottom-right, minimal "Open" with
              the chevron. Matches the brief's "Open mechanism" idiom. ── */}
      {deepLink && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => onDeepLink?.(deepLink)}
            disabled={!onDeepLink}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed"
            style={{
              background: accent.tint,
              color: accent.ink,
              border: `1px solid ${accent.tint}`,
            }}
          >
            {deepLink.label ?? "Open"}
            <span
              aria-hidden
              style={{
                fontSize: 9,
                marginTop: -1,
              }}
            >
              ›
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export const ChatMechanismPreview = memo(ChatMechanismPreviewInner);
ChatMechanismPreview.displayName = "ChatMechanismPreview";
