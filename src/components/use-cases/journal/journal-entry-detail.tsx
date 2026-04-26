"use client";

import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JournalEntry } from "@/types/use-case";

interface Props {
  entry: JournalEntry;
  onBack?: () => void;
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

interface ChipGroupProps {
  label: string;
  items: string[];
  colorClass: string;
}

function ChipGroup({ label, items, colorClass }: ChipGroupProps) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#AEAEB2]">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className={cn(
              "rounded-full px-2.5 py-[3px] text-[11px] font-medium",
              colorClass,
            )}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function JournalEntryDetail({ entry, onBack }: Props) {
  const hasMetadata =
    (entry.emotions_mentioned?.length ?? 0) > 0 ||
    (entry.values_surfaced?.length ?? 0) > 0 ||
    (entry.tensions_detected?.length ?? 0) > 0 ||
    (entry.flow_activities?.length ?? 0) > 0 ||
    (entry.drain_activities?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      {/* Back affordance */}
      {onBack && (
        <div className="px-12 pt-6 pb-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-[11.5px] text-[#AEAEB2] hover:text-[#6C6C70] transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
        </div>
      )}

      {/* Date */}
      <div className="px-12 pt-6">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-[#1C1C1E]">
          {formatFullDate(entry.entry_date)}
        </h1>
        <p className="mt-1 text-[11.5px] text-[#AEAEB2]">
          {entry.word_count} words
        </p>
      </div>

      <div className="my-5 mx-12 h-px bg-[#F0EDE8]" />

      {/* Entry text */}
      <div className="px-12 pb-8">
        <p className="whitespace-pre-wrap text-[16px] leading-[1.85] text-[#1C1C1E]">
          {entry.text}
        </p>
      </div>

      {/* Extracted metadata */}
      {hasMetadata && (
        <>
          <div className="mx-12 h-px bg-[#F0EDE8]" />
          <div className="px-12 py-8 space-y-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#C7C3BC]">
              What was surfaced
            </p>

            <ChipGroup
              label="Emotions"
              items={entry.emotions_mentioned ?? []}
              colorClass="bg-blue-50 text-blue-700"
            />
            <ChipGroup
              label="Values"
              items={entry.values_surfaced ?? []}
              colorClass="bg-emerald-50 text-emerald-700"
            />
            <ChipGroup
              label="Flow activities"
              items={entry.flow_activities ?? []}
              colorClass="bg-violet-50 text-violet-700"
            />
            <ChipGroup
              label="Drain activities"
              items={entry.drain_activities ?? []}
              colorClass="bg-amber-50 text-amber-700"
            />

            {/* Tensions as a list (they're longer strings) */}
            {(entry.tensions_detected?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#AEAEB2]">
                  Tensions
                </p>
                <ul className="space-y-1">
                  {(entry.tensions_detected ?? []).map((t, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-[12.5px] text-rose-700 leading-relaxed"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-300" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      {/* Next prompt */}
      {entry.next_prompt && (
        <div className="mx-12 mb-10 rounded-xl border border-[#EDE8E1] bg-[#FAFAF7] px-5 py-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#C7C3BC] mb-2">
            For next time
          </p>
          <p className="text-[13.5px] leading-relaxed text-[#5C5852] italic">
            &ldquo;{entry.next_prompt}&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}
