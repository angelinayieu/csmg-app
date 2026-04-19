"use client";

// ── ObjectivesView ──
//
// Global, cross-space view of all the user's objectives + pending proposed
// objectives. This is where the user sees everything the intelligence router
// has surfaced and decides what to accept / dismiss.

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Target,
  Plus,
  Check,
  X,
  Loader2,
  Layers,
  Sparkles,
  FolderOpen,
  TrendingUp,
  TrendingDown,
  Shield,
  Minus,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ObjectiveRow {
  id: string;
  space_id: string;
  space_name: string;
  title: string;
  objective_type: string;
  description: string | null;
  metric_name: string | null;
  parent_goal_id: string | null;
  created_at: string;
}

interface ProposedObjectiveRow {
  id: string;
  space_id: string;
  space_name: string;
  suggested_title: string;
  objective_type: string;
  rationale: string;
  triggering_excerpt: string | null;
  confidence: number;
  parent_objective_id: string | null;
  source: string | null;
  created_at: string;
}

interface IndexResponse {
  objectives: ObjectiveRow[];
  proposed_objectives: ProposedObjectiveRow[];
  spaces: Array<{ id: string; name: string }>;
}

const OBJECTIVE_TYPE_ICON: Record<string, { Icon: React.ComponentType<{ className?: string }>; tint: string }> = {
  maximize: { Icon: TrendingUp, tint: "#16a34a" },
  minimize: { Icon: TrendingDown, tint: "#db2777" },
  maintain: { Icon: Shield, tint: "#0891b2" },
  avoid: { Icon: Minus, tint: "#dc2626" },
};

export function ObjectivesView() {
  const [data, setData] = useState<IndexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingIds, setActingIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "pending" | "accepted">("pending");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/objectives/index");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as IndexResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load objectives");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleProposedAction = useCallback(
    async (proposal: ProposedObjectiveRow, action: "accept" | "dismiss") => {
      setActingIds((prev) => new Set(prev).add(proposal.id));
      try {
        const res = await fetch(`/api/intelligence/proposed-objectives/${proposal.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, space_id: proposal.space_id }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        await load(); // refresh everything
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setActingIds((prev) => {
          const next = new Set(prev);
          next.delete(proposal.id);
          return next;
        });
      }
    },
    [load],
  );

  // Group accepted objectives by space for display
  const objectivesBySpace = useMemo(() => {
    const m = new Map<string, ObjectiveRow[]>();
    for (const o of data?.objectives ?? []) {
      if (!m.has(o.space_id)) m.set(o.space_id, []);
      m.get(o.space_id)!.push(o);
    }
    return m;
  }, [data]);

  const pendingCount = data?.proposed_objectives.length ?? 0;
  const acceptedCount = data?.objectives.length ?? 0;

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-50 to-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white/85 backdrop-blur-sm px-6 py-4 z-10">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
            <Link href="/app/use-cases" className="inline-flex items-center gap-1 hover:text-gray-700">
              <ArrowLeft className="h-3 w-3" />
              Home
            </Link>
            <span>/</span>
            <span className="font-semibold text-gray-900 inline-flex items-center gap-1.5">
              <Target className="h-3 w-3" />
              Objectives
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Your objectives</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            {acceptedCount} active · {pendingCount} pending proposals across {data?.spaces.length ?? 0} space
            {(data?.spaces.length ?? 0) === 1 ? "" : "s"}
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-white/70 border border-gray-200 rounded-lg p-0.5 shadow-sm">
          <FilterTab
            active={filter === "pending"}
            onClick={() => setFilter("pending")}
            label="Proposed"
            count={pendingCount}
            accent="amber"
          />
          <FilterTab
            active={filter === "accepted"}
            onClick={() => setFilter("accepted")}
            label="Accepted"
            count={acceptedCount}
            accent="emerald"
          />
          <FilterTab
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label="All"
            count={pendingCount + acceptedCount}
          />
        </div>
      </div>

      {error && (
        <div className="mx-6 my-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading && !data && (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
            <span className="ml-2 text-sm">Loading objectives…</span>
          </div>
        )}

        {!loading && data && acceptedCount === 0 && pendingCount === 0 && (
          <div className="max-w-xl mx-auto text-center py-12">
            <Target className="h-10 w-10 mx-auto text-gray-300 mb-3" />
            <h2 className="text-lg font-semibold text-gray-700 mb-1">No objectives yet</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              Objectives get proposed when you write content that shows a strong signal — a recurring
              pattern, a commitment, a specific tension worth resolving. Keep journaling or brainstorming;
              the router will surface proposals as patterns emerge.
            </p>
          </div>
        )}

        <div className="max-w-4xl mx-auto space-y-6">
          {/* Pending proposals */}
          {(filter === "pending" || filter === "all") && pendingCount > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-amber-700">
                  Proposed objectives — review &amp; accept
                </h2>
              </div>
              <div className="space-y-2">
                {data?.proposed_objectives.map((p) => (
                  <ProposedObjectiveCard
                    key={p.id}
                    proposal={p}
                    busy={actingIds.has(p.id)}
                    onAccept={() => handleProposedAction(p, "accept")}
                    onDismiss={() => handleProposedAction(p, "dismiss")}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Accepted by space */}
          {(filter === "accepted" || filter === "all") && acceptedCount > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Layers className="h-3.5 w-3.5 text-emerald-600" />
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">
                  Active objectives — grouped by space
                </h2>
              </div>
              <div className="space-y-4">
                {Array.from(objectivesBySpace.entries()).map(([spaceId, objectives]) => {
                  const spaceName = objectives[0]?.space_name ?? "(unknown)";
                  return (
                    <div key={spaceId} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
                        <div className="flex items-center gap-2 text-sm">
                          <FolderOpen className="h-3.5 w-3.5 text-gray-500" />
                          <span className="font-semibold text-gray-800">{spaceName}</span>
                          <span className="text-[10px] font-mono text-gray-400">{objectives.length}</span>
                        </div>
                        <Link
                          href={`/app/space/${spaceId}/objectives`}
                          className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
                        >
                          Open space
                          <ExternalLink className="h-2.5 w-2.5" />
                        </Link>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {objectives.map((o) => (
                          <AcceptedObjectiveRow key={o.id} objective={o} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── FilterTab ──

function FilterTab({
  label,
  count,
  active,
  onClick,
  accent,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  accent?: "amber" | "emerald";
}) {
  const activeColors = {
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  } as const;
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-semibold transition-colors",
        active
          ? accent
            ? `${activeColors[accent]} ring-1 shadow-sm`
            : "bg-gray-800 text-white shadow-sm"
          : "text-gray-600 hover:bg-gray-50",
      )}
    >
      {label}
      <span
        className={cn("font-mono text-[10px]", active ? "opacity-80" : "text-gray-400")}
      >
        {count}
      </span>
    </button>
  );
}

// ── Proposed objective card ──

function ProposedObjectiveCard({
  proposal,
  busy,
  onAccept,
  onDismiss,
}: {
  proposal: ProposedObjectiveRow;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const icon = OBJECTIVE_TYPE_ICON[proposal.objective_type] ?? OBJECTIVE_TYPE_ICON.maximize;
  const Icon = icon.Icon;
  const isSub = !!proposal.parent_objective_id;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 bg-amber-50/40 border-amber-200",
        busy && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg grid place-items-center"
          style={{ background: `${icon.tint}20`, color: icon.tint }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
              {isSub ? "New sub-objective" : "New objective"}
            </span>
            <span className="text-[10px] font-semibold text-gray-500 inline-flex items-center gap-1">
              <FolderOpen className="h-2.5 w-2.5" />
              {proposal.space_name}
            </span>
            {proposal.source && (
              <span className="text-[9px] font-mono text-gray-400">from {proposal.source}</span>
            )}
            <span className="ml-auto text-[10px] font-mono text-amber-600">
              {Math.round(proposal.confidence * 100)}%
            </span>
          </div>
          <h3 className="text-base font-bold text-gray-900 leading-tight">
            {proposal.suggested_title}
          </h3>
          <p className="mt-1 text-[13px] text-gray-700 leading-snug">{proposal.rationale}</p>
          {proposal.triggering_excerpt && (
            <p className="mt-2 text-[11px] italic text-gray-500 line-clamp-2 border-l-2 border-amber-200 pl-2">
              "{proposal.triggering_excerpt}"
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 pt-3 border-t border-amber-100">
        <button
          onClick={onAccept}
          disabled={busy}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",
            busy
              ? "bg-gray-100 text-gray-400 cursor-wait"
              : "bg-amber-600 text-white hover:bg-amber-700 shadow-sm",
          )}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Accept as objective
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-[12px] font-semibold text-gray-500 hover:bg-amber-100 hover:text-gray-800"
        >
          <X className="h-3 w-3" />
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── Accepted objective row ──

function AcceptedObjectiveRow({ objective }: { objective: ObjectiveRow }) {
  const icon = OBJECTIVE_TYPE_ICON[objective.objective_type] ?? OBJECTIVE_TYPE_ICON.maximize;
  const Icon = icon.Icon;
  const isSub = !!objective.parent_goal_id;

  return (
    <div className={cn("px-4 py-3 flex items-start gap-3", isSub && "pl-10 bg-gray-50/40")}>
      <div
        className="flex-shrink-0 w-7 h-7 rounded-lg grid place-items-center"
        style={{ background: `${icon.tint}18`, color: icon.tint }}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {isSub && (
            <span className="text-[9px] font-mono text-gray-400">sub</span>
          )}
          <h4 className="text-[14px] font-semibold text-gray-900">{objective.title}</h4>
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[9px] font-semibold uppercase tracking-wider"
            style={{ background: `${icon.tint}18`, color: icon.tint }}
          >
            {objective.objective_type}
          </span>
          {objective.metric_name && (
            <span className="text-[10px] font-mono text-gray-500 bg-gray-100 px-1.5 py-[1px] rounded">
              {objective.metric_name}
            </span>
          )}
        </div>
        {objective.description && (
          <p className="mt-0.5 text-[12px] text-gray-600 leading-snug line-clamp-2">
            {objective.description}
          </p>
        )}
      </div>
    </div>
  );
}
