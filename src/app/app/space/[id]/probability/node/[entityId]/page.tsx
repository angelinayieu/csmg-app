"use client";

// ── Node probability space page ──
// /app/space/[id]/probability/node/[entityId]
//
// Renders a single focal node's probability space view. Hydrates the focal
// entity and an entity-UUID lookup map from the space data context; the view
// itself calls the API on demand.

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { NodeProbabilitySpaceView } from "@/components/probability-space/node-probability-space-view";

export default function NodeProbabilityPage() {
  const params = useParams();
  const ctx = useSpaceData();

  const entityId = Array.isArray(params?.entityId) ? params.entityId[0] : params?.entityId;

  const focalEntity = useMemo(() => {
    if (!entityId) return null;
    return ctx.entities.find((e) => e.id === entityId) ?? null;
  }, [ctx.entities, entityId]);

  const entitiesByUuid = useMemo(() => {
    const m = new Map<string, typeof ctx.entities[number]>();
    for (const e of ctx.entities) m.set(e.id, e);
    return m;
  }, [ctx.entities]);

  if (!entityId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        No entity specified.
      </div>
    );
  }

  if (!focalEntity) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-500">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <div>Entity not found in this space.</div>
        <Link
          href={`/app/space/${ctx.space.id}/graph`}
          className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to graph
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-5 py-2 text-[11px] text-gray-500">
        <Link href={`/app/space/${ctx.space.id}/graph`} className="hover:text-gray-700">
          Graph
        </Link>
        <span>/</span>
        <Link href={`/app/space/${ctx.space.id}/probability`} className="hover:text-gray-700">
          Probability
        </Link>
        <span>/</span>
        <span className="font-medium text-gray-700">{focalEntity.name}</span>
      </div>

      {/* View */}
      <NodeProbabilitySpaceView
        spaceId={ctx.space.id}
        focalEntity={focalEntity}
        entitiesByUuid={entitiesByUuid}
        className="flex-1"
      />
    </div>
  );
}
