"use client";

// ── Journal surface page ──
// Route: /app/space/[id]/journal
//
// For spaces created from the journal_self_discovery template (or any future
// journaling template). Daily entry form + recent-entries timeline.

import { JournalView } from "@/components/use-cases/journal/journal-view";

export default function JournalPage() {
  return <JournalView />;
}
