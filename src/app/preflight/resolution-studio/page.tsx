// Visual preflight for the redesigned Resolution Studio modal — renders the
// component in isolation with the music-app payload from the design review so
// the minimal / focused-card / hidden-detail pass can be screenshotted without
// auth or a live board.
//
// SAFE TO DELETE — exploration. Route: /preflight/resolution-studio

"use client";

import { ResolutionStudio } from "@/components/objective/resolution/resolution-studio";
import type { ResolutionStudioDetail } from "@/components/objective/board-bus";

const DETAIL: ResolutionStudioDetail = {
  spaceId: "preflight",
  objectiveTitle: "Task-Linked Music Discovery & Interest-Matching Social App",
  sharpenedPrompt:
    'Build a social app where users tag music/remixes to specific tasks (e.g., coding, working out, studying) to surface "flow state" playlists, and match with other users by shared music taste and task context so they can discover tracks and chat — open to all, no barriers to entry.',
  concepts: [
    {
      phrase: "flow mood when doing a specific task",
      kind: "goal",
      leverage: 0.92,
      uncertainty: 0.8,
      why: "This is the core value promise of the app, but 'flow mood' is subjective and 'specific task' is undefined — both must be pinned to build anything concrete.",
      candidate_readings: [
        "Flow state = deep focus/productivity; tasks are work-oriented (coding, studying, writing) and music is algorithmically matched to induce cognitive flow.",
        "Flow mood = a vibe or energy level (chill, hype, focused); tasks are broad lifestyle contexts (gym, commute, cooking) and users self-select their mood.",
        "Flow is user-defined per session — the app learns what 'flow' means for each individual user over time via listening behavior.",
        "Flow is a social signal — tracks that many users tagged to the same task and listened to for long uninterrupted sessions are surfaced as 'flow-verified'.",
      ],
    },
    {
      phrase: "match people by interest",
      kind: "lever",
      leverage: 0.78,
      uncertainty: 0.6,
      why: "Which signal drives the match?",
      candidate_readings: [
        "Match on overlapping music taste (shared artists/tracks).",
        "Match on shared task context (both coding right now).",
      ],
    },
    {
      phrase: "specific task",
      kind: "concept",
      leverage: 0.7,
      uncertainty: 0.55,
      candidate_readings: [],
    },
    {
      phrase: "music remix",
      kind: "concept",
      leverage: 0.62,
      uncertainty: 0.5,
      candidate_readings: [],
    },
    {
      phrase: "people can meet people and talk to each other",
      kind: "lever",
      leverage: 0.55,
      uncertainty: 0.5,
      candidate_readings: [],
    },
    {
      phrase: "discover new music",
      kind: "goal",
      leverage: 0.5,
      uncertainty: 0.45,
      candidate_readings: [],
    },
    {
      phrase: "anyone can go on the app",
      kind: "constraint",
      leverage: 0.4,
      uncertainty: 0.4,
      candidate_readings: [],
    },
  ],
};

export default function ResolutionStudioPreflight() {
  return (
    <div style={{ minHeight: "100vh", background: "#e9edf2" }}>
      <ResolutionStudio
        detail={DETAIL}
        onClose={() => {
          /* no-op for preflight */
        }}
      />
    </div>
  );
}
