"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { findingTypeColors } from "@/lib/design-tokens";
import type { Finding } from "@/types/finding";
import type { ConvergenceDepth } from "@/types/interactions";

const DEPTH_CONFIG: Record<ConvergenceDepth, {
  color: string;
  bg: string;
  border: string;
  badge: string;
  label: string;
}> = {
  L4: { color: "#007AFF", bg: "rgba(0,122,255,0.06)", border: "rgba(0,122,255,0.25)", badge: "#007AFF", label: "L4 · INVARIANT" },
  L3: { color: "#F59E0B", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.25)", badge: "#F59E0B", label: "L3 · LOGIC" },
  L2: { color: "#8B5CF6", bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.25)", badge: "#8B5CF6", label: "L2 · METHOD" },
  L1: { color: "#6B7280", bg: "rgba(107,114,128,0.04)", border: "rgba(107,114,128,0.2)", badge: "#6B7280", label: "L1 · OUTCOME" },
};

interface FindingsTabProps {
  findings: Finding[];
  selectedFindingId: string | null;
  onSelectFinding: (finding: Finding) => void;
}

export function FindingsTab({
  findings,
  selectedFindingId,
  onSelectFinding,
}: FindingsTabProps) {
  const [activeFilter, setActiveFilter] = useState<ConvergenceDepth | "all">("all");
  const [sortBy, setSortBy] = useState<"impact" | "confidence" | "layer">("impact");

  // Count by depth
  const countByDepth = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of findings) {
      counts[f.layer] = (counts[f.layer] ?? 0) + 1;
    }
    return counts;
  }, [findings]);

  // Filter + sort
  const displayed = useMemo(() => {
    let list = activeFilter === "all"
      ? findings
      : findings.filter((f) => f.layer === activeFilter);

    if (sortBy === "confidence") {
      list = [...list].sort((a, b) => b.confidence - a.confidence);
    } else if (sortBy === "layer") {
      const order: Record<string, number> = { L4: 0, L3: 1, L2: 2, L1: 3 };
      list = [...list].sort((a, b) => (order[a.layer] ?? 4) - (order[b.layer] ?? 4));
    }
    // default: already sorted by impact (rank order)
    return list;
  }, [findings, activeFilter, sortBy]);

  const hero = displayed[0] ?? null;
  const rows = displayed.slice(1);

  if (findings.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <div className="text-center">
          <p className="text-sm font-medium text-gray-400">No findings detected yet.</p>
          <p className="mt-1 text-xs text-gray-400">Run a synthesis to discover convergence findings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center justify-between border-b border-gray-200 px-7 py-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
            {(["all", "L4", "L3", "L2", "L1"] as const).map((key) => {
              const isActive = activeFilter === key;
              const count = key === "all" ? findings.length : (countByDepth[key] ?? 0);
              if (key !== "all" && count === 0) return null;
              const dc = key !== "all" ? DEPTH_CONFIG[key] : null;
              return (
                <button
                  key={key}
                  onClick={() => setActiveFilter(key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold transition-all",
                    isActive
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700",
                  )}
                >
                  {dc && (
                    <span
                      className="h-[7px] w-[7px] rounded-full"
                      style={{ background: dc.color }}
                    />
                  )}
                  {key === "all" ? "All" : key}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-gray-400">
            <strong className="font-bold text-gray-900">{displayed.length}</strong> findings
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          Sort
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-900"
          >
            <option value="impact">Impact on master goal</option>
            <option value="confidence">Confidence</option>
            <option value="layer">Layer depth</option>
          </select>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto bg-gray-50/60 px-7 py-5">
        {/* Hero finding card */}
        {hero && <HeroFindingCard finding={hero} isSelected={selectedFindingId === hero.id} onSelect={() => onSelectFinding(hero)} />}

        {/* Row findings */}
        {rows.length > 0 && (
          <div className="mt-2 space-y-2">
            {rows.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                isSelected={selectedFindingId === f.id}
                onSelect={() => onSelectFinding(f)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Hero finding card ──

function HeroFindingCard({
  finding,
  isSelected,
  onSelect,
}: {
  finding: Finding;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const dc = DEPTH_CONFIG[finding.layer];
  const tc = findingTypeColors[finding.finding_type];

  return (
    <div
      onClick={onSelect}
      className={cn(
        "cursor-pointer overflow-hidden rounded-xl border bg-white shadow-sm transition-all",
        isSelected ? "border-blue-300 shadow-md ring-1 ring-blue-200" : "border-gray-200 hover:border-blue-200 hover:shadow-md",
      )}
    >
      {/* Rank strip */}
      <div className="flex items-center justify-between bg-blue-50 px-5 py-2.5 border-b border-blue-100">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
            ★ #{finding.rank}
          </span>
          <span className="text-[12px] font-semibold text-gray-700">
            Highest-impact &middot; {dc.label}
          </span>
        </div>
        {isSelected && (
          <span className="text-[11px] text-gray-400">Selected →</span>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        <div className="mb-2.5 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-bold text-white"
            style={{ background: dc.badge }}
          >
            ◆ {dc.label}
          </span>
          {finding.domains.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
              {finding.domains.join(" ↔ ")}
            </span>
          )}
        </div>

        <h3 className="text-lg font-bold leading-snug text-gray-900">
          {finding.title}
        </h3>

        {finding.summary && finding.summary !== finding.title && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500 line-clamp-2">
            {finding.summary}
          </p>
        )}

        <div className="mt-3 flex items-center gap-1 text-xs text-gray-400">
          {finding.detected_by && (
            <>
              <span>Detected by <span className="font-semibold text-blue-600">{finding.detected_by}</span></span>
              <span className="text-gray-300">&middot;</span>
            </>
          )}
          <span>{Math.round(finding.confidence * 100)}% confidence</span>
          <span className="text-gray-300">&middot;</span>
          <span className="font-semibold text-green-600">+{finding.impact_pct}% impact</span>
        </div>
      </div>
    </div>
  );
}

// ── Finding row ──

function FindingRow({
  finding,
  isSelected,
  onSelect,
}: {
  finding: Finding;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const dc = DEPTH_CONFIG[finding.layer];

  return (
    <div
      onClick={onSelect}
      className={cn(
        "grid cursor-pointer grid-cols-[32px_1fr_auto_auto_auto] items-center gap-3.5 rounded-xl border bg-white px-4 py-3 transition-all",
        isSelected
          ? "border-blue-300 shadow-sm ring-1 ring-blue-200"
          : "border-gray-200 hover:border-blue-200 hover:shadow-sm",
      )}
    >
      {/* Rank */}
      <div className="text-center text-xs font-bold text-gray-400">
        {String(finding.rank).padStart(2, "0")}
      </div>

      {/* Title + meta */}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-gray-900">
          {finding.title}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
          <span
            className="rounded px-1.5 py-px text-[9px] font-bold"
            style={{ background: dc.bg, color: dc.color, border: `1px solid ${dc.border}` }}
          >
            {finding.layer}
          </span>
          {finding.domains.length > 0 && (
            <span>{finding.domains.join(" ↔ ")}</span>
          )}
        </div>
      </div>

      {/* Impact */}
      <div
        className={cn(
          "rounded-md px-2.5 py-1 text-sm font-bold",
          finding.impact_pct > 1
            ? "bg-green-50 text-green-600"
            : "bg-gray-50 text-gray-400",
        )}
      >
        +{finding.impact_pct}%
      </div>

      {/* Confidence */}
      <div className="w-16 text-xs text-gray-400">
        {Math.round(finding.confidence * 100)}% conf
      </div>

      {/* Action */}
      <span
        className={cn(
          "rounded-md px-2.5 py-1 text-[11px] font-semibold",
          finding.action_label === "Skip"
            ? "bg-gray-50 text-gray-400"
            : "bg-blue-50 text-blue-600",
        )}
      >
        {finding.action_label}
      </span>
    </div>
  );
}
