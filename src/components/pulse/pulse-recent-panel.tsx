"use client";

// ── PulseRecentPanel ───────────────────────────────────────────────────
//
// Slides down from the PulseBar when the user clicks the "N new ↓"
// chip. Lists recent system activity — what agents, crons, and loops
// have been doing since the user last looked. This is the surface that
// makes the compound-improvement infrastructure visible; without it,
// everything the system does in the background is invisible.
//
// Design language (Vision Pro):
//   - Same frosted glass + blur as the PulseBar
//   - Items render as slim cards with a colored accent bar on the left
//     indicating event kind (emerald/amber/rose/indigo)
//   - Entry animation uses pulse-panel-enter (defined in globals.css)
//   - Closes on ESC, on outside click, or on the chip click again
//
// Content model — each entry:
//   { id, kind, title, detail?, at, meta? }
//
// `kind` drives the left-bar color + icon. Kept as string so callers
// can introduce new kinds without this component changing.

import { useEffect, useRef } from "react";
import {
  Activity,
  AlertTriangle,
  Sparkles,
  Zap,
  CircleCheck,
  GitBranch,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────

export type PulseEventKind =
  | "prediction_logged"    // predictor emitted a prediction
  | "prediction_resolved"  // resolver cron closed a prediction
  | "surprise"             // deviation tag: surprise or regime_shift
  | "substrategy_regen"    // sub-strategy was regenerated (incl. deviation-driven)
  | "research_finding"     // research loop added entities/edges
  | "strategy_approved"    // user committed a strategy
  | "stale_objective"      // cross-app surprise threshold tripped
  | "agent_run"            // an agent completed a cycle
  | "app_generated";       // new app materialized

export interface PulseEvent {
  id: string;
  kind: PulseEventKind;
  /** One-line headline — keep under 80 chars. */
  title: string;
  /** Optional 1-2 sentence detail. */
  detail?: string;
  /** ISO timestamp — rendered as "3m ago" etc. */
  at: string;
  /** Optional metadata for the right-side tag ("NPS · +12%" etc.). */
  meta?: string;
  /** Optional route to jump to when the event is clicked. */
  href?: string;
}

export interface PulseRecentPanelProps {
  open: boolean;
  events: PulseEvent[];
  onClose: () => void;
  onEventClick?: (event: PulseEvent) => void;
  /** Full-width of pulse bar; defaults to 1440. */
  maxWidth?: number;
}

// ── Kind → visual spec ─────────────────────────────────────────────────

interface KindSpec {
  accent: string;         // left-bar color
  iconBg: string;         // icon background
  iconColor: string;      // icon color
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

function kindSpec(kind: PulseEventKind): KindSpec {
  switch (kind) {
    case "prediction_logged":
      return {
        accent: "bg-sky-400",
        iconBg: "bg-sky-50",
        iconColor: "text-sky-700",
        icon: Activity,
        label: "Prediction",
      };
    case "prediction_resolved":
      return {
        accent: "bg-emerald-400",
        iconBg: "bg-emerald-50",
        iconColor: "text-emerald-700",
        icon: CircleCheck,
        label: "Resolved",
      };
    case "surprise":
      return {
        accent: "bg-rose-500",
        iconBg: "bg-rose-50",
        iconColor: "text-rose-700",
        icon: AlertTriangle,
        label: "Surprise",
      };
    case "substrategy_regen":
      return {
        accent: "bg-violet-400",
        iconBg: "bg-violet-50",
        iconColor: "text-violet-700",
        icon: Sparkles,
        label: "Spec refined",
      };
    case "research_finding":
      return {
        accent: "bg-indigo-400",
        iconBg: "bg-indigo-50",
        iconColor: "text-indigo-700",
        icon: GitBranch,
        label: "Research",
      };
    case "strategy_approved":
      return {
        accent: "bg-emerald-500",
        iconBg: "bg-emerald-50",
        iconColor: "text-emerald-800",
        icon: CircleCheck,
        label: "Approved",
      };
    case "stale_objective":
      return {
        accent: "bg-amber-500",
        iconBg: "bg-amber-50",
        iconColor: "text-amber-700",
        icon: AlertTriangle,
        label: "Needs review",
      };
    case "agent_run":
      return {
        accent: "bg-slate-400",
        iconBg: "bg-slate-100",
        iconColor: "text-slate-700",
        icon: Zap,
        label: "Agent",
      };
    case "app_generated":
      return {
        accent: "bg-teal-400",
        iconBg: "bg-teal-50",
        iconColor: "text-teal-700",
        icon: Sparkles,
        label: "App",
      };
  }
}

// ── Component ──────────────────────────────────────────────────────────

export function PulseRecentPanel(props: PulseRecentPanelProps) {
  const { open, events, onClose, onEventClick, maxWidth = 1440 } = props;
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on ESC. Works alongside the chevron toggle in the bar itself.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Close on click outside. We check the panel ref rather than toggling
  // a backdrop — a backdrop would dim the page which is too heavy for
  // this kind of lightweight peek surface.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) onClose();
    };
    // Small delay so the click that opened the panel doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 50);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        // Positioned below the 48px pulse bar. Sticky-style sibling —
        // the bar is z-40, we're z-40 too but rendered after so we stack.
        "sticky top-12 z-40 w-full",
        // Matched glass treatment, slightly more opaque than the bar so
        // content is readable.
        "border-b border-white/50",
        "bg-gradient-to-b from-white/92 via-white/85 to-white/78",
        "backdrop-blur-2xl backdrop-saturate-150",
        "animate-pulse-panel-enter",
      )}
      style={{ boxShadow: "0 12px 40px -12px rgba(15, 23, 42, 0.25)" }}
      role="dialog"
      aria-label="Recent activity"
    >
      <div
        className="mx-auto w-full px-6 py-3"
        style={{ maxWidth }}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">
              Recent activity
            </span>
            <span className="text-[11px] text-gray-400">
              · {events.length} {events.length === 1 ? "event" : "events"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-medium text-gray-500 hover:text-gray-900"
            aria-label="Close recent activity"
          >
            Close
          </button>
        </div>

        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-5 text-center text-[12px] text-gray-500">
            Nothing new. The system is quiet.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {events.slice(0, 12).map((event) => (
              <PulseEventRow
                key={event.id}
                event={event}
                onClick={onEventClick}
              />
            ))}
          </ul>
        )}

        {events.length > 12 && (
          <div className="mt-2 text-center text-[11px] text-gray-500">
            +{events.length - 12} earlier events —{" "}
            <span className="font-medium text-gray-700">history coming soon</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────

function PulseEventRow({
  event,
  onClick,
}: {
  event: PulseEvent;
  onClick?: (event: PulseEvent) => void;
}) {
  const spec = kindSpec(event.kind);
  const Icon = spec.icon;
  const isClickable = !!(event.href || onClick);

  const content = (
    <>
      {/* Accent bar — 2px wide, full height. The left-edge signature
          that lets users pattern-match event type at a glance without
          reading the label. */}
      <span
        aria-hidden
        className={cn("absolute left-0 top-0 h-full w-[2px] rounded-l-xl", spec.accent)}
      />
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
          spec.iconBg,
        )}
      >
        <Icon className={cn("h-3 w-3", spec.iconColor)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.06em]",
              spec.iconColor,
            )}
          >
            {spec.label}
          </span>
          <span className="ml-auto flex items-center gap-1 text-[10.5px] text-gray-400">
            <Clock className="h-2.5 w-2.5" />
            {relativeTime(event.at)}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[12.5px] font-medium text-gray-900">
          {event.title}
        </div>
        {event.detail && (
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-500">
            {event.detail}
          </div>
        )}
        {event.meta && (
          <div className="mt-1 text-[10.5px] tabular-nums text-gray-500">
            {event.meta}
          </div>
        )}
      </div>
    </>
  );

  const classes = cn(
    "relative flex items-start gap-2.5 rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 pl-4",
    "transition-all duration-200",
    isClickable && "cursor-pointer hover:bg-white hover:border-gray-300 hover:shadow-sm active:scale-[0.99]",
  );

  if (event.href) {
    return (
      <li>
        <a href={event.href} className={classes}>
          {content}
        </a>
      </li>
    );
  }
  if (onClick) {
    return (
      <li>
        <button type="button" onClick={() => onClick(event)} className={classes + " text-left w-full"}>
          {content}
        </button>
      </li>
    );
  }
  return <li className={classes}>{content}</li>;
}

// ── Helpers ────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
