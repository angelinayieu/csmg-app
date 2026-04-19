"use client";

import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  StickyNote,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WhiteboardLayer } from "@/types/whiteboard";
import { LAYER_ORDER } from "./use-whiteboard-physics";

const LAYER_LABELS: Record<WhiteboardLayer, string> = {
  inputs: "Inputs",
  scope: "Scope",
  objectives: "Objectives",
  kg: "Knowledge Graph",
  strategy: "Strategy",
  tracking: "Tracking",
  feedback: "Self-Improve",
};

const LAYER_DOTS: Record<WhiteboardLayer, string> = {
  inputs: "#64748B",
  scope: "#4F46E5",
  objectives: "#059669",
  kg: "rgb(var(--accent-rgb))",
  strategy: "#EA580C",
  tracking: "#0891B2",
  feedback: "#9333EA",
};

interface Props {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  onAddPostIt: () => void;
  hiddenLayers: Set<WhiteboardLayer>;
  onToggleLayer: (layer: WhiteboardLayer) => void;
  onResetPins: () => void;
}

export function WhiteboardControls({
  zoomIn,
  zoomOut,
  reset,
  onAddPostIt,
  hiddenLayers,
  onToggleLayer,
  onResetPins,
}: Props) {
  return (
    <div
      data-no-pan
      data-no-zoom
      className="absolute top-4 right-4 z-[50] flex flex-col gap-2"
    >
      {/* Zoom + reset controls */}
      <div
        className="flex overflow-hidden rounded-xl border border-gray-200 bg-white/90 shadow-md backdrop-blur"
      >
        <button
          onClick={zoomIn}
          className="flex h-9 w-9 items-center justify-center text-gray-600 transition-colors hover:bg-gray-100"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={zoomOut}
          className="flex h-9 w-9 items-center justify-center border-l border-gray-200 text-gray-600 transition-colors hover:bg-gray-100"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={reset}
          className="flex h-9 w-9 items-center justify-center border-l border-gray-200 text-gray-600 transition-colors hover:bg-gray-100"
          title="Reset view"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* Add post-it */}
      <button
        onClick={onAddPostIt}
        className="flex h-9 items-center gap-2 rounded-xl border border-gray-200 bg-white/90 px-3 text-[12px] font-semibold text-gray-700 shadow-md backdrop-blur transition-colors hover:bg-gray-100"
        title="Add sticky note"
      >
        <StickyNote className="h-4 w-4 text-amber-500" />
        Add note
      </button>

      {/* Layer visibility */}
      <div
        className="rounded-xl border border-gray-200 bg-white/90 p-2 shadow-md backdrop-blur"
      >
        <p className="mb-1.5 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-gray-400">
          Layers
        </p>
        <div className="flex flex-col gap-0.5">
          {LAYER_ORDER.map((layer) => {
            const hidden = hiddenLayers.has(layer);
            return (
              <button
                key={layer}
                onClick={() => onToggleLayer(layer)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1 text-[11.5px] font-medium transition-colors",
                  hidden
                    ? "text-gray-400 hover:bg-gray-100"
                    : "text-gray-700 hover:bg-gray-100"
                )}
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ background: LAYER_DOTS[layer], opacity: hidden ? 0.25 : 1 }}
                />
                <span className="flex-1 text-left">{LAYER_LABELS[layer]}</span>
                {hidden ? (
                  <EyeOff className="h-3 w-3 opacity-60" />
                ) : (
                  <Eye className="h-3 w-3 opacity-60" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reset pins */}
      <button
        onClick={onResetPins}
        className="rounded-xl border border-gray-200 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-gray-600 shadow-md backdrop-blur transition-colors hover:bg-gray-100"
        title="Clear all pinned positions"
      >
        Reset pins
      </button>
    </div>
  );
}
