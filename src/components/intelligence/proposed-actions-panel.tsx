"use client";

// ── ProposedActionsPanel ──
//
// Lists router-proposed actions (critique refresh, synthesis refresh, strategy
// regen, etc.) as explicit approval buttons. Keeps LLM credits visible so
// users never unknowingly burn through their budget.

import React, { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Zap,
  Check,
  X,
  Loader2,
  Sparkles,
  Network,
  BookOpen,
  Target as TargetIcon,
  FlaskConical,
  Layers,
  RefreshCw,
} from "lucide-react";

export interface ProposalRow {
  id: string;
  kind: string;
  reason: string;
  confidence: number;
  cost_estimate: "low" | "medium" | "high";
  triggered_by_content: string | null;
  created_at: string;
}

export interface ProposedObjectiveRow {
  id: string;
  suggested_title: string;
  objective_type: string;
  rationale: string;
  triggering_excerpt: string | null;
  confidence: number;
  parent_objective_id: string | null;
  source: string | null;
}

const KIND_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; accent: string }> = {
  critique: { label: "Critique refresh", icon: Network, accent: "#5856d6" },
  synthesis_refresh: { label: "Synthesis refresh", icon: Sparkles, accent: "#0051ff" },
  strategy_regen: { label: "Strategy regenerate", icon: Layers, accent: "#db2777" },
  probability_space: { label: "Probability space", icon: FlaskConical, accent: "#d97706" },
  pattern_aggregation: { label: "Pattern aggregation", icon: Target, accent: "#16a34a" },
};

const COST_LABEL: Record<string, { label: string; color: string }> = {
  low: { label: "Low cost", color: "#16a34a" },
  medium: { label: "Medium cost", color: "#d97706" },
  high: { label: "High cost", color: "#dc2626" },
};

function Target({ className }: { className?: string }) {
  return <TargetIcon className={className} />;
}

interface Props {
  spaceId: string;
  // Refresh trigger when caller wants the panel to re-fetch
  refreshNonce?: number;
  // Optional: render compact variant (no section headers, minimal chrome)
  compact?: boolean;
  className?: string;
}

export function ProposedActionsPanel({ spaceId, refreshNonce, compact, className }: Props) {
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [proposedObjectives, setProposedObjectives] = useState<ProposedObjectiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/intelligence/proposals?space_id=${encodeURIComponent(spaceId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as {
        proposals: ProposalRow[];
        proposed_objectives: ProposedObjectiveRow[];
      };
      setProposals(json.proposals);
      setProposedObjectives(json.proposed_objectives);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    load();
  }, [load, refreshNonce]);

  const handleAction = useCallback(
    async (proposalId: string, action: "approve" | "dismiss") => {
      setBusyIds((prev) => new Set(prev).add(proposalId));
      try {
        const res = await fetch(`/api/intelligence/proposals/${encodeURIComponent(proposalId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Remove from the list regardless of approve/dismiss outcome
        setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      } catch (err) {
        console.warn("[ProposedActionsPanel] Action failed:", err);
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(proposalId);
          return next;
        });
      }
    },
    [],
  );

  const totalPending = proposals.length + proposedObjectives.length;

  if (!loading && totalPending === 0 && !error) {
    if (compact) return null;
    return (
      <div className={cn("p-4 text-center text-xs text-gray-500", className)}>
        No pending proposals.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {!compact && (
        <div className="px-4 py-3 border-b border-gray-200 bg-white/60 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Proposed actions
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {totalPending} pending · approve to run
            </div>
          </div>
          <button
            onClick={load}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      )}

      <div className={cn("overflow-y-auto", compact ? "" : "flex-1")}>
        {error && (
          <div className="m-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        {/* Proposed NEW objectives */}
        {proposedObjectives.length > 0 && (
          <div className="p-3 space-y-2">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
              Proposed objectives
            </div>
            {proposedObjectives.map((p) => (
              <ProposedObjectiveCard key={p.id} proposal={p} spaceId={spaceId} onResolved={load} />
            ))}
          </div>
        )}

        {/* Proposed actions (pipeline runs) */}
        {proposals.length > 0 && (
          <div className="p-3 space-y-2">
            {!compact && (
              <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
                Pipeline runs
              </div>
            )}
            {proposals.map((p) => {
              const meta = KIND_META[p.kind] ?? { label: p.kind, icon: Zap, accent: "#6366f1" };
              const Icon = meta.icon;
              const costMeta = COST_LABEL[p.cost_estimate] ?? COST_LABEL.medium;
              const busy = busyIds.has(p.id);
              return (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-lg border bg-white p-3 transition-colors",
                    busy ? "opacity-60" : "hover:border-gray-300",
                  )}
                  style={{ borderColor: busy ? undefined : "rgba(0,0,0,0.08)" }}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="flex-shrink-0 w-6 h-6 rounded grid place-items-center"
                      style={{ background: `${meta.accent}18`, color: meta.accent }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-gray-900">{meta.label}</span>
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                          style={{ color: costMeta.color, background: `${costMeta.color}18` }}
                        >
                          {costMeta.label}
                        </span>
                        <span className="text-[9px] font-mono text-gray-400 ml-auto">
                          {Math.round(p.confidence * 100)}%
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] text-gray-600 leading-snug">{p.reason}</p>
                      {p.triggered_by_content && !compact && (
                        <p className="mt-1 text-[10px] text-gray-400 italic line-clamp-1">
                          “{p.triggered_by_content.slice(0, 120)}”
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => handleAction(p.id, "approve")}
                      disabled={busy}
                      className={cn(
                        "flex-1 inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors",
                        busy
                          ? "bg-gray-100 text-gray-400 cursor-wait"
                          : "text-white shadow-sm",
                      )}
                      style={{ background: busy ? undefined : meta.accent }}
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      {busy ? "Running…" : "Run"}
                    </button>
                    <button
                      onClick={() => handleAction(p.id, "dismiss")}
                      disabled={busy}
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors",
                        busy ? "opacity-50 cursor-not-allowed text-gray-400" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800",
                      )}
                    >
                      <X className="h-3 w-3" />
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {loading && totalPending === 0 && (
          <div className="p-6 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading proposals…
          </div>
        )}
      </div>
    </div>
  );
}

// ── Proposed objective card ──

function ProposedObjectiveCard({
  proposal,
  spaceId,
  onResolved,
}: {
  proposal: ProposedObjectiveRow;
  spaceId: string;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<"accepting" | "dismissing" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const act = async (action: "accept" | "dismiss") => {
    setBusy(action === "accept" ? "accepting" : "dismissing");
    setErr(null);
    try {
      const res = await fetch(`/api/intelligence/proposed-objectives/${proposal.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, space_id: spaceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onResolved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 w-6 h-6 rounded grid place-items-center bg-amber-100 text-amber-700">
          <BookOpen className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-amber-950">
              {proposal.parent_objective_id ? "New sub-objective" : "New objective"}
            </span>
            <span className="text-[9px] font-mono text-amber-500">
              {Math.round(proposal.confidence * 100)}%
            </span>
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900">{proposal.suggested_title}</div>
          <p className="mt-0.5 text-[12px] text-gray-700 leading-snug">{proposal.rationale}</p>
          {proposal.triggering_excerpt && (
            <p className="mt-1 text-[10px] text-gray-500 italic line-clamp-2">
              “{proposal.triggering_excerpt}”
            </p>
          )}
        </div>
      </div>

      {err && <div className="mt-2 text-[10px] text-rose-600">{err}</div>}

      <div className="mt-2 flex items-center gap-2 pt-2 border-t border-amber-100">
        <button
          onClick={() => act("accept")}
          disabled={busy !== null}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors",
            busy ? "bg-gray-100 text-gray-400 cursor-wait" : "bg-amber-600 text-white hover:bg-amber-700 shadow-sm",
          )}
        >
          {busy === "accepting" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {busy === "accepting" ? "Creating…" : "Accept"}
        </button>
        <button
          onClick={() => act("dismiss")}
          disabled={busy !== null}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors",
            busy ? "opacity-50 cursor-not-allowed text-gray-400" : "text-gray-500 hover:bg-amber-100",
          )}
        >
          <X className="h-3 w-3" />
          Dismiss
        </button>
      </div>
    </div>
  );
}
