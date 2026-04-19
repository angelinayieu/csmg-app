"use client";

import { Atom, FlaskConical, Waves } from "lucide-react";
import { cn } from "@/lib/utils";

export type LabMode = "structure" | "react" | "spectrum";

export interface LabModeSwitcherProps {
  mode: LabMode;
  onChange: (mode: LabMode) => void;
}

const MODES: { id: LabMode; label: string; icon: typeof Atom; hint: string }[] = [
  { id: "structure", label: "Structure", icon: Atom, hint: "Molecular view — subunits, bonds, external satellites" },
  { id: "react", label: "React", icon: FlaskConical, hint: "Load reactants into the tray and predict products" },
  { id: "spectrum", label: "Spectrum", icon: Waves, hint: "Emission signature across the entity's bonds + subunits" },
];

export function LabModeSwitcher({ mode, onChange }: LabModeSwitcherProps) {
  return (
    <div className="flex gap-0.5 rounded-[3px] border border-[#94a3b8]/[0.14] bg-[#141b26] p-[3px]">
      {MODES.map((m) => {
        const Icon = m.icon;
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-[2px] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
              active
                ? "bg-[#1a222e] text-[#4ade80]"
                : "text-[#64748b] hover:text-[#a8b3c4]",
            )}
            style={
              active
                ? { boxShadow: "inset 0 0 0 1px rgba(74,222,128,0.3)" }
                : undefined
            }
            title={m.hint}
          >
            <Icon className="h-3 w-3" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
