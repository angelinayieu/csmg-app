// Visual harness for the custom "Remove from library?" confirm dialog that
// replaced window.confirm() in LibraryGrid. The real /app library is behind
// auth (preview browser is unauthenticated), so we render the real component
// here with mock spaces to exercise the dialog.
//
// SAFE TO DELETE — exploration. Route: /preflight/library-remove

"use client";

import { LibraryGrid, type LibrarySpace } from "@/components/home/library-grid";

const SPACES: LibrarySpace[] = [
  {
    id: "mock-1",
    name: "Task-Linked Music Discovery & Interest-Matching Social App",
    description: null,
    space_kind: "objective_canvas",
    card_brief: {
      kind: "Consumer Social Music App",
      name: "Task-Linked Music Discovery & Interest-Matching Social App",
      points: [
        "Core loop: tag music to tasks → surface flow-state playlists → match users",
        "Built: task profile model, user matching engine",
      ],
      from_updated_at: "2026-06-05T00:00:00.000Z",
    },
  },
  {
    id: "mock-2",
    name: "AI Debate Reels App",
    description: null,
    space_kind: "objective_canvas",
    card_brief: {
      kind: "Consumer AI engagement app",
      name: "AI Debate Reels App",
      points: [
        "Reel-style interface: scroll to skip to next AI debate topic",
        "Interest-Based AI Debate Generator personalizes topics per user",
      ],
      from_updated_at: "2026-06-05T00:00:00.000Z",
    },
  },
  {
    id: "mock-3",
    name: "Sandbox",
    description: "Free-form workspace with no defined objective yet.",
    space_kind: "reasoning",
    card_brief: {
      kind: "Open-ended exploration space",
      name: "Sandbox",
      points: ["Free-form workspace with no defined objective yet"],
      from_updated_at: "2026-06-05T00:00:00.000Z",
    },
  },
];

export default function LibraryRemovePreflight() {
  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", padding: "56px 40px" }}>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "#0F172A",
          marginBottom: 24,
        }}
      >
        library
      </h1>
      <LibraryGrid spaces={SPACES} />
    </div>
  );
}
