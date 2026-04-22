"use client";

// ── SidecarTabWeb (Arc 5B.5) ───────────────────────────────────────────
//
// Opt-in web search for the selected card. Does NOT auto-fire — each
// search call costs ~$0.01 (Anthropic web_search tool pricing). The user
// must click "Search the web" to initiate.
//
// Once results land:
//   • Claude-authored 2-sentence summary at the top
//   • 3-5 result cards with title + domain + excerpt
//   • Links open in a new tab with safe rel
//
// Clean-white clean-white Apple Vision Pro styling: glass cards, restrained
// color, SF Pro typography, 150ms hover lift on cards.

import { useState } from "react";
import { Globe, ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import {
  serialiseContextForAPI,
  type CardContext,
} from "../hooks/use-card-sidecar-context";
import type {
  CardWebSearchResult,
  CardWebSearchResponse,
} from "@/app/api/canvas/card-web-search/route";

interface Props {
  context: CardContext;
  spaceId: string;
}

export function SidecarTabWeb({ context, spaceId }: Props) {
  const reducedMotion = useReducedMotion();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CardWebSearchResponse | null>(null);

  const canSearch = context.primaryText.trim().length >= 3;

  const doSearch = async () => {
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/canvas/card-web-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, ...serialiseContextForAPI(context) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as CardWebSearchResponse;
      setData(payload);
    } catch (e) {
      setError((e as Error).message ?? "Web search failed");
    } finally {
      setLoading(false);
    }
  };

  // Initial state — CTA before first search.
  if (!data && !loading && !error) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/60 px-4 py-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 ring-1 ring-sky-200">
            <Globe className="h-4 w-4 text-sky-600" />
          </span>
          <div>
            <p className="text-[12.5px] font-semibold text-slate-800">
              Search the web for context
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Uses up to 4 searches. Each costs $0.01. Results will cite their
              sources.
            </p>
          </div>
          <button
            type="button"
            onClick={doSearch}
            disabled={!canSearch}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-[0_1px_2px_rgba(14,165,233,0.3)]",
              "hover:bg-sky-600",
              "disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none",
              !reducedMotion && "transition-colors duration-150",
            )}
          >
            <Search className="h-3 w-3" />
            Search
          </button>
          {!canSearch && (
            <p className="text-[10.5px] text-slate-400">
              Add more content to this card first.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Loading state */}
      {loading && (
        <div className="flex items-center gap-2 rounded-xl bg-sky-50/60 ring-1 ring-sky-200/60 px-3 py-2.5">
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/10",
              !reducedMotion && "animate-pulse",
            )}
          >
            <Search className="h-3 w-3 text-sky-600" />
          </span>
          <span className="text-[11.5px] font-medium text-sky-700">
            Searching the web…
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-rose-200/70 bg-rose-50/60 px-3 py-2 text-[11px] text-rose-700">
          {error}
          <button
            type="button"
            onClick={doSearch}
            className="ml-2 font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Results */}
      {data && (
        <>
          {/* Summary */}
          {data.summary && (
            <section
              className="rounded-xl bg-gradient-to-br from-sky-50/60 to-white ring-1 ring-sky-200/50 px-3 py-2.5"
              aria-label="Web search summary"
            >
              <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-sky-700">
                Synthesis
              </div>
              <p className="text-[11.5px] leading-relaxed text-slate-700">
                {data.summary}
              </p>
              {data.searches_performed > 0 && (
                <p className="mt-1.5 text-[10px] font-medium text-slate-400 tabular-nums">
                  {data.searches_performed} search
                  {data.searches_performed === 1 ? "" : "es"} performed
                </p>
              )}
            </section>
          )}

          {/* Results list */}
          {data.results.length > 0 ? (
            <ul className="space-y-2" aria-label="Search results">
              {data.results.map((r, i) => (
                <WebResultCard key={i} result={r} reducedMotion={reducedMotion} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-6 text-center">
              <Globe className="h-6 w-6 text-slate-300" aria-hidden />
              <p className="text-[11.5px] text-slate-400">
                No results returned. Try adding more detail to the card.
              </p>
            </div>
          )}

          {/* Search-again button */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={doSearch}
              disabled={loading}
              className={cn(
                "inline-flex items-center gap-1 rounded-full bg-white ring-1 ring-slate-200 px-2.5 py-1 text-[10.5px] font-semibold text-slate-600",
                "hover:bg-slate-50",
                !reducedMotion && "transition-colors duration-150",
              )}
            >
              <Search className="h-2.5 w-2.5" />
              Search again
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function WebResultCard({
  result,
  reducedMotion,
}: {
  result: CardWebSearchResult;
  reducedMotion: boolean;
}) {
  return (
    <li>
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "group block rounded-xl bg-white ring-1 ring-slate-200/70 px-3 py-2.5",
          !reducedMotion && "transition-shadow duration-150",
          "hover:shadow-[0_2px_8px_rgba(14,165,233,0.08)]",
        )}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="text-[12.5px] font-semibold text-slate-900 group-hover:text-sky-700 line-clamp-2">
              {result.title}
            </h4>
            {result.domain && (
              <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                {result.domain}
              </p>
            )}
            {result.snippet && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600 line-clamp-3">
                {result.snippet}
              </p>
            )}
          </div>
          <ExternalLink className="h-3 w-3 flex-shrink-0 text-slate-300 group-hover:text-sky-500" />
        </div>
      </a>
    </li>
  );
}
