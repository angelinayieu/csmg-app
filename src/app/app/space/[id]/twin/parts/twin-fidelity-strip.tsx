"use client";

// ── Fidelity strip ──────────────────────────────────────────────────
//
// Glass-card wrapper around the existing TwinProposalDiffStrip. Shows
// how faithfully the materialized twin tracks the approved proposal
// (as-proposed / amplified / baseline / missing / extra chips).
//
// Renders a polite empty state when there's no proposal snapshot yet
// so the Outcomes tab never displays a dangling header with nothing
// beneath it.

import { TwinProposalDiffStrip } from "@/components/dashboard/modules/twin-proposal-diff-strip";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

interface Props {
  proposalDiff: TwinPageBundle["proposal_diff"];
  latestProposal: TwinPageBundle["latest_proposal"];
}

export function TwinFidelityStrip({ proposalDiff, latestProposal }: Props) {
  const hasUsableDiff =
    proposalDiff && proposalDiff.fidelity !== "no_proposal";

  return (
    <article
      className="rounded-2xl px-7 py-5"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
          Proposal fidelity
        </div>
        {latestProposal && (
          <span className="text-[10.5px] text-gray-400">
            From {formatDate(latestProposal.created_at)}
          </span>
        )}
      </div>

      {hasUsableDiff ? (
        <div className="mt-4">
          <TwinProposalDiffStrip diff={proposalDiff!} />
        </div>
      ) : (
        <p className="mt-3 text-[13px] leading-relaxed text-gray-500">
          {latestProposal
            ? "This proposal predates the fidelity snapshot — approve a new strategy to start tracking drift."
            : "No twin proposal has been approved yet. Once you accept one, this strip will show how faithfully the materialized twin tracks it."}
        </p>
      )}
    </article>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
