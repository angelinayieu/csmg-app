"use client";

// Two-pane distiller. Left: textarea dump. Right: 4-layer cascade
// (Concepts → Clusters → Ranked Insights → Main Idea). The right
// pane re-runs ~1.4s after the user stops typing; layers fade in
// together when the response lands.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  Layers,
  Compass,
  Target,
} from "lucide-react";

interface DistillResult {
  concepts: string[];
  clusters: Array<{ label: string; items: string[] }>;
  insights: Array<{ text: string; importance: number }>;
  mainIdea: string;
}

const MIN_CHARS = 12;
const DEBOUNCE_MS = 1400;
const MAX_CHARS = 8000;

export function DistillWorkspace() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<DistillResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  const trimmedLen = useMemo(() => text.trim().length, [text]);
  const hasEnoughText = trimmedLen >= MIN_CHARS;

  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!hasEnoughText) {
      // Cancel any in-flight request and clear the panels.
      abortRef.current?.abort();
      abortRef.current = null;
      setPending(false);
      setResult(null);
      setError(null);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      void distill(text.trim());
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, hasEnoughText]);

  const distill = async (input: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/distill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({ text: input }),
      });
      const parsed = (await res.json().catch(() => ({}))) as
        | DistillResult
        | { error?: string };
      if (!res.ok) {
        const msg =
          (parsed as { error?: string }).error ?? `Distill failed (${res.status})`;
        throw new Error(msg);
      }
      // Only adopt the result if this request is still the latest.
      if (abortRef.current === controller) {
        setResult(parsed as DistillResult);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const message =
        err instanceof Error ? err.message : "Couldn't distill";
      setError(message);
    } finally {
      if (abortRef.current === controller) {
        setPending(false);
        abortRef.current = null;
      }
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-gradient-to-br from-slate-50 via-white to-indigo-50/30">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200/70 bg-white/70 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Home
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
              <Compass className="h-3.5 w-3.5" strokeWidth={2} />
            </div>
            <span className="font-display-tight text-[14px] font-semibold tracking-tight text-gray-900">
              Distill
            </span>
          </div>
        </div>
        <div className="text-[11px] text-gray-500">
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Distilling…
            </span>
          ) : hasEnoughText ? (
            <span>Updates ~{(DEBOUNCE_MS / 1000).toFixed(1)}s after you pause typing</span>
          ) : (
            <span>Paste or type at least {MIN_CHARS} characters to begin</span>
          )}
        </div>
      </header>

      {/* Two-pane body */}
      <div className="flex min-h-0 flex-1">
        {/* Left: textarea */}
        <div className="flex w-3/5 flex-col border-r border-gray-200/70 bg-white">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
            placeholder={"Dump everything — notes, fragments, half-thoughts. The right side will fold them into layers, rank what matters, and surface the one main idea."}
            className="block min-h-0 flex-1 resize-none bg-transparent px-8 py-6 text-[15px] leading-[1.65] text-gray-900 outline-none placeholder:text-gray-400"
            spellCheck
          />
          <div className="flex items-center justify-between border-t border-gray-100 px-8 py-2 text-[11px] text-gray-500">
            <span>{text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars</span>
            {error && <span className="text-rose-600">{error}</span>}
          </div>
        </div>

        {/* Right: 4-layer cascade */}
        <div className="flex w-2/5 min-h-0 flex-col overflow-y-auto bg-gradient-to-b from-white via-indigo-50/40 to-violet-50/30">
          <div className="flex flex-col gap-3 px-6 py-6">
            <LayerPanel
              order={1}
              title="Concepts"
              subtitle="Atomic ideas in your text"
              icon={<Sparkles className="h-3.5 w-3.5" />}
              accent="from-sky-500 to-blue-600"
              pending={pending && !result}
              empty={!hasEnoughText}
            >
              {result && result.concepts.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {result.concepts.map((c, i) => (
                    <li
                      key={`${i}-${c}`}
                      className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[12px] text-sky-900"
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              ) : null}
            </LayerPanel>

            <LayerPanel
              order={2}
              title="Clusters"
              subtitle="Grouped into themes"
              icon={<Layers className="h-3.5 w-3.5" />}
              accent="from-violet-500 to-fuchsia-600"
              pending={pending && !result}
              empty={!hasEnoughText}
            >
              {result && result.clusters.length > 0 ? (
                <ul className="flex flex-col gap-2.5">
                  {result.clusters.map((cluster, i) => (
                    <li key={`${i}-${cluster.label}`}>
                      <div className="text-[12px] font-semibold text-violet-900">
                        {cluster.label}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {cluster.items.map((item, j) => (
                          <span
                            key={`${i}-${j}`}
                            className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </LayerPanel>

            <LayerPanel
              order={3}
              title="Ranked Insights"
              subtitle="Sorted by importance"
              icon={<Compass className="h-3.5 w-3.5" />}
              accent="from-amber-500 to-orange-600"
              pending={pending && !result}
              empty={!hasEnoughText}
            >
              {result && result.insights.length > 0 ? (
                <ol className="flex flex-col gap-2">
                  {[...result.insights]
                    .sort((a, b) => a.importance - b.importance)
                    .map((insight, i) => (
                      <li
                        key={`${i}-${insight.text.slice(0, 24)}`}
                        className="flex gap-2.5 rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2"
                      >
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-600 text-[10px] font-bold text-white">
                          {i + 1}
                        </span>
                        <span className="text-[13px] leading-snug text-amber-950">
                          {insight.text}
                        </span>
                      </li>
                    ))}
                </ol>
              ) : null}
            </LayerPanel>

            <LayerPanel
              order={4}
              title="Main Idea"
              subtitle="The single thesis behind everything"
              icon={<Target className="h-3.5 w-3.5" />}
              accent="from-emerald-500 to-teal-600"
              pending={pending && !result}
              empty={!hasEnoughText}
            >
              {result && result.mainIdea ? (
                <p className="rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 px-4 py-3 text-[14px] font-medium leading-snug text-emerald-950">
                  {result.mainIdea}
                </p>
              ) : null}
            </LayerPanel>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayerPanel({
  order,
  title,
  subtitle,
  icon,
  accent,
  pending,
  empty,
  children,
}: {
  order: number;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: string;
  pending: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl border border-white/80 bg-white/80 px-4 py-4 backdrop-blur-sm transition"
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.8), 0 6px 18px -10px rgba(15,23,42,0.10)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${accent} text-white`}
        >
          {icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
              Layer {order}
            </span>
            <span className="text-[13px] font-semibold text-gray-900">
              {title}
            </span>
          </div>
          <p className="text-[11px] text-gray-500">{subtitle}</p>
        </div>
      </div>
      <div className="mt-3 min-h-[28px]">
        {empty ? (
          <p className="text-[12px] italic text-gray-400">Waiting for text…</p>
        ) : pending ? (
          <div className="flex items-center gap-2 text-[12px] text-gray-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
          </div>
        ) : (
          children ?? (
            <p className="text-[12px] italic text-gray-400">No items yet.</p>
          )
        )}
      </div>
    </section>
  );
}
