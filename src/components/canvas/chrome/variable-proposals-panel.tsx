"use client";

// VariableProposalsPanel — review drawer for LLM-proposed variables.
//
// Opens when the user clicks the count chip on the +Variable button. Shows
// the proposals grouped by role (Independent / Dependent / Controlled /
// Confounding / causal roles / Unclassified) with metric definition and
// justification. Approve materializes an entities row in the KG via
// /api/spaces/[id]/variable-proposals/[proposalId]/approve; reject is
// audit-only via .../reject. Both refetch the underlying hook so the
// panel + +Variable badge update in place.
//
// Architectural note: this lives in canvas/chrome alongside the +Variable
// button so the chrome and the proposal review share the same hook
// (useVariableProposals) and stay in sync without a global store.

import { useState } from "react";
import { X, Sparkles, User, AlertTriangle, CheckCircle2, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import type {
  VariableProposal,
  VariableRole,
} from "@/types/variable-proposals";
import type { VariableProposalsResponse } from "@/lib/hooks/use-variable-proposals";

interface Props {
  open: boolean;
  onClose: () => void;
  data: VariableProposalsResponse | null;
  loading: boolean;
  error: string | null;
  /** Approve a proposal — materializes an entities row + flips status. */
  onApprove?: (proposalId: string) => Promise<void>;
  /** Reject a proposal — audit-only, does not delete. */
  onReject?: (proposalId: string, reason?: string) => Promise<void>;
}

/**
 * Display order for role groups in the panel. Experimental roles first
 * (the IV/DV/CV/Confounding scaffolding the user wants to see surfaced),
 * then causal roles, then unclassified at the bottom.
 */
const ROLE_DISPLAY_ORDER: VariableRole[] = [
  "independent",
  "dependent",
  "controlled",
  "confounding",
  "outcome",
  "mediator",
  "modifier",
  "instrument",
  "condition",
  "unclassified",
];

const ROLE_LABEL: Record<VariableRole, string> = {
  independent: "Independent (manipulated)",
  dependent: "Dependent (measured)",
  controlled: "Controlled (held constant)",
  confounding: "Confounding (uncontrolled)",
  outcome: "Outcome (causal endpoint)",
  mediator: "Mediator (causal intermediary)",
  modifier: "Modifier (interaction term)",
  instrument: "Instrument (measurement tool)",
  condition: "Condition (boundary)",
  unclassified: "Unclassified",
};

const ROLE_TINT: Record<VariableRole, string> = {
  independent: "bg-blue-50 text-blue-700 border-blue-200",
  dependent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  controlled: "bg-amber-50 text-amber-700 border-amber-200",
  confounding: "bg-red-50 text-red-700 border-red-200",
  outcome: "bg-indigo-50 text-indigo-700 border-indigo-200",
  mediator: "bg-purple-50 text-purple-700 border-purple-200",
  modifier: "bg-pink-50 text-pink-700 border-pink-200",
  instrument: "bg-cyan-50 text-cyan-700 border-cyan-200",
  condition: "bg-gray-100 text-gray-700 border-gray-200",
  unclassified: "bg-gray-50 text-gray-500 border-gray-200",
};

export function VariableProposalsPanel({
  open,
  onClose,
  data,
  loading,
  error,
  onApprove,
  onReject,
}: Props) {
  // Track which row is currently mid-action so its buttons show a spinner
  // and can't be double-fired. Per-row state because users may approve
  // multiple in sequence.
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleApprove = async (proposalId: string) => {
    if (!onApprove || busyId) return;
    setBusyId(proposalId);
    try {
      await onApprove(proposalId);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    if (!onReject || busyId) return;
    setBusyId(proposalId);
    try {
      await onReject(proposalId);
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  const proposals = data?.proposals ?? [];
  const grouped: Partial<Record<VariableRole, VariableProposal[]>> = {};
  for (const p of proposals) {
    if (p.user_status === "rejected" || p.user_status === "superseded") continue;
    (grouped[p.variable_role] ??= []).push(p);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        className="flex-1 bg-black/20"
        aria-label="Close panel"
      />

      {/* Drawer */}
      <aside
        className="flex w-full max-w-[480px] flex-col bg-white shadow-2xl"
        role="dialog"
        aria-label="Proposed variables"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Proposed variables
            </h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {data ? (
                <>
                  {data.counts.proposed} pending · {data.counts.approved} approved
                  {data.latest_strategy_version !== null
                    ? ` · strategy v${data.latest_strategy_version}`
                    : ""}
                </>
              ) : (
                "Loading…"
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <p className="py-8 text-center text-[12px] text-gray-400">
              Loading proposals…
            </p>
          )}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-[12px] font-medium text-red-700">
                Couldn&apos;t load proposals
              </p>
              <p className="mt-0.5 text-[11px] text-red-600">{error}</p>
            </div>
          )}
          {!loading && !error && proposals.length === 0 && (
            <div className="rounded-md border border-dashed border-gray-200 px-4 py-8 text-center">
              <Sparkles className="mx-auto h-5 w-5 text-gray-300" />
              <p className="mt-2 text-[12px] font-medium text-gray-700">
                No proposed variables yet
              </p>
              <p className="mt-1 text-[11px] text-gray-500">
                Variables proposed during strategy synthesis will appear here
                for review. You can also author one manually with the +Variable
                button.
              </p>
            </div>
          )}

          {!loading && !error && proposals.length > 0 && (
            <div className="space-y-5">
              {ROLE_DISPLAY_ORDER.map((role) => {
                const entries = grouped[role];
                if (!entries || entries.length === 0) return null;
                return (
                  <section key={role}>
                    <header className="mb-2 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${ROLE_TINT[role]}`}
                      >
                        {ROLE_LABEL[role]}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {entries.length}
                      </span>
                    </header>
                    <ul className="space-y-2">
                      {entries.map((p) => (
                        <ProposalRow
                          key={p.id}
                          proposal={p}
                          busy={busyId === p.id}
                          onApprove={
                            onApprove && p.user_status === "proposed"
                              ? () => handleApprove(p.id)
                              : undefined
                          }
                          onReject={
                            onReject && p.user_status === "proposed"
                              ? () => handleReject(p.id)
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-gray-200 px-5 py-3">
          <p className="text-[10px] text-gray-400">
            Approve to materialize a proposal as an entity row in the KG —
            its experimental role is preserved on this proposal record so
            you can trace the IV/DV/CV decision later. Reject is audit-only
            (the row stays for telemetry).
          </p>
        </footer>
      </aside>
    </div>
  );
}

function ProposalRow({
  proposal,
  busy,
  onApprove,
  onReject,
}: {
  proposal: VariableProposal;
  busy: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const m = proposal.metric_definition;
  const sourceLabel =
    proposal.proposed_by === "manual"
      ? "Manual"
      : proposal.source_field === "perspective.key_metric"
        ? "Perspective metric"
        : proposal.source_field === "micro_tactic.metric"
          ? "Tactic metric"
          : proposal.source_field === "learning_loop.leading_indicator"
            ? "Leading indicator"
            : proposal.source_field === "learning_loop.lagging_indicator"
              ? "Lagging indicator"
              // Sprint W5.5/W5.8b — per-app variable contract proposals
              // emitted by extract-variable-proposals walking
              // infrastructure_proposals[].app_variables[]. Surfaces
              // alongside strategy-level proposals in the same review
              // panel so the user has one place to approve everything.
              : proposal.source_field === "infrastructure_proposal.app_variable"
                ? "App variable"
                : "Unknown source";

  return (
    <li className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-gray-900">
            {proposal.proposed_name}
          </p>
          {proposal.proposed_description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">
              {proposal.proposed_description}
            </p>
          )}
        </div>
        <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
          {proposal.proposed_by === "manual" ? (
            <User className="h-2.5 w-2.5" />
          ) : (
            <Sparkles className="h-2.5 w-2.5" />
          )}
          {sourceLabel}
        </span>
      </div>

      {m && (m.current || m.target || m.unit || m.measurement_method) && (
        <div className="mt-2 rounded-md bg-gray-50 px-2 py-1.5">
          <div className="flex items-center gap-2 font-mono text-[10.5px] text-gray-700">
            {m.current && (
              <span className="font-semibold text-gray-900">{m.current}</span>
            )}
            {m.current && m.target && <span className="text-gray-400">→</span>}
            {m.target && (
              <span className="font-semibold text-gray-900">{m.target}</span>
            )}
            {m.unit && <span className="text-gray-500">{m.unit}</span>}
            {m.cadence && (
              <span className="ml-auto rounded-sm bg-white px-1 text-[9px] uppercase tracking-wide text-gray-500">
                {m.cadence}
              </span>
            )}
          </div>
          {m.measurement_method && (
            <p className="mt-1 text-[10px] italic text-gray-500">
              measured by: {m.measurement_method}
            </p>
          )}
        </div>
      )}

      {proposal.justification && (
        <p className="mt-2 text-[11px] leading-snug text-gray-600">
          {proposal.justification}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
        {proposal.user_status === "approved" && (
          <span className="inline-flex items-center gap-0.5 text-emerald-600">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Approved
          </span>
        )}
        {proposal.user_status === "proposed" && (
          <span className="inline-flex items-center gap-0.5 text-amber-600">
            <AlertTriangle className="h-2.5 w-2.5" />
            Pending review
          </span>
        )}
        {proposal.confidence !== null && (
          <span>conf {Math.round(proposal.confidence * 100)}%</span>
        )}

        {/* Action buttons — render only while pending and only when
            handlers are wired by the parent. */}
        {(onApprove || onReject) && proposal.user_status === "proposed" && (
          <div className="ml-auto flex items-center gap-1.5">
            {onReject && (
              <button
                type="button"
                disabled={busy}
                onClick={onReject}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                title="Reject this proposal — audit-only; the row stays for telemetry"
              >
                {busy ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <ThumbsDown className="h-2.5 w-2.5" />
                )}
                Reject
              </button>
            )}
            {onApprove && (
              <button
                type="button"
                disabled={busy}
                onClick={onApprove}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                title="Approve — creates an entity row in the KG with this variable's metadata"
              >
                {busy ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <ThumbsUp className="h-2.5 w-2.5" />
                )}
                Approve
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
