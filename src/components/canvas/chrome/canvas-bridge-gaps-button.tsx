"use client";

// ── Canvas Bridge-Gaps Button + Review Panel — M6 ────────────────────
//
// Top-right floating chip that surfaces the count of pending mediator
// proposals (orphan-cluster bridges suggested by the M1-M5 engine).
// Click → opens a side-drawer review panel where the user approves
// or rejects each proposal.
//
// Self-contained component:
//   - Polls GET /api/spaces/[id]/mediator-proposals on mount + every
//     30s while mounted (cheap; the route returns an empty payload
//     when no proposals exist).
//   - Auto-hides when there are zero proposals (no badge no chip).
//   - Manages its own panel-open / loading / per-proposal-action
//     state. No external store wiring.
//
// Surface contract:
//   - Approve: POST /api/spaces/[id]/mediator-proposals/[id]/approve
//     → entity moves from queue to canonical graph, dashed edges
//     become solid. Proposal disappears from the panel.
//   - Reject: POST /api/spaces/[id]/mediator-proposals/[id]/reject
//     → entity + edges flagged rejected, hidden from default queries.
//     Proposal disappears from the panel.
//   - Run engine again: POST /api/spaces/[id]/mediator-proposals/run
//     → re-fires M1-M4 pipeline, refreshes the queue.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, X, Check, AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediatorProposalsResponse } from "@/app/api/spaces/[id]/mediator-proposals/route";

const POLL_INTERVAL_MS = 30_000;

type ProposalEntry = MediatorProposalsResponse["proposals"][number];

interface CanvasBridgeGapsButtonProps {
  spaceId: string;
}

export function CanvasBridgeGapsButton({ spaceId }: CanvasBridgeGapsButtonProps) {
  const [proposals, setProposals] = useState<ProposalEntry[]>([]);
  const [counts, setCounts] = useState<MediatorProposalsResponse["counts"]>({
    total: 0,
    validated: 0,
    speculative: 0,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch + refresh
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/mediator-proposals`,
      );
      if (!res.ok) {
        setErrorMsg(`Failed to load proposals (${res.status})`);
        return;
      }
      const data = (await res.json()) as MediatorProposalsResponse;
      setProposals(data.proposals);
      setCounts(data.counts);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(
        `Network error: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Approve / reject actions — optimistic remove on success
  const onApprove = useCallback(
    async (proposalId: string) => {
      setActioningId(proposalId);
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/mediator-proposals/${encodeURIComponent(proposalId)}/approve`,
          { method: "POST" },
        );
        if (!res.ok) {
          const detail = await safeJsonError(res);
          setErrorMsg(`Approve failed: ${detail}`);
          return;
        }
        // Optimistic: remove from local list immediately. Refresh after
        // for source-of-truth alignment.
        setProposals((prev) => prev.filter((p) => p.proposed_entity_id !== proposalId));
        void refresh();
      } catch (err) {
        setErrorMsg(
          `Approve error: ${err instanceof Error ? err.message : "unknown"}`,
        );
      } finally {
        setActioningId(null);
      }
    },
    [spaceId, refresh],
  );

  const onReject = useCallback(
    async (proposalId: string) => {
      setActioningId(proposalId);
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/mediator-proposals/${encodeURIComponent(proposalId)}/reject`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        if (!res.ok) {
          const detail = await safeJsonError(res);
          setErrorMsg(`Reject failed: ${detail}`);
          return;
        }
        setProposals((prev) => prev.filter((p) => p.proposed_entity_id !== proposalId));
        void refresh();
      } catch (err) {
        setErrorMsg(
          `Reject error: ${err instanceof Error ? err.message : "unknown"}`,
        );
      } finally {
        setActioningId(null);
      }
    },
    [spaceId, refresh],
  );

  const onRunEngine = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/mediator-proposals/run`,
        { method: "POST" },
      );
      if (!res.ok) {
        const detail = await safeJsonError(res);
        setErrorMsg(`Run engine failed: ${detail}`);
        return;
      }
      await refresh();
    } catch (err) {
      setErrorMsg(
        `Run engine error: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setRunning(false);
    }
  }, [spaceId, refresh]);

  // Don't render the chip during the initial fetch (avoids a flash).
  // Don't render at all when there are no proposals AND we're not
  // explicitly opening the panel (e.g., after a Run-engine click that
  // returned zero new proposals — the panel can still display the "no
  // proposals" empty state).
  const hasProposals = counts.total > 0;
  if (loading && !hasProposals) return null;
  if (!loading && !hasProposals && !panelOpen) return null;

  return (
    <>
      {/* Chip — top-right of canvas */}
      <button
        onClick={() => setPanelOpen(true)}
        className={cn(
          "fixed right-4 top-20 z-30 flex items-center gap-2 rounded-full border bg-white/95 px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur-md transition-all hover:scale-[1.02]",
          counts.speculative > 0 ? "border-amber-300" : "border-emerald-300",
        )}
        aria-label="Bridge gaps"
        title={`${counts.total} mediator proposal${counts.total === 1 ? "" : "s"} pending review`}
      >
        <Sparkles
          className={cn(
            "h-3.5 w-3.5",
            counts.speculative > 0 ? "text-amber-500" : "text-emerald-600",
          )}
        />
        <span className="text-gray-800">
          {counts.total} bridge {counts.total === 1 ? "proposal" : "proposals"}
        </span>
        {counts.speculative > 0 && (
          <span
            className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700"
            title={`${counts.speculative} flagged speculative`}
          >
            {counts.speculative}⚠
          </span>
        )}
      </button>

      {/* Review panel */}
      {panelOpen && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-[440px] flex-col border-l border-gray-200 bg-white shadow-2xl">
          {/* Header */}
          <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Bridge gap proposals</h2>
              <p className="text-[11px] text-gray-500">
                {counts.total} pending · {counts.validated} validated ·{" "}
                {counts.speculative} speculative
              </p>
            </div>
            <button
              onClick={() => setPanelOpen(false)}
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* Error banner */}
          {errorMsg && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
              {errorMsg}
            </div>
          )}

          {/* Proposals list */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {proposals.length === 0 ? (
              <EmptyState onRunEngine={onRunEngine} running={running} />
            ) : (
              <div className="flex flex-col gap-3">
                {proposals.map((p) => (
                  <ProposalCard
                    key={p.proposed_entity_id}
                    proposal={p}
                    actioning={actioningId === p.proposed_entity_id}
                    onApprove={() => onApprove(p.proposed_entity_id)}
                    onReject={() => onReject(p.proposed_entity_id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <footer className="border-t border-gray-200 px-3 py-2">
            <button
              onClick={onRunEngine}
              disabled={running}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              <RotateCw
                className={cn("h-3.5 w-3.5", running && "animate-spin")}
              />
              {running ? "Scanning graph…" : "Re-run bridge detection"}
            </button>
          </footer>
        </div>
      )}
    </>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function ProposalCard({
  proposal,
  actioning,
  onApprove,
  onReject,
}: {
  proposal: ProposalEntry;
  actioning: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const confidencePct = Math.round(proposal.confidence_final * 100);

  const memberSummary = useMemo(() => {
    const names = proposal.cluster_member_names;
    if (names.length <= 3) return names.join(" · ");
    return `${names.slice(0, 3).join(" · ")} +${names.length - 3} more`;
  }, [proposal.cluster_member_names]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-3 shadow-sm",
        proposal.speculative ? "border-amber-200" : "border-emerald-200",
      )}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-gray-900">
            {proposal.name}
          </h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono uppercase">
              {proposal.layer || "no layer"}
            </span>
            <span>•</span>
            <span
              className={cn(
                "font-semibold",
                confidencePct >= 70
                  ? "text-emerald-700"
                  : confidencePct >= 40
                    ? "text-amber-700"
                    : "text-red-700",
              )}
            >
              {confidencePct}% confidence
            </span>
            {proposal.speculative && (
              <>
                <span>•</span>
                <span className="flex items-center gap-0.5 font-semibold text-amber-700">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  speculative
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bridges */}
      <div className="mt-2 text-[11px] text-gray-700">
        <span className="font-semibold">Bridges:</span> {memberSummary}
      </div>

      {/* Mechanism explanation — short by default, expandable */}
      {proposal.mechanism_explanation && (
        <p
          className={cn(
            "mt-2 text-[11px] leading-snug text-gray-600",
            !expanded && "line-clamp-2",
          )}
        >
          {proposal.mechanism_explanation}
        </p>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2 text-[10.5px] text-gray-600">
          {proposal.verdict.supporting_evidence_summary && (
            <p>
              <span className="font-semibold text-gray-700">Validator:</span>{" "}
              {proposal.verdict.supporting_evidence_summary}
            </p>
          )}
          {proposal.verdict.counter_evidence_summary && (
            <p className="text-amber-800">
              <span className="font-semibold">Caveat:</span>{" "}
              {proposal.verdict.counter_evidence_summary}
            </p>
          )}
          {proposal.verdict.notes.length > 0 && (
            <ul className="list-disc pl-4">
              {proposal.verdict.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {proposal.proposed_edges.length > 0 && (
            <div>
              <p className="mt-1 font-semibold text-gray-700">
                {proposal.proposed_edges.length} new edge
                {proposal.proposed_edges.length === 1 ? "" : "s"}:
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {proposal.proposed_edges.map((e) => (
                  <li key={e.edge_id} className="font-mono text-[10px]">
                    {e.source_name} {e.polarity === "negative" ? "−→" : "+→"}{" "}
                    {e.target_name} <span className="text-gray-400">({e.relationship_label})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {proposal.citation_seeds.length > 0 && (
            <div>
              <p className="mt-1 font-semibold text-gray-700">Citation seeds:</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {proposal.citation_seeds.slice(0, 4).map((s, i) => (
                  <li key={i} className="italic">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onApprove}
          disabled={actioning}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Check className="h-3 w-3" />
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={actioning}
          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <X className="h-3 w-3" />
          Reject
        </button>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md px-2 py-1.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
        >
          {expanded ? "Less" : "Details"}
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  onRunEngine,
  running,
}: {
  onRunEngine: () => void;
  running: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Sparkles className="h-8 w-8 text-emerald-300" />
      <div>
        <p className="text-sm font-semibold text-gray-900">
          No bridge proposals
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          Either your graph is well-connected or the engine hasn&apos;t run
          yet for this space. Click below to scan for orphan clusters that
          might benefit from a bridging mediator entity.
        </p>
      </div>
      <button
        onClick={onRunEngine}
        disabled={running}
        className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        <RotateCw className={cn("h-3.5 w-3.5", running && "animate-spin")} />
        {running ? "Scanning…" : "Scan for bridge gaps"}
      </button>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

async function safeJsonError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data === "object" && "error" in data) {
      return String((data as { error: unknown }).error);
    }
    return `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
