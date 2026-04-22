"use client";

// ── Loop radial grid ───────────────────────────────────────────────────
//
// Grid of per-cycle radial cards. Includes a class filter (reinforcing+ /
// reinforcing- / balancing) because in practice users almost always want
// to look at one family at a time — growth loops or decline loops, not
// everything together.

import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import type { Cycle, Entity } from "@/types";
import { cn } from "@/lib/utils";
import { VizContainer } from "@/components/viz/viz-container";
import { DataStateLayer } from "@/components/viz/data-state";
import { LoopRadial } from "./loop-radial";

interface Props {
  cycles: Cycle[];
  entities: Entity[];
}

type ClassFilter = "all" | Cycle["classification"];

const FILTER_OPTS: Array<{ key: ClassFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "reinforcing_positive", label: "Growth" },
  { key: "reinforcing_negative", label: "Decline" },
  { key: "balancing", label: "Balancing" },
];

export function LoopRadialGrid({ cycles, entities }: Props) {
  const [filter, setFilter] = useState<ClassFilter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return cycles;
    return cycles.filter((c) => c.classification === filter);
  }, [cycles, filter]);

  const counts = useMemo(() => {
    const c = { all: cycles.length, reinforcing_positive: 0, reinforcing_negative: 0, balancing: 0 };
    for (const x of cycles) c[x.classification]++;
    return c;
  }, [cycles]);

  return (
    <VizContainer
      icon={Activity}
      title="Feedback loops"
      subtitle={
        cycles.length === 0
          ? "Synthesis will detect cycles once it runs."
          : `${cycles.length} cycle${cycles.length === 1 ? "" : "s"} detected — each ring is one closed feedback path.`
      }
      rightSlot={
        cycles.length > 0 ? (
          <div className="flex items-center gap-1 rounded-full bg-white/60 ring-1 ring-black/5 p-[2px]">
            {FILTER_OPTS.map((opt) => {
              const n = counts[opt.key as keyof typeof counts] ?? 0;
              const active = filter === opt.key;
              const disabled = opt.key !== "all" && n === 0;
              return (
                <button
                  key={opt.key}
                  onClick={() => !disabled && setFilter(opt.key)}
                  disabled={disabled}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors",
                    active
                      ? "bg-white text-gray-900 shadow-sm ring-1 ring-black/5"
                      : "text-gray-500 hover:text-gray-800",
                    disabled && "opacity-30 cursor-not-allowed",
                  )}
                >
                  {opt.label}
                  <span className="tabular-nums text-gray-400">{n}</span>
                </button>
              );
            })}
          </div>
        ) : null
      }
      minBodyHeight={300}
    >
      <DataStateLayer
        empty={cycles.length === 0}
        emptyHint="No feedback loops detected yet. Cycles surface during synthesis when the KG has reciprocal edges."
      >
        {filtered.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic px-2 py-4">
            No cycles in this category.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {filtered.map((c, i) => (
              <LoopRadial key={c.id} cycle={c} entities={entities} index={i} />
            ))}
          </div>
        )}
      </DataStateLayer>
    </VizContainer>
  );
}
