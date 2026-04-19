"use client";

import { X, Zap, Play } from "lucide-react";
import type { TwinBuildMode } from "@/types/operating-twin";

interface BuildModeChooserProps {
  labCount: number;
  onSelect: (mode: TwinBuildMode) => void;
  onClose: () => void;
}

export function BuildModeChooser({ labCount, onSelect, onClose }: BuildModeChooserProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/30 backdrop-blur-sm">
      <div className="relative w-full max-w-[560px] bg-white rounded-2xl shadow-xl border border-black/5 p-7">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div
          className="font-mono text-[10px] font-bold tracking-[0.14em] uppercase mb-2"
          style={{ color: "var(--accent-600)" }}
        >
          OPERATING TWIN
        </div>
        <h2 className="text-[22px] font-bold text-gray-900 mb-1" style={{ letterSpacing: "-0.025em" }}>
          Build your twin
        </h2>
        <p className="text-[13px] text-gray-500 mb-6">
          Your objectives are approved. We can build {labCount} labs from your current data.
          How would you like to proceed?
        </p>

        <div className="space-y-3">
          {/* Mode A — Interactive */}
          <button
            onClick={() => onSelect("interactive")}
            className="w-full text-left p-5 rounded-xl border border-gray-200 hover:border-[var(--accent-300)] hover:bg-[var(--accent-50)]/50 transition-all group"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--accent-50)" }}
              >
                <Play className="h-[18px] w-[18px]" style={{ color: "var(--accent-600)" }} />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-semibold text-gray-900 mb-1" style={{ letterSpacing: "-0.015em" }}>
                  Build with me
                </div>
                <div className="text-[12.5px] text-gray-500 leading-relaxed">
                  Step through each proposed lab one at a time. Approve, tweak metrics, or skip.
                  You stay in control at every step.
                </div>
              </div>
            </div>
          </button>

          {/* Mode B — Auto */}
          <button
            onClick={() => onSelect("auto")}
            className="w-full text-left p-5 rounded-xl border border-gray-200 hover:border-[var(--accent-300)] hover:bg-[var(--accent-50)]/50 transition-all group"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--accent-50)" }}
              >
                <Zap className="h-[18px] w-[18px]" style={{ color: "var(--accent-600)" }} />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-semibold text-gray-900 mb-1" style={{ letterSpacing: "-0.015em" }}>
                  Confirm & auto-build
                </div>
                <div className="text-[12.5px] text-gray-500 leading-relaxed">
                  Review the full system proposal — labs, dashboards, metrics — then confirm once.
                  Your twin materializes in seconds.
                </div>
              </div>
            </div>
          </button>
        </div>

        <div className="mt-5 pt-4 border-t border-black/5 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">You can always adjust labs later.</span>
          <button
            onClick={onClose}
            className="text-[12px] font-medium text-gray-500 hover:text-gray-700"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
