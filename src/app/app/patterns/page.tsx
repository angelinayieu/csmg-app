"use client";

// ── Global Pattern Library page ──
// Route: /app/patterns
//
// Shows the shared pattern library (accumulated from all convergent-point
// analyses across users). No space context required — patterns are global
// institutional knowledge.
//
// A space-scoped version of this also exists at /app/space/[id]/patterns —
// both render the same PatternList component.

import { PatternList } from "@/components/pattern-library/pattern-list";

export default function PatternsPage() {
  return (
    <div className="flex h-full flex-col">
      {/* No breadcrumb here — the sidebar already tells the user where they are */}
      <PatternList className="flex-1" />
    </div>
  );
}
