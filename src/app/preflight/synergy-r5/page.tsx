// ── PREFLIGHT · Synergy R5 mockup ────────────────────────────────────
//
// Double-diamond flow inspired by the Design Phases reference:
// a vertical spine with phase markers and side cards, but the spine
// itself forks at "Diverge" and reconverges at "Converge" — so the
// shape literally is the message. Strategy formation is a divergence
// of perspectives that re-meets at a unified next step.
//
//   ●  Intersection          (one shared purpose)
//   │
//   │
//  ╱ ╲                       (Diverge — fork)
//  │ │
//  │ │                       (parallel exploration)
//  │ │
//  ╲ ╱                       (Converge — merge)
//   │
//   │
//   ●  Final act              (one next step)
//
// Phase labels in the left margin name the shape; filled dots on the
// spine mark where each card attaches. No numbered circles — the flow
// itself is the index.

"use client";

import { useState } from "react";
import {
  Anchor,
  ArrowUp,
  BookOpen,
  Calendar,
  CalendarDays,
  FlipHorizontal2,
  Lightbulb,
  Mic,
  Music,
  Plus,
  RotateCcw,
  Target,
  Timer,
  Watch,
  Zap,
} from "lucide-react";
import {
  abstractAvatarFor,
  abstractAvatarStyle,
} from "@/lib/synergy/abstract-avatar";

const ME_ID = "preflight-user-me";
const MAYA_ID = "preflight-user-maya";
const ME_AV = abstractAvatarFor(ME_ID);
const MAYA_AV = abstractAvatarFor(MAYA_ID);

// ── Geometry ─────────────────────────────────────────────────────────
const SPINE_X = 470;
const BRANCH_LEFT_X = 380;
const BRANCH_RIGHT_X = 560;
const CARD_W = 240;
const CARD_H = 96;  // header strip 34 + body 62
const GHOST_H = 168;
const LEFT_CARD_X = 80;
const LEFT_CARD_RIGHT = LEFT_CARD_X + CARD_W;
const RIGHT_CARD_X = 620;

// ── Card themes (Opal-style colored header strips) ───────────────────
// Each card kind gets a soft pastel header that carries its identity
// at a glance. The body stays white so titles remain readable. One
// shared typography stack (SF Pro via globals) — no mono caps.
const KIND_THEMES = {
  anchor: {
    headerBg: "rgba(241, 245, 249, 0.85)",  // slate-50
    labelColor: "rgb(51, 65, 85)",           // slate-700
    iconColor: "rgb(100, 116, 139)",         // slate-500
  },
  intersection: {
    headerBg: "rgba(241, 245, 249, 0.85)",
    labelColor: "rgb(51, 65, 85)",
    iconColor: "rgb(100, 116, 139)",
  },
  insight: {
    headerBg: "rgba(254, 243, 199, 0.60)",   // amber-50
    labelColor: "rgb(146, 64, 14)",          // amber-800
    iconColor: "rgb(180, 83, 9)",            // amber-700
  },
  question: {
    headerBg: "rgba(237, 233, 254, 0.60)",   // violet-50
    labelColor: "rgb(91, 33, 182)",
    iconColor: "rgb(124, 58, 237)",
  },
  variation: {
    headerBg: "rgba(224, 242, 254, 0.60)",   // sky-50
    labelColor: "rgb(7, 89, 133)",
    iconColor: "rgb(14, 116, 144)",
  },
  action: {
    headerBg: "rgba(209, 250, 229, 0.55)",   // emerald-50
    labelColor: "rgb(6, 78, 59)",
    iconColor: "rgb(5, 150, 105)",
  },
} as const;

// Y positions for each phase (card center)
const Y_INTERSECTION = 92;
const Y_DIVERGE = 260;
const Y_EXPLORE = 380;
const Y_CONVERGE = 530;
const Y_ACT = 670;

// ─────────────────────────────────────────────────────────────────────

export default function SynergyR5MockupPage() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="border-b border-gray-200/70 bg-white">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-8 py-4">
          <div className="text-[15px] font-semibold text-gray-900">
            Synergy room · R5 preview
          </div>
          <div className="text-[11px] font-medium text-gray-400">Preflight</div>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-8 pb-20 pt-10">
        <RoomScene />
        <Caption />
        <SectionExistingCards />
        <SectionUpgradedCards />
        <SectionClickBehavior />
        <SectionNewVisuals />
        <SectionExpandedView />
        <SectionBentoVariations />
        <SectionBentoVariationsSidebar />
        <SectionAgencyModel />
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Section divider
// ─────────────────────────────────────────────────────────────────────

function SectionDivider({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="mt-24 mb-10 border-t border-gray-200 pt-12">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-[24px] font-semibold tracking-tight text-gray-900">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-500">
        {body}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Section A — what we have today (faithful replicas)
// ─────────────────────────────────────────────────────────────────────

function SectionExistingCards() {
  return (
    <section>
      <SectionDivider
        eyebrow="Section A · Current production"
        title="What our cards look like today"
        body="Five representative card variations as they actually render in the live app. Each example is a faithful replica of an existing component so we can see the baseline before deciding how to upgrade it."
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* SynergyNode — solo whiteboard pill, kind-driven color */}
        <SpecimenFrame
          label="SynergyNode (solo whiteboard)"
          path="src/components/synergy/synergy-node.tsx"
          note="10 kinds, each with a bg + ring + text-color triplet. Pill-shaped, single line, no header strip — kind is conveyed by the whole card tinted."
        >
          <div className="flex flex-wrap items-center gap-3">
            <ExistingSynergyNodePill kind="core" label="Optimize 30-min routine" />
            <ExistingSynergyNodePill kind="insight" label="Ramp-up takes 5–10 min" />
            <ExistingSynergyNodePill kind="question" label="Daily or weekly?" />
            <ExistingSynergyNodePill kind="action" label="Email Dr. Patel" />
            <ExistingSynergyNodePill kind="plan" label="Week 1: VS Code setup" />
            <ExistingSynergyNodePill kind="synergy" label="Lateral synthesis" />
          </div>
        </SpecimenFrame>

        {/* RoomNodeCard — room canvas, author tinting */}
        <SpecimenFrame
          label="RoomNodeCard (room canvas)"
          path="src/components/synergy/synergy-room-canvas.tsx"
          note="Same chrome as SynergyNode but tinted by author — mine=blue, theirs=emerald, AI=purple. Tiny chip in the corner says 'you' / 'them' / 'AI'."
        >
          <div className="flex flex-wrap items-center gap-3">
            <ExistingRoomNodeCard author="mine" label="What if we use rings?" />
            <ExistingRoomNodeCard author="theirs" label="Tools need quickstarts" />
            <ExistingRoomNodeCard author="ai" label="Track minutes per session" />
          </div>
        </SpecimenFrame>

        {/* PlanStepBlock — strategy doc */}
        <SpecimenFrame
          label="PlanStepBlock (strategy doc)"
          path="src/components/synergy/synergy-strategy-blocks.tsx"
          note="Vertical timeline of 5 plan steps. Each row: dashed spine + 24px glyph tile + STEP 0N caps label + title + body + metadata pills (time / cadence / mode)."
        >
          <ExistingPlanStep
            index={0}
            title="Schedule Daily 30-Minute Sessions"
            body="Allocate a consistent 30-min block each day dedicated to reading, modeling, and collaborating."
            pills={["Daily", "30 min", "Solo focus"]}
          />
        </SpecimenFrame>

        {/* ExpandableComponentRow — processing surface */}
        <SpecimenFrame
          label="ExpandableComponentRow (matchable component)"
          path="src/components/synergy/synergy-components-card.tsx"
          note="Compact one-line row with kind icon + label + a three-state availability badge (private · indexing · room-ready · N). Click expands inline."
        >
          <ExistingMatchableRow
            kind="downstream"
            label="Open-access cognitive modeling toolkit"
            badge="room-ready"
            badgeCount={3}
          />
          <ExistingMatchableRow
            kind="upstream"
            label="Need: shareable analysis sessions"
            badge="indexing"
          />
          <ExistingMatchableRow
            kind="core_idea"
            label="Daily ring tracker app"
            badge="private"
          />
        </SpecimenFrame>

        {/* KG node — old canvas */}
        <SpecimenFrame
          label="kg-node-shape (old canvas)"
          path="src/components/canvas/shapes/kg-node-shape.tsx"
          note="Tier badge (hero/key/support/peripheral) + sparkline trend chart + confidence halo on ghost entities + small icons for leverage/risk/bottleneck flags."
        >
          <ExistingKGNode
            tier="hero"
            label="Session Routine"
            confidence={0.86}
            weight={32}
          />
          <ExistingKGNode
            tier="support"
            label="Modeling Tool"
            confidence={0.61}
            weight={14}
          />
        </SpecimenFrame>

        {/* Sticky note — old canvas */}
        <SpecimenFrame
          label="sticky-note-shape (old canvas)"
          path="src/components/canvas/shapes/sticky-note-shape.tsx"
          note="5 colors × 6 dimensions (problem/solution/question/insight/risk/evidence). AI-tagged sticky shows a sparkle indicator + can open research panel."
        >
          <div className="flex flex-wrap items-center gap-3">
            <ExistingSticky color="yellow" dimension="insight" text="Ramp-up cost is real but compounds quickly" />
            <ExistingSticky color="pink" dimension="risk" text="Need to track ROI of routine" aiTagged />
            <ExistingSticky color="green" dimension="solution" text="Time-block via Apple Watch ring" />
          </div>
        </SpecimenFrame>
      </div>
    </section>
  );
}

function SpecimenFrame({
  label,
  path,
  note,
  children,
}: {
  label: string;
  path: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <div className="text-[13px] font-semibold text-gray-900">{label}</div>
        <div className="mt-0.5 text-[10.5px] text-gray-400">{path}</div>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{note}</p>
      </div>
      <div className="rounded-xl bg-gray-50 p-5">
        <div className="flex flex-col gap-2.5">{children}</div>
      </div>
    </article>
  );
}

// ── Existing card replicas (faithful to current production styling) ──

function ExistingSynergyNodePill({
  kind,
  label,
}: {
  kind:
    | "core"
    | "branch"
    | "insight"
    | "question"
    | "action"
    | "variation"
    | "plan"
    | "synergy";
  label: string;
}) {
  // Mirrors KIND_STYLES from synergy-node.tsx
  const styles = {
    core: { bg: "bg-blue-50", ring: "ring-blue-300", text: "text-blue-900", label: "core" },
    branch: { bg: "bg-white", ring: "ring-gray-300", text: "text-gray-900", label: "branch" },
    insight: { bg: "bg-purple-50", ring: "ring-purple-300", text: "text-purple-900", label: "insight" },
    question: { bg: "bg-amber-50", ring: "ring-amber-300", text: "text-amber-900", label: "question" },
    action: { bg: "bg-emerald-50", ring: "ring-emerald-300", text: "text-emerald-900", label: "action" },
    variation: { bg: "bg-fuchsia-50", ring: "ring-fuchsia-300", text: "text-fuchsia-900", label: "variation" },
    plan: { bg: "bg-sky-50", ring: "ring-sky-400", text: "text-sky-900", label: "plan" },
    synergy: { bg: "bg-amber-50", ring: "ring-amber-400", text: "text-amber-900", label: "synergy" },
  }[kind];
  return (
    <div
      className={`select-none rounded-2xl px-3 py-2 text-xs shadow-sm ring-1 ${styles.bg} ${styles.ring} ${styles.text}`}
      style={{ maxWidth: 220 }}
    >
      <div className="font-mono text-[9px] uppercase tracking-wider opacity-60">
        {styles.label}
      </div>
      <div className="mt-0.5 font-medium leading-snug">{label}</div>
    </div>
  );
}

function ExistingRoomNodeCard({
  author,
  label,
}: {
  author: "mine" | "theirs" | "ai";
  label: string;
}) {
  const styles = {
    mine: {
      ring: "ring-blue-200",
      bg: "bg-blue-50/40",
      chipBg: "bg-blue-500/15",
      chipText: "text-blue-700",
      tag: "you",
    },
    theirs: {
      ring: "ring-emerald-200",
      bg: "bg-emerald-50/40",
      chipBg: "bg-emerald-500/15",
      chipText: "text-emerald-700",
      tag: "them",
    },
    ai: {
      ring: "ring-purple-200",
      bg: "bg-purple-50/40",
      chipBg: "bg-purple-500/15",
      chipText: "text-purple-700",
      tag: "AI",
    },
  }[author];
  return (
    <div
      className={`select-none rounded-2xl px-3 py-2 text-xs ring-1 ${styles.ring} ${styles.bg}`}
      style={{ minWidth: 170, maxWidth: 240 }}
    >
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-wider opacity-60">
        <span>branch</span>
        <span
          className={`rounded-full ${styles.chipBg} px-1 text-[8px] ${styles.chipText}`}
        >
          {styles.tag}
        </span>
      </div>
      <div className="mt-0.5 font-medium leading-snug text-gray-900">
        {label}
      </div>
    </div>
  );
}

function ExistingPlanStep({
  index,
  title,
  body,
  pills,
}: {
  index: number;
  title: string;
  body: string;
  pills: string[];
}) {
  return (
    <div className="grid grid-cols-[24px_1fr] gap-4 pl-1">
      <div className="relative flex justify-center">
        <div
          aria-hidden
          className="absolute top-9 bottom-[-16px] w-px"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(15,23,42,0.16) 50%, transparent 50%)",
            backgroundSize: "1px 7px",
            backgroundRepeat: "repeat-y",
          }}
        />
        <div
          className="relative z-10 mt-[2px] inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white text-gray-600 ring-1 ring-black/[0.06]"
          style={{
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(15,23,42,0.04)",
          }}
        >
          <Target className="h-3 w-3" strokeWidth={1.75} />
        </div>
      </div>
      <div className="pb-2">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
          Step {String(index + 1).padStart(2, "0")}
        </div>
        <div className="text-[14px] font-semibold leading-snug text-gray-900">
          {title}
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-600">
          {body}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pills.map((p) => (
            <span
              key={p}
              className="rounded-full bg-white px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600 ring-1 ring-gray-200"
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExistingMatchableRow({
  kind,
  label,
  badge,
  badgeCount,
}: {
  kind: "upstream" | "downstream" | "core_idea";
  label: string;
  badge: "private" | "indexing" | "room-ready";
  badgeCount?: number;
}) {
  const badgeStyles = {
    private: { bg: "bg-gray-100", text: "text-gray-600", label: "Private" },
    indexing: { bg: "bg-amber-50", text: "text-amber-800", label: "Indexing" },
    "room-ready": {
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      label: badgeCount ? `Room-ready · ${badgeCount}` : "Room-ready",
    },
  }[badge];
  const kindLabel = {
    upstream: "Upstream",
    downstream: "Downstream",
    core_idea: "Core idea",
  }[kind];
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3.5 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-gray-400" strokeWidth={1.75} />
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
            {kindLabel}
          </div>
          <div className="truncate text-[13px] font-medium text-gray-900">
            {label}
          </div>
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full ${badgeStyles.bg} px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${badgeStyles.text}`}
      >
        {badgeStyles.label}
      </span>
    </div>
  );
}

function ExistingKGNode({
  tier,
  label,
  confidence,
  weight,
}: {
  tier: "hero" | "key" | "support" | "peripheral";
  label: string;
  confidence: number;
  weight: number;
}) {
  const tierStyles = {
    hero: { bg: "bg-amber-100", text: "text-amber-900", label: "HERO" },
    key: { bg: "bg-blue-100", text: "text-blue-900", label: "KEY" },
    support: { bg: "bg-gray-100", text: "text-gray-700", label: "SUPPORT" },
    peripheral: { bg: "bg-gray-50", text: "text-gray-500", label: "PERIPH" },
  }[tier];
  // Tiny sparkline path (deterministic decoration)
  const points = Array.from({ length: 12 }, (_, i) => {
    const x = (i / 11) * 80;
    const y = 12 + Math.sin(i * 0.7) * 6 + (i / 11) * 4;
    return `${x},${y}`;
  }).join(" ");
  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-3"
      style={{ width: 220, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className={`rounded-md ${tierStyles.bg} px-1.5 py-0.5 font-mono text-[8.5px] font-semibold tracking-wider ${tierStyles.text}`}
        >
          {tierStyles.label}
        </span>
        <span className="font-numerical font-mono text-[9px] tabular-nums text-gray-400">
          w{weight}
        </span>
      </div>
      <div className="text-[13px] font-semibold leading-snug text-gray-900">
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <svg width="80" height="24" viewBox="0 0 80 24">
          <polyline
            points={points}
            fill="none"
            stroke="rgba(15,23,42,0.45)"
            strokeWidth="1.25"
          />
        </svg>
        <div className="font-numerical font-mono text-[10px] tabular-nums text-gray-500">
          {Math.round(confidence * 100)}%
        </div>
      </div>
    </div>
  );
}

function ExistingSticky({
  color,
  dimension,
  text,
  aiTagged,
}: {
  color: "yellow" | "pink" | "blue" | "green" | "purple";
  dimension: string;
  text: string;
  aiTagged?: boolean;
}) {
  const styles = {
    yellow: { bg: "bg-yellow-100", border: "border-yellow-200" },
    pink: { bg: "bg-rose-100", border: "border-rose-200" },
    blue: { bg: "bg-sky-100", border: "border-sky-200" },
    green: { bg: "bg-emerald-100", border: "border-emerald-200" },
    purple: { bg: "bg-violet-100", border: "border-violet-200" },
  }[color];
  return (
    <div
      className={`relative rounded-lg ${styles.bg} ${styles.border} border p-3`}
      style={{ width: 180, minHeight: 110 }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[8.5px] uppercase tracking-wider text-gray-600">
          {dimension}
        </span>
        {aiTagged && (
          <SparkleGlyph />
        )}
      </div>
      <p className="text-[12px] leading-snug text-gray-800">{text}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Section B — upgraded versions of the same cards
// ─────────────────────────────────────────────────────────────────────

function SectionUpgradedCards() {
  return (
    <section>
      <SectionDivider
        eyebrow="Section B · Proposed system"
        title="The same cards, upgraded"
        body="Single typography (sans-serif throughout, no mono caps). Colored header strip per kind (Opal pattern). Body stays white so titles remain readable. Each card is identifiable from across the room without reading the label."
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <SpecimenFrame
          label="SynergyNode → header-strip cards"
          path="upgrade"
          note="Same kinds, same colors — but the color moves to a thin header strip instead of saturating the entire card. Icons live in the header next to the kind name in sans-serif medium."
        >
          <div className="flex flex-wrap items-start gap-3">
            <UpgradedNodeCard kind="core" label="Optimize 30-min routine" />
            <UpgradedNodeCard kind="insight" label="Ramp-up takes 5–10 min" />
            <UpgradedNodeCard kind="question" label="Daily or weekly?" />
            <UpgradedNodeCard kind="action" label="Email Dr. Patel" />
            <UpgradedNodeCard kind="plan" label="Week 1: VS Code setup" />
            <UpgradedNodeCard kind="synergy" label="Lateral synthesis" />
          </div>
        </SpecimenFrame>

        <SpecimenFrame
          label="RoomNodeCard → identity dot, not chip"
          path="upgrade"
          note="Replace the 'you' / 'them' / 'AI' colored chip with a 10px hashed identity dot in the header right corner — same hue as the user's cursor + avatar. Author becomes a glance signal, not a text label."
        >
          <div className="flex flex-wrap items-start gap-3">
            <UpgradedRoomCard
              kind="insight"
              authorId={ME_ID}
              label="What if we use rings?"
            />
            <UpgradedRoomCard
              kind="insight"
              authorId={MAYA_ID}
              label="Tools need quickstarts"
            />
            <UpgradedRoomCard kind="ghost" label="Track minutes per session" />
          </div>
        </SpecimenFrame>

        <SpecimenFrame
          label="PlanStepBlock → header strip + status pill"
          path="upgrade"
          note="The dashed spine + glyph tile stay (they're already Apple-tier). The 'STEP 01' mono-caps caption becomes a sans-serif label inside a slate header strip. Metadata pills move into the header right side. New: a status pill (planned / in progress / done)."
        >
          <UpgradedPlanStep
            index={0}
            title="Schedule Daily 30-Minute Sessions"
            body="Allocate a consistent 30-min block each day dedicated to reading, modeling, and collaborating."
            pills={["Daily", "30 min", "Solo focus"]}
            status="in_progress"
          />
        </SpecimenFrame>

        <SpecimenFrame
          label="ExpandableComponentRow → kind-banded chip"
          path="upgrade"
          note="Left-edge color band (5px wide) carries the upstream / downstream / core_idea kind. Availability badge moves to the right edge in matching color family. No more 'private / indexing' tags fighting kind label for attention."
        >
          <UpgradedMatchableRow
            kind="downstream"
            label="Open-access cognitive modeling toolkit"
            badge="room-ready"
            badgeCount={3}
          />
          <UpgradedMatchableRow
            kind="upstream"
            label="Need: shareable analysis sessions"
            badge="indexing"
          />
          <UpgradedMatchableRow
            kind="core_idea"
            label="Daily ring tracker app"
            badge="private"
          />
        </SpecimenFrame>

        <SpecimenFrame
          label="kg-node-shape → tier in header, sparkline below"
          path="upgrade"
          note="Tier name moves into a colored header strip (hero=amber, key=blue, support=slate, peripheral=gray-50). Sparkline + confidence number stay in the body, but now stand on their own visual grid."
        >
          <UpgradedKGNode tier="hero" label="Session Routine" confidence={0.86} weight={32} />
          <UpgradedKGNode tier="support" label="Modeling Tool" confidence={0.61} weight={14} />
        </SpecimenFrame>

        <SpecimenFrame
          label="sticky-note → dimension in header, body in white"
          path="upgrade"
          note="The colored sticky stays — but only as the HEADER STRIP. Body is white for legibility. AI-tagged stickies get a small sparkle in the header instead of overlaying the body."
        >
          <div className="flex flex-wrap items-start gap-3">
            <UpgradedSticky color="yellow" dimension="insight" text="Ramp-up cost is real but compounds quickly" />
            <UpgradedSticky color="pink" dimension="risk" text="Need to track ROI of routine" aiTagged />
            <UpgradedSticky color="green" dimension="solution" text="Time-block via Apple Watch ring" />
          </div>
        </SpecimenFrame>
      </div>
    </section>
  );
}

// Theme map used by all upgraded cards
const UPGRADE_KIND_THEMES = {
  core:      { bg: "rgba(219, 234, 254, 0.55)", text: "rgb(30, 64, 175)", icon: "rgb(37, 99, 235)" },
  branch:    { bg: "rgba(241, 245, 249, 0.85)", text: "rgb(51, 65, 85)", icon: "rgb(100, 116, 139)" },
  insight:   { bg: "rgba(254, 243, 199, 0.60)", text: "rgb(146, 64, 14)", icon: "rgb(180, 83, 9)" },
  question:  { bg: "rgba(254, 215, 170, 0.55)", text: "rgb(154, 52, 18)", icon: "rgb(194, 65, 12)" },
  action:    { bg: "rgba(209, 250, 229, 0.55)", text: "rgb(6, 78, 59)", icon: "rgb(5, 150, 105)" },
  variation: { bg: "rgba(252, 231, 243, 0.55)", text: "rgb(157, 23, 77)", icon: "rgb(190, 24, 93)" },
  plan:      { bg: "rgba(224, 242, 254, 0.60)", text: "rgb(7, 89, 133)", icon: "rgb(14, 116, 144)" },
  synergy:   { bg: "rgba(254, 243, 199, 0.55)", text: "rgb(120, 53, 15)", icon: "rgb(180, 83, 9)" },
  ghost:     { bg: "aurora", text: "rgb(91, 33, 182)", icon: "rgb(124, 58, 237)" },
} as const;

const KIND_ICON_MAP = {
  core: Target,
  branch: Lightbulb,
  insight: Lightbulb,
  question: Lightbulb,
  action: Zap,
  variation: Lightbulb,
  plan: Lightbulb,
  synergy: Anchor,
  ghost: Lightbulb,
} as const;

// ── KindPill ────────────────────────────────────────────────────────
// Inset rounded-full label used inside every upgraded card. Carries the
// kind in a small contained chip — no edge-to-edge color band.

function KindPill({
  bg,
  textColor,
  iconColor,
  icon: Icon,
  label,
  sparkle,
}: {
  bg: string;
  textColor: string;
  iconColor?: string;
  icon?: typeof Lightbulb;
  label: string;
  sparkle?: boolean;
}) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full"
      style={{
        background: bg,
        padding: "3px 9px",
        border: "1px solid rgba(15,23,42,0.04)",
      }}
    >
      {sparkle ? (
        <SparkleGlyph />
      ) : Icon ? (
        <Icon
          className="h-3 w-3"
          strokeWidth={1.75}
          style={{ color: iconColor }}
        />
      ) : null}
      <span
        className="text-[10.5px] font-semibold tracking-[-0.005em]"
        style={{ color: textColor }}
      >
        {label}
      </span>
    </div>
  );
}

function UpgradedNodeCard({
  kind,
  label,
}: {
  kind: keyof typeof UPGRADE_KIND_THEMES;
  label: string;
}) {
  const t = UPGRADE_KIND_THEMES[kind];
  const Icon = KIND_ICON_MAP[kind];
  return (
    <div
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
      style={{ width: 200, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <KindPill
          bg={t.bg}
          textColor={t.text}
          iconColor={t.icon}
          icon={Icon}
          label={kind}
        />
      </div>
      <div className="px-3 pb-3 pt-2">
        <div className="text-[12.5px] font-semibold leading-snug text-gray-900">
          {label}
        </div>
      </div>
    </div>
  );
}

function UpgradedRoomCard({
  kind,
  authorId,
  label,
}: {
  kind: "insight" | "action" | "ghost";
  authorId?: string;
  label: string;
}) {
  const t =
    kind === "ghost"
      ? UPGRADE_KIND_THEMES.ghost
      : UPGRADE_KIND_THEMES[kind];
  const Icon = KIND_ICON_MAP[kind];
  const av = authorId ? abstractAvatarFor(authorId) : null;
  const isGhost = kind === "ghost";
  return (
    <div
      className="overflow-hidden rounded-xl border bg-white"
      style={{
        width: 200,
        borderColor: isGhost ? "rgba(124,58,237,0.15)" : "rgba(15,23,42,0.07)",
        boxShadow: isGhost
          ? "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -16px rgba(124,58,237,0.25)"
          : "0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <KindPill
          bg={
            isGhost
              ? "linear-gradient(180deg, rgba(244,232,255,0.95), rgba(232,241,254,0.85))"
              : t.bg
          }
          textColor={t.text}
          iconColor={t.icon}
          icon={isGhost ? undefined : Icon}
          label={isGhost ? "From voice" : kind}
          sparkle={isGhost}
        />
        {av && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: `hsl(${av.hue}, 70%, 55%)`,
            }}
          />
        )}
      </div>
      <div className="px-3 pb-3 pt-2">
        <div className="text-[12.5px] font-semibold leading-snug text-gray-900">
          {label}
        </div>
      </div>
    </div>
  );
}

function UpgradedPlanStep({
  index,
  title,
  body,
  pills,
  status,
}: {
  index: number;
  title: string;
  body: string;
  pills: string[];
  status: "planned" | "in_progress" | "done";
}) {
  const t = UPGRADE_KIND_THEMES.plan;
  const statusMeta = {
    planned: { bg: "bg-gray-100", text: "text-gray-600", label: "Planned" },
    in_progress: { bg: "bg-sky-100", text: "text-sky-800", label: "In progress" },
    done: { bg: "bg-emerald-100", text: "text-emerald-800", label: "Done" },
  }[status];
  return (
    <div className="grid grid-cols-[24px_1fr] gap-4 pl-1">
      <div className="relative flex justify-center">
        <div
          aria-hidden
          className="absolute top-9 bottom-[-16px] w-px"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(15,23,42,0.16) 50%, transparent 50%)",
            backgroundSize: "1px 7px",
            backgroundRepeat: "repeat-y",
          }}
        />
        <div
          className="relative z-10 mt-[2px] inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white text-gray-600 ring-1 ring-black/[0.06]"
          style={{
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(15,23,42,0.04)",
          }}
        >
          <Target className="h-3 w-3" strokeWidth={1.75} />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between px-3 pt-3">
          <KindPill
            bg={t.bg}
            textColor={t.text}
            label={`Step ${String(index + 1).padStart(2, "0")}`}
          />
          <span
            className={`rounded-full ${statusMeta.bg} px-2 py-0.5 text-[10px] font-semibold ${statusMeta.text}`}
          >
            {statusMeta.label}
          </span>
        </div>
        <div className="px-4 pb-3 pt-2.5">
          <div className="text-[14px] font-semibold leading-snug text-gray-900">
            {title}
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-600">
            {body}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pills.map((p) => (
              <span
                key={p}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UpgradedMatchableRow({
  kind,
  label,
  badge,
  badgeCount,
}: {
  kind: "upstream" | "downstream" | "core_idea";
  label: string;
  badge: "private" | "indexing" | "room-ready";
  badgeCount?: number;
}) {
  const kindStyles = {
    upstream: { color: "rgb(2, 132, 199)", label: "Upstream" },
    downstream: { color: "rgb(5, 150, 105)", label: "Downstream" },
    core_idea: { color: "rgb(91, 33, 182)", label: "Core idea" },
  }[kind];
  const badgeStyles = {
    private: { bg: "bg-gray-100", text: "text-gray-600", label: "Private" },
    indexing: { bg: "bg-amber-100", text: "text-amber-800", label: "Indexing" },
    "room-ready": {
      bg: "bg-emerald-100",
      text: "text-emerald-800",
      label: badgeCount ? `Room-ready · ${badgeCount}` : "Room-ready",
    },
  }[badge];
  return (
    <div
      className="flex items-stretch overflow-hidden rounded-xl border border-gray-200 bg-white"
      style={{ boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}
    >
      <span
        className="w-1 shrink-0"
        style={{ background: kindStyles.color }}
        aria-hidden
      />
      <div className="flex flex-1 items-center justify-between px-3.5 py-2.5">
        <div className="min-w-0">
          <div
            className="text-[10px] font-semibold"
            style={{ color: kindStyles.color }}
          >
            {kindStyles.label}
          </div>
          <div className="truncate text-[13px] font-medium text-gray-900">
            {label}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full ${badgeStyles.bg} px-2 py-0.5 text-[10px] font-semibold ${badgeStyles.text}`}
        >
          {badgeStyles.label}
        </span>
      </div>
    </div>
  );
}

function UpgradedKGNode({
  tier,
  label,
  confidence,
  weight,
}: {
  tier: "hero" | "key" | "support" | "peripheral";
  label: string;
  confidence: number;
  weight: number;
}) {
  const tierStyles = {
    hero: { bg: "rgba(254, 215, 170, 0.55)", text: "rgb(154, 52, 18)", label: "Hero" },
    key: { bg: "rgba(219, 234, 254, 0.55)", text: "rgb(30, 64, 175)", label: "Key" },
    support: { bg: "rgba(241, 245, 249, 0.85)", text: "rgb(51, 65, 85)", label: "Support" },
    peripheral: { bg: "rgba(248, 250, 252, 0.85)", text: "rgb(100, 116, 139)", label: "Peripheral" },
  }[tier];
  const points = Array.from({ length: 12 }, (_, i) => {
    const x = (i / 11) * 80;
    const y = 12 + Math.sin(i * 0.7) * 6 + (i / 11) * 4;
    return `${x},${y}`;
  }).join(" ");
  return (
    <div
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
      style={{ width: 220, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <KindPill
          bg={tierStyles.bg}
          textColor={tierStyles.text}
          label={tierStyles.label}
        />
        <span className="text-[10px] tabular-nums text-gray-500">w{weight}</span>
      </div>
      <div className="px-3.5 pb-3 pt-2">
        <div className="text-[12.5px] font-semibold leading-snug text-gray-900">
          {label}
        </div>
        <div className="mt-2 flex items-end justify-between gap-2">
          <svg width="80" height="24" viewBox="0 0 80 24">
            <polyline
              points={points}
              fill="none"
              stroke="rgba(15,23,42,0.45)"
              strokeWidth="1.25"
            />
          </svg>
          <div className="text-[11px] font-semibold tabular-nums text-gray-700">
            {Math.round(confidence * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
}

function UpgradedSticky({
  color,
  dimension,
  text,
  aiTagged,
}: {
  color: "yellow" | "pink" | "blue" | "green" | "purple";
  dimension: string;
  text: string;
  aiTagged?: boolean;
}) {
  const styles = {
    yellow: { bg: "rgba(254, 240, 138, 0.55)", text: "rgb(133, 77, 14)" },
    pink: { bg: "rgba(251, 207, 232, 0.55)", text: "rgb(157, 23, 77)" },
    blue: { bg: "rgba(186, 230, 253, 0.55)", text: "rgb(7, 89, 133)" },
    green: { bg: "rgba(187, 247, 208, 0.55)", text: "rgb(22, 101, 52)" },
    purple: { bg: "rgba(221, 214, 254, 0.55)", text: "rgb(91, 33, 182)" },
  }[color];
  return (
    <div
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
      style={{ width: 180, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <KindPill
          bg={styles.bg}
          textColor={styles.text}
          label={dimension.charAt(0).toUpperCase() + dimension.slice(1)}
          sparkle={aiTagged}
        />
      </div>
      <div className="px-3 pb-3 pt-2">
        <p className="text-[12px] leading-snug text-gray-800">{text}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Section D — click-to-expand behavior
// ─────────────────────────────────────────────────────────────────────

function SectionClickBehavior() {
  return (
    <section>
      <SectionDivider
        eyebrow="Section D · Interaction"
        title="What happens when you click a card"
        body="Single click = action popover (the 7-tile menu that already exists in our codebase). Right rail switches to a new Inspector tab — a per-card editing surface that doesn't exist today and would need to be built."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: card + action popover */}
        <article className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-2 text-[13px] font-semibold text-gray-900">
            Click → action popover
          </div>
          <p className="mb-5 text-[12px] leading-relaxed text-gray-500">
            Reuses{" "}
            <code className="rounded bg-gray-100 px-1 text-[11px]">
              synergy-node-action-popover.tsx
            </code>{" "}
            — already shipped. 7 tile actions + a free-form input with voice
            dictation.
          </p>
          <div className="relative rounded-xl bg-gray-50 p-8">
            <div className="mx-auto" style={{ width: 240 }}>
              <SelectedCardForDemo />
              <div className="mt-3">
                <ActionPopoverDemo />
              </div>
            </div>
          </div>
        </article>

        {/* Right: right-rail inspector tab (NEW) */}
        <article className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-gray-900">
            Edit → right-rail Inspector
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              New
            </span>
          </div>
          <p className="mb-5 text-[12px] leading-relaxed text-gray-500">
            The right rail gets a third tab (Timeline · Chat · <strong>Inspector</strong>). When a card is selected, Inspector fills with its full editable surface. This panel does not exist today.
          </p>
          <div className="rounded-xl bg-gray-50 p-5">
            <InspectorPanelDemo />
          </div>
        </article>
      </div>
    </section>
  );
}

function SelectedCardForDemo() {
  return (
    <div
      className="overflow-hidden rounded-2xl border bg-white"
      style={{
        borderColor: "rgba(124,58,237,0.30)",
        boxShadow:
          "0 0 0 3px rgba(124,58,237,0.10), 0 1px 2px rgba(15,23,42,0.04), 0 10px 24px -16px rgba(15,23,42,0.18)",
      }}
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <KindPill
          bg={UPGRADE_KIND_THEMES.insight.bg}
          textColor={UPGRADE_KIND_THEMES.insight.text}
          iconColor={UPGRADE_KIND_THEMES.insight.icon}
          icon={Lightbulb}
          label="Insight"
        />
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: `hsl(${ME_AV.hue}, 70%, 55%)`,
          }}
        />
      </div>
      <div className="px-3 pb-3 pt-2">
        <div className="text-[13px] font-semibold leading-snug text-gray-900">
          Ramp-up takes 5–10 min to load the mental model
        </div>
      </div>
    </div>
  );
}

function ActionPopoverDemo() {
  const tiles: Array<{ name: string; icon: typeof Lightbulb }> = [
    { name: "Decompose", icon: Lightbulb },
    { name: "Variations", icon: Lightbulb },
    { name: "Questions", icon: Lightbulb },
    { name: "Research", icon: Lightbulb },
    { name: "Plan", icon: Target },
    { name: "Rank", icon: Lightbulb },
    { name: "Tidy", icon: Lightbulb },
  ];
  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-2.5"
      style={{ boxShadow: "0 8px 24px -8px rgba(15,23,42,0.18)" }}
    >
      <div className="grid grid-cols-4 gap-1.5">
        {tiles.map((t) => (
          <button
            key={t.name}
            type="button"
            className="flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition hover:bg-gray-50"
          >
            <t.icon className="h-3.5 w-3.5 text-gray-700" strokeWidth={1.75} />
            <span className="text-[10px] font-medium text-gray-700">
              {t.name}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
        <Mic className="h-3 w-3 text-gray-400" strokeWidth={1.75} />
        <span className="flex-1 text-[11px] text-gray-400">
          Or describe what you want…
        </span>
      </div>
    </div>
  );
}

function InspectorPanelDemo() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* Tab strip */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <div className="inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-gray-50 p-0.5 text-[10px] font-medium">
          <span className="rounded-full px-2.5 py-1 text-gray-500">Timeline</span>
          <span className="rounded-full px-2.5 py-1 text-gray-500">Chat</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-white">
            Inspector
          </span>
        </div>
      </div>
      <div className="p-4">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">
          Insight
        </div>
        <div className="mt-1 text-[14px] font-semibold leading-snug text-gray-900">
          Ramp-up takes 5–10 min to load the mental model
        </div>

        <div className="mt-4 space-y-3">
          <InspectorField label="Body">
            Each session needs warm-up time before productive modeling can
            start. We&apos;re losing about a third of each session to this.
          </InspectorField>
          <InspectorField label="Author">
            <div className="inline-flex items-center gap-1.5">
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: `hsl(${ME_AV.hue}, 70%, 55%)`,
                }}
              />
              <span className="text-[12px] font-medium text-gray-700">You</span>
            </div>
          </InspectorField>
          <InspectorField label="Created">
            <span className="text-[12px] text-gray-600">3 minutes ago</span>
          </InspectorField>
          <InspectorField label="Connections">
            <div className="flex flex-wrap gap-1.5">
              <ConnectionChip label="Daily 30-min routine" kind="anchor" />
              <ConnectionChip label="Email Dr. Patel" kind="action" />
              <ConnectionChip label="Daily ring metaphor" kind="ghost" />
            </div>
          </InspectorField>
        </div>

        <div className="mt-5 flex items-center gap-1.5 border-t border-gray-100 pt-3">
          <button
            type="button"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white"
          >
            Save
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-200 px-3 py-1.5 text-[11px] font-medium text-gray-600"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function InspectorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-[12.5px] leading-relaxed text-gray-700">
        {children}
      </div>
    </div>
  );
}

function ConnectionChip({
  label,
  kind,
}: {
  label: string;
  kind: "anchor" | "insight" | "action" | "ghost";
}) {
  const color = {
    anchor: "rgb(100, 116, 139)",
    insight: "rgb(180, 83, 9)",
    action: "rgb(5, 150, 105)",
    ghost: "rgb(124, 58, 237)",
  }[kind];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 ring-1 ring-gray-200"
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
        }}
      />
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Section E — visualizations not in codebase today
// ─────────────────────────────────────────────────────────────────────

function SectionNewVisuals() {
  return (
    <section>
      <SectionDivider
        eyebrow="Section E · To build"
        title="Visualizations not in our codebase today"
        body="Each of these would be a new component. None exist in either the old canvas or the new Synergy track. Listed in priority order — AI orb first since it gives the AI a spatial presence the user can read."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <NewVisualCard
          eyebrow="01"
          title="AI presence orb"
          body="A persistent iridescent sphere on the canvas, tethered to active ghost cards by soft connection lines. Same Apple-Intelligence material as ghost headers. Gives the AI a where so users can trace lineage visually."
        >
          <AIOrbDemo />
        </NewVisualCard>

        <NewVisualCard
          eyebrow="02"
          title="Decision / branch card"
          body="If/else card with N condition rows stacked inside. Each row connects to its downstream branch. Spawned when the AI extracts a decision point from voice (“should we A or B?”). No equivalent in our codebase today."
        >
          <DecisionCardDemo />
        </NewVisualCard>

        <NewVisualCard
          eyebrow="03"
          title="Parallel-branch preview popup"
          body="On hover of a + button between cards, show a tiny preview of what the topology will look like if the user adds a parallel branch — green dotted ghosts of the would-be cards."
        >
          <BranchPreviewDemo />
        </NewVisualCard>

        <NewVisualCard
          eyebrow="04"
          title="Connection annotation"
          body="A small chip riding on a connection arc, labeling the relationship (“depends on”, “produces”, “contradicts”). Borrowed from Image 4. Surfaces the why of a connection, not just that one exists."
        >
          <ConnectionAnnotationDemo />
        </NewVisualCard>

        <NewVisualCard
          eyebrow="05"
          title="Mini-map overview"
          body="160×100 bird's-eye thumbnail of the entire canvas in the bottom-right. Cards render as colored dots by kind. Click-to-pan. Critical once a room has 30+ cards — there's no equivalent in either codebase."
        >
          <MiniMapDemo />
        </NewVisualCard>

        <NewVisualCard
          eyebrow="06"
          title="Confidence ring + status pill"
          body="Ring around card edge encodes AI confidence (filled arc = 100%). Status pill in header right (Proposed · Active · Done · Stale). Status comes from kg-node-shape; ring is new."
        >
          <ConfidenceRingDemo />
        </NewVisualCard>
      </div>
    </section>
  );
}

function NewVisualCard({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
            {eyebrow} · Not in codebase
          </div>
          <h3 className="mt-1 text-[15px] font-semibold text-gray-900">
            {title}
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-gray-500">
            {body}
          </p>
        </div>
      </div>
      <div className="rounded-xl bg-gray-50 p-6">
        <div className="flex items-center justify-center">{children}</div>
      </div>
    </article>
  );
}

function AIOrbDemo() {
  return (
    <div className="relative" style={{ width: 360, height: 180 }}>
      {/* A small ghost card on left, orb on right, connection between */}
      <UpgradedRoomCard kind="ghost" label="Daily ring metaphor" />
      <svg className="absolute inset-0" width="360" height="180" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="orb-link" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(167, 139, 250, 0.6)" />
            <stop offset="100%" stopColor="rgba(125, 211, 252, 0.6)" />
          </linearGradient>
        </defs>
        <path
          d="M 200 50 C 250 50, 240 110, 290 110"
          fill="none"
          stroke="url(#orb-link)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <div
        className="absolute"
        style={{
          right: 8,
          top: 60,
          width: 60,
          height: 60,
        }}
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            background: [
              "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.95), transparent 50%)",
              "radial-gradient(circle, rgba(244,232,255,1), rgba(196,181,253,0.85))",
            ].join(", "),
            boxShadow:
              "inset 0 1px 2px rgba(255,255,255,0.8), 0 4px 24px rgba(124,58,237,0.30), 0 0 0 1px rgba(124,58,237,0.10)",
          }}
        />
        <div className="mt-1.5 text-center text-[10px] font-medium text-gray-600">
          AI
        </div>
      </div>
    </div>
  );
}

function DecisionCardDemo() {
  return (
    <div
      className="overflow-hidden rounded-xl border bg-white"
      style={{
        width: 240,
        borderColor: "rgba(15,23,42,0.07)",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <KindPill
          bg="rgba(245, 243, 255, 0.95)"
          textColor="rgb(91, 33, 182)"
          label="Decision"
        />
      </div>
      <div className="px-3.5 pb-3 pt-2">
        <div className="text-[12.5px] font-semibold leading-snug text-gray-900">
          Track session minutes — how often?
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center gap-2 rounded-md bg-gray-50 px-2.5 py-1.5 text-[11.5px]">
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-emerald-700">
              if
            </span>
            <span className="text-gray-700">user is deeply focused</span>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-gray-50 px-2.5 py-1.5 text-[11.5px]">
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-rose-700">
              else
            </span>
            <span className="text-gray-700">user is doing maintenance</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchPreviewDemo() {
  return (
    <div className="relative" style={{ width: 280, height: 160 }}>
      {/* Existing card */}
      <div
        className="absolute"
        style={{ top: 0, left: 10, width: 200 }}
      >
        <UpgradedNodeCard kind="insight" label="Ramp-up takes 5–10 min" />
      </div>
      {/* Plus button between */}
      <div
        className="absolute z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white text-gray-700 ring-1 ring-gray-200"
        style={{
          left: 100,
          top: 75,
          boxShadow: "0 2px 6px rgba(15,23,42,0.08)",
        }}
      >
        <Plus className="h-3 w-3" strokeWidth={2} />
      </div>
      {/* Ghost preview cards */}
      <div
        className="absolute"
        style={{
          top: 110,
          left: 0,
          width: 130,
          opacity: 0.6,
          borderLeft: "2px dashed rgba(124,58,237,0.5)",
          paddingLeft: 8,
        }}
      >
        <div
          className="rounded-md bg-white px-2 py-1 text-[10px] font-medium text-gray-700 ring-1 ring-violet-200"
          style={{ borderStyle: "dashed" }}
        >
          New branch A
        </div>
      </div>
      <div
        className="absolute"
        style={{
          top: 110,
          left: 150,
          width: 130,
          opacity: 0.6,
          borderLeft: "2px dashed rgba(124,58,237,0.5)",
          paddingLeft: 8,
        }}
      >
        <div className="rounded-md bg-white px-2 py-1 text-[10px] font-medium text-gray-700 ring-1 ring-violet-200">
          New branch B
        </div>
      </div>
    </div>
  );
}

function ConnectionAnnotationDemo() {
  return (
    <div className="relative" style={{ width: 360, height: 140 }}>
      <div className="absolute left-0 top-12 w-[140px]">
        <UpgradedNodeCard kind="insight" label="Ramp-up takes 5–10 min" />
      </div>
      <div className="absolute right-0 top-12 w-[140px]">
        <UpgradedNodeCard kind="action" label="Email Dr. Patel" />
      </div>
      <svg className="absolute inset-0" width="360" height="140" style={{ overflow: "visible" }}>
        <path
          d="M 142 65 C 200 65, 220 65, 220 65"
          fill="none"
          stroke="rgba(15,23,42,0.30)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line x1="142" y1="65" x2="220" y2="65" stroke="rgba(15,23,42,0.30)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {/* Annotation chip on the line */}
      <div
        className="absolute left-1/2 top-[52px] -translate-x-1/2 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-gray-700 ring-1 ring-gray-200"
        style={{ boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}
      >
        leads to
      </div>
    </div>
  );
}

function MiniMapDemo() {
  return (
    <div
      className="rounded-lg bg-white"
      style={{
        width: 200,
        height: 120,
        border: "1px solid rgba(15,23,42,0.08)",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
        position: "relative",
        backgroundImage:
          "radial-gradient(circle, rgba(15,23,42,0.04) 1px, transparent 1px)",
        backgroundSize: "10px 10px",
      }}
    >
      {/* Dots representing cards by kind */}
      {[
        { x: 30, y: 18, color: "rgb(100,116,139)" },
        { x: 120, y: 18, color: "rgb(100,116,139)" },
        { x: 30, y: 50, color: "rgb(180,83,9)" },
        { x: 120, y: 50, color: "rgb(180,83,9)" },
        { x: 75, y: 80, color: "rgb(124,58,237)" },
        { x: 30, y: 100, color: "rgb(5,150,105)" },
      ].map((d, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: d.x,
            top: d.y,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: d.color,
          }}
        />
      ))}
      {/* Viewport frame (current view) */}
      <div
        className="absolute rounded"
        style={{
          left: 40,
          top: 40,
          width: 90,
          height: 60,
          border: "1.25px solid rgba(15,23,42,0.45)",
          background: "rgba(15,23,42,0.04)",
        }}
      />
    </div>
  );
}

function ConfidenceRingDemo() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border bg-white"
      style={{
        width: 220,
        borderColor: "rgba(15,23,42,0.07)",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      {/* Confidence ring overlay (top edge) */}
      <svg
        width="220"
        height="4"
        className="absolute left-0 top-0"
        style={{ zIndex: 1 }}
      >
        <rect x="0" y="0" width="156" height="4" fill="rgb(124,58,237)" opacity="0.7" />
        <rect x="156" y="0" width="64" height="4" fill="rgba(124,58,237,0.15)" />
      </svg>
      <div className="flex items-center justify-between px-3 pt-3">
        <KindPill
          bg={UPGRADE_KIND_THEMES.insight.bg}
          textColor={UPGRADE_KIND_THEMES.insight.text}
          iconColor={UPGRADE_KIND_THEMES.insight.icon}
          icon={Lightbulb}
          label="Insight"
        />
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[9.5px] font-semibold text-sky-800">
          Active
        </span>
      </div>
      <div className="px-3.5 pb-3 pt-2">
        <div className="text-[12.5px] font-semibold leading-snug text-gray-900">
          Ramp-up takes 5–10 min
        </div>
        <div className="mt-1.5 text-[10px] text-gray-500">
          71% confidence · 2d old
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Section F — Expanded card view (the full artifact world)
// ─────────────────────────────────────────────────────────────────────

function SectionExpandedView() {
  return (
    <section>
      <SectionDivider
        eyebrow="Section F · Open as detail"
        title="A node, expanded into its full artifact world"
        body="A card isn't just a title — it's a concept page. Tap a card from the popover or hit 'Open as detail' from the slim inspector and you land here. Twelve artifact zones across one scrollable surface, every zone optional but powerful when filled in. Every node is potentially a mini-app."
      />
      <ExpandedNodeInspector />
    </section>
  );
}

function ExpandedNodeInspector() {
  return (
    <article
      className="mx-auto overflow-hidden rounded-2xl border border-gray-200 bg-white"
      style={{
        maxWidth: 760,
        boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 18px 48px -24px rgba(15,23,42,0.20)",
      }}
    >
      {/* Header strip with pill, status, and overflow */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <KindPill
            bg={UPGRADE_KIND_THEMES.insight.bg}
            textColor={UPGRADE_KIND_THEMES.insight.text}
            iconColor={UPGRADE_KIND_THEMES.insight.icon}
            icon={Lightbulb}
            label="Insight"
          />
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
            Active
          </span>
          <span className="text-[11px] text-gray-400">
            · 71% confidence · 2d old
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: `hsl(${ME_AV.hue}, 70%, 55%)`,
            }}
            title="Owned by you"
          />
          <button
            type="button"
            aria-label="Close"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3L9 9M9 3L3 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Title + body */}
      <div className="px-6 pt-5">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-gray-900">
          Ramp-up takes 5–10 min to load the mental model
        </h1>
        <p className="mt-3 max-w-prose text-[13.5px] leading-relaxed text-gray-600">
          Each cognitive-modeling session needs warm-up time before productive
          work can start — re-reading prior notes, restoring the active
          variables, recalling open hypotheses. We&apos;re losing about a
          third of every 30-min session to this overhead.
        </p>
      </div>

      {/* Zone: Variations — ranked bento (Image 4 inspiration) */}
      <ZoneSection
        title="Variations"
        count={3}
        description="Alternative formulations the AI generated, ranked by fit. The top pick wears an iridescent gradient ring — your eye should land there first."
      >
        <div className="flex flex-col gap-2.5">
          <VariationBentoCard
            rank={1}
            isTop
            title="Apple Watch ring"
            rationale="Visual goal pulls you back into focus. Most familiar UI for daily session tracking — minimal new learning curve."
            stack={[
              { name: "Apple Watch", color: "rgb(15, 23, 42)" },
              { name: "SwiftUI", color: "rgb(239, 68, 68)" },
              { name: "Core ML", color: "rgb(99, 102, 241)" },
            ]}
            confidence={0.87}
          />
          <VariationBentoCard
            rank={2}
            title="Pomodoro split"
            rationale="25-min focus + 5-min review. Hard cut between blocks resets ramp-up cleanly. Lower implementation cost, less native."
            stack={[
              { name: "Tomato Timer", color: "rgb(236, 72, 153)" },
              { name: "Notifications", color: "rgb(245, 158, 11)" },
            ]}
            confidence={0.71}
          />
          <VariationBentoCard
            rank={3}
            title="Voice memo trail"
            rationale="Speak for 60s at session end to bookmark mental state. Resume next session via auto-playback. High novelty, unproven."
            stack={[
              { name: "iOS Voice", color: "rgb(99, 102, 241)" },
              { name: "Whisper", color: "rgb(34, 197, 94)" },
            ]}
            confidence={0.58}
          />
        </div>
      </ZoneSection>

      {/* Zone: Supporting evidence */}
      <ZoneSection
        title="Supporting evidence"
        count={2}
        description="Sources that ground this claim. Drag-drop PDFs, paste URLs, or have the AI find related work."
      >
        <div className="space-y-2">
          <EvidenceRow
            source="Nature"
            label="Deep work transitions cost 23 minutes on average"
            year="2024"
          />
          <EvidenceRow
            source="HBR"
            label="The context-switching tax on knowledge productivity"
            year="2022"
          />
        </div>
      </ZoneSection>

      {/* Zone: Subnodes */}
      <ZoneSection
        title="Subnodes"
        count={4}
        description="This insight broken into smaller pieces — what would have to be built or measured for it to become executable."
      >
        <ul className="space-y-1.5">
          {[
            "Detect ramp-up state via session metrics",
            "Track time-to-productive-output per session",
            "Auto-resume from last cognitive checkpoint",
            "Voice transcript captures pre-ramp context",
          ].map((s) => (
            <li
              key={s}
              className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700"
            >
              <span
                aria-hidden
                className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-gray-400"
              />
              {s}
            </li>
          ))}
        </ul>
      </ZoneSection>

      {/* Zone: Tech stack */}
      <ZoneSection
        title="Tech stack"
        description="Tools and integrations this concept would touch if built. Borrowed from the Lindy / Opal pattern — concept stays connected to its implementation."
      >
        <div className="flex flex-wrap gap-1.5">
          {["Apple Watch", "SwiftUI", "Core ML", "Voice memos", "Notion API"].map(
            (t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11.5px] font-medium text-gray-700"
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "rgb(100, 116, 139)",
                  }}
                />
                {t}
              </span>
            ),
          )}
        </div>
      </ZoneSection>

      {/* Zone: Validate (hypothesis + experiment) */}
      <ZoneSection
        title="Validate"
        description="How would you know this is true? A testable prediction + a suggested experiment."
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-amber-800">
            Hypothesis
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-800">
            Cutting ramp-up by 5 minutes per session yields a 17% increase in
            productive modeling time per week.
          </p>
          <div className="mt-3 border-t border-amber-200/70 pt-2.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-amber-800">
              Experiment
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-gray-800">
              Two-week N=1: alternate days with Apple Watch ring active vs.
              control. Log productive output per session. Compare means.
            </p>
          </div>
        </div>
      </ZoneSection>

      {/* Zone: Connections */}
      <ZoneSection
        title="Connections"
        count={4}
        description="Typed links to other cards. Labels add semantic richness beyond what the canvas spine alone shows."
      >
        <div className="space-y-1.5">
          <ConnectionRow
            kind="anchor"
            verb="depends on"
            label="Daily 30-min cognitive research routine"
          />
          <ConnectionRow
            kind="action"
            verb="leads to"
            label="Email Dr. Patel about MATLAB resources"
          />
          <ConnectionRow
            kind="ghost"
            verb="validates"
            label="Daily ring metaphor for session minutes"
          />
          <ConnectionRow
            kind="insight"
            verb="related to"
            label="Tools need zero-setup entry points"
          />
        </div>
      </ZoneSection>

      {/* Zone: Discussion */}
      <ZoneSection
        title="Discussion"
        count={3}
        description="A thread scoped to THIS card — separate from the room chat so card-detail debates don't pollute the main conversation."
      >
        <div className="space-y-2">
          <DiscussionRow
            authorId={MAYA_ID}
            label="Maya"
            voice
            body="this is the bottleneck of solo deep work — every paper I've read confirms it"
          />
          <DiscussionRow
            authorId={ME_ID}
            label="You"
            body="agreed, and it's measurable too. Let's wire up the timer this week."
          />
          <DiscussionRow
            authorId={MAYA_ID}
            label="Maya"
            body="+1 — I'll spec the SwiftUI side"
          />
        </div>
      </ZoneSection>

      {/* Zone: Counter-evidence */}
      <ZoneSection
        title="Counter-evidence"
        count={1}
        description="The honesty layer — risks and contradicting signals. Top-tier products surface these; lazy ones hide them."
      >
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-rose-700">
            Counter-claim
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-800">
            Pomodoro studies suggest 20–25 minutes is optimal for focused work;
            forcing a 30-min block past natural attention breakpoints may
            *increase* ramp-up cost, not reduce it.
          </p>
        </div>
      </ZoneSection>

      {/* Zone: Confidence trend */}
      <ZoneSection
        title="Confidence trend"
        description="How sure has the AI been about this over time? Borrowed from kg-node-shape — already in the old canvas codebase."
      >
        <div className="flex items-end justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3">
          <svg width="180" height="40" viewBox="0 0 180 40">
            <polyline
              points={Array.from({ length: 18 }, (_, i) => {
                const x = (i / 17) * 180;
                const y = 30 - i * 1.1 - Math.sin(i * 0.8) * 4;
                return `${x},${Math.max(8, y)}`;
              }).join(" ")}
              fill="none"
              stroke="rgba(15,23,42,0.55)"
              strokeWidth="1.5"
            />
            <polyline
              points={Array.from({ length: 18 }, (_, i) => {
                const x = (i / 17) * 180;
                const y = 30 - i * 1.1 - Math.sin(i * 0.8) * 4;
                return `${x},${Math.max(8, y)}`;
              }).join(" ")}
              fill="none"
              stroke="rgba(15,23,42,0.55)"
              strokeWidth="1.5"
              strokeOpacity="0.0"
            />
          </svg>
          <div className="text-right">
            <div className="text-[20px] font-semibold tabular-nums text-gray-900">
              71%
            </div>
            <div className="text-[10.5px] text-gray-500">14 days</div>
          </div>
        </div>
      </ZoneSection>

      {/* Zone: Activity log */}
      <ZoneSection
        title="Activity"
        count={5}
        description="Edit history for this card — who said what when. Provenance matters in collaboration."
      >
        <div className="space-y-1.5">
          {[
            { actor: "Maya", action: "added evidence", time: "2m ago" },
            { actor: "You", action: "promoted variation", time: "5m ago" },
            { actor: "Maya", action: "edited title", time: "1h ago" },
            { actor: "You", action: "added subnode", time: "1h ago" },
            { actor: "AI", action: "extracted from voice", time: "3h ago" },
          ].map((e, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between text-[12px] text-gray-600"
            >
              <span>
                <span className="font-medium text-gray-800">{e.actor}</span>{" "}
                {e.action}
              </span>
              <span className="text-[10.5px] text-gray-400">{e.time}</span>
            </div>
          ))}
        </div>
      </ZoneSection>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-gray-900 px-3.5 py-1.5 text-[12px] font-semibold text-white"
          >
            Save changes
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600"
          >
            Delete card
          </button>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-600 hover:text-gray-900"
        >
          Open as detail page
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path
              d="M3 8L8 3M8 3H4M8 3V7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </article>
  );
}

function ZoneSection({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count?: number;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-gray-100 px-6 py-5">
      <div className="mb-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13.5px] font-semibold text-gray-900">
            {title}
          </h3>
          {count !== undefined && (
            <span className="text-[11px] font-medium tabular-nums text-gray-400">
              · {count}
            </span>
          )}
        </div>
        <p className="mt-0.5 max-w-prose text-[11.5px] leading-relaxed text-gray-500">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

// Tiny iOS-app-style tech stack chip — colored gradient square with
// the brand initial + label. Mimics the integration tiles in Image 3.
function TechStackChip({
  name,
  color,
}: {
  name: string;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10.5px] font-medium text-gray-700">
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-[3.5px] text-[8.5px] font-bold leading-none text-white"
        style={{
          width: 13,
          height: 13,
          background: color,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
        }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
      {name}
    </span>
  );
}

// Bento-style variation card — ranked, with iridescent gradient ring
// on the top pick. Inspired by Bento Pro Vol. 2 (Image 4).
function VariationBentoCard({
  rank,
  isTop,
  title,
  rationale,
  stack,
  confidence,
}: {
  rank: number;
  isTop?: boolean;
  title: string;
  rationale: string;
  stack: Array<{ name: string; color: string }>;
  confidence: number;
}) {
  const card = (
    <div
      className="overflow-hidden rounded-xl bg-white"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(252,252,254,0.97) 100%)",
        boxShadow: isTop
          ? [
              "inset 0 1px 0 rgba(255,255,255,1)",
              "0 1px 2px rgba(15,23,42,0.04)",
              "0 12px 32px -14px rgba(124,58,237,0.20)",
            ].join(", ")
          : [
              "inset 0 1px 0 rgba(255,255,255,1)",
              "0 1px 2px rgba(15,23,42,0.04)",
              "0 8px 20px -12px rgba(15,23,42,0.14)",
            ].join(", "),
      }}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums"
            style={
              isTop
                ? {
                    background:
                      "linear-gradient(135deg, rgba(240,171,252,0.95), rgba(167,139,250,0.95), rgba(125,211,252,0.95))",
                    color: "white",
                    boxShadow: "0 1px 2px rgba(124,58,237,0.20)",
                  }
                : {
                    background: "rgba(15,23,42,0.06)",
                    color: "rgb(71, 85, 105)",
                  }
            }
          >
            #{rank}
          </span>
          {isTop && (
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "rgb(124, 58, 237)" }}
            >
              Best fit
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1 text-[10.5px] text-gray-500">
          <span className="tabular-nums font-semibold text-gray-700">
            {Math.round(confidence * 100)}%
          </span>
          <span>fit</span>
        </div>
      </div>
      <div className="px-4 pb-3 pt-1.5">
        <div className="text-[13.5px] font-semibold leading-snug text-gray-900">
          {title}
        </div>
        <p className="mt-1.5 max-w-prose text-[11.5px] leading-relaxed text-gray-500">
          {rationale}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {stack.map((s) => (
              <TechStackChip key={s.name} name={s.name} color={s.color} />
            ))}
          </div>
          <button
            type="button"
            className={
              isTop
                ? "inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-black"
                : "inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10.5px] font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
            }
          >
            {isTop ? (
              <>
                <SparkleGlyph />
                Use this
              </>
            ) : (
              <>
                <Plus className="h-2.5 w-2.5" strokeWidth={2} />
                Add
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // Iridescent gradient frame on the top pick — wraps the card with a
  // 1.5px aurora ring, like the focal cards in the Bento Pro composite.
  if (isTop) {
    return (
      <div
        className="rounded-[14px]"
        style={{
          background:
            "linear-gradient(135deg, rgba(240,171,252,0.65) 0%, rgba(167,139,250,0.65) 50%, rgba(125,211,252,0.65) 100%)",
          padding: 1.5,
          boxShadow:
            "0 12px 32px -16px rgba(167,139,250,0.40), 0 32px 56px -32px rgba(167,139,250,0.20)",
        }}
      >
        {card}
      </div>
    );
  }
  return card;
}

function EvidenceRow({
  source,
  label,
  year,
}: {
  source: string;
  label: string;
  year: string;
}) {
  return (
    <a
      className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 transition hover:border-gray-300"
      href="#"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[10px] font-semibold text-gray-700">
          {source.slice(0, 3).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-medium text-gray-900">
            {label}
          </div>
          <div className="text-[10.5px] text-gray-500">
            {source} · {year}
          </div>
        </div>
      </div>
      <svg
        width="11"
        height="11"
        viewBox="0 0 11 11"
        fill="none"
        className="shrink-0 text-gray-400"
      >
        <path
          d="M3 8L8 3M8 3H4M8 3V7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </a>
  );
}

function ConnectionRow({
  kind,
  verb,
  label,
}: {
  kind: "anchor" | "insight" | "action" | "ghost";
  verb: string;
  label: string;
}) {
  const color = {
    anchor: "rgb(100, 116, 139)",
    insight: "rgb(180, 83, 9)",
    action: "rgb(5, 150, 105)",
    ghost: "rgb(124, 58, 237)",
  }[kind];
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: color,
          }}
        />
        <span className="shrink-0 text-[11px] italic text-gray-500">{verb}</span>
        <span className="truncate text-[12.5px] font-medium text-gray-800">
          {label}
        </span>
      </div>
    </div>
  );
}

function DiscussionRow({
  authorId,
  label,
  body,
  voice,
}: {
  authorId: string;
  label: string;
  body: string;
  voice?: boolean;
}) {
  const av = abstractAvatarFor(authorId);
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: `hsl(${av.hue}, 70%, 55%)`,
          flexShrink: 0,
          marginTop: 2,
        }}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-gray-700">{label}</span>
          {voice && (
            <Mic className="h-2.5 w-2.5 text-gray-400" strokeWidth={1.75} />
          )}
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-gray-700">
          {body}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Section H — Variations on the canvas (Bento Pro pattern)
// ─────────────────────────────────────────────────────────────────────

function SectionBentoVariations() {
  return (
    <section>
      <SectionDivider
        eyebrow="Section H · Canvas-native"
        title="Variations open inline on the canvas, not in a side panel"
        body="Click 'Variations' on any card and the canvas opens a Bento Pro workspace around it — focal pick at center with an orange-fade top edge and a blue 'Launch' CTA, alternative variations as single-icon floating tiles around the perimeter. Click a tile to make it the focal."
      />
      <BentoVariationsCanvas />
    </section>
  );
}

function BentoVariationsCanvas() {
  // Compute tile + focal centers once so the connection-arc SVG stays
  // in sync with the actual tile positions. Tiles are 60×60 inside a
  // 90-wide wrapper, so the tile center sits at (x + 30, y + 30).
  const tiles = [
    { x: 70, y: 205, glyph: "◐", color: "rgb(99, 102, 241)", label: "Pomodoro split", rank: 2 },
    { x: 185, y: 205, glyph: "◇", color: "rgb(245, 158, 11)", label: "Manual log", rank: 3 },
    { x: 70, y: 400, glyph: "◯", color: "rgb(220, 38, 38)", label: "Voice trail", rank: 4 },
    { x: 185, y: 400, glyph: "◌", color: "rgb(16, 185, 129)", label: "Inverse", rank: 5 },
    { x: 800, y: 205, glyph: "◧", color: "rgb(168, 85, 247)", label: "Spaced repetition", rank: 6 },
    { x: 800, y: 325, glyph: "◑", color: "rgb(14, 165, 233)", label: "Calendar block", rank: 7 },
    { x: 800, y: 445, glyph: "◭", color: "rgb(236, 72, 153)", label: "Background music", rank: 8 },
  ];
  const focalCenter = { x: 490, y: 330 };
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-3xl"
      style={{
        maxWidth: 980,
        height: 620,
        background: "linear-gradient(180deg, #f4f4f5 0%, #efeff1 100%)",
        border: "1px solid rgba(15,23,42,0.06)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,1), 0 1px 2px rgba(15,23,42,0.04), 0 18px 48px -24px rgba(15,23,42,0.18)",
      }}
    >
      {/* Subtle dashed grid background — the Bento Pro workspace floor */}
      <DashedGridBg />

      {/* ── Constellation layer (under the cards) ──
          - Soft outer dashed membrane circumscribing the composition
          - Iridescent connection arcs from focal to every tile, with
            a slow flow animation suggesting "all paths converge here"
          - Radial halo behind the focal that breathes */}
      <ConstellationLayer focal={focalCenter} tiles={tiles} />

      {/* Header pill at top center */}
      <div className="absolute left-1/2 top-7 -translate-x-1/2">
        <WorkspaceHeaderPill
          parentTitle="Ramp-up takes 5–10 min to load the mental model"
          count={4}
        />
      </div>

      {/* Floating alternative tiles */}
      {tiles.map((t) => (
        <FloatingTile
          key={t.rank}
          x={t.x}
          y={t.y}
          glyph={t.glyph}
          color={t.color}
          label={t.label}
          rank={t.rank}
        />
      ))}

      {/* Focal variation card */}
      <BentoFocalCard />
    </div>
  );
}

function ConstellationLayer({
  focal,
  tiles,
}: {
  focal: { x: number; y: number };
  tiles: Array<{ x: number; y: number; rank: number; color: string }>;
}) {
  return (
    <>
      {/* Radial halo behind focal — breathing soft glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: focal.x - 220,
          top: focal.y - 220,
          width: 440,
          height: 440,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(252,165,89,0.16) 0%, rgba(252,165,89,0.06) 35%, transparent 70%)",
          animation: "bentoHaloBreath 5s ease-in-out infinite",
        }}
      />

      {/* SVG layer: outer membrane + connection arcs */}
      <svg
        className="pointer-events-none absolute inset-0"
        width="980"
        height="620"
        style={{ overflow: "visible" }}
        aria-hidden
      >
        <defs>
          <linearGradient id="constellation-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(252, 165, 89, 0.55)" />
            <stop offset="50%" stopColor="rgba(167, 139, 250, 0.45)" />
            <stop offset="100%" stopColor="rgba(125, 211, 252, 0.50)" />
          </linearGradient>
          <radialGradient id="focal-membrane" cx="50%" cy="50%" r="50%">
            <stop offset="80%" stopColor="rgba(15,23,42,0)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0.05)" />
          </radialGradient>
        </defs>

        {/* Outer dashed membrane — encompasses focal + all tiles */}
        <ellipse
          cx={focal.x}
          cy={focal.y}
          rx="430"
          ry="240"
          fill="none"
          stroke="rgba(15,23,42,0.10)"
          strokeWidth="1"
          strokeDasharray="3 7"
        />

        {/* Inner dashed orbit — closer to focal, like a planetary ring */}
        <ellipse
          cx={focal.x}
          cy={focal.y}
          rx="300"
          ry="170"
          fill="none"
          stroke="rgba(15,23,42,0.06)"
          strokeWidth="1"
          strokeDasharray="2 6"
        />

        {/* Connection arcs — focal → each tile.
            Smooth cubic bezier with control points pulled toward focal
            so the arcs curve gracefully outward. Iridescent gradient
            stroke + slow dash flow animation. */}
        {tiles.map((t) => {
          const tileCx = t.x + 30;
          const tileCy = t.y + 30;
          // Pull control points proportionally toward focal so the
          // arcs feel like they all originate from the same source.
          const dx = tileCx - focal.x;
          const dy = tileCy - focal.y;
          const cp1x = focal.x + dx * 0.35;
          const cp1y = focal.y;
          const cp2x = tileCx - dx * 0.25;
          const cp2y = tileCy - dy * 0.35;
          return (
            <g key={t.rank}>
              <path
                d={`M ${focal.x} ${focal.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tileCx} ${tileCy}`}
                fill="none"
                stroke="url(#constellation-stroke)"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeDasharray="3 6"
                style={{
                  animation: `bentoArcFlow ${10 + (t.rank % 3) * 2}s linear infinite`,
                }}
              />
              {/* Termination dot at the tile end of each arc */}
              <circle
                cx={tileCx}
                cy={tileCy}
                r="2.5"
                fill={t.color}
                opacity="0.5"
              />
            </g>
          );
        })}

        {/* Origin pulse at focal center — anchors the constellation */}
        <circle
          cx={focal.x}
          cy={focal.y}
          r="3.5"
          fill="rgba(252, 165, 89, 0.85)"
          style={{
            animation: "bentoOriginPulse 2.4s ease-in-out infinite",
          }}
        />
      </svg>

      {/* Animations */}
      <style jsx global>{`
        @keyframes bentoHaloBreath {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes bentoArcFlow {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -36; }
        }
        @keyframes bentoOriginPulse {
          0%, 100% { transform-origin: center; r: 3.5; opacity: 1; }
          50% { r: 5; opacity: 0.6; }
        }
      `}</style>
    </>
  );
}

function DashedGridBg() {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width="100%"
      height="100%"
      aria-hidden
    >
      {/* Horizontal dashed lines at thirds */}
      <line
        x1="0"
        y1="33.3%"
        x2="100%"
        y2="33.3%"
        stroke="rgba(15,23,42,0.08)"
        strokeWidth="1"
        strokeDasharray="4 8"
      />
      <line
        x1="0"
        y1="66.6%"
        x2="100%"
        y2="66.6%"
        stroke="rgba(15,23,42,0.08)"
        strokeWidth="1"
        strokeDasharray="4 8"
      />
      {/* Vertical dashed lines at thirds */}
      <line
        x1="33.3%"
        y1="0"
        x2="33.3%"
        y2="100%"
        stroke="rgba(15,23,42,0.08)"
        strokeWidth="1"
        strokeDasharray="4 8"
      />
      <line
        x1="66.6%"
        y1="0"
        x2="66.6%"
        y2="100%"
        stroke="rgba(15,23,42,0.08)"
        strokeWidth="1"
        strokeDasharray="4 8"
      />
    </svg>
  );
}

function WorkspaceHeaderPill({
  parentTitle,
  count,
  addedCount,
}: {
  parentTitle: string;
  count: number;
  addedCount?: number;
}) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-full bg-white px-4 py-2"
      style={{
        border: "1px solid rgba(15,23,42,0.05)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,1), 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.18)",
      }}
    >
      {/* Tiny iridescent orb glyph — like the colored disc next to
          "Bento Pro Vol. 2" in Image 2. */}
      <div
        aria-hidden
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{
          background:
            "conic-gradient(from 220deg, #fdba74, #fbbf24, #fcd34d, #fdba74)",
          boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.7)",
        }}
      >
        <span
          aria-hidden
          className="inline-block rounded-full bg-white"
          style={{ width: 8, height: 8 }}
        />
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className="text-[13px] font-semibold tracking-tight text-gray-900">
          Variations
        </span>
        <span className="text-[11px] text-gray-400">
          for &ldquo;{parentTitle}&rdquo;
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-gray-500">
          · {count} options
        </span>
        {addedCount !== undefined && addedCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums"
            style={{
              background: "rgba(34, 197, 94, 0.12)",
              color: "rgb(22, 101, 52)",
            }}
          >
            <span aria-hidden style={{ fontSize: 9 }}>✓</span>
            {addedCount} added
          </span>
        )}
      </div>
    </div>
  );
}

function FloatingTile({
  x,
  y,
  glyph,
  color,
  label,
  rank,
}: {
  x: number;
  y: number;
  glyph: string;
  color: string;
  label: string;
  rank: number;
}) {
  return (
    <div
      className="absolute"
      style={{ left: x, top: y, width: 90 }}
    >
      <div
        className="relative inline-flex h-[60px] w-[60px] items-center justify-center rounded-2xl"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(252,252,254,0.97) 100%)",
          border: "1px solid rgba(15,23,42,0.06)",
          boxShadow: [
            "inset 0 1px 0 rgba(255,255,255,1)",
            "0 1px 2px rgba(15,23,42,0.04)",
            "0 10px 20px -10px rgba(15,23,42,0.12)",
          ].join(", "),
        }}
      >
        <span
          aria-hidden
          className="inline-flex items-center justify-center"
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: color,
            color: "white",
            fontSize: 18,
            lineHeight: 1,
            fontWeight: 600,
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.30), 0 2px 4px rgba(0,0,0,0.10)",
          }}
        >
          {glyph}
        </span>
        {/* Tiny rank badge in the top-right corner */}
        <span
          className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 text-[9px] font-semibold tabular-nums text-gray-600"
          style={{
            border: "1px solid rgba(15,23,42,0.08)",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
          }}
        >
          #{rank}
        </span>
      </div>
      <div className="mt-1.5 text-center text-[10.5px] font-medium text-gray-700">
        {label}
      </div>
    </div>
  );
}

function BentoFocalCard() {
  return (
    <div
      className="absolute"
      style={{
        left: "50%",
        top: 110,
        transform: "translateX(-50%)",
        width: 380,
        zIndex: 2, // floats above the sidebar (which is zIndex 1)
      }}
    >
      <div
        className="overflow-hidden rounded-3xl"
        style={{
          // Soft warm fade at the top — orange/amber, like Image 2's
          // focal card. Below the fade, clean white body.
          background: [
            "linear-gradient(180deg, rgba(254,215,170,0.0) 0%, transparent 38%)",
            "linear-gradient(180deg, rgba(253,186,116,0.55) 0%, rgba(254,243,199,0.18) 18%, rgba(255,255,255,1) 38%)",
            "white",
          ].join(", "),
          border: "1px solid rgba(15,23,42,0.06)",
          boxShadow: [
            "inset 0 1px 0 rgba(255,255,255,1)",
            "0 1px 2px rgba(15,23,42,0.04)",
            "0 18px 36px -16px rgba(252,165,89,0.22)",
            "0 36px 72px -36px rgba(15,23,42,0.20)",
          ].join(", "),
        }}
      >
        {/* Header strip — pill in the orange-fade region */}
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 backdrop-blur">
            <span
              aria-hidden
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-white"
              style={{
                background:
                  "linear-gradient(135deg, #fb923c, #f59e0b, #d97706)",
                fontSize: 11,
                fontWeight: 700,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)",
              }}
            >
              #1
            </span>
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "rgb(154, 52, 18)" }}
            >
              Best fit · 87%
            </span>
          </div>
          <button
            type="button"
            aria-label="More"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/80 hover:text-gray-700"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="3" cy="7" r="1" fill="currentColor" />
              <circle cx="7" cy="7" r="1" fill="currentColor" />
              <circle cx="11" cy="7" r="1" fill="currentColor" />
            </svg>
          </button>
        </div>

        {/* Title + body */}
        <div className="px-5 pt-3.5 pb-1">
          <h3 className="text-[17px] font-semibold leading-tight tracking-tight text-gray-900">
            Apple Watch ring metaphor
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
            Daily session minutes tracked on the wrist. Visual goal pulls
            focus back; minimal new UI to learn.
          </p>
        </div>

        {/* Feature checklist — like the "Installed apps · 4/4 files" rows
            in Image 2. Each row shows a checkmark + a feature. */}
        <div className="px-5 pt-3">
          <div className="space-y-1.5">
            <FeatureRow checked label="Detect ramp-up via session timer" />
            <FeatureRow checked label="Resume from last cognitive state" />
            <FeatureRow checked label="Daily progress ring + minute count" />
            <FeatureRow label="Voice memo bookmarks (optional)" />
          </div>
        </div>

        {/* Tech stack chips inline — same TechStackChip from the
            inspector, kept consistent across surfaces. */}
        <div className="flex flex-wrap gap-1.5 px-5 pt-3.5">
          <TechStackChip name="Apple Watch" color="rgb(15, 23, 42)" />
          <TechStackChip name="SwiftUI" color="rgb(239, 68, 68)" />
          <TechStackChip name="Core ML" color="rgb(99, 102, 241)" />
        </div>

        {/* Blue gradient CTA — the "Launch app" pattern from Image 2 */}
        <div className="px-5 pt-4 pb-5">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-105"
            style={{
              background:
                "linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #2563eb 100%)",
              boxShadow: [
                "inset 0 1px 0 rgba(255,255,255,0.30)",
                "0 1px 2px rgba(37,99,235,0.20)",
                "0 8px 24px -10px rgba(37,99,235,0.45)",
              ].join(", "),
            }}
          >
            <SparkleGlyph />
            Use this variation
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              aria-hidden
            >
              <path
                d="M3 5.5H8M8 5.5L5.5 3M8 5.5L5.5 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── InteractiveBentoFocalCard ─────────────────────────────────────────
// Same chrome as BentoFocalCard but content is driven by a variation
// prop. When `showAdded` is true (after clicking "Use this variation"),
// the card pulses with a soft green halo and the CTA flips to a green
// "✓ Added to board" state for ~2s. `alreadyAdded` keeps the muted
// "Added · Use again" treatment after the pulse fades.

function InteractiveBentoFocalCard({
  variation,
  onUse,
  showAdded,
  alreadyAdded,
}: {
  variation: SidebarVariation;
  onUse: () => void;
  showAdded: boolean;
  alreadyAdded: boolean;
}) {
  return (
    <div
      className="absolute"
      style={{
        // Explicit position — right-aligned to host (host: 210-670,
        // focal: 286-666, leaving 4px peek on right). Top at 96 puts
        // focal just below the banner (banner: 40-90, gap: 6).
        left: 286,
        top: 96,
        width: 380,
        zIndex: 2,
      }}
    >
      <div
        className="overflow-hidden"
        style={{
          borderRadius: 18,
          background: [
            "linear-gradient(180deg, rgba(254,215,170,0.0) 0%, transparent 38%)",
            "linear-gradient(180deg, rgba(253,186,116,0.55) 0%, rgba(254,243,199,0.18) 18%, rgba(255,255,255,1) 38%)",
            "white",
          ].join(", "),
          border: showAdded
            ? "1px solid rgba(34, 197, 94, 0.45)"
            : "1px solid rgba(15,23,42,0.06)",
          boxShadow: showAdded
            ? [
                "inset 0 1px 0 rgba(255,255,255,1)",
                "0 1px 2px rgba(15,23,42,0.04)",
                "0 0 0 6px rgba(34, 197, 94, 0.10)",
                "0 18px 36px -16px rgba(34, 197, 94, 0.35)",
                "0 36px 72px -36px rgba(34, 197, 94, 0.25)",
              ].join(", ")
            : [
                "inset 0 1px 0 rgba(255,255,255,1)",
                "0 1px 2px rgba(15,23,42,0.04)",
                "0 18px 36px -16px rgba(252,165,89,0.22)",
                "0 36px 72px -36px rgba(15,23,42,0.20)",
              ].join(", "),
          transition: "border 200ms ease, box-shadow 200ms ease",
        }}
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 backdrop-blur">
            <span
              aria-hidden
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-white"
              style={{
                background:
                  "linear-gradient(135deg, #fb923c, #f59e0b, #d97706)",
                fontSize: 11,
                fontWeight: 700,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)",
              }}
            >
              #{variation.rank}
            </span>
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "rgb(154, 52, 18)" }}
            >
              {variation.rank === 1 ? "Best fit · " : ""}
              {variation.confidence}%
            </span>
          </div>
          <button
            type="button"
            aria-label="More"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/80 hover:text-gray-700"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="3" cy="7" r="1" fill="currentColor" />
              <circle cx="7" cy="7" r="1" fill="currentColor" />
              <circle cx="11" cy="7" r="1" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className="px-5 pt-3.5 pb-1">
          <h3 className="text-[17px] font-semibold leading-tight tracking-tight text-gray-900">
            {variation.title}
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
            {variation.description}
          </p>
        </div>

        <div className="px-5 pt-3">
          <div className="space-y-1.5">
            {variation.features.map((f, i) => (
              <FeatureRow
                key={i}
                checked={f.checked}
                label={f.label}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 px-5 pt-3.5">
          {variation.stack.map((s) => (
            <TechStackChip key={s.name} name={s.name} color={s.color} />
          ))}
        </div>

        <div className="px-5 pt-4 pb-5">
          <button
            type="button"
            onClick={onUse}
            className="flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-105"
            style={{
              background: showAdded
                ? "linear-gradient(135deg, #4ade80 0%, #22c55e 50%, #16a34a 100%)"
                : alreadyAdded
                  ? "linear-gradient(135deg, #9ca3af 0%, #6b7280 50%, #4b5563 100%)"
                  : "linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #2563eb 100%)",
              boxShadow: showAdded
                ? [
                    "inset 0 1px 0 rgba(255,255,255,0.30)",
                    "0 1px 2px rgba(34,197,94,0.20)",
                    "0 8px 24px -10px rgba(34,197,94,0.55)",
                  ].join(", ")
                : [
                    "inset 0 1px 0 rgba(255,255,255,0.30)",
                    "0 1px 2px rgba(37,99,235,0.20)",
                    "0 8px 24px -10px rgba(37,99,235,0.45)",
                  ].join(", "),
              transition: "background 220ms ease, box-shadow 220ms ease",
            }}
          >
            {showAdded ? (
              <>
                <span style={{ fontSize: 14, fontWeight: 800 }}>✓</span>
                Added to board
              </>
            ) : alreadyAdded ? (
              <>
                <Plus className="h-3 w-3" strokeWidth={2.5} />
                Use again
              </>
            ) : (
              <>
                <SparkleGlyph />
                Use this variation
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 11 11"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M3 5.5H8M8 5.5L5.5 3M8 5.5L5.5 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function FeatureRow({
  label,
  checked,
}: {
  label: string;
  checked?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{
          background: checked ? "rgb(34, 197, 94)" : "rgba(15,23,42,0.08)",
          color: "white",
          fontSize: 9,
          fontWeight: 700,
        }}
      >
        {checked ? "✓" : ""}
      </span>
      <span
        className={[
          "text-[12px] leading-snug",
          checked ? "text-gray-800" : "text-gray-400",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Section H · Alt — Sidebar switcher pattern (Image 2 inspired)
// ─────────────────────────────────────────────────────────────────────

function SectionBentoVariationsSidebar() {
  return (
    <section>
      <SectionDivider
        eyebrow="Section H · Sidebar switcher (alt)"
        title="Same composition, sidebar switcher instead of perimeter tiles"
        body="Identical focal card, but variations live in a vertical neumorphic pill on the left — like the icon column on Bento Pro Vol. 2. Active variation appears pressed-in (inset shadow); the others sit raised. Click any tile to make it the focal. Reduces visual clutter when the variation count is high."
      />
      <BentoVariationsSidebarCanvas />
    </section>
  );
}

// Full data per variation — drives the focal card content when each
// is selected. Realistic alternative formulations of the same insight.
interface SidebarVariation {
  rank: number;
  icon: typeof Lightbulb;
  color: string;
  label: string;
  title: string;
  description: string;
  confidence: number;
  features: Array<{ checked: boolean; label: string }>;
  stack: Array<{ name: string; color: string }>;
}

const SIDEBAR_VARIATIONS: SidebarVariation[] = [
  {
    rank: 1,
    icon: Watch,
    color: "rgb(15, 23, 42)",
    label: "Apple Watch ring metaphor",
    title: "Apple Watch ring metaphor",
    description:
      "Daily session minutes tracked on the wrist. Visual goal pulls focus back; minimal new UI to learn.",
    confidence: 87,
    features: [
      { checked: true, label: "Detect ramp-up via session timer" },
      { checked: true, label: "Resume from last cognitive state" },
      { checked: true, label: "Daily progress ring + minute count" },
      { checked: false, label: "Voice memo bookmarks (optional)" },
    ],
    stack: [
      { name: "Apple Watch", color: "rgb(15, 23, 42)" },
      { name: "SwiftUI", color: "rgb(239, 68, 68)" },
      { name: "Core ML", color: "rgb(99, 102, 241)" },
    ],
  },
  {
    rank: 2,
    icon: RotateCcw,
    color: "rgb(99, 102, 241)",
    label: "Auto-resume cognitive state",
    title: "Auto-resume cognitive state",
    description:
      "Saves your mental model context between sessions. Pick up exactly where you left off — zero ramp-up cost.",
    confidence: 71,
    features: [
      { checked: true, label: "Snapshot active variables at session end" },
      { checked: true, label: "Restore snapshot on next session start" },
      { checked: false, label: "Diff what changed between sessions" },
      { checked: false, label: "Sync state across devices" },
    ],
    stack: [
      { name: "Local Store", color: "rgb(99, 102, 241)" },
      { name: "iCloud Sync", color: "rgb(14, 165, 233)" },
    ],
  },
  {
    rank: 3,
    icon: Mic,
    color: "rgb(220, 38, 38)",
    label: "Voice memo bookmark",
    title: "Voice memo bookmark trail",
    description:
      "Speak briefly at session end to bookmark your mental state. Next session auto-plays the memo to reload context.",
    confidence: 58,
    features: [
      { checked: true, label: "Speak 30s memo at session end" },
      { checked: true, label: "Auto-playback on next session start" },
      { checked: false, label: "Transcribed snippets in side panel" },
      { checked: false, label: "Multi-memo chronological trail" },
    ],
    stack: [
      { name: "iOS Voice", color: "rgb(220, 38, 38)" },
      { name: "Whisper", color: "rgb(34, 197, 94)" },
    ],
  },
];

function BentoVariationsSidebarCanvas() {
  const [activeRank, setActiveRank] = useState(1);
  const [addedRanks, setAddedRanks] = useState<Set<number>>(new Set());
  const [showAdded, setShowAdded] = useState(false);

  const active =
    SIDEBAR_VARIATIONS.find((v) => v.rank === activeRank) ??
    SIDEBAR_VARIATIONS[0];

  const handleUse = () => {
    setAddedRanks((prev) => {
      const next = new Set(prev);
      next.add(activeRank);
      return next;
    });
    setShowAdded(true);
    window.setTimeout(() => setShowAdded(false), 2200);
  };

  return (
    <div
      className="relative mx-auto overflow-hidden"
      style={{
        maxWidth: 880,
        height: 500, // workspace snug around the host
        borderRadius: 24,
        background: "linear-gradient(180deg, #f4f4f5 0%, #efeff1 100%)",
        border: "1px solid rgba(15,23,42,0.06)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,1), 0 1px 2px rgba(15,23,42,0.04), 0 18px 48px -24px rgba(15,23,42,0.18)",
      }}
    >
      <DashedGridBg />

      <VariationsHostLayer
        variations={SIDEBAR_VARIATIONS}
        activeRank={activeRank}
        addedRanks={addedRanks}
        onSelect={setActiveRank}
        parentTitle="Ramp-up takes 5–10 min to load the mental model"
        addedCount={addedRanks.size}
      />

      <InteractiveBentoFocalCard
        variation={active}
        onUse={handleUse}
        showAdded={showAdded}
        alreadyAdded={addedRanks.has(activeRank)}
      />
    </div>
  );
}

function VariationsHostLayer({
  variations,
  activeRank,
  addedRanks,
  onSelect,
  parentTitle,
  addedCount,
}: {
  variations: Array<{
    rank: number;
    icon: typeof Lightbulb;
    color: string;
    label: string;
  }>;
  activeRank: number;
  addedRanks: Set<number>;
  onSelect: (rank: number) => void;
  parentTitle: string;
  addedCount: number;
}) {
  return (
    <div
      className="absolute"
      style={{
        // SNUG around the focal. Host: 460×410 centered in 880 workspace
        // (margins 210 each side). Focal positioned with right edge flush
        // to host's right edge minus 4px peek, left edge against sidebar.
        //   Host:   x 210-670, y 40-450
        //   Focal:  x 286-666, y 96-446 (height ~350)
        //   Pill:   x 226-286, y 181-349 (centered against focal)
        left: 210,
        top: 40,
        width: 460,
        height: 410,
        background:
          "linear-gradient(180deg, rgba(250,251,253,0.97) 0%, rgba(243,244,247,0.92) 100%)",
        border: "1px solid rgba(15,23,42,0.04)",
        borderRadius: 20,
        boxShadow: [
          "inset 0 1px 0 rgba(255,255,255,0.85)",
          "0 1px 2px rgba(15,23,42,0.03)",
          "0 4px 10px -2px rgba(15,23,42,0.06)",
          "0 16px 32px -16px rgba(15,23,42,0.10)",
        ].join(", "),
        zIndex: 1,
      }}
    >
      {/* Banner header — integrated into the host card as its top
          row. No more floating pill. Title + parent context on the
          left, options + added count on the right. Hairline border
          separates banner from the content area below. */}
      <div
        className="absolute inset-x-0 top-0 flex items-center justify-between"
        style={{
          height: 60,
          padding: "0 22px",
          borderBottom: "1px solid rgba(15,23,42,0.05)",
        }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Iridescent sun-orb glyph — matches the previous header pill's
              identity mark, kept in the new banner placement. */}
          <div
            aria-hidden
            className="inline-flex shrink-0 items-center justify-center"
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background:
                "conic-gradient(from 220deg, #fdba74, #fbbf24, #fcd34d, #fdba74)",
              boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.7)",
            }}
          >
            <span
              aria-hidden
              className="inline-block rounded-full bg-white"
              style={{ width: 8, height: 8 }}
            />
          </div>
          <div className="flex min-w-0 flex-col" style={{ lineHeight: 1.2 }}>
            <span className="text-[13.5px] font-semibold tracking-tight text-gray-900">
              Variations
            </span>
            <span
              className="truncate text-[11px] text-gray-500"
              style={{ maxWidth: 280 }}
              title={parentTitle}
            >
              for &ldquo;{parentTitle}&rdquo;
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {addedCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums"
              style={{
                background: "rgba(34, 197, 94, 0.12)",
                color: "rgb(22, 101, 52)",
              }}
            >
              <span aria-hidden style={{ fontSize: 9 }}>
                ✓
              </span>
              {addedCount} added
            </span>
          )}
          <span className="text-[11px] font-semibold tabular-nums text-gray-500">
            {variations.length} options
          </span>
        </div>
      </div>

      {/* Sidebar pill — vertically centered against focal, right edge
          flush with focal's left edge so they touch as one unit.
          Pill 60×168 → just tall enough for 3 tiles + spacing.
          Workspace coords: pill right at x=286 (focal left), pill top
          at y=181 (focal center 271 - pill half 84 = host y 141). */}
      <div
        className="absolute"
        style={{
          left: 16, // host coords; pill right edge at host 76 = workspace 286
          top: 146, // host coords; centers pill exactly with focal vertically
          width: 60,
          height: 168,
          background: "rgba(255,255,255,0.70)",
          borderRadius: 20,
          border: "1px solid rgba(15,23,42,0.04)",
          padding: 6,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          boxShadow: [
            "inset 0 1px 0 rgba(255,255,255,0.85)",
            "inset 0 -1px 0 rgba(15,23,42,0.04)",
          ].join(", "),
        }}
      >
        {variations.map((v) => (
          <SidebarItem
            key={v.rank}
            icon={v.icon}
            color={v.color}
            label={v.label}
            rank={v.rank}
            active={v.rank === activeRank}
            added={addedRanks.has(v.rank)}
            onClick={() => onSelect(v.rank)}
          />
        ))}
      </div>
    </div>
  );
}

// (VariationsSidebar removed — replaced by VariationsHostLayer which
// embeds the sidebar pill inside the two-layer host card.)

function SidebarItem({
  icon: Icon,
  color,
  label,
  rank,
  active,
  added,
  onClick,
}: {
  icon: typeof Lightbulb;
  color: string;
  label: string;
  rank: number;
  active: boolean;
  added: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`#${rank} · ${label}${added ? " · added to board" : ""}`}
      onClick={onClick}
      className="group relative inline-flex items-center justify-center"
      style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        background:
          "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(249,250,252,0.96) 100%)",
        border: "1px solid rgba(15,23,42,0.04)",
        boxShadow: [
          "inset 0 1px 0 rgba(255,255,255,1)",
          "0 1px 2px rgba(15,23,42,0.04)",
          "0 4px 10px -3px rgba(15,23,42,0.10)",
          "0 8px 18px -10px rgba(15,23,42,0.08)",
        ].join(", "),
        cursor: "pointer",
        transition: "transform 180ms ease, box-shadow 180ms ease",
      }}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center transition-transform"
        style={{
          width: 28,
          height: 28,
          borderRadius: 9,
          background: color,
          boxShadow: active
            ? [
                "inset 0 1px 0 rgba(255,255,255,0.40)",
                "inset 0 -1px 0 rgba(0,0,0,0.10)",
                "0 2px 6px rgba(0,0,0,0.22)",
              ].join(", ")
            : [
                "inset 0 1px 0 rgba(255,255,255,0.22)",
                "0 1px 2px rgba(0,0,0,0.10)",
              ].join(", "),
          opacity: active ? 1 : 0.86,
          transform: active ? "scale(1)" : "scale(0.96)",
        }}
      >
        <Icon className="h-[16px] w-[16px] text-white" strokeWidth={2} />
      </span>
      {/* Corner badge — rank by default, green check when added */}
      {added ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full"
          style={{
            background: "rgb(34, 197, 94)",
            color: "white",
            fontSize: 9,
            fontWeight: 800,
            border: "1.5px solid white",
            boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
          }}
        >
          ✓
        </span>
      ) : (
        <span className="absolute right-1 top-1 text-[8.5px] font-bold tabular-nums text-gray-400">
          {rank}
        </span>
      )}
      {active && (
        <span
          aria-hidden
          className="absolute"
          style={{
            right: -8,
            top: "50%",
            transform: "translateY(-50%)",
            width: 3,
            height: 18,
            borderRadius: 2,
            background: "rgb(251, 146, 60)",
            boxShadow: "0 0 10px rgba(251, 146, 60, 0.65)",
          }}
        />
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Section G — Agency / autopilot model
// ─────────────────────────────────────────────────────────────────────

function SectionAgencyModel() {
  return (
    <section>
      <SectionDivider
        eyebrow="Section G · Agency"
        title="Three tiers for AI candidates — not a single mode"
        body="Manual promote on every card adds friction once trust is established. Full autopilot starts too aggressive. The honest answer: tiered, with the user picking how much agency to give the AI per room."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <AgencyTierCard
          tier={1}
          name="Manual"
          state="default"
          subtitle="Trust-building phase"
          description="Every AI candidate requires explicit user promote. Default in new rooms — you see what the AI is doing before letting it act."
          flow={[
            "AI extracts candidate",
            "Ghost appears on canvas",
            "User clicks Promote",
            "Card commits",
          ]}
        />
        <AgencyTierCard
          tier={2}
          name="Smart auto-promote"
          state="recommended"
          subtitle="After 10 successful promotes"
          description="AI listens for agreement signals in chat (“yes”, “good call”, “exactly”) and auto-promotes the most recent candidate. Banner + easy undo."
          flow={[
            "AI extracts candidate",
            "Ghost appears + chat agreement detected",
            "Auto-promote with banner",
            "User can undo in 5s",
          ]}
        />
        <AgencyTierCard
          tier={3}
          name="Full autopilot"
          state="power-user"
          subtitle="Opt-in only"
          description="Ghosts with confidence > 80% spawn directly as committed cards. Users review periodic digests like email. AI is fully empowered."
          flow={[
            "AI extracts candidate",
            "High-confidence threshold check",
            "Card spawns as committed",
            "User reviews digest later",
          ]}
        />
      </div>
    </section>
  );
}

function AgencyTierCard({
  tier,
  name,
  state,
  subtitle,
  description,
  flow,
}: {
  tier: number;
  name: string;
  state: "default" | "recommended" | "power-user";
  subtitle: string;
  description: string;
  flow: string[];
}) {
  const stateMeta = {
    default: { label: "Default", bg: "bg-gray-100", text: "text-gray-700" },
    recommended: {
      label: "Recommended",
      bg: "bg-emerald-100",
      text: "text-emerald-800",
    },
    "power-user": {
      label: "Opt-in",
      bg: "bg-amber-100",
      text: "text-amber-800",
    },
  }[state];
  return (
    <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Tier {tier}
            </span>
            <span
              className={`rounded-full ${stateMeta.bg} px-2 py-0.5 text-[10px] font-semibold ${stateMeta.text}`}
            >
              {stateMeta.label}
            </span>
          </div>
        </div>
        <h3 className="mt-2 text-[16px] font-semibold tracking-tight text-gray-900">
          {name}
        </h3>
        <p className="mt-0.5 text-[11.5px] text-gray-500">{subtitle}</p>
      </div>
      <div className="px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-gray-600">
          {description}
        </p>
        <div className="mt-4 space-y-1.5">
          {flow.map((step, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-[11.5px] text-gray-700"
            >
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[9px] font-semibold text-gray-600">
                {i + 1}
              </span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Room
// ─────────────────────────────────────────────────────────────────────

function RoomScene() {
  return (
    <div
      className="relative overflow-hidden rounded-3xl bg-white"
      style={{
        border: "1px solid rgba(15,23,42,0.08)",
        boxShadow:
          "0 1px 2px rgba(15,23,42,0.04), 0 24px 60px -24px rgba(15,23,42,0.16)",
        height: 780,
      }}
    >
      <RoomTopbar />
      <Canvas />
      <ChatRail />
    </div>
  );
}

function RoomTopbar() {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-gray-200/60 bg-white/85 px-7 py-3.5 backdrop-blur">
      <div className="flex items-baseline gap-3">
        <span className="text-[14px] font-semibold text-gray-900">
          Cognitive routine room
        </span>
        <span className="text-[13px] text-gray-400">·</span>
        <span className="text-[13px] text-gray-500">
          with{" "}
          <span className="font-medium text-gray-700">Dr. Maya Chen</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <AvatarPair />
        <span className="text-[11px] font-medium text-gray-400">Live</span>
      </div>
    </div>
  );
}

function AvatarPair() {
  return (
    <div className="flex items-center -space-x-1.5">
      <div
        style={{
          ...abstractAvatarStyle(ME_ID, 24),
          boxShadow: "0 0 0 1.5px #fff, 0 0 0 2px rgba(15,23,42,0.20)",
          fontSize: 9.5,
        }}
        title="You"
      >
        <span style={{ letterSpacing: "-0.5px" }}>{ME_AV.initials}</span>
      </div>
      <div
        style={{
          ...abstractAvatarStyle(MAYA_ID, 24),
          boxShadow: `0 0 0 1.5px #fff, 0 0 0 2.5px hsl(${MAYA_AV.hue}, 70%, 50%)`,
          fontSize: 9.5,
        }}
        title="Maya — active"
      >
        <span style={{ letterSpacing: "-0.5px" }}>{MAYA_AV.initials}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Canvas — diamond flow
// ─────────────────────────────────────────────────────────────────────

function Canvas() {
  return (
    <div
      className="absolute"
      style={{
        top: 56,
        right: 380,
        bottom: 0,
        left: 0,
      }}
    >
      <div className="relative h-full w-full">
        <Spine />

        {/* Phase labels in the left margin */}
        <PhaseLabel y={Y_INTERSECTION} label="Intersection" />
        <PhaseLabel y={Y_DIVERGE} label="Diverge" />
        <PhaseLabel y={Y_EXPLORE} label="Explore" />
        <PhaseLabel y={Y_CONVERGE} label="Converge" />
        <PhaseLabel y={Y_ACT} label="Act" />

        {/* Cards */}
        <IntersectionCard
          x={RIGHT_CARD_X}
          y={Y_INTERSECTION - CARD_H / 2}
          title="Optimize daily 30-min sessions to model cognitive reactions and publish findings"
        />
        <AnchorCard
          x={LEFT_CARD_X}
          y={Y_DIVERGE - CARD_H / 2}
          authorId={ME_ID}
          role="upstream"
          title="Daily 30-min cognitive research routine"
        />
        <AnchorCard
          x={RIGHT_CARD_X}
          y={Y_DIVERGE - CARD_H / 2}
          authorId={MAYA_ID}
          role="downstream"
          title="Open-access cognitive modeling toolkit"
        />
        <RealCard
          x={LEFT_CARD_X}
          y={Y_EXPLORE - CARD_H / 2}
          authorId={ME_ID}
          icon={Lightbulb}
          kind="Insight"
          title="Ramp-up takes 5–10 min to load the mental model"
        />
        <RealCard
          x={RIGHT_CARD_X}
          y={Y_EXPLORE - CARD_H / 2}
          authorId={MAYA_ID}
          icon={Lightbulb}
          kind="Insight"
          title="Tools need zero-setup entry points to be useful daily"
        />
        <GhostCard
          x={RIGHT_CARD_X}
          y={Y_CONVERGE - GHOST_H / 2}
          title="Daily ring metaphor for session minutes"
          quote="what if we tracked minutes per session, like a daily Apple ring"
          attribution="Maya · just now"
        />
        <RealCard
          x={LEFT_CARD_X}
          y={Y_ACT - CARD_H / 2}
          authorId={ME_ID}
          icon={Zap}
          kind="Action"
          title="Email Dr. Patel about MATLAB resources"
        />

        {/* MayaCursor intentionally omitted from this design audit
            scene — focus is on card chrome + diamond flow. R1 cursor
            demo lives in the full room canvas, not here. */}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Spine — the diamond shape rendered as one SVG, plus connectors
// ─────────────────────────────────────────────────────────────────────

function Spine() {
  // Spine geometry (single continuous path of moves) — the curves at
  // fork/merge are the visual emphasis of divergence/convergence.
  const spineStroke = "rgba(15,23,42,0.20)";
  const phaseDotFill = "rgba(15,23,42,0.55)";

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ overflow: "visible" }}
    >
      {/* Reusable gradients for the AI lineage strokes and the
          iridescent converge orb. Defining them once in <defs> keeps
          the SVG terse and ensures consistent color across both. */}
      <defs>
        <linearGradient id="ai-stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(240, 171, 252, 0.55)" />
          <stop offset="50%" stopColor="rgba(167, 139, 250, 0.55)" />
          <stop offset="100%" stopColor="rgba(125, 211, 252, 0.55)" />
        </linearGradient>
        <radialGradient id="ai-orb" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 1)" />
          <stop offset="55%" stopColor="rgba(244, 232, 255, 0.95)" />
          <stop offset="100%" stopColor="rgba(196, 181, 253, 0.9)" />
        </radialGradient>
      </defs>

      {/* Single top spine: intersection → fork start */}
      <line
        x1={SPINE_X}
        y1={Y_INTERSECTION}
        x2={SPINE_X}
        y2={Y_DIVERGE - 60}
        stroke={spineStroke}
        strokeWidth={1.25}
      />

      {/* Fork to left branch */}
      <path
        d={`M ${SPINE_X} ${Y_DIVERGE - 60}
            C ${SPINE_X} ${Y_DIVERGE - 30}, ${BRANCH_LEFT_X} ${Y_DIVERGE - 30}, ${BRANCH_LEFT_X} ${Y_DIVERGE}`}
        fill="none"
        stroke={spineStroke}
        strokeWidth={1.25}
      />
      {/* Fork to right branch */}
      <path
        d={`M ${SPINE_X} ${Y_DIVERGE - 60}
            C ${SPINE_X} ${Y_DIVERGE - 30}, ${BRANCH_RIGHT_X} ${Y_DIVERGE - 30}, ${BRANCH_RIGHT_X} ${Y_DIVERGE}`}
        fill="none"
        stroke={spineStroke}
        strokeWidth={1.25}
      />

      {/* Left branch: diverge → explore */}
      <line
        x1={BRANCH_LEFT_X}
        y1={Y_DIVERGE}
        x2={BRANCH_LEFT_X}
        y2={Y_EXPLORE}
        stroke={spineStroke}
        strokeWidth={1.25}
      />
      {/* Right branch: diverge → explore */}
      <line
        x1={BRANCH_RIGHT_X}
        y1={Y_DIVERGE}
        x2={BRANCH_RIGHT_X}
        y2={Y_EXPLORE}
        stroke={spineStroke}
        strokeWidth={1.25}
      />

      {/* Left branch continues down toward merge */}
      <line
        x1={BRANCH_LEFT_X}
        y1={Y_EXPLORE}
        x2={BRANCH_LEFT_X}
        y2={Y_CONVERGE - 60}
        stroke={spineStroke}
        strokeWidth={1.25}
      />
      {/* Right branch continues down toward merge */}
      <line
        x1={BRANCH_RIGHT_X}
        y1={Y_EXPLORE}
        x2={BRANCH_RIGHT_X}
        y2={Y_CONVERGE - 60}
        stroke={spineStroke}
        strokeWidth={1.25}
      />

      {/* Merge curves — the AI-lineage moment. Iridescent gradient
          stroke (pink → violet → sky) is the only place this material
          appears in the spine, so the eye lands on where AI joins
          the human flow. */}
      <path
        d={`M ${BRANCH_LEFT_X} ${Y_CONVERGE - 60}
            C ${BRANCH_LEFT_X} ${Y_CONVERGE - 30}, ${SPINE_X} ${Y_CONVERGE - 30}, ${SPINE_X} ${Y_CONVERGE}`}
        fill="none"
        stroke="url(#ai-stroke)"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
      <path
        d={`M ${BRANCH_RIGHT_X} ${Y_CONVERGE - 60}
            C ${BRANCH_RIGHT_X} ${Y_CONVERGE - 30}, ${SPINE_X} ${Y_CONVERGE - 30}, ${SPINE_X} ${Y_CONVERGE}`}
        fill="none"
        stroke="url(#ai-stroke)"
        strokeWidth={1.75}
        strokeLinecap="round"
      />

      {/* Single bottom spine: converge → act */}
      <line
        x1={SPINE_X}
        y1={Y_CONVERGE}
        x2={SPINE_X}
        y2={Y_ACT}
        stroke={spineStroke}
        strokeWidth={1.25}
      />
      {/* Terminus tail (small) */}
      <line
        x1={SPINE_X}
        y1={Y_ACT}
        x2={SPINE_X}
        y2={Y_ACT + 30}
        stroke={spineStroke}
        strokeWidth={1.25}
      />
      <circle
        cx={SPINE_X}
        cy={Y_ACT + 30}
        r={2.5}
        fill={phaseDotFill}
      />

      {/* Short side connectors from spine nodes to their cards */}
      <SideConnector
        from={{ x: SPINE_X, y: Y_INTERSECTION }}
        to={{ x: RIGHT_CARD_X, y: Y_INTERSECTION }}
      />
      <SideConnector
        from={{ x: BRANCH_LEFT_X, y: Y_DIVERGE }}
        to={{ x: LEFT_CARD_RIGHT, y: Y_DIVERGE }}
      />
      <SideConnector
        from={{ x: BRANCH_RIGHT_X, y: Y_DIVERGE }}
        to={{ x: RIGHT_CARD_X, y: Y_DIVERGE }}
      />
      <SideConnector
        from={{ x: BRANCH_LEFT_X, y: Y_EXPLORE }}
        to={{ x: LEFT_CARD_RIGHT, y: Y_EXPLORE }}
      />
      <SideConnector
        from={{ x: BRANCH_RIGHT_X, y: Y_EXPLORE }}
        to={{ x: RIGHT_CARD_X, y: Y_EXPLORE }}
      />
      <SideConnector
        from={{ x: SPINE_X, y: Y_CONVERGE }}
        to={{ x: RIGHT_CARD_X, y: Y_CONVERGE }}
        violet
      />
      <SideConnector
        from={{ x: SPINE_X, y: Y_ACT }}
        to={{ x: LEFT_CARD_RIGHT, y: Y_ACT }}
      />

      {/* Phase node dots on the spine — solid at start + end, hollow
          rings in the middle, iridescent orb at Converge. */}
      <PhaseDot cx={SPINE_X} cy={Y_INTERSECTION} solid />
      <PhaseDot cx={BRANCH_LEFT_X} cy={Y_DIVERGE} />
      <PhaseDot cx={BRANCH_RIGHT_X} cy={Y_DIVERGE} />
      <PhaseDot cx={BRANCH_LEFT_X} cy={Y_EXPLORE} />
      <PhaseDot cx={BRANCH_RIGHT_X} cy={Y_EXPLORE} />
      <PhaseDot cx={SPINE_X} cy={Y_CONVERGE} violet />
      <PhaseDot cx={SPINE_X} cy={Y_ACT} solid />
    </svg>
  );
}

function SideConnector({
  from,
  to,
  violet = false,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  violet?: boolean;
}) {
  // The connector going to the ghost picks up the same iridescent
  // gradient as the merge curves — visual rhyme makes the AI lineage
  // read as one continuous channel.
  return (
    <g>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={violet ? "url(#ai-stroke)" : "rgba(15,23,42,0.20)"}
        strokeWidth={violet ? 1.5 : 1.25}
        strokeLinecap="round"
      />
    </g>
  );
}

function PhaseDot({
  cx,
  cy,
  violet = false,
  solid = false,
}: {
  cx: number;
  cy: number;
  violet?: boolean;
  /** Start/End anchor dot — bigger + darker + with a halo so the
   *  endpoints read as strong anchor moments. */
  solid?: boolean;
}) {
  // Iridescent orb at the Converge phase — AI moment, special.
  if (violet) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={9} fill="rgba(196, 181, 253, 0.18)" />
        <circle cx={cx} cy={cy} r={6.5} fill="url(#ai-orb)" />
        <circle
          cx={cx}
          cy={cy}
          r={6.5}
          fill="none"
          stroke="rgba(167, 139, 250, 0.45)"
          strokeWidth={0.75}
        />
      </g>
    );
  }
  // Anchor dot at start + end — bigger, dark, with soft halo for
  // prominence. Reads as "you are here / you arrived."
  if (solid) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={11} fill="rgba(15,23,42,0.08)" />
        <circle
          cx={cx}
          cy={cy}
          r={7}
          fill="rgba(15,23,42,0.88)"
          stroke="white"
          strokeWidth={1.5}
        />
      </g>
    );
  }
  // Middle waypoint — small, light gray, solid (no ring). Quiet
  // markers between the louder endpoints.
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill="rgba(15,23,42,0.28)"
        stroke="white"
        strokeWidth={1.25}
      />
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Phase label (left margin, mono mini-caps)
// ─────────────────────────────────────────────────────────────────────

function PhaseLabel({ y, label }: { y: number; label: string }) {
  // Single sans-serif typography — no mono caps, just a quiet section
  // marker in the left margin.
  return (
    <div
      className="pointer-events-none absolute text-gray-400"
      style={{
        left: 20,
        top: y - 8,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "-0.005em",
      }}
    >
      {label}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Cards — five flavors (Intersection / Anchor / Real / Ghost), one chrome
// ─────────────────────────────────────────────────────────────────────

// ── CardShell ────────────────────────────────────────────────────────
// Outer chrome only. Each card builds its own header + body inside.
// Ghost variant gets the aurora-glass treatment (Apple Intelligence
// material language); everything else gets clean white with soft
// layered shadow.

function CardShell({
  x,
  y,
  width,
  height,
  children,
  variant = "real",
}: {
  x: number;
  y: number;
  width: number;
  height?: number;
  children: React.ReactNode;
  variant?: "real" | "ghost";
}) {
  const isGhost = variant === "ghost";
  return (
    <div
      className="absolute overflow-hidden rounded-2xl"
      style={{
        left: x,
        top: y,
        width,
        height,
        // Subtle vertical gradient instead of flat white — adds the
        // "beveled material" feel from the Bento Pro / Apple Intelligence
        // visual language without going skeuomorphic.
        background:
          "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(252,252,254,0.96) 100%)",
        border: "1px solid rgba(15, 23, 42, 0.05)",
        boxShadow: isGhost
          ? [
              "inset 0 1px 0 rgba(255, 255, 255, 0.85)",
              "0 1px 2px rgba(15, 23, 42, 0.04)",
              "0 10px 28px -14px rgba(124, 58, 237, 0.22)",
              "0 32px 64px -28px rgba(168, 85, 247, 0.18)",
            ].join(", ")
          : [
              // Inset top highlight — Apple's signature beveled top edge
              "inset 0 1px 0 rgba(255, 255, 255, 1)",
              // Subtle close shadow
              "0 1px 2px rgba(15, 23, 42, 0.04)",
              // Mid depth shadow
              "0 12px 28px -16px rgba(15, 23, 42, 0.18)",
              // Far soft halo — gives the card "floats above surface" feel
              "0 32px 64px -32px rgba(15, 23, 42, 0.10)",
            ].join(", "),
      }}
    >
      {children}
    </div>
  );
}

// ── CardHeader ───────────────────────────────────────────────────────
// Inset pill (not edge-to-edge band). The kind label sits inside a
// rounded pill with side whitespace so the card's corner radius keeps
// breathing room on the left/right. Author dot floats to the right
// outside the pill.

function CardHeader({
  bg,
  labelColor,
  iconColor,
  icon: Icon,
  customGlyph,
  label,
  trailing,
}: {
  bg: string;
  labelColor: string;
  iconColor: string;
  icon?: typeof Lightbulb;
  /** Optional custom glyph (e.g. VennGlyph for "Shared purpose").
   *  Overrides `icon` when provided. */
  customGlyph?: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 pt-3">
      <div
        className="inline-flex items-center gap-1.5 rounded-full"
        style={{
          background: bg,
          padding: "3px 9px",
          border: "1px solid rgba(15,23,42,0.03)",
        }}
      >
        {customGlyph ? (
          customGlyph
        ) : Icon ? (
          <Icon
            className="h-3 w-3"
            strokeWidth={1.75}
            style={{ color: iconColor }}
          />
        ) : null}
        <span
          className="text-[10.5px] font-semibold tracking-[-0.005em]"
          style={{ color: labelColor }}
        >
          {label}
        </span>
      </div>
      {trailing}
    </div>
  );
}

// ── VennGlyph ────────────────────────────────────────────────────────
// Custom "intersection" glyph — two interlocking circles. Replaces the
// dartboard-y Target icon for "Shared purpose" cards. Reads as a Venn
// diagram, which is exactly what "intersection" means.
function VennGlyph({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <circle cx="4.4" cy="6" r="2.8" stroke={color} strokeWidth="1.4" />
      <circle cx="7.6" cy="6" r="2.8" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

// Aurora variant for the ghost — same pill shape, gradient fill
function GhostCardHeader({ trailing }: { trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pt-3">
      <div
        className="inline-flex items-center gap-1.5 rounded-full"
        style={{
          background: [
            "radial-gradient(120% 80% at 0% 0%, rgba(196, 181, 253, 0.65), transparent 60%)",
            "radial-gradient(110% 80% at 100% 100%, rgba(252, 211, 234, 0.55), transparent 65%)",
            "linear-gradient(180deg, rgba(244,232,255,0.95), rgba(232,241,254,0.85))",
          ].join(", "),
          padding: "3px 9px",
          border: "1px solid rgba(124, 58, 237, 0.10)",
          boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.85)",
        }}
      >
        <SparkleGlyph />
        <span
          className="text-[10.5px] font-semibold tracking-[-0.005em]"
          style={{ color: "rgb(91, 33, 182)" }}
        >
          From voice
        </span>
      </div>
      {trailing}
    </div>
  );
}

// Small author identity dot — used in card headers
function AuthorDot({ authorId }: { authorId: string }) {
  const av = abstractAvatarFor(authorId);
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: `hsl(${av.hue}, 70%, 55%)`,
        boxShadow: "0 0 0 1.5px rgba(255,255,255,0.9)",
      }}
    />
  );
}

function IntersectionCard({
  x,
  y,
  title,
}: {
  x: number;
  y: number;
  title: string;
}) {
  const t = KIND_THEMES.intersection;
  return (
    <CardShell x={x} y={y} width={CARD_W} height={CARD_H}>
      <CardHeader
        bg={t.headerBg}
        labelColor={t.labelColor}
        iconColor={t.iconColor}
        customGlyph={<VennGlyph color={t.iconColor} />}
        label="Shared purpose"
        trailing={
          <div className="flex items-center -space-x-0.5">
            <AuthorDot authorId={ME_ID} />
            <AuthorDot authorId={MAYA_ID} />
          </div>
        }
      />
      <div className="px-3 pb-3 pt-2">
        <div className="text-[13px] font-semibold leading-snug text-gray-900">
          {title}
        </div>
      </div>
    </CardShell>
  );
}

function AnchorCard({
  x,
  y,
  authorId,
  title,
  role,
}: {
  x: number;
  y: number;
  authorId: string;
  title: string;
  role: "upstream" | "downstream";
}) {
  const t = KIND_THEMES.anchor;
  return (
    <CardShell x={x} y={y} width={CARD_W} height={CARD_H}>
      <CardHeader
        bg={t.headerBg}
        labelColor={t.labelColor}
        iconColor={t.iconColor}
        icon={Anchor}
        label={`Anchor · ${role}`}
        trailing={<AuthorDot authorId={authorId} />}
      />
      <div className="px-3 pb-3 pt-2">
        <div className="text-[13px] font-semibold leading-snug text-gray-900">
          {title}
        </div>
      </div>
    </CardShell>
  );
}

function RealCard({
  x,
  y,
  authorId,
  icon: Icon,
  kind,
  title,
}: {
  x: number;
  y: number;
  authorId: string;
  icon: typeof Lightbulb;
  kind: "Insight" | "Question" | "Variation" | "Action";
  title: string;
}) {
  const themeKey = kind.toLowerCase() as keyof typeof KIND_THEMES;
  const t = KIND_THEMES[themeKey];
  return (
    <CardShell x={x} y={y} width={CARD_W} height={CARD_H}>
      <CardHeader
        bg={t.headerBg}
        labelColor={t.labelColor}
        iconColor={t.iconColor}
        icon={Icon}
        label={kind}
        trailing={<AuthorDot authorId={authorId} />}
      />
      <div className="px-3 pb-3 pt-2">
        <div className="text-[13px] font-semibold leading-snug text-gray-900">
          {title}
        </div>
      </div>
    </CardShell>
  );
}

function GhostCard({
  x,
  y,
  title,
  quote,
  attribution,
}: {
  x: number;
  y: number;
  title: string;
  quote: string;
  attribution: string;
}) {
  return (
    <CardShell x={x} y={y} width={CARD_W} height={GHOST_H} variant="ghost">
      <GhostCardHeader
        trailing={
          <button
            type="button"
            aria-label="Dismiss"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition hover:text-gray-700"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 2L8 8M8 2L2 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        }
      />
      <div className="px-3 pb-3 pt-2">
        <div className="text-[13px] font-semibold leading-snug text-gray-900">
          {title}
        </div>
        <div className="mt-2 text-[11.5px] italic leading-snug text-gray-500">
          “{quote}”
        </div>
        <div className="mt-0.5 text-[10.5px] leading-snug text-gray-400">
          {attribution}
        </div>
        <div className="mt-2.5">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-black"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            Add to board
          </button>
        </div>
      </div>
    </CardShell>
  );
}

// Tiny iridescent sparkle glyph — the only colored element on the
// ghost card itself. Carries the AI-origin signal in a single 11px dot.
function SparkleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
      <defs>
        <linearGradient id="sparkle-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0abfc" />
          <stop offset="50%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#7dd3fc" />
        </linearGradient>
      </defs>
      <path
        d="M5.5 0.6 L6.4 4.6 L10.4 5.5 L6.4 6.4 L5.5 10.4 L4.6 6.4 L0.6 5.5 L4.6 4.6 Z"
        fill="url(#sparkle-grad)"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Maya's cursor — hovering near the ghost's Promote button
// ─────────────────────────────────────────────────────────────────────

function MayaCursor() {
  // Park the cursor just inside the empty space above the ghost
  // card's right edge, so the name pill sits in clear margin
  // alongside the card body rather than overlapping the spine.
  const x = RIGHT_CARD_X + 140;
  const y = Y_CONVERGE - 60;
  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{ left: x, top: y }}
    >
      <svg
        width="16"
        height="20"
        viewBox="0 0 18 22"
        style={{
          filter: "drop-shadow(0 1px 2px rgba(15,23,42,0.18))",
          display: "block",
        }}
      >
        <path
          d="M 2 2 L 16 12 L 9 13 L 7 20 Z"
          fill={`hsl(${MAYA_AV.hue}, 70%, 52%)`}
          stroke="white"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 10,
          padding: "1.5px 6.5px",
          borderRadius: 999,
          background: `hsl(${MAYA_AV.hue}, 70%, 50%)`,
          color: "#fff",
          fontSize: 10,
          fontWeight: 600,
          whiteSpace: "nowrap",
          boxShadow: "0 1px 2px rgba(15,23,42,0.18)",
        }}
      >
        Maya
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Chat rail
// ─────────────────────────────────────────────────────────────────────

function ChatRail() {
  return (
    <aside
      className="absolute right-0 top-14 bottom-0 flex flex-col border-l border-gray-200/70 bg-white"
      style={{ width: 380 }}
    >
      <div className="border-b border-gray-200/60 px-6 py-3.5">
        <div className="text-[13px] font-semibold text-gray-900">
          Chat
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <ul className="flex flex-col gap-3">
          <Bubble
            author="maya"
            mine={false}
            body="what if we tracked minutes per session, like a daily Apple ring"
            voice
            firstOfStreak
          />
          <Bubble
            author="me"
            mine={true}
            body="Good call. Doing it now."
            firstOfStreak
          />
          <Bubble
            author="maya"
            mine={false}
            body="and maybe we publish weekly progress"
            voice
            firstOfStreak
          />
          <AISystemNote body="Noticed 3 candidates from your last 90 seconds" />
        </ul>
      </div>

      <div className="border-t border-gray-200/60 bg-white px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Speak"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition hover:bg-gray-200"
          >
            <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <div className="flex-1 text-[13px] text-gray-400">Message…</div>
          <button
            type="button"
            aria-label="Send"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-white"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function Bubble({
  author,
  mine,
  body,
  voice,
  firstOfStreak,
}: {
  author: "me" | "maya";
  mine: boolean;
  body: string;
  voice?: boolean;
  firstOfStreak?: boolean;
}) {
  return (
    <li className={mine ? "flex flex-col items-end" : "flex flex-col items-start"}>
      {firstOfStreak && (
        <div
          className={[
            "mb-1 flex items-center gap-1.5 text-[10.5px] text-gray-500",
            mine ? "flex-row-reverse" : "",
          ].join(" ")}
        >
          <span className="font-medium text-gray-700">
            {author === "me" ? "You" : "Maya"}
          </span>
          {voice && (
            <Mic className="h-2.5 w-2.5 text-gray-400" strokeWidth={1.75} />
          )}
        </div>
      )}
      <div
        className={[
          "max-w-[260px] rounded-2xl px-3.5 py-2 text-[13px] leading-snug",
          mine ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-900",
        ].join(" ")}
      >
        {body}
      </div>
    </li>
  );
}

function AISystemNote({ body }: { body: string }) {
  return (
    <li className="my-1 flex justify-center px-2">
      <div className="text-center text-[11.5px] italic leading-snug text-gray-500">
        {body}
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Caption beneath
// ─────────────────────────────────────────────────────────────────────

function Caption() {
  return (
    <section className="mx-auto mt-10 max-w-2xl text-center">
      <p className="text-[15px] font-medium leading-relaxed text-gray-900">
        One shared purpose at the top. The spine forks into two
        perspectives, each exploring its own insight. The AI listens to
        both and surfaces a single candidate at the convergence — one
        next step at the bottom.
      </p>
      <p className="mt-5 text-[13px] leading-relaxed text-gray-500">
        Each card kind carries its own header color so the type is
        readable at a glance — anchors slate, insights amber, actions
        emerald, AI candidates aurora.
      </p>
      <p className="mt-5 text-[11px] text-gray-400">
        Static preview · cognitive-modeling template
      </p>
    </section>
  );
}
