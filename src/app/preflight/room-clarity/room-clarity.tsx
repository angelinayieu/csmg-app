"use client";

// Preflight brainstorm — room-interior CLARITY treatments.
//
// The room (Problems / Mechanisms / Results lanes) is dense and noisy:
//   • every card repeats "leads to →" / "produces →" / "measured by →"
//     even though the column header already states the role/direction
//   • the "derived from" strip + truncated chips sit on nearly every
//     card and duplicate the room-level Annotation Lens
//   • the Problem→Mechanism→Result links — the core content — are
//     nearly invisible while the least-useful metadata is always-on
//   • no reading order; every card reads as equal weight
//
// This harness renders ONE realistic mock room and lets you flip
// between the current treatment and five clarity directions, so the
// deltas are apples-to-apples. Exploration only — lives under
// /preflight so it's trivial to delete. Nothing here imports the
// production lane/card components; it's a faithful replica so the
// comparison stays in one rendering system.

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  Crown,
  Diamond,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// ── Types ───────────────────────────────────────────────────────────
type Stage = "pain" | "features" | "outcomes";
type Facet = "fragility" | "analogy" | "dimension" | "tension" | "inference";

interface MockCard {
  id: string;
  stage: Stage;
  title: string;
  /** The leads-to / produces / measured-by consequence text. */
  consequence: string;
  /** Collapsed-meta fragments, e.g. ["2 causes"] or ["3 principles","1 shared"]. */
  meta: string[];
  derivedFrom: { label: string; facet: Facet };
  /** 0–1 centrality. Drives hierarchy sizing + the Root/Keystone badge. */
  influence: number;
  badge?: "root" | "keystone";
  /** Links a Problem↔Mechanism↔Result triple for focus-to-trace. */
  chainId?: string;
}

type Treatment =
  | "current"
  | "quiet"
  | "trace"
  | "hierarchy"
  | "headers"
  | "combined"
  | "tree"
  | "centered";

// ── Stage config ────────────────────────────────────────────────────
const STAGE_COLOR: Record<Stage, string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
};

const VERB: Record<Stage, string> = {
  pain: "leads to →",
  features: "produces →",
  outcomes: "measured by →",
};

const STAGE_HEAD: Record<
  Stage,
  {
    icon: React.ComponentType<{
      className?: string;
      strokeWidth?: number;
      style?: React.CSSProperties;
    }>;
    title: string;
    role: string;
    direction: string;
    plainTitle: string;
    plainHint: string;
  }
> = {
  pain: {
    icon: TrendingDown,
    title: "Problems",
    role: "Dependent",
    direction: "minimize",
    plainTitle: "Problems to reduce",
    plainHint: "What's going wrong — we want less of these",
  },
  features: {
    icon: ArrowLeftRight,
    title: "Mechanisms",
    role: "Independent",
    direction: "test",
    plainTitle: "Levers to test",
    plainHint: "Things you can change — the experiment knobs",
  },
  outcomes: {
    icon: TrendingUp,
    title: "Results",
    role: "Dependent",
    direction: "maximize",
    plainTitle: "Results to grow",
    plainHint: "What success looks like — we want more of these",
  },
};

const FACET_COLOR: Record<Facet, string> = {
  fragility: "rgba(220,38,38,0.78)",
  analogy: "rgba(37,99,235,0.78)",
  dimension: "rgba(22,163,74,0.78)",
  tension: "rgba(217,119,6,0.78)",
  inference: "rgba(71,85,105,0.78)",
};

// ── Mock room ───────────────────────────────────────────────────────
// Three clean 1→1→1 chains (c1/c2/c3) plus two orphans so focus-to-trace
// has both the easy and the "no chain" case to show.
const CARDS: MockCard[] = [
  // Problems
  {
    id: "p1",
    stage: "pain",
    title: "Ambiguous feedback on activity",
    consequence:
      "Users make uninformed decisions, reducing potential earnings.",
    meta: ["2 causes"],
    derivedFrom: { label: "Feedback clarity issues", facet: "fragility" },
    influence: 0.95,
    badge: "root",
    chainId: "c1",
  },
  {
    id: "p2",
    stage: "pain",
    title: "Data privacy concerns",
    consequence: "Users hesitate to share data, limiting system efficacy.",
    meta: ["2 causes"],
    derivedFrom: { label: "Incentivized to give data", facet: "tension" },
    influence: 0.7,
    chainId: "c2",
  },
  {
    id: "p3",
    stage: "pain",
    title: "Misalignment of goals and feedback",
    consequence: "Users pursue irrelevant activities, missing opportunities.",
    meta: ["2 causes"],
    derivedFrom: { label: "Goal conversion", facet: "dimension" },
    influence: 0.55,
    chainId: "c3",
  },
  {
    id: "p4",
    stage: "pain",
    title: "Low engagement with feedback",
    consequence: "Users ignore guidance, so improvements never compound.",
    meta: ["1 cause"],
    derivedFrom: { label: "Engagement decay", facet: "fragility" },
    influence: 0.3,
  },
  // Mechanisms
  {
    id: "m1",
    stage: "features",
    title: "Trust-based data sharing protocols",
    consequence: "Users willingly share data, enhancing system efficacy.",
    meta: ["3 principles", "1 shared"],
    derivedFrom: { label: "Community support", facet: "analogy" },
    influence: 0.92,
    badge: "keystone",
    chainId: "c2",
  },
  {
    id: "m2",
    stage: "features",
    title: "Clear metrics dashboard",
    consequence: "Users make informed decisions and increase earnings.",
    meta: ["3 principles", "1 shared"],
    derivedFrom: { label: "Personalized insights", facet: "inference" },
    influence: 0.78,
    chainId: "c1",
  },
  {
    id: "m3",
    stage: "features",
    title: "Goal-aligned feedback system",
    consequence: "Users pursue relevant activities and career opportunities.",
    meta: ["3 principles", "2 shared"],
    derivedFrom: { label: "Goal conversion", facet: "dimension" },
    influence: 0.6,
    chainId: "c3",
  },
  {
    id: "m4",
    stage: "features",
    title: "Immediate benefit feedback interface",
    consequence: "Users feel instant payoff, reinforcing the habit loop.",
    meta: ["2 principles"],
    derivedFrom: { label: "Gamification", facet: "analogy" },
    influence: 0.35,
  },
  // Results
  {
    id: "r1",
    stage: "outcomes",
    title: "Alignment of feedback with user goals",
    consequence: "75%+ users find feedback relevant to goals.",
    meta: ["1 produced by", "rolls up"],
    derivedFrom: { label: "Goal conversion", facet: "dimension" },
    influence: 0.6,
    chainId: "c3",
  },
  {
    id: "r2",
    stage: "outcomes",
    title: "Informed decision-making on activities",
    consequence: "80%+ users report confidence in activity choices.",
    meta: ["1 produced by", "dissolves 1 pain", "rolls up"],
    derivedFrom: { label: "Personalized insights", facet: "inference" },
    influence: 0.8,
    chainId: "c1",
  },
  {
    id: "r3",
    stage: "outcomes",
    title: "Enhanced trust in data sharing",
    consequence: "70%+ users willingly share data history.",
    meta: ["1 produced by"],
    derivedFrom: { label: "Incentivized to give data", facet: "tension" },
    influence: 0.7,
    chainId: "c2",
  },
];

// What role a card plays inside its chain — reads as one sentence down
// the lit path: "problem" → "lever that addresses it" → "result it produces".
const HOP_LABEL: Record<Stage, string> = {
  pain: "problem",
  features: "lever that addresses it",
  outcomes: "result it produces",
};

// ── Card ────────────────────────────────────────────────────────────
function TreatmentCard({
  card,
  treatment,
  selectedChain,
  onSelect,
  rank,
  laneLayout,
  isLast,
}: {
  card: MockCard;
  treatment: Treatment;
  selectedChain: string | null;
  onSelect: (chainId: string | null) => void;
  /** 0-based position in lane after influence sort (hierarchy mode). */
  rank: number;
  /** How the lane arranges its cards — drives indent vs. fork vs. center. */
  laneLayout: "stack" | "tree" | "centered";
  /** Last card in the lane — the tree spine stops at its elbow. */
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const color = STAGE_COLOR[card.stage];

  // The "Combined" card design is shared by the tree + centered layouts —
  // same quiet card, numbering, and focus-to-trace; only the lane
  // arrangement differs.
  const combinedFamily =
    treatment === "combined" ||
    treatment === "tree" ||
    treatment === "centered";
  const decongested = treatment === "quiet" || combinedFamily;
  const numbered = treatment === "hierarchy" || combinedFamily;
  const traceOn = treatment === "trace" || combinedFamily;

  const showVerb = !decongested;
  const inlineDerived = !decongested;

  // Focus-to-trace dimming.
  const lit = !selectedChain || card.chainId === selectedChain;
  const dim = traceOn && selectedChain != null && !lit;
  const isChainMember =
    traceOn && selectedChain != null && card.chainId === selectedChain;

  // Hierarchy emphasis — the top card in a lane reads bigger; numbered so
  // the eye gets a clear reading order.
  const isLead = numbered && rank === 0;
  const titleSize = isLead ? "text-[16px]" : "text-[15px]";
  // The progressive outward cascade only happens in the stacked
  // hierarchy/combined view. Tree forks from a left gutter; centered drops
  // the shift entirely.
  const cascadeIndent =
    treatment === "hierarchy" || treatment === "combined";
  const treeChild = laneLayout === "tree" && !isLead;
  const marginLeft = treeChild
    ? 28
    : cascadeIndent
      ? Math.min(rank, 3) * 10
      : 0;

  const restShadow = isChainMember
    ? `0 0 0 2px ${color}40, 0 14px 32px -16px ${color}66`
    : expanded
      ? appleVibe.shadow.cardHover
      : appleVibe.shadow.card;

  return (
    <motion.li
      layout
      initial={false}
      animate={{ opacity: dim ? 0.32 : 1 }}
      whileHover={{
        y: -1,
        transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
      }}
      className="group rounded-2xl px-4 py-3"
      style={{
        background: expanded ? "rgba(255,255,255,0.99)" : "rgba(255,255,255,0.94)",
        border: `1px solid ${
          isChainMember ? color : appleVibe.stroke.hairline
        }`,
        borderRadius: appleVibe.radius.md,
        boxShadow: restShadow,
        marginLeft,
        width: laneLayout === "centered" ? "100%" : undefined,
        maxWidth: laneLayout === "centered" ? 256 : undefined,
        position: treeChild ? "relative" : undefined,
        cursor: "pointer",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (traceOn && card.chainId) {
          onSelect(selectedChain === card.chainId ? null : card.chainId);
        } else {
          setExpanded((v) => !v);
        }
      }}
    >
      {/* Tree connectors — a vertical spine descending from the lead card
          plus a horizontal elbow into each child. Anchored to the card so
          variable heights stay correct; the spine stops at the last
          child's elbow. */}
      {treeChild && (
        <>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: -16,
              top: -10,
              width: 1,
              height: isLast ? 36 : "calc(100% + 18px)",
              background: appleVibe.stroke.hairline,
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: -16,
              top: 26,
              width: 16,
              height: 1,
              background: appleVibe.stroke.hairline,
            }}
          />
        </>
      )}

      {/* Header — ordinal (hierarchy) + title + badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {numbered && (
            <span
              className="mt-0.5 grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full text-[10px] font-bold tabular-nums"
              style={{
                background: isLead ? color : appleVibe.surface.chip,
                color: isLead ? "white" : appleVibe.text.tertiary,
              }}
            >
              {rank + 1}
            </span>
          )}
          <h4
            className={`line-clamp-3 ${titleSize} font-semibold leading-snug tracking-tight`}
            style={{ color: appleVibe.text.primary, letterSpacing: "-0.01em" }}
          >
            {card.title}
          </h4>
        </div>
        {card.badge && (
          <span
            className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
            style={
              card.badge === "root"
                ? {
                    background: "rgba(245,158,11,0.12)",
                    color: "rgba(146,64,14,0.95)",
                    border: "1px solid rgba(245,158,11,0.25)",
                  }
                : {
                    background: "rgba(37,99,235,0.10)",
                    color: "rgba(30,64,175,0.95)",
                    border: "1px solid rgba(37,99,235,0.22)",
                  }
            }
          >
            {card.badge === "root" ? (
              <Crown className="h-2.5 w-2.5" strokeWidth={2.5} />
            ) : (
              <Diamond className="h-2.5 w-2.5" strokeWidth={2.5} />
            )}
            {card.badge === "root" ? "Root" : "Keystone"}
          </span>
        )}
      </div>

      {/* Consequence — with or without the verb prefix */}
      <p
        className="mt-2 line-clamp-3 text-[13px] font-light leading-snug"
        style={{ color: appleVibe.text.secondary }}
      >
        {showVerb && (
          <span className="italic" style={{ color: appleVibe.text.tertiary }}>
            {VERB[card.stage]}{" "}
          </span>
        )}
        <span className={showVerb ? "italic" : undefined}>
          {card.consequence}
        </span>
      </p>

      {/* Focus-to-trace hop label — only on lit chain members */}
      {isChainMember && HOP_LABEL[card.stage] && (
        <div
          className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: `${color}16`, color }}
        >
          <ArrowRight className="h-2.5 w-2.5" strokeWidth={2.6} />
          {HOP_LABEL[card.stage]}
        </div>
      )}

      {/* Meta row */}
      {card.meta.length > 0 && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          {decongested ? (
            // Quiet: a single subtle count, rest folds behind the chevron.
            <span>{card.meta[0]}</span>
          ) : (
            card.meta.map((m, i) => (
              <span key={m} className="flex items-center gap-1">
                {i > 0 && (
                  <span style={{ color: appleVibe.text.faint }}>·</span>
                )}
                {m}
              </span>
            ))
          )}
          <ChevronDown
            className="ml-auto h-3 w-3"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
        </div>
      )}

      {/* Derived-from provenance */}
      {inlineDerived ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span
            className="text-[9px] font-semibold uppercase tracking-[0.12em]"
            style={{ color }}
          >
            derived from
          </span>
          <span
            className="inline-flex max-w-[140px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium"
            style={{
              background: "rgba(15,23,42,0.035)",
              border: `1px solid ${appleVibe.stroke.hairline}`,
              color: appleVibe.text.secondary,
            }}
          >
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: FACET_COLOR[card.derivedFrom.facet] }}
            />
            <span className="truncate">{card.derivedFrom.label}</span>
          </span>
        </div>
      ) : (
        // Quiet: provenance collapses to a single dot that reveals the
        // source on hover — always-available, never always-on.
        <div className="mt-2 flex h-4 items-center">
          <span
            className="inline-flex items-center gap-1.5 text-[9.5px] font-medium transition-opacity duration-200"
            style={{
              color: appleVibe.text.tertiary,
              opacity: hovered ? 1 : 0.5,
            }}
          >
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ background: FACET_COLOR[card.derivedFrom.facet] }}
            />
            {hovered && (
              <span className="truncate">{card.derivedFrom.label}</span>
            )}
          </span>
        </div>
      )}
    </motion.li>
  );
}

// ── Lane ────────────────────────────────────────────────────────────
function Lane({
  stage,
  treatment,
  selectedChain,
  onSelect,
}: {
  stage: Stage;
  treatment: Treatment;
  selectedChain: string | null;
  onSelect: (chainId: string | null) => void;
}) {
  const color = STAGE_COLOR[stage];
  const head = STAGE_HEAD[stage];
  const Icon = head.icon;
  const combinedFamily =
    treatment === "combined" ||
    treatment === "tree" ||
    treatment === "centered";
  const plainHeaders = treatment === "headers" || combinedFamily;
  const sorted = treatment === "hierarchy" || combinedFamily;
  const laneLayout: "stack" | "tree" | "centered" =
    treatment === "tree"
      ? "tree"
      : treatment === "centered"
        ? "centered"
        : "stack";

  let cards = CARDS.filter((c) => c.stage === stage);
  if (sorted) {
    cards = [...cards].sort((a, b) => b.influence - a.influence);
  }

  return (
    <div
      className="flex min-h-[260px] flex-1 flex-col p-5"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.xl,
        boxShadow: `${appleVibe.shadow.card}, 0 0 0 1px ${color}0F`,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Header */}
      {plainHeaders ? (
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: color, boxShadow: `0 0 0 3px ${color}1A` }}
              />
              <h3
                className="text-[15px] font-semibold tracking-tight"
                style={{
                  color: appleVibe.text.primary,
                  letterSpacing: "-0.01em",
                  fontFamily: appleVibe.font.display,
                }}
              >
                {head.plainTitle}
              </h3>
              {/* Rigor demoted to a hoverable tag */}
              <span
                className="cursor-help rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                style={{ background: `${color}12`, color }}
                title={`${head.role} variable · ${head.direction}`}
              >
                {head.role[0]}V
              </span>
            </div>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.tertiary,
              }}
            >
              {cards.length}
            </span>
          </div>
          <p
            className="mt-1 text-[11.5px] font-light"
            style={{ color: appleVibe.text.tertiary }}
          >
            {head.plainHint}
          </p>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Icon
                className="h-3.5 w-3.5 flex-shrink-0"
                strokeWidth={2}
                style={{ color }}
              />
              <span
                className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                style={{ color }}
              >
                {head.role} var · {head.direction}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: color, boxShadow: `0 0 0 3px ${color}1A` }}
              />
              <h3
                className="text-[15px] font-semibold tracking-tight"
                style={{
                  color: appleVibe.text.primary,
                  letterSpacing: "-0.01em",
                  fontFamily: appleVibe.font.display,
                }}
              >
                {head.title}
              </h3>
            </div>
          </div>
          <span
            className="mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{
              background: appleVibe.surface.chip,
              color: appleVibe.text.tertiary,
            }}
          >
            {cards.length}
          </span>
        </div>
      )}

      {/* Cards */}
      <ul
        className={`mt-3 flex flex-1 flex-col gap-2${
          laneLayout === "centered" ? " items-center" : ""
        }`}
      >
        {cards.map((card, i) => (
          <TreatmentCard
            key={card.id}
            card={card}
            treatment={treatment}
            selectedChain={selectedChain}
            onSelect={onSelect}
            rank={i}
            laneLayout={laneLayout}
            isLast={i === cards.length - 1}
          />
        ))}
      </ul>
    </div>
  );
}

// ── Switcher + lab ──────────────────────────────────────────────────
const TREATMENTS: {
  key: Treatment;
  label: string;
  blurb: string;
  tradeoff: string;
}[] = [
  {
    key: "current",
    label: "Current",
    blurb: "What ships today — full verb prose, per-card provenance strip, three independent columns.",
    tradeoff: "Baseline for comparison.",
  },
  {
    key: "quiet",
    label: "A · Quiet card",
    blurb: "Drop the verb prefix, fold meta to one line, collapse “derived from” to a hover-reveal dot. ~Half the height.",
    tradeoff: "Provenance becomes hover, not always-on.",
  },
  {
    key: "trace",
    label: "B · Focus-to-trace",
    blurb: "Click any card → its Problem→Mechanism→Result chain lights up, the rest dims, hop labels appear. Try clicking a card.",
    tradeoff: "Many-to-many chains cross; best one-at-a-time.",
  },
  {
    key: "hierarchy",
    label: "C · Influence hierarchy",
    blurb: "Sort each lane by centrality; the lead card reads bigger and numbered, downstream shrink + indent. Clear reading order.",
    tradeoff: "Non-uniform grid; flat ranks add little.",
  },
  {
    key: "headers",
    label: "D · Plain headers",
    blurb: "“Problems to reduce ↓” with a one-line hint; the DV/IV rigor demotes to a hoverable tag.",
    tradeoff: "Loses always-visible scientific framing.",
  },
  {
    key: "combined",
    label: "★ Combined",
    blurb: "A + C + D stacked, with the focus-to-trace interaction live — the cohesive end-state.",
    tradeoff: "The opinionated default to react to.",
  },
  {
    key: "tree",
    label: "★ Tree fork",
    blurb: "The Combined card design, but each lane forks from its lead card — a trunk with connector lines branching down to the rest. Same quiet cards, explicit tree.",
    tradeoff: "Implies a parent→child hierarchy the flat lane doesn't strictly have.",
  },
  {
    key: "centered",
    label: "★ Centered",
    blurb: "The Combined card design, still ranked + numbered, but every card sits centered in its lane — no outward indentation, no fork lines. Calm, uniform column.",
    tradeoff: "Loses the at-a-glance sense of descent the indent / tree give.",
  },
];

export function RoomClarityLab() {
  const [treatment, setTreatment] = useState<Treatment>("combined");
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const active = TREATMENTS.find((t) => t.key === treatment)!;

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* Switcher */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TREATMENTS.map((t) => {
          const on = t.key === treatment;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTreatment(t.key);
                setSelectedChain(null);
              }}
              className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-all"
              style={{
                background: on ? appleVibe.accent.primary : appleVibe.surface.card,
                color: on ? "white" : appleVibe.text.secondary,
                border: `1px solid ${on ? "transparent" : appleVibe.stroke.medium}`,
                boxShadow: on ? appleVibe.shadow.chip : "none",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Active treatment caption */}
      <div
        className="mb-4 rounded-2xl px-4 py-3"
        style={{
          background: appleVibe.surface.cardElevated,
          border: `1px solid ${appleVibe.stroke.hairline}`,
          borderRadius: appleVibe.radius.lg,
          boxShadow: appleVibe.shadow.card,
        }}
      >
        <div
          className="text-[13px] font-semibold"
          style={{ color: appleVibe.text.primary }}
        >
          {active.label}
        </div>
        <p
          className="mt-0.5 text-[12.5px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {active.blurb}
        </p>
        <p
          className="mt-1 text-[11.5px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          Tradeoff — {active.tradeoff}
        </p>
      </div>

      {/* Lanes */}
      <div className="flex items-start gap-4">
        {(["pain", "features", "outcomes"] as Stage[]).map((stage) => (
          <Lane
            key={stage}
            stage={stage}
            treatment={treatment}
            selectedChain={selectedChain}
            onSelect={setSelectedChain}
          />
        ))}
      </div>
    </div>
  );
}
