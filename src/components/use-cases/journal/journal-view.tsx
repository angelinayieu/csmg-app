"use client";

// ── JournalView ──
// Container for the journal surface: entry form + timeline side panel.

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Layers } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { JournalEntryForm } from "./journal-entry-form";
import { JournalTimeline } from "./journal-timeline";
import { ProposedActionsPanel } from "@/components/intelligence/proposed-actions-panel";
import type { JournalEntry } from "@/types/use-case";

export function JournalView() {
  const ctx = useSpaceData();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [nextPrompt, setNextPrompt] = useState<string | null>(null);
  // Increments whenever a new entry is saved — signals ProposedActionsPanel to re-fetch
  const [proposalRefreshNonce, setProposalRefreshNonce] = useState(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const templateId = (ctx.space as any).use_case_template_id ?? "journal_self_discovery";

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch(`/api/journal/entry?space_id=${ctx.space.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { entries: JournalEntry[] };
      setEntries(json.entries);
      // Set nextPrompt from most recent entry (if any)
      if (json.entries.length > 0 && json.entries[0].next_prompt) {
        setNextPrompt(json.entries[0].next_prompt);
      }
    } catch (err) {
      console.warn("[JournalView] Load entries failed:", err);
    } finally {
      setLoadingEntries(false);
    }
  }, [ctx.space.id]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const onSaved = useCallback(
    async (summary: { nextPrompt?: string | null; entryText?: string }) => {
      if (summary.nextPrompt) setNextPrompt(summary.nextPrompt);
      loadEntries();
      ctx.refresh();

      // Fire the intelligence router on the new entry so proposals (critique,
      // synthesis refresh, new objectives, etc.) appear for the user.
      if (summary.entryText) {
        try {
          await fetch("/api/intelligence/route", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              space_id: ctx.space.id,
              text: summary.entryText,
              source: "journal_entry",
              context: {
                use_case_template_id:
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (ctx.space as any).use_case_template_id ?? "journal_self_discovery",
              },
            }),
          });
          // Trigger proposal panel reload
          setProposalRefreshNonce((n) => n + 1);
        } catch (err) {
          console.warn("[JournalView] Intelligence router call failed:", err);
        }
      }
    },
    [loadEntries, ctx],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white/85 backdrop-blur-sm px-5 py-3 z-10">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <Link href={`/app/use-cases`} className="inline-flex items-center gap-1 hover:text-gray-700">
            <ArrowLeft className="h-3 w-3" />
            Use cases
          </Link>
          <span>/</span>
          <Link href={`/app/space/${ctx.space.id}/graph`} className="hover:text-gray-700">
            {ctx.space.name}
          </Link>
          <span>/</span>
          <span className="font-semibold text-gray-900 inline-flex items-center gap-1.5">
            <BookOpen className="h-3 w-3" />
            Journal
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-600">
          <Link
            href={`/app/space/${ctx.space.id}/whiteboard`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-300"
            title="View the graph of what you've written"
          >
            <Layers className="h-3 w-3" />
            Graph view
          </Link>
        </div>
      </div>

      {/* Split layout — form on left, timeline on right */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 border-r border-gray-200 bg-gradient-to-br from-amber-50/30 to-white">
          <JournalEntryForm
            spaceId={ctx.space.id}
            templateId={templateId}
            nextPrompt={nextPrompt}
            recentEntryCount={entries.length}
            onSaved={onSaved}
          />
        </div>
        <div className="w-[340px] flex-shrink-0 flex flex-col bg-white/60 border-l border-gray-200">
          {/* Proposed actions — top of sidebar so users see them */}
          <ProposedActionsPanel spaceId={ctx.space.id} refreshNonce={proposalRefreshNonce} />

          {/* Recent entries */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden border-t border-gray-200">
            <div className="px-5 py-3 border-b border-gray-100">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                Recent entries
              </div>
              <div className="mt-0.5 text-sm font-semibold text-gray-900">
                {loadingEntries ? "Loading…" : `${entries.length} entries`}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <JournalTimeline entries={entries} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
