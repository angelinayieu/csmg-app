"use client";

import { Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasGhostChipProps {
  screenX: number;
  screenY: number;
  entityName: string;
  pending: "accept" | "reject" | null;
  onAccept: () => void;
  onReject: () => void;
}

/** Bottom band where the canvas-bottom-dock + its overflow popovers
 *  typically render. When the target shape sits inside this band we
 *  flip the chip BELOW the shape instead of above so the chip doesn't
 *  cross the dock and occlude the input bar. Approximate; the dock's
 *  actual height varies (~120-180px depending on dropped files).
 */
const DOCK_BUFFER_PX = 240;

// Floats above the selected ghost shape. Anchored in screen coordinates so
// it tracks the shape as the user pans/zooms. The parent computes screenX/Y
// from editor.pageToScreen() on every tldraw render tick.
export function CanvasGhostChip({
  screenX,
  screenY,
  entityName,
  pending,
  onAccept,
  onReject,
}: CanvasGhostChipProps) {
  // Flip below when the shape is within DOCK_BUFFER_PX of the viewport
  // bottom. Using window.innerHeight directly is fine here — this
  // component re-renders on every editor tick that updates screenY,
  // so the comparison is always against a fresh viewport size.
  const flipBelow =
    typeof window !== "undefined" &&
    screenY > window.innerHeight - DOCK_BUFFER_PX;

  return (
    <div
      className="pointer-events-none absolute z-40"
      style={{
        left: screenX,
        top: screenY,
        transform: flipBelow
          ? "translate(-50%, 30%)"
          : "translate(-50%, -130%)",
      }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-gray-200/80 bg-white/95 px-1 py-1 shadow-[0_6px_24px_-6px_rgba(0,0,40,0.25)] backdrop-blur-md">
        <span className="pl-2 pr-1 text-[11px] font-semibold text-gray-500 max-w-[180px] truncate" title={entityName}>
          Predicted: {entityName}
        </span>
        <button
          onClick={onReject}
          disabled={pending !== null}
          className={cn(
            "flex h-6 items-center gap-1 rounded-full px-2 text-[10.5px] font-semibold transition-colors",
            pending === "reject"
              ? "bg-red-50 text-red-500"
              : "text-gray-500 hover:bg-red-50 hover:text-red-600",
          )}
          title="Reject (delete entity)"
        >
          {pending === "reject" ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          Reject
        </button>
        <button
          onClick={onAccept}
          disabled={pending !== null}
          className={cn(
            "flex h-6 items-center gap-1 rounded-full px-2.5 text-[10.5px] font-semibold transition-colors",
            pending === "accept"
              ? "bg-blue-100 text-blue-700"
              : "bg-blue-600 text-white hover:bg-blue-700",
          )}
          title="Accept (promote to confirmed)"
        >
          {pending === "accept" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Accept
        </button>
      </div>
    </div>
  );
}
