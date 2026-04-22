"use client";

// ── SidecarTabInsights (Arc 5B.3) ──────────────────────────────────────
//
// Thread-aware Socratic probing questions for the selected card. Renders:
//   1. Thread context summary (if the card is a reply — shows up to 3
//      ancestors in a faint "CONTEXT" block so the user remembers what
//      the conversation was)
//   2. Probe question cards — 3-5 per batch, each with an indigo accent
//      bar and an "Ask →" affordance (stub — wiring the ask flow is
//      part of the chatbox layer in Arc 5C)
//
// Behaviour:
//   • Auto-fires a debounced fetch 800ms after the selection stabilises
//   • Caches by shape id + primaryText hash in-memory for the session
//   • Re-fetches when the card's primary content changes

import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import {
  serialiseContextForAPI,
  type CardContext,
} from "../hooks/use-card-sidecar-context";

interface Props {
  context: CardContext;
  spaceId: string;
  /**
   * Arc 5C: callback when the user clicks "Ask →" on a probe card.
   * Parent is expected to switch into chat history view and pre-fill the
   * chat with this question so the user can send it (or edit first).
   */
  onAskProbe?: (question: string) => void;
}

// Per-session cache — avoids re-hitting the endpoint when the user
// re-selects the same card and nothing has changed. Keyed by shapeId +
// short content hash (first 48 chars) so edits bust the cache.
const CACHE = new Map<string, { questions: string[]; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(ctx: CardContext): string {
  return `${ctx.shapeId}|${ctx.primaryText.slice(0, 64)}`;
}

export function SidecarTabInsights({ context, spaceId, onAskProbe }: Props) {
  const reducedMotion = useReducedMotion();
  const [questions, setQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ancestors = context.blocks.filter(
    (b): b is { kind: "thread-ancestor"; author: string | null; text: string; depth: number } =>
      b.kind === "thread-ancestor",
  );

  useEffect(() => {
    const key = cacheKey(context);
    const cached = CACHE.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setQuestions(cached.questions);
      setLoading(false);
      setError(null);
      return;
    }

    if (context.primaryText.trim().length < 3) {
      setQuestions([]);
      setLoading(false);
      return;
    }

    // Abort any prior in-flight request before firing a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/canvas/card-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            ...serialiseContextForAPI(context),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { questions: string[] };
        const next = data.questions ?? [];
        setQuestions(next);
        CACHE.set(key, { questions: next, ts: Date.now() });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message ?? "Failed to load insights");
      } finally {
        setLoading(false);
      }
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [context, spaceId]);

  return (
    <div className="space-y-4">
      {/* Thread context */}
      {ancestors.length > 0 && (
        <section
          aria-label="Thread context"
          className="rounded-xl border-l-2 border-dashed border-indigo-200 bg-indigo-50/30 px-3 py-2.5"
        >
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-indigo-600/80">
            Context
          </div>
          <ol className="space-y-1.5">
            {ancestors.slice(0, 3).map((a, i) => (
              <li key={i} className="text-[11px] italic text-slate-500">
                <span className="mr-1 font-semibold not-italic text-slate-400">
                  {a.depth === -1 ? "Root:" : a.author ? `${a.author}:` : `Turn ${i + 1}:`}
                </span>
                {a.text.slice(0, 160)}
                {a.text.length > 160 ? "…" : ""}
              </li>
            ))}
            {ancestors.length > 3 && (
              <li className="text-[10px] text-slate-400">
                + {ancestors.length - 3} earlier turn{ancestors.length - 3 === 1 ? "" : "s"}
              </li>
            )}
          </ol>
        </section>
      )}

      {/* Questions */}
      {loading && <SkeletonCards reducedMotion={reducedMotion} count={3} />}
      {error && (
        <div className="rounded-lg border border-rose-200/70 bg-rose-50/60 px-3 py-2 text-[11px] text-rose-700">
          {error}
        </div>
      )}
      {!loading && !error && questions.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <Sparkles className="h-6 w-6 text-slate-300" aria-hidden />
          <p className="text-[11.5px] text-slate-400">
            {context.primaryText.trim().length < 3
              ? "Add content to this card to see probing questions."
              : "No insights yet — try adding more detail."}
          </p>
        </div>
      )}
      {!loading && questions.length > 0 && (
        <ul className="space-y-2" aria-label="Probing questions">
          {questions.map((q, i) => (
            <QuestionCard
              key={i}
              text={q}
              reducedMotion={reducedMotion}
              onAsk={onAskProbe ? () => onAskProbe(q) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionCard({
  text,
  reducedMotion,
  onAsk,
}: {
  text: string;
  reducedMotion: boolean;
  onAsk?: () => void;
}) {
  return (
    <li
      className={cn(
        "group relative rounded-xl bg-white ring-1 ring-slate-200/70 px-3 py-2.5",
        !reducedMotion && "transition-shadow duration-150",
        "hover:shadow-[0_2px_8px_rgba(99,102,241,0.08)]",
      )}
    >
      {/* Indigo accent bar */}
      <span
        aria-hidden
        className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-indigo-500/80"
      />
      <p className="pl-2 pr-10 text-[12.5px] font-medium leading-relaxed text-slate-800">
        {text}
      </p>
      <button
        type="button"
        onClick={onAsk}
        disabled={!onAsk}
        aria-label="Ask AI to explore this question"
        title={onAsk ? "Send this to chat for a deeper answer" : "Chat unavailable"}
        className={cn(
          "absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full",
          onAsk
            ? "text-slate-400 group-hover:text-indigo-500 group-hover:bg-indigo-50"
            : "text-slate-300 cursor-not-allowed opacity-60",
          !reducedMotion && "transition-colors duration-150",
        )}
      >
        <ArrowRight className="h-3 w-3" />
      </button>
    </li>
  );
}

function SkeletonCards({
  reducedMotion,
  count,
}: {
  reducedMotion: boolean;
  count: number;
}) {
  return (
    <ul className="space-y-2" aria-label="Loading insights">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className={cn(
            "h-12 rounded-xl bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100",
            !reducedMotion && "animate-pulse",
          )}
          aria-hidden
        />
      ))}
    </ul>
  );
}
