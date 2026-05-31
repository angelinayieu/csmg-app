"use client";

// ── MechanismDesignArtifactView ───────────────────────────────────
//
// The premium renderer for Claude-composed mechanism design
// artifacts. Closes the user's session-1 ask ("Claude generates the
// final UI artifacts") via a STRUCTURED-artifact path:
//   • Claude composes 2-5 sections (hero + moments + flow + stats +
//     callouts + before/after) with headline-level copy
//   • This renderer maps each section to premium React
//   • All visuals enforced by code — no Claude pick can produce a
//     "cheap" result
//   • No sandbox, no eval, no XSS surface
//
// Design discipline (same as the Experience view + brief render):
//   • One restrained accent driven by `intent.accent_intent`
//   • Glass substrate via `globals.css` tier tokens
//   • Hairline borders only
//   • Type does the work — tabular numerals, uppercase tracking
//     eyebrows, generous letter spacing on large headlines
//   • Minimal motion — fade-in on mount, optional breathing on hero
//
// Reference:
//   • mechanism-design-artifact.ts (the data shape)
//   • MECHANISM_EXPERIENCE_SPEC.md
//   • Session 1 user message ("make the designs look really cool,
//     no cheap ugly basic designs")

import { Fragment, memo } from "react";
import {
  AnimatePresence,
  motion as fmotion,
  useReducedMotion,
} from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  DesignArtifact,
  DesignSection,
  DesignSectionBeforeAfter,
  DesignSectionCallout,
  DesignSectionFlow,
  DesignSectionHero,
  DesignSectionMoment,
  DesignSectionQuote,
  DesignSectionStats,
  DesignToneKind,
} from "@/lib/objective-canvas/mechanism-design-artifact";
import type { MechanismDesignIntent } from "@/lib/objective-canvas/enrich-mechanism-spec";

// ─── Accent palette ──────────────────────────────────────────────

type AccentIntent = MechanismDesignIntent["accent_intent"];

interface AccentPalette {
  primary: string;
  tint: string;
  ink: string;
  rim: string;
}

const ACCENT: Record<AccentIntent, AccentPalette> = {
  signal: {
    primary: "rgba(10,132,255,1)",
    tint: "rgba(10,132,255,0.10)",
    ink: "rgba(28,71,135,0.95)",
    rim: "rgba(10,132,255,0.18)",
  },
  warning: {
    primary: "rgba(217,119,6,1)",
    tint: "rgba(217,119,6,0.10)",
    ink: "rgba(146,64,14,0.95)",
    rim: "rgba(217,119,6,0.20)",
  },
  growth: {
    primary: "rgba(22,163,74,1)",
    tint: "rgba(22,163,74,0.10)",
    ink: "rgba(22,101,52,0.95)",
    rim: "rgba(22,163,74,0.20)",
  },
  insight: {
    primary: "rgba(124,58,237,1)",
    tint: "rgba(124,58,237,0.10)",
    ink: "rgba(67,33,138,0.95)",
    rim: "rgba(124,58,237,0.18)",
  },
  neutral: {
    primary: "rgba(15,23,42,0.78)",
    tint: "rgba(15,23,42,0.05)",
    ink: "rgba(15,23,42,0.62)",
    rim: "rgba(15,23,42,0.12)",
  },
};

// ─── Glass tier substrate ────────────────────────────────────────

type GlassTier = MechanismDesignIntent["glass_tier"];

const TIER: Record<
  GlassTier,
  { bg: string; blur: number; shadow: string; radius: number }
> = {
  plate: {
    bg: "rgba(255,255,255,0.55)",
    blur: 12,
    shadow:
      "0 1px 0 rgba(255,255,255,0.6) inset, 0 6px 18px -10px rgba(11,18,40,0.16)",
    radius: 18,
  },
  card: {
    bg: "rgba(255,255,255,0.72)",
    blur: 18,
    shadow:
      "0 1px 0 rgba(255,255,255,0.72) inset, 0 14px 36px -16px rgba(11,18,40,0.20)",
    radius: 20,
  },
  float: {
    bg: "rgba(255,255,255,0.82)",
    blur: 26,
    shadow:
      "0 1px 0 rgba(255,255,255,0.85) inset, 0 22px 48px -16px rgba(11,18,40,0.26)",
    radius: 22,
  },
  hero: {
    bg: "rgba(255,255,255,0.86)",
    blur: 36,
    shadow:
      "0 1px 0 rgba(255,255,255,0.9) inset, 0 32px 64px -20px rgba(11,18,40,0.30)",
    radius: 24,
  },
};

// ─── Density padding ─────────────────────────────────────────────

const PAD: Record<MechanismDesignIntent["density"], number> = {
  airy: 32,
  comfortable: 22,
  dense: 16,
};

// ─── Tone resolution for callouts / stats ────────────────────────

const TONE: Record<DesignToneKind, { primary: string; tint: string; ink: string }> = {
  neutral: {
    primary: "rgba(15,23,42,0.65)",
    tint: "rgba(15,23,42,0.05)",
    ink: "rgba(15,23,42,0.55)",
  },
  positive: {
    primary: "rgba(22,163,74,0.95)",
    tint: "rgba(22,163,74,0.08)",
    ink: "rgba(22,101,52,0.90)",
  },
  warning: {
    primary: "rgba(217,119,6,1)",
    tint: "rgba(217,119,6,0.10)",
    ink: "rgba(146,64,14,0.90)",
  },
  insight: {
    primary: "rgba(124,58,237,0.95)",
    tint: "rgba(124,58,237,0.08)",
    ink: "rgba(67,33,138,0.90)",
  },
};

// ─── Surface kind dot (no icons) ─────────────────────────────────

const SURFACE_LABEL: Record<DesignSectionMoment["surface"], string> = {
  screen: "Screen",
  notification: "Notify",
  ambient: "Ambient",
  physical: "Physical",
  background: "Server",
};

// ─── Public props ────────────────────────────────────────────────

export interface MechanismDesignArtifactViewProps {
  artifact: DesignArtifact;
  /** When true, animates sections in with a stagger on mount.
   *  Defaults true; respects `useReducedMotion`. */
  animate?: boolean;
}

// ─── The view ────────────────────────────────────────────────────

function MechanismDesignArtifactViewInner({
  artifact,
  animate = true,
}: MechanismDesignArtifactViewProps) {
  const reduce = useReducedMotion() ?? false;
  const accent = ACCENT[artifact.intent.accent_intent];
  const tier = TIER[artifact.intent.glass_tier];
  const pad = PAD[artifact.intent.density];
  const shouldAnimate = animate && !reduce;

  return (
    <fmotion.div
      initial={shouldAnimate ? { opacity: 0, y: 6 } : undefined}
      animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
      transition={
        shouldAnimate
          ? { duration: 0.45, ease: [0.34, 1.56, 0.64, 1] }
          : undefined
      }
      style={{
        background: tier.bg,
        backdropFilter: `blur(${tier.blur}px) saturate(1.5)`,
        WebkitBackdropFilter: `blur(${tier.blur}px) saturate(1.5)`,
        border: "1px solid rgba(255,255,255,0.5)",
        borderRadius: tier.radius,
        boxShadow: tier.shadow,
        padding: pad,
        position: "relative",
        overflow: "hidden",
      }}
      className="flex flex-col gap-5"
    >
      {/* Ambient corner halo in the accent tint */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full"
        style={{
          background: `radial-gradient(circle, ${accent.tint} 0%, transparent 70%)`,
          filter: "blur(10px)",
        }}
      />

      {/* Caption — Claude's one-line description of the artifact */}
      {artifact.caption && (
        <div
          className="text-[10px] font-medium uppercase"
          style={{
            color: accent.ink,
            letterSpacing: "0.18em",
            opacity: 0.9,
          }}
        >
          {artifact.caption}
        </div>
      )}

      {/* Sections — each maps to its own component */}
      <AnimatePresence initial={false}>
        {artifact.sections.map((section, i) => (
          <fmotion.div
            key={i}
            initial={shouldAnimate ? { opacity: 0, y: 8 } : undefined}
            animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
            transition={
              shouldAnimate
                ? {
                    duration: 0.4,
                    ease: [0.34, 1.56, 0.64, 1],
                    delay: 0.08 * i + 0.15,
                  }
                : undefined
            }
          >
            <SectionRenderer section={section} accent={accent} />
          </fmotion.div>
        ))}
      </AnimatePresence>
    </fmotion.div>
  );
}

export const MechanismDesignArtifactView = memo(
  MechanismDesignArtifactViewInner,
);
MechanismDesignArtifactView.displayName = "MechanismDesignArtifactView";

// ─── Section dispatcher ──────────────────────────────────────────

function SectionRenderer({
  section,
  accent,
}: {
  section: DesignSection;
  accent: AccentPalette;
}) {
  switch (section.kind) {
    case "hero":         return <HeroSection section={section} accent={accent} />;
    case "moment":       return <MomentSection section={section} accent={accent} />;
    case "quote":        return <QuoteSection section={section} accent={accent} />;
    case "flow":         return <FlowSection section={section} accent={accent} />;
    case "stats":        return <StatsSection section={section} accent={accent} />;
    case "callout":      return <CalloutSection section={section} accent={accent} />;
    case "before_after": return <BeforeAfterSection section={section} accent={accent} />;
  }
}

// ─── Hero section ────────────────────────────────────────────────

function HeroSection({
  section,
  accent,
}: {
  section: DesignSectionHero;
  accent: AccentPalette;
}) {
  // Metric pattern — big tabular figure
  if (section.pattern === "metric" && section.metric) {
    return (
      <div className="flex flex-col gap-2 py-2 text-center">
        <div className="flex items-baseline justify-center gap-2">
          <span
            className="font-light leading-none"
            style={{
              fontSize: 72,
              letterSpacing: "-0.04em",
              color: accent.ink,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {section.metric.value}
          </span>
          {section.metric.delta && (
            <span
              className="font-medium leading-none"
              style={{
                fontSize: 16,
                color: accent.primary,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {section.metric.delta}
            </span>
          )}
        </div>
        {section.metric.label && (
          <div
            className="text-[10.5px] font-semibold uppercase"
            style={{ color: accent.ink, letterSpacing: "0.16em" }}
          >
            {section.metric.label}
          </div>
        )}
        <p
          className="mx-auto max-w-[480px] text-[16px] font-light leading-[1.45]"
          style={{
            color: appleVibe.text.primary,
            letterSpacing: "-0.01em",
          }}
        >
          {section.headline}
        </p>
        {section.subhead && (
          <p
            className="mx-auto max-w-[480px] text-[12.5px] font-light leading-[1.55]"
            style={{ color: appleVibe.text.secondary }}
          >
            {section.subhead}
          </p>
        )}
      </div>
    );
  }

  // Evidence pattern — large pull quote
  if (section.pattern === "evidence") {
    return (
      <div className="flex flex-col gap-3 py-2">
        <span
          aria-hidden
          className="block leading-none"
          style={{
            fontSize: 40,
            color: accent.primary,
            fontWeight: 200,
            fontFamily: "Georgia, 'Times New Roman', serif",
            marginBottom: -8,
          }}
        >
          “
        </span>
        <p
          className="text-[19px] font-light leading-snug"
          style={{
            color: appleVibe.text.primary,
            letterSpacing: "-0.01em",
          }}
        >
          {section.headline}
        </p>
        {section.subhead && (
          <p
            className="text-[13px] font-light leading-[1.55]"
            style={{ color: appleVibe.text.secondary }}
          >
            {section.subhead}
          </p>
        )}
        {section.citation && (
          <div className="flex items-center gap-2 pt-1">
            <span
              aria-hidden
              className="block h-px"
              style={{ width: 28, background: accent.primary, opacity: 0.55 }}
            />
            <span
              className="text-[10.5px] font-semibold uppercase"
              style={{ color: accent.ink, letterSpacing: "0.14em" }}
            >
              {section.citation}
            </span>
          </div>
        )}
      </div>
    );
  }

  // Default — flow/cycle/before_after/decision render as headline +
  // optional subhead. The OTHER sections in the artifact carry the
  // pattern-specific composition (e.g. a `flow` hero often pairs
  // with a `flow` section below).
  return (
    <div className="flex flex-col gap-2 py-2">
      <p
        className="text-[22px] font-light leading-[1.25]"
        style={{
          color: appleVibe.text.primary,
          letterSpacing: "-0.015em",
        }}
      >
        {section.headline}
      </p>
      {section.subhead && (
        <p
          className="text-[13px] font-light leading-[1.55]"
          style={{ color: appleVibe.text.secondary }}
        >
          {section.subhead}
        </p>
      )}
    </div>
  );
}

// ─── Moment section ──────────────────────────────────────────────

function MomentSection({
  section,
  accent,
}: {
  section: DesignSectionMoment;
  accent: AccentPalette;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl px-4 py-3"
      style={{
        background: "rgba(255,255,255,0.45)",
        border: "1px solid rgba(255,255,255,0.6)",
      }}
    >
      <div className="flex items-center justify-between">
        {section.eyebrow ? (
          <span
            className="text-[10px] font-semibold uppercase"
            style={{ color: accent.ink, letterSpacing: "0.14em" }}
          >
            {section.eyebrow}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block rounded-full"
            style={{
              width: 5,
              height: 5,
              background:
                section.surface === "background" ||
                section.surface === "ambient"
                  ? appleVibe.text.tertiary
                  : accent.primary,
              opacity: section.surface === "background" ? 0.5 : 1,
            }}
          />
          <span
            className="text-[9.5px] font-medium uppercase"
            style={{
              color: appleVibe.text.tertiary,
              letterSpacing: "0.12em",
            }}
          >
            {SURFACE_LABEL[section.surface]}
          </span>
        </div>
      </div>
      <p
        className="text-[15px] font-medium leading-[1.4]"
        style={{
          color: appleVibe.text.primary,
          letterSpacing: "-0.008em",
        }}
      >
        {section.title}
      </p>
      <p
        className="text-[12.5px] font-light leading-[1.55]"
        style={{ color: appleVibe.text.secondary }}
      >
        {section.body}
      </p>
    </div>
  );
}

// ─── Quote section ───────────────────────────────────────────────

function QuoteSection({
  section,
  accent,
}: {
  section: DesignSectionQuote;
  accent: AccentPalette;
}) {
  return (
    <div className="flex flex-col gap-2 py-2">
      <span
        aria-hidden
        className="block leading-none"
        style={{
          fontSize: 32,
          color: accent.primary,
          fontWeight: 200,
          fontFamily: "Georgia, 'Times New Roman', serif",
          opacity: 0.55,
          marginBottom: -4,
        }}
      >
        “
      </span>
      <p
        className="text-[15px] font-light italic leading-[1.55]"
        style={{
          color: appleVibe.text.primary,
          letterSpacing: "-0.005em",
        }}
      >
        {section.text}
      </p>
      {section.attribution && (
        <div className="flex items-center gap-2 pt-0.5">
          <span
            aria-hidden
            className="block h-px"
            style={{ width: 20, background: accent.primary, opacity: 0.45 }}
          />
          <span
            className="text-[10.5px] font-medium uppercase"
            style={{ color: accent.ink, letterSpacing: "0.12em" }}
          >
            {section.attribution}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Flow section ────────────────────────────────────────────────

function FlowSection({
  section,
  accent,
}: {
  section: DesignSectionFlow;
  accent: AccentPalette;
}) {
  return (
    <div className="flex flex-col gap-2">
      {section.eyebrow && (
        <span
          className="text-[10px] font-semibold uppercase"
          style={{ color: accent.ink, letterSpacing: "0.14em" }}
        >
          {section.eyebrow}
        </span>
      )}
      <ol className="flex flex-col gap-2.5">
        {section.steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span
              className="flex-shrink-0 font-light leading-tight"
              style={{
                fontSize: 14,
                color: accent.primary,
                fontVariantNumeric: "tabular-nums",
                width: 22,
              }}
            >
              {i + 1}.
            </span>
            <div className="flex flex-col gap-0.5">
              <p
                className="text-[13px] font-medium leading-[1.4]"
                style={{
                  color: appleVibe.text.primary,
                  letterSpacing: "-0.005em",
                }}
              >
                <span style={{ color: accent.ink }}>{step.verb}</span>{" "}
                {step.what}
              </p>
              <p
                className="text-[11.5px] font-light italic leading-[1.4]"
                style={{ color: appleVibe.text.tertiary }}
              >
                {step.feels}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Stats section ───────────────────────────────────────────────

function StatsSection({
  section,
  accent,
}: {
  section: DesignSectionStats;
  accent: AccentPalette;
}) {
  const cols = Math.min(section.items.length, 4);
  return (
    <div className="flex flex-col gap-2">
      {section.eyebrow && (
        <span
          className="text-[10px] font-semibold uppercase"
          style={{ color: accent.ink, letterSpacing: "0.14em" }}
        >
          {section.eyebrow}
        </span>
      )}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {section.items.map((item, i) => {
          const tone = TONE[item.tone];
          return (
            <div
              key={i}
              className="flex flex-col gap-1 rounded-xl px-3 py-2.5"
              style={{
                background: tone.tint,
                border: "1px solid rgba(255,255,255,0.55)",
              }}
            >
              <span
                className="font-light leading-none"
                style={{
                  fontSize: 22,
                  color: tone.primary,
                  letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {item.value}
              </span>
              <span
                className="text-[10px] font-semibold uppercase leading-tight"
                style={{
                  color: tone.ink,
                  letterSpacing: "0.12em",
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Callout section ─────────────────────────────────────────────

function CalloutSection({
  section,
  accent: _accent,
}: {
  section: DesignSectionCallout;
  accent: AccentPalette;
}) {
  const tone = TONE[section.tone];
  return (
    <div
      className="rounded-2xl px-4 py-3"
      style={{
        background: tone.tint,
        border: `1px solid ${tone.primary}`,
        borderColor: tone.primary,
        borderWidth: 0.5,
      }}
    >
      <p
        className="text-[12.5px] font-medium leading-[1.55]"
        style={{ color: tone.ink, letterSpacing: "-0.005em" }}
      >
        {section.text}
      </p>
    </div>
  );
}

// ─── Before/After section ────────────────────────────────────────

function BeforeAfterSection({
  section,
  accent,
}: {
  section: DesignSectionBeforeAfter;
  accent: AccentPalette;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div
        className="flex flex-col gap-1 rounded-2xl px-4 py-3"
        style={{
          background: "rgba(15,23,42,0.04)",
          border: "1px solid rgba(255,255,255,0.5)",
        }}
      >
        <span
          className="text-[9.5px] font-semibold uppercase"
          style={{
            color: appleVibe.text.tertiary,
            letterSpacing: "0.14em",
          }}
        >
          Before
        </span>
        <p
          className="text-[13px] font-medium leading-[1.45]"
          style={{ color: appleVibe.text.secondary }}
        >
          {section.before.state}
        </p>
        <p
          className="text-[11px] font-light italic leading-[1.45]"
          style={{ color: appleVibe.text.tertiary }}
        >
          {section.before.feels}
        </p>
      </div>
      <div
        className="flex flex-col gap-1 rounded-2xl px-4 py-3"
        style={{
          background: accent.tint,
          border: `1px solid ${accent.rim}`,
        }}
      >
        <span
          className="text-[9.5px] font-semibold uppercase"
          style={{
            color: accent.ink,
            letterSpacing: "0.14em",
          }}
        >
          After
        </span>
        <p
          className="text-[13px] font-medium leading-[1.45]"
          style={{ color: appleVibe.text.primary }}
        >
          {section.after.state}
        </p>
        <p
          className="text-[11px] font-light italic leading-[1.45]"
          style={{ color: accent.ink }}
        >
          {section.after.feels}
        </p>
      </div>
    </div>
  );
}

// Silence unused-import linter warnings — kept for completeness.
void Fragment;
