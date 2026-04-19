"use client";

import { CheckCircle2 } from "lucide-react";
import { DeepenChip } from "./deepen-chip";

/**
 * Accepted-proposals section — Sprint 5.
 *
 * Shows recently-accepted concepts for the canvas. Each row carries a
 * `DeepenChip` so the user can run a scoped hierarchical decomposition
 * on demand. The chip expands inline to reveal the sub-concepts,
 * matching the "Deepen" affordance from the sprint plan.
 */

interface AcceptedRow {
  proposal_id: string;
  entity_id: string;
  entity_name: string;
  entity_space_name: string | null;
  anchored_text: string | null;
  resolved_at: string | null;
}

export function AcceptedSection({
  accepted,
}: {
  accepted: AcceptedRow[];
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Accepted — last 30 days
        </h2>
        <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
          {accepted.length}
        </span>
      </div>

      <div className="space-y-2">
        {accepted.map((a) => (
          <div
            key={a.proposal_id}
            className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[13px] font-semibold text-gray-900">
                    {a.entity_name}
                  </span>
                  {a.entity_space_name && (
                    <span className="truncate text-[11px] text-gray-500">
                      in {a.entity_space_name}
                    </span>
                  )}
                </div>
                {a.anchored_text && (
                  <p className="mt-1 line-clamp-2 rounded border-l-2 border-green-300 bg-green-50/50 px-2 py-1 text-[12px] italic text-gray-700">
                    “{a.anchored_text}”
                  </p>
                )}
                <DeepenChip
                  entityId={a.entity_id}
                  entityName={a.entity_name}
                />
              </div>
              {a.resolved_at && (
                <span
                  className="flex-shrink-0 text-[10px] text-gray-400"
                  title={new Date(a.resolved_at).toLocaleString()}
                >
                  {timeAgo(a.resolved_at)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
