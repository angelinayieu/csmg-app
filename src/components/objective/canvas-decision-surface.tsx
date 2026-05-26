// ── Canvas Decision Surface ────────────────────────────────────────
//
// Cross-room "what needs your attention" strip on the main Objective
// Canvas view. Aggregates pending decisions across every room in the
// space — one row per room with pending decisions, sorted loudest
// first (conflict > friction > pending).
//
// Sibling concept to the per-item Decision Surface in
// item-detail-drawer.tsx, but at canvas altitude. Visual treatment
// matches the cross-room-signals-strip (white card, hairline border,
// 20px radius, soft shadow, 28px icon avatar) so it sits at the
// same altitude in the eye.
//
// Design rationale:
//   • The cross-room-signals-strip surfaces STRUCTURAL PATTERNS
//     (shared mechanisms, recurring root causes — "look at this").
//   • This surface surfaces ACTION ITEMS per room ("do this here").
//   • They complement, not duplicate.
//
// Behavior:
//   • Renders nothing when zero rooms have pending decisions.
//   • Always-visible when populated (no show/hide toggle — the
//     content IS the action list; collapsing it would defeat the
//     purpose).
//   • Each row links to its room (full page nav, matches existing
//     cross-room-signals-strip and SubCard behavior).

"use client";

import Link from "next/link";
import { ChevronRight, CircleAlert } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { RoomDecisionSummary } from "@/lib/objective-canvas/canvas-decisions";

interface Props {
  spaceId: string;
  /** Already sorted by severity (highest first) — see
   *  computeRoomDecisionSummaries. Empty array hides the surface. */
  summaries: RoomDecisionSummary[];
}

type Category = NonNullable<RoomDecisionSummary["top_category"]>;

const LEADING_DOT_COLOR: Record<Category, string> = {
  // Red — composition conflicts the user MUST resolve to ship.
  conflict: "rgba(220,38,38,0.85)",
  // Muted red — cross-room friction signal at high severity.
  friction: "rgba(220,38,38,0.55)",
  // Graphite — opportunity, not warning.
  pending: appleVibe.text.tertiary,
};

export function CanvasDecisionSurface({ spaceId, summaries }: Props) {
  if (summaries.length === 0) return null;

  return (
    <div
      className="mb-4 overflow-hidden border"
      style={{
        background: "#ffffff",
        borderColor: appleVibe.stroke.hairline,
        borderRadius: appleVibe.radius.lg,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* ── Header ── Icon avatar + title + room count. Matches the
          cross-room-signals-strip visual altitude so the two surfaces
          read as siblings without competing for the user's eye. */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <span
          className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background:
              "linear-gradient(180deg, rgba(15,23,42,0.06) 0%, rgba(15,23,42,0.025) 100%)",
            border: `1px solid ${appleVibe.stroke.hairline}`,
          }}
          aria-hidden
        >
          <CircleAlert
            className="h-3.5 w-3.5"
            strokeWidth={1.8}
            style={{ color: appleVibe.text.secondary }}
          />
        </span>
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[13px] font-semibold leading-none tracking-[-0.005em]"
            style={{ color: appleVibe.text.primary }}
          >
            Decisions across rooms
          </span>
          <span
            className="text-[11.5px] leading-none"
            style={{ color: appleVibe.text.tertiary }}
          >
            {summaries.length} room{summaries.length === 1 ? "" : "s"}{" "}
            need
            {summaries.length === 1 ? "s" : ""} your attention
          </span>
        </div>
      </div>

      {/* ── Body — per-room rows. Single hairline divider between the
          header block and the list so the rhythm matches the
          cross-room-signals-strip's expanded body. ── */}
      <ul
        className="flex flex-col border-t pb-1.5 pt-1"
        style={{ borderColor: appleVibe.stroke.hairline }}
      >
        {summaries.map((s) => (
          <li key={s.sub_objective_id}>
            <Link
              href={`/app/objective/${spaceId}/sub/${s.sub_objective_id}`}
              aria-label={ariaLabelFor(s)}
              className="group flex w-full items-center gap-3 px-4 py-2 outline-none transition-colors hover:bg-[rgba(15,23,42,0.025)] focus-visible:bg-[rgba(15,23,42,0.025)]"
            >
              {/* Leading severity dot — top category in this room. */}
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{
                  background: s.top_category
                    ? LEADING_DOT_COLOR[s.top_category]
                    : appleVibe.text.faint,
                }}
                aria-hidden
              />

              {/* Room title — primary. */}
              <span
                className="min-w-0 flex-1 truncate text-[12.5px] font-medium"
                style={{ color: appleVibe.text.primary }}
              >
                {s.sub_objective_title}
              </span>

              {/* Indicators — comma-separated count phrases. Kept
                  TEXT-ONLY (no per-chip colors) because the leading
                  dot already conveys severity. Repeating color per
                  count would be visual noise. */}
              <span
                className="hidden truncate text-[11px] font-light md:inline"
                style={{
                  color: appleVibe.text.secondary,
                  maxWidth: "50%",
                }}
              >
                {indicatorText(s)}
              </span>

              <ChevronRight
                className="h-3 w-3 flex-shrink-0 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2}
                style={{ color: appleVibe.text.faint }}
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Build the "2 conflicts · 1 friction · 2 awaiting" detail text.
 *  Order matches severity: conflicts → friction → awaiting. Zero-
 *  count categories are dropped so the line stays clean.  */
function indicatorText(s: RoomDecisionSummary): string {
  const parts: string[] = [];
  if (s.conflict_count > 0) {
    parts.push(
      s.conflict_count === 1
        ? "1 conflict"
        : `${s.conflict_count} conflicts`,
    );
  }
  if (s.friction_count > 0) {
    parts.push(
      s.friction_count === 1
        ? "1 friction"
        : `${s.friction_count} frictions`,
    );
  }
  if (s.pending_strong_count > 0) {
    parts.push(
      s.pending_strong_count === 1
        ? "1 awaiting"
        : `${s.pending_strong_count} awaiting`,
    );
  }
  return parts.join(" · ");
}

/** Spell out the row meaning for screen readers — the visual
 *  indicator text might be hidden on narrow widths (the `hidden
 *  md:inline` class), so the aria-label always carries the full
 *  decision summary. */
function ariaLabelFor(s: RoomDecisionSummary): string {
  return `Open ${s.sub_objective_title} — ${indicatorText(s)}`;
}
