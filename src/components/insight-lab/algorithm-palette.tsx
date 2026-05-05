"use client";

// ── Insight Lab · algorithm palette ───────────────────────────────────
//
// Left pane (280px). Categorized list of algorithms from the ALGO_CATALOG.
// Registered algos are clickable (add to stack); unregistered show as
// grayed "soon" tiles to advertise scope without lying about what works.

import { useMemo, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import {
  ALGO_CATALOG,
  CATEGORY_META,
  type AlgoCatalogEntry,
  type AlgoCategoryUI,
} from "./types";

export function AlgorithmPalette({
  usedAlgoIds,
  onAdd,
}: {
  usedAlgoIds: string[];
  onAdd: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const out: Record<AlgoCategoryUI, AlgoCatalogEntry[]> = {
      structural: [],
      semantic: [],
      hybrid: [],
    };
    for (const a of ALGO_CATALOG) out[a.category].push(a);
    return out;
  }, []);

  return (
    <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-slate-200/80 bg-white/40">
      <div className="border-b border-slate-200/60 px-4 py-3">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-slate-400">
          Algorithm palette
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Click to add to your stack →
        </div>
      </div>

      {(["structural", "semantic", "hybrid"] as const).map((cat) => (
        <Category
          key={cat}
          category={cat}
          algos={grouped[cat]}
          usedAlgoIds={usedAlgoIds}
          onAdd={onAdd}
        />
      ))}
    </aside>
  );
}

function Category({
  category,
  algos,
  usedAlgoIds,
  onAdd,
}: {
  category: AlgoCategoryUI;
  algos: AlgoCatalogEntry[];
  usedAlgoIds: string[];
  onAdd: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const meta = CATEGORY_META[category];
  const availableCount = algos.filter((a) => a.registered).length;

  return (
    <div className="border-b border-slate-200/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-slate-50/60"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`h-3 w-3 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.14em] ${meta.tone}`}
          >
            {meta.label}
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-slate-400">
          {availableCount}/{algos.length}
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          {algos.map((a) => (
            <Tile
              key={a.id}
              algo={a}
              used={usedAlgoIds.includes(a.id)}
              onAdd={onAdd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({
  algo,
  used,
  onAdd,
}: {
  algo: AlgoCatalogEntry;
  used: boolean;
  onAdd: (id: string) => void;
}) {
  const meta = CATEGORY_META[algo.category];
  const disabled = !algo.registered || used;

  return (
    <button
      onClick={() => !disabled && onAdd(algo.id)}
      disabled={disabled}
      className={`group mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-all ${
        disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:-translate-y-px hover:bg-white hover:shadow-sm"
      }`}
    >
      <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-slate-800">
            {algo.name}
          </span>
          {!algo.registered && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-slate-400">
              soon
            </span>
          )}
          {used && (
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-emerald-600">
              added
            </span>
          )}
        </div>
        <div className="mt-0.5 line-clamp-1 text-[10.5px] text-slate-500">
          {algo.description}
        </div>
        <div className="mt-1 text-[9.5px] tabular-nums text-slate-400">
          {algo.complexity}
        </div>
      </div>
      {!disabled && (
        <Plus className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400 opacity-0 group-hover:opacity-100" />
      )}
    </button>
  );
}
