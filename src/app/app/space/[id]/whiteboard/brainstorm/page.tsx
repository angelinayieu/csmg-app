"use client";

// ── Space-level brainstorm page ──
// Route: /app/space/[id]/whiteboard/brainstorm
//
// Space-scoped variant of the global brainstorm. Detection + materialize
// all scoped to this one space. Includes a freestyle sticky-note zone for
// half-formed thoughts that haven't become entities yet.

import { SpaceBrainstormView } from "@/components/brainstorm/space-brainstorm-view";

export default function SpaceBrainstormPage() {
  return <SpaceBrainstormView />;
}
