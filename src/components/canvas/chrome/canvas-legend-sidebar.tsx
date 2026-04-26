"use client";

// ── Canvas legend sidebar (Phase 3) ──
//
// Collapsible right-rail panel that does three jobs:
//   1. Shows the user what every color on the canvas means (kind +
//      layer color swatches with names) — answers "what am I looking
//      at" before they have to learn the system.
//   2. Surfaces counts per category so the canvas reads as a
//      distribution at a glance ("Concepts 25 · Tools 4 · Metrics 3").
//   3. Provides a one-click filter — toggle a kind/layer/axis chip
//      to dim everything else on the canvas. Driven by useCanvasFilter.
//
// Data sources:
//   - Kind + layer counts: GET /api/spaces/[id]/entities/catalog
//     (returns enriched EntityCatalogEntry[] with `kind` already
//     classified server-side). One fetch per mount.
//   - Axes: read live from the tldraw store — every shape of type
//     "probability-space-shell" carries its axis label as a prop.
//     Re-reads on demand via a tldraw store subscription.
//
// Always-collapsible: starts closed by default to avoid stealing
// canvas real estate; user opens via the floating ⓘ button.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditor } from "tldraw";
import {
  Layers,
  X,
  Filter,
  ChevronRight,
  Palette,
  Loader2,
  LayoutGrid,
  Layers3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ENTITY_KIND_ACCENT,
  ENTITY_KIND_LABEL,
  type EntityKind,
} from "@/lib/entities/kind-classifier";
import {
  LAYERS,
  LAYER_ORDER,
  depthToLayerId,
  type LayerId,
} from "@/lib/whiteboard/layer-config";
import {
  useCanvasFilter,
  useAnyFilterActive,
} from "../hooks/use-canvas-filter";
import type { EntityCatalogEntry } from "@/app/api/spaces/[id]/entities/catalog/route";

interface AxisInfo {
  axis: string;
  label: string;
  accent: string;
  count: number;
}

interface Props {
  spaceId: string;
}

export function CanvasLegendSidebar({ spaceId }: Props) {
  const [open, setOpen] = useState(false);
  const [catalogRows, setCatalogRows] = useState<EntityCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Filter state (read + actions)
  const selectedKinds = useCanvasFilter((s) => s.selectedKinds);
  const selectedLayers = useCanvasFilter((s) => s.selectedLayers);
  const selectedAxes = useCanvasFilter((s) => s.selectedAxes);
  const toggleKind = useCanvasFilter((s) => s.toggleKind);
  const toggleLayer = useCanvasFilter((s) => s.toggleLayer);
  const toggleAxis = useCanvasFilter((s) => s.toggleAxis);
  const clearAll = useCanvasFilter((s) => s.clearAll);
  const anyActive = useAnyFilterActive();
  // Phase 7 — shell layout mode (side-by-side / stacked landscapes).
  const shellLayoutMode = useCanvasFilter((s) => s.shellLayoutMode);
  const setShellLayoutMode = useCanvasFilter((s) => s.setShellLayoutMode);

  // ── Catalog fetch (kind + layer counts) ────────────────────────
  // Refetches on demand when sidebar opens; cached after first load.
  useEffect(() => {
    if (!open || catalogRows.length > 0) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/spaces/${spaceId}/entities/catalog`, {
      credentials: "include",
    })
      .then(async (r) => (r.ok ? r.json() : { entities: [] }))
      .then((json) => {
        if (cancelled) return;
        const rows = Array.isArray(json?.entities)
          ? (json.entities as EntityCatalogEntry[])
          : [];
        setCatalogRows(rows);
      })
      .catch(() => {
        // soft-fail — sidebar still renders with zero counts
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, spaceId, catalogRows.length]);

  // ── Counts derived from catalog ────────────────────────────────
  const kindCounts = useMemo(() => {
    const m = new Map<EntityKind, number>();
    for (const r of catalogRows) {
      if (r.kind) m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
    }
    return m;
  }, [catalogRows]);

  const layerCounts = useMemo(() => {
    const m = new Map<LayerId, number>();
    for (const r of catalogRows) {
      const layerId =
        typeof r.depth === "number"
          ? depthToLayerId(r.depth)
          : depthToLayerId(2);
      m.set(layerId, (m.get(layerId) ?? 0) + 1);
    }
    return m;
  }, [catalogRows]);

  // ── Axes from tldraw store (live shells only) ──────────────────
  const editor = useEditor();
  const [axes, setAxes] = useState<AxisInfo[]>([]);

  const refreshAxes = useCallback(() => {
    if (!editor) return;
    const seen = new Map<string, AxisInfo>();
    for (const shape of editor.getCurrentPageShapes()) {
      if (shape.type !== "probability-space-shell") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (shape as any).props as {
        axis?: string;
        label?: string;
        accent?: string;
        entitiesJson?: string;
      };
      const axisKey = props.axis ?? props.label ?? "(axis)";
      let count = 0;
      try {
        const parsed = JSON.parse(props.entitiesJson ?? "[]");
        if (Array.isArray(parsed)) count = parsed.length;
      } catch {
        /* ignore */
      }
      seen.set(axisKey, {
        axis: axisKey,
        label: props.label ?? axisKey,
        accent: props.accent ?? "#64748b",
        count,
      });
    }
    setAxes(Array.from(seen.values()));
  }, [editor]);

  useEffect(() => {
    if (!open || !editor) return;
    refreshAxes();
    // Listen to store changes so axis chips refresh as shells get
    // entities added live during a run.
    const dispose = editor.store.listen(refreshAxes, {
      source: "all",
      scope: "all",
    });
    return () => dispose();
  }, [open, editor, refreshAxes]);

  // ── Render ──────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed right-3 top-1/2 z-[55] -translate-y-1/2 rounded-l-lg border border-r-0 border-slate-200 bg-white px-2 py-3 shadow-md transition hover:bg-slate-50",
          anyActive && "bg-violet-50 border-violet-200",
        )}
        title="Open legend & filters"
        aria-label="Open canvas legend"
      >
        <div className="flex flex-col items-center gap-1">
          <Palette
            className={cn(
              "h-3.5 w-3.5",
              anyActive ? "text-violet-600" : "text-slate-500",
            )}
          />
          {anyActive && (
            <span className="block h-1 w-1 rounded-full bg-violet-500" />
          )}
        </div>
      </button>
    );
  }

  return (
    <aside
      className="fixed right-0 top-0 z-[55] flex h-screen w-[280px] flex-col border-l border-slate-200 bg-white shadow-[0_24px_48px_-16px_rgba(15,23,42,0.12)]"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      aria-label="Canvas legend and filters"
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Palette className="h-3.5 w-3.5 text-violet-600" />
          <h2 className="text-[12px] font-semibold text-slate-900">
            Legend & filters
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close legend"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* Active filters summary + clear */}
      {anyActive && (
        <div className="flex items-center justify-between border-b border-slate-100 bg-violet-50 px-4 py-2 text-[10.5px] text-violet-700">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Filter className="h-3 w-3" />
            Filtering active
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="rounded px-2 py-0.5 text-[10px] font-semibold underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Kinds */}
        <Section
          title="Kinds"
          subtitle={
            loading ? "loading…" : `${catalogRows.length} entities total`
          }
          icon={
            loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : undefined
          }
        >
          <ul className="space-y-1">
            {(Object.keys(ENTITY_KIND_LABEL) as EntityKind[]).map((kind) => {
              const accent = ENTITY_KIND_ACCENT[kind];
              const count = kindCounts.get(kind) ?? 0;
              const selected = selectedKinds.has(kind);
              const dim = selectedKinds.size > 0 && !selected;
              return (
                <li key={kind}>
                  <button
                    type="button"
                    onClick={() => toggleKind(kind)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition",
                      selected
                        ? "bg-slate-100 ring-1 ring-slate-300"
                        : "hover:bg-slate-50",
                      dim && "opacity-50",
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ background: accent }}
                    />
                    <span className="flex-1 font-medium text-slate-700">
                      {ENTITY_KIND_LABEL[kind]}
                    </span>
                    <span className="font-mono tabular-nums text-[10.5px] text-slate-500">
                      {count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>

        {/* Layers */}
        <Section
          title="Layers"
          subtitle="Depth in the system"
          collapsedByDefault={false}
        >
          <ul className="space-y-1">
            {LAYER_ORDER.map((layerId) => {
              const cfg = LAYERS[layerId];
              const count = layerCounts.get(layerId) ?? 0;
              const selected = selectedLayers.has(layerId);
              const dim = selectedLayers.size > 0 && !selected;
              return (
                <li key={layerId}>
                  <button
                    type="button"
                    onClick={() => toggleLayer(layerId)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition",
                      selected
                        ? "bg-slate-100 ring-1 ring-slate-300"
                        : "hover:bg-slate-50",
                      dim && "opacity-50",
                    )}
                  >
                    <span
                      className="flex h-4 w-6 flex-shrink-0 items-center justify-center rounded text-[8px] font-bold text-white"
                      style={{ background: cfg.color }}
                    >
                      {cfg.shortLabel}
                    </span>
                    <span className="flex-1 truncate font-medium text-slate-700">
                      {cfg.label}
                    </span>
                    <span className="font-mono tabular-nums text-[10.5px] text-slate-500">
                      {count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>

        {/* Axes — populated from currently-painted shells */}
        {axes.length > 0 && (
          <Section
            title="Axes"
            subtitle={`${axes.length} active lens${axes.length === 1 ? "" : "es"}`}
          >
            <ul className="space-y-1">
              {axes.map((a) => {
                const selected = selectedAxes.has(a.axis);
                const dim = selectedAxes.size > 0 && !selected;
                return (
                  <li key={a.axis}>
                    <button
                      type="button"
                      onClick={() => toggleAxis(a.axis)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition",
                        selected
                          ? "bg-slate-100 ring-1 ring-slate-300"
                          : "hover:bg-slate-50",
                        dim && "opacity-50",
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ background: a.accent }}
                      />
                      <span className="flex-1 truncate font-medium text-slate-700">
                        {a.label}
                      </span>
                      <span className="font-mono tabular-nums text-[10.5px] text-slate-500">
                        {a.count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {/* Phase 7 — shell layout toggle. "Side" = peer row (default).
            "Stack" makes non-soloed shells visually recede into the
            background so the soloed lens reads as the focused
            landscape — the user's "3D layered landscapes" mental
            model. Pair with axis-solo above to focus a single lens. */}
        <Section
          title="Shell layout"
          subtitle="How probability-space lenses arrange themselves"
        >
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setShellLayoutMode("side")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[10.5px] font-medium transition",
                shellLayoutMode === "side"
                  ? "border-violet-300 bg-violet-50 text-violet-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
              title="Default — every axis lens renders as a peer in a row."
            >
              <LayoutGrid className="h-3 w-3" />
              Side
            </button>
            <button
              type="button"
              onClick={() => setShellLayoutMode("stack")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[10.5px] font-medium transition",
                shellLayoutMode === "stack"
                  ? "border-violet-300 bg-violet-50 text-violet-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
              title="Recede non-soloed lenses behind the focused one. Pair with an axis solo above for full effect."
            >
              <Layers3 className="h-3 w-3" />
              Stack
            </button>
          </div>
          {shellLayoutMode === "stack" && selectedAxes.size === 0 && (
            <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[9.5px] text-amber-700">
              Solo an axis above to make the stack effect visible.
            </div>
          )}
        </Section>

        {/* Footer note */}
        <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
          Click any chip to highlight that category across the canvas. Click
          again to deselect. Multiple chips combine with OR semantics.
        </div>
      </div>
    </aside>
  );
}

function Section({
  title,
  subtitle,
  icon,
  children,
  collapsedByDefault = false,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  collapsedByDefault?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(collapsedByDefault);
  return (
    <section className="mb-4 last:mb-0">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="mb-2 flex w-full items-center gap-1.5"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-slate-400 transition-transform",
            !collapsed && "rotate-90",
          )}
        />
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          {icon}
          {title}
        </span>
        {subtitle && (
          <span className="ml-auto text-[10px] text-slate-400">{subtitle}</span>
        )}
      </button>
      {!collapsed && children}
    </section>
  );
}

// Layers icon kept as a re-export so future surfaces that want to
// render a layer chip with the same icon can reuse it without
// re-importing lucide.
export { Layers as LayersIcon };
