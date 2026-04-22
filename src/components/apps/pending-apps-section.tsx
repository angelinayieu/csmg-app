"use client";

// ── Pending-apps dashboard section (MVP conversational approval) ──
//
// Surfaces apps that were generated for a strategy the user hasn't yet
// confirmed, or apps that were created after the most recent confirmation
// (indicating a newer unconfirmed strategy exists).
//
// The /api/apps endpoint returns `approval_state: "approved" | "pending" | "legacy"`.
// This component filters + renders only "pending" entries in a compact,
// Apple-Vision-Pro-style glass panel above the main apps grid.
//
// Visual: soft amber accent (awaiting), minimal typography, no decoration on
// already-approved items. Clicking "Approve strategy" routes to the strategy
// review surface.

import React from "react";
import { cn } from "@/lib/utils";
import { Clock, Sparkles, ChevronRight } from "lucide-react";

interface PendingApp {
  id: string;
  name: string;
  description?: string | null;
  app_type?: string;
  approval_state?: "approved" | "pending" | "legacy";
  intervention_count?: number;
  priority?: number;
}

interface Props {
  apps: PendingApp[];
  spaceId: string;
  strategyStatus: string | null;
  /** Called when user clicks "Approve strategy" — parent should route to the strategy review UI */
  onApproveClick?: () => void;
  className?: string;
}

export function PendingAppsSection({ apps, spaceId, strategyStatus, onApproveClick, className }: Props) {
  const pending = apps.filter((a) => a.approval_state === "pending");
  if (pending.length === 0) return null;

  const reviewHref = `/app/space/${spaceId}/strategy`;

  return (
    <section
      className={cn(
        "rounded-2xl border border-amber-200/60 bg-gradient-to-br from-amber-50/40 to-white/60 backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div className="px-5 py-3.5 flex items-center justify-between gap-3 border-b border-amber-100/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Clock className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-amber-900">
              Awaiting strategy approval
            </div>
            <div className="text-[10.5px] text-amber-700/80 leading-tight">
              {pending.length} app{pending.length === 1 ? "" : "s"} generated from a proposed strategy. Review and confirm to activate.
            </div>
          </div>
        </div>
        {strategyStatus && strategyStatus !== "confirmed" && (
          <button
            type="button"
            onClick={onApproveClick}
            className="inline-flex items-center gap-1 rounded-full bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 text-[11px] font-semibold transition-colors shrink-0"
            {...(onApproveClick ? {} : { "data-href": reviewHref })}
          >
            <Sparkles className="h-3 w-3" />
            Review strategy
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Pending apps list — compact rows, not full cards */}
      <div className="divide-y divide-amber-100/50">
        {pending.slice(0, 8).map((app) => (
          <div
            key={app.id}
            className="px-5 py-2.5 flex items-center gap-3 opacity-80 hover:opacity-100 transition-opacity"
          >
            <span className="rounded-full bg-white/70 ring-1 ring-amber-200 px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-wide text-amber-700 shrink-0">
              {app.app_type ?? "app"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-gray-800 truncate">
                {app.name}
              </div>
              {app.description && (
                <div className="text-[11px] text-gray-500 truncate leading-tight">
                  {app.description}
                </div>
              )}
            </div>
            {typeof app.intervention_count === "number" && app.intervention_count > 0 && (
              <span className="text-[10px] tabular-nums text-amber-700 shrink-0">
                {app.intervention_count} tactic{app.intervention_count === 1 ? "" : "s"}
              </span>
            )}
            <span className="rounded-full bg-amber-50 ring-1 ring-amber-200 px-1.5 py-[2px] text-[9px] font-medium text-amber-700 shrink-0">
              pending
            </span>
          </div>
        ))}
        {pending.length > 8 && (
          <div className="px-5 py-2 text-[10.5px] text-amber-700/70 italic">
            +{pending.length - 8} more awaiting approval
          </div>
        )}
      </div>
    </section>
  );
}
