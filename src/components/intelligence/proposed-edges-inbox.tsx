"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle, HelpCircle, Loader2, Sparkles, ArrowRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { edgeDimensionStyles, getNodeColor } from "@/lib/design-tokens";
import type { ProposedEdgeQueueItem } from "@/app/api/spaces/[id]/intelligence-overview/route";

interface ProposedEdgesInboxProps {
  spaceId: string;
  queue: ProposedEdgeQueueItem[];
  /** Called after a verdict is recorded so the parent can refetch overview */
  onVerdictRecorded?: () => void;
}

/**
 * Proposed Edges Inbox — a cross-space review surface for the calibration loop.
 *
 * Every prospector-proposed edge the user hasn't decided on yet lands here.
 * Each row shows: source → target, dimension, reasoning, and three one-click
 * verdict buttons (accept / reject / uncertain). Verdicts are written to
 * pairwise_connection_checks.user_verdict and drive the dimension-level
 * acceptance rate shown elsewhere.
 *
 * This is the surface that makes the self-learning loop real — users don't
 * have to hunt for prospector edges on individual nodes, they see the
 * entire pending review pile in one place.
 */
export function ProposedEdgesInbox({
  spaceId,
  queue,
  onVerdictRecorded,
}: ProposedEdgesInboxProps) {
  const [filter, setFilter] = useState<string | null>(null);
  const [locallyReviewed, setLocallyReviewed] = useState<Set<string>>(new Set());
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  // Visible queue = not-yet-locally-reviewed, filtered by dimension if set
  const visible = useMemo(() => {
    return queue.filter((item) => {
      if (locallyReviewed.has(item.edge.id)) return false;
      if (filter && item.edge.dimension !== filter) return false;
      return true;
    });
  }, [queue, filter, locallyReviewed]);

  // Build filter chips from dimensions present in queue
  const filterDimensions = useMemo(() => {
    const seen = new Set<string>();
    for (const item of queue) {
      if (item.edge.dimension) seen.add(item.edge.dimension);
    }
    return Array.from(seen);
  }, [queue]);

  const submitVerdict = useCallback(
    async (edgeId: string, verdict: "accepted" | "rejected" | "uncertain") => {
      if (submittingId) return;
      setSubmittingId(edgeId);
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/edges/${edgeId}/verdict`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ verdict }),
          },
        );
        if (res.ok) {
          setLocallyReviewed((prev) => {
            const next = new Set(prev);
            next.add(edgeId);
            return next;
          });
          onVerdictRecorded?.();
        }
      } finally {
        setSubmittingId(null);
      }
    },
    [spaceId, submittingId, onVerdictRecorded],
  );

  if (queue.length === 0) {
    return (
      <EmptyInbox />
    );
  }

  const hiddenByFilter = queue.length - visible.length - locallyReviewed.size;

  return (
    <div className="space-y-3">
      {/* ── Header + filter chips ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilter(null)}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors",
            filter === null
              ? "bg-interaxis-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200",
          )}
        >
          All ({queue.length - locallyReviewed.size})
        </button>
        {filterDimensions.map((dim) => {
          const style = edgeDimensionStyles[dim] ?? { color: "#6B7280" };
          const count = queue.filter((q) => q.edge.dimension === dim && !locallyReviewed.has(q.edge.id)).length;
          return (
            <button
              key={dim}
              onClick={() => setFilter(dim)}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-all",
                filter === dim
                  ? "ring-2 ring-offset-1"
                  : "hover:opacity-80",
              )}
              style={{
                background: filter === dim ? `${style.color}20` : `${style.color}10`,
                color: style.color,
                ...(filter === dim ? { boxShadow: `0 0 0 2px ${style.color}40` } : {}),
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: style.color }}
              />
              {dim}
              <span className="opacity-60">({count})</span>
            </button>
          );
        })}
        {filter && hiddenByFilter > 0 && (
          <span className="ml-auto text-[10px] text-gray-400">
            {hiddenByFilter} hidden by filter
          </span>
        )}
      </div>

      {/* ── Review queue ── */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-[11px] text-gray-500">
          {filter ? `No ${filter} proposals to review.` : "All caught up — no proposals waiting."}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => (
            <ProposedEdgeRow
              key={item.edge.id}
              item={item}
              spaceId={spaceId}
              submitting={submittingId === item.edge.id}
              onVerdict={(v) => submitVerdict(item.edge.id, v)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProposedEdgeRow({
  item,
  spaceId,
  submitting,
  onVerdict,
}: {
  item: ProposedEdgeQueueItem;
  spaceId: string;
  submitting: boolean;
  onVerdict: (verdict: "accepted" | "rejected" | "uncertain") => void;
}) {
  const style = edgeDimensionStyles[item.edge.dimension] ?? { color: "#6B7280" };
  const srcColors = getNodeColor(item.source_entity.entity_category);
  const tgtColors = getNodeColor(item.target_entity.entity_category);

  const confidence = Math.round((item.edge.confidence ?? 0) * 100);

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 transition-all hover:border-purple-200 hover:shadow-sm">
      {/* Top row: source → target */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={`/app/space/${spaceId}/entity/${item.source_entity.id}`}
          className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold hover:shadow-sm transition-all"
          style={{
            borderColor: srcColors.stroke,
            background: `${srcColors.fill}20`,
            color: srcColors.stroke,
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: srcColors.stroke }} />
          {item.source_entity.name}
        </Link>

        <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: style.color }}>
          <span
            className="h-0.5 w-3 rounded"
            style={{ background: style.color }}
          />
          <span>{item.edge.relationship_type ?? item.edge.dimension}</span>
          <ArrowRight className="h-3 w-3" />
        </div>

        <Link
          href={`/app/space/${spaceId}/entity/${item.target_entity.id}`}
          className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold hover:shadow-sm transition-all"
          style={{
            borderColor: tgtColors.stroke,
            background: `${tgtColors.fill}20`,
            color: tgtColors.stroke,
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tgtColors.stroke }} />
          {item.target_entity.name}
        </Link>

        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-purple-700">
          <Sparkles className="h-2.5 w-2.5" />
          Proposed
        </span>

        <span
          className={cn(
            "ml-auto rounded px-1.5 py-0.5 text-[9px] font-mono font-bold",
            confidence >= 70 ? "bg-emerald-100 text-emerald-700"
              : confidence >= 40 ? "bg-amber-100 text-amber-700"
                : "bg-rose-100 text-rose-700",
          )}
          title={`Prospector confidence: ${confidence}%`}
        >
          {confidence}%
        </span>
      </div>

      {/* Reasoning */}
      {item.reasoning && (
        <p className="mt-2 text-[11px] leading-snug text-gray-600">
          <span className="font-semibold text-gray-700">Reasoning:</span>{" "}
          {item.reasoning}
        </p>
      )}

      {/* Dimensions examined */}
      {item.dimensions_examined.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.dimensions_examined.map((d) => {
            const ds = edgeDimensionStyles[d];
            return (
              <span
                key={d}
                className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold"
                style={{
                  color: ds?.color ?? "#6B7280",
                  borderColor: `${ds?.color ?? "#6B7280"}40`,
                  background: `${ds?.color ?? "#6B7280"}08`,
                }}
              >
                {d}
              </span>
            );
          })}
        </div>
      )}

      {/* Action bar */}
      <div className="mt-3 flex items-center gap-1.5">
        <button
          onClick={() => onVerdict("accepted")}
          disabled={submitting}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
        >
          <CheckCircle2 className="h-3 w-3" />
          Keep
        </button>
        <button
          onClick={() => onVerdict("rejected")}
          disabled={submitting}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
        >
          <XCircle className="h-3 w-3" />
          Reject
        </button>
        <button
          onClick={() => onVerdict("uncertain")}
          disabled={submitting}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-40"
        >
          <HelpCircle className="h-3 w-3" />
          Unsure
        </button>
        {submitting && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-[9px] text-gray-400">
        <span>Proposed {timeAgo(item.proposed_at)}</span>
      </div>
    </li>
  );
}

function EmptyInbox() {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
      <Inbox className="mx-auto mb-2 h-6 w-6 text-gray-300" />
      <p className="text-[12px] font-semibold text-gray-600">All caught up</p>
      <p className="mt-0.5 text-[11px] text-gray-500">
        No prospector proposals waiting for your review. The system will surface new ones here as they&rsquo;re discovered.
      </p>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
