"use client";

// ── Canvas audit-mode toggle ──
//
// Bottom-right chip with three segments: surface · trail · audit. Sets
// CanvasAuditModeContext. Persists per-space via localStorage (handled
// inside the context provider, not here).
//
//   surface  — artefacts only; hides lens attribution + frame map +
//              divergence strip. For demos and skimming.
//   trail    — default. Shows lens attribution + frame map (collapsed
//              pill) + divergence strip + hover-expand on shells.
//   audit    — adds the frame map expanded by default and (future)
//              inline lens-vote breakdowns.
//
// Sits BOTTOM-RIGHT above the bottom-dock (z-30) so it stays out of
// the way of the lasso/system chip cluster at top-right and the dock
// itself. Compact when not hovered (just "Trail"), expands on hover
// to reveal all three segments — keeps the surface visually quiet for
// users who never touch it.

import { useState } from "react";
import { Eye, Layers, Microscope } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCanvasAuditMode,
  useSetCanvasAuditMode,
  type CanvasAuditMode,
} from "../canvas-audit-mode-context";

interface SegmentMeta {
  id: CanvasAuditMode;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  hint: string;
}

const SEGMENTS: SegmentMeta[] = [
  {
    id: "surface",
    label: "Surface",
    Icon: Eye,
    hint: "Artefacts only — hides reasoning chrome",
  },
  {
    id: "trail",
    label: "Trail",
    Icon: Layers,
    hint: "Default — shows lens attribution + frame map",
  },
  {
    id: "audit",
    label: "Audit",
    Icon: Microscope,
    hint: "Full depth — frame map expanded + inline detail",
  },
];

export function CanvasAuditModeToggle() {
  const mode = useCanvasAuditMode();
  const setMode = useSetCanvasAuditMode();
  const [hovered, setHovered] = useState(false);
  const activeMeta = SEGMENTS.find((s) => s.id === mode) ?? SEGMENTS[1];

  return (
    <div
      className="pointer-events-auto absolute bottom-20 left-6 z-30"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "flex items-center rounded-full border border-slate-200 bg-white/90 shadow-sm backdrop-blur-md",
          "transition-all duration-200",
          hovered ? "gap-0 px-1 py-1" : "gap-1.5 px-2.5 py-1",
        )}
      >
        {hovered ? (
          // Expanded — three buttons.
          SEGMENTS.map((seg) => {
            const isActive = seg.id === mode;
            const SegIcon = seg.Icon;
            return (
              <button
                key={seg.id}
                type="button"
                onClick={() => setMode(seg.id)}
                title={seg.hint}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition-colors",
                  isActive
                    ? "bg-slate-100 text-slate-700"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                )}
                aria-pressed={isActive}
              >
                <SegIcon className="h-3 w-3" />
                <span>{seg.label}</span>
              </button>
            );
          })
        ) : (
          // Collapsed — shows just the active mode.
          <>
            <activeMeta.Icon className="h-3 w-3 text-slate-500" />
            <span className="text-[10px] font-medium text-slate-600">
              {activeMeta.label}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
