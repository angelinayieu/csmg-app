"use client";

// ── Canvas Asset Drawer v2 — Universal Catalog ──
//
// Phase A1.0–A1.4: multi-class library drawer.
// Phase A1.5 additions:
//   - Cross-class search: typing updates every tab's count so users
//     can see where a term matches before switching
//   - Filter chips: each class's registry-declared filters now render
//     as toggleable chips below the search input
//   - "Switch to matching tab" affordance when the current tab has
//     no matches but another one does
//
// Search + filter state is per-drawer-instance. Filters live per-tab
// so switching tabs doesn't reset the current tab's selections.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GripVertical,
  Search,
  X,
  CheckCircle2,
  ArrowRight,
  List,
  Sparkles,
  Beaker,
  Link2,
  Table2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";
import { ASSET_CLASSES, getAssetClass } from "../library/asset-class-registry";
import { useCanvasAssetCatalog } from "../library/canvas-asset-catalog-context";
import {
  ASSET_CLASS_GROUP_LABEL,
  ASSET_CLASS_GROUP_ORDER,
  LIBRARY_ASSET_MIME,
  type AssetClass,
  type AssetClassDefinition,
  type AssetClassGroup,
  type CatalogItem,
  type LibraryRow,
} from "../library/types";
import { ENTITY_DRAG_MIME, type EntityDragPayload } from "./canvas-asset-drawer";
import {
  DefaultInsightsPlaceholder,
  INSIGHTS_RENDERERS,
  useInsightsSummary,
} from "../library/insights-renderers";
import { EntityTableView } from "./entity-table-view";
import type { EntityCatalogEntry } from "@/app/api/spaces/[id]/entities/catalog/route";
import { GlassPanel } from "@/components/ui/glass-panel";
import { AccentChip } from "@/components/ui/accent-chip";
import { SoftIcon } from "@/components/ui/soft-icon";
import { useEntityCatalogMeta } from "../library/use-entity-catalog-meta";

export interface CanvasAssetDrawerV2Props {
  open: boolean;
  /** Already-placed shape ids on the canvas, used to render checkmarks. */
  placedShapeIds: Set<string>;
  /** Entities passed from the page (seeded into the catalog so we don't refetch). */
  entities: Entity[];
  /** Map of space_id → display name for the entity rows' subtitle. */
  spaceNameById: Map<string, string>;
  onClose: () => void;
}

/**
 * Per-tab filter selection. Outer key = asset class, inner key = filter
 * group key, value = set of enabled option values. Empty set on any
 * group = all values pass (no-op).
 */
type FilterState = Record<AssetClass, Record<string, Set<string>>>;

function emptyFilterState(): FilterState {
  return {} as FilterState;
}

/**
 * Folder-dock tab (Phase A1.8 · U3). Each selected asset class
 * ("folder") exposes four views. Details preserves the existing row
 * list + filters; the other three surface class-scoped insights, lab
 * affordances, and cross-class connections.
 *
 * Switching classes resets the dock tab to "details" — users almost
 * always want to see Details of a freshly selected class first.
 */
type DockTab = "details" | "insights" | "lab" | "connections";

/**
 * View-mode inside the Details tab (Phase A1.9). Different asset
 * classes will eventually support more modes (Chains, Ranked, Graph);
 * List + Table are the two that cover 80% of use cases and ship first.
 * Kept per-class in state so switching classes preserves each class's
 * preferred view.
 */
type DetailsViewMode = "list" | "table";

const DOCK_TABS: Array<{
  id: DockTab;
  label: string;
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>;
}> = [
  { id: "details", label: "Details", icon: List },
  { id: "insights", label: "Insights", icon: Sparkles },
  { id: "lab", label: "Lab", icon: Beaker },
  { id: "connections", label: "Connections", icon: Link2 },
];

export function CanvasAssetDrawerV2({
  open,
  placedShapeIds,
  entities,
  spaceNameById,
  onClose,
}: CanvasAssetDrawerV2Props) {
  const catalog = useCanvasAssetCatalog();
  const [activeTab, setActiveTab] = useState<AssetClass>("entity");
  const [dockTab, setDockTabRaw] = useState<DockTab>("details");
  const [detailsViewMode, setDetailsViewMode] =
    useState<DetailsViewMode>("list");
  const [query, setQuery] = useState("");
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());

  // Switching asset class resets the dock to Details — otherwise users
  // see stale Insights rendered for the last class they were viewing.
  const setActiveTabWithReset = useCallback((next: AssetClass) => {
    setActiveTab(next);
    setDockTabRaw("details");
  }, []);

  // Seed the entity tab from the page-loaded entities so we don't
  // round-trip the network for data the page already has.
  useEffect(() => {
    if (entities.length > 0) {
      catalog.seed("entity", entities as unknown as CatalogItem[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities]);

  // Trigger lazy fetch whenever the active tab changes (idempotent).
  useEffect(() => {
    if (!open) return;
    catalog.ensure(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, open]);

  const toggleFilter = useCallback(
    (cls: AssetClass, key: string, value: string) => {
      setFilterState((prev) => {
        const clsEntry = { ...(prev[cls] ?? {}) };
        const set = new Set(clsEntry[key] ?? []);
        if (set.has(value)) set.delete(value);
        else set.add(value);
        clsEntry[key] = set;
        return { ...prev, [cls]: clsEntry };
      });
    },
    [],
  );

  const clearFiltersFor = useCallback((cls: AssetClass) => {
    setFilterState((prev) => ({ ...prev, [cls]: {} }));
  }, []);

  if (!open) return null;

  return <DrawerBody
    activeTab={activeTab}
    setActiveTab={setActiveTabWithReset}
    dockTab={dockTab}
    setDockTab={setDockTabRaw}
    detailsViewMode={detailsViewMode}
    setDetailsViewMode={setDetailsViewMode}
    query={query}
    setQuery={setQuery}
    filterState={filterState}
    toggleFilter={toggleFilter}
    clearFiltersFor={clearFiltersFor}
    placedShapeIds={placedShapeIds}
    spaceNameById={spaceNameById}
    onClose={onClose}
  />;
}

function DrawerBody({
  activeTab,
  setActiveTab,
  dockTab,
  setDockTab,
  detailsViewMode,
  setDetailsViewMode,
  query,
  setQuery,
  filterState,
  toggleFilter,
  clearFiltersFor,
  placedShapeIds,
  spaceNameById,
  onClose,
}: {
  activeTab: AssetClass;
  setActiveTab: (c: AssetClass) => void;
  dockTab: DockTab;
  setDockTab: (t: DockTab) => void;
  detailsViewMode: DetailsViewMode;
  setDetailsViewMode: (m: DetailsViewMode) => void;
  query: string;
  setQuery: (q: string) => void;
  filterState: FilterState;
  toggleFilter: (cls: AssetClass, key: string, value: string) => void;
  clearFiltersFor: (cls: AssetClass) => void;
  placedShapeIds: Set<string>;
  spaceNameById: Map<string, string>;
  onClose: () => void;
}) {
  const catalog = useCanvasAssetCatalog();

  // Shared insights fetch — one request per dock session, feeds every
  // Insights tab that reads synthesis_data. Triggered lazily: only
  // fetches when the user opens the Insights tab for the first time.
  const shouldFetchInsights = dockTab === "insights";
  const {
    summary: insightsSummary,
    loading: insightsLoading,
    error: insightsError,
  } = useInsightsSummary(shouldFetchInsights ? catalog.spaceId : null);

  // Phase A1.5 — query-aware tab counts. For each class:
  //   - if items are loaded: count rows matching the query
  //   - if not loaded: show "—" (user hasn't opened this tab yet;
  //     no ambient fetch)
  const tabCounts: Record<string, number | null> = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Record<string, number | null> = {};
    for (const def of ASSET_CLASSES) {
      const items = catalog.state[def.class]?.items;
      if (items === undefined) {
        out[def.class] = null;
        continue;
      }
      if (!q) {
        out[def.class] = items.length;
        continue;
      }
      let matches = 0;
      for (const item of items) {
        const row = def.toLibraryRow(item as never, {
          spaceId: catalog.spaceId ?? "",
          isPlaced: false,
        });
        const hay = `${row.title} ${row.subtitle ?? ""}`.toLowerCase();
        if (hay.includes(q)) matches++;
      }
      out[def.class] = matches;
    }
    return out;
  }, [catalog.state, query, catalog.spaceId]);

  return (
    <div
      className="pointer-events-auto absolute bottom-4 left-[72px] top-4"
      style={{ zIndex: "var(--z-float)" as unknown as number }}
    >
      <GlassPanel
        tier="float"
        radius={22}
        className="flex h-full max-h-[920px] w-[440px] flex-col overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pb-4 pt-5"
          style={{ borderBottom: "1px solid var(--glass-hairline)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-bold tracking-tight text-gray-900">
                Library
              </div>
              {activeTab === "entity" && (
                <DomainBadgeSlot spaceId={catalog.spaceId ?? null} />
              )}
            </div>
            <div className="mt-1 truncate text-[11.5px] font-medium text-gray-500">
              {ASSET_CLASSES.length} folders · drag any onto the board
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-700"
            title="Close library"
            aria-label="Close library"
          >
            <SoftIcon icon={X} size="sm" />
          </button>
        </div>

        {/* Global search */}
        <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--glass-hairline)" }}>
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{
              background: "rgba(15, 23, 42, 0.035)",
              border: "1px solid rgba(15, 23, 42, 0.05)",
            }}
          >
            <Search className="h-3.5 w-3.5 text-gray-400" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search folders + items…"
              className="flex-1 bg-transparent text-[12.5px] text-gray-800 placeholder:text-gray-400 focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-gray-400 hover:text-gray-600"
                title="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Sectioned nav (Phase A1.6) — classes grouped by AssetClassGroup,
            sections ordered by ASSET_CLASS_GROUP_ORDER, classes within a
            section sorted by groupOrder. Each section is collapsible and
            shows a combined count across its classes. */}
        <SectionedNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tabCounts={tabCounts}
          query={query}
        />

        {/* Dock tabs (Phase A1.8 · U3) — Details / Insights / Lab /
            Connections. Details preserves the legacy row list behavior;
            the other three surface class-scoped views that read the
            same unified synthesis data the old per-page surfaces did. */}
        <DockTabBar
          activeTab={activeTab}
          dockTab={dockTab}
          setDockTab={setDockTab}
        />

        {dockTab === "details" && (
          <>
            {/* View-mode switch (Phase A1.9) — only exposes Table for
                asset classes that have a table renderer. Right now
                that's just entities; others fall through to List. */}
            {activeTab === "entity" && (
              <DetailsViewSwitch
                mode={detailsViewMode}
                onChange={setDetailsViewMode}
              />
            )}

            {/* Filter chips (only when active tab has filter defs) */}
            <ActiveTabFilterBar
              activeTab={activeTab}
              filterState={filterState}
              toggleFilter={toggleFilter}
              clearFiltersFor={clearFiltersFor}
            />

            {/* Details body — list or table depending on mode */}
            <div className="flex-1 overflow-y-auto py-1">
              {activeTab === "entity" && detailsViewMode === "table" ? (
                <EntityTablePanel
                  query={query}
                  filterState={filterState}
                  placedShapeIds={placedShapeIds}
                />
              ) : (
                <ActiveTabList
                  activeTab={activeTab}
                  query={query}
                  filterState={filterState}
                  tabCounts={tabCounts}
                  onSwitchTab={setActiveTab}
                  placedShapeIds={placedShapeIds}
                  spaceNameById={spaceNameById}
                />
              )}
            </div>
          </>
        )}

        {dockTab === "insights" && (
          <div className="flex-1 overflow-y-auto py-1">
            <InsightsPanel
              activeTab={activeTab}
              spaceId={catalog.spaceId ?? ""}
              summary={insightsSummary}
              loading={insightsLoading}
              error={insightsError}
            />
          </div>
        )}

        {dockTab === "lab" && (
          <div className="flex-1 overflow-y-auto py-1">
            <DockPlaceholder
              icon={<Beaker className="h-4 w-4" />}
              title={`Lab for ${activeTab}`}
              hint="Drop-scoped what-if + experimentation. Wires in Phase U5 alongside the connection weaver."
            />
          </div>
        )}

        {dockTab === "connections" && (
          <div className="flex-1 overflow-y-auto py-1">
            <DockPlaceholder
              icon={<Link2 className="h-4 w-4" />}
              title={`Connections for ${activeTab}`}
              hint="Cross-class relationships: what bridges, cycles, and claims involve this folder. Wires in Phase U4."
            />
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

// ── Domain badge (Phase 2A) ──
//
// Quiet visual cue of the auto-detected space domain. Only renders
// when confidence is high AND the domain isn't "general" — for
// low-confidence or neutral spaces the badge stays invisible so we
// don't introduce noise. Hover for explanation of what we detected
// and why rankings are adjusted.

function DomainBadgeSlot({ spaceId }: { spaceId: string | null }) {
  const { meta } = useEntityCatalogMeta(spaceId);
  if (!meta || meta.detected_domain === "general") return null;
  if (meta.domain_confidence < 0.5) return null;

  // Use a neutral blue accent so the badge doesn't collide with the
  // accent hierarchy of asset class colors. Intent: "we noticed
  // something", not "here's a new category".
  const accent = "#64748b";
  return (
    <AccentChip
      accent={accent}
      size="xs"
      variant="ghost"
      title={meta.domain_profile.description}
    >
      {meta.domain_profile.label}
    </AccentChip>
  );
}

// ── Details view-mode switch (Phase A1.9) ──
//
// Two-button toggle between List and Table views. Kept as an
// independent component so more views can slot in later (Ranked,
// Chains, Folders) without restructuring the drawer body.

function DetailsViewSwitch({
  mode,
  onChange,
}: {
  mode: DetailsViewMode;
  onChange: (m: DetailsViewMode) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-gray-100 px-2 py-1">
      <button
        onClick={() => onChange("list")}
        className={cn(
          "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
          mode === "list"
            ? "bg-gray-100 text-gray-900"
            : "text-gray-500 hover:bg-gray-50 hover:text-gray-700",
        )}
        title="List view"
      >
        <List className="h-3 w-3" />
        <span>List</span>
      </button>
      <button
        onClick={() => onChange("table")}
        className={cn(
          "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
          mode === "table"
            ? "bg-gray-100 text-gray-900"
            : "text-gray-500 hover:bg-gray-50 hover:text-gray-700",
        )}
        title="Table view with sortable columns"
      >
        <Table2 className="h-3 w-3" />
        <span>Table</span>
      </button>
    </div>
  );
}

// ── Entity table panel wrapper (Phase A1.9) ──
//
// Bridges the drawer's filter + query state to the table component.
// Reads enriched entries from the catalog context, applies per-class
// filters (kind/category/layer/importance/cost) and the global query,
// then hands the filtered set to EntityTableView.

function EntityTablePanel({
  query,
  filterState,
  placedShapeIds,
}: {
  query: string;
  filterState: FilterState;
  placedShapeIds: Set<string>;
}) {
  const catalog = useCanvasAssetCatalog();
  const def = getAssetClass("entity");
  const cs = catalog.state.entity;
  const items = (cs?.items ?? []) as unknown as EntityCatalogEntry[];
  const activeFilters = filterState.entity ?? {};

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let filtered = items;
    // Apply filter groups (AND across groups, OR within a group).
    filtered = filtered.filter((item) => {
      for (const [key, selected] of Object.entries(activeFilters)) {
        if (!selected || selected.size === 0) continue;
        const f = def?.filters?.find((x) => x.key === key);
        if (!f) continue;
        const v = f.extract(item as never);
        const vs = Array.isArray(v) ? v : [v];
        const vals = vs
          .filter((x) => typeof x === "string" || typeof x === "boolean")
          .map((x) => String(x));
        const hit = vals.some((x) => selected.has(x));
        if (!hit) return false;
      }
      return true;
    });
    if (q) {
      filtered = filtered.filter((it) => {
        const hay = `${it.name ?? ""} ${it.description ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return filtered;
  }, [items, query, activeFilters, def]);

  if (cs?.loading && rows.length === 0) {
    return (
      <div className="px-4 pt-6 text-center text-[11px] text-gray-400">
        Loading entities…
      </div>
    );
  }
  if (cs?.error) {
    return (
      <div className="px-4 pt-6 text-center text-[11px] text-red-500">
        {cs.error}
      </div>
    );
  }

  return (
    <EntityTableView
      rows={rows}
      placedShapeIds={placedShapeIds}
      spaceId={catalog.spaceId ?? ""}
    />
  );
}

// ── Dock tab bar (Phase A1.8 · U3) ──

function DockTabBar({
  activeTab,
  dockTab,
  setDockTab,
}: {
  activeTab: AssetClass;
  dockTab: DockTab;
  setDockTab: (t: DockTab) => void;
}) {
  const def = getAssetClass(activeTab);
  const accent = def?.accent ?? "#3B82F6";
  return (
    <div
      className="flex shrink-0 items-center gap-1 px-4 py-3"
      style={{ borderBottom: "1px solid var(--glass-hairline)" }}
    >
      {/* Context line — shows which folder these tabs act on */}
      <div className="mr-2 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-gray-500">
        {def && (
          <def.icon
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={1.75}
            style={{ color: accent }}
          />
        )}
        <span className="truncate">{def?.label ?? "Folder"}</span>
      </div>
      <div
        className="flex flex-1 items-center gap-0.5 rounded-full p-0.5"
        style={{
          background: "rgba(15, 23, 42, 0.04)",
          border: "1px solid rgba(15, 23, 42, 0.04)",
        }}
      >
        {DOCK_TABS.map((t) => {
          const Icon = t.icon;
          const active = dockTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setDockTab(t.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold transition-all",
                active
                  ? "text-gray-900"
                  : "text-gray-500 hover:text-gray-700",
              )}
              style={
                active
                  ? {
                      background: "#ffffff",
                      boxShadow:
                        "0 1px 2px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(15, 23, 42, 0.04)",
                    }
                  : undefined
              }
              title={t.label}
            >
              <Icon
                className="h-3 w-3"
                strokeWidth={1.75}
                style={active ? { color: accent } : undefined}
              />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Insights panel (Phase A1.8 · U3) ──

function InsightsPanel({
  activeTab,
  spaceId,
  summary,
  loading,
  error,
}: {
  activeTab: AssetClass;
  spaceId: string;
  summary: React.ComponentProps<
    NonNullable<(typeof INSIGHTS_RENDERERS)[AssetClass]>
  >["summary"];
  loading: boolean;
  error: string | null;
}) {
  const Renderer = INSIGHTS_RENDERERS[activeTab];
  if (!Renderer) {
    return <DefaultInsightsPlaceholder className={activeTab} />;
  }
  return (
    <Renderer
      spaceId={spaceId}
      summary={summary}
      loading={loading}
      error={error}
    />
  );
}

// ── Placeholder ──

function DockPlaceholder({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-gray-50 text-gray-400">
        {icon}
      </div>
      <div className="text-[11px] font-semibold text-gray-500">{title}</div>
      <div className="mx-auto mt-1 max-w-[260px] text-[10.5px] text-gray-400">
        {hint}
      </div>
    </div>
  );
}

// ── Sectioned nav (Phase A1.6) ──
//
// Replaces the flat horizontal tab bar with a grouped layout. Groups
// follow `ASSET_CLASS_GROUP_ORDER`; classes within a group are sorted
// by `groupOrder` then alphabetically by label as a tiebreaker.
//
// Each section is collapsible. Collapsed state persists in sessionStorage
// so navigating the canvas doesn't reset the user's preference. First
// load defaults every section open — users rarely have 100+ classes and
// hiding content by default would be worse than vertical scroll.

interface GroupedSection {
  group: AssetClassGroup;
  classes: AssetClassDefinition[];
}

const SECTIONED_NAV_STORAGE_KEY = "interaxis:library-drawer:collapsed-groups";

function loadCollapsedGroups(): Set<AssetClassGroup> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(SECTIONED_NAV_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as AssetClassGroup[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveCollapsedGroups(groups: Set<AssetClassGroup>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      SECTIONED_NAV_STORAGE_KEY,
      JSON.stringify(Array.from(groups)),
    );
  } catch {
    // storage disabled — degrade silently
  }
}

function SectionedNav({
  activeTab,
  setActiveTab,
  tabCounts,
  query,
}: {
  activeTab: AssetClass;
  setActiveTab: (c: AssetClass) => void;
  tabCounts: Record<string, number | null>;
  query: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<AssetClassGroup>>(
    () => loadCollapsedGroups(),
  );

  const toggleGroup = useCallback((group: AssetClassGroup) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      saveCollapsedGroups(next);
      return next;
    });
  }, []);

  const sections: GroupedSection[] = useMemo(() => {
    const byGroup = new Map<AssetClassGroup, AssetClassDefinition[]>();
    for (const def of ASSET_CLASSES) {
      const arr = byGroup.get(def.group) ?? [];
      arr.push(def);
      byGroup.set(def.group, arr);
    }
    for (const arr of byGroup.values()) {
      arr.sort(
        (a, b) =>
          a.groupOrder - b.groupOrder || a.label.localeCompare(b.label),
      );
    }
    return (Object.keys(ASSET_CLASS_GROUP_ORDER) as AssetClassGroup[])
      .sort(
        (a, b) => ASSET_CLASS_GROUP_ORDER[a] - ASSET_CLASS_GROUP_ORDER[b],
      )
      .filter((g) => (byGroup.get(g)?.length ?? 0) > 0)
      .map((g) => ({ group: g, classes: byGroup.get(g)! }));
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {sections.map(({ group, classes }, sectionIdx) => {
        const isCollapsed = collapsed.has(group);

        // Combined section count — sum of loaded classes in this group.
        let sectionTotal: number | null = 0;
        let anyLoaded = false;
        for (const def of classes) {
          const c = tabCounts[def.class];
          if (c === null || c === undefined) continue;
          anyLoaded = true;
          sectionTotal = (sectionTotal ?? 0) + c;
        }
        if (!anyLoaded) sectionTotal = null;

        return (
          <div key={group} className={cn(sectionIdx > 0 && "mt-4")}>
            {/* Section header — bigger, cleaner, with a proper count
                pill that reads "—" when not loaded and a real number
                once any class in the section has fetched. */}
            <button
              onClick={() => toggleGroup(group)}
              className="mb-2 flex w-full items-center justify-between px-1 text-left transition-colors"
              title={`${ASSET_CLASS_GROUP_LABEL[group]} · ${classes.length} folders`}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
                <svg
                  viewBox="0 0 10 10"
                  className={cn(
                    "h-2.5 w-2.5 text-gray-400 transition-transform",
                    isCollapsed ? "-rotate-90" : "rotate-0",
                  )}
                  aria-hidden
                >
                  <path
                    d="M2 4 L5 7 L8 4"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {ASSET_CLASS_GROUP_LABEL[group]}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold tabular-nums",
                  sectionTotal === null
                    ? "bg-gray-100 text-gray-400"
                    : "bg-gray-100 text-gray-600",
                )}
              >
                {sectionTotal === null ? "—" : sectionTotal}
              </span>
            </button>

            {/* 3-column folder-tile grid. Tiles are the primary Apple/
                Figma pattern here — square-ish cards with icon + name +
                count, clickable to enter that folder. Active tile gets
                an accent fill. */}
            {!isCollapsed && (
              <div className="grid grid-cols-3 gap-2">
                {classes.map((def) => {
                  const active = activeTab === def.class;
                  const Icon = def.icon;
                  const count = tabCounts[def.class];
                  const notLoaded = count === null || count === undefined;
                  const zeroMatches =
                    typeof count === "number" &&
                    count === 0 &&
                    query.length > 0;
                  return (
                    <button
                      key={def.class}
                      onClick={() => setActiveTab(def.class)}
                      className={cn(
                        "group relative flex flex-col items-start gap-2 rounded-2xl p-3 text-left transition-all duration-200",
                        active
                          ? "text-white"
                          : "text-gray-700 hover:-translate-y-px",
                        zeroMatches && !active && "opacity-40",
                      )}
                      style={
                        active
                          ? {
                              background: def.accent,
                              boxShadow: `0 4px 16px -4px color-mix(in srgb, ${def.accent} 40%, transparent), 0 1px 2px rgba(15, 23, 42, 0.06)`,
                            }
                          : {
                              background: "rgba(255, 255, 255, 0.7)",
                              border: "1px solid rgba(15, 23, 42, 0.06)",
                              boxShadow:
                                "0 1px 2px rgba(15, 23, 42, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)",
                            }
                      }
                      title={
                        notLoaded
                          ? `${def.label} · tap to load`
                          : `${def.label} · ${count} item${count === 1 ? "" : "s"}`
                      }
                    >
                      {/* Icon tile with accent fill */}
                      <div
                        className="flex h-7 w-7 items-center justify-center rounded-lg"
                        style={
                          active
                            ? {
                                background: "rgba(255, 255, 255, 0.22)",
                              }
                            : {
                                background: `color-mix(in srgb, ${def.accent} 10%, transparent)`,
                              }
                        }
                      >
                        <Icon
                          className="h-3.5 w-3.5"
                          strokeWidth={1.75}
                          style={{
                            color: active ? "#ffffff" : def.accent,
                          }}
                        />
                      </div>

                      {/* Label + count */}
                      <div className="flex w-full items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-[11.5px] font-semibold",
                          )}
                        >
                          {def.label}
                        </span>
                        <span
                          className={cn(
                            "font-mono text-[9.5px] font-semibold tabular-nums",
                            active
                              ? "text-white/80"
                              : notLoaded
                                ? "text-gray-300"
                                : typeof count === "number" && count > 0
                                  ? "text-gray-500"
                                  : "text-gray-300",
                          )}
                        >
                          {notLoaded ? "—" : count}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Filter chip row ──

function ActiveTabFilterBar({
  activeTab,
  filterState,
  toggleFilter,
  clearFiltersFor,
}: {
  activeTab: AssetClass;
  filterState: FilterState;
  toggleFilter: (cls: AssetClass, key: string, value: string) => void;
  clearFiltersFor: (cls: AssetClass) => void;
}) {
  const catalog = useCanvasAssetCatalog();
  const def = getAssetClass(activeTab);
  if (!def || !def.filters || def.filters.length === 0) return null;

  // Compute option values for each filter from either the `presets` on
  // the filter def or (fallback) the loaded items.
  const items = catalog.state[activeTab]?.items ?? [];
  const activeFilters = filterState[activeTab] ?? {};
  const anyActive = Object.values(activeFilters).some((s) => s && s.size > 0);

  return (
    <div className="shrink-0 space-y-1 border-b border-gray-100 px-2.5 py-2">
      {def.filters.map((f) => {
        const options = f.presets
          ? Array.from(new Set(f.presets))
          : Array.from(
              new Set(
                items
                  .map((it) => f.extract(it as never))
                  .flatMap((v) => (Array.isArray(v) ? v : [v]))
                  .filter((v): v is string | boolean =>
                    typeof v === "string" || typeof v === "boolean",
                  )
                  .map((v) => String(v)),
              ),
            );
        if (options.length === 0) return null;
        const active = activeFilters[f.key] ?? new Set<string>();

        // Per-option count: how many items match this value in the
        // currently loaded list. Quick, unfiltered by search so users
        // see the natural distribution.
        const counts: Record<string, number> = {};
        for (const it of items) {
          const v = f.extract(it as never);
          const vs = Array.isArray(v) ? v : [v];
          for (const val of vs) {
            if (typeof val !== "string" && typeof val !== "boolean") continue;
            const key = String(val);
            counts[key] = (counts[key] ?? 0) + 1;
          }
        }

        return (
          <div key={f.key} className="flex items-center gap-1.5 overflow-x-auto">
            <span className="w-12 shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">
              {f.label}
            </span>
            {options.map((opt) => {
              const isOn = active.has(opt);
              const optCount = counts[opt] ?? 0;
              return (
                <button
                  key={opt}
                  onClick={() => toggleFilter(activeTab, f.key, opt)}
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                    isOn
                      ? "border-transparent text-white"
                      : "border-gray-200 bg-white/70 text-gray-600 hover:bg-gray-50",
                    optCount === 0 && !isOn && "opacity-45",
                  )}
                  style={
                    isOn
                      ? { background: def.accent }
                      : undefined
                  }
                  title={`${opt} · ${optCount}`}
                >
                  <span>{opt.replace(/_/g, " ")}</span>
                  <span
                    className={cn(
                      "ml-1 font-mono text-[9px]",
                      isOn ? "text-white/80" : "text-gray-400",
                    )}
                  >
                    {optCount}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
      {anyActive && (
        <button
          onClick={() => clearFiltersFor(activeTab)}
          className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-gray-400 hover:text-gray-700"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// ── List body ──

function ActiveTabList({
  activeTab,
  query,
  filterState,
  tabCounts,
  onSwitchTab,
  placedShapeIds,
  spaceNameById,
}: {
  activeTab: AssetClass;
  query: string;
  filterState: FilterState;
  tabCounts: Record<string, number | null>;
  onSwitchTab: (c: AssetClass) => void;
  placedShapeIds: Set<string>;
  spaceNameById: Map<string, string>;
}) {
  const catalog = useCanvasAssetCatalog();
  const def = getAssetClass(activeTab);
  if (!def) return null;

  const cs = catalog.state[activeTab];
  const items = cs?.items ?? [];
  const activeFilters = filterState[activeTab] ?? {};

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const built = items.map((item) => {
      const shapeId = def.shapeIdForItem
        ? def.shapeIdForItem(item.id)
        : `${def.class}-${item.id}`;
      const spaceId =
        typeof item.space_id === "string"
          ? (item.space_id as string)
          : catalog.spaceId ?? "";
      return {
        row: def.toLibraryRow(item as never, {
          spaceId,
          isPlaced: placedShapeIds.has(shapeId),
        }),
        item,
      };
    });

    // Apply filter groups — AND across groups, OR within a group.
    const filtered = built.filter(({ item }) => {
      for (const [key, selected] of Object.entries(activeFilters)) {
        if (!selected || selected.size === 0) continue;
        const f = def.filters?.find((x) => x.key === key);
        if (!f) continue;
        const v = f.extract(item as never);
        const vs = Array.isArray(v) ? v : [v];
        const vals = vs
          .filter((x) => typeof x === "string" || typeof x === "boolean")
          .map((x) => String(x));
        const hit = vals.some((x) => selected.has(x));
        if (!hit) return false;
      }
      return true;
    });

    if (!q) return filtered.map((x) => x.row);
    return filtered
      .filter(({ row }) => {
        const hay = `${row.title} ${row.subtitle ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .map(({ row }) => row);
  }, [items, query, activeFilters, placedShapeIds, def, catalog.spaceId]);

  if (cs?.loading && rows.length === 0) {
    return (
      <div className="px-4 pt-6 text-center text-[11px] text-gray-400">
        Loading {def.pluralLabel}…
      </div>
    );
  }
  if (cs?.error) {
    return (
      <div className="px-4 pt-6 text-center text-[11px] text-red-500">
        {cs.error}
      </div>
    );
  }
  if (rows.length === 0) {
    // Phase A1.5 — when the current tab has zero matches, surface a
    // prompt to jump to the first other tab that does.
    const matchingTabs = ASSET_CLASSES.filter(
      (d) => d.class !== activeTab && (tabCounts[d.class] ?? 0) > 0,
    );
    return (
      <div className="px-4 pt-6 text-center">
        <div className="text-[11.5px] text-gray-400">
          {query
            ? `No ${def.pluralLabel} match "${query}"`
            : Object.values(activeFilters).some((s) => s && s.size > 0)
              ? `No ${def.pluralLabel} match the current filters`
              : `No ${def.pluralLabel} yet.`}
        </div>
        {query && matchingTabs.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-gray-400">
              Matches elsewhere
            </div>
            {matchingTabs.slice(0, 3).map((d) => {
              const c = tabCounts[d.class] ?? 0;
              const DIcon = d.icon;
              return (
                <button
                  key={d.class}
                  onClick={() => onSwitchTab(d.class)}
                  className="mx-auto flex items-center gap-2 rounded-full border border-gray-200 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-white"
                  style={{ borderColor: `${d.accent}66` }}
                >
                  <DIcon className="h-3 w-3" style={{ color: d.accent }} />
                  {d.label}
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: d.accent }}
                  >
                    {c}
                  </span>
                  <ArrowRight className="h-3 w-3 text-gray-400" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Group entities by space (legacy behavior). Other classes flat-list.
  if (activeTab === "entity") {
    const grouped = new Map<string, LibraryRow[]>();
    for (const r of rows) {
      const itemsList = catalog.state.entity?.items as Entity[] | undefined;
      const item = itemsList?.find((e) => e.id === r.id);
      const sid = item?.space_id ?? "(unknown)";
      if (!grouped.has(sid)) grouped.set(sid, []);
      grouped.get(sid)!.push(r);
    }
    return (
      <>
        {Array.from(grouped.entries()).map(([sid, items]) => (
          <div key={sid} className="mb-2">
            <div className="sticky top-0 z-10 bg-white/95 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-gray-400 backdrop-blur">
              {spaceNameById.get(sid) ?? "(unknown space)"}
              <span className="ml-1 text-gray-300">· {items.length}</span>
            </div>
            {items.map((row) => (
              <DraggableRow key={row.key} row={row} def={def} catalog={catalog} />
            ))}
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="px-1 pb-2">
      {rows.map((row) => (
        <DraggableRow key={row.key} row={row} def={def} catalog={catalog} />
      ))}
    </div>
  );
}

function DraggableRow({
  row,
  def,
  catalog,
}: {
  row: LibraryRow;
  def: AssetClassDefinition;
  catalog: ReturnType<typeof useCanvasAssetCatalog>;
}) {
  const items = catalog.state[def.class]?.items ?? [];
  const item = items.find((it) => it.id === row.id);
  const spaceId = catalog.spaceId ?? "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemRef = useRef<any>(item);
  itemRef.current = item;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        const currentItem = itemRef.current;
        if (currentItem) {
          const payload = def.toDragPayload(currentItem as never, { spaceId });
          e.dataTransfer.setData(LIBRARY_ASSET_MIME, JSON.stringify(payload));
          if (def.class === "entity") {
            const e2 = currentItem as unknown as Entity;
            const legacy: EntityDragPayload = {
              id: e2.id,
              name: e2.name,
              description: e2.description ?? null,
              entity_category: (e2.entity_category as string) ?? null,
              layer: e2.layer ?? null,
              importance: e2.importance ?? null,
              confidence: (e2.confidence as number | null) ?? null,
              space_id: e2.space_id,
            };
            e.dataTransfer.setData(ENTITY_DRAG_MIME, JSON.stringify(legacy));
          }
          e.dataTransfer.setData("text/plain", row.title);
        }
      }}
      className={cn(
        "group mx-1 flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50 active:cursor-grabbing",
        row.isPlaced && "opacity-60",
      )}
      title={row.subtitle ?? row.title}
    >
      <GripVertical className="h-3 w-3 flex-shrink-0 text-gray-300 group-hover:text-gray-500" />
      <span
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: row.accent }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold text-gray-900">
          {row.title}
        </div>
        {row.subtitle && (
          <div className="truncate text-[10px] text-gray-500">
            {row.subtitle}
          </div>
        )}
      </div>
      {row.stat && (
        <span
          className="rounded-sm px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest"
          style={{ color: row.accent, background: `${row.accent}15` }}
        >
          {row.stat}
        </span>
      )}
      {row.isPlaced && (
        <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-green-500" />
      )}
    </div>
  );
}
