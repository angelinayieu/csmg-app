"use client";

// ── Canvas entity-detail drawer ──
//
// Mounts when `?entity=<uuid>` is on the URL. Fetches
// /api/entities/[id]/detail (one round-trip for entity + connected
// edges + claims) and renders the existing NodeDetail component.
//
// NodeDetail is the "gold-standard" entity view that was already
// built for the graph page: evidence basis, manifold dimensions
// (strategic/operational/epistemic), temporal validity, provenance,
// connected edges with conditions + polarity + EdgeVerdictWidget,
// interaction-field top-influences, and navigation deep-links. The
// canvas card only rendered ~6 fields from the same underlying row,
// so wiring NodeDetail to click-to-open closes the biggest
// "system knows more than it shows" gap in the UX.

import { useCallback, useEffect, useMemo, useState } from "react";
import { NodeDetail } from "@/components/graph/node-detail";
import type { Entity, Edge, Claim } from "@/types";

interface EntityDetailDrawerProps {
  entityId: string | null;
  /** All entities currently loaded on the canvas — used to resolve
   *  edge endpoints to names without a second round-trip. */
  entityMap: Map<string, Entity>;
  /** All cycles currently loaded — used for cycle-membership navigation. */
  cycles: Cycle[];
  /** Space id for deep-link navigation back out to full entity view. */
  spaceId: string;
  onClose: () => void;
}

type Cycle = import("@/types").Cycle;

interface DetailResponse {
  entity: Entity;
  edges: Edge[];
  claims: Claim[];
}

export function EntityDetailDrawer({
  entityId,
  entityMap,
  cycles,
  spaceId,
  onClose,
}: EntityDetailDrawerProps) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch on entityId change. Reset state on close so stale data doesn't
  // flash on the next open.
  useEffect(() => {
    if (!entityId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/entities/${entityId}/detail`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Lookup failed (${res.status})`);
        }
        return res.json() as Promise<DetailResponse>;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Lookup failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  // Merge the detail response's entity into the caller-supplied map so
  // NodeDetail can resolve both ends of each connected edge, even when
  // one end is an entity not currently painted on the canvas (e.g. an
  // external/bridge node). We key by both UUID and entity_id since
  // legacy edges may reference either.
  const mergedEntityMap = useMemo(() => {
    const m = new Map(entityMap);
    if (data?.entity) {
      m.set(data.entity.id, data.entity);
      if (data.entity.entity_id) m.set(data.entity.entity_id, data.entity);
    }
    return m;
  }, [entityMap, data?.entity]);

  const handleClose = useCallback(() => {
    setData(null);
    setError(null);
    onClose();
  }, [onClose]);

  if (!entityId) return null;

  if (loading && !data) {
    return (
      <div className="fixed right-0 top-0 z-50 flex h-full w-[380px] flex-col items-center justify-center border-l border-gray-200 bg-white shadow-lg"
        style={{ animation: "slideInRight 300ms ease forwards" }}
      >
        <div className="text-[12px] text-gray-400">Loading entity…</div>
        <style jsx>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed right-0 top-0 z-50 flex h-full w-[380px] flex-col items-center justify-center border-l border-gray-200 bg-white px-8 text-center shadow-lg">
        <div className="mb-3 text-[13px] font-semibold text-gray-700">
          Couldn&apos;t load entity
        </div>
        <div className="mb-4 text-[11px] text-gray-500">{error}</div>
        <button
          onClick={handleClose}
          className="rounded-md border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <NodeDetail
      entity={data.entity}
      edges={data.edges}
      entityMap={mergedEntityMap}
      cycles={cycles}
      claims={data.claims}
      onClose={handleClose}
      spaceId={spaceId}
    />
  );
}
