"use client";

import { useMemo, useState } from "react";
import { Search, X, GripVertical, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";

// Drag-payload JSON written to dataTransfer during a drag from this
// drawer. The canvas's onDrop handler recognises this MIME type and
// materializes a KG-node shape for the chosen entity at the drop point.
export const ENTITY_DRAG_MIME = "application/x-interaxis-entity";

export interface EntityDragPayload {
  id: string;
  name: string;
  description: string | null;
  entity_category: string | null;
  layer: string | null;
  importance: string | null;
  confidence: number | null;
  space_id: string;
}

export interface CanvasAssetDrawerProps {
  open: boolean;
  entities: Entity[];
  /** Which entity UUIDs are already placed on the canvas — render with a check */
  placedEntityIds: Set<string>;
  /** Map of space_id → display name, for the grouping headers */
  spaceNameById: Map<string, string>;
  onClose: () => void;
}

// Collapsible left-side panel — opens from the tool dock's "library"
// tool. Lists every entity the canvas has access to, grouped by their
// source space, filterable by a top search box. Rows are draggable; drop
// on the canvas creates a KG-node shape for that entity.
export function CanvasAssetDrawer({
  open,
  entities,
  placedEntityIds,
  spaceNameById,
  onClose,
}: CanvasAssetDrawerProps) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entities.filter((e) => {
          const hay = `${e.name} ${e.description ?? ""}`.toLowerCase();
          return hay.includes(q);
        })
      : entities;

    // Group by space_id, preserve input order within each group
    const bySpace = new Map<string, Entity[]>();
    for (const e of filtered) {
      if (!bySpace.has(e.space_id)) bySpace.set(e.space_id, []);
      bySpace.get(e.space_id)!.push(e);
    }

    return Array.from(bySpace.entries()).map(([spaceId, items]) => ({
      spaceId,
      spaceName: spaceNameById.get(spaceId) ?? "(unknown space)",
      items,
    }));
  }, [entities, query, spaceNameById]);

  if (!open) return null;

  return (
    <div className="pointer-events-auto absolute left-[72px] top-1/2 z-30 -translate-y-1/2">
      <div className="flex h-[62vh] w-[320px] flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white/92 shadow-lg backdrop-blur-md">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-600">
              Library
            </div>
            <div className="mt-0.5 text-[12px] font-semibold text-gray-900">
              {entities.length} entities · {grouped.length}{" "}
              {grouped.length === 1 ? "space" : "spaces"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Close library"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-gray-100 px-2.5 py-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-gray-100/70 px-2.5 py-1.5">
            <Search className="h-3 w-3 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entities…"
              className="flex-1 bg-transparent text-[12px] text-gray-800 placeholder:text-gray-400 focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="mt-1 px-1 text-[9.5px] text-gray-400">
            Drag any row onto the canvas to drop a shape.
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1">
          {grouped.length === 0 && (
            <div className="px-4 pt-6 text-center text-[11.5px] text-gray-400">
              No entities match &ldquo;{query}&rdquo;
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.spaceId} className="mb-2">
              <div className="sticky top-0 z-10 bg-white/95 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-gray-400 backdrop-blur">
                {group.spaceName}
                <span className="ml-1 text-gray-300">· {group.items.length}</span>
              </div>
              {group.items.map((entity) => {
                const isPlaced = placedEntityIds.has(entity.id);
                return (
                  <EntityRow
                    key={entity.id}
                    entity={entity}
                    isPlaced={isPlaced}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EntityRow({ entity, isPlaced }: { entity: Entity; isPlaced: boolean }) {
  const payload: EntityDragPayload = {
    id: entity.id,
    name: entity.name,
    description: entity.description ?? null,
    entity_category: (entity.entity_category as string) ?? null,
    layer: entity.layer ?? null,
    importance: entity.importance ?? null,
    confidence: (entity.confidence as number | null) ?? null,
    space_id: entity.space_id,
  };

  const categoryAccent =
    entity.entity_category === "process"
      ? "#10B981"
      : entity.entity_category === "relational"
        ? "#F97316"
        : entity.entity_category === "epistemic"
          ? "#EC4899"
          : entity.entity_category === "abstract"
            ? "#8B5CF6"
            : "#3B82F6";

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(ENTITY_DRAG_MIME, JSON.stringify(payload));
        // Fallback text for other drop targets
        e.dataTransfer.setData("text/plain", entity.name);
      }}
      className={cn(
        "group mx-1 flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50 active:cursor-grabbing",
        isPlaced && "opacity-60",
      )}
      title={entity.description ?? entity.name}
    >
      <GripVertical className="h-3 w-3 flex-shrink-0 text-gray-300 group-hover:text-gray-500" />
      <span
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: categoryAccent }}
      />
      <div className="flex-1 min-w-0">
        <div className="truncate text-[12px] font-semibold text-gray-900">
          {entity.name}
        </div>
        {entity.description && (
          <div className="truncate text-[10px] text-gray-500">
            {entity.description}
          </div>
        )}
      </div>
      {isPlaced && (
        <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-green-500" />
      )}
    </div>
  );
}
