"use client";

import Link from "next/link";
import {
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  MessageSquare,
  ArrowUpRight,
} from "lucide-react";
import { useState } from "react";
import { Ring } from "@/components/ui/ring";
import { cn } from "@/lib/utils";
import type { CanvasCardData } from "@/types";
import { getCanvasScopeColor } from "@/lib/design-tokens";

interface CanvasCardProps {
  canvas: CanvasCardData;
  showArchived: boolean;
  onTogglePin: () => void;
  onArchive: () => void;
  onRestore: () => void;
}

// Connectedness Ring: map raw bridge count → [0, 1] with a soft curve.
// 0 → 0, 1 → ~0.35, 5 → ~0.75, 20+ → ~1. Chosen so "a few links" already
// looks meaningfully filled, and "many links" saturates without needing
// a long tail.
function connectednessToRingValue(score: number): number {
  if (score <= 0) return 0;
  return 1 - Math.exp(-score / 6);
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const mins = Math.round((Date.now() - d) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function CanvasCard({
  canvas,
  showArchived,
  onTogglePin,
  onArchive,
  onRestore,
}: CanvasCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const color = getCanvasScopeColor(canvas.scope);
  const ringValue = connectednessToRingValue(canvas.connectedness_score);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition-all hover:shadow-md",
        canvas.pinned && !showArchived && "ring-1 ring-offset-1",
      )}
      style={
        canvas.pinned && !showArchived
          ? ({
              borderColor: color.tintBorder,
              // Ring offset approximation with box-shadow to match the dot color
              boxShadow: `0 0 0 1px ${color.tintBorder}, 0 1px 2px rgba(0,0,0,0.04)`,
            } as React.CSSProperties)
          : { borderColor: "rgba(0,0,0,0.08)" }
      }
    >
      {/* Scope stripe */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: color.dot }}
      />

      {/* Whole-card click target. Sits above the card surface but below the
          action buttons (which use `relative z-20`) so they keep their own clicks. */}
      <Link
        href={`/app/canvas/${canvas.id}`}
        aria-label={`Open ${canvas.title}`}
        className="absolute inset-0 z-10"
      />

      {/* Header: scope chip + actions */}
      <div className="relative z-20 flex items-start justify-between gap-2 pl-1.5">
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest"
          style={{
            background: color.tintBg,
            color: color.text,
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: color.dot }}
          />
          {color.label}
        </div>

        <div className="relative flex items-center gap-1">
          {canvas.pending_proposals > 0 && (
            <Link
              href={`/app/canvas/${canvas.id}/proposals`}
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
              title={`${canvas.pending_proposals} pending proposals`}
              onClick={(e) => e.stopPropagation()}
            >
              <MessageSquare className="h-2.5 w-2.5" />
              {canvas.pending_proposals}
            </Link>
          )}

          {!showArchived && (
            <button
              onClick={onTogglePin}
              className="rounded-md p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100"
              title={canvas.pinned ? "Unpin" : "Pin"}
              aria-label={canvas.pinned ? "Unpin" : "Pin"}
            >
              {canvas.pinned ? (
                <PinOff className="h-3.5 w-3.5" />
              ) : (
                <Pin className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-6 z-20 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                {showArchived ? (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onRestore();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    Restore
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onArchive();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body: title + ref + ring (purely presentational — overlay Link handles click) */}
      <div className="pointer-events-none relative mt-3 flex items-start justify-between gap-3 pl-1.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-gray-900 group-hover:text-gray-700">
            {canvas.title}
          </h3>
          {canvas.scope_ref_name && (
            <p className="mt-0.5 truncate text-xs text-gray-500">
              <span className="text-gray-400">in</span> {canvas.scope_ref_name}
            </p>
          )}
          {canvas.description && (
            <p className="mt-2 line-clamp-2 text-xs text-gray-600">
              {canvas.description}
            </p>
          )}
        </div>

        {canvas.connectedness_score > 0 ? (
          <div
            className="flex-shrink-0 text-right"
            title={`${canvas.connectedness_score} bridge${canvas.connectedness_score === 1 ? "" : "s"} connect this canvas to others`}
          >
            <Ring value={ringValue} size={40} showValue={false} />
            <div className="mt-1 text-[9px] font-medium uppercase tracking-widest text-gray-400">
              {canvas.connectedness_score} link{canvas.connectedness_score === 1 ? "" : "s"}
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer: updated + open affordance (decorative — overlay Link handles click) */}
      <div className="pointer-events-none relative mt-4 flex items-center justify-between pl-1.5 text-xs text-gray-500">
        <span>Updated {timeAgo(canvas.updated_at)}</span>
        <span className="inline-flex items-center gap-1 font-medium text-gray-700 opacity-0 transition-opacity group-hover:opacity-100">
          Open
          <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}
