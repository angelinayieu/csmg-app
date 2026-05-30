// Preflight comparison harness — round 2. The user narrowed to two card
// families (Vision Pro glass + Folder tab) and asked for more variations
// WITHIN each. Renders both families across pipeline states, plus the
// current production card as a baseline. Mock data only. Public route.
// SAFE TO DELETE once a treatment is chosen.

"use client";

import { useState } from "react";
import { LayerFlashcard } from "@/components/objective/layer-shelves-view";
import type {
  LaneBreakdownRow,
  MainCanvasSub,
} from "@/components/objective/main-canvas-view";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { subProgressFromCompleted } from "@/lib/objective-canvas/elected-ready-variations";
import { GLASS_VARIANTS, FOLDER_VARIANTS } from "./card-families";

const R = ["#16A34A", "#059669", "#0D9488", "#15803D", "#84CC16"];
const F = ["#DC2626", "#EA580C", "#D97706", "#B45309"];
const M = ["#2563EB", "#475569", "#1D4ED8", "#4338CA"];

function rows(labels: string[], palette: string[]): LaneBreakdownRow[] {
  return labels.map((label, i) => ({
    label,
    color: palette[i % palette.length]!,
    count: 1 + ((i * 2) % 3),
  }));
}

function sub(
  id: string,
  title: string,
  opts: {
    counters?: string | null;
    description?: string | null;
    friction?: string[];
    mechanism?: string[];
    result?: string[];
    approvedPlayCount?: number;
    approved?: boolean;
    generated?: boolean;
    completed?: number;
  } = {},
): MainCanvasSub {
  const friction = rows(opts.friction ?? [], F);
  const mechanism = rows(opts.mechanism ?? [], M);
  const result = rows(opts.result ?? [], R);
  const completed = opts.completed ?? (opts.approved ? 4 : opts.generated ? 2 : 0);
  return {
    id,
    title,
    description: opts.description ?? null,
    rationale: null,
    approvedItems: opts.approved
      ? [{ id: `${id}-a`, name: "Approved item", layer: "outcomes" }]
      : [],
    generatedAt: opts.generated || opts.approved ? "2026-05-28T00:00:00.000Z" : null,
    topNegativeOutcome: opts.counters ?? null,
    laneBreakdown: { friction, mechanism, result },
    laneTotalCounts: {
      friction: friction.reduce((s, r) => s + r.count, 0),
      mechanism: mechanism.reduce((s, r) => s + r.count, 0),
      result: result.reduce((s, r) => s + r.count, 0),
    },
    approvedArchetypes: [],
    approvedPlayCount: opts.approvedPlayCount ?? 0,
    layerOrdinals: [3],
    layerPositionLabel: "L3 · Direct",
    progress: subProgressFromCompleted(completed),
  };
}

interface MockState {
  key: string;
  label: string;
  accent: string;
  themeLabel: string | null;
  sub: MainCanvasSub;
}

const STATES: MockState[] = [
  {
    key: "delivered",
    label: "Delivered & approved",
    accent: appleVibe.stage.outcomes,
    themeLabel: "Monetary Value & Feedback",
    sub: sub("dm", "Digital Activity Monetization Model", {
      counters:
        "Users miss opportunities for income growth through digital activity.",
      friction: ["Data Privacy", "Activity-Goal Misalignment", "Value Perception"],
      mechanism: ["Personalized Insights", "Goal Tracking", "Gamification"],
      result: ["Career Advancement", "Income Growth", "Skill Acquisition"],
      approved: true,
      approvedPlayCount: 1,
      completed: 5,
    }),
  },
  {
    key: "in-progress",
    label: "Mid-pipeline",
    accent: appleVibe.stage.features,
    themeLabel: "Goal Alignment & Achievement",
    sub: sub("gd", "Goal-Driven Knowledge Pathways", {
      counters:
        "Users fail to align digital activities with career advancement goals.",
      friction: ["Goal Alignment", "Information Overload", "Relevance"],
      mechanism: ["Recommendations", "Goal Tracking", "Privacy Controls"],
      result: ["Career Advancement", "Skill Acquisition", "Engagement", "Insights"],
      generated: true,
      completed: 3,
    }),
  },
  {
    key: "early",
    label: "Early / not generated",
    accent: appleVibe.stage.objective,
    themeLabel: "Search Intent & Attention",
    sub: sub("si", "Search Intent Analysis Dashboard", {
      description:
        "Visualizes and categorizes search queries to separate intentional from passive activity.",
    }),
  },
];

const FAMILIES = [
  {
    key: "glass",
    title: "Family 1 · Vision Pro glass",
    note: "Frosted translucent material — the direction you liked. Four takes on tint, depth, and layering.",
    variants: GLASS_VARIANTS,
  },
  {
    key: "folder",
    title: "Family 2 · Folder tab",
    note: "The folder-silhouette card you want to keep developing. F1 fuses it with the glass material.",
    variants: FOLDER_VARIANTS,
  },
] as const;

function Figure({
  name,
  blurb,
  children,
}: {
  name: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-3" style={{ width: 300 }}>
      <figcaption className="flex flex-col gap-1">
        <span
          className="text-[12px] font-bold tracking-tight"
          style={{ color: appleVibe.text.primary }}
        >
          {name}
        </span>
        <span
          className="text-[10.5px] font-light leading-snug"
          style={{ color: appleVibe.text.tertiary }}
        >
          {blurb}
        </span>
      </figcaption>
      {children}
    </figure>
  );
}

export default function CardFamiliesPreviewPage() {
  const [stateKey, setStateKey] = useState(STATES[0]!.key);
  const active = STATES.find((s) => s.key === stateKey)!;

  return (
    <div
      style={{
        background:
          "radial-gradient(1200px 600px at 50% -10%, #eef1f6 0%, #f5f6f8 55%, #f1f2f5 100%)",
        minHeight: "100vh",
      }}
      className="px-6 py-10"
    >
      <div className="mx-auto max-w-6xl">
        <div
          className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Preflight · Card families — round 2 (mock data)
        </div>
        <p
          className="mb-5 max-w-2xl text-[13px] leading-relaxed"
          style={{ color: appleVibe.text.secondary }}
        >
          More variations within the two families you liked — Vision Pro glass
          and the folder tab. F1 is a hybrid that puts the glass material inside
          the folder silhouette. Switch the pipeline state to stress-test rich,
          mid, and empty data, then tell me the code (e.g. &ldquo;G2&rdquo; or
          &ldquo;F1&rdquo;) and I&apos;ll promote it into the real canvas.
        </p>

        {/* State switcher */}
        <div
          className="mb-9 inline-flex items-center gap-1 rounded-full p-1"
          style={{
            background: "rgba(255,255,255,0.7)",
            border: `1px solid ${appleVibe.stroke.soft}`,
            boxShadow: appleVibe.shadow.chip,
          }}
        >
          {STATES.map((s) => {
            const on = s.key === stateKey;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStateKey(s.key)}
                className="rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold transition-all"
                style={{
                  background: on ? "rgba(15,23,42,0.92)" : "transparent",
                  color: on ? "white" : appleVibe.text.secondary,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Baseline */}
        <div className="mb-10">
          <h2
            className="mb-4 text-[13px] font-bold uppercase tracking-[0.16em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Current baseline
          </h2>
          <Figure
            name="Current (baseline)"
            blurb="The production folder-tab flashcard, shown bare for comparison."
          >
            <LayerFlashcard
              spaceId="preview"
              sub={active.sub}
              accent={active.accent}
              themeLabel={active.themeLabel}
              tabFade={0.7}
              bridgesTo={[]}
              getDragged={() => false}
            />
          </Figure>
        </div>

        {/* Families */}
        {FAMILIES.map((fam) => (
          <div key={fam.key} className="mb-12">
            <h2
              className="text-[15px] font-bold tracking-tight"
              style={{ color: appleVibe.text.primary }}
            >
              {fam.title}
            </h2>
            <p
              className="mb-5 max-w-2xl text-[11.5px] font-light leading-snug"
              style={{ color: appleVibe.text.tertiary }}
            >
              {fam.note}
            </p>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-10">
              {fam.variants.map(({ key, name, blurb, Component }) => (
                <Figure key={key} name={name} blurb={blurb}>
                  <Component
                    sub={active.sub}
                    accent={active.accent}
                    themeLabel={active.themeLabel}
                  />
                </Figure>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
