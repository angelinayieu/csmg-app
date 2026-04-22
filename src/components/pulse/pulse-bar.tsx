"use client";

// ── Pulse Bar (Tier 8) ─────────────────────────────────────────────────
//
// Persistent 48px-tall status strip at the top of every authenticated
// page. Replaces six scattered status surfaces (MainObjectiveBanner,
// AppGenerationProgressChip, SpaceInsightsStrip, stale-objectives
// banner, Tier 1 message banner, auto-gen failure notices) with one
// ambient "how is your thinking doing?" surface.
//
// Design philosophy (Vision Pro aesthetic):
//
//   - Glass-morphism backdrop: translucent, heavily blurred, with a
//     faint specular highlight along the top edge so the bar feels like
//     a floating surface above the page content.
//   - Motion is spring-physics, not linear. Color + count transitions
//     ease with a gentle overshoot; the heartbeat on the status dot is
//     a breathing animation, not a blink.
//   - Three zones, left to right: STATUS (colored dot + word),
//     NARRATIVE (sentence of current counts/state), RECENT + ACTION.
//   - Zero ownership of data — every value is fed in via props. The
//     hook `usePulseState` does the aggregation work.
//
// What users experience:
//
//   - Glances up: immediately knows the system state + what's new
//   - Clicks the "N new ↓" chip: slides down an activity feed
//   - Clicks "Commit" (when ready): commits current canvas state
//
// What this is NOT:
//   - Not a navigation bar
//   - Not a toolbar
//   - Not a list of notifications
//   It's a single-line ambient status + one primary action.

import { useMemo } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────

export type PulseStatus =
  | "empty"      // no work yet (fresh space, no entities)
  | "analyzing"  // pipeline running; numbers moving
  | "healthy"    // stable state, no attention needed
  | "attention"  // surprises / drafts / stale objectives; user should look
  | "critical";  // something genuinely broken (auth error, pipeline failed)

export interface PulseNarrativeSegment {
  /** The visible text — "24 concepts", "3 signals", etc. */
  label: string;
  /**
   * Optional hover detail — rendered in a lightweight tooltip-style
   * popover. Keep short (≤2 sentences).
   */
  tooltip?: string;
  /**
   * When true, this segment renders in the attention tone (amber) to
   * draw the eye. Use sparingly — at most one attention segment at once.
   */
  tone?: "neutral" | "attention" | "positive";
}

export interface PulseBarProps {
  status: PulseStatus;
  /** One-word status label ("Healthy", "Analyzing", "Attention"). */
  statusLabel: string;
  /** Ordered segments that compose the middle narrative sentence. */
  segments: PulseNarrativeSegment[];
  /** Count of unread recent changes — drives the "N new ↓" chip. */
  recentCount: number;
  /** Whether the activity-feed panel is currently open. */
  recentOpen: boolean;
  onToggleRecent: () => void;
  /** Optional primary action (usually "Commit"). Hidden when undefined. */
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    /** Subtle ring-glow highlight on the button. Use when the action is ready. */
    glow?: boolean;
  };
}

// ── Component ──────────────────────────────────────────────────────────

export function PulseBar(props: PulseBarProps) {
  const {
    status,
    statusLabel,
    segments,
    recentCount,
    recentOpen,
    onToggleRecent,
    primaryAction,
  } = props;

  // Memoize the zone-1 color palette so we only pay the lookup cost
  // once per render. Colors chosen for Vision Pro restraint — muted
  // rather than saturated, with a soft glow (box-shadow with the dot's
  // color at low opacity) to sell the "living" quality.
  const palette = useMemo(() => statusPalette(status), [status]);

  return (
    <div
      className={cn(
        // Sticky so it survives scroll; z-40 to float above content but
        // below modals/menus (z-50+).
        "sticky top-0 z-40 w-full",
        // The glass surface itself. Three stacked effects:
        //   1. Translucent base (bg-white/70) for the "behind content is visible" feel
        //   2. backdrop-blur for the frosted look
        //   3. Subtle gradient overlay (top brighter than bottom) that creates
        //      the perception of a hairline specular highlight
        "border-b border-white/50",
        "bg-gradient-to-b from-white/85 via-white/70 to-white/55",
        "backdrop-blur-2xl backdrop-saturate-150",
        // Inner hairline glow along the top edge — the Vision Pro specular
        // signature. Shows brighter on a gray page background, invisible
        // on pure white.
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_1px_0_rgba(15,23,42,0.04)]",
      )}
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "mx-auto flex h-12 w-full max-w-[1440px] items-center gap-3 px-6",
          "text-[13px] leading-none",
        )}
      >
        {/* ── Zone 1: status dot + word ─────────────────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          <StatusDot status={status} palette={palette} />
          <span
            className={cn(
              "font-semibold tracking-tight transition-colors duration-500",
              palette.textClass,
            )}
          >
            {statusLabel}
          </span>
        </div>

        {/* Vertical divider — hairline, soft */}
        <span
          aria-hidden
          className="h-4 w-px shrink-0 bg-gradient-to-b from-transparent via-gray-300/60 to-transparent"
        />

        {/* ── Zone 2: narrative segments ────────────────────────── */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-2 truncate">
            {segments.length === 0 ? (
              <span className="text-gray-400">—</span>
            ) : (
              segments.map((seg, i) => (
                <PulseSegment key={i} segment={seg} isLast={i === segments.length - 1} />
              ))
            )}
          </div>
        </div>

        {/* ── Zone 3: recent + primary action ───────────────────── */}
        <div className="flex shrink-0 items-center gap-2">
          {recentCount > 0 && (
            <RecentChip
              count={recentCount}
              open={recentOpen}
              onClick={onToggleRecent}
            />
          )}

          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              className={cn(
                // Pill button with glass + subtle gradient. Spring
                // scale on active. Ring glow when .glow is set — that's
                // how the "ready" state calls for attention without
                // being garish.
                "rounded-full px-3.5 py-1.5 text-[12px] font-semibold tracking-tight",
                "bg-gradient-to-b from-gray-900 to-gray-800 text-white shadow-sm",
                "transition-all duration-200 active:scale-[0.97]",
                "hover:from-gray-800 hover:to-gray-700 hover:shadow-md",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
                primaryAction.glow &&
                  "ring-2 ring-emerald-400/40 shadow-[0_0_16px_-2px_rgba(16,185,129,0.35)]",
              )}
            >
              {primaryAction.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

interface PaletteSpec {
  dotColor: string;        // Tailwind bg-* class for the core dot
  dotGlow: string;         // box-shadow color string for the outer glow
  ringColor: string;       // ring color for the breathing halo
  textClass: string;       // text color for the status word
  breathe: boolean;        // whether to run the breathing animation
}

function statusPalette(status: PulseStatus): PaletteSpec {
  // Vision Pro palettes lean soft + sophisticated. Never fully saturated.
  // Each hue has a matching glow color at 0.35 alpha that gives the dot
  // its "alive" appearance.
  switch (status) {
    case "empty":
      return {
        dotColor: "bg-gray-300",
        dotGlow: "rgba(156,163,175,0.25)",
        ringColor: "ring-gray-300/30",
        textClass: "text-gray-500",
        breathe: false,
      };
    case "analyzing":
      return {
        dotColor: "bg-sky-500",
        dotGlow: "rgba(14,165,233,0.5)",
        ringColor: "ring-sky-400/40",
        textClass: "text-sky-700",
        breathe: true, // distinctive pulse while work is in flight
      };
    case "healthy":
      return {
        dotColor: "bg-emerald-500",
        dotGlow: "rgba(16,185,129,0.45)",
        ringColor: "ring-emerald-400/35",
        textClass: "text-emerald-700",
        breathe: true, // slower, gentler than analyzing — "alive, not working"
      };
    case "attention":
      return {
        dotColor: "bg-amber-500",
        dotGlow: "rgba(245,158,11,0.45)",
        ringColor: "ring-amber-400/40",
        textClass: "text-amber-700",
        breathe: true, // faster breath — subtle urgency
      };
    case "critical":
      return {
        dotColor: "bg-rose-500",
        dotGlow: "rgba(244,63,94,0.5)",
        ringColor: "ring-rose-400/45",
        textClass: "text-rose-700",
        breathe: true,
      };
  }
}

function StatusDot({
  status,
  palette,
}: {
  status: PulseStatus;
  palette: PaletteSpec;
}) {
  return (
    <span
      className="relative flex h-2.5 w-2.5 items-center justify-center"
      aria-label={`Status: ${status}`}
    >
      {/* Breathing ring — only rendered for active states. Sits behind
          the core dot and pulses outward to convey "this thing is
          alive." Duration varies by state so users can feel the
          difference between analyzing (faster) and healthy (slower). */}
      {palette.breathe && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full ring-2",
            palette.ringColor,
            status === "analyzing"
              ? "animate-pulse-ring-fast"
              : status === "attention" || status === "critical"
                ? "animate-pulse-ring"
                : "animate-pulse-ring-slow",
          )}
        />
      )}
      {/* Core dot with outer glow for the "light escaping the surface"
          effect. The glow is CSS box-shadow rather than ring so it
          softly falls off with distance, matching Vision Pro's
          materialsense. */}
      <span
        className={cn(
          "relative h-2 w-2 rounded-full transition-all duration-500",
          palette.dotColor,
        )}
        style={{
          boxShadow: `0 0 0 1px rgba(255,255,255,0.5), 0 0 10px 1px ${palette.dotGlow}`,
        }}
      />
    </span>
  );
}

function PulseSegment({
  segment,
  isLast,
}: {
  segment: PulseNarrativeSegment;
  isLast: boolean;
}) {
  const toneClass =
    segment.tone === "attention"
      ? "text-amber-700 font-semibold"
      : segment.tone === "positive"
        ? "text-emerald-700 font-semibold"
        : "text-gray-700";

  return (
    <span className="flex items-center gap-2">
      <span
        className={cn(
          "tabular-nums transition-colors duration-500",
          toneClass,
          segment.tooltip && "cursor-help underline-offset-4 decoration-dotted decoration-gray-300 hover:decoration-gray-400 hover:text-gray-900",
        )}
        title={segment.tooltip}
      >
        {segment.label}
      </span>
      {!isLast && (
        <span aria-hidden className="text-gray-300 select-none">
          ·
        </span>
      )}
    </span>
  );
}

function RecentChip({
  count,
  open,
  onClick,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Glass pill with spring scale. Ring halo lights up when there's
        // anything new — that's the ambient "something happened" signal.
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium tracking-tight",
        "bg-white/70 text-gray-700 ring-1 ring-gray-200/80",
        "transition-all duration-200 active:scale-[0.97]",
        "hover:bg-white hover:ring-gray-300 hover:shadow-sm",
        open && "bg-gray-900 text-white ring-gray-900 hover:bg-gray-800 hover:text-white",
      )}
      aria-label={`${count} recent ${count === 1 ? "change" : "changes"}`}
      aria-expanded={open}
    >
      <span className="tabular-nums">{count}</span>
      <span className="hidden sm:inline">new</span>
      <ChevronDown
        className={cn(
          "h-3 w-3 transition-transform duration-300",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

// ── Loading skeleton (exposed for SSR + first paint) ───────────────────

/**
 * Used when we have no pulse state yet (auth still resolving, space
 * data loading). Same chrome as the real bar so there's no layout
 * shift; a single shimmer hints "loading, back in a moment."
 */
export function PulseBarSkeleton() {
  return (
    <div
      className={cn(
        "sticky top-0 z-40 w-full",
        "border-b border-white/50",
        "bg-gradient-to-b from-white/85 via-white/70 to-white/55",
        "backdrop-blur-2xl backdrop-saturate-150",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_1px_0_rgba(15,23,42,0.04)]",
      )}
    >
      <div className="mx-auto flex h-12 w-full max-w-[1440px] items-center gap-3 px-6 text-[13px]">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
          <span className="text-gray-500">Loading…</span>
        </div>
      </div>
    </div>
  );
}
