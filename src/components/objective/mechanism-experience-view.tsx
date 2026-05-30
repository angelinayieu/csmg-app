"use client";

// ── MechanismExperienceView ────────────────────────────────────────
//
// The end-user-facing view of a chosen mechanism — the "designed
// answer" surface. Reads MechanismSpec.design_intent + the
// experience-layer fields on runtime_flow (visual_intent,
// interaction_sketch) and composes ONE coherent visual artifact
// per mechanism.
//
// NOT a mockup of the user's actual app. NOT a wireframe. It's a
// branded preview poster — a 5-second read of "what does this
// mechanism feel like in use?". Pairs with the engineering-grade
// Data flow view (mechanism-dataflow-view.tsx, separate file) which
// surfaces the same runtime_flow as a wired DAG for engineers.
//
// World-class, minimalist, native to the existing Vision Pro glass
// system. No emoji, no stock icons, no Material elevation, no
// over-motion. Type does the work; the hero owns the attention.
//
// v1 ships 3 polished hero patterns (metric, evidence, flow) + 3
// fallbacks (cycle / before_after / decision dispatch to FlowHero
// with their own accent intent — feels deliberate, not degraded).
//
// Reference: MECHANISM_EXPERIENCE_SPEC.md §3b (Tab · Experience).

import { Fragment, memo, useState } from "react";
import {
  AnimatePresence,
  motion as fmotion,
  useReducedMotion,
  type MotionProps,
} from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  MechanismDesignIntent,
  MechanismRuntimeStep,
  MechanismSpec,
} from "@/lib/objective-canvas/enrich-mechanism-spec";

// ─── Token resolvers ──────────────────────────────────────────────

type AccentIntent = MechanismDesignIntent["accent_intent"];
type GlassTier = MechanismDesignIntent["glass_tier"];
type Density = MechanismDesignIntent["density"];
type MotionIntent = MechanismDesignIntent["motion_intent"];
type HeroPattern = MechanismDesignIntent["hero_pattern"];
type VisualIntent = NonNullable<MechanismRuntimeStep["visual_intent"]>;

interface AccentPalette {
  /** Solid accent — used for the hero numeral, dots, citation rule. */
  primary: string;
  /** Soft accent tint — used for ambient halo + chip backgrounds. */
  tint: string;
  /** Ink color for accent labels (small-caps, citations). */
  ink: string;
}

/** Semantic palette per accent_intent. Hand-tuned so each intent
 *  reads coherently against the glass substrate — these are NOT
 *  arbitrary. signal = Apple system blue. warning = warm amber.
 *  growth = jade. insight = violet. neutral = graphite. */
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
    primary: "rgba(71,85,105,1)",
    tint: "rgba(71,85,105,0.10)",
    ink: "rgba(67,33,138,0.95)",
  },
  neutral: {
    primary: "rgba(15,23,42,0.78)",
    tint: "rgba(15,23,42,0.05)",
    ink: "rgba(15,23,42,0.62)",
  },
};

/** Glass elevation per glass_tier — picks substrate alpha, blur,
 *  and shadow from the established 4-tier system. */
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

/** Padding scale per density — drives vertical rhythm. */
const PAD: Record<Density, number> = {
  airy: 28,
  comfortable: 20,
  dense: 14,
};

const VISUAL_INTENT_LABEL: Record<VisualIntent, string> = {
  screen: "Screen",
  notification: "Notify",
  ambient: "Ambient",
  physical: "Physical",
  background: "Server",
};

/** Background and ambient touchpoints render softer — they're
 *  peripheral by nature. Screen/notification/physical render in
 *  full accent strength. */
function dotForIntent(vi: VisualIntent, accent: AccentPalette): {
  color: string;
  opacity: number;
} {
  if (vi === "background") {
    return { color: appleVibe.text.tertiary, opacity: 0.5 };
  }
  if (vi === "ambient") {
    return { color: accent.primary, opacity: 0.5 };
  }
  return { color: accent.primary, opacity: 1 };
}

/** Incompatibility map — warning shouldn't celebrate a number,
 *  warning shouldn't quote validating research, growth shouldn't
 *  fork into alternatives. When the LLM picks one of these
 *  combinations, we downgrade the accent to neutral so the view
 *  doesn't render a tonally cheap "loud celebration of a
 *  worrying mechanism". */
const INCOMPATIBLE: ReadonlyArray<readonly [AccentIntent, HeroPattern]> = [
  ["warning", "metric"],
  ["warning", "evidence"],
  ["growth", "decision"],
];

function resolveAccentIntent(
  intent: AccentIntent,
  pattern: HeroPattern,
): AccentIntent {
  return INCOMPATIBLE.some(([a, p]) => a === intent && p === pattern)
    ? "neutral"
    : intent;
}

// ─── Motion config ────────────────────────────────────────────────

interface MotionConfig {
  containerInitial: MotionProps["initial"];
  containerAnimate: MotionProps["animate"];
  containerTransition: MotionProps["transition"];
  heroProps: MotionProps;
  scriptProps: MotionProps;
  scriptChildProps: MotionProps;
}

const STILL_MOTION: MotionConfig = {
  containerInitial: { opacity: 1, scale: 1 },
  containerAnimate: { opacity: 1, scale: 1 },
  containerTransition: { duration: 0 },
  heroProps: {},
  scriptProps: {},
  scriptChildProps: {},
};

// Spring ease tuple matches --ease-spring-soft in globals.css —
// the established motion vocabulary of the canvas.
const SPRING_SOFT: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

function resolveMotion(intent: MotionIntent, reduce: boolean): MotionConfig {
  if (reduce || intent === "still") return STILL_MOTION;

  if (intent === "breathing") {
    return {
      containerInitial: { opacity: 0, y: 4 },
      containerAnimate: { opacity: 1, y: 0 },
      containerTransition: { duration: 0.45, ease: SPRING_SOFT },
      heroProps: {
        animate: { scale: [1, 1.005, 1] },
        transition: { duration: 6, repeat: Infinity, ease: "easeInOut" },
      },
      scriptProps: {},
      scriptChildProps: {},
    };
  }

  if (intent === "reveal") {
    return {
      containerInitial: { opacity: 0, y: 6 },
      containerAnimate: { opacity: 1, y: 0 },
      containerTransition: { duration: 0.45, ease: SPRING_SOFT },
      heroProps: {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, ease: SPRING_SOFT, delay: 0.05 },
      },
      scriptProps: {
        initial: "hidden",
        animate: "show",
        variants: {
          hidden: {},
          show: {
            transition: { staggerChildren: 0.08, delayChildren: 0.18 },
          },
        },
      },
      scriptChildProps: {
        variants: {
          hidden: { opacity: 0, x: -6 },
          show: {
            opacity: 1,
            x: 0,
            transition: { duration: 0.32, ease: SPRING_SOFT },
          },
        },
      },
    };
  }

  // responsive — hero scales subtly on container hover (driven by
  // whileHover on the container, picked up by hero via prop).
  return {
    containerInitial: { opacity: 0, scale: 0.985 },
    containerAnimate: { opacity: 1, scale: 1 },
    containerTransition: { duration: 0.45, ease: SPRING_SOFT },
    heroProps: {
      whileHover: { scale: 1.006 },
      transition: { duration: 0.28 },
    },
    scriptProps: {},
    scriptChildProps: {},
  };
}

// ─── Public component ─────────────────────────────────────────────

interface Props {
  spec: MechanismSpec | null | undefined;
}

/**
 * The Experience view. Renders either:
 *   1. The premium designed view (when spec.design_intent is present —
 *      i.e. specs generated AFTER the v3 generator extension).
 *   2. The legacy simple "What the user sees" text block (when
 *      design_intent is absent — old stored specs).
 *   3. null (no spec or no user_visible_behavior to show).
 *
 * Lifting the legacy fallback INTO this component keeps the parent
 * drawer simple — it just renders <MechanismExperienceView /> and
 * never has to know about the v2-vs-v3 schema difference.
 */
function MechanismExperienceViewInner({ spec }: Props) {
  const reduce = useReducedMotion() ?? false;
  const [hovering, setHovering] = useState(false);

  if (!spec) return null;

  // ── Legacy fallback ──
  // Pre-v3 specs lack design_intent. Render the existing simple
  // text block to preserve the prior visual + zero-regression.
  if (!spec.design_intent) {
    if (!spec.user_visible_behavior) return null;
    return (
      <div>
        <div
          className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          What the user sees
        </div>
        <p
          className="text-[12px] font-light leading-relaxed"
          style={{ color: appleVibe.text.secondary }}
        >
          {spec.user_visible_behavior}
        </p>
      </div>
    );
  }

  // ── v3 premium view ──
  const di = spec.design_intent;
  const accentIntent = resolveAccentIntent(di.accent_intent, di.hero_pattern);
  const accent = ACCENT[accentIntent];
  const tier = TIER[di.glass_tier];
  const pad = PAD[di.density];
  const motion = resolveMotion(di.motion_intent, reduce);

  const visibleSteps = spec.runtime_flow.filter(
    (s) => s.visual_intent != null && !!s.user_sees && s.user_sees !== "—",
  );
  const interactionSteps = visibleSteps.filter(
    (s) => !!s.interaction_sketch && s.interaction_sketch.length > 0,
  );

  return (
    <fmotion.div
      initial={motion.containerInitial}
      animate={motion.containerAnimate}
      transition={motion.containerTransition}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        background: tier.bg,
        backdropFilter: `blur(${tier.blur}px) saturate(1.5)`,
        WebkitBackdropFilter: `blur(${tier.blur}px) saturate(1.5)`,
        border: "1px solid rgba(255,255,255,0.5)",
        borderRadius: tier.radius,
        boxShadow: tier.shadow,
        padding: pad,
      }}
      className="relative flex flex-col gap-4 overflow-hidden"
    >
      {/* Ambient accent halo — soft radial in the corner that fades
          on the unhovered state. Pointer-events:none so it never
          interferes with content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full transition-opacity duration-500"
        style={{
          background: `radial-gradient(circle, ${accent.tint} 0%, transparent 70%)`,
          filter: "blur(10px)",
          opacity: hovering ? 1 : 0.7,
        }}
      />

      {/* HERO */}
      <Hero spec={spec} di={di} accent={accent} motion={motion} />

      {/* TOUCHPOINTS — only when there's at least one visible step. */}
      {visibleSteps.length > 0 ? (
        <Touchpoints steps={visibleSteps} accent={accent} />
      ) : (
        <p
          className="text-[11.5px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          Runs silently — no user-visible surface.
        </p>
      )}

      {/* INTERACTION SCRIPT — vertical rhythm of what the user does. */}
      {interactionSteps.length > 0 && (
        <InteractionScript steps={interactionSteps} motion={motion} />
      )}

      {/* REDUCTION FOOTNOTE — foldout, honors honesty without shouting. */}
      {di.reduction_log.length > 0 && (
        <ReductionFootnote items={di.reduction_log} />
      )}
    </fmotion.div>
  );
}

export const MechanismExperienceView = memo(MechanismExperienceViewInner);
MechanismExperienceView.displayName = "MechanismExperienceView";

// ─── Hero dispatch ────────────────────────────────────────────────

interface HeroPropsLike {
  spec: MechanismSpec;
  di: MechanismDesignIntent;
  accent: AccentPalette;
  motion: MotionConfig;
}

function Hero({ spec, di, accent, motion }: HeroPropsLike) {
  switch (di.hero_pattern) {
    case "metric":
      return <MetricHero spec={spec} accent={accent} motion={motion} />;
    case "evidence":
      return <EvidenceHero spec={spec} accent={accent} motion={motion} />;
    case "cycle":
    case "before_after":
    case "decision":
    case "flow":
    default:
      return (
        <FlowHero
          spec={spec}
          accent={accent}
          motion={motion}
          pattern={di.hero_pattern}
        />
      );
  }
}

// ─── MetricHero — XL tabular numeral + confidence label ───────────

function MetricHero({
  spec,
  accent,
  motion,
}: {
  spec: MechanismSpec;
  accent: AccentPalette;
  motion: MotionConfig;
}) {
  const axes = Object.values(spec.quality_score);
  const minAxis = axes.length > 0 ? Math.min(...axes) : 0.7;
  const confidence = Math.round(minAxis * 100);
  const evidence = spec.research_basis.evidence_strength;

  return (
    <fmotion.div
      {...motion.heroProps}
      className="flex flex-col items-center justify-center gap-3 py-3 text-center"
    >
      <div className="flex items-baseline gap-1.5">
        <span
          className="font-light leading-none"
          style={{
            fontSize: 64,
            letterSpacing: "-0.04em",
            color: accent.ink,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {confidence}
        </span>
        <span
          className="font-medium leading-none"
          style={{ fontSize: 20, color: accent.primary }}
        >
          %
        </span>
      </div>
      <div
        className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: accent.ink }}
      >
        {evidence} confidence
      </div>
      {spec.user_visible_behavior && (
        <p
          className="max-w-[420px] text-[13px] font-light leading-relaxed"
          style={{
            color: appleVibe.text.primary,
            letterSpacing: "-0.005em",
          }}
        >
          {spec.user_visible_behavior}
        </p>
      )}
    </fmotion.div>
  );
}

// ─── EvidenceHero — pull quote + thin citation rule ───────────────

function EvidenceHero({
  spec,
  accent,
  motion,
}: {
  spec: MechanismSpec;
  accent: AccentPalette;
  motion: MotionConfig;
}) {
  const quote =
    spec.research_basis.basis || spec.user_visible_behavior || "";
  const evidence = spec.research_basis.evidence_strength;

  if (!quote) {
    // Edge case — no basis AND no visible behavior. Fall back to
    // FlowHero so we still render something coherent.
    return (
      <FlowHero
        spec={spec}
        accent={accent}
        motion={motion}
        pattern="evidence"
      />
    );
  }

  return (
    <fmotion.div
      {...motion.heroProps}
      className="flex flex-col gap-3 py-2"
    >
      {/* Hairline open-quote glyph — thin weight, accent ink */}
      <span
        aria-hidden
        className="block leading-none"
        style={{
          fontSize: 36,
          color: accent.primary,
          fontWeight: 200,
          fontFamily: "Georgia, 'Times New Roman', serif",
          marginBottom: -8,
        }}
      >
        “
      </span>
      <p
        className="text-[17px] font-light leading-snug"
        style={{
          color: appleVibe.text.primary,
          letterSpacing: "-0.01em",
        }}
      >
        {quote}
      </p>
      <div className="flex items-center gap-2 pt-1">
        <span
          aria-hidden
          className="block h-px"
          style={{
            width: 28,
            background: accent.primary,
            opacity: 0.55,
          }}
        />
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: accent.ink }}
        >
          {evidence} basis
        </span>
      </div>
    </fmotion.div>
  );
}

// ─── FlowHero — 3-column ribbon (also fallback for cycle/before_after/decision) ─

function FlowHero({
  spec,
  accent,
  motion,
  pattern,
}: {
  spec: MechanismSpec;
  accent: AccentPalette;
  motion: MotionConfig;
  pattern: HeroPattern;
}) {
  // Prefer steps with user-visible behavior — fall back to the
  // first 3 runtime steps if no step is user-visible.
  const visible = spec.runtime_flow.filter(
    (s) => !!s.user_sees && s.user_sees !== "—",
  );
  const sourceSteps =
    visible.length >= 2 ? visible : spec.runtime_flow;
  const steps = sourceSteps.slice(0, 3);

  if (steps.length === 0) {
    // No runtime flow at all → show user_visible_behavior in a
    // simple framed quote. Honest about the limit.
    if (spec.user_visible_behavior) {
      return (
        <fmotion.div
          {...motion.heroProps}
          className="py-2"
        >
          <p
            className="text-[14px] font-light leading-relaxed"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.005em",
            }}
          >
            {spec.user_visible_behavior}
          </p>
        </fmotion.div>
      );
    }
    return null;
  }

  return (
    <fmotion.div
      {...motion.heroProps}
      className="flex items-stretch gap-2 py-1"
    >
      {steps.map((step, i) => (
        <Fragment key={i}>
          <FlowColumn
            step={step}
            index={i}
            accent={accent}
            pattern={pattern}
            isLast={i === steps.length - 1}
          />
          {i < steps.length - 1 && (
            <div
              className="flex items-center px-0.5"
              style={{ color: accent.primary }}
              aria-hidden
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 300,
                  opacity: 0.4,
                  marginTop: -2,
                }}
              >
                ›
              </span>
            </div>
          )}
        </Fragment>
      ))}
    </fmotion.div>
  );
}

function FlowColumn({
  step,
  index,
  accent,
  pattern,
  isLast,
}: {
  step: MechanismRuntimeStep;
  index: number;
  accent: AccentPalette;
  pattern: HeroPattern;
  isLast: boolean;
}) {
  // Variant tweak: before_after labels the first/last columns.
  const variantLabel: string | null =
    pattern === "before_after"
      ? index === 0
        ? "Before"
        : isLast
          ? "After"
          : null
      : null;

  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-2xl px-3 py-2.5"
      style={{
        background: "rgba(255,255,255,0.45)",
        border: "1px solid rgba(255,255,255,0.6)",
      }}
    >
      <span
        aria-hidden
        className="inline-block rounded-full"
        style={{
          width: 6,
          height: 6,
          background: accent.primary,
        }}
      />
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: accent.ink }}
      >
        {variantLabel ?? `Step ${index + 1}`}
      </div>
      <p
        className="line-clamp-3 text-[12px] font-light leading-snug"
        style={{ color: appleVibe.text.primary }}
      >
        {step.step}
      </p>
      {step.user_sees && step.user_sees !== "—" && (
        <p
          className="line-clamp-2 text-[10.5px] font-light leading-snug"
          style={{ color: appleVibe.text.tertiary }}
        >
          {step.user_sees}
        </p>
      )}
    </div>
  );
}

// ─── Touchpoints strip ────────────────────────────────────────────

function Touchpoints({
  steps,
  accent,
}: {
  steps: MechanismRuntimeStep[];
  accent: AccentPalette;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3"
      style={{ borderColor: appleVibe.stroke.hairline }}
    >
      {steps.map((s, i) => {
        if (!s.visual_intent) return null;
        const dot = dotForIntent(s.visual_intent, accent);
        return (
          <div key={i} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block rounded-full"
              style={{
                width: 6,
                height: 6,
                background: dot.color,
                opacity: dot.opacity,
              }}
            />
            <span
              className="text-[10.5px] font-medium uppercase tracking-[0.14em]"
              style={{ color: appleVibe.text.secondary }}
            >
              {VISUAL_INTENT_LABEL[s.visual_intent]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Interaction script ───────────────────────────────────────────

function InteractionScript({
  steps,
  motion,
}: {
  steps: MechanismRuntimeStep[];
  motion: MotionConfig;
}) {
  return (
    <fmotion.ol
      {...motion.scriptProps}
      className="flex flex-col gap-2.5 border-t pt-3"
      style={{ borderColor: appleVibe.stroke.hairline }}
    >
      {steps.map((s, i) => (
        <fmotion.li
          key={i}
          {...motion.scriptChildProps}
          className="flex gap-3"
        >
          <span
            className="flex-shrink-0 font-light"
            style={{
              fontSize: 11,
              color: appleVibe.text.tertiary,
              width: 18,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {i + 1}.
          </span>
          <p
            className="text-[12.5px] font-light leading-relaxed"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.005em",
            }}
          >
            {s.interaction_sketch}
          </p>
        </fmotion.li>
      ))}
    </fmotion.ol>
  );
}

// ─── Reduction footnote ───────────────────────────────────────────

function ReductionFootnote({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border-t pt-2"
      style={{ borderColor: appleVibe.stroke.hairline }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[10.5px] font-medium transition-opacity hover:opacity-100"
        style={{
          color: appleVibe.text.tertiary,
          opacity: 0.85,
        }}
      >
        Design notes
        <span
          aria-hidden
          style={{
            fontSize: 8,
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 180ms ease",
            display: "inline-block",
          }}
        >
          ▸
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <fmotion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="mt-2 flex flex-col gap-1 overflow-hidden"
          >
            {items.map((item, i) => (
              <li
                key={i}
                className="text-[11px] font-light leading-snug"
                style={{ color: appleVibe.text.secondary }}
              >
                {item}
              </li>
            ))}
          </fmotion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
