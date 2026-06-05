// Visual preflight for the Glossary Build Timeline — renders the view in
// isolation with a representative music-app story so it can be screenshotted
// without auth or a live board.
//
// Live data: the same component fetches when given a spaceId
//   <GlossaryTimelineView spaceId={id} />  →  /api/objective/[id]/glossary-timeline
//
// SAFE TO DELETE — exploration. Route: /preflight/glossary-timeline

"use client";

import { GlossaryTimelineView } from "@/components/objective/glossary-timeline-view";
import type { GlossaryTimelineEvent } from "@/lib/objective-canvas/glossary-timeline";

const T = (h: number, m: number) =>
  `2026-06-05T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

const SAMPLE: GlossaryTimelineEvent[] = [
  {
    at: T(17, 2),
    phase: "sharpen",
    title: "Objective sharpened",
    detail: "Task-Linked Music Discovery & Interest-Matching Social App",
  },
  {
    at: T(17, 3),
    phase: "map",
    title: "6 key ambiguities surfaced",
    detail: "Highest-leverage: specific task, music remix, flow mood",
    count: 6,
  },
  {
    at: T(17, 9),
    phase: "reference",
    title: "Reference added: SoundCloud embed docs",
    detail: "Tracks are embedded via oEmbed, not hosted — shapes the licensing model.",
    source: "reference",
  },
  {
    at: T(17, 21),
    phase: "resolve",
    title: "Resolved “specific task”",
    detail:
      "User-tagged lifestyle categories (coding, workout, study) — not AI-inferred from listening.",
    concept_slug: "specific-task",
    source: "voice",
  },
  {
    at: T(17, 24),
    phase: "resolve",
    title: "Resolved “music remix”",
    detail: "Share/tag existing remixes from other platforms — no in-app remixing in v1.",
    concept_slug: "music-remix",
    source: "manual",
  },
  {
    at: T(17, 25),
    phase: "resolve",
    title: "Resolved “flow mood”",
    detail: "A self-selected vibe (chill / hype / focused) per task — re-ranks that task's tracks.",
    concept_slug: "flow-mood",
    source: "ai",
  },
  {
    at: T(17, 26),
    phase: "define",
    title: "specific task",
    detail: "User-tagged lifestyle categories the whole discovery surface is organized around.",
    term: "specific task",
    source: "user",
    provenance: "yours",
  },
  {
    at: T(17, 26),
    phase: "define",
    title: "flow mood",
    detail: "A self-selected vibe per task category that re-ranks recommended tracks.",
    term: "flow mood",
    source: "annotation",
    provenance: "grounded",
  },
  {
    at: T(17, 26),
    phase: "define",
    title: "Hybrid Matching",
    detail: "Combined score of music taste, task context, and recent listening activity.",
    term: "Hybrid Matching",
    source: "llm",
    provenance: "ai",
  },
  {
    at: T(17, 27),
    phase: "apply",
    title: "Answers applied → glossary pinned + objective re-framed",
  },
  {
    at: T(17, 28),
    phase: "decompose",
    title: "Decomposed into 14 building blocks",
    count: 14,
  },
];

export default function GlossaryTimelinePreflight() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafafa",
        padding: "48px 32px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 24,
          padding: "28px 32px",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.9) inset, 0 12px 32px -16px rgba(11,18,40,0.18)",
        }}
      >
        <GlossaryTimelineView events={SAMPLE} />
      </div>
    </div>
  );
}
