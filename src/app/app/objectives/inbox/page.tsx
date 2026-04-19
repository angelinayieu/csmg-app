"use client";

// ── Global Objectives Inbox ──
// Route: /app/objectives/inbox
//
// Cross-space triage queue of pending router-proposed objectives. Users
// accept / dismiss each proposal explicitly. Distinct from per-space
// objectives (/app/space/[id]/objectives) which manage goal hierarchy +
// sub-space decomposition for a single project.

import { ObjectivesView } from "@/components/objectives/objectives-view";

export default function ObjectivesPage() {
  return <ObjectivesView />;
}
