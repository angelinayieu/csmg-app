"use client";

import { Zap, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasNudgeChipProps {
  screenX: number;
  screenY: number;
  name: string;
  missingChildren: number;
  busy: boolean;
  onDecompose: () => void;
}

/** Same dock-avoidance band as CanvasGhostChip — when a hub sits near
 *  the viewport bottom, render the nudge chip BELOW the shape instead
 *  of above so it doesn't collide with the bottom dock. */
const DOCK_BUFFER_PX = 240;

export function CanvasNudgeChip({
  screenX,
  screenY,
  name,
  missingChildren,
  busy,
  onDecompose,
}: CanvasNudgeChipProps) {
  const flipBelow =
    typeof window !== "undefined" &&
    screenY > window.innerHeight - DOCK_BUFFER_PX;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: screenX,
        top: screenY,
        transform: flipBelow
          ? "translate(-50%, calc(0% + 14px))"
          : "translate(-50%, calc(-100% - 14px))",
      }}
    >
      <button
        onClick={onDecompose}
        disabled={busy}
        className={cn(
          "pointer-events-auto flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/95 px-2.5 py-1 text-[10.5px] font-semibold text-blue-700 shadow-sm backdrop-blur-sm transition-all",
          busy ? "opacity-70" : "hover:-translate-y-0.5 hover:shadow",
        )}
        title={`Decompose "${name}" — needs ${missingChildren} more child${missingChildren === 1 ? "" : "ren"}`}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Zap className="h-3 w-3" />
        )}
        Decompose{missingChildren > 0 ? ` (+${missingChildren})` : ""}
      </button>
    </div>
  );
}
