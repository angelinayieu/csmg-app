"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  X,
  Sparkles,
  ChevronRight,
  ArrowRight,
  RefreshCw,
  Inbox,
} from "lucide-react";
import { Ring } from "@/components/ui/ring";
import { cn } from "@/lib/utils";
import type { ConceptProposal, ProposalGroup } from "@/types";

/**
 * Hydrated proposal shape returned by GET /api/canvases/[id]/proposals.
 * Extends the raw ConceptProposal with names resolved server-side.
 */
export type HydratedProposal = ConceptProposal & {
  entity_name: string | null;
  entity_space_name: string | null;
  target_canvas_title: string | null;
};

export type HydratedSpan = Omit<
  ProposalGroup["spans"][number],
  "proposals"
> & {
  proposals: HydratedProposal[];
};

export type HydratedGroup = Omit<ProposalGroup, "spans"> & {
  spans: HydratedSpan[];
};

export interface ProposalRailProps {
  canvasId: string;
  /** Initial hydrated groups from SSR — the rail mounts with them and
   *  then polls/refetches on window focus. */
  initialGroups?: HydratedGroup[];
  /** Optional — called when the user hovers a span card. Sprint 4 hooks
   *  this into tldraw to highlight the anchored range in the note. */
  onSpanHover?: (args: {
    note_id: string;
    start_offset: number | null;
    end_offset: number | null;
  } | null) => void;
  className?: string;
}

export function ProposalRail({
  canvasId,
  initialGroups = [],
  onSpanHover,
  className,
}: ProposalRailProps) {
  const [groups, setGroups] = useState<HydratedGroup[]>(initialGroups);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState<number>(0);
  const [resolving, setResolving] = useState<Set<string>>(new Set());

  // Flatten for keyboard nav
  const flatProposals = useMemo(() => {
    const flat: Array<{
      proposal: HydratedProposal;
      group: HydratedGroup;
      span: HydratedSpan;
    }> = [];
    for (const g of groups) {
      for (const s of g.spans) {
        for (const p of s.proposals) {
          if (p.status === "pending") flat.push({ proposal: p, group: g, span: s });
        }
      }
    }
    return flat;
  }, [groups]);

  const pendingCount = flatProposals.length;

  // ── fetch / refresh ──
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/canvases/${canvasId}/proposals`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { groups: HydratedGroup[] };
      setGroups(data.groups);
      setFocusIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, [canvasId]);

  // Refresh on focus — the canvas editor can separately call `refresh()`
  // after a detect run.
  useEffect(() => {
    function onFocus() {
      refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Clamp focusIdx when list shrinks
  useEffect(() => {
    if (focusIdx >= flatProposals.length && flatProposals.length > 0) {
      setFocusIdx(flatProposals.length - 1);
    }
  }, [flatProposals.length, focusIdx]);

  // ── resolve actions ──
  const resolve = useCallback(
    async (proposalId: string, action: "accept" | "reject" | "dismiss") => {
      setResolving((prev) => new Set(prev).add(proposalId));
      setError(null);
      // Optimistic: mark it non-pending locally
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          spans: g.spans
            .map((s) => ({
              ...s,
              proposals: s.proposals.map((p) =>
                p.id === proposalId
                  ? {
                      ...p,
                      status:
                        action === "accept"
                          ? ("accepted" as const)
                          : action === "reject"
                          ? ("rejected" as const)
                          : ("dismissed" as const),
                    }
                  : p,
              ),
            }))
            // Drop empty spans
            .filter((s) =>
              s.proposals.some((p) => p.status === "pending"),
            ),
        }))
          // Drop empty groups
          .filter((g) => g.spans.length > 0),
      );

      try {
        const res = await fetch(`/api/proposals/${proposalId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Resolution failed");
        // Re-fetch truth on failure
        await refresh();
      } finally {
        setResolving((prev) => {
          const next = new Set(prev);
          next.delete(proposalId);
          return next;
        });
      }
    },
    [refresh],
  );

  // ── keyboard navigation ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Only handle when focus is inside the rail (we listen on document
      // but check document.activeElement's container)
      const active = document.activeElement as HTMLElement | null;
      if (!active?.closest("[data-proposal-rail]")) return;
      if (flatProposals.length === 0) return;

      if (e.key === "Tab") {
        e.preventDefault();
        setFocusIdx((i) =>
          e.shiftKey
            ? (i - 1 + flatProposals.length) % flatProposals.length
            : (i + 1) % flatProposals.length,
        );
        return;
      }
      const current = flatProposals[focusIdx];
      if (!current) return;
      if (e.key === "Enter") {
        e.preventDefault();
        resolve(current.proposal.id, "accept");
      } else if (e.key === "Escape") {
        e.preventDefault();
        resolve(current.proposal.id, "reject");
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        resolve(current.proposal.id, "dismiss");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [flatProposals, focusIdx, resolve]);

  // ── render ──
  return (
    <aside
      data-proposal-rail
      tabIndex={-1}
      className={cn(
        "flex h-full w-[340px] flex-col border-l border-gray-200 bg-white/80 backdrop-blur-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-interaxis-600" />
          <h3 className="text-[12px] font-semibold uppercase tracking-widest text-gray-700">
            Proposals
          </h3>
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {pendingCount}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Refresh"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", loading && "animate-spin")}
          />
        </button>
      </div>

      {/* Body */}
      {error && (
        <div className="m-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState loading={loading} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {groups.map((group) => (
            <GroupSection
              key={group.note_id}
              group={group}
              onHover={onSpanHover}
              resolvingIds={resolving}
              focusProposalId={flatProposals[focusIdx]?.proposal.id}
              onResolve={resolve}
            />
          ))}
        </div>
      )}

      {/* Footer — keyboard legend */}
      <div className="border-t border-gray-200 px-4 py-2 text-[10px] uppercase tracking-wider text-gray-400">
        <span className="mr-3">
          <kbd className="kbd">Tab</kbd> cycle
        </span>
        <span className="mr-3">
          <kbd className="kbd">⏎</kbd> accept
        </span>
        <span className="mr-3">
          <kbd className="kbd">Esc</kbd> reject
        </span>
        <span>
          <kbd className="kbd">D</kbd> dismiss
        </span>
      </div>

      <style jsx>{`
        .kbd {
          display: inline-block;
          padding: 1px 5px;
          background: rgba(0, 0, 0, 0.04);
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 4px;
          font-family: -apple-system, "SF Mono", ui-monospace, monospace;
          font-size: 9px;
          color: #3f3f46;
          text-transform: none;
        }
      `}</style>
    </aside>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
        <Inbox className="h-5 w-5 text-gray-400" />
      </div>
      <p className="mt-3 text-sm font-medium text-gray-700">
        {loading ? "Loading…" : "No pending proposals"}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        As you type in a sticky note, concepts the system recognizes will
        show up here for you to accept or reject.
      </p>
    </div>
  );
}

function GroupSection({
  group,
  onHover,
  resolvingIds,
  focusProposalId,
  onResolve,
}: {
  group: HydratedGroup;
  onHover?: ProposalRailProps["onSpanHover"];
  resolvingIds: Set<string>;
  focusProposalId?: string;
  onResolve: (
    id: string,
    action: "accept" | "reject" | "dismiss",
  ) => void;
}) {
  // Only render groups with actual pending spans
  const visibleSpans = group.spans.filter((s) =>
    s.proposals.some((p) => p.status === "pending"),
  );
  if (visibleSpans.length === 0) return null;

  return (
    <div className="border-b border-gray-100 px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
        <ChevronRight className="h-3 w-3" />
        Note {group.note_id.replace(/^shape:/, "").slice(0, 10)}
      </div>
      <div className="space-y-3">
        {visibleSpans.map((span) => (
          <SpanBlock
            key={`${span.start_offset ?? "n"}:${span.end_offset ?? "n"}`}
            span={span}
            noteId={group.note_id}
            onHover={onHover}
            resolvingIds={resolvingIds}
            focusProposalId={focusProposalId}
            onResolve={onResolve}
          />
        ))}
      </div>
    </div>
  );
}

function SpanBlock({
  span,
  noteId,
  onHover,
  resolvingIds,
  focusProposalId,
  onResolve,
}: {
  span: HydratedSpan;
  noteId: string;
  onHover?: ProposalRailProps["onSpanHover"];
  resolvingIds: Set<string>;
  focusProposalId?: string;
  onResolve: (
    id: string,
    action: "accept" | "reject" | "dismiss",
  ) => void;
}) {
  const pending = span.proposals.filter((p) => p.status === "pending");
  if (pending.length === 0) return null;

  return (
    <div
      onMouseEnter={() =>
        onHover?.({
          note_id: noteId,
          start_offset: span.start_offset,
          end_offset: span.end_offset,
        })
      }
      onMouseLeave={() => onHover?.(null)}
      className="rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm"
    >
      {span.anchored_text && (
        <div className="mb-2 rounded border-l-2 border-interaxis-400 bg-gray-50 px-2 py-1.5 text-[12px] italic text-gray-700">
          “{span.anchored_text}”
        </div>
      )}
      <div className="space-y-1.5">
        {pending.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            isFocused={p.id === focusProposalId}
            isResolving={resolvingIds.has(p.id)}
            onResolve={onResolve}
          />
        ))}
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  isFocused,
  isResolving,
  onResolve,
}: {
  proposal: HydratedProposal;
  isFocused: boolean;
  isResolving: boolean;
  onResolve: (
    id: string,
    action: "accept" | "reject" | "dismiss",
  ) => void;
}) {
  const name =
    proposal.entity_name ??
    proposal.proposed_entity_name ??
    "Unknown concept";

  return (
    <div
      className={cn(
        "group/proposal relative flex items-start gap-2 rounded-md border px-2 py-1.5 transition-all",
        isFocused
          ? "border-interaxis-400 bg-interaxis-50/60 shadow-sm"
          : "border-transparent hover:border-gray-200 hover:bg-gray-50",
        isResolving && "opacity-50",
      )}
    >
      <Ring value={proposal.confidence} size={28} showValue={false} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[13px] font-semibold text-gray-900">
            {name}
          </span>
          {proposal.entity_space_name && (
            <span className="truncate text-[10px] text-gray-500">
              in {proposal.entity_space_name}
            </span>
          )}
        </div>
        {proposal.rationale && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-600">
            {proposal.rationale}
          </p>
        )}
        {proposal.target_canvas_title && (
          <div className="mt-1 inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
            <ArrowRight className="h-2.5 w-2.5" />
            links to {proposal.target_canvas_title}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <button
          onClick={() => onResolve(proposal.id, "accept")}
          disabled={isResolving}
          className="flex h-6 w-6 items-center justify-center rounded text-green-600 hover:bg-green-50"
          aria-label="Accept"
          title="Accept (Enter)"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onResolve(proposal.id, "reject")}
          disabled={isResolving}
          className="flex h-6 w-6 items-center justify-center rounded text-red-500 hover:bg-red-50"
          aria-label="Reject"
          title="Reject (Esc)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
