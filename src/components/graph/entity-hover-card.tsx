"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Target,
  Layers,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getNodeColor } from "@/lib/design-tokens";
import type { Entity, Edge, Claim } from "@/types";

interface EntityHoverCardProps {
  entity: Entity;
  edges: Edge[];
  entities: Entity[];
  claims: Claim[];
  spaceId: string;
  /** Anchor position in viewport coords (where the node was clicked/hovered) */
  anchorX: number;
  anchorY: number;
  /** Called when user dismisses (clicks outside or presses Escape) */
  onClose?: () => void;
  /** Called when user clicks "Open full view" — lets the parent handle navigation */
  onOpenFullView?: () => void;
}

/**
 * Tier-1 preview of an entity — the hover/popover card.
 *
 * Shows at-a-glance:
 *   - Name + category
 *   - 1-line description
 *   - Confidence + evidence-strength bars
 *   - Top-3 connected entities
 *   - Top-1 claim (if any)
 *   - "Open full view" → Tier-3 page
 *   - Plus-button menu (decompose / ask / etc)
 *
 * Positions itself relative to an anchor point so it doesn't escape the viewport.
 */
export function EntityHoverCard({
  entity,
  edges,
  entities,
  claims,
  spaceId,
  anchorX,
  anchorY,
  onClose,
  onOpenFullView,
}: EntityHoverCardProps) {
  const colors = getNodeColor(entity.entity_category);

  // Top-3 connected entities
  const topNeighbors = useMemo(() => {
    const byId = new Map(entities.map((e) => [e.id, e]));
    const seen = new Set<string>();
    const results: Array<{ entity: Entity; direction: "in" | "out"; confidence: number }> = [];
    for (const edge of edges) {
      const isOut = edge.source_entity_id === entity.id;
      const isIn = edge.target_entity_id === entity.id;
      if (!isOut && !isIn) continue;
      const otherId = isOut ? edge.target_entity_id : edge.source_entity_id;
      if (seen.has(otherId)) continue;
      const other = byId.get(otherId);
      if (!other) continue;
      seen.add(otherId);
      results.push({
        entity: other,
        direction: isOut ? "out" : "in",
        confidence: edge.confidence ?? 0.5,
      });
    }
    results.sort((a, b) => b.confidence - a.confidence);
    return results.slice(0, 3);
  }, [entity.id, edges, entities]);

  // Top claim
  const topClaim = useMemo(() => {
    const mine = claims.filter((c) => c.source_entity_id === entity.id);
    mine.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    return mine[0] ?? null;
  }, [claims, entity.id]);

  const confidencePct = Math.round((entity.confidence ?? 0) * 100);
  const evidencePct = Math.round(((entity as Entity & { evidence_strength?: number | null }).evidence_strength ?? 0) * 100);

  // Position: clamp to viewport with some padding
  const cardWidth = 320;
  const cardHeight = 260;
  const padding = 12;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 900;
  const left = Math.max(padding, Math.min(viewportW - cardWidth - padding, anchorX + 16));
  const top = Math.max(padding, Math.min(viewportH - cardHeight - padding, anchorY + 16));

  return (
    <>
      {/* Transparent backdrop to catch clicks-outside */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      {/* Card */}
      <div
        className="fixed z-50 w-80 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top stripe */}
        <div
          className="h-1"
          style={{ background: colors.stroke }}
        />

        {/* Header */}
        <div className="px-3.5 py-2.5 border-b border-gray-100">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div
                className="inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider mb-1"
                style={{
                  background: `${colors.fill}30`,
                  color: colors.stroke,
                }}
              >
                {entity.entity_category}
              </div>
              <h3 className="text-sm font-bold text-gray-900 leading-tight">{entity.name}</h3>
              {entity.entity_type && (
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mt-0.5">
                  {entity.entity_type}
                </div>
              )}
            </div>
          </div>

          {/* Description (1 line) */}
          {entity.description && (
            <p className="mt-1.5 text-[11px] leading-snug text-gray-600 line-clamp-2">
              {entity.description}
            </p>
          )}
        </div>

        {/* Confidence + Evidence bars */}
        <div className="px-3.5 py-2 border-b border-gray-100 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-16 text-[9px] font-bold uppercase tracking-wider text-gray-400">
              Confidence
            </span>
            <div className="flex-1 h-1 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  confidencePct >= 80 ? "bg-emerald-500"
                    : confidencePct >= 50 ? "bg-amber-500"
                    : "bg-rose-500",
                )}
                style={{ width: `${confidencePct}%` }}
              />
            </div>
            <span className="w-8 text-right text-[10px] font-semibold tabular-nums text-gray-600">
              {confidencePct}%
            </span>
          </div>
          {evidencePct > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-16 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                Evidence
              </span>
              <div className="flex-1 h-1 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-interaxis-500 transition-all"
                  style={{ width: `${evidencePct}%` }}
                />
              </div>
              <span className="w-8 text-right text-[10px] font-semibold tabular-nums text-gray-600">
                {evidencePct}%
              </span>
            </div>
          )}
        </div>

        {/* Top neighbors */}
        {topNeighbors.length > 0 && (
          <div className="px-3.5 py-2 border-b border-gray-100">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
              Connected ({topNeighbors.length})
            </div>
            <div className="space-y-1">
              {topNeighbors.map(({ entity: n, direction }) => {
                const nc = getNodeColor(n.entity_category);
                return (
                  <div key={n.id} className="flex items-center gap-1.5 text-[11px]">
                    <ArrowRight
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 text-gray-400",
                        direction === "in" && "rotate-180",
                      )}
                    />
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: nc.stroke }}
                    />
                    <span className="truncate text-gray-700">{n.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Top claim */}
        {topClaim && (
          <div className="px-3.5 py-2 border-b border-gray-100">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">
              Key claim
            </div>
            <p className="text-[11px] leading-snug text-gray-700 line-clamp-2">
              {topClaim.claim_text}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50">
          <Link
            href={`/app/space/${spaceId}/entity/${entity.id}`}
            onClick={onOpenFullView}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-interaxis-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-interaxis-700"
          >
            <ExternalLink className="h-3 w-3" />
            Open full view
          </Link>
          {entity.is_decomposable && (
            <Link
              href={`/app/space/${spaceId}/entity/${entity.id}`}
              onClick={onOpenFullView}
              className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100"
              title="Decompose this entity"
            >
              <Layers className="h-3 w-3" />
            </Link>
          )}
          <Link
            href={`/app/space/${spaceId}/probability/node/${entity.id}`}
            onClick={onOpenFullView}
            className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100"
            title="Probability space"
          >
            <Target className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </>
  );
}
