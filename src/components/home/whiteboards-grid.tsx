"use client";

// ── WhiteboardsGrid ──
//
// Curated grid of saved whiteboards (spaces). Single source of truth
// for browsing, categorizing, pinning, and archiving — all the
// affordances that used to live in the parallel Canvas Library now
// live here against the spaces table directly.
//
// Surfaces three kinds of categorization:
//   - Kind: ask vs create (spaces.kind)
//   - Maturity: actionable / waiting / theoretical / blocked
//     (spaces.maturity, auto-set by the pipeline)
//   - Dominant entity category: auto-derived in completePipelineRun
//     from each whiteboard's entity table (spaces.dominant_entity_category)
//
// Plus search, sort, pin (sticky-top), and archive (soft-delete with
// an Active/Archived view toggle).
//
// The component is reusable in two modes:
//   - mode="browse"  : full curation UI, links navigate to the board
//   - mode="select"  : compact picker for the in-whiteboard Connect
//                      panel; cards are buttons that fire onSelect.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Layers,
  Loader2,
  MessageCircleQuestion,
  Network,
  Pin,
  PinOff,
  Search,
  Sparkles,
} from "lucide-react";
import type { Space } from "@/types";
import { cn } from "@/lib/utils";

export type WhiteboardsGridMode = "browse" | "select";

export interface WhiteboardsGridProps {
  spaces: Space[];
  onBack?: () => void;
  /**
   * Called when the user clicks "New whiteboard" / "Start first analysis".
   * The shell flips back to the welcome view so the inline Create textarea
   * is the single intake surface. If omitted, the buttons are hidden.
   */
  onCreateNew?: () => void;
  mode?: WhiteboardsGridMode;
  onSelect?: (space: Space) => void;
  excludeSpaceId?: string;
}

type SortKey = "recent" | "entities" | "name";
type KindFilter = "all" | "analysis" | "ask";
type MaturityFilter =
  | "all"
  | "actionable_now"
  | "waiting_on_dependency"
  | "theoretical"
  | "blocked";
type CategoryFilter = "all" | string;
type View = "active" | "archived";

const KIND_LABELS: Record<Exclude<KindFilter, "all">, string> = {
  analysis: "Create",
  ask: "Ask",
};

const MATURITY_LABELS: Record<Exclude<MaturityFilter, "all">, string> = {
  actionable_now: "Actionable",
  waiting_on_dependency: "Waiting",
  theoretical: "Theoretical",
  blocked: "Blocked",
};

const CATEGORY_ACCENTS: Record<string, string> = {
  concrete: "#0ea5e9",
  abstract: "#a855f7",
  process: "#f97316",
  relational: "#10b981",
  epistemic: "#eab308",
  fault: "#ef4444",
};

export function WhiteboardsGrid({
  spaces,
  onBack,
  onCreateNew,
  mode = "browse",
  onSelect,
  excludeSpaceId,
}: WhiteboardsGridProps) {
  // Local optimistic mutation state — keeps the grid snappy without
  // round-tripping the page. Server is the source of truth on next
  // navigation.
  const [overrides, setOverrides] = useState<
    Record<string, Partial<Pick<Space, "pinned" | "archived">>>
  >({});

  const [view, setView] = useState<View>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [maturityFilter, setMaturityFilter] = useState<MaturityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  // Apply optimistic overrides on top of the server-fetched rows.
  const merged = useMemo(
    () =>
      spaces.map((s) => ({
        ...s,
        ...(overrides[s.id] ?? {}),
      })),
    [spaces, overrides],
  );

  // Categories present in the data — drives the dynamic chip set so
  // we don't render filter chips for categories no whiteboard has.
  const presentCategories = useMemo(() => {
    const set = new Set<string>();
    for (const s of merged) {
      if (s.dominant_entity_category) set.add(s.dominant_entity_category);
    }
    return [...set].sort();
  }, [merged]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = merged;
    if (excludeSpaceId) list = list.filter((s) => s.id !== excludeSpaceId);

    // View toggle. In select mode we always show active boards.
    if (mode === "browse") {
      list = list.filter((s) =>
        view === "archived" ? s.archived : !s.archived,
      );
    } else {
      list = list.filter((s) => !s.archived);
    }

    if (kindFilter !== "all") list = list.filter((s) => s.kind === kindFilter);
    if (maturityFilter !== "all")
      list = list.filter((s) => s.maturity === maturityFilter);
    if (categoryFilter !== "all")
      list = list.filter(
        (s) => s.dominant_entity_category === categoryFilter,
      );

    if (q) {
      list = list.filter(
        (s) =>
          s.name?.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.input_text?.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    if (sort === "entities") {
      sorted.sort((a, b) => (b.entity_count ?? 0) - (a.entity_count ?? 0));
    } else if (sort === "name") {
      sorted.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    } else {
      sorted.sort((a, b) => {
        const ta = a.updated_at ? Date.parse(a.updated_at) : 0;
        const tb = b.updated_at ? Date.parse(b.updated_at) : 0;
        return tb - ta;
      });
    }
    // Pinned always rise to the top in browse mode.
    if (mode === "browse" && view === "active") {
      sorted.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    }
    return sorted;
  }, [
    merged,
    query,
    sort,
    excludeSpaceId,
    mode,
    view,
    kindFilter,
    maturityFilter,
    categoryFilter,
  ]);

  // Single PATCH helper. Optimistically applies + rolls back on
  // failure. Soft-fails (logs only) so the grid never wedges on a
  // network blip.
  async function patchSpace(
    id: string,
    update: Partial<Pick<Space, "pinned" | "archived">>,
  ) {
    setOverrides((o) => ({ ...o, [id]: { ...(o[id] ?? {}), ...update } }));
    try {
      const res = await fetch(`/api/spaces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch (err) {
      console.error("[WhiteboardsGrid] patch failed:", err);
      setOverrides((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
    }
  }

  return (
    <div
      className="h-full w-full overflow-y-auto"
      style={{
        background:
          "radial-gradient(circle at 30% 20%, #F8FAFF 0%, #F0F4FB 40%, #E9EEF8 100%)",
      }}
    >
      <div className="mx-auto max-w-[1280px] px-8 pb-24 pt-12">
        {/* Header row */}
        <div className="mb-8 flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            {onBack && (
              <button
                onClick={onBack}
                className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-[11px] font-semibold text-gray-600 backdrop-blur-sm transition-all hover:-translate-x-0.5 hover:border-gray-300 hover:bg-white hover:text-gray-900"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to welcome
              </button>
            )}
            <h1 className="text-[32px] font-semibold tracking-tight text-gray-900">
              {mode === "select" ? "Pick a whiteboard" : "Whiteboards"}
            </h1>
            <p className="mt-1 text-[13.5px] text-gray-500">
              {mode === "select"
                ? "Choose another whiteboard to weave or bridge with this one."
                : merged.length === 0
                  ? "Start your first analysis — entities, relationships, and cycles unfurl live on the whiteboard."
                  : `${merged.filter((s) => !s.archived).length} active · ${merged.filter((s) => s.archived).length} archived`}
            </p>
          </div>
          {mode === "browse" && onCreateNew && (
            <button
              type="button"
              onClick={onCreateNew}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
            >
              <Sparkles className="h-3.5 w-3.5" />
              New whiteboard
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Active / Archived toggle (browse mode only) */}
        {mode === "browse" && merged.length > 0 && (
          <div className="mb-4 inline-flex items-center rounded-full border border-gray-200 bg-white/80 p-0.5 text-[11.5px] font-semibold">
            <ViewTab
              active={view === "active"}
              onClick={() => setView("active")}
            >
              Active ({merged.filter((s) => !s.archived).length})
            </ViewTab>
            <ViewTab
              active={view === "archived"}
              onClick={() => setView("archived")}
            >
              Archived ({merged.filter((s) => s.archived).length})
            </ViewTab>
          </div>
        )}

        {/* Search + sort row */}
        {merged.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 max-w-md min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search whiteboards…"
                className="w-full rounded-full border border-gray-200 bg-white/80 pl-9 pr-4 py-2 text-[12.5px] text-gray-800 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="inline-flex items-center rounded-full border border-gray-200 bg-white/80 p-0.5 text-[11px] font-semibold">
              {(["recent", "entities", "name"] as SortKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={
                    sort === k
                      ? "rounded-full bg-gray-900 px-3 py-1 text-white"
                      : "rounded-full px-3 py-1 text-gray-500 hover:text-gray-800"
                  }
                >
                  {k === "recent" ? "Recent" : k === "entities" ? "Most entities" : "A–Z"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Categorization chip rows — only render if we have data */}
        {mode === "browse" && merged.length > 0 && (
          <div className="mb-6 space-y-2">
            <ChipRow
              label="Kind"
              value={kindFilter}
              onChange={(v) => setKindFilter(v as KindFilter)}
              options={[
                { v: "all", label: "All" },
                { v: "analysis", label: "Create" },
                { v: "ask", label: "Ask" },
              ]}
            />
            <ChipRow
              label="Maturity"
              value={maturityFilter}
              onChange={(v) => setMaturityFilter(v as MaturityFilter)}
              options={[
                { v: "all", label: "All" },
                { v: "actionable_now", label: "Actionable" },
                { v: "waiting_on_dependency", label: "Waiting" },
                { v: "theoretical", label: "Theoretical" },
                { v: "blocked", label: "Blocked" },
              ]}
            />
            {presentCategories.length > 0 && (
              <ChipRow
                label="Category"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { v: "all", label: "All" },
                  ...presentCategories.map((c) => ({ v: c, label: capitalize(c) })),
                ]}
              />
            )}
          </div>
        )}

        {/* Body */}
        {filtered.length === 0 ? (
          merged.length === 0 ? (
            <EmptyState onCreateNew={onCreateNew} />
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white/70 p-8 text-center text-[13px] text-gray-500">
              No whiteboards match the current filters.
            </div>
          )
        ) : (
          <Grid
            spaces={filtered}
            mode={mode}
            onSelect={onSelect}
            onPin={(id, pinned) => patchSpace(id, { pinned })}
            onArchive={(id, archived) => patchSpace(id, { archived })}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-gray-900 px-3.5 py-1 text-white"
          : "rounded-full px-3.5 py-1 text-gray-500 hover:text-gray-800"
      }
    >
      {children}
    </button>
  );
}

function ChipRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ v: string; label: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-[62px] flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
            value === o.v
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-200 bg-white/80 text-gray-600 hover:border-gray-300 hover:text-gray-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ onCreateNew }: { onCreateNew?: () => void }) {
  return (
    <div
      className="rounded-3xl border border-gray-200/80 bg-white/90 p-12 text-center shadow-sm"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(20,30,50,0.04) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-purple-50 ring-1 ring-blue-200">
        <Sparkles className="h-6 w-6 text-blue-600" />
      </div>
      <h2 className="mb-2 text-[18px] font-semibold tracking-tight text-gray-900">
        No whiteboards yet
      </h2>
      <p className="mx-auto mb-6 max-w-md text-[13px] leading-relaxed text-gray-500">
        Describe a situation on a blank canvas. The pipeline decomposes it into
        entities, traces causal edges, detects cycles, and ranks strategies —
        all materializing in real time as you watch.
      </p>
      {onCreateNew && (
        <button
          type="button"
          onClick={onCreateNew}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Start first analysis
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function Grid({
  spaces,
  mode,
  onSelect,
  onPin,
  onArchive,
}: {
  spaces: Space[];
  mode: WhiteboardsGridMode;
  onSelect?: (space: Space) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string, archived: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {spaces.map((s) => (
        <WhiteboardCard
          key={s.id}
          space={s}
          mode={mode}
          onSelect={onSelect}
          onPin={onPin}
          onArchive={onArchive}
        />
      ))}
    </div>
  );
}

function WhiteboardCard({
  space,
  mode,
  onSelect,
  onPin,
  onArchive,
}: {
  space: Space;
  mode: WhiteboardsGridMode;
  onSelect?: (space: Space) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string, archived: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const snippet =
    space.description ??
    (space.input_text ? space.input_text.slice(0, 140) : null);
  const updated = formatRelative(space.updated_at);
  const entityCount = space.entity_count ?? 0;
  const edgeCount = space.edge_count ?? 0;
  const isAsk = space.kind === "ask";
  const category = space.dominant_entity_category ?? null;
  const accent = category ? CATEGORY_ACCENTS[category] ?? "#64748b" : "#64748b";

  const cardClass = cn(
    "group relative flex flex-col rounded-2xl border bg-white/90 p-5 text-left shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
    space.pinned
      ? "border-amber-300 ring-1 ring-amber-100"
      : "border-gray-200/80 hover:border-blue-200",
    space.archived && "opacity-70",
    isPending && "pointer-events-none",
  );

  // Intercept plain clicks so we can show a per-card "Opening…" overlay
  // while the destination route is being fetched. Modifier / middle clicks
  // fall through to the native Link behavior (open in new tab, etc.).
  function handleNavigate(e: React.MouseEvent) {
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      e.button === 1
    ) {
      return;
    }
    e.preventDefault();
    startTransition(() => {
      // Cards in the home grid land on the Synthesis Lab (universal
      // entry surface). The lab autoroutes to triple-lab via the
      // space root redirect, so we go direct to skip the bounce.
      router.push(`/app/space/${space.id}/triple-lab`);
    });
  }

  const inner = (
    <>
      {/* Loading overlay — shown while the destination route is resolving. */}
      {isPending && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/70 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-900/90 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg">
            <Loader2 className="h-3 w-3 animate-spin" />
            Opening…
          </div>
        </div>
      )}
      {/* Curate row — pin / archive (browse mode only). Sits above the
          card body so it never overlaps content. Stops propagation so
          clicking a button doesn't navigate. */}
      {mode === "browse" && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <CurateButton
            label={space.pinned ? "Unpin" : "Pin"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPin(space.id, !space.pinned);
            }}
          >
            {space.pinned ? (
              <PinOff className="h-3 w-3" />
            ) : (
              <Pin className="h-3 w-3" />
            )}
          </CurateButton>
          <CurateButton
            label={space.archived ? "Restore" : "Archive"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onArchive(space.id, !space.archived);
            }}
          >
            {space.archived ? (
              <ArchiveRestore className="h-3 w-3" />
            ) : (
              <Archive className="h-3 w-3" />
            )}
          </CurateButton>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm"
          style={{
            background: "linear-gradient(145deg, #4fa3ff, #0051ff)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.4), 0 3px 8px rgba(0,50,180,0.18)",
          }}
        >
          {space.space_prefix ??
            (space.name ?? "SP").slice(0, 2).toUpperCase()}
        </span>
        <span className="text-[10.5px] font-medium text-gray-400">
          {updated}
        </span>
      </div>

      <h3 className="mb-1.5 line-clamp-1 text-[14.5px] font-semibold tracking-tight text-gray-900 group-hover:text-blue-900">
        {space.name}
      </h3>

      {/* Badge row — kind + dominant category. Inline so the user
          can scan the grid by color/label without opening anything. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge
          icon={
            isAsk ? (
              <MessageCircleQuestion className="h-2.5 w-2.5" />
            ) : (
              <Sparkles className="h-2.5 w-2.5" />
            )
          }
          color={isAsk ? "#a855f7" : "#0ea5e9"}
        >
          {isAsk ? "Ask" : "Create"}
        </Badge>
        {category && (
          <Badge color={accent}>{capitalize(category)}</Badge>
        )}
        {space.pinned && (
          <Badge color="#d97706">
            <Pin className="h-2.5 w-2.5" />
            Pinned
          </Badge>
        )}
      </div>

      {snippet && (
        <p className="mb-4 line-clamp-3 text-[12px] leading-relaxed text-gray-500">
          {snippet}
        </p>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1">
          <Layers className="h-3 w-3 text-gray-400" />
          <strong className="font-semibold tabular-nums text-gray-700">
            {entityCount}
          </strong>
          entities
        </span>
        <span className="inline-flex items-center gap-1">
          <Network className="h-3 w-3 text-gray-400" />
          <strong className="font-semibold tabular-nums text-gray-700">
            {edgeCount}
          </strong>
          edges
        </span>
      </div>
    </>
  );

  if (mode === "select" && onSelect) {
    return (
      <button type="button" onClick={() => onSelect(space)} className={cardClass}>
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={`/app/space/${space.id}/triple-lab`}
      onClick={handleNavigate}
      aria-busy={isPending}
      className={cardClass}
    >
      {inner}
    </Link>
  );
}

function CurateButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-500 shadow-sm transition-colors hover:border-gray-300 hover:text-gray-900"
    >
      {children}
    </button>
  );
}

function Badge({
  color,
  icon,
  children,
}: {
  color: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color: color,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const now = Date.now();
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWk = Math.round(diffDay / 7);
  if (diffWk < 4) return `${diffWk}w ago`;
  const diffMo = Math.round(diffDay / 30);
  return `${diffMo}mo ago`;
}
