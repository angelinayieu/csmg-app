"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { JournalEntryList } from "./journal-entry-list";
import { JournalWritingSurface } from "./journal-writing-surface";
import { JournalEntryDetail } from "./journal-entry-detail";
import { JournalAiRail } from "./journal-ai-rail";
import type { JournalEntry } from "@/types/use-case";

const EASE = [0.22, 1, 0.36, 1] as const;

export function JournalView() {
  const ctx = useSpaceData();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const templateId = (ctx.space as any).use_case_template_id ?? "journal_self_discovery";

  // ── Entries ──
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [nextPrompt, setNextPrompt] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch(`/api/journal/entry?space_id=${ctx.space.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { entries: JournalEntry[] };
      setEntries(json.entries);
      if (json.entries.length > 0 && json.entries[0].next_prompt) {
        setNextPrompt(json.entries[0].next_prompt);
      }
    } catch (err) {
      console.warn("[JournalView] Load entries failed:", err);
    } finally {
      setLoadingEntries(false);
    }
  }, [ctx.space.id]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // ── Navigation state ──
  type Mode = "write" | "read";
  const [mode, setMode] = useState<Mode>("write");
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  // Lifted draft text so the AI rail can read it without prop-drilling through the surface
  const [draftText, setDraftText] = useState("");

  const handleNewEntry = useCallback(() => {
    setMode("write");
    setSelectedEntry(null);
    setDraftText("");
  }, []);

  const handleSelectEntry = useCallback((entry: JournalEntry) => {
    setSelectedEntry(entry);
    setMode("read");
  }, []);

  const handleSaved = useCallback(
    async (summary: {
      entryId?: string;
      newEntities: number;
      mergedIntoExisting: number;
      edgesAdded: number;
      nextPrompt?: string | null;
      entryText?: string;
    }) => {
      if (summary.nextPrompt) setNextPrompt(summary.nextPrompt);
      // Clear draft + switch to read mode showing the new entry
      setDraftText("");
      await loadEntries();
      ctx.refresh();

      // Fire intelligence router
      if (summary.entryText) {
        fetch("/api/intelligence/route", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            space_id: ctx.space.id,
            text: summary.entryText,
            source: "journal_entry",
            context: { use_case_template_id: templateId },
          }),
        }).catch(() => {});
      }
    },
    [loadEntries, ctx, templateId],
  );

  // After a save, show the latest entry in read mode
  useEffect(() => {
    if (draftText === "" && mode === "write" && entries.length > 0) {
      // Only auto-switch to read if we had content before (i.e. just saved)
      // Don't auto-switch on initial load when user wants to write
    }
  }, [entries, draftText, mode]);

  return (
    <div className="flex h-full flex-col" style={{ background: "#FFFEF9" }}>
      {/* Topbar — minimal Apple Notes style */}
      <div
        className="flex h-11 flex-shrink-0 items-center justify-between border-b px-5"
        style={{ borderColor: "#E8E3DC", background: "#F5F4F0" }}
      >
        <div className="flex items-center gap-2 text-[12px] text-[#6C6C70]">
          <BookOpen className="h-3.5 w-3.5 text-amber-500" />
          <span className="font-semibold text-[#1C1C1E]">{ctx.space.name}</span>
          <span className="text-[#C7C3BC]">/</span>
          <span>Journal</span>
        </div>

        {loadingEntries && (
          <span className="text-[11px] text-[#AEAEB2]">Loading…</span>
        )}
      </div>

      {/* Three-panel body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left — entry list */}
        <JournalEntryList
          entries={entries}
          selectedId={selectedEntry?.id ?? null}
          writingMode={mode === "write"}
          onSelect={handleSelectEntry}
          onNew={handleNewEntry}
        />

        {/* Center — writing surface or entry detail */}
        <div className="relative flex flex-1 min-w-0 min-h-0 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {mode === "write" ? (
              <motion.div
                key="write"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="absolute inset-0 flex flex-col"
              >
                <JournalWritingSurface
                  spaceId={ctx.space.id}
                  templateId={templateId}
                  nextPrompt={nextPrompt}
                  recentEntryCount={entries.length}
                  text={draftText}
                  onTextChange={setDraftText}
                  onSaved={handleSaved}
                />
              </motion.div>
            ) : (
              <motion.div
                key={selectedEntry?.id ?? "detail"}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="absolute inset-0 overflow-y-auto"
              >
                {selectedEntry ? (
                  <JournalEntryDetail
                    entry={selectedEntry}
                    onBack={handleNewEntry}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center space-y-2">
                      <BookOpen className="mx-auto h-10 w-10 text-[#D0CCC6]" />
                      <p className="text-[13px] text-[#AEAEB2]">
                        Select an entry or start a new one.
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right — AI rail (write mode only, slides in after 80 chars) */}
        <AnimatePresence>
          {mode === "write" && (
            <JournalAiRail
              spaceId={ctx.space.id}
              text={draftText}
              entries={entries}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
