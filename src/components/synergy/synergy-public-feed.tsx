// ── Synergy Public Components Feed ──
//
// The /feed page's main view. Filter bar at the top (kind chips +
// debounced search), grid of public components below, "Load more"
// at the bottom. Each card links to the owner's public profile.
//
// Filtering re-fetches from the API rather than slicing client-side
// so we get accurate counts + correct pagination edges.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Compass,
  Globe,
  Lightbulb,
  Loader2,
  Package,
  Search,
  UserCircle2,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  listPublicComponents,
  type PublicComponentItem,
  type PublicComponentKind,
} from "@/lib/synergy/client";

const KIND_FILTERS: Array<{
  value: PublicComponentKind | "all";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}> = [
  { value: "all", label: "All", icon: Globe, tone: "text-gray-700" },
  {
    value: "core_idea",
    label: "Core ideas",
    icon: Lightbulb,
    tone: "text-blue-700",
  },
  {
    value: "upstream",
    label: "Upstream",
    icon: ArrowUp,
    tone: "text-amber-700",
  },
  {
    value: "downstream",
    label: "Downstream",
    icon: ArrowDown,
    tone: "text-emerald-700",
  },
  {
    value: "polished_product",
    label: "Polished",
    icon: Package,
    tone: "text-purple-700",
  },
];

const KIND_BACKGROUND: Record<PublicComponentKind, string> = {
  core_idea: "border-blue-100 bg-blue-50/40",
  upstream: "border-amber-100 bg-amber-50/40",
  downstream: "border-emerald-100 bg-emerald-50/40",
  polished_product: "border-purple-100 bg-purple-50/40",
};

const KIND_ICON: Record<PublicComponentKind, React.ComponentType<{ className?: string }>> = {
  core_idea: Lightbulb,
  upstream: ArrowUp,
  downstream: ArrowDown,
  polished_product: Package,
};

export function SynergyPublicFeed() {
  const [kind, setKind] = useState<PublicComponentKind | "all">("all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [items, setItems] = useState<PublicComponentItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [appending, setAppending] = useState(false);

  // Debounce search input — 350ms feels snappy without burning the API
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  // Refetch from scratch when filters change. The fetchId guard
  // discards stale responses if the user toggles filters quickly.
  const fetchId = useRef(0);
  useEffect(() => {
    const myId = ++fetchId.current;
    setLoading(true);
    setItems(null);
    setNextCursor(null);
    listPublicComponents({
      kind: kind === "all" ? undefined : kind,
      q: debouncedQ || undefined,
      limit: 24,
    })
      .then((page) => {
        if (fetchId.current !== myId) return;
        setItems(page.items);
        setNextCursor(page.next_cursor);
      })
      .catch((err) => {
        if (fetchId.current !== myId) return;
        toast.error("Couldn't load feed", {
          description: (err as Error).message,
        });
        setItems([]);
      })
      .finally(() => {
        if (fetchId.current === myId) setLoading(false);
      });
  }, [kind, debouncedQ]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || appending) return;
    setAppending(true);
    try {
      const page = await listPublicComponents({
        kind: kind === "all" ? undefined : kind,
        q: debouncedQ || undefined,
        cursor: nextCursor,
        limit: 24,
      });
      setItems((prev) => (prev ? [...prev, ...page.items] : page.items));
      setNextCursor(page.next_cursor);
    } catch (err) {
      toast.error("Couldn't load more", {
        description: (err as Error).message,
      });
    } finally {
      setAppending(false);
    }
  }, [nextCursor, appending, kind, debouncedQ]);

  const grouped = useMemo(() => {
    if (!items) return null;
    const m = new Map<PublicComponentKind, PublicComponentItem[]>();
    for (const it of items) {
      const arr = m.get(it.kind) ?? [];
      arr.push(it);
      m.set(it.kind, arr);
    }
    return m;
  }, [items]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* ── Header ── */}
      <header className="mb-6 flex items-center gap-3">
        <Link
          href="/app/synergy"
          className="inline-flex items-center gap-2 text-sm text-gray-600 transition hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <span className="text-gray-300">·</span>
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">
          Public components
        </h1>
        <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700">
          <Globe className="h-3 w-3 text-emerald-600" />
          Browse mode
        </div>
      </header>

      <p className="mb-6 max-w-2xl text-[13px] leading-relaxed text-gray-600">
        Components other users have explicitly published. Distinct from the{" "}
        <Link
          href="/app/synergy/discover"
          className="font-semibold text-blue-700 hover:underline"
        >
          discover feed
        </Link>{" "}
        — that surface ranks matches against your own components.
      </p>

      {/* ── Filter bar ── */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_FILTERS.map(({ value, label, icon: Icon, tone }) => {
            const active = value === kind;
            return (
              <button
                key={value}
                onClick={() => setKind(value)}
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition",
                  active
                    ? "border-blue-300 bg-blue-50 text-blue-800"
                    : "border-gray-200 bg-white hover:border-blue-200 hover:text-gray-900",
                ].join(" ")}
              >
                <Icon className={`h-3 w-3 ${active ? "text-blue-700" : tone}`} />
                {label}
              </button>
            );
          })}
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search components…"
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-7 text-[12.5px] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-gray-400 transition hover:text-gray-900"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      {loading && <FeedSkeleton />}
      {!loading && items && items.length === 0 && (
        <EmptyState kind={kind} hasSearch={!!debouncedQ} />
      )}
      {!loading && grouped && items && items.length > 0 && (
        <div className="space-y-8">
          {(["core_idea", "upstream", "downstream", "polished_product"] as const).map(
            (k) => {
              const list = grouped.get(k);
              if (!list || list.length === 0) return null;
              return (
                <section key={k}>
                  <SectionHeading kind={k} count={list.length} />
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {list.map((it) => (
                      <FeedCard key={it.id} item={it} />
                    ))}
                  </div>
                </section>
              );
            },
          )}

          {nextCursor && (
            <div className="flex justify-center pt-4">
              <button
                onClick={loadMore}
                disabled={appending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-[12.5px] font-medium text-gray-700 shadow-sm transition hover:scale-[1.02] hover:border-blue-400 disabled:opacity-60"
              >
                {appending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                  </>
                ) : (
                  "Load more"
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHeading({
  kind,
  count,
}: {
  kind: PublicComponentKind;
  count: number;
}) {
  const Icon = KIND_ICON[kind];
  const label = {
    core_idea: "Core ideas",
    upstream: "Upstream — what people need",
    downstream: "Downstream — what people produce",
    polished_product: "Polished products",
  }[kind];
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
      <Icon className="h-3.5 w-3.5 text-blue-600" />
      {label}
      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-500">
        {count}
      </span>
    </div>
  );
}

function FeedCard({ item }: { item: PublicComponentItem }) {
  const tone = KIND_BACKGROUND[item.kind];
  return (
    <article className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-gray-900">
          {item.label_public}
        </h3>
        {item.subkind && (
          <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
            {item.subkind}
          </span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-gray-700">
        {item.description_public}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/60 pt-2.5">
        <Link
          href={`/app/synergy/profile/${item.owner.user_id}`}
          className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-gray-700 transition hover:text-blue-700"
          title="View profile"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-white text-gray-500 ring-1 ring-gray-200">
            {item.owner.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.owner.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <UserCircle2 className="h-3.5 w-3.5" />
            )}
          </span>
          {item.owner.display_name}
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
          {formatRelativeShort(item.created_at)}
        </span>
      </div>
    </article>
  );
}

function formatRelativeShort(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function FeedSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-xl border border-gray-200 bg-white"
        />
      ))}
    </div>
  );
}

function EmptyState({
  kind,
  hasSearch,
}: {
  kind: PublicComponentKind | "all";
  hasSearch: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-8 py-12 text-center">
      <Compass className="mx-auto mb-3 h-6 w-6 text-gray-400" />
      <h2 className="text-base font-semibold text-gray-900">
        {hasSearch
          ? "No components match your search"
          : kind === "all"
            ? "No public components yet"
            : "No components in this category yet"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[12.5px] text-gray-600">
        Once users mark components as <span className="font-mono">public</span>,
        they show up here for anyone to browse. The matchable / private surface
        through other channels.
      </p>
    </div>
  );
}
