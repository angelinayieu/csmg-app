"use client";

import { cn } from "@/lib/utils";
import { X, Search, AlertTriangle, Check } from "lucide-react";
import type { Entity } from "@/types";
import type { ExternalCategory, IntelligenceSignal, SignalStatus } from "@/types/intelligence";
import { CATEGORY_CONFIG } from "@/types/intelligence";
import { BlastRadiusChip } from "@/components/intelligence/blast-radius-chip";

export function SignalItem({
  signal,
  entities,
  onAction,
  onSelectEntity,
  compact,
}: {
  signal: IntelligenceSignal;
  entities: Entity[];
  onAction?: (signalId: string, status: SignalStatus) => void;
  onSelectEntity?: (entityId: string) => void;
  compact?: boolean;
}) {
  const status = signal.status ?? "active";
  const isDismissed = status === "dismissed";
  const isResolved = status === "resolved";

  const severityColor =
    signal.severity === "high" ? "bg-red-400" :
    signal.severity === "medium" ? "bg-amber-400" : "bg-gray-300";

  const statusBadge =
    status === "escalated" ? { label: "Escalated", cls: "bg-red-50 text-red-600 border-red-200" } :
    status === "investigating" ? { label: "Investigating", cls: "bg-blue-50 text-blue-600 border-blue-200" } :
    status === "resolved" ? { label: "Resolved", cls: "bg-green-50 text-green-600 border-green-200" } :
    status === "dismissed" ? { label: "Dismissed", cls: "bg-gray-100 text-gray-400 border-gray-200" } :
    null;

  return (
    <div className={cn(
      "group relative rounded-lg bg-gray-50/70 px-2.5 py-2 transition-opacity",
      isDismissed && "opacity-40",
      isResolved && "opacity-60",
    )}>
      <div className="flex items-start gap-2">
        <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0", severityColor)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-700 truncate">{signal.entity_name}</span>
            <span className="rounded px-0.5 text-[7px] font-bold bg-gray-100 text-gray-400">{CATEGORY_CONFIG[signal.category as ExternalCategory]?.icon}</span>
            {statusBadge && (
              <span className={cn("rounded-full border px-1.5 py-px text-[7px] font-medium", statusBadge.cls)}>
                {statusBadge.label}
              </span>
            )}
          </div>
          <p className="text-[9px] leading-snug text-gray-500 line-clamp-2">{signal.description}</p>

          {/* Blast radius: related internal entities */}
          {!compact && signal.related_internal_entities.length > 0 && (
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              <span className="text-[7px] text-gray-400 uppercase tracking-wider">Blast radius:</span>
              {signal.related_internal_entities.slice(0, 5).map((eid) => (
                <BlastRadiusChip
                  key={eid}
                  entityId={eid}
                  entities={entities}
                  onSelect={onSelectEntity}
                />
              ))}
              {signal.related_internal_entities.length > 5 && (
                <span className="text-[8px] text-gray-400">
                  +{signal.related_internal_entities.length - 5} more
                </span>
              )}
            </div>
          )}

          {/* User note */}
          {signal.user_note && (
            <p className="mt-0.5 text-[8px] italic text-gray-400">Note: {signal.user_note}</p>
          )}
        </div>

        {/* Action buttons -- visible on hover/focus, always visible on touch */}
        {onAction && status !== "resolved" && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 sm:opacity-0 max-sm:opacity-100 transition-opacity flex-shrink-0">
            {status !== "dismissed" && (
              <button
                onClick={() => onAction(signal.id, "dismissed")}
                className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
                title="Dismiss signal"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            {status !== "investigating" && status !== "dismissed" && (
              <button
                onClick={() => onAction(signal.id, "investigating")}
                className="rounded p-1 text-gray-400 hover:bg-blue-100 hover:text-blue-600 transition-colors"
                title="Investigate"
              >
                <Search className="h-3 w-3" />
              </button>
            )}
            {status !== "escalated" && status !== "dismissed" && (
              <button
                onClick={() => onAction(signal.id, "escalated")}
                className="rounded p-1 text-gray-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                title="Escalate signal"
              >
                <AlertTriangle className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={() => onAction(signal.id, "resolved")}
              className="rounded p-1 text-gray-400 hover:bg-green-100 hover:text-green-600 transition-colors"
              title="Resolve signal"
            >
              <Check className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
