"use client";

// ── Brainstorm page ──
// Route: /app/brainstorm
//
// Cross-space freestyle canvas. Does NOT require a space — lives at the app
// level. Detection runs against the user's entire knowledge graph; submit
// opens a destination picker.

import { BrainstormView } from "@/components/brainstorm/brainstorm-view";

export default function BrainstormPage() {
  return <BrainstormView />;
}
