"use client";

// ── CanonicalConceptBadge (Sprint W6.8) ────────────────────────────
//
// Compact, click-to-open indicator that an entity is linked to a
// Tier 1 canonical concept. Designed to slot inline beside a
// variable/entity name without disrupting layout.
//
// States:
//   • code present + space_count fetched → "⊕ N spaces" (green when
//     verified, gray when pending)
//   • code present + counts not yet hydrated → "⊕ canonical"
//   • code absent (null/undefined) → "○ unique" (honest signal:
//     this entity hasn't joined the canonical registry)
//
// Click opens the CanonicalConceptDrawer (sibling component) which
// hits GET /api/canonical-concepts/[code].
//
// Why this lives outside src/components/canvas/ and src/components/apps/:
//   It's shared between W5 widgets, the canvas entity detail drawer,
//   and the preflight variable rows. The src/components/canonical/
//   folder is the shared home.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CanonicalConceptDrawer } from "./canonical-concept-drawer";

interface CanonicalConceptBadgeProps {
  /** Canonical concept ID (entities.canonical_concept_id). */
  canonicalConceptId?: string | null;
  /** Canonical code for the GET /api/canonical-concepts/[code] URL. */
  canonicalCode?: string | null;
  /** Compact vs comfortable visual size. Default 'compact'. */
  size?: "compact" | "comfortable";
  /** When true, render the "○ unique" pill for unlinked entities;
   *  when false (default), render nothing — caller decides whether
   *  unlinked entities should be visually called out. */
  showUnlinked?: boolean;
}

export function CanonicalConceptBadge({
  canonicalConceptId,
  canonicalCode,
  size = "compact",
  showUnlinked = false,
}: CanonicalConceptBadgeProps) {
  const [open, setOpen] = useState(false);

  // Unlinked path
  if (!canonicalConceptId || !canonicalCode) {
    if (!showUnlinked) return null;
    return (
      <span
        title="This entity is not yet linked to a canonical concept."
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-medium uppercase tracking-wide text-gray-400",
          size === "compact" ? "text-[9.5px]" : "text-[10.5px]",
        )}
      >
        <span className="h-1 w-1 rounded-full bg-gray-300" aria-hidden />
        unique
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={`Linked to canonical concept "${canonicalCode}" — click for cross-space evidence`}
        className={cn(
          "group inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-medium uppercase tracking-wide text-violet-700 transition hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-200",
          size === "compact" ? "text-[9.5px]" : "text-[10.5px]",
        )}
      >
        <span
          className="h-1 w-1 rounded-full bg-violet-500"
          aria-hidden
        />
        canonical
      </button>
      {open && (
        <CanonicalConceptDrawer
          canonicalCode={canonicalCode}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
