"use client";

// ── Use case gallery page ──
// Route: /app/use-cases
//
// Global (not space-scoped) entry point. User picks a template; we create a
// space configured for that template and route to its default surface.

import { UseCaseGallery } from "@/components/use-cases/use-case-gallery";

export default function UseCasesPage() {
  return <UseCaseGallery />;
}
