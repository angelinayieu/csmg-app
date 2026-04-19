"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, HelpCircle, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Edge } from "@/types";

interface EdgeVerdictWidgetProps {
  spaceId: string;
  edge: Edge;
  /** Optional: called after verdict submits (for parent to refresh edges) */
  onVerdictRecorded?: (verdict: "accepted" | "rejected" | "uncertain") => void;
  /** Visual density — "compact" (inline with edge row) or "detailed" (own card) */
  density?: "compact" | "detailed";
}

/**
 * Edge calibration widget — the self-learning feedback loop.
 *
 * Only renders for edges proposed by the connection-prospector agent
 * (identified via provenance.agent === "connection-prospector"). When the
 * user taps accept/reject/uncertain, we write to the corresponding
 * pairwise_connection_checks row's user_verdict column.
 *
 * Over time, aggregated verdicts per dimension become the `acceptance_rate`
 * surfaced in the CoverageLandscapePanel calibration section — enabling the
 * system to reason about its own reliability.
 */
export function EdgeVerdictWidget({
  spaceId,
  edge,
  onVerdictRecorded,
  density = "compact",
}: EdgeVerdictWidgetProps) {
  // Only show widget if edge was proposed by the prospector
  const prov = edge.provenance as Record<string, unknown> | null;
  const agent = prov && typeof prov.agent === "string" ? (prov.agent as string) : null;
  const isProspectorEdge = agent === "connection-prospector";

  const [submitting, setSubmitting] = useState(false);
  const [submittedVerdict, setSubmittedVerdict] = useState<
    "accepted" | "rejected" | "uncertain" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  if (!isProspectorEdge) return null;

  async function submit(verdict: "accepted" | "rejected" | "uncertain") {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/edges/${edge.id}/verdict`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verdict }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSubmittedVerdict(verdict);
      onVerdictRecorded?.(verdict);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Already submitted — show confirmation state
  if (submittedVerdict) {
    const meta =
      submittedVerdict === "accepted"
        ? { label: "Kept", color: "text-emerald-700 bg-emerald-100", Icon: CheckCircle2 }
        : submittedVerdict === "rejected"
          ? { label: "Removed", color: "text-rose-700 bg-rose-100", Icon: XCircle }
          : { label: "Noted", color: "text-amber-700 bg-amber-100", Icon: HelpCircle };
    const Icon = meta.Icon;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
          meta.color,
        )}
      >
        <Icon className="h-2.5 w-2.5" />
        {meta.label}
      </span>
    );
  }

  if (density === "compact") {
    return (
      <div className="inline-flex items-center gap-0.5">
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-semibold text-purple-700"
          title="Proposed by the connection prospector — your verdict calibrates future proposals"
        >
          <Sparkles className="h-2.5 w-2.5" />
          Proposed
        </span>
        <button
          onClick={() => submit("accepted")}
          disabled={submitting}
          className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
          title="Keep this edge (user-validated)"
        >
          <CheckCircle2 className="h-3 w-3" />
        </button>
        <button
          onClick={() => submit("rejected")}
          disabled={submitting}
          className="rounded p-0.5 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
          title="Reject — remove this edge from the graph"
        >
          <XCircle className="h-3 w-3" />
        </button>
        <button
          onClick={() => submit("uncertain")}
          disabled={submitting}
          className="rounded p-0.5 text-amber-600 hover:bg-amber-50 disabled:opacity-40"
          title="Uncertain — flag for later review"
        >
          <HelpCircle className="h-3 w-3" />
        </button>
        {submitting && (
          <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
        )}
        {error && (
          <span className="text-[9px] text-rose-600" title={error}>
            Err
          </span>
        )}
      </div>
    );
  }

  // density === "detailed"
  return (
    <div className="rounded-md border border-purple-200 bg-purple-50/40 p-2 text-[11px]">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-purple-600" />
        <span className="font-semibold text-purple-700">
          Prospector-proposed edge
        </span>
      </div>
      <p className="mb-2 text-[10px] text-gray-600">
        Your verdict helps the system calibrate future proposals.
      </p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => submit("accepted")}
          disabled={submitting}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
        >
          <CheckCircle2 className="h-3 w-3" />
          Keep
        </button>
        <button
          onClick={() => submit("rejected")}
          disabled={submitting}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
        >
          <XCircle className="h-3 w-3" />
          Reject
        </button>
        <button
          onClick={() => submit("uncertain")}
          disabled={submitting}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-40"
        >
          <HelpCircle className="h-3 w-3" />
          Unsure
        </button>
      </div>
      {submitting && (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-gray-500">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Recording…
        </div>
      )}
      {error && (
        <div className="mt-1 text-[9px] text-rose-600">{error}</div>
      )}
    </div>
  );
}
