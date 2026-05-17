"use client";

// ── KG Plan Review Card ──────────────────────────────────────────
//
// Modal-style card surfaced on the whiteboard when a kg_generation_plan
// is in 'proposed' or 'edited' state. Blocking gate: pipeline doesn't
// run downstream stages until the user approves (or rejects).
//
// Sections (collapsible, mode-aware):
//   - Header: mode + planner confidence + cost estimate
//   - Scope & objectives
//   - Layer ontology (with per-layer cards)
//   - Custom axes
//   - Conceptual skeleton (preview)
//   - Research plan (per-paper)
//   - Methodology disclosure (researcher mode only)
//   - Limitations
//
// Edits go through PATCH /api/spaces/[id]/kg-plans/[planId] which
// updates the plan + appends an audit row. For v1 the editor is a
// raw JSON textarea per section (researcher-friendly); future
// versions ship nicer per-field UIs.
//
// Footer:
//   [Reject]                           [Re-plan]  [Approve]

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  X,
  RefreshCw,
  Lightbulb,
  AlertTriangle,
  Layers,
  Layers3,
  Compass,
  FlaskConical,
  FileText,
  ShieldCheck,
  ClipboardList,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KgRoomIcon } from "@/components/canvas/icons";
import type {
  KgGenerationPlan,
  KgPlanMode,
  KgPlanSection,
} from "@/types/kg-generation-plan";

interface KgPlanReviewCardProps {
  plan: KgGenerationPlan;
  spaceId: string;
  onApproved: (plan: KgGenerationPlan) => void;
  onRejected: () => void;
  onReplan: () => void;
}

export function KgPlanReviewCard({
  plan,
  spaceId,
  onApproved,
  onRejected,
  onReplan,
}: KgPlanReviewCardProps) {
  const [localPlan, setLocalPlan] = useState<KgGenerationPlan>(plan);
  const [busy, setBusy] = useState<"approve" | "reject" | "replan" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = useCallback(async () => {
    setBusy("approve");
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/kg-plans/${localPlan.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { plan: KgGenerationPlan };
      onApproved(j.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }, [spaceId, localPlan.id, onApproved]);

  const handleReject = useCallback(async () => {
    setBusy("reject");
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/kg-plans/${localPlan.id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      onRejected();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }, [spaceId, localPlan.id, onRejected]);

  const handleSectionEdit = useCallback(
    async (section: KgPlanSection, value: unknown, reason?: string) => {
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/kg-plans/${localPlan.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ section, value, reason }),
          },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const j = (await res.json()) as { plan: KgGenerationPlan };
        setLocalPlan(j.plan);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [spaceId, localPlan.id],
  );

  const isResearcherMode = localPlan.mode === "researcher";
  const isClinicianMode = localPlan.mode === "clinician";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-[min(960px,94vw)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        {/* ── Header ── */}
        <PlanHeader plan={localPlan} />

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Sprint W2.3 — upstream framing CTA.
              The KG plan is conceptually downstream of the problem framing:
              "what KG to build" comes after "what problem are we solving."
              The framing lives in twin_proposals(kind='problem_twin'), NOT
              in kg_generation_plans, so it's not a PATCH section here. We
              surface a link to the dedicated /framing gate page so users
              can review / re-pick before approving this plan. The link
              degrades cleanly: if the user never opened a framing (legacy
              spaces with no problem_twin row), the gate page itself shows
              a guidance state. Subtle styling — this is a "by the way"
              affordance, not a primary action. */}
          <FramingReviewCta spaceId={spaceId} />

          <PlanSection
            title="Scope & objectives"
            icon={<Compass className="h-3.5 w-3.5" />}
            section="scope_and_objectives"
            value={localPlan.scope_and_objectives}
            onEdit={handleSectionEdit}
            defaultOpen
          />
          <PlanSection
            title="Layer ontology"
            icon={<Layers className="h-3.5 w-3.5" />}
            section="layer_ontology_proposal"
            value={localPlan.layer_ontology_proposal}
            onEdit={handleSectionEdit}
            defaultOpen
            renderPreview={renderLayerOntologyPreview}
          />
          <PlanSection
            title="Custom axes"
            icon={<Layers3 className="h-3.5 w-3.5" />}
            section="axis_proposals"
            value={localPlan.axis_proposals}
            onEdit={handleSectionEdit}
            renderPreview={renderAxesPreview}
          />
          <PlanSection
            title="Conceptual skeleton"
            icon={<FlaskConical className="h-3.5 w-3.5" />}
            section="conceptual_skeleton"
            value={localPlan.conceptual_skeleton}
            onEdit={handleSectionEdit}
            renderPreview={renderSkeletonPreview}
          />
          <PlanSection
            title={
              localPlan.research_plan?.papers.length
                ? `Research plan · ${localPlan.research_plan.papers.length} papers`
                : "Research plan · no papers"
            }
            icon={<FileText className="h-3.5 w-3.5" />}
            section="research_plan"
            value={localPlan.research_plan}
            onEdit={handleSectionEdit}
            renderPreview={renderResearchPlanPreview}
          />
          {(isResearcherMode || isClinicianMode) && (
            <PlanSection
              title="Methodology disclosure"
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              section="methodology_disclosure"
              value={localPlan.methodology_disclosure}
              onEdit={handleSectionEdit}
              renderPreview={renderMethodologyPreview}
            />
          )}
          <PlanSection
            title="Limitations"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            section="limitations"
            value={localPlan.limitations}
            onEdit={handleSectionEdit}
            renderPreview={renderLimitationsPreview}
          />
          {isResearcherMode && (
            <PlanSection
              title="Reasoning settings"
              icon={<ClipboardList className="h-3.5 w-3.5" />}
              section="reasoning_settings_proposed"
              value={localPlan.reasoning_settings_proposed}
              onEdit={handleSectionEdit}
            />
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="border-t border-red-100 bg-red-50 px-6 py-2 text-[12px] text-red-700">
            {error}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-3">
          <button
            onClick={handleReject}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "reject" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Reject
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setBusy("replan");
                onReplan();
              }}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "replan" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Re-plan
            </button>
            <button
              onClick={handleApprove}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "approve" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Approve plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────

function PlanHeader({ plan }: { plan: KgGenerationPlan }) {
  const conf = plan.planner_confidence ?? 0;
  const confColor =
    conf >= 0.7 ? "text-green-700" : conf >= 0.4 ? "text-amber-700" : "text-red-700";
  const cost = plan.cost_estimate;
  return (
    <div className="border-b border-gray-200 px-6 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
            <KgRoomIcon size={12} style={{ color: "#2563eb" }} />
            KG Generation Plan · v{plan.version} · {plan.mode}
          </div>
          <h2 className="mt-1 truncate text-[18px] font-semibold tracking-tight text-gray-900">
            {plan.scope_and_objectives?.goal_parsed.primary_objective ??
              "Plan ready for review"}
          </h2>
          <div className="mt-1 line-clamp-2 text-[12px] text-gray-500">
            {plan.scope_and_objectives?.goal_verbatim}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <div
            className={cn(
              "rounded-md bg-gray-50 px-2 py-1 text-[10.5px] font-semibold",
              confColor,
            )}
          >
            Planner conf · {(conf * 100).toFixed(0)}%
          </div>
          {cost && (
            <div className="text-[10.5px] text-gray-500">
              ~{cost.tokens_estimate.toLocaleString()} tok ·{" "}
              ~{cost.wall_clock_seconds_estimate}s ·{" "}
              ~{cost.credits_estimate} credits
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────

interface PlanSectionProps {
  title: string;
  icon: React.ReactNode;
  section: KgPlanSection;
  value: unknown;
  onEdit: (section: KgPlanSection, value: unknown, reason?: string) => Promise<boolean>;
  defaultOpen?: boolean;
  renderPreview?: (value: unknown) => React.ReactNode;
}

function PlanSection({
  title,
  icon,
  section,
  value,
  onEdit,
  defaultOpen = false,
  renderPreview,
}: PlanSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = useCallback(() => {
    setDraft(JSON.stringify(value, null, 2));
    setReason("");
    setEditing(true);
  }, [value]);

  const saveEdit = useCallback(async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(draft);
      const ok = await onEdit(section, parsed, reason || undefined);
      if (ok) setEditing(false);
    } catch (e) {
      alert(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [draft, reason, onEdit, section]);

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-gray-200">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 bg-gray-50 px-4 py-2.5 text-left transition-colors hover:bg-gray-100"
      >
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-gray-800">
          {icon}
          {title}
        </div>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="bg-white px-4 py-3">
          {editing ? (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-64 w-full resize-y rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[11.5px] text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
                spellCheck={false}
              />
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for edit (optional, captured in audit log)"
                className="mt-2 w-full rounded-md border border-gray-200 px-3 py-1.5 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save edit
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              {renderPreview ? (
                renderPreview(value)
              ) : (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-700">
                  {JSON.stringify(value, null, 2) || "(empty)"}
                </pre>
              )}
              <button
                onClick={startEdit}
                className="mt-2 flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-800"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Per-section pretty previews ─────────────────────────────────

function renderLayerOntologyPreview(value: unknown): React.ReactNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = value as any;
  if (!v?.layers) return <p className="text-[12px] text-gray-500">No ontology yet.</p>;
  return (
    <div>
      <div className="mb-2 text-[10.5px] uppercase tracking-wider text-gray-500">
        Source: {v.ontology_source}
        {v.source_metadata?.starter_slug ? ` · ${v.source_metadata.starter_slug}` : ""}
      </div>
      <div className="space-y-1.5">
        {v.layers.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (l: any, i: number) => (
            <div
              key={i}
              className="flex items-start gap-2.5 rounded-md border border-gray-100 bg-gray-50/50 px-3 py-2"
            >
              <div
                className="mt-0.5 h-3 w-3 flex-shrink-0 rounded-full"
                style={{ backgroundColor: l.color || "#9CA3AF" }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <div className="text-[12px] font-semibold text-gray-900">
                    {l.ordinal}. {l.label}
                  </div>
                  <div className="text-[10px] text-gray-400">{l.slug}</div>
                </div>
                <div className="mt-0.5 text-[11.5px] text-gray-600">
                  {l.description}
                </div>
                {l.why_included && (
                  <div className="mt-1 text-[11px] italic text-gray-500">
                    Why: {l.why_included}
                  </div>
                )}
                {Array.isArray(l.example_nodes) && l.example_nodes.length > 0 && (
                  <div className="mt-1 text-[10.5px] text-gray-500">
                    e.g. {l.example_nodes.slice(0, 4).join(", ")}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function renderAxesPreview(value: unknown): React.ReactNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = value as any;
  if (!v?.axes) return <p className="text-[12px] text-gray-500">No axes yet.</p>;
  return (
    <div className="space-y-1.5">
      {v.axes.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any, i: number) => (
          <div key={i} className="rounded-md border border-gray-100 bg-gray-50/50 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[12px] font-semibold text-gray-900">{a.name}</div>
              <div className="text-[10px] text-gray-400">
                ~{a.estimated_token_cost} tok
              </div>
            </div>
            <div className="mt-0.5 text-[11.5px] text-gray-600">{a.definition}</div>
            <div className="mt-1 text-[11px] italic text-gray-500">{a.rationale}</div>
          </div>
        ),
      )}
    </div>
  );
}

function renderSkeletonPreview(value: unknown): React.ReactNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = value as any;
  if (!v) return null;
  return (
    <div>
      <div className="mb-2 grid grid-cols-4 gap-2 text-center">
        <Stat label="Nodes" value={v.estimated_total_nodes} />
        <Stat label="Edges" value={v.estimated_total_edges} />
        <Stat label="Cycles" value={v.estimated_cycles} />
        <Stat label="Communities" value={v.estimated_communities} />
      </div>
      {Array.isArray(v.anticipated_clusters) && v.anticipated_clusters.length > 0 && (
        <div className="space-y-1">
          {v.anticipated_clusters.map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (c: any, i: number) => (
              <div key={i} className="text-[11.5px] text-gray-700">
                <span className="font-semibold">{c.label}</span>{" "}
                <span className="text-gray-400">[{c.layer_slug}]</span>
                <span className="ml-1 text-gray-500">
                  · ~{c.expected_node_count} nodes
                </span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function renderResearchPlanPreview(value: unknown): React.ReactNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = value as any;
  if (!v) return null;
  return (
    <div>
      {v.papers?.length > 0 ? (
        <div className="space-y-1.5">
          {v.papers.map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (p: any, i: number) => (
              <div key={i} className="rounded-md border border-gray-100 bg-gray-50/50 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[12px] font-semibold text-gray-900">
                    {i + 1}. {p.title}
                  </div>
                  {p.flagged_for_manual_review && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-amber-700">
                      manual review
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-gray-600">
                  Expected ~{p.expected_effect_size_count} effect sizes ·{" "}
                  {p.extractable_with_current_parsers
                    ? "extractable"
                    : "needs new parser"}
                </div>
                {p.parser_match_reasoning && (
                  <div className="mt-1 text-[11px] italic text-gray-500">
                    {p.parser_match_reasoning}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      ) : (
        <p className="text-[12px] text-gray-500">No papers attached.</p>
      )}
      {v.coverage_gaps?.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
            Coverage gaps
          </div>
          <div className="space-y-1">
            {v.coverage_gaps.map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (g: any, i: number) => (
                <div key={i} className="text-[11.5px] text-amber-700">
                  · {g.layer_slug} × {g.axis_slug} — {g.why_uncovered}
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function renderMethodologyPreview(value: unknown): React.ReactNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = value as any;
  if (!v) return null;
  return (
    <div className="space-y-2 text-[11.5px] text-gray-700">
      {v.trust_boundary_explanation && (
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
            Trust boundary
          </div>
          <p className="mt-0.5">{v.trust_boundary_explanation}</p>
        </div>
      )}
      {Array.isArray(v.active_parsers) && v.active_parsers.length > 0 && (
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
            Active parsers
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {v.active_parsers.map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (p: any, i: number) => (
                <li key={i}>
                  <span className="font-mono text-[11px]">
                    {p.module}@{p.version}
                  </span>
                  <span className="ml-1 text-gray-500">
                    · handles: {p.handles_metrics?.join(", ")}
                  </span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
      {v.heterogeneity_handling && (
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
            Heterogeneity handling
          </div>
          <p className="mt-0.5">
            Pooling: {v.heterogeneity_handling.pooling_method} · τ²:{" "}
            {v.heterogeneity_handling.tau_squared_estimator}
          </p>
        </div>
      )}
    </div>
  );
}

function renderLimitationsPreview(value: unknown): React.ReactNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = value as any;
  if (!v) return null;
  const items: Array<{ label: string; rows: string[] }> = [
    { label: "Won't be extractable", rows: v.what_wont_be_extractable ?? [] },
    { label: "Coverage gaps", rows: v.coverage_gaps_acknowledged ?? [] },
    { label: "Weak parsers", rows: v.known_weak_parsers ?? [] },
    { label: "Planner uncertainties", rows: v.planner_uncertainties ?? [] },
  ];
  return (
    <div className="space-y-2">
      {items.map(
        (i) =>
          i.rows.length > 0 && (
            <div key={i.label}>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
                {i.label}
              </div>
              <ul className="mt-0.5 list-disc pl-5 text-[11.5px] text-gray-700">
                {i.rows.map((r, j) => (
                  <li key={j}>{r}</li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-gray-100 bg-white px-2 py-1.5">
      <div className="text-[16px] font-semibold tabular-nums text-gray-900">
        {value ?? 0}
      </div>
      <div className="text-[9.5px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
    </div>
  );
}

// ── Sprint W2.3 — Upstream framing review CTA ────────────────────────
//
// Lightweight banner at the top of the plan-review modal that links
// the user to the framing gate page (/app/space/[id]/framing). The
// problem framing is conceptually upstream of the KG plan, so the
// user should be able to glance "what problem we picked" — and re-
// pick before approving the plan if needed.
//
// Why fetch the framing here instead of just rendering a static
// link: the preview is meaningful (chosen approach + candidate count
// gives the user the context they need without leaving the modal).
// Without it, the link would be opaque ("Review framings →" with no
// indication of WHAT they'd be reviewing).
//
// Soft-fail: if the fetch errors or no problem_twin exists yet, we
// render a generic "Review the upstream problem framing" link that
// still works (the gate page handles the no-row case). The fetch
// inflight state shows a subtle skeleton; we don't block the modal
// on this completing.
//
// API: GET /api/spaces/[id]/twin-proposals/latest?kind=problem_twin
// — added below as a sibling change. Returns null when no row.

interface FramingCtaState {
  loaded: boolean;
  chosenApproach: string | null;
  optionCount: number;
  userStatus: string | null;
}

function FramingReviewCta({ spaceId }: { spaceId: string }) {
  const [state, setState] = useState<FramingCtaState>({
    loaded: false,
    chosenApproach: null,
    optionCount: 0,
    userStatus: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/twin-proposals/latest?kind=problem_twin`,
          { credentials: "include" },
        );
        if (!res.ok) {
          // 404 = no row yet; treat as "loaded with no framing."
          if (!cancelled) {
            setState({
              loaded: true,
              chosenApproach: null,
              optionCount: 0,
              userStatus: null,
            });
          }
          return;
        }
        const data = (await res.json()) as {
          proposal: {
            user_status: string;
            frame_payload: {
              options: Array<{ chosen_approach: string }>;
              chosen_rank: number;
            } | null;
          } | null;
        };
        if (cancelled) return;
        if (!data.proposal || !data.proposal.frame_payload) {
          setState({
            loaded: true,
            chosenApproach: null,
            optionCount: 0,
            userStatus: null,
          });
          return;
        }
        const payload = data.proposal.frame_payload;
        const idx = Math.max(0, (payload.chosen_rank ?? 1) - 1);
        const chosen = payload.options[idx];
        setState({
          loaded: true,
          chosenApproach: chosen?.chosen_approach ?? null,
          optionCount: payload.options.length,
          userStatus: data.proposal.user_status,
        });
      } catch {
        if (!cancelled) {
          setState({
            loaded: true,
            chosenApproach: null,
            optionCount: 0,
            userStatus: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const hasDivergence = state.optionCount > 1;
  const hasFraming = state.chosenApproach !== null;

  return (
    <div className="mb-4 rounded-lg border border-indigo-100 bg-gradient-to-r from-indigo-50/60 to-violet-50/60 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />
        <div className="flex-1 text-[11.5px] leading-snug">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-indigo-900">
              Upstream problem framing
            </span>
            {hasDivergence && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800">
                {state.optionCount} candidates
              </span>
            )}
            {state.userStatus === "approved" && (
              <span className="text-[9.5px] text-emerald-700">· approved</span>
            )}
            {state.userStatus === "proposed" && (
              <span className="text-[9.5px] text-amber-700">
                · awaiting confirm
              </span>
            )}
          </div>
          {!state.loaded ? (
            <div className="mt-1 h-3 w-2/3 animate-pulse rounded bg-indigo-100/60" />
          ) : hasFraming ? (
            <div className="mt-0.5 line-clamp-2 text-indigo-800">
              {state.chosenApproach}
            </div>
          ) : (
            <div className="mt-0.5 text-indigo-700/70">
              Review the framing the system picked for your problem
              {hasDivergence ? " — or pick a different candidate." : "."}
            </div>
          )}
        </div>
        <Link
          href={`/app/space/${encodeURIComponent(spaceId)}/framing`}
          className="ml-1 flex shrink-0 items-center gap-1 rounded-md border border-indigo-300 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-50"
        >
          {state.userStatus === "proposed" ? "Review & confirm" : "Review"}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
