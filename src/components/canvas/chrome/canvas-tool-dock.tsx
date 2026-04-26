"use client";

import { MousePointer2, StickyNote, Square, ArrowRight, Type, PenTool, MessageSquare, Sparkles, Hand, Library } from "lucide-react";
import { cn } from "@/lib/utils";

export type CanvasTool =
  | "select"
  | "hand"
  | "sticky"
  | "shape"
  | "arrow"
  | "text"
  | "draw"
  | "comment"
  | "ai"
  | "library";

export interface CanvasToolDockProps {
  active: CanvasTool;
  libraryOpen: boolean;
  onSelect: (tool: CanvasTool) => void;
}

const TOOLS: { id: CanvasTool; icon: typeof MousePointer2; label: string; shortcut: string }[] = [
  { id: "select", icon: MousePointer2, label: "Select", shortcut: "V" },
  { id: "hand", icon: Hand, label: "Pan", shortcut: "H" },
  { id: "sticky", icon: StickyNote, label: "Sticky note", shortcut: "N" },
  { id: "shape", icon: Square, label: "Shape", shortcut: "R" },
  { id: "arrow", icon: ArrowRight, label: "Arrow", shortcut: "A" },
  { id: "text", icon: Type, label: "Text", shortcut: "T" },
  { id: "draw", icon: PenTool, label: "Draw", shortcut: "D" },
  { id: "library", icon: Library, label: "Library", shortcut: "L" },
  { id: "comment", icon: MessageSquare, label: "Comment", shortcut: "C" },
  { id: "ai", icon: Sparkles, label: "AI wand", shortcut: "⌘K" },
];

export function CanvasToolDock({ active, libraryOpen, onSelect }: CanvasToolDockProps) {
  return (
    // Slides right when the outer glass rail expands. `--kg-rail-offset`
    // is set on document.documentElement by FloatingGlassSidebar — 0px
    // when the rail is the thin collapsed strip, ~140px when the user
    // hovers and pills appear. Spring easing gives the physics feel.
    <div
      style={{ left: `calc(1rem + var(--kg-rail-offset, 0px))` }}
      className="pointer-events-auto absolute top-1/2 z-30 -translate-y-1/2 transition-[left] duration-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
    >
      <div className="flex flex-col gap-0.5 rounded-2xl border border-gray-200/70 bg-white/85 p-1 shadow-md backdrop-blur-md">
        {TOOLS.map((tool, idx) => {
          const Icon = tool.icon;
          // "Library" is a toggle — highlight when drawer is open rather
          // than when it's the selected tool (tool selection always
          // snaps back to select after the drawer toggles).
          const isActive =
            tool.id === "library" ? libraryOpen : active === tool.id;
          const divider = idx === 1 || idx === 6 || idx === 7;
          return (
            <div key={tool.id} className="flex flex-col">
              <button
                onClick={() => onSelect(tool.id)}
                className={cn(
                  "group relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)]"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-800",
                )}
                title={`${tool.label} (${tool.shortcut})`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} />
                <span
                  className={cn(
                    "pointer-events-none absolute left-11 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[10.5px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100",
                  )}
                >
                  {tool.label}
                  <span className="ml-1.5 text-gray-400">{tool.shortcut}</span>
                </span>
              </button>
              {divider && <div className="my-0.5 h-px w-full bg-gray-200/70" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
