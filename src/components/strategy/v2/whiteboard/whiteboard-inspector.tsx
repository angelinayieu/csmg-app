"use client";

import Link from "next/link";
import { X, ExternalLink } from "lucide-react";
import type { WhiteboardNode } from "@/types/whiteboard";

interface Props {
  node: WhiteboardNode | null;
  spaceId: string;
  pinned: boolean;
  onClose: () => void;
  onTogglePin: () => void;
}

export function WhiteboardInspector({ node, spaceId, pinned, onClose, onTogglePin }: Props) {
  if (!node) return null;

  // Deep link target based on source type
  let jumpHref: string | null = null;
  let jumpLabel = "View in graph";
  if (node.sourceType === "entity" && node.sourceId) {
    jumpHref = `/app/space/${spaceId}?entity=${encodeURIComponent(node.sourceId)}`;
  } else if (node.sourceType === "leverage" && node.sourceId) {
    jumpHref = `/app/space/${spaceId}?entity=${encodeURIComponent(node.sourceId)}`;
  } else if (node.sourceType === "bottleneck" && node.sourceId) {
    jumpHref = `/app/space/${spaceId}?entity=${encodeURIComponent(node.sourceId)}`;
  } else if (node.sourceType === "risk" && node.sourceId) {
    jumpHref = `/app/space/${spaceId}?entity=${encodeURIComponent(node.sourceId)}`;
  } else if (node.sourceType === "goal" && node.sourceId) {
    jumpHref = `/app/space/${spaceId}`;
    jumpLabel = "Open goal";
  } else if (node.sourceType === "perspective" || node.sourceType === "tactic") {
    jumpHref = `/app/space/${spaceId}/strategy`;
    jumpLabel = "View strategy cascade";
  }

  return (
    <div
      data-no-pan
      data-no-zoom
      className="absolute top-4 right-[232px] z-[55] flex w-[300px] flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl"
      style={{ maxHeight: "calc(100% - 32px)" }}
    >
      <div className="flex items-start justify-between gap-2 border-b border-gray-100 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            {node.layer}
          </p>
          <p className="mt-1 text-[14px] font-bold text-gray-900 leading-tight">
            {node.label}
          </p>
          {node.subtitle && (
            <p className="mt-1 text-[11.5px] text-gray-500 leading-snug">
              {node.subtitle}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400">
            Source
          </p>
          <p className="mt-0.5 text-[12px] text-gray-700 capitalize">
            {node.sourceType}
            {node.sourceId && (
              <span className="ml-1 text-gray-400 font-mono">· {node.sourceId}</span>
            )}
          </p>
        </div>

        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400">
            Position
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-gray-600">
            {node.x != null ? Math.round(node.x) : "?"}, {node.y != null ? Math.round(node.y) : "?"}
            {pinned && <span className="ml-2 text-amber-600">· pinned</span>}
          </p>
        </div>

        <button
          onClick={onTogglePin}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-100"
        >
          {pinned ? "Unpin node" : "Pin to current position"}
        </button>

        {jumpHref && (
          <Link
            href={jumpHref}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-interaxis-500 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-interaxis-600"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {jumpLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
