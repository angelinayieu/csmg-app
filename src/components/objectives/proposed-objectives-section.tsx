"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  X,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Ring } from "@/components/ui/ring";
import type { ProposedGoalHydrated } from "@/types";

/**
 * Wave A — Proposed objectives section. Sits above the existing
 * suggested_objectives panel on /app/space/[id]/objectives.
 *
 * Shows auto-detected goals that the decompose pipeline materialized as
 * `status='proposed'` + `source='auto_detected'`. Each card includes:
 *   - title + LLM rationale + confidence chip
 *   - the KG entities the LLM linked to this objective (with per-link
 *     confidence Ring + rationale on hover)
 *   - Approve (opens inline metric form if metric not yet set) / Reject
 *
 * On approve: opens a small inline form to supply metric_name +
 * target_value (required to go active). POSTs to
 * /api/goals/[id]/approve, removes from the list on success.
 *
 * On reject: POST /api/goals/[id]/reject, removes from list.
 */

interface ProposedObjectivesSectionProps {
  spaceId: string;
  /** Called after an approve/reject succeeds so the parent can refresh
   *  its goalList or trigger router.refresh(). */
  onResolved?: () => void;
}

export function ProposedObjectivesSection({
  spaceId,
  onResolved,
}: ProposedObjectivesSectionProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<ProposedGoalHydrated[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/goals/proposed?space_id=${encodeURIComponent(spaceId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { proposed: ProposedGoalHydrated[] };
      setProposed(body.proposed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleApprove(
    goalId: string,
    payload: {
      metric_name: string;
      target_value: number;
      metric_unit?: string;
      baseline_value?: number;
    },
    keepEntityIds?: string[],
  ) {
    setProposed((prev) => prev.filter((g) => g.id !== goalId));
    try {
      const res = await fetch(`/api/goals/${goalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          keep_entity_links: keepEntityIds,
        }),
      });
      if (!res.ok) {
        const msg = (await res.json()).error ?? "Approve failed";
        throw new Error(msg);
      }
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
      refresh();
    }
  }

  async function handleReject(goalId: string, reason?: string) {
    setProposed((prev) => prev.filter((g) => g.id !== goalId));
    try {
      const res = await fetch(`/api/goals/${goalId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const msg = (await res.json()).error ?? "Reject failed";
        throw new Error(msg);
      }
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
      refresh();
    }
  }

  if (loading && proposed.length === 0) {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white/60 px-4 py-3 text-[12px] text-gray-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading proposed objectives…
      </div>
    );
  }

  if (proposed.length === 0 && !error) {
    return null; // nothing to review — keep the surface clean
  }

  return (
    <section className="mb-6">
      <header className="mb-3 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-interaxis-600" />
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-600">
          Proposed objectives — pending review
        </h2>
        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
          {proposed.length}
        </span>
        <span className="ml-2 text-[11px] text-gray-500">
          Auto-detected from your intake. Approve to make trackable, reject
          to dismiss.
        </span>
      </header>

      {error && (
        <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}

      <div className="space-y-3">
        {proposed.map((g) => (
          <ProposedCard
            key={g.id}
            goal={g}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))}
      </div>
    </section>
  );
}

// ── Per-card ─────────────────────────────────────────────────────────

function ProposedCard({
  goal,
  onApprove,
  onReject,
}: {
  goal: ProposedGoalHydrated;
  onApprove: (
    goalId: string,
    payload: {
      metric_name: string;
      target_value: number;
      metric_unit?: string;
      baseline_value?: number;
    },
    keepEntityIds?: string[],
  ) => Promise<void>;
  onReject: (goalId: string, reason?: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  const [metricName, setMetricName] = useState(goal.metric_name ?? "");
  const [metricUnit, setMetricUnit] = useState(goal.metric_unit ?? "");
  const [targetValue, setTargetValue] = useState<string>(
    goal.target_value !== null ? String(goal.target_value) : "",
  );
  const [baselineValue, setBaselineValue] = useState<string>(
    goal.baseline_value !== null ? String(goal.baseline_value) : "",
  );
  const [keptEntityIds, setKeptEntityIds] = useState<Set<string>>(
    new Set(goal.linked_entities.map((e) => e.entity_id)),
  );

  const confidenceColor =
    goal.auto_detection_confidence === "high"
      ? "bg-green-50 text-green-700"
      : goal.auto_detection_confidence === "moderate"
        ? "bg-amber-50 text-amber-700"
        : "bg-gray-100 text-gray-600";

  const canSubmit =
    metricName.trim().length > 0 &&
    targetValue.trim().length > 0 &&
    !Number.isNaN(Number(targetValue));

  function toggleEntity(entityId: string) {
    setKeptEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }

  async function submitApprove() {
    if (!canSubmit) return;
    await onApprove(
      goal.id,
      {
        metric_name: metricName.trim(),
        metric_unit: metricUnit.trim() || undefined,
        target_value: Number(targetValue),
        baseline_value: baselineValue ? Number(baselineValue) : undefined,
      },
      Array.from(keptEntityIds),
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-gray-900">
              {goal.title}
            </h3>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                confidenceColor,
              )}
              title="LLM confidence in this proposal"
            >
              {goal.auto_detection_confidence ?? "unknown"}
            </span>
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
              {goal.objective_type}
            </span>
          </div>
          {goal.auto_detection_rationale && (
            <p className="mt-1 text-[12px] italic text-gray-600">
              {goal.auto_detection_rationale}
            </p>
          )}
          {goal.auto_detection_input_type && (
            <div className="mt-1 text-[10px] text-gray-400">
              Detected from: {goal.auto_detection_input_type}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {!approving && (
            <>
              <button
                onClick={() => setApproving(true)}
                className="inline-flex items-center gap-1 rounded-md border border-green-300 bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-100"
              >
                <Check className="h-3 w-3" />
                Approve
              </button>
              <button
                onClick={() => onReject(goal.id)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-red-50 hover:text-red-700"
              >
                <X className="h-3 w-3" />
                Reject
              </button>
            </>
          )}
        </div>
      </div>

      {/* Linked entities preview */}
      {goal.linked_entities.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500 hover:text-gray-900"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Linked entities ({goal.linked_entities.length})
          </button>

          {expanded && (
            <div className="mt-2 space-y-1.5">
              {goal.linked_entities.map((e) => {
                const kept = keptEntityIds.has(e.entity_id);
                return (
                  <div
                    key={e.entity_id}
                    className={cn(
                      "flex items-start gap-2.5 rounded-md border px-2.5 py-1.5",
                      kept
                        ? "border-interaxis-200 bg-interaxis-50/40"
                        : "border-gray-100 bg-gray-50 opacity-60",
                    )}
                  >
                    {approving && (
                      <input
                        type="checkbox"
                        checked={kept}
                        onChange={() => toggleEntity(e.entity_id)}
                        className="mt-1 h-3.5 w-3.5 cursor-pointer"
                        aria-label={`Keep link to ${e.entity_name}`}
                      />
                    )}
                    <Ring value={e.confidence} size={24} showValue={false} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-gray-900">
                        {e.entity_name}
                      </div>
                      {e.rationale && (
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-gray-600">
                          {e.rationale}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {approving && (
                <div className="text-[10px] text-gray-500">
                  Uncheck any link the LLM got wrong — approved links stay on
                  the graph as <code>source=refined</code>.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Approve form */}
      {approving && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Approve — finalize metric
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-[11px]">
              <div className="mb-1 text-gray-600">
                Metric name <span className="text-red-500">*</span>
              </div>
              <input
                type="text"
                value={metricName}
                onChange={(e) => setMetricName(e.target.value)}
                placeholder="e.g. weekly active users"
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] focus:border-interaxis-600 focus:outline-none"
              />
            </label>
            <label className="text-[11px]">
              <div className="mb-1 text-gray-600">Unit</div>
              <input
                type="text"
                value={metricUnit}
                onChange={(e) => setMetricUnit(e.target.value)}
                placeholder="%, count, $…"
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] focus:border-interaxis-600 focus:outline-none"
              />
            </label>
            <label className="text-[11px]">
              <div className="mb-1 text-gray-600">
                Target <span className="text-red-500">*</span>
              </div>
              <input
                type="number"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                step="any"
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] focus:border-interaxis-600 focus:outline-none"
              />
            </label>
            <label className="text-[11px]">
              <div className="mb-1 text-gray-600">Baseline (current)</div>
              <input
                type="number"
                value={baselineValue}
                onChange={(e) => setBaselineValue(e.target.value)}
                step="any"
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] focus:border-interaxis-600 focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => setApproving(false)}
              className="rounded-md px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={submitApprove}
              disabled={!canSubmit}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold",
                canSubmit
                  ? "border-green-400 bg-green-500 text-white hover:bg-green-600"
                  : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400",
              )}
            >
              <Check className="h-3 w-3" />
              Confirm approval
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
