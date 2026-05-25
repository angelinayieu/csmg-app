"use client";

// ── Outcome Card (v2) ──
//
// Terminal-state representation. Simpler than pain/feature: just
// the state title + measured_by signal. No expand-collapse — the
// measured_by line is short enough to show inline.

import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface OutcomeCardItem {
  id: string;
  name: string;
  /** Concrete signal — "8+ min/session", "85% return next day" */
  measured_by?: string;
}

export function OutcomeCard({ item }: { item: OutcomeCardItem }) {
  return (
    <li
      className="rounded-2xl px-4 py-3"
      style={{
        background: "rgba(255,255,255,0.65)",
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <h4
        className="line-clamp-2 text-[13.5px] font-semibold leading-snug tracking-tight"
        style={{ color: appleVibe.text.primary, letterSpacing: "-0.005em" }}
      >
        {item.name}
      </h4>
      {item.measured_by && (
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Measured by
          </span>
          <span
            className="line-clamp-1 text-[11.5px] font-light"
            style={{ color: appleVibe.text.secondary }}
          >
            {item.measured_by}
          </span>
        </div>
      )}
    </li>
  );
}
