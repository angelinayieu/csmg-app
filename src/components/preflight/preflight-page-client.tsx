"use client";

// ── PreflightPageClient ──────────────────────────────────────────────
//
// The scientist's contract surface — six sections + sticky downstream
// sidebar. This is B1 + B2: pure rendering of the PreflightView from
// the aggregator, with toggle-state for opt-in plan items wired up so
// the cost recompute is live.
//
// What's IN this cut (B1+B2):
//   • Header band (objective, confidence, hash)
//   • ① Question — primary objective, sub-objectives, domain, horizon
//   • ② Variables — six-role grid with TBD markers, evidence rationale
//   • ③ Causal map preview — counts + bridge previews
//   • ④ Goals — primary + sub-goals + γ + cost terms
//   • ⑤ Initial state — persona conditions + baselines
//   • Sticky right sidebar — will/could/won't with live cost recompute
//   • Approve / Refine buttons (stub handlers — Phase D wires them)
//
// What's NOT in this cut (Phase C):
//   • Drag-between-roles for variables
//   • Inline editing of goals/conditions/baselines
//   • Approve/reject preview bridges inline
//   • Per-card expand drawers with full evidence trails
//
// What's NOT in this cut (Phase D):
//   • Approval action firing the downstream pipeline
//   • Refine action returning to specific section
//   • Re-plan action firing fresh generation

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  MoreVertical,
  RotateCcw,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import type {
  PreflightView,
  VariableEntry,
  PlanItem,
  ConfidenceCallout,
  PreviewBridge,
} from "@/types/preflight";
import { usePreflightOverride } from "./use-override-mutation";

// ── Mutation context ───────────────────────────────────────────────
//
// Lets every section component fire override writes without props
// drilling. The hook is instantiated once at the page root; children
// read `mutate` + `pending` from context.

interface MutationContextValue {
  mutate: ReturnType<typeof usePreflightOverride>["mutate"];
  pending: boolean;
  lastError: string | null;
  lastSavedTargetId: string | null;
}

const MutationContext = createContext<MutationContextValue | null>(null);

function useMutation(): MutationContextValue {
  const ctx = useContext(MutationContext);
  if (!ctx) {
    throw new Error("useMutation must be used inside MutationContext.Provider");
  }
  return ctx;
}

// ── Top-level component ─────────────────────────────────────────────

interface PreflightPageClientProps {
  initial: PreflightView;
  spaceId: string;
}

export function PreflightPageClient({ initial, spaceId }: PreflightPageClientProps) {
  const overrideMut = usePreflightOverride({ spaceId });

  // Local toggle state for opt-in plan items. Initialized from the
  // server's PreflightView (which already reflects any persisted
  // overrides via the aggregator), then updated locally for snappy UI
  // and persisted to environment_overrides via the mutation hook.
  const [optIns, setOptIns] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const item of initial.downstream.could_generate) {
      map[item.id] = item.enabled;
    }
    return map;
  });

  const toggleOptIn = useCallback(
    (id: string) => {
      setOptIns((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        // Fire the override async. router.refresh() inside the hook
        // pulls fresh server data with the new override applied.
        void overrideMut.mutate({
          override_kind: "toggle_plan_item",
          target_id: id,
          value: { enabled: next[id] },
        });
        return next;
      });
    },
    [overrideMut],
  );

  // Recompute downstream totals live as toggles change.
  const liveDownstream = useMemo(
    () => recomputeDownstream(initial, optIns),
    [initial, optIns],
  );

  const mutationCtx: MutationContextValue = {
    mutate: overrideMut.mutate,
    pending: overrideMut.pending,
    lastError: overrideMut.lastError,
    lastSavedTargetId: overrideMut.lastSavedTargetId,
  };

  return (
    <MutationContext.Provider value={mutationCtx}>
      <div className="min-h-screen bg-gray-50">
        {/* Tiny global pending bar — non-blocking. */}
        {overrideMut.pending && (
          <div className="fixed left-0 right-0 top-0 z-50 h-0.5 animate-pulse bg-emerald-500" />
        )}
        {overrideMut.lastError && (
          <div className="fixed inset-x-0 top-0 z-50 bg-red-50 px-4 py-2 text-center text-xs font-semibold text-red-800">
            Save failed: {overrideMut.lastError}
          </div>
        )}

        <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
          {/* Main column */}
          <main className="min-w-0 flex-1 space-y-5">
            <HeaderBand preflight={initial} spaceId={spaceId} />
            <CalloutBanner callouts={initial.confidence_breakdown.callouts} />
            <SectionQuestion preflight={initial} />
            <SectionVariables preflight={initial} />
            <SectionCausalMap preflight={initial} />
            <SectionGoals preflight={initial} />
            <SectionInitialState preflight={initial} />
          </main>

          {/* Sticky right sidebar — downstream plan */}
          <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-[340px] flex-shrink-0 overflow-y-auto lg:block">
            <DownstreamSidebar
              spaceId={spaceId}
              willItems={initial.downstream.will_generate}
              couldItems={initial.downstream.could_generate}
              wontItems={initial.downstream.will_not_generate}
              optIns={optIns}
              onToggle={toggleOptIn}
              estimatedSeconds={liveDownstream.estimated_total_seconds}
              estimatedCost={liveDownstream.estimated_total_cost_usd}
              estimatedEntities={liveDownstream.estimated_entities_added}
              estimatedEdges={liveDownstream.estimated_edges_added}
            />
          </aside>
        </div>
      </div>
    </MutationContext.Provider>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function HeaderBand({ preflight, spaceId }: { preflight: PreflightView; spaceId: string }) {
  const confidencePct = Math.round(preflight.confidence_overall * 100);
  const confidenceColor =
    confidencePct >= 70 ? "text-emerald-700" : confidencePct >= 40 ? "text-amber-700" : "text-red-700";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <span className="rounded bg-gray-100 px-2 py-0.5 font-mono">
              {preflight.question.domain.label}
            </span>
            {preflight.question.decision_horizon_weeks != null && (
              <>
                <span>·</span>
                <span>{preflight.question.decision_horizon_weeks}w horizon</span>
              </>
            )}
            <span>·</span>
            <span className="font-mono text-[9px]">
              {preflight.preflight_hash}
            </span>
          </div>

          <h1 className="mt-2 text-xl font-bold text-gray-900">
            {preflight.question.primary_objective}
          </h1>

          {preflight.question.prompt_verbatim && (
            <p className="mt-1.5 text-xs italic text-gray-500 line-clamp-2">
              &ldquo;{preflight.question.prompt_verbatim}&rdquo;
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <div className={`text-2xl font-bold ${confidenceColor}`}>
            {confidencePct}%
          </div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">
            Preflight confidence
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
        <a
          href={`/app/space/${spaceId}/whiteboard`}
          className="text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          ← Back to canvas
        </a>
        <a
          href={`/app/space/${spaceId}/environment`}
          className="text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          Audit as MDP environment →
        </a>
      </div>
    </div>
  );
}

// ── Callout banner — rolls all severe issues into one strip ─────────

function CalloutBanner({ callouts }: { callouts: ConfidenceCallout[] }) {
  const warns = callouts.filter((c) => c.severity === "warn" || c.severity === "critical");
  if (warns.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
        <Info className="h-3.5 w-3.5" />
        {warns.length} thing{warns.length === 1 ? "" : "s"} to review before approving
      </div>
      <ul className="mt-2 space-y-1 pl-5 text-[11px] text-amber-900">
        {warns.map((c, i) => (
          <li key={i} className="list-disc">
            {c.message}
            {c.suggested_action && (
              <span className="ml-1 italic text-amber-700">
                — {c.suggested_action}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Section ① — Question ─────────────────────────────────────────────

function SectionQuestion({ preflight }: { preflight: PreflightView }) {
  const q = preflight.question;
  return (
    <SectionShell
      title="① The question"
      subtitle="What we understood from your intake"
      confidence={preflight.confidence_breakdown.question_clarity.score}
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Primary objective
          </div>
          <p className="mt-1 text-sm font-medium text-gray-900">
            {q.primary_objective}
          </p>
          {q.primary_objective_source_quote && (
            <p className="mt-1 border-l-2 border-gray-200 pl-2 text-[11px] italic text-gray-500">
              source: &ldquo;{q.primary_objective_source_quote}&rdquo;
            </p>
          )}
        </div>

        {q.sub_objectives.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Sub-objectives ({q.sub_objectives.length})
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {q.sub_objectives.map((s, i) => (
                <li key={i} className="text-[11px] text-gray-700">
                  <span className="font-mono text-gray-400">{i + 1}.</span> {s.text}
                  {s.confidence < 0.7 && (
                    <span className="ml-1.5 text-[10px] text-amber-700">
                      ({Math.round(s.confidence * 100)}% confidence)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div>
            <span className="font-bold text-gray-500">Domain:</span>{" "}
            {q.domain.label}{" "}
            <span className="text-gray-400">
              ({Math.round(q.domain.confidence * 100)}%)
            </span>
          </div>
          <div>
            <span className="font-bold text-gray-500">Horizon:</span>{" "}
            {q.decision_horizon_weeks ?? "—"}w
          </div>
        </div>

        {q.out_of_scope.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Out of scope
            </div>
            <p className="mt-1 text-[11px] text-gray-600">
              {q.out_of_scope.join(" · ")}
            </p>
          </div>
        )}

        {q.success_criteria.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Success criteria
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-gray-700">
              {q.success_criteria.map((s, i) => (
                <li key={i}>
                  <span
                    className={
                      s.priority === "primary"
                        ? "font-semibold text-gray-900"
                        : "text-gray-600"
                    }
                  >
                    {s.criterion}
                  </span>
                  {s.threshold && (
                    <span className="ml-1 text-gray-400">→ {s.threshold}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionShell>
  );
}

// ── Section ② — Variables (six-column grid) ──────────────────────────

function SectionVariables({ preflight }: { preflight: PreflightView }) {
  const v = preflight.variables;
  const noteByRole = new Map(
    preflight.variables.role_inference_notes.map((n) => [n.role, n]),
  );

  return (
    <SectionShell
      title="② Variables"
      subtitle="What we'll model — by experimental-design role"
      confidence={preflight.confidence_breakdown.variable_coverage.score}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <RoleColumn
          title="Independent"
          subtitle="What you manipulate"
          items={v.independent}
          note={noteByRole.get("independent")}
          accent="indigo"
        />
        <RoleColumn
          title="Dependent"
          subtitle="What you measure"
          items={v.dependent}
          note={noteByRole.get("dependent")}
          accent="emerald"
        />
        <RoleColumn
          title="Controls"
          subtitle="Held constant"
          items={v.controls}
          note={noteByRole.get("controls")}
          accent="slate"
        />
        <RoleColumn
          title="Confounders"
          subtitle="Adjust for"
          items={v.confounders}
          note={noteByRole.get("confounders")}
          accent="rose"
        />
        <RoleColumn
          title="Mediators"
          subtitle="On the path"
          items={v.mediators}
          note={noteByRole.get("mediators")}
          accent="violet"
        />
        <RoleColumn
          title="Moderators"
          subtitle="Change effect strength"
          items={v.moderators}
          note={noteByRole.get("moderators")}
          accent="amber"
        />
      </div>

      {v.unclassified.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Unclassified ({v.unclassified.length})
            <span className="font-normal normal-case text-gray-400">
              — drag to a role to assign, or wait for synthesis to classify
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {v.unclassified.slice(0, 12).map((entry) => (
              <span
                key={entry.entity_id}
                className="rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"
                title={entry.rationale.reason}
              >
                {entry.name}
              </span>
            ))}
            {v.unclassified.length > 12 && (
              <span className="text-[10px] text-gray-400">
                …+{v.unclassified.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

const ACCENT_BG: Record<string, string> = {
  indigo: "bg-indigo-50 border-indigo-200",
  emerald: "bg-emerald-50 border-emerald-200",
  slate: "bg-slate-50 border-slate-200",
  rose: "bg-rose-50 border-rose-200",
  violet: "bg-violet-50 border-violet-200",
  amber: "bg-amber-50 border-amber-200",
};
const ACCENT_TEXT: Record<string, string> = {
  indigo: "text-indigo-900",
  emerald: "text-emerald-900",
  slate: "text-slate-700",
  rose: "text-rose-900",
  violet: "text-violet-900",
  amber: "text-amber-900",
};

function RoleColumn({
  title,
  subtitle,
  items,
  note,
  accent,
}: {
  title: string;
  subtitle: string;
  items: VariableEntry[];
  note?: { reason: string; resolved_by: string; severity: "info" | "warn" };
  accent: keyof typeof ACCENT_BG;
}) {
  return (
    <div className={`rounded-lg border p-3 ${ACCENT_BG[accent]}`}>
      <div className="flex items-baseline justify-between">
        <h3 className={`text-xs font-bold uppercase tracking-wider ${ACCENT_TEXT[accent]}`}>
          {title}{" "}
          <span className="text-[10px] font-normal text-gray-500">
            ({items.length === 0 ? "?" : items.length})
          </span>
        </h3>
      </div>
      <p className="text-[10px] text-gray-500">{subtitle}</p>

      <div className="mt-2 space-y-1">
        {items.length === 0 && note ? (
          <div
            className={`rounded border-dashed p-2 text-[10.5px] leading-snug ${
              note.severity === "warn"
                ? "border border-amber-300 bg-amber-50 text-amber-900"
                : "border border-gray-200 bg-white text-gray-600"
            }`}
          >
            <div className="font-semibold">⚠ TBD</div>
            <div className="mt-0.5">{note.reason}</div>
            <div className="mt-1 italic text-gray-500">
              {note.resolved_by}
            </div>
          </div>
        ) : (
          items.slice(0, 6).map((entry) => (
            <VariableEntryCard key={entry.entity_id} entry={entry} />
          ))
        )}
        {items.length > 6 && (
          <div className="text-[10px] text-gray-400">
            …+{items.length - 6} more
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section ③ — Causal map preview ──────────────────────────────────

function SectionCausalMap({ preflight }: { preflight: PreflightView }) {
  const m = preflight.causal_map;
  return (
    <SectionShell
      title="③ Causal map preview"
      subtitle="How the variables connect — and what we'll bridge"
      confidence={preflight.confidence_breakdown.causal_map_density.score}
    >
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Entities" value={m.current_entities} />
        <Stat label="Edges" value={m.current_edges} />
        <Stat label="Orphan clusters" value={m.orphan_clusters_count} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-[10px]">
        <div>
          <div className="font-bold uppercase tracking-wider text-gray-500">By status</div>
          <div className="mt-1 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-emerald-700">confirmed</span>
              <span className="font-mono">{m.edge_status_counts.confirmed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-amber-700">mixed</span>
              <span className="font-mono">{m.edge_status_counts.mixed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">sparse</span>
              <span className="font-mono">{m.edge_status_counts.sparse}</span>
            </div>
          </div>
        </div>
        <div>
          <div className="font-bold uppercase tracking-wider text-gray-500">By origin</div>
          <div className="mt-1 space-y-0.5">
            <div className="flex justify-between">
              <span>From prompt</span>
              <span className="font-mono">{m.explicit_relations_from_prompt}</span>
            </div>
            <div className="flex justify-between">
              <span>Template seed</span>
              <span className="font-mono">{m.template_seed_relations}</span>
            </div>
            <div className="flex justify-between">
              <span>Research</span>
              <span className="font-mono">{m.research_added_relations}</span>
            </div>
          </div>
        </div>
        <div>
          <div className="font-bold uppercase tracking-wider text-gray-500">Decomposition</div>
          <DepthSlider value={m.depth_setting} />
        </div>
      </div>

      {m.preview_bridges.length > 0 && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-900">
            Bridge proposals ({m.preview_bridges.length})
          </div>
          <div className="mt-1.5 text-[10.5px] text-emerald-800">
            We&apos;ll add these bridging entities to fill orphan clusters when you
            approve. Hover for the mechanism explanation.
          </div>
          <ul className="mt-2 space-y-1.5">
            {m.preview_bridges.slice(0, 4).map((b) => (
              <BridgePreview key={b.cluster_id} bridge={b} />
            ))}
          </ul>
        </div>
      )}
    </SectionShell>
  );
}

function BridgePreview({ bridge }: { bridge: PreviewBridge }) {
  const { mutate, pending, lastSavedTargetId } = useMutation();
  const [expanded, setExpanded] = useState(false);
  const isPending = pending && lastSavedTargetId === bridge.cluster_id;
  const decided = bridge.preview_decision !== "pending";

  const onApprove = useCallback(() => {
    void mutate({
      override_kind: "approve_preview_bridge",
      target_id: bridge.cluster_id,
      value: { proposed_entity_name: bridge.proposed_entity_name },
    });
  }, [bridge.cluster_id, bridge.proposed_entity_name, mutate]);

  const onReject = useCallback(() => {
    void mutate({
      override_kind: "reject_preview_bridge",
      target_id: bridge.cluster_id,
      value: { proposed_entity_name: bridge.proposed_entity_name },
    });
  }, [bridge.cluster_id, bridge.proposed_entity_name, mutate]);

  return (
    <li
      className={`rounded border bg-white px-2 py-1.5 text-[10.5px] ${
        bridge.preview_decision === "preview_approved"
          ? "border-emerald-300"
          : bridge.preview_decision === "preview_rejected"
            ? "border-gray-300 opacity-60"
            : "border-white"
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 cursor-pointer text-left"
          title={expanded ? "Hide details" : "Show validator verdict + citations"}
        >
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-gray-900">
              {bridge.proposed_entity_name}
            </span>
            {bridge.speculative && (
              <span className="rounded bg-amber-100 px-1 text-[8.5px] font-bold uppercase tracking-wide text-amber-700">
                speculative
              </span>
            )}
            <span className="text-[9.5px] tabular-nums text-gray-500">
              {Math.round(bridge.confidence * 100)}% conf
            </span>
          </div>
          <div className="text-[10px] text-gray-600">
            bridges: {bridge.bridges_member_names.slice(0, 3).join(" · ")}
            {bridge.bridges_member_names.length > 3
              ? ` +${bridge.bridges_member_names.length - 3} more`
              : ""}
          </div>
        </button>

        <div className="flex flex-shrink-0 items-center gap-1">
          {bridge.preview_decision === "preview_approved" ? (
            <span className="flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
              <Check className="h-2.5 w-2.5" /> approved
            </span>
          ) : bridge.preview_decision === "preview_rejected" ? (
            <span className="flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">
              <X className="h-2.5 w-2.5" /> rejected
            </span>
          ) : (
            <>
              <button
                onClick={onApprove}
                disabled={decided || isPending}
                className="rounded bg-emerald-600 p-1 text-white hover:bg-emerald-700 disabled:opacity-50"
                title="Pre-approve this bridge — applied when you run the plan"
                aria-label="Approve bridge"
              >
                {isPending ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Check className="h-2.5 w-2.5" />
                )}
              </button>
              <button
                onClick={onReject}
                disabled={decided || isPending}
                className="rounded border border-gray-300 bg-white p-1 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                title="Reject this bridge — won't be added even if you run the plan"
                aria-label="Reject bridge"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2 text-[10px] leading-snug">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
              Mechanism
            </div>
            <div className="mt-0.5 text-gray-700">{bridge.mechanism_explanation}</div>
          </div>

          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
              Validator verdict — {bridge.verdict.status}
            </div>
            {bridge.verdict.supporting_evidence_summary && (
              <div className="mt-0.5 text-gray-700">
                {bridge.verdict.supporting_evidence_summary}
              </div>
            )}
            {bridge.verdict.counter_evidence_summary && (
              <div className="mt-0.5 text-amber-800">
                <span className="font-semibold">caveat:</span>{" "}
                {bridge.verdict.counter_evidence_summary}
              </div>
            )}
          </div>

          {bridge.verdict.notes.length > 0 && (
            <ul className="list-disc pl-4 text-gray-600">
              {bridge.verdict.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}

          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
              Bridges all {bridge.bridges_member_names.length} members
            </div>
            <div className="mt-0.5 font-mono text-[9.5px] text-gray-700">
              {bridge.bridges_member_names.join(" · ")}
            </div>
          </div>

          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
              {bridge.proposed_edge_count} edges to add
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Section ④ — Goals ────────────────────────────────────────────────

function SectionGoals({ preflight }: { preflight: PreflightView }) {
  const g = preflight.goals;
  return (
    <SectionShell
      title="④ Goals & success"
      subtitle="What optimal looks like"
      confidence={preflight.confidence_breakdown.goal_specificity.score}
    >
      {!g.primary && (
        <div className="rounded border border-dashed border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900">
          <strong>No primary goal yet.</strong> Set a target metric — without
          it, the simulator has no reward signal to optimize against.
        </div>
      )}
      {g.primary && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-900">
            Primary goal
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900">
            {g.primary.title}
          </div>
          <div className="mt-1 text-[11px] text-gray-700">
            <span className="font-mono">{g.primary.metric_name}</span>:{" "}
            <span className="tabular-nums">
              {g.primary.baseline_value ?? "—"}
            </span>{" "}
            → <span className="font-bold tabular-nums">
              {g.primary.target_value ?? "—"}
            </span>
            {g.primary.unit && ` ${g.primary.unit}`}
            {g.primary.horizon_weeks != null && ` in ${g.primary.horizon_weeks}w`}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[10px]">
            <span
              className={`rounded px-1.5 py-0.5 font-bold uppercase tracking-wide ${
                g.primary.baseline_measured
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {g.primary.baseline_measured ? "baseline measured" : "baseline assumed"}
            </span>
            <span className="text-gray-500">
              direction: {g.primary.direction}
            </span>
          </div>
          <GoalWeightSlider goalId={g.primary.goal_id} value={g.primary.weight} label="primary weight" />
        </div>
      )}

      {g.sub_goals.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Sub-goals ({g.sub_goals.length})
          </div>
          <ul className="mt-1.5 space-y-1">
            {g.sub_goals.map((s) => (
              <li
                key={s.goal_id}
                className="rounded border border-gray-100 bg-white px-2 py-1.5 text-[11px]"
              >
                <div className="flex items-baseline justify-between">
                  <span>
                    <span className="font-semibold text-gray-900">{s.title}</span>
                    <span className="ml-1.5 text-gray-500">
                      {s.baseline_value ?? "—"} → {s.target_value ?? "—"}
                      {s.unit ? ` ${s.unit}` : ""}
                    </span>
                  </span>
                </div>
                <GoalWeightSlider goalId={s.goal_id} value={s.weight} label="weight" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Discount γ ({g.discount_label})
          </div>
          {g.primary ? (
            <DiscountSlider
              value={g.discount_per_week}
              halfLifeWeeks={g.effective_half_life_weeks}
              goalId={g.primary.goal_id}
            />
          ) : (
            <div className="mt-1 font-mono text-lg tabular-nums text-gray-400">
              — (set a primary goal first)
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Cost terms ({g.cost_terms.length})
          </div>
          {g.cost_terms.length === 0 ? (
            <div className="text-[10.5px] text-gray-500">none — only positive rewards</div>
          ) : (
            <ul className="text-[10.5px] text-gray-700">
              {g.cost_terms.slice(0, 4).map((c, i) => (
                <li key={i}>
                  {c.label} <span className="text-gray-400">w {c.weight.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {!g.weights_normalized && (
        <div className="mt-3 rounded bg-amber-50 p-2 text-[10.5px] text-amber-800">
          ⚠ Goal weights don&apos;t sum to 1.0 — strategy generation may
          weight the goals differently than you intend.
        </div>
      )}
    </SectionShell>
  );
}

// ── Section ⑤ — Initial state ────────────────────────────────────────

function SectionInitialState({ preflight }: { preflight: PreflightView }) {
  const s = preflight.initial_state;
  return (
    <SectionShell
      title="⑤ Initial state"
      subtitle={
        s.persona_name
          ? `Where ${s.persona_name} is starting from`
          : "Where you're starting from"
      }
      confidence={preflight.confidence_breakdown.initial_state_calibration.score}
    >
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Stat
          label="Conditions calibrated"
          value={`${s.calibrated_count} / ${s.conditions.length}`}
          tone={s.uncalibrated_count > 0 ? "warn" : "ok"}
        />
        <Stat
          label="Baselines measured"
          value={`${s.baselines_measured} / ${s.baselines.length}`}
          tone={s.baselines_pending > 0 ? "warn" : "ok"}
        />
      </div>

      {s.conditions.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Conditions
          </div>
          <ul className="mt-1.5 grid grid-cols-2 gap-1.5">
            {s.conditions.map((c) => (
              <ConditionCard key={c.key} condition={c} />
            ))}
          </ul>
        </div>
      )}

      {s.pending_baselines_to_measure.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
            Suggested measurements before approval
          </div>
          <p className="mt-1 text-[10.5px] text-amber-800">
            Measuring these would meaningfully reduce prediction variance.
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[11px] text-amber-900">
            {s.pending_baselines_to_measure.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </SectionShell>
  );
}

// ── Sticky right sidebar ────────────────────────────────────────────

function DownstreamSidebar({
  spaceId,
  willItems,
  couldItems,
  wontItems,
  optIns,
  onToggle,
  estimatedSeconds,
  estimatedCost,
  estimatedEntities,
  estimatedEdges,
}: {
  spaceId: string;
  willItems: PlanItem[];
  couldItems: PlanItem[];
  wontItems: PreflightView["downstream"]["will_not_generate"];
  optIns: Record<string, boolean>;
  onToggle: (id: string) => void;
  estimatedSeconds: number;
  estimatedCost: number;
  estimatedEntities: number;
  estimatedEdges: number;
}) {
  const router = useRouter();
  const [approving, setApproving] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onRunPlan = useCallback(async () => {
    setApproving(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/preflight/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          (data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : null) ?? `HTTP ${res.status}`;
        setActionError(msg);
        return;
      }
      const payload = (await res.json()) as { redirect_to?: string };
      router.push(payload.redirect_to ?? `/app/space/${spaceId}/whiteboard`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Network error",
      );
    } finally {
      setApproving(false);
    }
  }, [spaceId, router]);

  const onReplan = useCallback(async () => {
    if (
      !window.confirm(
        "Clear all your edits and re-derive the preflight from scratch? This removes every override you've made on this page.",
      )
    ) {
      return;
    }
    setReplanning(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/preflight/overrides?all=true`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          (data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : null) ?? `HTTP ${res.status}`;
        setActionError(msg);
        return;
      }
      router.refresh();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Network error",
      );
    } finally {
      setReplanning(false);
    }
  }, [spaceId, router]);

  return (
    <div className="space-y-4">
      {/* Live totals */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          When you approve, this runs:
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <Stat label="Time" value={`~${formatSeconds(estimatedSeconds)}`} compact />
          <Stat label="Cost" value={`$${estimatedCost.toFixed(2)}`} compact />
          <Stat label="+Entities" value={`~${estimatedEntities}`} compact />
          <Stat label="+Edges" value={`~${estimatedEdges}`} compact />
        </div>

        <button
          onClick={onRunPlan}
          disabled={approving || replanning}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          title="Lock the preflight + fire the downstream pipeline. You'll be redirected to the canvas."
        >
          {approving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Running plan…
            </>
          ) : (
            <>
              <ArrowRight className="h-3.5 w-3.5" />
              Run this plan
            </>
          )}
        </button>
        <div className="mt-2 flex gap-2">
          <button
            onClick={onReplan}
            disabled={approving || replanning}
            className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[10.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Discard all edits and re-derive from the LLM-default preflight"
          >
            {replanning ? (
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="mr-1 inline h-3 w-3" />
            )}
            Re-plan
          </button>
        </div>

        {actionError && (
          <div className="mt-2 rounded bg-red-50 p-1.5 text-[10px] text-red-700">
            {actionError}
          </div>
        )}
      </div>

      {/* Will-generate list */}
      <PlanList
        title="Will be generated"
        accent="text-emerald-700"
        icon={<Check className="h-3 w-3" />}
        items={willItems}
        optIns={optIns}
        onToggle={onToggle}
      />

      {/* Could-generate (opt-in) list */}
      <PlanList
        title="Could also be generated"
        accent="text-blue-700"
        icon={<Sparkles className="h-3 w-3" />}
        items={couldItems}
        optIns={optIns}
        onToggle={onToggle}
      />

      {/* Will-not-generate list */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          <XCircle className="h-3 w-3" /> Will NOT be generated
        </div>
        <ul className="mt-2 space-y-1.5 text-[10.5px]">
          {wontItems.map((w, i) => (
            <li key={i}>
              <div className="font-semibold text-gray-700">{w.label}</div>
              <div className="text-[10px] text-gray-500">{w.reason}</div>
              {w.unlock_path && (
                <div className="mt-0.5 text-[10px] italic text-gray-400">
                  → {w.unlock_path}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PlanList({
  title,
  accent,
  icon,
  items,
  optIns,
  onToggle,
}: {
  title: string;
  accent: string;
  icon: React.ReactNode;
  items: PlanItem[];
  optIns: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${accent}`}>
        {icon}
        {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => {
          const enabled = item.toggleable
            ? (optIns[item.id] ?? item.default_enabled)
            : item.default_enabled;
          return (
            <li
              key={item.id}
              className="rounded border border-gray-100 bg-gray-50 p-2"
            >
              <div className="flex items-start gap-2">
                {item.toggleable ? (
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => onToggle(item.id)}
                    className="mt-0.5 flex-shrink-0"
                    aria-label={`Toggle ${item.label}`}
                  />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-[10.5px] font-semibold ${
                        enabled ? "text-gray-900" : "text-gray-500"
                      }`}
                    >
                      {item.label}
                    </span>
                    <span className="font-mono text-[9px] tabular-nums text-gray-400">
                      {item.estimated_seconds}s
                      {item.estimated_cost_usd > 0 &&
                        ` · $${item.estimated_cost_usd.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="text-[9.5px] leading-tight text-gray-500">
                    {item.description}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Reusable section shell ──────────────────────────────────────────

function SectionShell({
  title,
  subtitle,
  confidence,
  children,
}: {
  title: string;
  subtitle: string;
  confidence: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pct = Math.round(confidence * 100);

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          <p className="text-[10.5px] text-gray-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${
              pct >= 70
                ? "bg-emerald-100 text-emerald-700"
                : pct >= 40
                  ? "bg-amber-100 text-amber-700"
                  : "bg-red-100 text-red-700"
            }`}
            title={`Section confidence: ${pct}%`}
          >
            {pct}%
          </span>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100"
            aria-label={collapsed ? "Expand section" : "Collapse section"}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </header>
      {!collapsed && <div className="px-4 py-4">{children}</div>}
    </section>
  );
}

// ── Stat helper ─────────────────────────────────────────────────────

function Stat({
  label,
  value,
  compact,
  tone,
}: {
  label: string;
  value: string | number;
  compact?: boolean;
  tone?: "ok" | "warn" | "err";
}) {
  const toneColor =
    tone === "warn"
      ? "text-amber-700"
      : tone === "err"
        ? "text-red-700"
        : "text-gray-900";
  return (
    <div
      className={`rounded ${
        compact ? "border border-gray-100 bg-gray-50 p-1.5" : "bg-gray-50 px-3 py-2"
      }`}
    >
      <div className={`font-mono ${compact ? "text-sm" : "text-base"} font-bold tabular-nums ${toneColor}`}>
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-gray-500">{label}</div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

// ── D3 — RationaleBlock — the shared evidence drawer ────────────────
//
// Inline expander rendered below cards when the user clicks them. Shows
// the audit trail: where this claim came from (prompt extraction /
// template seed / research / synthesis / user override / auto-classifier),
// the verbatim source quote, evidence ids, confidence, reasoning. This
// is what makes preflight claims TRACEABLE rather than oracular.

const SOURCE_LABEL: Record<VariableEntry["rationale"]["source"], string> = {
  prompt_extraction: "From your prompt",
  template_seed: "Template seed",
  research: "Research extraction",
  synthesis_inference: "Synthesis inferred",
  user_override: "You set this",
  auto_classifier: "Auto-classifier",
};

const SOURCE_BADGE: Record<VariableEntry["rationale"]["source"], string> = {
  prompt_extraction: "bg-emerald-100 text-emerald-700",
  template_seed: "bg-indigo-100 text-indigo-700",
  research: "bg-blue-100 text-blue-700",
  synthesis_inference: "bg-violet-100 text-violet-700",
  user_override: "bg-orange-100 text-orange-700",
  auto_classifier: "bg-slate-100 text-slate-700",
};

function RationaleBlock({
  source,
  sourceQuote,
  confidence,
  reason,
  evidenceIds,
  extras,
}: {
  source: VariableEntry["rationale"]["source"];
  sourceQuote: string | null;
  confidence: number;
  reason: string;
  evidenceIds: string[];
  extras?: Array<{ label: string; value: string }>;
}) {
  const pct = Math.round(confidence * 100);
  const confColor =
    pct >= 70 ? "text-emerald-700" : pct >= 40 ? "text-amber-700" : "text-red-700";

  return (
    <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2 text-[10px] leading-snug">
      <div className="flex items-center gap-1.5">
        <span
          className={`rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide ${SOURCE_BADGE[source]}`}
        >
          {SOURCE_LABEL[source]}
        </span>
        <span className={`tabular-nums font-bold ${confColor}`}>
          {pct}% conf
        </span>
      </div>

      {reason && (
        <div className="text-gray-700">
          <span className="font-semibold text-gray-500">Why:</span> {reason}
        </div>
      )}

      {sourceQuote && (
        <div className="border-l-2 border-gray-200 pl-2 italic text-gray-500">
          &ldquo;{sourceQuote}&rdquo;
        </div>
      )}

      {extras && extras.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[9.5px] text-gray-500">
          {extras.map((e) => (
            <span key={e.label}>
              <span className="font-semibold">{e.label}:</span> {e.value}
            </span>
          ))}
        </div>
      )}

      {evidenceIds.length > 0 && (
        <div className="text-[9.5px] text-gray-500">
          <span className="font-semibold">{evidenceIds.length} evidence row{evidenceIds.length === 1 ? "" : "s"}:</span>{" "}
          <span className="font-mono">
            {evidenceIds.slice(0, 3).map((id) => id.slice(0, 8)).join(" · ")}
            {evidenceIds.length > 3 ? ` +${evidenceIds.length - 3}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

// ── C2 — Discount γ slider ──────────────────────────────────────────

const DISCOUNT_PRESETS: Array<{ value: number; label: string; halfLifeNote: string }> = [
  { value: 0.85, label: "Urgent", halfLifeNote: "~4w half-life — favor immediate wins" },
  { value: 0.92, label: "Brisk", halfLifeNote: "~8w" },
  { value: 0.95, label: "Balanced", halfLifeNote: "~14w (default)" },
  { value: 0.97, label: "Patient", halfLifeNote: "~23w" },
  { value: 0.99, label: "Long-horizon", halfLifeNote: "~70w — favor durable structural change" },
];

function DiscountSlider({
  value,
  halfLifeWeeks,
  goalId,
}: {
  value: number;
  halfLifeWeeks: number;
  goalId: string;
}) {
  const { mutate, pending, lastSavedTargetId } = useMutation();
  const [local, setLocal] = useState(value);
  const isPending = pending && lastSavedTargetId === goalId;

  const onCommit = useCallback(
    (next: number) => {
      void mutate({
        override_kind: "adjust_goal",
        target_id: goalId,
        value: { discount_per_week: next },
      });
    },
    [goalId, mutate],
  );

  // Find the closest preset for label rendering.
  const preset = DISCOUNT_PRESETS.reduce((best, p) =>
    Math.abs(p.value - local) < Math.abs(best.value - local) ? p : best,
  );

  return (
    <div className="mt-1">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-lg tabular-nums text-gray-900">
          {local.toFixed(3)}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
          {preset.label}
        </span>
        {isPending && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
      </div>
      <input
        type="range"
        min={0.7}
        max={0.99}
        step={0.005}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="mt-1 w-full"
        aria-label="Discount factor γ"
      />
      <div className="text-[10px] text-gray-500">
        half-life: {Number.isFinite(halfLifeWeeks) ? `~${halfLifeWeeks}w` : "∞"} · {preset.halfLifeNote}
      </div>
    </div>
  );
}

// ── C2b — Per-goal weight slider ────────────────────────────────────
//
// Adjusts the relative weight of a goal in the multi-objective reward
// function. Primary goals usually sit between 0.6–1.0; sub-goals
// between 0.1–0.5. The reward function combines them as a weighted sum:
//
//     R(s) = Σ_g  weight_g · normalize_g(progress_g)
//
// So shifting weights lets the user tell the planner which goal to
// chase harder when there's a tradeoff between two of them.

function GoalWeightSlider({
  goalId,
  value,
  label,
}: {
  goalId: string;
  value: number;
  label: string;
}) {
  const { mutate, pending, lastSavedTargetId } = useMutation();
  const [local, setLocal] = useState(value);
  const isPending = pending && lastSavedTargetId === goalId;

  const onCommit = useCallback(
    (next: number) => {
      void mutate({
        override_kind: "adjust_goal",
        target_id: goalId,
        value: { weight: next },
      });
    },
    [goalId, mutate],
  );

  return (
    <div className="mt-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {label}
        </span>
        <span className="font-mono text-xs tabular-nums text-gray-900">
          {local.toFixed(2)}
        </span>
        {isPending && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="mt-1 w-full"
        aria-label={`Goal weight (${label})`}
      />
    </div>
  );
}

// ── C3 — KG depth slider ────────────────────────────────────────────

function DepthSlider({ value }: { value: 1 | 2 | 3 }) {
  const { mutate, pending, lastSavedTargetId } = useMutation();
  const isPending = pending && lastSavedTargetId === "kg_depth";

  const onSelect = useCallback(
    (next: 1 | 2 | 3) => {
      void mutate({
        override_kind: "toggle_plan_item",
        target_id: "kg_depth",
        value: { depth: next },
      });
    },
    [mutate],
  );

  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex gap-1">
        {[1, 2, 3].map((d) => (
          <button
            key={d}
            onClick={() => onSelect(d as 1 | 2 | 3)}
            disabled={isPending}
            className={`flex-1 rounded border px-2 py-1 text-[10px] font-bold transition-colors ${
              value === d
                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="text-[9px] leading-tight text-gray-500">
        {value === 1 && "no mechanism intermediates — direct edges only"}
        {value === 2 && "one mechanism step per edge"}
        {value === 3 && "full mechanism chains (e.g., exercise → lactate → BDNF)"}
      </div>
    </div>
  );
}

// ── C1 — Variable role reassignment menu ────────────────────────────

const ROLE_REASSIGN_OPTIONS: Array<{ role: string; label: string }> = [
  { role: "independent", label: "Independent (you manipulate)" },
  { role: "dependent", label: "Dependent (you measure)" },
  { role: "controlled", label: "Control (held constant)" },
  { role: "confounding", label: "Confounder (adjust for)" },
  { role: "mediator", label: "Mediator (on the path)" },
  { role: "modifier", label: "Moderator (effect-modifier)" },
];

function VariableEntryCard({ entry }: { entry: VariableEntry }) {
  const { mutate, pending, lastSavedTargetId } = useMutation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isPending = pending && lastSavedTargetId === entry.entity_id;

  const onReassign = useCallback(
    (role: string) => {
      setMenuOpen(false);
      void mutate({
        override_kind: "reclassify_variable",
        target_id: entry.entity_id,
        value: { role },
      });
    },
    [entry.entity_id, mutate],
  );

  return (
    <div className="relative rounded border border-white/60 bg-white px-2 py-1.5">
      <div className="flex items-start justify-between gap-1">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 cursor-pointer text-left"
          title={expanded ? "Hide details" : "Show evidence"}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-gray-900">
              {entry.name}
            </span>
            {entry.observability === "latent" && (
              <span
                className="rounded bg-purple-100 px-1 text-[8.5px] font-bold uppercase tracking-wide text-purple-700"
                title="Latent — not directly observable"
              >
                latent
              </span>
            )}
            {entry.observability === "inferable_via_proxy" && (
              <span
                className="rounded bg-blue-100 px-1 text-[8.5px] font-bold uppercase tracking-wide text-blue-700"
                title="Inferred from a proxy measurement"
              >
                proxy
              </span>
            )}
          </div>
          {entry.current_value && (
            <div className="text-[9.5px] tabular-nums text-gray-500">
              current: {entry.current_value}
              {entry.unit ? ` ${entry.unit}` : ""}
            </div>
          )}
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          disabled={isPending}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
          aria-label="Reassign role"
          title="Reassign role"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <MoreVertical className="h-3 w-3" />
          )}
        </button>
      </div>

      {expanded && (
        <RationaleBlock
          source={entry.rationale.source}
          sourceQuote={entry.rationale.source_quote}
          confidence={entry.rationale.confidence}
          reason={entry.rationale.reason}
          evidenceIds={entry.rationale.evidence_ids}
          extras={
            entry.layer
              ? [{ label: "Layer", value: entry.layer }]
              : []
          }
        />
      )}

      {menuOpen && (
        <div className="absolute right-1 top-full z-10 mt-1 w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          <div className="px-2 pb-1 pt-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">
            Move to role
          </div>
          {ROLE_REASSIGN_OPTIONS.map((opt) => (
            <button
              key={opt.role}
              onClick={() => onReassign(opt.role)}
              className="flex w-full items-center justify-start px-2 py-1 text-left text-[10.5px] text-gray-700 hover:bg-gray-50"
            >
              {opt.label}
            </button>
          ))}
          <div className="my-0.5 border-t border-gray-100" />
          <button
            onClick={() => setMenuOpen(false)}
            className="block w-full px-2 py-1 text-left text-[10px] text-gray-400 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── C4 — Condition confirm card ─────────────────────────────────────

function ConditionCard({
  condition,
}: {
  condition: PreflightView["initial_state"]["conditions"][number];
}) {
  const { mutate, pending, lastSavedTargetId } = useMutation();
  const [expanded, setExpanded] = useState(false);
  const isPending = pending && lastSavedTargetId === condition.key;
  const isUserOverride = condition.source === "user_override";

  const onConfirm = useCallback(() => {
    void mutate({
      override_kind: "set_condition",
      target_id: condition.key,
      value: { value: condition.value, confirmed: true },
    });
  }, [condition.key, condition.value, mutate]);

  return (
    <li className="rounded border border-gray-100 bg-white px-2 py-1.5 text-[11px]">
      <div className="flex items-baseline justify-between">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 cursor-pointer truncate text-left"
          title={expanded ? "Hide details" : "Show calibration details"}
        >
          <span className="font-semibold text-gray-900">{condition.label}</span>
          <span className="ml-1.5 font-mono text-gray-500 tabular-nums">
            {condition.value === null ? "—" : String(condition.value)}
          </span>
        </button>
        <div className="flex flex-shrink-0 items-center gap-1">
          {condition.is_calibrated ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
          ) : (
            <span className="text-[9px] text-amber-700">uncalibrated</span>
          )}
          {isUserOverride ? (
            <span
              className="rounded bg-emerald-100 px-1 text-[8.5px] font-bold uppercase tracking-wide text-emerald-700"
              title="You confirmed this value"
            >
              ✓
            </span>
          ) : (
            <button
              onClick={onConfirm}
              disabled={isPending}
              className="rounded border border-gray-200 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500 hover:border-gray-400 hover:text-gray-700 disabled:opacity-50"
              title="Confirm this value is correct for your situation"
            >
              {isPending ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                "confirm"
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-[9.5px] leading-snug">
          <div className="text-gray-700">
            <span className="font-semibold text-gray-500">Source:</span>{" "}
            {condition.source === "prompt"
              ? "extracted from your prompt"
              : condition.source === "template_default"
                ? "template default value"
                : "user override"}
          </div>
          {condition.source_quote && (
            <div className="border-l-2 border-gray-200 pl-2 italic text-gray-500">
              &ldquo;{condition.source_quote}&rdquo;
            </div>
          )}
          <div className="text-gray-700">
            <span className="font-semibold text-gray-500">Calibration:</span>{" "}
            {condition.is_calibrated
              ? `${condition.modulator_count} literature-validated modulator${condition.modulator_count === 1 ? "" : "s"} adjust edge strengths for this condition`
              : "no published modulator for this condition — predictions use the population-average effect"}
          </div>
          {!condition.is_calibrated && (
            <div className="text-amber-800">
              ⚠ this condition&apos;s effect on your outcomes may be over- or
              under-stated relative to a calibrated user.
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── Helper ──────────────────────────────────────────────────────────

function recomputeDownstream(
  preflight: PreflightView,
  optIns: Record<string, boolean>,
): {
  estimated_total_seconds: number;
  estimated_total_cost_usd: number;
  estimated_entities_added: number;
  estimated_edges_added: number;
} {
  let seconds = 0;
  let cost = 0;
  let entities = 0;
  let edges = 0;

  const accumulate = (item: PlanItem, enabled: boolean) => {
    if (!enabled) return;
    seconds += item.estimated_seconds;
    cost += item.estimated_cost_usd;
    for (const a of item.estimated_artifacts) {
      if (a.kind === "entity") entities += a.count;
      if (a.kind === "edge") edges += a.count;
    }
  };

  for (const w of preflight.downstream.will_generate) {
    const enabled = w.toggleable ? (optIns[w.id] ?? w.default_enabled) : w.default_enabled;
    accumulate(w, enabled);
  }
  for (const c of preflight.downstream.could_generate) {
    const enabled = optIns[c.id] ?? false;
    accumulate(c, enabled);
  }

  return {
    estimated_total_seconds: Math.round(seconds),
    estimated_total_cost_usd: Math.round(cost * 100) / 100,
    estimated_entities_added: entities,
    estimated_edges_added: edges,
  };
}
