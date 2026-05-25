"use client";

// ── Shared causes strip ──
//
// Sits above the Pain lane. Renders pills for every root_cause
// that appears across ≥2 pain points, with a count badge showing
// how many pains share it. Hover/click a pill → parent highlights
// the matching pains (drives lane dimming).

import { appleVibe } from "@/lib/apple-vibe-tokens";

interface Props {
  /** Map of root_cause → number of pains using it. Includes only
   *  causes with count ≥ 2. */
  shared: Array<{ cause: string; count: number }>;
  /** Currently highlighted causes (set elsewhere). */
  highlighted: Set<string>;
  onHover: (cause: string | null) => void;
}

export function SharedCausesStrip({
  shared,
  highlighted,
  onHover,
}: Props) {
  if (shared.length === 0) return null;
  return (
    <div className="mb-3">
      <div
        className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        Shared root causes · {shared.length}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shared.map(({ cause, count }) => {
          const active = highlighted.has(cause);
          return (
            <button
              key={cause}
              type="button"
              onMouseEnter={() => onHover(cause)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onHover(cause)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all"
              style={{
                background: active
                  ? "rgba(245,158,11,0.18)"
                  : "rgba(245,158,11,0.08)",
                color: active
                  ? "rgba(120,53,15,1)"
                  : "rgba(146,64,14,0.95)",
                border: `1px solid ${
                  active
                    ? "rgba(245,158,11,0.45)"
                    : "rgba(245,158,11,0.18)"
                }`,
              }}
            >
              <span>{cause}</span>
              <span
                className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold"
                style={{
                  background: "rgba(245,158,11,0.22)",
                  color: "rgba(120,53,15,1)",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
