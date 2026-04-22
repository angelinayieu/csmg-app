"use client";

// ── Entity Table view (Phase A1.9) ──
//
// Database-style projection of the enriched entity catalog. Every
// column is sortable (click the header); rows are draggable onto
// canvas like the list view; filter chips feed in from the drawer's
// filter state. Kept width-flexible so it fits inside the 360px drawer
// by showing a compact column set; expanded overlay mode shows more.
//
// Bulk selection + bulk drag isn't wired yet (one row → one drag is
// the single-user common case); that's a later addition once the
// column layout is stable.

import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ENTITY_KIND_ACCENT,
  ENTITY_KIND_LABEL,
  type EntityKind,
} from "@/lib/entities/kind-classifier";
import { LIBRARY_ASSET_MIME } from "../library/types";
import { getAssetClass } from "../library/asset-class-registry";
import type { EntityCatalogEntry } from "@/app/api/spaces/[id]/entities/catalog/route";
import { ENTITY_DRAG_MIME, type EntityDragPayload } from "./canvas-asset-drawer";
import { AccentRing } from "@/components/ui/accent-ring";
import { AccentChip } from "@/components/ui/accent-chip";
import { SoftIcon } from "@/components/ui/soft-icon";

/**
 * Sortable column identifiers. Each maps to an extractor on
 * EntityCatalogEntry + a display renderer. Kept as a string literal
 * so saved user preferences in sessionStorage round-trip cleanly.
 */
type SortKey =
  | "name"
  | "kind"
  | "dominance"
  | "upstream"
  | "downstream"
  | "chains"
  | "cost";

type SortDirection = "asc" | "desc";

interface ColumnDef {
  key: SortKey;
  label: string;
  // Width hint in Tailwind units (px derivable from tailwind default).
  className: string;
  align?: "left" | "right" | "center";
  // Default sort direction when this column is first clicked.
  defaultDir?: SortDirection;
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", className: "flex-1 min-w-0" },
  { key: "kind", label: "Kind", className: "w-[60px]" },
  { key: "dominance", label: "Dom", className: "w-[54px]", align: "right", defaultDir: "desc" },
  { key: "upstream", label: "↑", className: "w-[26px]", align: "right", defaultDir: "desc" },
  { key: "downstream", label: "↓", className: "w-[26px]", align: "right", defaultDir: "desc" },
  { key: "chains", label: "Ch", className: "w-[26px]", align: "right", defaultDir: "desc" },
  { key: "cost", label: "Cost", className: "w-[42px]", align: "center" },
];

const COST_ORDER: Record<string, number> = { low: 1, mid: 2, high: 3 };

function extractSortValue(entry: EntityCatalogEntry, key: SortKey): number | string {
  switch (key) {
    case "name":
      return (entry.name ?? "").toLowerCase();
    case "kind":
      return entry.kind ?? "";
    case "dominance":
      return entry.dominance?.score ?? 0;
    case "upstream":
      return entry.upstream_count ?? 0;
    case "downstream":
      return entry.downstream_count ?? 0;
    case "chains":
      return entry.chain_count ?? 0;
    case "cost":
      return COST_ORDER[entry.intervention_cost ?? ""] ?? 0;
  }
}

export interface EntityTableViewProps {
  rows: EntityCatalogEntry[];
  placedShapeIds: Set<string>;
  spaceId: string;
}

export function EntityTableView({
  rows,
  placedShapeIds,
  spaceId,
}: EntityTableViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("dominance");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = extractSortValue(a, sortKey);
      const bv = extractSortValue(b, sortKey);
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const onHeaderClick = (col: ColumnDef) => {
    if (sortKey === col.key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(col.key);
      setSortDir(col.defaultDir ?? "asc");
    }
  };

  if (rows.length === 0) {
    return (
      <div className="px-4 pt-6 text-center text-[11px] text-gray-400">
        No entities to show.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header row */}
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-gray-200/70 bg-white/95 px-2 py-1 backdrop-blur">
        {COLUMNS.map((col) => {
          const isSort = sortKey === col.key;
          const SortIcon = sortDir === "asc" ? ArrowUp : ArrowDown;
          return (
            <button
              key={col.key}
              onClick={() => onHeaderClick(col)}
              className={cn(
                "flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] transition-colors",
                col.className,
                col.align === "right" && "justify-end",
                col.align === "center" && "justify-center",
                isSort ? "text-gray-900" : "text-gray-400 hover:text-gray-600",
              )}
              title={`Sort by ${col.label.toLowerCase()}`}
            >
              <span>{col.label}</span>
              {isSort && <SortIcon className="h-2 w-2" />}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {sorted.map((entry) => (
          <EntityTableRow
            key={entry.id}
            entry={entry}
            placed={placedShapeIds.has(`kg-${entry.id}`)}
            spaceId={spaceId}
          />
        ))}
      </div>
    </div>
  );
}

function EntityTableRow({
  entry,
  placed,
  spaceId,
}: {
  entry: EntityCatalogEntry;
  placed: boolean;
  spaceId: string;
}) {
  const entryRef = useRef<EntityCatalogEntry>(entry);
  entryRef.current = entry;

  const kindAccent = ENTITY_KIND_ACCENT[entry.kind as EntityKind] ?? "#64748b";
  const kindLabel = ENTITY_KIND_LABEL[entry.kind as EntityKind] ?? entry.kind;
  const dom = entry.dominance?.score ?? 0;
  const cost = entry.intervention_cost;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        const def = getAssetClass("entity");
        if (!def) return;
        const payload = def.toDragPayload(entryRef.current as never, {
          spaceId,
        });
        e.dataTransfer.setData(LIBRARY_ASSET_MIME, JSON.stringify(payload));
        const legacy: EntityDragPayload = {
          id: entry.id,
          name: entry.name,
          description: entry.description ?? null,
          entity_category: (entry.entity_category as string) ?? null,
          layer: entry.layer ?? null,
          importance: entry.importance ?? null,
          confidence: (entry.confidence as number | null) ?? null,
          space_id: entry.space_id,
        };
        e.dataTransfer.setData(ENTITY_DRAG_MIME, JSON.stringify(legacy));
        e.dataTransfer.setData("text/plain", entry.name);
      }}
      className={cn(
        "group flex cursor-grab items-center gap-1 border-b border-gray-100/60 px-2 py-1 text-left hover:bg-gray-50 active:cursor-grabbing",
        placed && "opacity-60",
      )}
      title={entry.description ?? entry.name}
    >
      {/* Name */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <SoftIcon
          icon={GripVertical}
          size="xs"
          className="text-gray-200 group-hover:text-gray-400"
        />
        <span className="truncate text-[11.5px] font-semibold text-gray-900">
          {entry.name}
        </span>
        {placed && (
          <SoftIcon
            icon={CheckCircle2}
            size="xs"
            color="#16a34a"
            label="On canvas"
          />
        )}
      </div>

      {/* Kind chip — full label, no 4-letter truncation */}
      <div className="w-[60px]">
        <AccentChip accent={kindAccent} size="xs" variant="soft">
          {kindLabel}
        </AccentChip>
      </div>

      {/* Dominance ring — gradient, animated on change */}
      <div className="flex w-[54px] items-center justify-end">
        <AccentRing
          value={dom}
          accent="#0891b2"
          size="sm"
          showLabel
          ariaLabel={`Dominance score ${dom.toFixed(2)}`}
        />
      </div>

      {/* Upstream */}
      <div className="w-[26px] text-right font-mono text-[10px] text-gray-600">
        {entry.upstream_count ?? 0}
      </div>
      {/* Downstream */}
      <div className="w-[26px] text-right font-mono text-[10px] text-gray-600">
        {entry.downstream_count ?? 0}
      </div>
      {/* Chains */}
      <div className="w-[26px] text-right font-mono text-[10px] text-gray-600">
        {entry.chain_count ?? 0}
      </div>

      {/* Cost */}
      <div className="flex w-[42px] justify-center">
        {cost ? (
          <AccentChip
            accent={
              cost === "low"
                ? "#16a34a"
                : cost === "mid"
                  ? "#d97706"
                  : "#dc2626"
            }
            size="xs"
            variant="soft"
          >
            {cost}
          </AccentChip>
        ) : (
          <span className="font-mono text-[9px] text-gray-300">—</span>
        )}
      </div>
    </div>
  );
}
