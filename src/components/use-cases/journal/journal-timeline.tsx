"use client";

// ── JournalTimeline ──
// Recent entries list. Shows date, word count, extracted tensions/values/emotions
// as chips, and a click-to-expand for full text.

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Calendar } from "lucide-react";
import type { JournalEntry } from "@/types/use-case";

interface Props {
  entries: JournalEntry[];
  className?: string;
}

export function JournalTimeline({ entries, className }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className={cn("p-8 text-center text-sm text-gray-500", className)}>
        <Calendar className="h-8 w-8 mx-auto text-gray-300 mb-2" />
        No entries yet. Your first save will appear here.
      </div>
    );
  }

  return (
    <div className={cn("space-y-2 p-4", className)}>
      {entries.map((entry) => {
        const expanded = expandedId === entry.id;
        return (
          <div
            key={entry.id}
            className={cn(
              "rounded-lg border transition-colors",
              expanded ? "border-amber-300 bg-amber-50/30" : "border-gray-200 bg-white hover:border-gray-300",
            )}
          >
            <button
              onClick={() => setExpandedId(expanded ? null : entry.id)}
              className="w-full text-left p-3"
            >
              <div className="flex items-start gap-2">
                {expanded ? <ChevronDown className="h-4 w-4 text-gray-400 mt-0.5" /> : <ChevronRight className="h-4 w-4 text-gray-400 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {new Date(entry.entry_date).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="text-[10px] font-mono text-gray-400">{entry.word_count}w</span>
                  </div>

                  {/* Chip summary — most useful at a glance */}
                  {!expanded && (
                    <div className="mt-1 flex flex-wrap gap-1 items-center">
                      {entry.emotions_mentioned?.slice(0, 3).map((e) => (
                        <span key={e} className="rounded bg-blue-50 text-blue-700 px-1.5 py-[1px] text-[10px] font-medium">
                          {e}
                        </span>
                      ))}
                      {entry.tensions_detected?.slice(0, 2).map((t, i) => (
                        <span key={i} className="rounded bg-rose-50 text-rose-700 px-1.5 py-[1px] text-[10px] font-medium line-clamp-1">
                          {t.slice(0, 32)}
                        </span>
                      ))}
                      {entry.values_surfaced?.slice(0, 2).map((v) => (
                        <span key={v} className="rounded bg-emerald-50 text-emerald-700 px-1.5 py-[1px] text-[10px] font-medium">
                          {v}
                        </span>
                      ))}
                    </div>
                  )}

                  {expanded && (
                    <div className="mt-2 space-y-2">
                      <p className="text-[13px] leading-relaxed text-gray-700 whitespace-pre-wrap">{entry.text}</p>

                      <div className="pt-2 border-t border-amber-200 space-y-1.5 text-[11px]">
                        {entry.values_surfaced?.length > 0 && (
                          <div>
                            <span className="text-gray-500 font-semibold uppercase tracking-wider text-[9px]">Values</span>
                            <span className="ml-1.5 text-gray-700">{entry.values_surfaced.join(", ")}</span>
                          </div>
                        )}
                        {entry.tensions_detected?.length > 0 && (
                          <div>
                            <span className="text-gray-500 font-semibold uppercase tracking-wider text-[9px]">Tensions</span>
                            <ul className="ml-1.5 mt-0.5 space-y-0.5 list-disc list-inside">
                              {entry.tensions_detected.map((t, i) => (
                                <li key={i} className="text-rose-700">{t}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {entry.flow_activities?.length > 0 && (
                          <div>
                            <span className="text-gray-500 font-semibold uppercase tracking-wider text-[9px]">Flow</span>
                            <span className="ml-1.5 text-emerald-700">{entry.flow_activities.join(", ")}</span>
                          </div>
                        )}
                        {entry.drain_activities?.length > 0 && (
                          <div>
                            <span className="text-gray-500 font-semibold uppercase tracking-wider text-[9px]">Drain</span>
                            <span className="ml-1.5 text-amber-700">{entry.drain_activities.join(", ")}</span>
                          </div>
                        )}
                        {entry.referenced_entity_ids?.length > 0 && (
                          <div className="text-gray-500">
                            {entry.referenced_entity_ids.length} entities touched
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
