"use client";

// ── KG communities overview chip (D8) ────────────────────────────────
//
// Floating top-left overlay (sibling of ResearchLibraryChip) that
// surfaces the modularity-greedy community partitions decompose
// already computed and persisted to kg_communities. Each row is the
// LLM-generated rollup title + member count + click → zoom to that
// community's entities on canvas.
//
// Default-collapses to a tiny pill: "🧩 N communities". Expand →
// per-community list grouped by level (level 0 = root partitions
// first, then nested levels). One-shot fetch on mount, cached for
// the chip's lifetime.
//
// Same UX pattern as the research-library-chip:
//   1. Hidden when there are no communities (decompose hasn't run, or
//      the space is too small for partitioning).
//   2. Click a row → editor.zoomToSelection on member entities.
//   3. Mounted via InFrontOfTheCanvas so it has editor context.

import { useEffect, useMemo, useState } from "react";
import { useEditor, type TLShapeId } from "tldraw";
import { ChevronDown, Eye, Loader2, Network, Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommunitySummary {
  title: string | null;
  rating: number | null;
  finding_count: number;
}

interface Community {
  id: string;
  parent_community_id: string | null;
  level: number;
  entity_ids: string[];
  edge_ids: string[];
  summary: CommunitySummary | null;
  modularity_contribution: number | null;
}

export function CommunitiesChip({ spaceId }: { spaceId: string }) {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [communities, setCommunities] = useState<Community[]>([]);

  useEffect(() => {
    if (!spaceId) return;
    const ctrl = new AbortController();
    setLoading(true);
    setErrored(false);
    fetch(`/api/spaces/${encodeURIComponent(spaceId)}/communities`, {
      signal: ctrl.signal,
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) return { communities: [] };
        try {
          return await r.json();
        } catch {
          return { communities: [] };
        }
      })
      .then((data: { communities?: Community[] }) => {
        setCommunities(
          Array.isArray(data?.communities) ? data.communities : [],
        );
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setErrored(true);
        setCommunities([]);
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [spaceId]);

  const sorted = useMemo(() => {
    // Group by level (level 0 first), then within each level sort by
    // descending member count so the biggest partitions surface first.
    const out = communities.slice();
    out.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return b.entity_ids.length - a.entity_ids.length;
    });
    return out;
  }, [communities]);

  const totalEntities = useMemo(() => {
    // Level-0 entity union — sums entity counts across just the root
    // partitions so the headline figure isn't inflated by
    // sub-communities that re-partition the same nodes.
    let total = 0;
    for (const c of communities) {
      if (c.level === 0) total += c.entity_ids.length;
    }
    return total;
  }, [communities]);

  if (!loading && communities.length === 0) return null;

  const handleHighlight = (community: Community) => {
    if (community.entity_ids.length === 0) return;
    const want = new Set(community.entity_ids);
    const matched: TLShapeId[] = [];
    for (const s of editor.getCurrentPageShapes()) {
      if (s.type !== "kg-node") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eid = (s.props as any)?.entityId;
      if (typeof eid === "string" && want.has(eid)) {
        matched.push(s.id);
      }
    }
    if (matched.length === 0) return;
    editor.select(...matched);
    editor.zoomToSelection({ animation: { duration: 380 } });
  };

  return (
    <div
      // Position below the ResearchLibraryChip (which uses top-4). We
      // pad ourselves down ~44px so the two chips stack cleanly even
      // when the library chip is collapsed.
      className="pointer-events-auto absolute left-4 top-[3.25rem] z-[35]"
      aria-label="KG communities"
    >
      <div
        className={cn(
          "rounded-lg border border-emerald-200 bg-white/95 shadow-sm backdrop-blur",
          open ? "w-72" : "w-auto",
        )}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50"
          title={
            open
              ? "Collapse communities"
              : "Expand to see graph community partitions"
          }
        >
          <Network className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-shrink-0">{communities.length}</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {communities.length === 1 ? "community" : "communities"}
          </span>
          <span className="flex-shrink-0 text-slate-300">·</span>
          <span className="text-[10px] text-slate-600">
            {totalEntities} entities
          </span>
          <ChevronDown
            className={cn(
              "ml-auto h-3 w-3 flex-shrink-0 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {open && (
          <div className="border-t border-slate-100 px-2 pb-2 pt-1.5">
            {loading && communities.length === 0 ? (
              <div className="flex items-center gap-1.5 px-1 py-2 text-[10px] text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </div>
            ) : errored ? (
              <div className="px-1 py-2 text-[10px] italic text-rose-600">
                Couldn&apos;t load communities.
              </div>
            ) : (
              <ul className="space-y-0.5">
                {sorted.map((c) => {
                  const title =
                    c.summary?.title && c.summary.title.trim().length > 0
                      ? c.summary.title.trim()
                      : `Community · L${c.level}`;
                  const memberCount = c.entity_ids.length;
                  const rating = c.summary?.rating;
                  // Indent sub-communities so the hierarchy is visible
                  // at a glance. Level 0 = no indent; deeper levels
                  // accumulate.
                  const indentPx = c.level * 10;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handleHighlight(c)}
                        className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[10px] text-slate-700 transition hover:bg-emerald-50"
                        title={`${title} — ${memberCount} entit${memberCount === 1 ? "y" : "ies"}${rating !== null && rating !== undefined ? ` · rating ${rating}/10` : ""} — click to zoom`}
                        style={{ paddingLeft: `${6 + indentPx}px` }}
                      >
                        <Eye className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 text-emerald-500" />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate",
                              c.summary?.title
                                ? "font-medium text-slate-800"
                                : "font-mono text-slate-500",
                            )}
                          >
                            {title}
                          </span>
                          {c.summary?.finding_count ? (
                            <span className="block truncate text-[9px] text-slate-500">
                              {c.summary.finding_count} finding
                              {c.summary.finding_count === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </span>
                        {rating !== null && rating !== undefined && (
                          <span
                            className="flex-shrink-0 self-center text-[9px] text-amber-600"
                            title={`GraphRAG-style rating: ${rating}/10`}
                          >
                            <Star
                              className="inline h-2.5 w-2.5"
                              strokeWidth={2.5}
                            />
                            {rating}
                          </span>
                        )}
                        <span className="flex-shrink-0 self-center font-semibold text-slate-700">
                          📦 {memberCount}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
