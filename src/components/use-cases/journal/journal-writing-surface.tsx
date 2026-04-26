"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, X, Command } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTemplate } from "@/lib/use-cases/library";

interface Props {
  spaceId: string;
  templateId: string;
  nextPrompt: string | null;
  recentEntryCount: number;
  text: string;
  onTextChange: (text: string) => void;
  onSaved: (summary: {
    entryId?: string;
    newEntities: number;
    mergedIntoExisting: number;
    edgesAdded: number;
    nextPrompt?: string | null;
    entryText?: string;
  }) => void;
}

function todayHeader(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function JournalWritingSurface({
  spaceId,
  templateId,
  nextPrompt,
  recentEntryCount,
  text,
  onTextChange,
  onSaved,
}: Props) {
  const template = getTemplate(templateId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<{
    newEntities: number;
    mergedIntoExisting: number;
    edgesAdded: number;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus the textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    const trimmed = text.trim();
    if (trimmed.length < 20) {
      setError("Write at least a couple of sentences before saving.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSavedBanner(null);

    try {
      const res = await fetch("/api/journal/entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          space_id: spaceId,
          entry_date: new Date().toISOString().slice(0, 10),
          text: trimmed,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; hint?: string };
        throw new Error((err.error ?? `HTTP ${res.status}`) + (err.hint ? ` — ${err.hint}` : ""));
      }

      const json = await res.json() as {
        entry: { id: string };
        stats: { new_entities: number; merged_into_existing: number; edges_added: number };
        next_prompt?: string | null;
      };

      setSavedBanner({
        newEntities: json.stats.new_entities,
        mergedIntoExisting: json.stats.merged_into_existing,
        edgesAdded: json.stats.edges_added,
      });

      onSaved({
        entryId: json.entry.id,
        newEntities: json.stats.new_entities,
        mergedIntoExisting: json.stats.merged_into_existing,
        edgesAdded: json.stats.edges_added,
        nextPrompt: json.next_prompt,
        entryText: trimmed,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry.");
    } finally {
      setSubmitting(false);
    }
  }, [spaceId, text, submitting, onSaved]);

  // Cmd+Enter / Ctrl+Enter to save
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const wc = wordCount(text);
  const canSave = wc >= 5 && !submitting;
  const displayedPrompt = nextPrompt;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Writing area */}
      <div className="flex flex-1 min-h-0 flex-col px-12 pt-10 pb-4">
        {/* Date header */}
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#1C1C1E] select-none">
          {todayHeader()}
        </h1>

        {/* Prompt — shown when there's a follow-up from last entry */}
        {displayedPrompt && (
          <p className="mt-2 text-[14px] leading-relaxed text-[#8E8880] italic">
            {displayedPrompt}
          </p>
        )}

        {/* Divider */}
        <div className="my-5 h-px bg-[#F0EDE8]" />

        {/* Textarea — pure, no chrome */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            onTextChange(e.target.value);
            setSavedBanner(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            recentEntryCount === 0
              ? "What's on your mind today?"
              : "Start writing…"
          }
          disabled={submitting}
          className={cn(
            "flex-1 w-full resize-none bg-transparent",
            "text-[16.5px] leading-[1.85] text-[#1C1C1E] placeholder:text-[#C7C3BC]",
            "focus:outline-none",
            submitting && "opacity-60",
          )}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-12 mb-3 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12.5px] text-rose-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="ml-3 text-rose-400 hover:text-rose-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Saved banner */}
      {savedBanner && !error && (
        <div className="mx-12 mb-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12.5px] text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-semibold">Saved.</span>
              {savedBanner.newEntities > 0 && (
                <span className="ml-1 text-emerald-700">
                  {savedBanner.newEntities} new concepts
                </span>
              )}
              {savedBanner.mergedIntoExisting > 0 && (
                <span className="ml-1 text-emerald-600">
                  · {savedBanner.mergedIntoExisting} merged
                </span>
              )}
              {savedBanner.edgesAdded > 0 && (
                <span className="ml-1 text-emerald-600">
                  · {savedBanner.edgesAdded} connections
                </span>
              )}
            </span>
          </div>
          <button
            onClick={() => setSavedBanner(null)}
            className="ml-3 text-emerald-400 hover:text-emerald-700"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Footer bar */}
      <div className="flex items-center justify-between border-t border-[#F0EDE8] bg-white px-12 py-3">
        <div className="flex items-center gap-3 text-[11.5px] text-[#AEAEB2]">
          <span>{wc > 0 ? `${wc} words` : "Start writing…"}</span>
          <span className="hidden items-center gap-1 text-[10.5px] sm:flex">
            <Command className="h-2.5 w-2.5" />
            <span>↵ to save</span>
          </span>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSave}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-all duration-200",
            canSave
              ? "bg-[#1C1C1E] text-white shadow-[0_2px_8px_-4px_rgba(0,0,0,0.35)] hover:shadow-[0_4px_14px_-4px_rgba(0,0,0,0.45)]"
              : "cursor-not-allowed bg-[#F0EDE8] text-[#C7C3BC]",
          )}
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting ? "Saving…" : "Save entry"}
        </button>
      </div>
    </div>
  );
}
