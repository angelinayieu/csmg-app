"use client";

// ── Research Library overview chip (P4) ──────────────────────────────
//
// Floating top-left overlay that aggregates every paper in the space
// into a single readable summary:
//
//   Collapsed:  📚 N papers · X entities · M edges
//   Expanded:   per-paper rows with stats + click-to-highlight
//
// Same data source as AssetCardShape's per-card stats row
// (CanvasAssetDerivedEntitiesContext). One read, no new fetches.
//
// Click a row → finds every kg-node-shape whose entityId matches one
// derived from that paper, selects + zooms the camera. Mirrors the
// AssetHighlightButton pattern so behavior is consistent with what
// users already learned from clicking the per-card "👁 N on canvas"
// pill. The chip itself sits in the InFrontOfTheCanvas slot so it has
// editor context.

import { useMemo, useState } from "react";
import { useEditor, type TLShapeId } from "tldraw";
import { BookOpen, ChevronDown, Eye, Loader2 } from "lucide-react";
import { useCanvasAssetDerivedEntities } from "../canvas-asset-derived-entities-context";
import type {
  AssetMetadata,
  AssetPaperMetadata,
} from "../hooks/use-asset-derived-entities";
import { cn } from "@/lib/utils";

interface ResearchLibraryRow {
  assetId: string;
  entityCount: number;
  novelEntityCount: number;
  edgeCount: number;
  /** P6 · resolved bibliographic + filename info. May be undefined
   *  when the asset-metadata fetch is still in flight or the asset
   *  was deleted. */
  metadata: AssetMetadata | undefined;
}

/** P6 · pick the most readable label for a paper across its
 *  bibliographic title → uploaded filename → assetId stub. */
function paperLabel(
  assetId: string,
  metadata: AssetMetadata | undefined,
): string {
  const title = metadata?.paper_metadata?.title;
  if (typeof title === "string" && title.trim().length > 0) return title.trim();
  const sn = metadata?.source_name;
  if (typeof sn === "string" && sn.trim().length > 0) return sn.trim();
  return `${assetId.slice(0, 8)}…`;
}

/** Compact authors+year line: "Smith et al. 2023" or null. */
function paperByline(meta: AssetPaperMetadata | null | undefined): string | null {
  if (!meta) return null;
  const yearStr = meta.year ? ` ${meta.year}` : "";
  const a = meta.authors ?? [];
  if (a.length === 0) {
    return yearStr.trim().length > 0 ? yearStr.trim() : null;
  }
  if (a.length === 1) return `${a[0]}${yearStr}`;
  if (a.length === 2) return `${a[0]} & ${a[1]}${yearStr}`;
  return `${a[0]} et al.${yearStr}`;
}

export function ResearchLibraryChip() {
  const editor = useEditor();
  const { index } = useCanvasAssetDerivedEntities();
  const [open, setOpen] = useState(false);

  const rows = useMemo<ResearchLibraryRow[]>(() => {
    const out: ResearchLibraryRow[] = [];
    for (const [assetId, stats] of index.statsByAssetId) {
      if (stats.entityCount === 0 && stats.edgeCount === 0) continue;
      out.push({
        assetId,
        entityCount: stats.entityCount,
        novelEntityCount: stats.novelEntityCount,
        edgeCount: stats.edgeCount,
        metadata: index.metadataByAssetId.get(assetId),
      });
    }
    // Highest-contribution papers first (entities + edges as a rough
    // total-impact heuristic; ties broken by edges-only).
    out.sort((a, b) => {
      const aw = a.entityCount + a.edgeCount;
      const bw = b.entityCount + b.edgeCount;
      if (bw !== aw) return bw - aw;
      return b.edgeCount - a.edgeCount;
    });
    return out;
  }, [index.statsByAssetId, index.metadataByAssetId]);

  const totals = useMemo(() => {
    let entities = 0;
    let edges = 0;
    let novel = 0;
    for (const r of rows) {
      entities += r.entityCount;
      edges += r.edgeCount;
      novel += r.novelEntityCount;
    }
    return { entities, edges, novel };
  }, [rows]);

  // Hide entirely until any paper has produced something. Avoids a
  // stale 0/0/0 chip in fresh spaces with no extracted assets.
  if (rows.length === 0 && !index.loading) return null;

  const handleHighlight = (assetId: string) => {
    const derived = index.byAssetId.get(assetId) ?? [];
    if (derived.length === 0) return;
    const derivedIds = new Set(derived.map((d) => d.id));
    const matched: TLShapeId[] = [];
    for (const s of editor.getCurrentPageShapes()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = s.props as any;
      if (s.type === "kg-node") {
        const eid = props?.entityId;
        if (typeof eid === "string" && derivedIds.has(eid)) {
          matched.push(s.id);
        }
      } else if (s.type === "asset-card") {
        const aid = props?.assetId;
        if (typeof aid === "string" && aid === assetId) {
          matched.push(s.id);
        }
      }
    }
    if (matched.length === 0) return;
    editor.select(...matched);
    editor.zoomToSelection({ animation: { duration: 380 } });
  };

  return (
    <div
      className="pointer-events-auto absolute left-4 top-4 z-[35]"
      aria-label="Research library"
    >
      <div
        className={cn(
          "rounded-lg border border-violet-200 bg-white/95 shadow-sm backdrop-blur",
          open ? "w-72" : "w-auto",
        )}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-50"
          title={
            open
              ? "Collapse research library"
              : "Expand research library to see per-paper stats"
          }
        >
          <BookOpen className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-shrink-0">{rows.length}</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {rows.length === 1 ? "paper" : "papers"}
          </span>
          <span className="flex-shrink-0 text-slate-300">·</span>
          <span className="text-[10px] text-slate-600">
            {totals.entities} entities
          </span>
          <span className="flex-shrink-0 text-slate-300">·</span>
          <span className="text-[10px] text-slate-600">
            {totals.edges} edges
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
            {index.loading && rows.length === 0 ? (
              <div className="flex items-center gap-1.5 px-1 py-2 text-[10px] text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </div>
            ) : (
              <ul className="space-y-0.5">
                {rows.map((r) => {
                  const sharedCount = Math.max(
                    0,
                    r.entityCount - r.novelEntityCount,
                  );
                  const label = paperLabel(r.assetId, r.metadata);
                  const byline = paperByline(r.metadata?.paper_metadata);
                  // When we have a real title/filename, drop the
                  // monospace asset-id styling. Mono only for fallback
                  // hex stubs so they read as ids, not titles.
                  const labelIsAssetIdStub =
                    !r.metadata?.paper_metadata?.title &&
                    !r.metadata?.source_name;
                  return (
                    <li key={r.assetId}>
                      <button
                        type="button"
                        onClick={() => handleHighlight(r.assetId)}
                        className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[10px] text-slate-700 transition hover:bg-violet-50"
                        title={`${label}${byline ? ` · ${byline}` : ""} — click to zoom + highlight this paper's contributions on canvas`}
                      >
                        <Eye className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 text-violet-500" />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate",
                              labelIsAssetIdStub
                                ? "font-mono text-slate-500"
                                : "font-medium text-slate-800",
                            )}
                          >
                            {label}
                          </span>
                          {byline && (
                            <span className="block truncate text-[9px] text-slate-500">
                              {byline}
                            </span>
                          )}
                        </span>
                        <span className="flex-shrink-0 self-center font-semibold text-slate-700">
                          📦 {r.entityCount}
                        </span>
                        {sharedCount > 0 && (
                          <span
                            className="flex-shrink-0 self-center text-[9px] text-slate-400"
                            title={`${sharedCount} of these are also referenced by other papers`}
                          >
                            {sharedCount}↔
                          </span>
                        )}
                        <span className="flex-shrink-0 self-center font-semibold text-slate-700">
                          🔗 {r.edgeCount}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {totals.novel > 0 && totals.entities > 0 && (
              <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-[9px] italic text-slate-400">
                {totals.novel} of {totals.entities} entities are unique to a
                single paper · {totals.entities - totals.novel} are shared
                across papers
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
