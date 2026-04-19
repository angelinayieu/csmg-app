"use client";

/**
 * PulseTile — one row in the Studio model index.
 *
 * The returning-user surface. Each tile represents a living knowledge model
 * (what the schema calls a "space") and surfaces exactly three things:
 *
 *   1. A pulse dot (green/amber/gray) communicating the model's state at a
 *      glance: fresh activity / stuck on pending work / quiet.
 *   2. A single-sentence headline — "3 new edges in the last 24h",
 *      "2 proposals awaiting review", "Quiet — last touched 3d ago".
 *   3. On hover: a lightweight breakdown panel with the specific deltas and
 *      one-click targets into the model at the right spot.
 *
 * Click the tile body → enter the model (the space dashboard).
 * Click the headline metric on hover → deep-link to the specific surface.
 *
 * Philosophy: the tile should read like a well-designed notification —
 * answer "do I need to engage?" in under a second.
 */

import Link from "next/link";
import { useState } from "react";
import {
  Sparkles,
  AlertTriangle,
  Moon,
  MessageCircleQuestion,
  Inbox,
  GitCommit,
  Boxes,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SpacePulse } from "@/app/api/spaces/pulse/route";

interface PulseTileProps {
  pulse: SpacePulse;
}

const PULSE_STYLES: Record<
  SpacePulse["pulse"],
  {
    ring: string;
    dot: string;
    label: string;
    labelColor: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  fresh: {
    ring: "ring-1 ring-emerald-200/70 hover:ring-emerald-300",
    dot: "bg-emerald-500",
    label: "Fresh",
    labelColor: "text-emerald-700",
    icon: Sparkles,
  },
  stuck: {
    ring: "ring-1 ring-amber-200/70 hover:ring-amber-300",
    dot: "bg-amber-500",
    label: "Needs you",
    labelColor: "text-amber-700",
    icon: AlertTriangle,
  },
  quiet: {
    ring: "ring-1 ring-gray-200/60 hover:ring-gray-300",
    dot: "bg-gray-300",
    label: "Quiet",
    labelColor: "text-gray-500",
    icon: Moon,
  },
};

export function PulseTile({ pulse }: PulseTileProps) {
  const [hovering, setHovering] = useState(false);
  const styles = PULSE_STYLES[pulse.pulse];
  const StatusIcon = styles.icon;

  const hasDetails =
    pulse.new_edges_24h > 0 ||
    pulse.new_proposals_pending > 0 ||
    pulse.open_questions > 0 ||
    pulse.unresolved_cycles > 0;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Link
        href={`/app/space/${pulse.space_id}`}
        className={cn(
          "group relative block rounded-xl bg-white/70 backdrop-blur-sm px-4 py-3 transition-all duration-200",
          "hover:bg-white/95 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(0,40,120,0.15)]",
          styles.ring,
        )}
      >
        {/* Top row: pulse dot + status label + name */}
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            {pulse.pulse === "fresh" && (
              <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", styles.dot)} />
            )}
            <span className={cn("relative inline-flex h-2 w-2 rounded-full", styles.dot)} />
          </span>
          <span className={cn("text-[9px] font-bold uppercase tracking-[0.14em]", styles.labelColor)}>
            {styles.label}
          </span>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-400 tabular-nums">
            <Boxes className="h-3 w-3" />
            {pulse.entity_count}
          </span>
        </div>

        {/* Name */}
        <h3
          className="mt-1.5 truncate text-[15px] font-semibold leading-tight text-gray-900 group-hover:text-interaxis-700"
          style={{ letterSpacing: "-0.015em" }}
          title={pulse.name}
        >
          {pulse.name}
        </h3>

        {/* Headline */}
        <div className="mt-1 flex items-center gap-1.5">
          <StatusIcon className={cn("h-3 w-3 shrink-0", styles.labelColor)} />
          <p className="truncate text-[11.5px] text-gray-600">{pulse.headline}</p>
        </div>
      </Link>

      {/* Hover detail panel — absolute-positioned below the tile.
          Only renders when there are specific deltas worth breaking out. */}
      {hovering && hasDetails && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-gray-200/70 bg-white/95 backdrop-blur-md p-2 shadow-[0_12px_32px_-16px_rgba(0,40,120,0.25)]"
          style={{ animation: "pulseTileReveal 140ms ease-out" }}
        >
          <ul className="space-y-1">
            {pulse.new_edges_24h > 0 && (
              <DetailRow
                icon={<GitCommit className="h-3 w-3 text-emerald-600" />}
                label={`${pulse.new_edges_24h} new ${pulse.new_edges_24h === 1 ? "edge" : "edges"}`}
                hint="past 24h"
                href={`/app/space/${pulse.space_id}/intelligence`}
              />
            )}
            {pulse.new_proposals_pending > 0 && (
              <DetailRow
                icon={<Inbox className="h-3 w-3 text-purple-600" />}
                label={`${pulse.new_proposals_pending} awaiting review`}
                hint="proposed edges"
                href={`/app/space/${pulse.space_id}/intelligence`}
              />
            )}
            {pulse.open_questions > 0 && (
              <DetailRow
                icon={<MessageCircleQuestion className="h-3 w-3 text-blue-600" />}
                label={`${pulse.open_questions} open ${pulse.open_questions === 1 ? "question" : "questions"}`}
                hint="routing prospector"
                href={`/app/space/${pulse.space_id}/intelligence`}
              />
            )}
            {pulse.unresolved_cycles > 0 && (
              <DetailRow
                icon={<AlertTriangle className="h-3 w-3 text-amber-600" />}
                label={`${pulse.unresolved_cycles} ${pulse.unresolved_cycles === 1 ? "cycle" : "cycles"}`}
                hint="unresolved"
                href={`/app/space/${pulse.space_id}`}
              />
            )}
          </ul>
        </div>
      )}
      <style jsx>{`
        @keyframes pulseTileReveal {
          from { opacity: 0; transform: translateY(-2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  hint,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-gray-50"
      >
        {icon}
        <span className="font-semibold text-gray-800">{label}</span>
        <span className="text-gray-400">· {hint}</span>
        <ArrowUpRight className="ml-auto h-3 w-3 text-gray-300 transition-colors group-hover:text-interaxis-600" />
      </Link>
    </li>
  );
}
