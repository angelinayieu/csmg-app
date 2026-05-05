"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Plus, SlidersHorizontal, X } from "lucide-react";
import type { Entity, Edge } from "@/types";

export interface LabReagentBayProps {
  focal: Entity;
  subunits: Entity[];
  upstreamEdges: Array<{ edge: Edge; partner: Entity }>;
  downstreamEdges: Array<{ edge: Edge; partner: Entity }>;
  hoveredSubunitId: string | null;
  onHoverSubunit: (id: string | null) => void;
  /**
   * Phase 17: if provided, each subunit row becomes a navigation link to
   * the next-lower-scale lab. Returns null for subunits that have no
   * drill target (e.g. stub/synthetic entities).
   */
  subunitDrillHref?: (entity: Entity) => string | null;
  /** Same for bond partners (upstream + downstream). */
  bondDrillHref?: (entity: Entity) => string | null;
  /**
   * Phase 21: per-subunit dials. When provided:
   *   - rows show a small "TUNE" badge (slider icon) users click to point
   *     the control panel at that subunit's parameters
   *   - the currently-tuned subunit gets an amber accent
   *   - null = the focal is the active tuning target
   */
  selectedSubunitId?: string | null;
  onSelectSubunit?: (id: string | null) => void;
  /**
   * Phase 28: slot rendered in the Internal Subunits section's empty
   * state. When not provided, a plain text hint is shown. NodeLab uses
   * this slot to inject the Build Connections CTA.
   */
  subunitsEmptyAction?: ReactNode;
  /**
   * Phase 28: slot rendered in the Internal Subunits section header.
   * Typically a compact "Probe" chip to decompose for more subunits.
   */
  subunitsSectionAction?: ReactNode;
  /**
   * Phase B — per-row inline expansion. When `childrenByParentId` and
   * `spaceId` are provided, every subunit row gets a hover-revealed (+)
   * button. Click → fires recursive-decompose for that entity OR toggles
   * an already-expanded subtree. Children render inline under the parent
   * with indentation, recursively (each child also gets its own (+)).
   *
   * `childrenByParentId` maps entity.id → its direct sub-entities (those
   * whose provenance.parent_entity_id === entity.id). Built once in the
   * orchestrator (NodeLab/SpaceLab/UniversalLab) from the full entities
   * array, then passed down so the bay can render arbitrary depth without
   * needing the full graph itself.
   */
  childrenByParentId?: Map<string, Entity[]>;
  spaceId?: string;
}

const CATEGORY_COLOR: Record<string, string> = {
  concrete: "#4ade80",
  abstract: "#a78bfa",
  process: "#fbbf24",
  relational: "#22d3ee",
  epistemic: "#f472b6",
  fault: "#ef4444",
};

function subunitColor(entity: Entity): string {
  const cat = (entity.entity_category as string) ?? "concrete";
  return CATEGORY_COLOR[cat] ?? "#4ade80";
}

function subunitSymbol(entity: Entity): string {
  // Two-char mnemonic from entity name. Greek if pure initial, else ASCII.
  const words = entity.name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLowerCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function weight(entity: Entity): number {
  return Math.round(((entity.confidence as number | null) ?? 0.7) * 100);
}

export function LabReagentBay({
  focal,
  subunits,
  upstreamEdges,
  downstreamEdges,
  hoveredSubunitId,
  onHoverSubunit,
  subunitDrillHref,
  bondDrillHref,
  selectedSubunitId,
  onSelectSubunit,
  subunitsEmptyAction,
  subunitsSectionAction,
  childrenByParentId,
  spaceId,
}: LabReagentBayProps) {
  const router = useRouter();
  const layerLabel = focal.layer ?? "thread";
  const totalSubunitWeight = useMemo(
    () => subunits.reduce((s, u) => s + weight(u), 0),
    [subunits],
  );

  // Phase B — inline expansion state. `expandedIds` tracks which subunits
  // have their children visible; `loadingIds` tracks which are currently
  // running a recursive-decompose call (so we can show a spinner without
  // blocking other rows).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  // Phase B — (+) click handler. Three branches:
  //   1. Already expanded → collapse (no API call).
  //   2. Has loaded children but collapsed → expand (no API call).
  //   3. No loaded children → fire recursive-decompose, expand on success,
  //      router.refresh() so the orchestrator re-fetches entities/edges
  //      and re-renders childrenByParentId.
  const handleProbe = async (entity: Entity) => {
    if (expandedIds.has(entity.id)) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(entity.id);
        return next;
      });
      return;
    }
    const existing = childrenByParentId?.get(entity.id) ?? [];
    if (existing.length > 0) {
      setExpandedIds((prev) => new Set(prev).add(entity.id));
      return;
    }
    if (!spaceId) return; // no API target; bay was mounted in read-only mode
    setLoadingIds((prev) => new Set(prev).add(entity.id));
    try {
      const res = await fetch("/api/canvas/recursive-decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, entityId: entity.id }),
      });
      if (res.ok) {
        setExpandedIds((prev) => new Set(prev).add(entity.id));
        // Re-fetch server-rendered entities/edges. The expandedIds Set
        // lives in this client component, so it survives the refresh.
        router.refresh();
      }
    } catch {
      // soft-fail; users can retry
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(entity.id);
        return next;
      });
    }
  };

  const probeEnabled = Boolean(spaceId && childrenByParentId);

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-[var(--lab-panel-bg)]">
      {/* Bay header — Phase A: dropped "Reagent Bay" jargon. */}
      <div className="border-b border-[var(--lab-border)] px-4 py-3">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--lab-text-dim)]">
          Inventory
        </div>
        <div className="text-[14px] font-bold leading-tight text-[var(--lab-text)]">
          Components & Connections
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Sub-components (was "Internal Subunits") ── */}
        <Section
          title="◉ Sub-components"
          count={subunits.length}
          action={subunitsSectionAction}
        >
          {subunits.length === 0 ? (
            subunitsEmptyAction ?? <EmptyHint>No decomposed subunits yet.</EmptyHint>
          ) : (
            subunits.map((s) => (
              <SubunitTreeRow
                key={s.id}
                entity={s}
                depth={0}
                hoveredSubunitId={hoveredSubunitId}
                onHoverSubunit={onHoverSubunit}
                selectedSubunitId={selectedSubunitId ?? null}
                onSelectSubunit={onSelectSubunit}
                subunitDrillHref={subunitDrillHref}
                childrenByParentId={childrenByParentId}
                expandedIds={expandedIds}
                loadingIds={loadingIds}
                onProbe={probeEnabled ? handleProbe : null}
              />
            ))
          )}
          {totalSubunitWeight > 0 && (
            <div className="mt-2 flex items-center gap-2 px-1 text-[9px] text-[var(--lab-text-dim)]">
              <span>∑ weight</span>
              <span className="flex-1 border-t border-dashed border-[var(--lab-border-strong)]" />
              <span className="font-mono font-semibold text-[var(--lab-text-mid)]">{totalSubunitWeight}</span>
            </div>
          )}
        </Section>

        {/* ── Upstream Bonds ── */}
        <Section title="↑ Upstream Bonds" count={upstreamEdges.length}>
          {upstreamEdges.length === 0 && <EmptyHint>No upstream connections.</EmptyHint>}
          {upstreamEdges.map(({ edge, partner }) => (
            <BondRow
              key={edge.id}
              direction="up"
              partner={partner}
              edge={edge}
              href={bondDrillHref?.(partner) ?? null}
            />
          ))}
        </Section>

        {/* ── Downstream Bonds ── */}
        <Section title="↓ Downstream Bonds" count={downstreamEdges.length}>
          {downstreamEdges.length === 0 && <EmptyHint>No downstream connections.</EmptyHint>}
          {downstreamEdges.map(({ edge, partner }) => (
            <BondRow
              key={edge.id}
              direction="dn"
              partner={partner}
              edge={edge}
              href={bondDrillHref?.(partner) ?? null}
            />
          ))}
        </Section>

        {/* ── Context ── */}
        <Section title="⟐ Context">
          <ContextRow label="Layer" value={layerLabel} accent="#22d3ee" />
          <ContextRow
            label="Category"
            value={(focal.entity_category as string) ?? "concept"}
            accent="#22d3ee"
          />
          <ContextRow
            label="Importance"
            value={focal.importance ?? "moderate"}
            accent="#22d3ee"
          />
          {focal.description && (
            <div className="mt-2 rounded-sm border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-2 text-[10.5px] leading-relaxed text-[var(--lab-text-mid)]">
              {focal.description}
            </div>
          )}
        </Section>
      </div>
    </aside>
  );
}

function Section({
  title,
  count,
  children,
  action,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-[var(--lab-text-dim)]">
          {title}
        </div>
        <div className="flex items-center gap-1.5">
          {action}
          {count !== undefined && (
            <div className="rounded-sm border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--lab-text-faint)]">
              {count}
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-2 text-[10px] italic text-[var(--lab-text-faint)]">{children}</div>
  );
}

function BondRow({
  direction,
  partner,
  edge,
  href,
}: {
  direction: "up" | "dn";
  partner: Entity;
  edge: Edge;
  href: string | null;
}) {
  const arrowColor = direction === "up" ? "#22d3ee" : "#fbbf24";
  const strength = ((edge.strength as number | null) ?? 0.5).toFixed(2);
  const className =
    "flex items-center gap-2 border-b border-[var(--lab-border)] px-1 py-1.5 transition-colors hover:bg-[var(--lab-panel-raised)]";
  const content = (
    <>
      <div
        className="w-[14px] text-center font-mono text-[11px] font-bold"
        style={{ color: arrowColor }}
      >
        {direction === "up" ? "↑" : "↓"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-[var(--lab-text)]">{partner.name}</div>
        <div className="truncate text-[9px] text-[var(--lab-text-dim)]">
          {edge.relationship_type} · {edge.dimension}
        </div>
      </div>
      <div className="font-mono text-[10px] font-semibold tabular-nums text-[var(--lab-text-mid)]">
        {strength}
      </div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className} title={`Open ${partner.name} in its own lab`}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}

function ContextRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-[10px]">
      <div className="w-[22px] text-center font-mono font-bold" style={{ color: accent }}>
        φ
      </div>
      <div className="flex-1 text-[var(--lab-text-mid)]">{label}</div>
      <div className="text-[var(--lab-text)]">{value}</div>
    </div>
  );
}

// ── Phase B: SubunitTreeRow ───────────────────────────────────────
//
// A single subunit row plus, when expanded, its children rendered
// recursively beneath with depth-based indentation. The row itself keeps
// the existing visual treatment (color stripe, hover/tuning emphasis,
// optional drill-link, TUNE badge) and adds a hover-revealed "+" probe
// button that:
//
//   - if the entity has no loaded children → fires recursive-decompose
//     and shows a spinner (the orchestrator router.refresh()s on success
//     so new children flow back via childrenByParentId on next render)
//   - if it has loaded children but is collapsed → expands inline
//   - if it's already expanded → collapses (also represented by the X icon)
//
// `depth` is purely cosmetic (left-padding + slightly muted weight).
// Recursion terminates naturally when an expanded entity has no children
// in the map.
interface SubunitTreeRowProps {
  entity: Entity;
  depth: number;
  hoveredSubunitId: string | null;
  onHoverSubunit: (id: string | null) => void;
  selectedSubunitId: string | null;
  onSelectSubunit?: (id: string | null) => void;
  subunitDrillHref?: (entity: Entity) => string | null;
  childrenByParentId?: Map<string, Entity[]>;
  expandedIds: Set<string>;
  loadingIds: Set<string>;
  /** When null, the (+) button is hidden (read-only mode). */
  onProbe: ((entity: Entity) => void) | null;
  /**
   * Set of entity ids that are ancestors of the current row (its parent,
   * grandparent, etc.). Used to break cycles: if the data model ever has
   * a malformed parent chain (A→B→A), we stop recursing the moment we'd
   * re-render an ancestor as its own descendant.
   */
  ancestorIds?: Set<string>;
}

function SubunitTreeRow({
  entity,
  depth,
  hoveredSubunitId,
  onHoverSubunit,
  selectedSubunitId,
  onSelectSubunit,
  subunitDrillHref,
  childrenByParentId,
  expandedIds,
  loadingIds,
  onProbe,
  ancestorIds,
}: SubunitTreeRowProps) {
  const color = subunitColor(entity);
  const isHover = hoveredSubunitId === entity.id;
  const isTuning = selectedSubunitId === entity.id;
  const href = subunitDrillHref?.(entity) ?? null;
  const accentColor = isTuning ? "#fbbf24" : color;
  const isExpanded = expandedIds.has(entity.id);
  const isLoading = loadingIds.has(entity.id);
  const childListRaw = childrenByParentId?.get(entity.id) ?? [];
  // Cycle break — drop any child that is also an ancestor of this row.
  const childList = ancestorIds
    ? childListRaw.filter((c) => !ancestorIds.has(c.id))
    : childListRaw;
  const hasChildren = childList.length > 0;

  // Depth-based indent. Capped so a deep subtree doesn't push the content
  // off-screen on a 280px column. After ~6 levels the indent tops out and
  // depth is signaled only by the slightly dimmer weight readout.
  const indentPx = Math.min(depth, 6) * 12;
  const rowStyle = {
    background:
      isHover || isTuning ? "var(--lab-panel-inset)" : "var(--lab-panel-raised)",
    borderColor: isTuning
      ? "#fbbf24"
      : isHover
        ? color
        : "var(--lab-border)",
    boxShadow: isTuning
      ? `inset 3px 0 0 #fbbf24, inset 0 0 0 1px #fbbf2466`
      : isHover
        ? `inset 3px 0 0 ${color}, inset 0 0 0 1px ${color}55`
        : `inset 2px 0 0 ${color}99`,
    marginLeft: indentPx,
  } as const;
  const rowClassName =
    "group relative mb-1 flex w-full items-center gap-2 overflow-hidden rounded-[3px] border px-2 py-2 text-left transition-all";

  const probeTitle = isExpanded
    ? `Collapse ${entity.name}`
    : hasChildren
      ? `Expand ${entity.name} — show its sub-components`
      : `Probe ${entity.name} — generate sub-components inline`;

  const rowContent = (
    <>
      <div
        className="w-[26px] text-center font-mono text-[12px] font-bold tracking-tighter"
        style={{ color: accentColor }}
      >
        {subunitSymbol(entity)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-medium text-[var(--lab-text)]">
          {entity.name}
        </div>
        <div className="mt-0.5 flex gap-1.5 text-[9px] text-[var(--lab-text-dim)]">
          <span className="tracking-wide">
            {(entity.entity_category as string) ?? "concept"}
          </span>
          <span>·</span>
          <span className="tracking-wide">{entity.layer ?? "thread"}</span>
          {isTuning && (
            <>
              <span>·</span>
              <span className="font-semibold tracking-wider text-[var(--lab-warn)]">
                TUNING
              </span>
            </>
          )}
          {hasChildren && (
            <>
              <span>·</span>
              <span className="font-semibold tabular-nums text-[var(--lab-text-mid)]">
                {childList.length}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Phase B — hover-revealed (+) probe button. Lives BEFORE the TUNE
          badge so it doesn't compete for the rightmost real estate when
          all the badges are visible at once. opacity-0 → opacity-100 on
          row hover (or always-on while loading or already expanded so
          the user can collapse). */}
      {onProbe && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onProbe(entity);
          }}
          disabled={isLoading}
          title={probeTitle}
          aria-label={probeTitle}
          className={`flex h-5 w-5 items-center justify-center rounded-[2px] border transition-all disabled:cursor-wait ${
            isExpanded || isLoading
              ? "border-[var(--lab-accent)] bg-[var(--lab-accent-tint)] opacity-100"
              : "border-transparent opacity-0 group-hover:opacity-100 hover:border-[var(--lab-accent)] hover:bg-[var(--lab-accent-tint)]"
          }`}
          style={{
            color: isExpanded || isLoading ? "var(--lab-accent)" : "#475569",
          }}
        >
          {isLoading ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : isExpanded ? (
            <X className="h-2.5 w-2.5" />
          ) : (
            <Plus className="h-2.5 w-2.5" />
          )}
        </button>
      )}

      {/* Phase 21: TUNE badge. */}
      {onSelectSubunit && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectSubunit(isTuning ? null : entity.id);
          }}
          title={
            isTuning
              ? "Stop tuning — return control panel to focal"
              : `Tune ${entity.name} — point control panel at this subunit`
          }
          className="flex h-5 w-5 items-center justify-center rounded-[2px] border border-transparent transition-colors hover:border-[var(--lab-warn)] hover:bg-[var(--lab-warn-tint)]"
          style={{
            color: isTuning ? "#fbbf24" : "#475569",
          }}
        >
          <SlidersHorizontal className="h-2.5 w-2.5" />
        </button>
      )}
      <div className="font-mono text-[10px] font-semibold tabular-nums text-[var(--lab-text-mid)]">
        {weight(entity)}
      </div>
      {href && (
        <ChevronRight
          className="h-3 w-3 text-[var(--lab-text-faint)] transition-colors group-hover:text-[var(--lab-text)]"
          aria-hidden
        />
      )}
    </>
  );

  const rowElement = href ? (
    <Link
      href={href}
      onMouseEnter={() => onHoverSubunit(entity.id)}
      onMouseLeave={() => onHoverSubunit(null)}
      className={rowClassName}
      style={rowStyle}
      title={`Open ${entity.name} in its own lab`}
    >
      {rowContent}
    </Link>
  ) : (
    <button
      onMouseEnter={() => onHoverSubunit(entity.id)}
      onMouseLeave={() => onHoverSubunit(null)}
      className={rowClassName}
      style={rowStyle}
      type="button"
    >
      {rowContent}
    </button>
  );

  return (
    <>
      {rowElement}
      {/* Recursive children — only rendered when this row is expanded
          AND we actually have children in the map. The orchestrator's
          router.refresh() after a successful decompose causes the map to
          repopulate; expandedIds survives the refresh because this is a
          client component. */}
      {isExpanded &&
        hasChildren &&
        (() => {
          // Build the ancestor chain for cycle protection one level down.
          const nextAncestors = new Set(ancestorIds ?? []);
          nextAncestors.add(entity.id);
          return childList.map((child) => (
            <SubunitTreeRow
              key={child.id}
              entity={child}
              depth={depth + 1}
              hoveredSubunitId={hoveredSubunitId}
              onHoverSubunit={onHoverSubunit}
              selectedSubunitId={selectedSubunitId}
              onSelectSubunit={onSelectSubunit}
              subunitDrillHref={subunitDrillHref}
              childrenByParentId={childrenByParentId}
              expandedIds={expandedIds}
              loadingIds={loadingIds}
              onProbe={onProbe}
              ancestorIds={nextAncestors}
            />
          ));
        })()}
    </>
  );
}
