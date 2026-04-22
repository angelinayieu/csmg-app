"use client";

// ── Top-bar drawer trigger menu ──
// Seven drawers is too many for a flat button row — render as a dropdown.
// Button shows the active drawer (if any) for at-a-glance state.

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Radar,
  Boxes,
  Gauge,
  Compass,
  Target,
  Sparkles,
  ChevronDown,
  Activity,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DrawerId } from "./use-drawer-state";

interface TriggerEntry {
  id: DrawerId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}

const ENTRIES: TriggerEntry[] = [
  { id: "synthesis", label: "Synthesis", icon: BookOpen, hint: "Leverage · risks · loops · insights · chains" },
  { id: "intelligence", label: "Intelligence", icon: Radar, hint: "Radar · convergence · agents · reflexive" },
  { id: "twin", label: "Twin", icon: Activity, hint: "Digital twin · design · analysis · live" },
  { id: "strategy", label: "Strategy", icon: Compass, hint: "Strategy · interventions" },
  { id: "objectives", label: "Objectives", icon: Target, hint: "Goals · decomposition tree" },
  { id: "probability", label: "Probability", icon: Gauge, hint: "Spaces · node probability" },
  { id: "graph", label: "Graph", icon: Network, hint: "Force-directed · layered" },
  { id: "inventory", label: "Inventory", icon: Boxes, hint: "Entity catalog" },
];

export interface DrawerTriggersProps {
  activeDrawer: DrawerId | null;
  onOpen: (id: DrawerId) => void;
}

export function DrawerTriggers({ activeDrawer, onOpen }: DrawerTriggersProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const activeEntry = ENTRIES.find((e) => e.id === activeDrawer);
  const ActiveIcon = activeEntry?.icon ?? Sparkles;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors",
          activeDrawer
            ? "bg-interaxis-50 text-interaxis-700"
            : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
        )}
        title="Open drawer"
      >
        <ActiveIcon className="h-3 w-3" />
        {activeEntry?.label ?? "Panels"}
        <ChevronDown className="h-2.5 w-2.5 opacity-60" />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-9 z-50 min-w-[260px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
          {ENTRIES.map((entry) => {
            const Icon = entry.icon;
            const selected = entry.id === activeDrawer;
            return (
              <button
                key={entry.id}
                onClick={() => {
                  onOpen(entry.id);
                  setMenuOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                  selected
                    ? "bg-interaxis-50 text-interaxis-700"
                    : "text-gray-700 hover:bg-gray-50",
                )}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold leading-tight">
                    {entry.label}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-gray-400">
                    {entry.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
