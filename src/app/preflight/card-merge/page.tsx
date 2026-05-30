// Preflight comparison harness — round 3. The user merged the baseline
// folder card with the G3 clear-glass card: green status dot (not the
// READY pill), no top-ceiling whitespace, G3's concise body. The open
// question this round is the TAB — how visible should the folder lip be?
// So we render the merged card across a spectrum of tab fills, from
// solid green → plain white. Mock data only. Public route. SAFE TO
// DELETE once a tab tone is chosen.

"use client";

import { useState } from "react";
import { LayerFlashcard } from "@/components/objective/layer-shelves-view";
import type {
  LaneBreakdownRow,
  MainCanvasSub,
} from "@/components/objective/main-canvas-view";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { subProgressFromCompleted } from "@/lib/objective-canvas/elected-ready-variations";
import { MergedFolderCard, TAB_TONES } from "./card-merge";

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
  const completed =
    opts.completed ?? (opts.approved ? 4 : opts.generated ? 2 : 0);
  return {
    id,
    title,
    description: opts.description ?? null,
    rationale: null,
    approvedItems: opts.approved
      ? [{ id: `${id}-a`, name: "Approved item", layer: "outcomes" }]
      : [],
    generatedAt:
      opts.generated || opts.approved ? "2026-05-28T00:00:00.000Z" : null,
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

export default function CardMergePreviewPage() {
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
          Preflight · Card merge — round 3 (mock data)
        </div>
        <p
          className="mb-5 max-w-2xl text-[13px] leading-relaxed"
          style={{ color: appleVibe.text.secondary }}
        >
          The merge you asked for: baseline folder card + G3&apos;s concise
          body. The READY pill is now a single green status dot, and the empty
          band above the title is gone so the top no longer has that tall
          whitespace ceiling. The body is identical on every card below — only
          the <strong>tab</strong> changes, walking a spectrum from solid green
          down to a plain white lip. Tell me the tone (e.g. &ldquo;T3&rdquo;)
          and I&apos;ll promote it into the real canvas.
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

        {/* Baseline + merged side by side */}
        <div className="mb-12">
          <h2
            className="mb-4 text-[13px] font-bold uppercase tracking-[0.16em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Before → after
          </h2>
          <div className="flex flex-wrap items-start gap-x-10 gap-y-10">
            <Figure
              name="Baseline (before)"
              blurb="Production card — READY pill + the tall empty band above the title."
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
            <Figure
              name="Merged (after) · default tab T4"
              blurb="Green dot, no ceiling whitespace, G3-concise body. Tab tone shown: Tint."
            >
              <MergedFolderCard
                sub={active.sub}
                accent={active.accent}
                themeLabel={active.themeLabel}
                tone={TAB_TONES.find((t) => t.key === "tint")!}
              />
            </Figure>
          </div>
        </div>

        {/* Tab spectrum */}
        <div className="mb-12">
          <h2
            className="text-[15px] font-bold tracking-tight"
            style={{ color: appleVibe.text.primary }}
          >
            Tab spectrum · solid green → white
          </h2>
          <p
            className="mb-5 max-w-2xl text-[11.5px] font-light leading-snug"
            style={{ color: appleVibe.text.tertiary }}
          >
            Same merged card, six tab fills. Loudest at the left, quietest at
            the right. Pick how much the folder lip should announce itself.
          </p>
          <div className="flex flex-wrap items-start gap-x-8 gap-y-10">
            {TAB_TONES.map((tone) => (
              <Figure key={tone.key} name={tone.name} blurb={tone.note}>
                <MergedFolderCard
                  sub={active.sub}
                  accent={active.accent}
                  themeLabel={active.themeLabel}
                  tone={tone}
                />
              </Figure>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
