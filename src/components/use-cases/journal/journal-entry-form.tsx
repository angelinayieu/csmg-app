"use client";

// ── JournalEntryForm ──
//
// Apple-Notes-style writing surface with an AI companion rail on the
// right. The rail fires a debounced ambient call as the user types and
// surfaces:
//   • 3–4 LLM-generated reflective probe questions (context:"journal")
//   • Related concepts from the user's existing knowledge graph
//   • After save: cross-space resonances (themes from other journals)
//
// The writing area and companion rail live side-by-side inside a
// flex-row so neither is hidden — both are always visible once the
// user has written enough to trigger the first ambient call (>60 chars).

import React, { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Loader2, CheckCircle2, Sparkles, RefreshCw,
  AlertTriangle, X, HelpCircle, Link2, Brain,
} from "lucide-react";
import { getTemplate } from "@/lib/use-cases/library";
import type { UseCaseTemplate, TemplateQuestion } from "@/types/use-case";

interface Props {
  spaceId: string;
  templateId: string;
  nextPrompt?: string | null;
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

// ── Result shapes for the dual-call AI companion ──────────────────────────

/** From /api/journal/reflect — history-aware questions + current-text patterns */
interface ReflectResult {
  questions: string[];
  detected: {
    emotions: string[];
    values: string[];
    tensions: string[];
  };
}

/** From /api/canvas/ambient — KG entity similarity hits */
interface AmbientEntityHit {
  id: string;
  name: string;
  description?: string;
  space_name?: string;
  score: number;
}

function pickOpenerQuestion(template: UseCaseTemplate): TemplateQuestion | null {
  const openers = template.question_library.filter((q) => q.kind === "opener");
  if (openers.length === 0) return null;
  return openers[Math.floor(Math.random() * openers.length)];
}

// ── AI Companion Rail ─────────────────────────────────────────────────────
//
// Fires two parallel requests on a 700ms debounce:
//   1. /api/journal/reflect  → history-aware probe questions + current-text
//      pattern detection (emotions, values, tensions). This endpoint reads
//      your last 3 entries so questions reference recurring themes by name.
//   2. /api/canvas/ambient   → KG entity similarity hits (vector search).
//      Shows which concepts from your broader knowledge graph resonate with
//      what you're currently writing about.
//
// Sections rendered (when data is available):
//   A. "Detected in this entry" — emotion/value/tension chips from reflect
//   B. "Explore further"         — probe questions from reflect (click to append)
//   C. "Related themes"          — KG entity hits from ambient

function JournalAIRail({
  spaceId,
  text,
  accentColor,
  accentColorLight,
  onAppendText,
}: {
  spaceId: string;
  text: string;
  accentColor: string;
  accentColorLight: string;
  onAppendText: (t: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [reflect, setReflect] = useState<ReflectResult | null>(null);
  const [entities, setEntities] = useState<AmbientEntityHit[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Don't fire on short text — wait until the user has written
    // something meaningful (>60 chars ≈ ~10 words).
    if (text.trim().length < 60) {
      setReflect(null);
      setEntities([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      // Cancel any in-flight requests.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      try {
        // Dual parallel fetch — reflect for history-aware questions + patterns,
        // ambient for KG entity resonance. Both fire at the same time.
        const [reflectRes, ambientRes] = await Promise.allSettled([
          fetch("/api/journal/reflect", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ space_id: spaceId, text: text.slice(0, 1200) }),
            signal: ctrl.signal,
          }),
          fetch("/api/canvas/ambient", {
            method: "POST",
            headers: { "content-type": "application/json" },
            // Only asking for entity hits; questions from ambient are ignored
            // in favor of the context-aware ones from reflect.
            body: JSON.stringify({ spaceId, text: text.slice(0, 800), context: "journal" }),
            signal: ctrl.signal,
          }),
        ]);

        if (reflectRes.status === "fulfilled" && reflectRes.value.ok) {
          const data = (await reflectRes.value.json()) as ReflectResult;
          setReflect(data);
        }
        if (ambientRes.status === "fulfilled" && ambientRes.value.ok) {
          const data = (await ambientRes.value.json()) as {
            relatedEntities: AmbientEntityHit[];
          };
          setEntities(data.relatedEntities ?? []);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.warn("[journal-ai-rail]", e);
      } finally {
        setLoading(false);
      }
    }, 700); // 700ms debounce — slightly longer than canvas; journaling pauses are longer

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, spaceId]);

  const hasQuestions = (reflect?.questions.length ?? 0) > 0;
  const hasDetected =
    (reflect?.detected.emotions.length ?? 0) > 0 ||
    (reflect?.detected.values.length ?? 0) > 0 ||
    (reflect?.detected.tensions.length ?? 0) > 0;
  const hasEntities = entities.length > 0;
  const hasContent = loading || hasQuestions || hasDetected || hasEntities;

  // ── Empty / idle state ──────────────────────────────────────────────────
  if (!hasContent) {
    return (
      <div className="hidden lg:flex w-[240px] flex-shrink-0 flex-col items-center justify-center gap-2 border-l border-gray-100 px-5 py-8 text-center">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{ background: accentColorLight, color: accentColor }}
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <p className="text-[11px] font-medium text-gray-400 leading-snug">
          Start writing and I&apos;ll surface patterns from your previous entries.
        </p>
      </div>
    );
  }

  // ── Active state ────────────────────────────────────────────────────────
  return (
    <div className="hidden lg:flex w-[240px] flex-shrink-0 flex-col gap-4 border-l border-gray-100 px-4 py-5 overflow-y-auto">

      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-lg"
          style={{ background: accentColorLight, color: accentColor }}
        >
          <Sparkles className={cn("h-3 w-3", loading && "animate-pulse")} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">
          {loading ? "Reading patterns…" : "AI companion"}
        </span>
      </div>

      {loading && !reflect && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Surfacing themes from your history…
        </div>
      )}

      {/* ── A. Detected patterns ─────────────────────────────────────────── */}
      {hasDetected && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 px-0.5">
            <Brain className="h-3 w-3 text-gray-400" />
            <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-gray-400">
              Detected in this entry
            </span>
          </div>

          {/* Emotions */}
          {(reflect!.detected.emotions.length > 0) && (
            <div className="flex flex-col gap-1">
              <span className="px-0.5 text-[9px] font-semibold uppercase tracking-widest text-gray-400">
                Emotions
              </span>
              <div className="flex flex-wrap gap-1">
                {reflect!.detected.emotions.slice(0, 5).map((e) => (
                  <span
                    key={e}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: accentColorLight, color: accentColor }}
                  >
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Values */}
          {(reflect!.detected.values.length > 0) && (
            <div className="flex flex-col gap-1">
              <span className="px-0.5 text-[9px] font-semibold uppercase tracking-widest text-gray-400">
                Values
              </span>
              <div className="flex flex-wrap gap-1">
                {reflect!.detected.values.slice(0, 4).map((v) => (
                  <span
                    key={v}
                    className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600"
                  >
                    {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tensions */}
          {(reflect!.detected.tensions.length > 0) && (
            <div className="flex flex-col gap-1">
              <span className="px-0.5 text-[9px] font-semibold uppercase tracking-widest text-rose-400">
                Tensions
              </span>
              <div className="flex flex-col gap-1">
                {reflect!.detected.tensions.slice(0, 2).map((t) => (
                  <span
                    key={t}
                    className="rounded-lg border border-rose-100 bg-rose-50 px-2 py-1 text-[10px] leading-snug text-rose-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── B. Probe questions ───────────────────────────────────────────── */}
      {hasQuestions && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 px-0.5">
            <HelpCircle className="h-3 w-3 text-gray-400" />
            <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-gray-400">
              Explore further
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {reflect!.questions.slice(0, 4).map((q, i) => (
              <li key={i}>
                <button
                  onClick={() => onAppendText(`\n\n${q}\n`)}
                  title="Add this question to your entry"
                  className="w-full rounded-lg bg-gray-50 px-2.5 py-2 text-left text-[11px] leading-snug text-gray-700 transition-all hover:bg-white hover:shadow-sm hover:text-gray-900"
                  style={{ borderLeft: `2px solid ${accentColor}` }}
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── C. KG entity resonance ───────────────────────────────────────── */}
      {hasEntities && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 px-0.5">
            <Link2 className="h-3 w-3 text-gray-400" />
            <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-gray-400">
              Related themes
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {entities.slice(0, 4).map((e) => (
              <li key={e.id}>
                <div className="group flex items-start gap-2 rounded-lg bg-gray-50 px-2.5 py-2">
                  <div
                    className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: accentColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold text-gray-800">
                      {e.name}
                    </div>
                    {e.space_name && (
                      <div className="text-[9.5px] text-gray-400 truncate">
                        {e.space_name}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Main form component ───────────────────────────────────────────────────

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

  useEffect(() => {
    if (!template) return;
    setPrompt(pickOpenerQuestion(template));
  }, [template, recentEntryCount]);

  const handleRefreshPrompt = useCallback(() => {
    if (!template) return;
    setPrompt(pickOpenerQuestion(template));
  }, [template]);

  // Append text to the textarea at end (used by companion rail probe questions)
  const handleAppendText = useCallback((addition: string) => {
    setText((prev) => prev + addition);
  }, []);

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
      setText("");
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
        Template not found for this space.
      </div>
    );
  }

  const displayedPrompt = nextPrompt || prompt?.text;

  return (
    <div className="flex h-full flex-col">

      {/* ── Starting prompt card ───────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6">
        <div
          className="rounded-xl border p-4"
          style={{
            borderColor: template.accent_color_light,
            background: `linear-gradient(135deg, ${template.accent_color_light} 0%, white 100%)`,
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
              style={{ background: template.accent_color_light, color: template.accent_color }}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: template.accent_color }}
              >
                {nextPrompt ? "Follow-up from your last entry" : "Starting prompt"}
              </div>
              <p className="mt-1 text-[15px] font-medium leading-relaxed text-gray-800">
                {displayedPrompt ?? "What stood out today?"}
              </p>
            </div>
            <button
              onClick={handleRefreshPrompt}
              className="flex-shrink-0 rounded p-1.5 text-gray-400 hover:bg-white/70 hover:text-gray-700"
              title="Different prompt"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Writing area + AI companion rail ──────────────────────── */}
      <div className="flex min-h-0 flex-1">

        {/* Textarea column */}
        <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Start writing…"
            className={cn(
              "flex-1 w-full resize-none rounded-xl border border-gray-200 bg-white p-5",
              "text-[15px] leading-[1.75] text-gray-900 placeholder:text-gray-400",
              "focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-200/50 transition-all",
            )}
            style={{ minHeight: "260px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
            disabled={submitting}
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
            <span>
              {text.trim().length > 0
                ? `${text.trim().split(/\s+/).filter(Boolean).length} words`
                : "Write freely — aim for a few sentences or a full page."}
            </span>
            <span>Entries merge with existing themes, not duplicated.</span>
          </div>
        </div>

        {/* AI companion rail */}
        <JournalAIRail
          spaceId={spaceId}
          text={text}
          accentColor={template.accent_color}
          accentColorLight={template.accent_color_light}
          onAppendText={handleAppendText}
        />
      </div>

      {/* ── Banners ────────────────────────────────────────────────── */}
      {error && (
        <div className="mx-6 mb-4 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-900">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {lastSaved && !error && (
        <div
          className="mx-6 mb-4 flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm"
          style={{
            borderColor: template.accent_color_light,
            background: `linear-gradient(90deg, ${template.accent_color_light} 0%, rgba(255,255,255,0.5) 100%)`,
            color: template.accent_color,
          }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">Entry saved.</span>
            <span className="text-[12px] text-gray-700">
              {lastSaved.newEntities > 0 && `${lastSaved.newEntities} new concepts`}
              {lastSaved.newEntities > 0 && lastSaved.mergedIntoExisting > 0 && " · "}
              {lastSaved.mergedIntoExisting > 0 && `${lastSaved.mergedIntoExisting} merged`}
              {lastSaved.edgesAdded > 0 && ` · ${lastSaved.edgesAdded} connections`}
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

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center justify-between border-t border-gray-200 bg-white/70 px-6 py-4">
        <div className="text-[11px] text-gray-500">
          {recentEntryCount > 0
            ? `${recentEntryCount} previous ${recentEntryCount === 1 ? "entry" : "entries"} in this journal`
            : "This is your first entry."}
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || text.trim().length < 20}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
            submitting || text.trim().length < 20
              ? "cursor-not-allowed bg-gray-100 text-gray-400"
              : "text-white shadow-sm hover:shadow",
          )}
          style={{
            background:
              submitting || text.trim().length < 20
                ? undefined
                : template.accent_color,
          }}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {submitting ? "Extracting…" : "Save entry"}
        </button>
      </div>
    </div>
  );
}
