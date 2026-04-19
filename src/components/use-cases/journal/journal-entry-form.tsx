"use client";

// ── JournalEntryForm ──
//
// The "write your entry" surface. Shows a suggested prompt at the top
// (rotated from the template's question library), a large textarea, and a
// submit button. On submit, calls /api/journal/entry and surfaces a
// summary of what was extracted.

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, Sparkles, RefreshCw, AlertTriangle, X } from "lucide-react";
import { getTemplate } from "@/lib/use-cases/library";
import type { UseCaseTemplate, TemplateQuestion } from "@/types/use-case";

interface Props {
  spaceId: string;
  templateId: string;
  nextPrompt?: string | null;         // LLM-generated from previous entry
  recentEntryCount: number;
  onSaved?: (summary: {
    entryId?: string;
    newEntities: number;
    mergedIntoExisting: number;
    edgesAdded: number;
    nextPrompt?: string | null;
    entryText?: string;
  }) => void;
}

function pickOpenerQuestion(template: UseCaseTemplate): TemplateQuestion | null {
  const openers = template.question_library.filter((q) => q.kind === "opener");
  if (openers.length === 0) return null;
  return openers[Math.floor(Math.random() * openers.length)];
}

export function JournalEntryForm({ spaceId, templateId, nextPrompt, recentEntryCount, onSaved }: Props) {
  const template = getTemplate(templateId);
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState<TemplateQuestion | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<{
    newEntities: number;
    mergedIntoExisting: number;
    edgesAdded: number;
  } | null>(null);

  // Pick an opener on mount + when recentEntryCount changes (e.g. after save)
  useEffect(() => {
    if (!template) return;
    setPrompt(pickOpenerQuestion(template));
  }, [template, recentEntryCount]);

  const handleRefreshPrompt = useCallback(() => {
    if (!template) return;
    setPrompt(pickOpenerQuestion(template));
  }, [template]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    const trimmed = text.trim();
    if (trimmed.length < 20) {
      setError("Entry too short — write at least a couple of sentences.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setLastSaved(null);

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
        const err = await res.json().catch(() => ({}));
        const base = err.error ?? `HTTP ${res.status}`;
        const hint = err.hint ? ` — ${err.hint}` : "";
        throw new Error(`${base}${hint}`);
      }
      const json = await res.json() as {
        entry: { id: string };
        stats: { new_entities: number; merged_into_existing: number; edges_added: number };
        next_prompt?: string | null;
      };

      setLastSaved({
        newEntities: json.stats.new_entities,
        mergedIntoExisting: json.stats.merged_into_existing,
        edgesAdded: json.stats.edges_added,
      });
      setText(""); // clear for next entry
      onSaved?.({
        entryId: json.entry.id,
        newEntities: json.stats.new_entities,
        mergedIntoExisting: json.stats.merged_into_existing,
        edgesAdded: json.stats.edges_added,
        nextPrompt: json.next_prompt,
        entryText: trimmed,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setSubmitting(false);
    }
  }, [spaceId, text, submitting, onSaved]);

  if (!template) {
    return (
      <div className="p-8 text-sm text-rose-600">
        Template not found for this space. Journal surface requires a known template.
      </div>
    );
  }

  // Show the LLM-generated next_prompt if available (from last entry); else the picked opener
  const displayedPrompt = nextPrompt || prompt?.text;

  return (
    <div className="flex flex-col h-full">
      {/* Prompt card */}
      <div className="px-6 pt-6">
        <div
          className="rounded-xl border p-5"
          style={{
            borderColor: template.accent_color_light,
            background: `linear-gradient(135deg, ${template.accent_color_light} 0%, white 100%)`,
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-full grid place-items-center"
              style={{ background: template.accent_color_light, color: template.accent_color }}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: template.accent_color }}>
                {nextPrompt ? "Follow-up from your last entry" : "Starting prompt"}
              </div>
              <p className="mt-1 text-base font-medium text-gray-800 leading-relaxed">
                {displayedPrompt ?? "What stood out today?"}
              </p>
            </div>
            <button
              onClick={handleRefreshPrompt}
              className="flex-shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-white/70"
              title="Different prompt"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Writing area */}
      <div className="flex-1 p-6 min-h-0 flex flex-col">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Start writing…"
          className={cn(
            "flex-1 w-full resize-none rounded-xl border border-gray-200 bg-white p-5",
            "text-base leading-relaxed text-gray-900 placeholder:text-gray-400",
            "focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-200/50 transition-all",
          )}
          style={{ minHeight: "300px" }}
          disabled={submitting}
        />

        {/* Word count */}
        <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
          <span>
            {text.trim().length > 0 ? `${text.trim().split(/\s+/).filter(Boolean).length} words` : "Aim for a few sentences or a full page — either works."}
          </span>
          <span className="text-gray-400">
            Entries merge with existing themes instead of creating duplicates.
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 flex items-center justify-between text-sm text-rose-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-900">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Last-saved summary banner */}
      {lastSaved && !error && (
        <div
          className="mx-6 mb-4 rounded-lg border px-4 py-2.5 text-sm flex items-center justify-between"
          style={{
            borderColor: template.accent_color_light,
            background: `linear-gradient(90deg, ${template.accent_color_light} 0%, rgba(255,255,255,0.5) 100%)`,
            color: template.accent_color,
          }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">Entry saved.</span>
            <span className="text-gray-700 text-[12px]">
              {lastSaved.newEntities > 0 && `${lastSaved.newEntities} new concepts`}
              {lastSaved.newEntities > 0 && lastSaved.mergedIntoExisting > 0 && " · "}
              {lastSaved.mergedIntoExisting > 0 && `${lastSaved.mergedIntoExisting} merged into existing themes`}
              {lastSaved.edgesAdded > 0 && ` · ${lastSaved.edgesAdded} new connections`}
            </span>
          </div>
          <button
            onClick={() => setLastSaved(null)}
            className="text-[11px] font-medium opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Footer actions */}
      <div className="px-6 py-4 border-t border-gray-200 bg-white/70 flex items-center justify-between">
        <div className="text-[11px] text-gray-500">
          {recentEntryCount > 0 ? `${recentEntryCount} previous ${recentEntryCount === 1 ? "entry" : "entries"} in this journal` : "This is your first entry."}
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || text.trim().length < 20}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
            submitting || text.trim().length < 20
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "text-white shadow-sm hover:shadow",
          )}
          style={{
            background: submitting || text.trim().length < 20
              ? undefined
              : `linear-gradient(135deg, ${template.accent_color} 0%, ${template.accent_color} 100%)`,
          }}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {submitting ? "Extracting…" : "Save entry"}
        </button>
      </div>
    </div>
  );
}
