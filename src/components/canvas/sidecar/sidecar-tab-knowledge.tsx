"use client";

// ── SidecarTabKnowledge (Arc 5B.4) ─────────────────────────────────────
//
// Shows the user what the existing knowledge graph already knows that's
// relevant to the selected card:
//   1. Nearby entities (vector retrieval via memory_items)
//   2. Related axioms (keyword overlap against synthesis_data.axioms)
//   3. Convergences (keyword overlap against synthesis_data.insight_convergences)
//
// Design: three stacked sections with 9.5px uppercase labels, each
// populating a different card shape. Apple-Vision-Pro clean white.

import { useEffect, useRef, useState } from "react";
import { Network, Zap, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import {
  serialiseContextForAPI,
  type CardContext,
} from "../hooks/use-card-sidecar-context";

interface Props {
  context: CardContext;
  spaceId: string;
}

interface Payload {
  relatedEntities: Array<{
    id: string;
    entity_id: string;
    name: string;
    description: string;
    entity_category: string | null;
    score: number;
  }>;
  axioms: Array<{
    id: string;
    name: string;
    statement: string;
    tier: string | null;
  }>;
  convergences: Array<{
    id: string;
    insight: string;
    supporting_count: number;
  }>;
}

const CACHE = new Map<string, { data: Payload; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(ctx: CardContext): string {
  return `${ctx.shapeId}|${ctx.primaryText.slice(0, 64)}`;
}

const CATEGORY_TINT: Record<string, string> = {
  concrete: "bg-sky-50 text-sky-700 ring-sky-200",
  abstract: "bg-violet-50 text-violet-700 ring-violet-200",
  process: "bg-amber-50 text-amber-700 ring-amber-200",
  relational: "bg-teal-50 text-teal-700 ring-teal-200",
  epistemic: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
};

export function SidecarTabKnowledge({ context, spaceId }: Props) {
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const key = cacheKey(context);
    const cached = CACHE.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    if (context.primaryText.trim().length < 3) {
      setData({ relatedEntities: [], axioms: [], convergences: [] });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/canvas/card-knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spaceId, ...serialiseContextForAPI(context) }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as Payload;
        setData(payload);
        CACHE.set(key, { data: payload, ts: Date.now() });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message ?? "Failed to load knowledge");
      } finally {
        setLoading(false);
      }
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [context, spaceId]);

  const hasAny =
    !!data &&
    (data.relatedEntities.length > 0 ||
      data.axioms.length > 0 ||
      data.convergences.length > 0);

  return (
    <div className="space-y-5">
      {loading && <KnowledgeSkeleton reducedMotion={reducedMotion} />}
      {error && (
        <div className="rounded-lg border border-rose-200/70 bg-rose-50/60 px-3 py-2 text-[11px] text-rose-700">
          {error}
        </div>
      )}
      {!loading && !error && data && !hasAny && (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <Network className="h-6 w-6 text-slate-300" aria-hidden />
          <p className="text-[11.5px] text-slate-400">
            {context.primaryText.trim().length < 3
              ? "Add content to this card to see related concepts."
              : "Nothing in the graph matches yet — keep building."}
          </p>
        </div>
      )}

      {/* Entities */}
      {!loading && data && data.relatedEntities.length > 0 && (
        <Section label="Nearby concepts" icon={<Network className="h-3 w-3" />}>
          <ul className="flex flex-wrap gap-1.5">
            {data.relatedEntities.map((e) => {
              const tint =
                (e.entity_category && CATEGORY_TINT[e.entity_category]) ||
                "bg-slate-50 text-slate-700 ring-slate-200";
              return (
                <li
                  key={e.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold ring-1",
                    tint,
                  )}
                  title={e.description || e.name}
                >
                  <span className="truncate max-w-[140px]">{e.name}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* Axioms */}
      {!loading && data && data.axioms.length > 0 && (
        <Section
          label="Related axioms"
          icon={<Zap className="h-3 w-3" />}
          count={data.axioms.length}
        >
          <ul className="space-y-1.5">
            {data.axioms.map((a) => (
              <li
                key={a.id}
                className="rounded-lg bg-amber-50/40 ring-1 ring-amber-200/60 px-3 py-2"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-amber-700">
                    Axiom
                  </span>
                  {a.tier && (
                    <span className="text-[9.5px] font-semibold text-amber-600/80">
                      · {a.tier}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11.5px] font-semibold text-slate-800">
                  {a.name}
                </p>
                {a.statement && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600 line-clamp-3">
                    {a.statement}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Convergences */}
      {!loading && data && data.convergences.length > 0 && (
        <Section
          label="Convergences"
          icon={<Compass className="h-3 w-3" />}
          count={data.convergences.length}
        >
          <ul className="space-y-1.5">
            {data.convergences.map((c) => (
              <li
                key={c.id}
                className="rounded-lg bg-cyan-50/40 ring-1 ring-cyan-200/60 px-3 py-2"
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-cyan-700">
                    Convergence
                  </span>
                  {c.supporting_count > 0 && (
                    <span className="inline-flex items-center rounded-full bg-white/80 px-1.5 py-[1px] text-[9.5px] font-semibold text-cyan-700 ring-1 ring-cyan-200 tabular-nums">
                      {c.supporting_count} signal{c.supporting_count === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <p className="text-[11.5px] leading-relaxed text-slate-700 line-clamp-3">
                  {c.insight}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  icon,
  count,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label}>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-slate-400">{icon}</span>
        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
          {label}
        </span>
        {typeof count === "number" && (
          <span className="tabular-nums text-[9.5px] font-semibold text-slate-400">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function KnowledgeSkeleton({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="space-y-4">
      <div className={cn("h-4 w-32 rounded bg-slate-100", !reducedMotion && "animate-pulse")} />
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-6 rounded-full bg-slate-100",
              !reducedMotion && "animate-pulse",
            )}
            style={{ width: 60 + Math.random() * 40 }}
            aria-hidden
          />
        ))}
      </div>
      <div className={cn("h-16 rounded-lg bg-slate-100", !reducedMotion && "animate-pulse")} />
    </div>
  );
}
