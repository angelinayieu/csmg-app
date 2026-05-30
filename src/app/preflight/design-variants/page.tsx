"use client";

// Preflight comparison harness — pick a design direction for the
// Objective Canvas TAB (top nav) and CARD (layer flashcard). Mock data
// only; renders each variant in context so the user can choose. Once a
// direction is picked it promotes into home-tab-nav.tsx / the real
// LayerFlashcard in layer-shelves-view.tsx. Public route. SAFE TO DELETE.

import type {
  LaneBreakdownRow,
  MainCanvasSub,
} from "@/components/objective/main-canvas-view";
import { subProgressFromCompleted } from "@/lib/objective-canvas/elected-ready-variations";
import {
  CardEditorial,
  CardGlassFolder,
  CardOutcomeRing,
  CardSpatialBloom,
  type CardVariantProps,
} from "./card-variants";
import {
  TabSlidingSegmented,
  TabUnderline,
  TabAccentCapsule,
  TabVisionDock,
} from "./tab-variants";

// Result palette (greens/teals) — mirrors the room result taxonomy.
const R = ["#16A34A", "#0D9488", "#059669", "#15803D"];

function mkRows(labels: string[], counts: number[]): LaneBreakdownRow[] {
  return labels.map((label, i) => ({
    label,
    color: R[i % R.length]!,
    count: counts[i] ?? 1,
  }));
}

function sub(
  id: string,
  title: string,
  opts: {
    counter?: string | null;
    description?: string | null;
    result?: { labels: string[]; counts: number[] };
    completed: number;
    approved?: boolean;
    approvedPlayCount?: number;
    layerOrdinals: number[];
  },
): MainCanvasSub {
  const result = opts.result ? mkRows(opts.result.labels, opts.result.counts) : [];
  return {
    id,
    title,
    description: opts.description ?? null,
    rationale: null,
    approvedItems: opts.approved
      ? [{ id: `${id}-a`, name: "Approved", layer: "outcomes" }]
      : [],
    generatedAt: opts.completed > 0 ? "2026-05-28T00:00:00.000Z" : null,
    topNegativeOutcome: opts.counter ?? null,
    laneBreakdown: { friction: [], mechanism: [], result },
    laneTotalCounts: {
      friction: 0,
      mechanism: 0,
      result: result.reduce((s, r) => s + r.count, 0),
    },
    approvedArchetypes: [],
    approvedPlayCount: opts.approvedPlayCount ?? 0,
    layerOrdinals: opts.layerOrdinals,
    layerPositionLabel: null,
    progress: subProgressFromCompleted(opts.completed),
  };
}

// Three states across three layer accents (purple/outcome, teal/process,
// blue/mechanism) so each direction is judged rich · delivered · empty.
const CARDS: Array<{ sub: MainCanvasSub; accent: string; theme: string; bridgesTo: number[] }> = [
  {
    sub: sub("gd", "Goal-Driven Knowledge Pathways", {
      counter:
        "Users fail to align digital activities with career advancement goals, missing long-term growth.",
      result: {
        labels: ["Career Advancement", "Skill Acquisition", "Increased Engagement", "Data-Driven Insights"],
        counts: [2, 1, 1, 1],
      },
      completed: 4,
      approved: true,
      approvedPlayCount: 1,
      layerOrdinals: [2, 3],
    }),
    accent: "#475569",
    theme: "Goal Alignment & Achievement Tools",
    bridgesTo: [2],
  },
  {
    sub: sub("dm", "Digital Activity Monetization Model", {
      counter: "Users miss opportunities for income growth through digital activity.",
      result: {
        labels: ["Income Growth", "Career Advancement", "Network Expansion"],
        counts: [3, 2, 1],
      },
      completed: 5,
      layerOrdinals: [3, 4],
    }),
    accent: "#0D9488",
    theme: "Monetary Value & Feedback",
    bridgesTo: [3],
  },
  {
    sub: sub("cr", "Community Recognition Platform", {
      description:
        "A feature that recognizes and rewards users for achieving their goals and sharing their data history.",
      completed: 0,
      layerOrdinals: [3],
    }),
    accent: "#2563EB",
    theme: "Goal Alignment & Achievement Tools",
    bridgesTo: [],
  },
];

const CARD_VARIANTS: Array<{
  key: string;
  name: string;
  intent: string;
  Comp: (p: CardVariantProps) => React.ReactElement;
}> = [
  {
    key: "A",
    name: "A · Quiet Editorial",
    intent: "Maximum restraint — no folder tab, one hero result, a hairline progress track. Linear/Things calm.",
    Comp: CardEditorial,
  },
  {
    key: "B",
    name: "B · visionOS Glass Folder",
    intent: "The folder metaphor done luxe — protruding tab merged into a frosted glass body under one accent glow.",
    Comp: CardGlassFolder,
  },
  {
    key: "C",
    name: "C · Outcome Ring",
    intent: "Data-forward — a circular progress ring anchors the corner; the #1 outcome reads as the payoff.",
    Comp: CardOutcomeRing,
  },
  {
    key: "D",
    name: "D · Spatial Bloom",
    intent: "Boldest — a radial accent bloom inside frosted glass, floating result chips, a glowing progress bar.",
    Comp: CardSpatialBloom,
  },
];

const TAB_VARIANTS: Array<{ name: string; intent: string; Comp: () => React.ReactElement }> = [
  {
    name: "T1 · Sliding Segmented",
    intent: "macOS segmented control — a white pill slides under the active tab. Most natively Apple.",
    Comp: TabSlidingSegmented,
  },
  {
    name: "T2 · Minimal Underline",
    intent: "No container — labels with a sliding accent underline. Calmest, content-first.",
    Comp: TabUnderline,
  },
  {
    name: "T3 · Accent Glass Capsule",
    intent: "Active tab is a vivid indigo glass pill with glow. Warmer / more branded than graphite.",
    Comp: TabAccentCapsule,
  },
  {
    name: "T4 · visionOS Dock",
    intent: "Bigger frosted dock — icon over label, active raises onto a glowing pane. Most spatial.",
    Comp: TabVisionDock,
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
      style={{ color: "rgba(15,23,42,0.9)" }}
    >
      {children}
    </div>
  );
}

function Intent({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 max-w-2xl text-[12.5px] font-light leading-snug" style={{ color: "rgba(15,23,42,0.5)" }}>
      {children}
    </p>
  );
}

export default function DesignVariantsPage() {
  return (
    <div style={{ background: "#F4F5F7", minHeight: "100vh" }} className="px-8 py-12">
      <div className="mx-auto max-w-6xl">
        <div
          className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em]"
          style={{ color: "rgba(15,23,42,0.45)" }}
        >
          Preflight · Design directions (mock data)
        </div>
        <h1
          className="mb-10 text-[22px] font-semibold tracking-tight"
          style={{ color: "rgba(15,23,42,0.92)" }}
        >
          Pick a tab + a card direction
        </h1>

        {/* ── TABS ─────────────────────────────────────────────── */}
        <SectionLabel>Top tab nav — 4 directions</SectionLabel>
        <Intent>Each is interactive — click between tabs to feel the motion.</Intent>
        <div className="mb-16 flex flex-col gap-5">
          {TAB_VARIANTS.map(({ name, intent, Comp }) => (
            <div
              key={name}
              className="flex flex-col gap-3 rounded-3xl p-6"
              style={{ background: "#FAFBFC", border: "1px solid rgba(15,23,42,0.05)" }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold" style={{ color: "rgba(15,23,42,0.9)" }}>
                  {name}
                </span>
                <span className="text-[11.5px] font-light" style={{ color: "rgba(15,23,42,0.5)" }}>
                  {intent}
                </span>
              </div>
              <div className="flex justify-center py-3">
                <Comp />
              </div>
            </div>
          ))}
        </div>

        {/* ── CARDS ────────────────────────────────────────────── */}
        <SectionLabel>Layer flashcard — 4 directions</SectionLabel>
        <Intent>
          Each direction is shown across three real states — approved &amp; in-progress, fully delivered, and
          not-started — and three layer accents, so you can judge how the identity color + results + progress read.
        </Intent>
        <div className="flex flex-col gap-8">
          {CARD_VARIANTS.map(({ key, name, intent, Comp }) => (
            <div
              key={key}
              className="flex flex-col gap-4 rounded-3xl p-6"
              style={{
                background:
                  "linear-gradient(180deg, rgba(71,85,105,0.05), transparent 60%), #FAFBFC",
                border: "1px solid rgba(15,23,42,0.05)",
              }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-semibold" style={{ color: "rgba(15,23,42,0.9)" }}>
                  {name}
                </span>
                <span className="text-[12px] font-light" style={{ color: "rgba(15,23,42,0.5)" }}>
                  {intent}
                </span>
              </div>
              <div className="flex flex-wrap items-start gap-5 py-2">
                {CARDS.map((c) => (
                  <Comp
                    key={c.sub.id}
                    sub={c.sub}
                    accent={c.accent}
                    themeLabel={c.theme}
                    bridgesTo={c.bridgesTo}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
