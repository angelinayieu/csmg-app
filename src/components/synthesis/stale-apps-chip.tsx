"use client";

/**
 * Wave D L4.2 — StaleAppsChip.
 *
 * Compact live chip rendered at the top of the Synthesis view. Signals
 * "your plan's assumptions have drifted — N apps are flagged stale".
 * Rendered empty (returns null) when no apps are stale, so a quiet
 * synthesis surface stays quiet.
 *
 * Click → routes to the first stale app (most useful default), or
 * expands an inline list when there are multiple. Keeps the user one
 * click from the source of the drift.
 */

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useRealtimeAppStale } from "@/lib/hooks/use-realtime-app-stale";
import { cn } from "@/lib/utils";

export interface StaleAppsChipProps {
  spaceId: string;
  className?: string;
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 26 };

export function StaleAppsChip({ spaceId, className }: StaleAppsChipProps) {
  const { staleApps, loading } = useRealtimeAppStale(spaceId);
  const [expanded, setExpanded] = useState(false);

  if (loading || staleApps.length === 0) return null;

  const firstApp = staleApps[0];
  const hasMultiple = staleApps.length > 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={SPRING}
        className={cn("w-full", className)}
      >
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => hasMultiple && setExpanded((v) => !v)}
            className="flex w-full items-center gap-2.5 text-left"
            aria-expanded={hasMultiple ? expanded : undefined}
          >
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
              <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-amber-900">
                {staleApps.length} {staleApps.length === 1 ? "app" : "apps"} flagged stale
              </p>
              <p className="truncate text-[11px] text-amber-800/80">
                Plan assumptions may have drifted — review{" "}
                {hasMultiple ? "below" : firstApp.name ?? "the flagged app"}.
              </p>
            </div>
            {hasMultiple ? (
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 flex-shrink-0 text-amber-700 transition-transform",
                  expanded && "rotate-180",
                )}
              />
            ) : (
              <Link
                href={`/app/space/${spaceId}/app/${firstApp.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 transition hover:bg-amber-200"
              >
                Review
                <ChevronRight className="h-3 w-3" />
              </Link>
            )}
          </button>

          <AnimatePresence initial={false}>
            {hasMultiple && expanded && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={SPRING}
                className="mt-2 space-y-1 overflow-hidden border-t border-amber-200/80 pt-2"
              >
                {staleApps.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/app/space/${spaceId}/app/${a.id}`}
                      className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[11px] text-amber-900 transition hover:bg-amber-100/60"
                    >
                      <span className="truncate">
                        {a.name ?? "(unnamed app)"}
                        {a.stale_reason && (
                          <span className="ml-1.5 text-amber-700/70">
                            · {humanizeReason(a.stale_reason)}
                          </span>
                        )}
                      </span>
                      <ChevronRight className="h-3 w-3 flex-shrink-0 text-amber-600" />
                    </Link>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function humanizeReason(reason: string): string {
  // stale_reason values are snake_case enums ('new_research',
  // 'metric_drift', 'whiteboard_edit'). Make them scannable.
  return reason
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
