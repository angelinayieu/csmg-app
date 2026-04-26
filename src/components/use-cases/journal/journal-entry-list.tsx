"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Search, PenLine, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JournalEntry } from "@/types/use-case";

interface Props {
  entries: JournalEntry[];
  selectedId: string | null;
  writingMode: boolean;
  onSelect: (entry: JournalEntry) => void;
  onNew: () => void;
}

function entryDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)
    return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function entryPreview(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 72 ? trimmed.slice(0, 72) + "…" : trimmed;
}

export function JournalEntryList({
  entries,
  selectedId,
  writingMode,
  onSelect,
  onNew,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? entries.filter(
        (e) =>
          e.text.toLowerCase().includes(query.toLowerCase()) ||
          (e.values_surfaced ?? []).some((v) =>
            v.toLowerCase().includes(query.toLowerCase()),
          ) ||
          (e.emotions_mentioned ?? []).some((em) =>
            em.toLowerCase().includes(query.toLowerCase()),
          ),
      )
    : entries;

  const handleNew = useCallback(() => {
    setQuery("");
    onNew();
  }, [onNew]);

  return (
    <aside className="flex w-[258px] flex-shrink-0 flex-col border-r border-[#E8E3DC] bg-[#F5F4F0]">
      {/* New entry button */}
      <div className="px-3 pt-4 pb-3">
        <button
          onClick={handleNew}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold transition-all duration-200",
            writingMode
              ? "bg-amber-500 text-white shadow-[0_4px_12px_-4px_rgba(217,119,6,0.5)]"
              : "bg-amber-400/90 text-white shadow-[0_2px_8px_-4px_rgba(217,119,6,0.4)] hover:bg-amber-500 hover:shadow-[0_4px_12px_-4px_rgba(217,119,6,0.5)]",
          )}
        >
          <PenLine className="h-3.5 w-3.5 shrink-0" />
          New entry
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg bg-[#ECEAE5] px-2.5 py-2">
          <Search className="h-3 w-3 shrink-0 text-[#AEAEB2]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entries…"
            className="flex-1 bg-transparent text-[12px] text-[#1C1C1E] placeholder:text-[#AEAEB2] focus:outline-none"
          />
        </div>
      </div>

      {/* Entry count */}
      <div className="px-4 pb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#AEAEB2]">
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 pt-12 text-center">
            <Calendar className="h-8 w-8 text-[#D0CCC6]" />
            <p className="text-[12px] text-[#AEAEB2]">
              {query ? "No entries match your search." : "Your first entry will appear here."}
            </p>
          </div>
        )}

        {filtered.map((entry) => {
          const active = !writingMode && selectedId === entry.id;
          return (
            <motion.button
              key={entry.id}
              onClick={() => onSelect(entry)}
              layout
              className={cn(
                "group w-full px-4 py-3 text-left transition-colors duration-150",
                active
                  ? "bg-amber-100/80 border-l-[2.5px] border-amber-400"
                  : "border-l-[2.5px] border-transparent hover:bg-[#ECEAE5]",
              )}
            >
              {/* Date */}
              <p
                className={cn(
                  "text-[12px] font-semibold",
                  active ? "text-amber-800" : "text-[#1C1C1E]",
                )}
              >
                {entryDateLabel(entry.entry_date)}
                <span className="ml-1.5 text-[10px] font-normal text-[#AEAEB2]">
                  {entry.word_count}w
                </span>
              </p>

              {/* Preview text */}
              <p
                className={cn(
                  "mt-0.5 text-[11.5px] leading-snug",
                  active ? "text-amber-700" : "text-[#6C6C70]",
                )}
              >
                {entryPreview(entry.text)}
              </p>

              {/* Chips */}
              {(entry.emotions_mentioned?.length > 0 ||
                entry.values_surfaced?.length > 0 ||
                entry.tensions_detected?.length > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(entry.emotions_mentioned ?? []).slice(0, 2).map((em) => (
                    <span
                      key={em}
                      className="rounded-full bg-blue-100/70 px-1.5 py-[1px] text-[9.5px] font-medium text-blue-700"
                    >
                      {em}
                    </span>
                  ))}
                  {(entry.values_surfaced ?? []).slice(0, 1).map((v) => (
                    <span
                      key={v}
                      className="rounded-full bg-emerald-100/70 px-1.5 py-[1px] text-[9.5px] font-medium text-emerald-700"
                    >
                      {v}
                    </span>
                  ))}
                  {(entry.tensions_detected ?? []).length > 0 && (
                    <span className="rounded-full bg-rose-100/70 px-1.5 py-[1px] text-[9.5px] font-medium text-rose-700">
                      tension
                    </span>
                  )}
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </aside>
  );
}
