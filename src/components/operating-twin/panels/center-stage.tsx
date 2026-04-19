"use client";

import { Plus } from "lucide-react";
import { InfiniteCanvas } from "../canvas/infinite-canvas";
import type { LabCard, OperatingTwinModel } from "@/types/operating-twin";

interface CenterStageProps {
  model: OperatingTwinModel;
  onLabClick: (lab: LabCard) => void;
  onCreateLab?: () => void;
}

export function CenterStage({ model, onLabClick, onCreateLab }: CenterStageProps) {
  return (
    <div
      className="relative rounded-[14px] border border-black/5 bg-white overflow-hidden"
      style={{ minHeight: 0 }}
    >
      {/* Figma-style dot grid background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(circle, rgba(10,11,15,0.07) 0.8px, transparent 0.8px)",
          backgroundSize: "28px 28px",
          backgroundPosition: "center center",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      {/* Edge gradient for depth */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(245,245,247,0.5) 100%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Stage header */}
      <div
        className="absolute top-3.5 left-3.5 right-3.5 flex items-center justify-between z-30 pointer-events-none"
        data-no-pan
      >
        <div
          className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 pl-2.5 rounded-full text-[11.5px] font-medium text-gray-900"
          style={{
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "0.5px solid rgba(10,11,15,0.08)",
            boxShadow: "0 2px 8px rgba(10,11,15,0.04)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-emerald-500"
            style={{ boxShadow: "0 0 0 3px rgba(16,185,129,0.18)" }}
          />
          Twin running
          <span className="text-gray-500 font-normal ml-0.5">
            · {model.labs.length} labs active
          </span>
        </div>

        {onCreateLab && (
          <button
            data-no-pan
            onClick={onCreateLab}
            className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[12px] font-semibold text-white transition-all hover:-translate-y-[1px]"
            style={{
              background: "#0a0b0f",
              boxShadow: "0 2px 8px rgba(10,11,15,0.12)",
              letterSpacing: "-0.01em",
            }}
          >
            <Plus className="h-3 w-3" strokeWidth={2.5} />
            New lab
          </button>
        )}
      </div>

      {/* Canvas */}
      <InfiniteCanvas model={model} onLabClick={onLabClick} />
    </div>
  );
}
