"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNodeColor } from "@/lib/design-tokens";
import type { Entity, Edge } from "@/types";

interface EntityNeighborRailProps {
  spaceId: string;
  entity: Entity;
  entities: Entity[];
  edges: Edge[];
  /** Limit per direction (default 5) */
  limit?: number;
}

/**
 * Persistent upstream/downstream breadcrumb rail for the entity detail page.
 *
 * Shows the immediate neighborhood around the focal entity:
 *   - upstream: entities with edges pointing INTO this one
 *   - downstream: entities with edges pointing OUT from this one
 *
 * Each neighbor is a clickable chip that navigates to its own entity page,
 * so the user can traverse the graph without losing context.
 */
export function EntityNeighborRail({
  spaceId,
  entity,
  entities,
  edges,
  limit = 5,
}: EntityNeighborRailProps) {
  const { upstream, downstream } = useMemo(() => {
    const entityById = new Map(entities.map((e) => [e.id, e]));
    const upstreamSet = new Map<string, { entity: Entity; relationship: string; confidence: number }>();
    const downstreamSet = new Map<string, { entity: Entity; relationship: string; confidence: number }>();

    for (const edge of edges) {
      if (edge.target_entity_id === entity.id) {
        const src = entityById.get(edge.source_entity_id);
        if (src && !upstreamSet.has(src.id)) {
          upstreamSet.set(src.id, {
            entity: src,
            relationship: edge.relationship_type,
            confidence: edge.confidence ?? 0.5,
          });
        }
      }
      if (edge.source_entity_id === entity.id) {
        const tgt = entityById.get(edge.target_entity_id);
        if (tgt && !downstreamSet.has(tgt.id)) {
          downstreamSet.set(tgt.id, {
            entity: tgt,
            relationship: edge.relationship_type,
            confidence: edge.confidence ?? 0.5,
          });
        }
      }
    }

    const sortByConfidence = (a: { confidence: number }, b: { confidence: number }) =>
      b.confidence - a.confidence;

    return {
      upstream: Array.from(upstreamSet.values()).sort(sortByConfidence).slice(0, limit),
      downstream: Array.from(downstreamSet.values()).sort(sortByConfidence).slice(0, limit),
    };
  }, [entity.id, entities, edges, limit]);

  const NeighborChip = ({
    entity: e,
    relationship,
    direction,
  }: {
    entity: Entity;
    relationship: string;
    direction: "upstream" | "downstream";
  }) => {
    const colors = getNodeColor(e.entity_category);
    return (
      <Link
        href={`/app/space/${spaceId}/entity/${e.id}`}
        className={cn(
          "group flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition-all",
          "hover:shadow-sm hover:-translate-y-0.5",
        )}
        style={{
          borderColor: colors.stroke,
          background: `${colors.fill}20`,
        }}
        title={`${direction === "upstream" ? "← " : "→ "}${relationship}`}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: colors.stroke }}
        />
        <span className="truncate max-w-[140px] font-medium text-gray-800 group-hover:text-gray-900">
          {e.name}
        </span>
        <span className="hidden text-[9px] uppercase tracking-wider text-gray-400 sm:inline">
          {relationship}
        </span>
      </Link>
    );
  };

  return (
    <div className="space-y-2">
      {/* Upstream row */}
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          <ArrowRight className="h-3 w-3 rotate-180" />
          Upstream
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-500">
            {upstream.length}
          </span>
        </div>
        <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
          {upstream.length === 0 ? (
            <span className="text-[11px] italic text-gray-400">No incoming edges</span>
          ) : (
            upstream.map(({ entity: e, relationship }) => (
              <NeighborChip key={e.id} entity={e} relationship={relationship} direction="upstream" />
            ))
          )}
        </div>
      </div>

      {/* Downstream row */}
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          <ArrowRight className="h-3 w-3" />
          Downstream
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-500">
            {downstream.length}
          </span>
        </div>
        <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
          {downstream.length === 0 ? (
            <span className="text-[11px] italic text-gray-400">No outgoing edges</span>
          ) : (
            downstream.map(({ entity: e, relationship }) => (
              <NeighborChip key={e.id} entity={e} relationship={relationship} direction="downstream" />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
