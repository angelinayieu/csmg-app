"use client";

// ── PendingIntakeMount ──
//
// Thin client-side wrapper so we can mount the PendingIntakeRunner
// inside the server-rendered /app layout. Owns the surface-path
// resolver so it stays in lockstep with the immersive home's
// template→surface mapping (single source).

import { PendingIntakeRunner } from "./pending-intake-runner";

function surfaceForResume(surface: string | undefined): string {
  switch (surface) {
    case "journal":
      return "/journal";
    case "whiteboard_playground":
      return "/whiteboard/brainstorm";
    case "whiteboard_overview":
      return "/whiteboard/overview";
    case "reading_import":
      return "/intake-review";
    case "structured_form":
    case undefined:
      return "/whiteboard";
    default:
      return "/whiteboard";
  }
}

export function PendingIntakeMount() {
  return <PendingIntakeRunner surfaceFor={surfaceForResume} />;
}
