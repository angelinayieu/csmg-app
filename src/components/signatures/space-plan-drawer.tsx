"use client";

// ── SpacePlanDrawer — surfaces the strategizer's decisions ────────────
//
// The strategizer is rigorous. The strategizer is invisible. This
// component is the smallest surface that makes the rigor legible: a
// drawer that, given a SpacePlan row from /api/pipeline/space-strategizer,
// shows the user every selected item, every skipped candidate, and the
// audit trail behind both. Without this, all that rigor is just SQL.
//
// Design grammar matches NodeSignatureDetail — same framer-motion slide,
// same EASE constant, same section-header style — so the two drawers
// feel like one product, not two.
//
// Intentionally stateless. Consumer owns open/closed + which plan is
// loaded. We just render what we're given. A "loading" plan === null
// is displayed as a placeholder so callers can mount the drawer before
// the fetch resolves.

import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type {
  SpacePlan,
  SelectedWorkItem,
  SkipReason,
  SpaceWorkKind,
  SignalProfile,
} from "@/types/space-plan";
import { useKGHighlight } from "@/components/layout/kg-highlight-context";

// Queue summary shape — mirrors QueueSummary from
// src/lib/pipeline/space-work-queue.ts. Kept inline to avoid pulling a
// server-only module into a "use client" component. If the shape drifts,
// the JSON from GET /api/pipeline/space-executor will simply under- or
// over-render; no runtime failure.
export interface QueueSummary {
  space_id: string;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  /** Freshest 3 completed items (most recent first). Each carries the
   *  executor's outcome_summary so the drawer can show "what just landed"
   *  underneath the count chips. Defaults to [] when omitted by the API
   *  (older deploys) so render code can iterate without null-checks. */
  recent_completions?: Array<{
    id: string;
    candidate_id: string;
    kind: SpaceWorkKind;
    outcome_summary: string | null;
    completed_at: string | null;
  }>;
}

const EASE = [0.22, 1, 0.36, 1] as const;

// Kind badges — color + label per work kind. Same accent system the
// strategizer's diversity_profile leans on, so the drawer reads as a
// faithful render of what the planner actually committed to.
const KIND_LABEL: Record<SpaceWorkKind, string> = {
  axis: "Axis space",
  edge_space: "Edge space",
  convergent_point: "Convergent point",
  signature_deepen: "Deepen signature",
  intersection_probe: "Intersection probe",
  intervention_combination: "Lever combination",
};

const KIND_COLOR: Record<SpaceWorkKind, string> = {
  axis: "#0ea5e9", // sky
  edge_space: "#10b981", // emerald
  convergent_point: "#f59e0b", // amber
  signature_deepen: "#a855f7", // violet
  intersection_probe: "#ec4899", // pink
  intervention_combination: "#f97316", // orange — distinct from intersection_probe pink
};

// Skip-reason → human label. The audit trail's whole legibility hinges
// on this being clear and short.
const SKIP_LABEL: Record<SkipReason["reason"], string> = {
  out_of_budget: "Over budget",
  redundant_with_selected: "Redundant",
  goal_misaligned: "Off-goal",
  low_expected_yield: "Low yield",
  awaiting_upstream: "Blocked",
  insufficient_evidence: "Thin evidence",
  manifold_collision: "Same manifold",
};

// Insight-type → label, used in the per-item expected outcome line.
const INSIGHT_LABEL: Record<SelectedWorkItem["expected_insight_type"], string> = {
  leverage_point: "Leverage point",
  mechanism_clarity: "Mechanism clarity",
  intervention_target: "Intervention target",
  risk_disclosure: "Risk disclosure",
  cross_domain_bridge: "Cross-domain bridge",
  uncertainty_reduction: "Uncertainty reduction",
  goal_alignment: "Goal alignment",
};

// Signal-profile → human label for the per-item signal strip. Order
// preserved so the drawer always shows signals in the same sequence.
// Outcome alignment + user-controllable lever live near the top because
// they are the most user-actionable signals (Phase 3 §4.3 + Phase 4
// reframed the planner around them) — leading with them tells the
// reader "this candidate matters because it touches your goal" before
// drowning them in structural signals.
const SIGNAL_ORDER: Array<{ key: keyof SignalProfile; label: string }> = [
  { key: "outcome_alignment", label: "Outcome alignment" },
  { key: "user_controllable_lever", label: "User lever" },
  { key: "coverage_gap", label: "Coverage gap" },
  { key: "goal_proximity", label: "Goal proximity" },
  { key: "convergence_count", label: "Convergence" },
  { key: "agent_convergence_count", label: "Agent convergence" },
  { key: "causal_depth_normalized", label: "Causal depth" },
  { key: "centrality", label: "Centrality" },
  { key: "intersection_density", label: "Intersection density" },
  { key: "uncertainty", label: "Uncertainty" },
  { key: "layer_crossing", label: "Layer crossing" },
  { key: "novelty", label: "Novelty" },
  { key: "controllability_spread", label: "Controllability spread" },
  { key: "axis_calibration", label: "Axis calibration" },
];

// ── Combination result shape (lite) ──────────────────────────────────
//
// The plan drawer renders a "Joint analysis" mini-card under each
// selected `intervention_combination` item when the executor has
// completed it (i.e. a row exists in space_combination_results). The
// page is responsible for fetching these and passing the keyed map.
// Keeps the drawer presentation-only.
export interface CombinationResultLite {
  candidate_id: string;
  entity_a_name: string | null;
  entity_b_name: string | null;
  title: string;
  novelty: "emergent" | "reinforcing" | "tension" | "trivial";
  implication: string;
  mechanism: string;
  probes: string[];
}

const NOVELTY_PALETTE: Record<CombinationResultLite["novelty"], { bg: string; fg: string; border: string; label: string }> = {
  emergent: { bg: "#ecfeff", fg: "#0e7490", border: "#a5f3fc", label: "Emergent" },
  reinforcing: { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0", label: "Reinforcing" },
  tension: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca", label: "Tension" },
  trivial: { bg: "#f9fafb", fg: "#6b7280", border: "#e5e7eb", label: "Trivial" },
};

export interface SpacePlanDrawerProps {
  open: boolean;
  onClose: () => void;
  /** When null while open=true, drawer renders the empty state (if
   *  onGenerate is provided) or the loading placeholder (if loading). */
  plan: SpacePlan | null;
  /** True while the latest-plan GET is in flight. Mutually distinct
   *  from `generating` — loading is passive, generating is active. */
  loading?: boolean;
  /** When fetch fails, callers pass the error message; takes precedence
   *  over plan being null. */
  error?: string | null;
  /** Optional: if provided, the empty state and the header expose a
   *  "Generate plan" / "Regenerate" action that calls this. Without it
   *  the drawer is purely read-only. */
  onGenerate?: () => void | Promise<void>;
  /** True while a generate POST is in flight. Disables the button and
   *  shows a planner-thinking placeholder. */
  generating?: boolean;
  /** Executor queue summary for this space. When provided, rendered as
   *  a status strip below the header — makes the drain cron's work
   *  visible in the UI. Null = not yet fetched; undefined = caller
   *  doesn't want the strip to appear. */
  queueSummary?: QueueSummary | null;
  /** Phase 4 §5.3 — entity name lookup for decoding `combo:{a}+{b}`
   *  candidate ids into "{nameA} × {nameB}". When omitted, combo items
   *  render the raw uuids (current behavior). The page is responsible
   *  for assembling this map; the drawer stays purely presentational. */
  entityNamesById?: Record<string, string>;
  /** Phase 4 §5.3 — completed combination interpretations keyed on
   *  candidate_id. When present for a selected `intervention_combination`
   *  item, the drawer renders an inline "Joint analysis" card with the
   *  LLM's title, novelty badge, and implication. Items without a
   *  matching entry render the bare selection card (executor hasn't
   *  drained yet). */
  combinationResultsByCandidateId?: Record<string, CombinationResultLite>;
}

export function SpacePlanDrawer({
  open,
  onClose,
  plan,
  loading,
  error,
  onGenerate,
  generating,
  queueSummary,
  entityNamesById,
  combinationResultsByCandidateId,
}: SpacePlanDrawerProps) {
  // ── KG mini-map highlight ──────────────────────────────────────────
  // While the drawer is open AND a plan is loaded, push the union of
  // entity-ids that the planner's selected items reference to the
  // mini-map's highlight context. This lets the user see "the rail's
  // lit nodes are the ones the planner is about to spend tokens on"
  // without needing to read every candidate_id by hand.
  //
  // Stack-based context: pushing under "plan-drawer" overlays the
  // app-level "app-detail" highlight while the drawer is open;
  // closing pops back to whatever was underneath. So a user moving
  // between an app and its plan drawer never loses context.
  const { setHighlight, clearHighlight } = useKGHighlight();
  const highlightIds = useMemo(() => {
    if (!plan) return null;
    return collectEntityIdsFromSelected(plan.selected ?? []);
  }, [plan]);
  useEffect(() => {
    if (!open || !highlightIds || highlightIds.size === 0) {
      clearHighlight("plan-drawer");
      return;
    }
    setHighlight("plan-drawer", {
      ids: highlightIds,
      reason: `Plan · ${highlightIds.size} ${highlightIds.size === 1 ? "entity" : "entities"} in scope`,
    });
    return () => clearHighlight("plan-drawer");
  }, [open, highlightIds, setHighlight, clearHighlight]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="space-plan-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              zIndex: 50,
            }}
          />
          <motion.aside
            key="space-plan-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.35, ease: EASE }}
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "min(620px, 95vw)",
              background: "#ffffff",
              boxShadow: "-12px 0 32px rgba(0,0,0,0.12)",
              zIndex: 51,
              overflowY: "auto",
              padding: "28px 32px 60px",
            }}
            role="dialog"
            aria-label="Space strategizer plan"
          >
            <DrawerHeader
              plan={plan}
              onClose={onClose}
              onGenerate={onGenerate}
              generating={generating === true}
            />
            {queueSummary && queueSummary.total > 0 ? (
              <QueueStatusStrip summary={queueSummary} />
            ) : null}
            {generating ? (
              <GeneratingBlock />
            ) : error ? (
              <ErrorBlock message={error} onGenerate={onGenerate} generating={false} />
            ) : loading ? (
              <LoadingBlock />
            ) : !plan ? (
              <EmptyBlock onGenerate={onGenerate} />
            ) : (
              <>
                <RationaleBlock plan={plan} />
                {plan.horizon_context ? (
                  <HorizonBlock context={plan.horizon_context} />
                ) : null}
                <SelectedSection
                  items={plan.selected}
                  entityNamesById={entityNamesById}
                  combinationResultsByCandidateId={combinationResultsByCandidateId}
                />
                <SkippedSection items={plan.skipped} entityNamesById={entityNamesById} />
                <DiversityBlock plan={plan} />
                <StopConditionBlock plan={plan} />
                <ProvenanceBlock plan={plan} />
              </>
            )}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

// ── QueueStatusStrip ─────────────────────────────────────────────────
//
// Bridges the strategizer (what was planned) to the executor (what's
// actually running). Without this strip, users see the plan but have
// no feedback on whether the drain cron is keeping up. Ordering —
// pending → in_progress → completed → failed — mirrors the temporal
// flow so the eye reads left-to-right as "what's next → what's done".

function QueueStatusStrip({ summary }: { summary: QueueSummary }) {
  const chips: Array<{
    key: keyof QueueSummary;
    label: string;
    value: number;
    fg: string;
    bg: string;
    border: string;
  }> = [
    {
      key: "pending",
      label: "Pending",
      value: summary.pending,
      fg: "#854d0e",
      bg: "#fef3c7",
      border: "#fde68a",
    },
    {
      key: "in_progress",
      label: "Running",
      value: summary.in_progress,
      fg: "#1e40af",
      bg: "#dbeafe",
      border: "#bfdbfe",
    },
    {
      key: "completed",
      label: "Completed",
      value: summary.completed,
      fg: "#065f46",
      bg: "#d1fae5",
      border: "#a7f3d0",
    },
    {
      key: "failed",
      label: "Failed",
      value: summary.failed,
      fg: "#991b1b",
      bg: "#fee2e2",
      border: "#fecaca",
    },
  ];
  return (
    <section
      style={{
        marginBottom: 20,
        padding: "10px 12px",
        background: "#f9fafb",
        borderRadius: 8,
        border: "1px solid #e5e7eb",
      }}
      aria-label="Executor queue status"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "#6b7280",
          }}
        >
          Executor queue
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>
          {summary.total.toLocaleString()} total
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chips.map((c) => (
          <span
            key={c.key}
            title={`${c.label}: ${c.value}`}
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: 999,
              background: c.value > 0 ? c.bg : "#ffffff",
              color: c.value > 0 ? c.fg : "#9ca3af",
              border: `1px solid ${c.value > 0 ? c.border : "#e5e7eb"}`,
            }}
          >
            {c.label}{" "}
            <span style={{ fontWeight: 600 }}>{c.value}</span>
          </span>
        ))}
        {summary.cancelled > 0 ? (
          <span
            title={`Cancelled: ${summary.cancelled}`}
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#f3f4f6",
              color: "#6b7280",
              border: "1px solid #e5e7eb",
            }}
          >
            Cancelled{" "}
            <span style={{ fontWeight: 600 }}>{summary.cancelled}</span>
          </span>
        ) : null}
      </div>
      {summary.pending + summary.in_progress > 0 ? (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 11,
            color: "#6b7280",
            lineHeight: 1.4,
          }}
        >
          {summary.in_progress > 0
            ? `${summary.in_progress} item${summary.in_progress === 1 ? "" : "s"} running now. `
            : null}
          The drain cron sweeps every 10 minutes — or hit the executor
          endpoint manually to process immediately.
        </p>
      ) : null}
      {summary.recent_completions && summary.recent_completions.length > 0 ? (
        <RecentCompletionsList completions={summary.recent_completions} />
      ) : null}
    </section>
  );
}

// Renders the freshest 3 completed items inline under the count chips.
// Surfaces the executor's outcome_summary text — until this landed,
// rich text like "[EMERGENT] Pricing × Churn — joint analysis ..."
// got persisted on the queue row but never reached the user. Each
// row gets a kind-colored dot + a one-line outcome (truncated if the
// executor wrote something longer than the strip can hold).
function RecentCompletionsList({
  completions,
}: {
  completions: NonNullable<QueueSummary["recent_completions"]>;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "#9ca3af",
          marginBottom: 4,
        }}
      >
        Just landed
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {completions.map((c) => {
          const summaryText =
            c.outcome_summary && c.outcome_summary.length > 0
              ? c.outcome_summary
              : KIND_LABEL[c.kind];
          // FAILED: rows wear the failure color so the user can tell
          // them apart from real completions at a glance — same spot in
          // the list, but visually demoted.
          const failed = (c.outcome_summary ?? "").startsWith("FAILED:");
          return (
            <li
              key={c.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                fontSize: 11,
                lineHeight: 1.4,
                color: failed ? "#b91c1c" : "#374151",
              }}
              title={summaryText}
            >
              <span
                aria-hidden
                style={{
                  marginTop: 5,
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: failed ? "#dc2626" : KIND_COLOR[c.kind],
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }}
              >
                {summaryText}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DrawerHeader({
  plan,
  onClose,
  onGenerate,
  generating,
}: {
  plan: SpacePlan | null;
  onClose: () => void;
  onGenerate?: () => void | Promise<void>;
  generating: boolean;
}) {
  const usedTokens =
    plan?.selected.reduce((sum, s) => sum + (s.allocated_tokens ?? 0), 0) ?? 0;
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 20,
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#111827" }}>
          Strategy plan
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
          {plan
            ? `${formatTime(plan.generated_at)} — ${usedTokens.toLocaleString()} / ${plan.budget_tokens.toLocaleString()} tokens allocated`
            : generating
              ? "Generating…"
              : "—"}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Regenerate is header-level only when we ALREADY have a plan.
            Empty/error states expose a more prominent button inline so
            the affordance is impossible to miss. */}
        {onGenerate && plan ? (
          <button
            onClick={() => {
              void onGenerate();
            }}
            disabled={generating}
            aria-label="Regenerate plan"
            style={{
              background: "transparent",
              border: "1px solid #e5e7eb",
              color: generating ? "#9ca3af" : "#4338ca",
              fontSize: 12,
              fontWeight: 500,
              padding: "4px 10px",
              borderRadius: 6,
              cursor: generating ? "default" : "pointer",
            }}
          >
            {generating ? "Generating…" : "Regenerate"}
          </button>
        ) : null}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            fontSize: 22,
            color: "#6b7280",
            cursor: "pointer",
            padding: 4,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </header>
  );
}

// ── HorizonBlock ──────────────────────────────────────────────────────
//
// Surfaces the Phase 4 §5.1 horizon-aware weight modulation. Without
// this block, the user sees the ranker's weight snapshot but has no
// idea WHY weights shifted from default — they look at the
// "Provenance" expander and see e.g. user_controllable_lever weighted
// 0.18 instead of the calibrated 0.12 with no explanation. The
// horizon block answers "we biased toward immediate action because
// your goal said 'within the next two weeks.'"
//
// Renders the horizon (chip) + outcome direction (chip) + the
// applied multiplicative overrides (most-impactful first, with a
// human label per signal). Only shown when horizon_context is
// present (the strategizer omits it for medium_term / no-horizon
// plans where overrides would be a no-op).

const HORIZON_LABEL: Record<NonNullable<NonNullable<SpacePlan["horizon_context"]>["horizon"]>, string> = {
  immediate: "Immediate",
  short_term: "Short term",
  medium_term: "Medium term",
  long_term: "Long term",
};

const HORIZON_PALETTE: Record<NonNullable<NonNullable<SpacePlan["horizon_context"]>["horizon"]>, { bg: string; fg: string; border: string }> = {
  immediate: { bg: "#fef3c7", fg: "#92400e", border: "#fde68a" },
  short_term: { bg: "#dbeafe", fg: "#1e40af", border: "#bfdbfe" },
  medium_term: { bg: "#e0e7ff", fg: "#3730a3", border: "#c7d2fe" },
  long_term: { bg: "#ede9fe", fg: "#5b21b6", border: "#ddd6fe" },
};

const DIRECTION_LABEL: Record<NonNullable<NonNullable<SpacePlan["horizon_context"]>["outcome_direction"]>, string> = {
  maximize: "↑ Maximize",
  minimize: "↓ Minimize",
  maintain: "↔ Maintain",
};

const SIGNAL_HUMAN: Partial<Record<keyof SignalProfile, string>> = {
  outcome_alignment: "Outcome alignment",
  user_controllable_lever: "User lever",
  goal_proximity: "Goal proximity",
  causal_depth_normalized: "Causal depth",
  convergence_count: "Convergence",
  intersection_density: "Intersection density",
  novelty: "Novelty",
  coverage_gap: "Coverage gap",
  layer_crossing: "Layer crossing",
  centrality: "Centrality",
};

function HorizonBlock({ context }: { context: NonNullable<SpacePlan["horizon_context"]> }) {
  const horizonChip = context.horizon ? HORIZON_LABEL[context.horizon] : null;
  const horizonPal = context.horizon ? HORIZON_PALETTE[context.horizon] : null;
  const directionChip = context.outcome_direction ? DIRECTION_LABEL[context.outcome_direction] : null;
  const overrides = Object.entries(context.applied_overrides)
    .filter(([, v]) => typeof v === "number" && v > 0 && v !== 1)
    .sort((a, b) => Math.abs((b[1] as number) - 1) - Math.abs((a[1] as number) - 1));

  if (!horizonChip && !directionChip && overrides.length === 0) return null;

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionLabel>Horizon &amp; outcome bias</SectionLabel>
      <div
        style={{
          padding: 12,
          background: "#f9fafb",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: overrides.length > 0 ? 10 : 0 }}>
          {horizonChip && horizonPal ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "3px 9px",
                borderRadius: 999,
                background: horizonPal.bg,
                color: horizonPal.fg,
                border: `1px solid ${horizonPal.border}`,
              }}
            >
              Horizon · {horizonChip}
            </span>
          ) : null}
          {directionChip ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "3px 9px",
                borderRadius: 999,
                background: "#fff",
                color: "#374151",
                border: "1px solid #e5e7eb",
              }}
            >
              {directionChip}
            </span>
          ) : null}
        </div>
        {overrides.length > 0 ? (
          <>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
              Weight overrides applied to the calibrated baseline:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {overrides.map(([key, mult]) => {
                const m = mult as number;
                const boosted = m > 1;
                return (
                  <span
                    key={key}
                    title={`${key} weighted ${(m).toFixed(2)}× the calibrated baseline`}
                    style={{
                      fontSize: 10,
                      padding: "2px 7px",
                      borderRadius: 4,
                      background: boosted ? "#ecfdf5" : "#fef2f2",
                      color: boosted ? "#047857" : "#b91c1c",
                      border: `1px solid ${boosted ? "#a7f3d0" : "#fecaca"}`,
                    }}
                  >
                    {SIGNAL_HUMAN[key as keyof SignalProfile] ?? key}{" "}
                    <span style={{ fontWeight: 600 }}>
                      {boosted ? "+" : ""}{(((m) - 1) * 100).toFixed(0)}%
                    </span>
                  </span>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function RationaleBlock({ plan }: { plan: SpacePlan }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionLabel>Headline rationale</SectionLabel>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.55,
          color: "#1f2937",
          background: "#f9fafb",
          padding: 14,
          borderRadius: 8,
          borderLeft: "3px solid #6366f1",
        }}
      >
        {plan.headline_rationale || "(planner did not provide a rationale)"}
      </p>
    </section>
  );
}

function SelectedSection({
  items,
  entityNamesById,
  combinationResultsByCandidateId,
}: {
  items: SelectedWorkItem[];
  entityNamesById?: Record<string, string>;
  combinationResultsByCandidateId?: Record<string, CombinationResultLite>;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionLabel>
        Selected ({items.length})
      </SectionLabel>
      {items.length === 0 ? (
        <EmptyNote>
          The planner committed to no work this cycle — usually a sign
          coverage is adequate, the budget was zero, or no candidate
          cleared the score floor.
        </EmptyNote>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <SelectedItem
              key={item.candidate_id}
              item={item}
              entityNamesById={entityNamesById}
              combinationResult={combinationResultsByCandidateId?.[item.candidate_id]}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SelectedItem({
  item,
  entityNamesById,
  combinationResult,
}: {
  item: SelectedWorkItem;
  entityNamesById?: Record<string, string>;
  combinationResult?: CombinationResultLite;
}) {
  const display = describeCandidate(item.candidate_id, item.kind, entityNamesById);
  return (
    <article
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 12,
        background: "#ffffff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <KindBadge kind={item.kind} />
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          → {INSIGHT_LABEL[item.expected_insight_type]}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#374151", fontWeight: 500 }}>
          {item.allocated_tokens.toLocaleString()} tok
        </span>
      </div>
      {/* When the candidate decodes to human-readable text (combo:{a}+{b}
          → "name × name", or sig/edge/node → human label), render it
          prominently. Always keep the raw id in monospace below for audit. */}
      {display.headline ? (
        <div style={{ fontSize: 13, color: "#111827", fontWeight: 500, marginBottom: 4 }}>
          {display.headline}
        </div>
      ) : null}
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6, fontFamily: "monospace" }}>
        {item.candidate_id}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "#1f2937", lineHeight: 1.5 }}>
        {item.selection_reason}
      </p>
      <SignalStrip signals={item.signals} score={item.score} />
      {combinationResult ? (
        <CombinationResultCard result={combinationResult} />
      ) : item.kind === "intervention_combination" ? (
        <CombinationPendingCard />
      ) : null}
    </article>
  );
}

// ── CombinationResultCard ─────────────────────────────────────────────
//
// Inline rendering of a completed `intervention_combination` work
// item. Visible only when the executor has drained the queue and
// produced a row. Without this surface, the strategizer's combination
// work is a black box — the plan says "we'll explore the joint of A+B"
// but the user never sees the LLM's actual interpretation. The card
// closes that loop: title + novelty chip + implication + mechanism +
// optional probes.

function CombinationResultCard({ result }: { result: CombinationResultLite }) {
  const pal = NOVELTY_PALETTE[result.novelty];
  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        background: "#fafafa",
        borderRadius: 6,
        border: "1px solid #e5e7eb",
        borderLeft: `3px solid ${pal.fg}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            padding: "2px 7px",
            borderRadius: 4,
            background: pal.bg,
            color: pal.fg,
            border: `1px solid ${pal.border}`,
          }}
        >
          {pal.label}
        </span>
        <span style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>
          {result.title}
        </span>
      </div>
      <p style={{ margin: "0 0 6px", fontSize: 12, color: "#1f2937", lineHeight: 1.5 }}>
        {result.implication}
      </p>
      <p style={{ margin: "0 0 6px", fontSize: 11, color: "#6b7280", lineHeight: 1.5, fontStyle: "italic" }}>
        Mechanism: {result.mechanism}
      </p>
      {result.probes.length > 0 ? (
        <ul style={{ margin: "6px 0 0", padding: "0 0 0 16px", fontSize: 11, color: "#4b5563" }}>
          {result.probes.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Shown for intervention_combination items where the executor hasn't
// run yet — gives the user a clear "this work is queued" signal
// instead of a silent absence of the joint analysis card.
function CombinationPendingCard() {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 8,
        background: "#fff7ed",
        borderRadius: 6,
        border: "1px dashed #fed7aa",
        fontSize: 11,
        color: "#9a3412",
        lineHeight: 1.4,
      }}
    >
      Joint analysis pending — executor will draft the interpretation
      next time the drain cron runs.
    </div>
  );
}

// ── Candidate-id decoder ──────────────────────────────────────────────
//
// Translates the strategizer's opaque candidate_id strings into
// human-readable headlines for the drawer. Returns `{ headline: null }`
// when no useful translation is available (caller falls back to
// rendering the raw id only).
//
// Formats handled:
//   axis:{axis}            → "Axis · {axis}"
//   sig:{uuid}             → "Deepen · {entity name}"   (when names map present)
//   node:{uuid}            → "Node · {entity name}"
//   edge:{uuid}            → no decoding (uuid isn't an entity id)
//   probe:{aId}:{bId}      → "Probe · {nameA} ↔ {nameB}"
//   combo:{aId}+{bId}      → "{nameA} × {nameB}"

function describeCandidate(
  candidateId: string,
  kind: SpaceWorkKind,
  entityNamesById?: Record<string, string>,
): { headline: string | null } {
  if (!candidateId) return { headline: null };
  const names = entityNamesById ?? {};

  if (candidateId.startsWith("combo:")) {
    const body = candidateId.slice(6);
    const plusIdx = body.indexOf("+");
    if (plusIdx > 0) {
      const a = body.slice(0, plusIdx);
      const b = body.slice(plusIdx + 1);
      const nameA = names[a] ?? shortId(a);
      const nameB = names[b] ?? shortId(b);
      return { headline: `${nameA} × ${nameB}` };
    }
  }

  if (candidateId.startsWith("probe:")) {
    const body = candidateId.slice(6);
    const parts = body.split(":");
    if (parts.length >= 2) {
      const nameA = names[parts[0]] ?? shortId(parts[0]);
      const nameB = names[parts[1]] ?? shortId(parts[1]);
      return { headline: `Probe · ${nameA} ↔ ${nameB}` };
    }
  }

  if (candidateId.startsWith("axis:")) {
    return { headline: `Axis · ${candidateId.slice(5)}` };
  }

  if (candidateId.startsWith("sig:")) {
    const id = candidateId.slice(4);
    const name = names[id];
    if (name) return { headline: `Deepen · ${name}` };
  }

  if (candidateId.startsWith("node:")) {
    const id = candidateId.slice(5);
    const name = names[id];
    if (name) return { headline: `Node · ${name}` };
  }

  // intentionally consume kind to keep the signature future-proof
  void kind;
  return { headline: null };
}

function shortId(s: string): string {
  if (!s) return "?";
  return s.length > 8 ? s.slice(0, 8) : s;
}

// ── Entity-id extraction ─────────────────────────────────────────────
//
// Mirrors the parsing in describeCandidate() but returns the bare entity
// UUIDs each candidate references — used by the KG mini-map highlight
// path to light up "the entities the planner is about to spend tokens
// on." Only candidate kinds that meaningfully reference entities
// contribute (axis: → empty, edge: → empty since the suffix is an edge
// uuid not an entity uuid).
//
// Returns a Set so the caller can union across many items without
// dedup logic.
function collectEntityIdsFromSelected(items: SelectedWorkItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const cid = item.candidate_id;
    if (!cid) continue;
    if (cid.startsWith("combo:")) {
      const body = cid.slice(6);
      const plusIdx = body.indexOf("+");
      if (plusIdx > 0) {
        ids.add(body.slice(0, plusIdx));
        ids.add(body.slice(plusIdx + 1));
      }
    } else if (cid.startsWith("probe:")) {
      const parts = cid.slice(6).split(":");
      if (parts.length >= 2) {
        ids.add(parts[0]);
        ids.add(parts[1]);
      }
    } else if (cid.startsWith("sig:")) {
      ids.add(cid.slice(4));
    } else if (cid.startsWith("node:")) {
      ids.add(cid.slice(5));
    }
    // axis: / edge: don't reference entity UUIDs — skip.
  }
  return ids;
}

function SkippedSection({
  items,
  entityNamesById,
}: {
  items: SkipReason[];
  entityNamesById?: Record<string, string>;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionLabel>
        Skipped ({items.length})
      </SectionLabel>
      {items.length === 0 ? (
        <EmptyNote>
          No skips recorded. This is an audit smell — the planner
          accepted every candidate it saw, which is rarely optimal.
        </EmptyNote>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((skip) => {
            const display = describeCandidate(skip.candidate_id, skip.kind, entityNamesById);
            return (
              <article
                key={skip.candidate_id}
                style={{
                  border: "1px solid #f3f4f6",
                  borderRadius: 6,
                  padding: 10,
                  background: "#fafafa",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <KindBadge kind={skip.kind} muted />
                  <SkipBadge reason={skip.reason} />
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>
                    score {skip.score.toFixed(2)}
                  </span>
                </div>
                {display.headline ? (
                  <div style={{ fontSize: 12, color: "#4b5563", marginBottom: 2 }}>
                    {display.headline}
                  </div>
                ) : null}
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4, fontFamily: "monospace" }}>
                  {skip.candidate_id}
                  {skip.dominated_by ? (
                    <>
                      {" → dominated by "}
                      <span style={{ color: "#4b5563" }}>{skip.dominated_by}</span>
                    </>
                  ) : null}
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "#4b5563", lineHeight: 1.5 }}>
                  {skip.rationale}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DiversityBlock({ plan }: { plan: SpacePlan }) {
  const kinds = Object.entries(plan.diversity_profile.by_kind ?? {}) as Array<[SpaceWorkKind, number]>;
  const total = kinds.reduce((s, [, n]) => s + n, 0) || 1;
  const spread = plan.diversity_profile.controllability_spread;
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionLabel>Diversity</SectionLabel>
      <div style={{ display: "grid", gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>By kind</div>
          <div style={{ display: "flex", gap: 4, height: 8, borderRadius: 4, overflow: "hidden" }}>
            {kinds.map(([k, n]) => (
              <div
                key={k}
                style={{
                  width: `${(n / total) * 100}%`,
                  background: KIND_COLOR[k],
                }}
                title={`${KIND_LABEL[k]}: ${n}`}
              />
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            Controllability spread — {(spread * 100).toFixed(0)}%
          </div>
          <div style={{ background: "#e5e7eb", height: 6, borderRadius: 3 }}>
            <div
              style={{
                width: `${spread * 100}%`,
                height: "100%",
                background: spread >= 0.66 ? "#10b981" : spread >= 0.33 ? "#f59e0b" : "#ef4444",
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function StopConditionBlock({ plan }: { plan: SpacePlan }) {
  if (!plan.stop_condition) return null;
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionLabel>Stop condition</SectionLabel>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "#374151",
          fontStyle: "italic",
          lineHeight: 1.5,
        }}
      >
        {plan.stop_condition}
      </p>
    </section>
  );
}

function ProvenanceBlock({ plan }: { plan: SpacePlan }) {
  const weights = Object.entries(plan.ranker_weights_snapshot ?? {})
    .filter(([, v]) => typeof v === "number" && v > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number));
  return (
    <section style={{ marginBottom: 12 }}>
      <SectionLabel>Provenance</SectionLabel>
      <dl
        style={{
          margin: 0,
          fontSize: 12,
          color: "#4b5563",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 12px",
        }}
      >
        <dt style={{ color: "#9ca3af" }}>Model</dt>
        <dd style={{ margin: 0, fontFamily: "monospace" }}>
          {plan.planner_model} @ {plan.planner_temperature}
        </dd>
        <dt style={{ color: "#9ca3af" }}>Considered</dt>
        <dd style={{ margin: 0 }}>{plan.candidates_considered.length} candidates</dd>
        <dt style={{ color: "#9ca3af" }}>Headroom</dt>
        <dd style={{ margin: 0 }}>{plan.budget_headroom.toLocaleString()} tok unspent</dd>
      </dl>
      {weights.length > 0 ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 12, color: "#6366f1", cursor: "pointer" }}>
            Signal weights ({weights.length})
          </summary>
          <ul style={{ margin: "6px 0 0", padding: "0 0 0 14px", fontSize: 11, color: "#4b5563" }}>
            {weights.map(([k, v]) => (
              <li key={k}>
                {k}: {(v as number).toFixed(2)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: "0 0 8px",
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color: "#6b7280",
      }}
    >
      {children}
    </h3>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 13,
        color: "#9ca3af",
        fontStyle: "italic",
        lineHeight: 1.5,
        background: "#fafafa",
        padding: 10,
        borderRadius: 6,
        border: "1px dashed #e5e7eb",
      }}
    >
      {children}
    </p>
  );
}

function KindBadge({ kind, muted }: { kind: SpaceWorkKind; muted?: boolean }) {
  const color = KIND_COLOR[kind];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 500,
        padding: "2px 7px",
        borderRadius: 999,
        background: muted ? "#ffffff" : `${color}1a`,
        color: muted ? "#6b7280" : color,
        border: muted ? `1px solid #e5e7eb` : `1px solid ${color}33`,
      }}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

function SkipBadge({ reason }: { reason: SkipReason["reason"] }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: 4,
        background: "#fef2f2",
        color: "#b91c1c",
        border: "1px solid #fecaca",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {SKIP_LABEL[reason]}
    </span>
  );
}

function SignalStrip({ signals, score }: { signals: SignalProfile; score: number }) {
  const present = SIGNAL_ORDER.filter(
    ({ key }) => typeof signals[key] === "number" && (signals[key] as number) > 0,
  );
  if (present.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          color: "#9ca3af",
          marginBottom: 4,
        }}
      >
        <span>SIGNALS · score {score.toFixed(2)}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {present.map(({ key, label }) => {
          const v = signals[key] as number;
          return (
            <span
              key={key}
              title={`${label}: ${v.toFixed(2)}`}
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 4,
                background: "#f3f4f6",
                color: "#374151",
                border: "1px solid #e5e7eb",
              }}
            >
              {label}{" "}
              <span style={{ color: "#6366f1", fontWeight: 500 }}>
                {v.toFixed(2)}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div
      style={{
        marginTop: 40,
        padding: 20,
        textAlign: "center",
        color: "#9ca3af",
        fontSize: 13,
      }}
    >
      Loading plan…
    </div>
  );
}

function ErrorBlock({
  message,
  onGenerate,
  generating,
}: {
  message: string;
  onGenerate?: () => void | Promise<void>;
  generating: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 20,
        padding: 14,
        borderRadius: 6,
        background: "#fef2f2",
        border: "1px solid #fecaca",
        color: "#991b1b",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: "block", marginBottom: 4 }}>Could not load plan</strong>
      {message}
      {onGenerate ? (
        <div style={{ marginTop: 10 }}>
          <GenerateButton
            onClick={() => {
              void onGenerate();
            }}
            disabled={generating}
            label={generating ? "Generating…" : "Try generating a new plan"}
            tone="danger"
          />
        </div>
      ) : null}
    </div>
  );
}

// ── EmptyBlock ────────────────────────────────────────────────────────
//
// Shown when the GET returned plan=null and there's no error. This is
// the primary entry point for first-time strategizer use — a clear
// affordance is non-negotiable, because without this surface the whole
// strategizer arc is dead weight for non-developers.

function EmptyBlock({ onGenerate }: { onGenerate?: () => void | Promise<void> }) {
  return (
    <div
      style={{
        marginTop: 24,
        padding: 24,
        borderRadius: 10,
        background: "linear-gradient(180deg, #faf5ff 0%, #eef2ff 100%)",
        border: "1px solid #e0e7ff",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 34,
          lineHeight: 1,
          marginBottom: 10,
          color: "#6366f1",
        }}
        aria-hidden
      >
        ◎
      </div>
      <h3
        style={{
          margin: "0 0 6px",
          fontSize: 15,
          fontWeight: 600,
          color: "#1f2937",
        }}
      >
        No plan yet
      </h3>
      <p
        style={{
          margin: "0 auto 16px",
          maxWidth: 360,
          fontSize: 13,
          lineHeight: 1.55,
          color: "#4b5563",
        }}
      >
        The strategizer will score candidate work items (axes, edges,
        convergent points, signature deepens, intersection probes) and
        commit to the smallest set that raises reasoning density the
        most per token. Every pick comes with its rationale and the
        candidates it beat.
      </p>
      {onGenerate ? (
        <GenerateButton
          onClick={() => {
            void onGenerate();
          }}
          disabled={false}
          label="Generate plan"
          tone="primary"
        />
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>
          Run the strategizer via{" "}
          <code>POST /api/pipeline/space-strategizer</code> to produce one.
        </p>
      )}
    </div>
  );
}

// ── GeneratingBlock ───────────────────────────────────────────────────
//
// Full-panel "planner thinking" state. Not a spinner because the
// strategizer can take 5-15s (one LLM roundtrip) — a static reassurance
// card avoids the anxious-spinner feeling while keeping the user
// oriented. Matches the rest of the drawer's section grammar.

function GeneratingBlock() {
  return (
    <div
      style={{
        marginTop: 24,
        padding: 24,
        borderRadius: 10,
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 28,
          lineHeight: 1,
          marginBottom: 10,
          color: "#6366f1",
          animation: "spin 1.4s linear infinite",
          display: "inline-block",
        }}
        aria-hidden
      >
        ◐
      </div>
      <h3
        style={{
          margin: "0 0 4px",
          fontSize: 14,
          fontWeight: 600,
          color: "#1f2937",
        }}
      >
        Planner is deciding…
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.55,
          color: "#6b7280",
          maxWidth: 320,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        Scoring candidates, enforcing diversity, checking invariants.
        Usually 5-15 seconds.
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function GenerateButton({
  onClick,
  disabled,
  label,
  tone,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  tone: "primary" | "danger";
}) {
  const palette =
    tone === "danger"
      ? { bg: "#ffffff", fg: "#b91c1c", border: "#fecaca" }
      : { bg: "#4338ca", fg: "#ffffff", border: "#4338ca" };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "#d1d5db" : palette.bg,
        color: disabled ? "#6b7280" : palette.fg,
        border: `1px solid ${disabled ? "#d1d5db" : palette.border}`,
        padding: "8px 18px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
