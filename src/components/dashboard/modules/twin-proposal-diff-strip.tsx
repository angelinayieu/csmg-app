"use client";

// Renders the proposed-vs-actual chip strip for the workflow display header.
// Reads from a precomputed TwinProposalDiff (via computeTwinProposalDiff).
//
// Returns null when no proposal snapshot exists (`fidelity === "no_proposal"`)
// so the parent can fall back to its legacy pill rendering. This keeps the
// component dependency-free in the no-snapshot case — older spaces that
// approved a strategy before twin_proposals.proposed_spec landed continue
// to work without UI regressions.

import { Sparkles, Hammer, AlertTriangle, Plus, Minus } from "lucide-react";
import type {
  TwinProposalChip,
  TwinProposalChipKind,
  TwinProposalDiff,
} from "@/types/twin";

interface ChipStyle {
  bg: string;
  fg: string;
  Icon?: typeof Sparkles;
}

const CHIP_STYLES: Record<TwinProposalChipKind, ChipStyle> = {
  as_proposed: {
    bg: "bg-emerald-600",
    fg: "text-white",
    Icon: Sparkles,
  },
  amplified: {
    bg: "bg-blue-600",
    fg: "text-white",
    Icon: Plus,
  },
  baseline: {
    bg: "bg-gray-100",
    fg: "text-gray-500",
  },
  missing: {
    bg: "bg-amber-500",
    fg: "text-white",
    Icon: AlertTriangle,
  },
  extra: {
    bg: "bg-purple-600",
    fg: "text-white",
    Icon: Hammer,
  },
};

const FIDELITY_LABEL: Record<
  Exclude<TwinProposalDiff["fidelity"], "no_proposal">,
  { text: string; tone: string }
> = {
  high: { text: "as approved", tone: "text-emerald-700" },
  medium: { text: "partially built", tone: "text-amber-700" },
  low: { text: "drift", tone: "text-red-700" },
};

interface Props {
  diff: TwinProposalDiff;
}

export function TwinProposalDiffStrip({ diff }: Props) {
  if (diff.fidelity === "no_proposal" || diff.chips.length === 0) {
    return null;
  }

  const fidelityChip = FIDELITY_LABEL[diff.fidelity];

  return (
    <div className="flex items-center gap-1.5">
      {/* Fidelity badge — leads the strip so the user reads health first. */}
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1 ring-inset ring-gray-200 ${fidelityChip.tone}`}
        title={`Materialization fidelity: ${diff.fidelity}. ${diff.counts.materialized_new + diff.counts.materialized_strengthened} of ${diff.counts.promised_new + diff.counts.promised_strengthened} promised commitments delivered.`}
      >
        {fidelityChip.text}
      </span>

      {diff.chips.map((chip) => (
        <DiffChip key={chip.kind} chip={chip} />
      ))}

      {/* Health-score delta — only shown when meaningfully non-zero. */}
      {Math.abs(diff.health_delta) >= 1 && (
        <span
          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
            diff.health_delta > 0
              ? "bg-emerald-100 text-emerald-700"
              : "bg-red-100 text-red-700"
          }`}
          title={`Twin health score has ${diff.health_delta > 0 ? "improved" : "declined"} by ${Math.abs(Math.round(diff.health_delta))} points since the proposal was approved.`}
        >
          {diff.health_delta > 0 ? (
            <Plus className="h-2 w-2" />
          ) : (
            <Minus className="h-2 w-2" />
          )}
          {Math.abs(Math.round(diff.health_delta))} health
        </span>
      )}
    </div>
  );
}

function DiffChip({ chip }: { chip: TwinProposalChip }) {
  const style = CHIP_STYLES[chip.kind];
  const Icon = style.Icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${style.bg} ${style.fg} px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide`}
      title={chip.tooltip}
    >
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {chip.count} {chip.label}
    </span>
  );
}
