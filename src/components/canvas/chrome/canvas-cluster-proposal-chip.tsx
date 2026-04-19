"use client";

import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const LAYER_ACCENT: Record<string, string> = {
  L0: "#0051ff",
  L1: "#1a7aff",
  L2: "#5856d6",
  L3: "#af52de",
  L4: "#ff9500",
};

export interface CanvasClusterProposalChipProps {
  screenX: number;
  screenY: number;
  size: number;
  dominantLayer: string;
  onAccept: () => void;
  onDismiss: () => void;
}

export function CanvasClusterProposalChip({
  screenX,
  screenY,
  size,
  dominantLayer,
  onAccept,
  onDismiss,
}: CanvasClusterProposalChipProps) {
  const accent = LAYER_ACCENT[dominantLayer] ?? "#5856d6";
  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left: screenX, top: screenY, transform: "translate(-50%, -50%)" }}
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-1 rounded-full border bg-white/95 px-1 py-1 shadow-md backdrop-blur-md",
        )}
        style={{ borderColor: `${accent}55` }}
      >
        <button
          onClick={onAccept}
          className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[10.5px] font-semibold transition-colors"
          style={{
            background: accent,
            color: "white",
          }}
          title={`Wrap these ${size} nodes in a cluster frame`}
        >
          <Layers className="h-3 w-3" />
          Cluster these {size}
        </button>
        <button
          onClick={onDismiss}
          className="flex h-6 items-center justify-center rounded-full px-2 text-[10px] font-semibold text-gray-500 transition-colors hover:text-gray-700"
          title="Dismiss this proposal"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
