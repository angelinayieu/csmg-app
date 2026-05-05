"use client";

// ── TrajectoryGapChips ───────────────────────────────────────────────
//
// Renders the gaps the trajectory engine identified in the basis
// subgraph. Each chip shows what kind of gap it is (low confidence,
// missing timing, weak strength) and the source → target it lives on.
// Click → routes to the existing fill-flow for that gap kind:
//
//   low_confidence → research-rounds with this edge's S/T as the
//                    outcome scope (Phase 2 dispatch)
//   missing_timing → extract-temporal pass on this single edge
//   weak_strength  → effect-size extraction agent
//
// Phase 1 stubs the click handlers — the chip surface is what teaches
// the user "here's exactly what's widening your bands; here's what
// would tighten them." Phase 2 wires the dispatch.
//
// Visual: pill row, color-coded by kind; severity drives sort order
// upstream so the most-impactful gaps render first.

import type { TrajectoryGap, TrajectoryGapKind } from "./types";

interface Props {
  gaps: TrajectoryGap[];
  /** Optional click handler. When omitted, chips are display-only. */
  onFillGap?: (gap: TrajectoryGap) => void;
  /** Cap how many chips render before "+ N more". Default 8. */
  maxVisible?: number;
}

const KIND_PALETTE: Record<
  TrajectoryGapKind,
  { fg: string; bg: string; border: string; icon: string; description: string }
> = {
  low_confidence: {
    fg: "#FF453A",
    bg: "rgba(255,69,58,0.08)",
    border: "rgba(255,69,58,0.30)",
    icon: "?",
    description: "Edge confidence below 0.5 — literature is uncertain. Research would tighten p10/p90.",
  },
  missing_timing: {
    fg: "#FF9F0A",
    bg: "rgba(255,159,10,0.08)",
    border: "rgba(255,159,10,0.30)",
    icon: "⏱",
    description: "No onset/peak data — engine defaults to instant ramp. Extract-temporal pass would shape the curve.",
  },
  weak_strength: {
    fg: "#86868B",
    bg: "rgba(134,134,139,0.08)",
    border: "rgba(134,134,139,0.30)",
    icon: "·",
    description: "Edge strength missing or < 0.1 — pathway may be under-weighted. Effect-size extraction would re-weight.",
  },
};

const KIND_LABEL: Record<TrajectoryGapKind, string> = {
  low_confidence: "Low confidence",
  missing_timing: "Missing timing",
  weak_strength: "Weak strength",
};

export function TrajectoryGapChips({
  gaps,
  onFillGap,
  maxVisible = 8,
}: Props) {
  if (gaps.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200/50 bg-emerald-50/30 px-3 py-2 text-[11px] text-emerald-900">
        ✓ No structural gaps detected in this subgraph — every basis
        edge has confidence ≥ 0.5, an effect size, and temporal data.
      </div>
    );
  }

  const visible = gaps.slice(0, maxVisible);
  const overflow = gaps.length - visible.length;

  // Group by kind for the count summary in the header
  const counts = gaps.reduce<Partial<Record<TrajectoryGapKind, number>>>(
    (acc, g) => {
      acc[g.kind] = (acc[g.kind] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#6b7280)]">
          Gaps in subgraph
        </span>
        <span className="text-[10px] text-[color:var(--muted-fg,#86868b)]">
          {(["low_confidence", "missing_timing", "weak_strength"] as TrajectoryGapKind[])
            .filter((k) => (counts[k] ?? 0) > 0)
            .map((k) => `${counts[k]} ${KIND_LABEL[k].toLowerCase()}`)
            .join(" · ")}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((gap) => (
          <GapChip
            key={`${gap.edgeId}-${gap.kind}`}
            gap={gap}
            onClick={onFillGap}
          />
        ))}
        {overflow > 0 ? (
          <span className="inline-flex items-center rounded-full border border-black/10 bg-white/40 px-2 py-0.5 text-[11px] text-[color:var(--muted-fg,#86868b)]">
            +{overflow} more
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GapChip({
  gap,
  onClick,
}: {
  gap: TrajectoryGap;
  onClick?: (gap: TrajectoryGap) => void;
}) {
  const palette = KIND_PALETTE[gap.kind];
  const Tag = onClick ? "button" : "span";
  const remediation =
    gap.remediation === "research_rounds"
      ? "Dispatch research"
      : gap.remediation === "extract_temporal"
        ? "Extract timing"
        : "Extract effect size";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick ? () => onClick(gap) : undefined}
      title={[
        `${KIND_LABEL[gap.kind]}: ${gap.sourceName} → ${gap.targetName}`,
        gap.label,
        "",
        palette.description,
        "",
        `Click → ${remediation}`,
      ].join("\n")}
      className={`group inline-flex max-w-[280px] items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-opacity ${
        onClick ? "cursor-pointer hover:opacity-80" : "cursor-default"
      }`}
      style={{
        background: palette.bg,
        borderColor: palette.border,
        color: palette.fg,
      }}
    >
      <span
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
        style={{ background: palette.fg, color: "white" }}
        aria-hidden
      >
        {palette.icon}
      </span>
      <span className="truncate font-medium" style={{ color: "var(--fg, #1d1d1f)" }}>
        {gap.sourceName}
      </span>
      <span style={{ color: palette.fg }}>→</span>
      <span className="truncate font-medium" style={{ color: "var(--fg, #1d1d1f)" }}>
        {gap.targetName}
      </span>
      <span
        className="ml-1 shrink-0 rounded-full px-1.5 text-[9px] font-mono font-semibold tabular-nums"
        style={{ background: "rgba(255,255,255,0.65)", color: palette.fg }}
      >
        {gap.label}
      </span>
    </Tag>
  );
}
