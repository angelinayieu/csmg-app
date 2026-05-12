"use client";

// ── Environment per-card drawer ──────────────────────────────────────────
//
// Slide-in drawer that expands one of the six MDP cards on
// /app/space/[id]/environment into its full member list with per-row
// evidentiary trails. Read-only in this initial cut — no edit
// affordances yet (those land with the override-safety story).
//
// Each card type has its own body renderer because the data shapes
// differ:
//
//   state         → list every StateVariable with rationale
//   action        → list every ActionVariable with parameter shape
//   transition    → list top-20 leverage + top-20 uncertain edges
//                    (full edge set lives on the dedicated edges page)
//   reward        → list every goal with target/baseline/weight
//   discount      → single value with explanation + impact preview
//   initial_state → conditions, modulators, baselines

import { useEffect } from "react";
import { X, ExternalLink, Hash } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type {
  EnvironmentDefinition,
  StateVariable,
  ActionVariable,
  TransitionEdgeSummary,
  GoalTerm,
  VariableRationale,
} from "@/types/environment-definition";

// ────────────────────────────────────────────────────────────────────────

export type DrawerKey =
  | "state"
  | "action"
  | "transition"
  | "reward"
  | "discount"
  | "initial_state";

interface DrawerMeta {
  glyph: string;
  title: string;
  accent: string;
}

const DRAWER_META: Record<DrawerKey, DrawerMeta> = {
  state: { glyph: "①", title: "State space S", accent: "#0891B2" },
  action: { glyph: "②", title: "Action space A", accent: "#10B981" },
  transition: {
    glyph: "③",
    title: "Transition T(s'|s,a)",
    accent: "#7C3AED",
  },
  reward: { glyph: "④", title: "Reward R(s,a,s')", accent: "#D97706" },
  discount: { glyph: "⑤", title: "Discount γ", accent: "#EC4899" },
  initial_state: {
    glyph: "⑥",
    title: "Initial state P(s₀)",
    accent: "#475569",
  },
};

// ────────────────────────────────────────────────────────────────────────
// Outer shell — backdrop + slide-in panel + close handlers
// ────────────────────────────────────────────────────────────────────────

export function EnvironmentDrawer(props: {
  drawerKey: DrawerKey | null;
  env: EnvironmentDefinition | null;
  spaceId: string;
  onClose: () => void;
}) {
  const { drawerKey, env, spaceId, onClose } = props;

  // Esc closes; stop body scroll while open.
  useEffect(() => {
    if (!drawerKey) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [drawerKey, onClose]);

  if (!drawerKey || !env) return null;
  const meta = DRAWER_META[drawerKey];

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity"
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={meta.title}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <span
              className="text-xl"
              style={{ color: meta.accent }}
              aria-hidden
            >
              {meta.glyph}
            </span>
            <h2 className="text-base font-medium text-slate-100">
              {meta.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-900 hover:text-slate-100"
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <DrawerBody drawerKey={drawerKey} env={env} spaceId={spaceId} />
        </div>
      </aside>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────

function DrawerBody(props: {
  drawerKey: DrawerKey;
  env: EnvironmentDefinition;
  spaceId: string;
}) {
  switch (props.drawerKey) {
    case "state":
      return <StateDrawerBody env={props.env} spaceId={props.spaceId} />;
    case "action":
      return <ActionDrawerBody env={props.env} spaceId={props.spaceId} />;
    case "transition":
      return <TransitionDrawerBody env={props.env} spaceId={props.spaceId} />;
    case "reward":
      return <RewardDrawerBody env={props.env} spaceId={props.spaceId} />;
    case "discount":
      return <DiscountDrawerBody env={props.env} />;
    case "initial_state":
      return <InitialStateDrawerBody env={props.env} />;
  }
}

// ────────────────────────────────────────────────────────────────────────
// State space drawer
// ────────────────────────────────────────────────────────────────────────

function StateDrawerBody(props: {
  env: EnvironmentDefinition;
  spaceId: string;
}) {
  const ss = props.env.state_space;
  const grouped = groupBy(ss.variables, (v) => v.layer_slug);

  return (
    <div className="space-y-6">
      <SummaryRow
        items={[
          { label: "observable", value: ss.observable_count.toString() },
          { label: "latent", value: ss.latent_count.toString() },
          { label: "via proxy", value: ss.proxy_count.toString() },
          { label: "total", value: ss.variables.length.toString() },
        ]}
      />
      {Array.from(grouped.entries()).map(([layer, vars]) => (
        <section key={layer}>
          <SectionHeader title={layer} count={vars.length} />
          <div className="mt-2 space-y-2">
            {vars.map((v) => (
              <StateVariableRow
                key={v.entity_id}
                variable={v}
                spaceId={props.spaceId}
              />
            ))}
          </div>
        </section>
      ))}
      <FooterLink
        href={`/app/space/${props.spaceId}/entities`}
        label="See all entities"
      />
    </div>
  );
}

function StateVariableRow(props: {
  variable: StateVariable;
  spaceId: string;
}) {
  const v = props.variable;
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/app/space/${props.spaceId}/entity/${v.entity_id}`}
            className="text-sm font-medium text-slate-100 hover:text-emerald-400"
          >
            {v.name}
          </Link>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            <span>
              <ObservabilityChip kind={v.observability} />
            </span>
            {v.measurement_value_kind && (
              <span>kind: {v.measurement_value_kind}</span>
            )}
            {v.value_directionality && (
              <span>{v.value_directionality.replace("_", " ")}</span>
            )}
            {v.bounds.lower !== null || v.bounds.upper !== null ? (
              <span>
                bounds [{v.bounds.lower ?? "−∞"}, {v.bounds.upper ?? "+∞"}]
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            current
          </div>
          <div className="tabular-nums text-slate-200">
            {v.current_value === null ? "—" : v.current_value.toFixed(2)}
          </div>
        </div>
      </div>
      <RationaleBlock rationale={v.rationale} />
    </article>
  );
}

function ObservabilityChip(props: {
  kind: StateVariable["observability"];
}) {
  const tone =
    props.kind === "directly_observable"
      ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
      : props.kind === "inferable_via_proxy"
        ? "border-amber-700/40 bg-amber-950/30 text-amber-300"
        : "border-slate-700 bg-slate-900 text-slate-400";
  const label =
    props.kind === "directly_observable"
      ? "observable"
      : props.kind === "inferable_via_proxy"
        ? "via proxy"
        : "latent";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-px text-[10px]",
        tone,
      )}
    >
      {label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Action space drawer
// ────────────────────────────────────────────────────────────────────────

function ActionDrawerBody(props: {
  env: EnvironmentDefinition;
  spaceId: string;
}) {
  const as = props.env.action_space;
  const active = as.actions.filter((a) => a.currently_active);
  const candidates = as.actions.filter((a) => !a.currently_active);

  return (
    <div className="space-y-6">
      <SummaryRow
        items={[
          { label: "total actions", value: as.actions.length.toString() },
          { label: "active", value: active.length.toString() },
          { label: "candidates", value: candidates.length.toString() },
          {
            label: "search dim",
            value: as.total_dimension.toString(),
          },
        ]}
      />
      {active.length > 0 && (
        <section>
          <SectionHeader title="Currently active" count={active.length} />
          <div className="mt-2 space-y-2">
            {active.map((a) => (
              <ActionRow
                key={a.entity_id}
                action={a}
                spaceId={props.spaceId}
              />
            ))}
          </div>
        </section>
      )}
      {candidates.length > 0 && (
        <section>
          <SectionHeader title="Candidates" count={candidates.length} />
          <div className="mt-2 space-y-2">
            {candidates.map((a) => (
              <ActionRow
                key={a.entity_id}
                action={a}
                spaceId={props.spaceId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ActionRow(props: { action: ActionVariable; spaceId: string }) {
  const a = props.action;
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/app/space/${props.spaceId}/entity/${a.entity_id}`}
            className="text-sm font-medium text-slate-100 hover:text-emerald-400"
          >
            {a.name}
          </Link>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            <ParameterShapeChip shape={a.parameter_shape} />
            {a.effort && <span>effort: {a.effort}</span>}
            {a.timeframe && <span>timeframe: {a.timeframe}</span>}
            {a.currently_active && (
              <span className="text-emerald-400">● active</span>
            )}
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            current dose
          </div>
          <div className="tabular-nums text-slate-200">
            {a.current_dose === null ? "—" : a.current_dose.toFixed(2)}
          </div>
        </div>
      </div>
      <RationaleBlock rationale={a.rationale} />
    </article>
  );
}

function ParameterShapeChip(props: {
  shape: ActionVariable["parameter_shape"];
}) {
  const s = props.shape;
  let label = "";
  switch (s.kind) {
    case "continuous":
      label = `continuous [${s.min}–${s.max}${s.unit ? ` ${s.unit}` : ""}]`;
      break;
    case "binary":
      label = "binary on/off";
      break;
    case "categorical":
      label = `${s.choices.length} choices`;
      break;
    case "schedule":
      label = `schedule [${s.min_per_week}–${s.max_per_week}/wk]`;
      break;
  }
  return (
    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-1.5 py-px text-[10px] text-slate-400">
      {label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Transition dynamics drawer
// ────────────────────────────────────────────────────────────────────────

function TransitionDrawerBody(props: {
  env: EnvironmentDefinition;
  spaceId: string;
}) {
  const td = props.env.transition_dynamics;

  return (
    <div className="space-y-6">
      <SummaryRow
        items={[
          { label: "edges", value: td.edge_count.toString() },
          {
            label: "avg conf",
            value: td.avg_confidence.toFixed(2),
          },
          {
            label: "temporal cov",
            value: `${Math.round(td.temporal_coverage * 100)}%`,
          },
          {
            label: "avg I²",
            value:
              td.avg_heterogeneity_i2 === null
                ? "—"
                : td.avg_heterogeneity_i2.toFixed(2),
          },
        ]}
      />

      <section>
        <SectionHeader title="Status breakdown" />
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <StatusBlock
            label="confirmed"
            value={td.by_status.confirmed}
            tone="good"
          />
          <StatusBlock
            label="mixed"
            value={td.by_status.mixed}
            tone="mid"
          />
          <StatusBlock
            label="sparse"
            value={td.by_status.sparse}
            tone="low"
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <StatusBlock
            label="established causal"
            value={td.by_causal_status.established_causal}
            tone="good"
          />
          <StatusBlock
            label="plausible"
            value={td.by_causal_status.plausible_causal}
            tone="mid"
          />
          <StatusBlock
            label="correlational"
            value={td.by_causal_status.correlational_only}
            tone="low"
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Top leverage edges"
          count={td.top_leverage_edges.length}
          subtitle="highest |strength|"
        />
        <div className="mt-2 space-y-2">
          {td.top_leverage_edges.map((e) => (
            <EdgeRow key={`lev-${e.edge_id}`} edge={e} />
          ))}
        </div>
      </section>

      <section>
        <SectionHeader
          title="Top uncertain edges"
          count={td.top_uncertain_edges.length}
          subtitle="highest standard error — research these next"
        />
        <div className="mt-2 space-y-2">
          {td.top_uncertain_edges.map((e) => (
            <EdgeRow key={`unc-${e.edge_id}`} edge={e} />
          ))}
        </div>
      </section>

      <FooterLink
        href={`/app/space/${props.spaceId}/edges`}
        label="See all edges"
      />
    </div>
  );
}

function EdgeRow(props: { edge: TransitionEdgeSummary }) {
  const e = props.edge;
  const sign = e.strength >= 0 ? "+" : "";
  const polarity =
    e.polarity === "negative"
      ? "text-red-400"
      : e.polarity === "conditional"
        ? "text-amber-400"
        : "text-emerald-400";
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-200">
            <span className="text-slate-300">{e.source_name || e.source_entity_id.slice(0, 8)}</span>
            <span className="mx-2 text-slate-600">→</span>
            <span className="text-slate-300">{e.target_name || e.target_entity_id.slice(0, 8)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            <span>
              strength{" "}
              <span className={cn("tabular-nums", polarity)}>
                {sign}
                {e.strength.toFixed(2)}
              </span>
              <span className="ml-0.5 text-slate-500">
                ± {e.standard_error.toFixed(2)}
              </span>
            </span>
            <span>{e.polarity}</span>
            {e.causal_status && <span>{e.causal_status.replace(/_/g, " ")}</span>}
            <span>{e.evidence_count} ev</span>
          </div>
          {(e.temporal.onset_days_p50 !== null ||
            e.temporal.peak_days_p50 !== null ||
            e.temporal.persistence_days_p50 !== null) && (
            <div className="mt-1 text-[11px] text-slate-500">
              onset {fmt(e.temporal.onset_days_p50)}d · peak{" "}
              {fmt(e.temporal.peak_days_p50)}d · persist{" "}
              {fmt(e.temporal.persistence_days_p50)}d
              {e.temporal.decay_kinetics_modal && (
                <span> · {e.temporal.decay_kinetics_modal} decay</span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function StatusBlock(props: {
  label: string;
  value: number;
  tone: "good" | "mid" | "low";
}) {
  const tone =
    props.tone === "good"
      ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-200"
      : props.tone === "mid"
        ? "border-amber-700/40 bg-amber-950/30 text-amber-200"
        : "border-red-700/40 bg-red-950/30 text-red-200";
  return (
    <div className={cn("rounded-md border px-2 py-2 text-center", tone)}>
      <div className="text-lg font-light tabular-nums">{props.value}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-80">
        {props.label}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Reward drawer
// ────────────────────────────────────────────────────────────────────────

function RewardDrawerBody(props: {
  env: EnvironmentDefinition;
  spaceId: string;
}) {
  const rf = props.env.reward_function;

  return (
    <div className="space-y-6">
      <SummaryRow
        items={[
          {
            label: "primary",
            value: rf.primary_goal.metric_name || "—",
          },
          { label: "sub-goals", value: rf.sub_goals.length.toString() },
          { label: "cost terms", value: rf.cost_terms.length.toString() },
          {
            label: "weights",
            value: rf.weights_normalized ? "normalized" : "uniform",
          },
        ]}
      />

      <section>
        <SectionHeader title="Primary goal" />
        <div className="mt-2">
          <GoalRow goal={rf.primary_goal} />
        </div>
      </section>

      {rf.sub_goals.length > 0 && (
        <section>
          <SectionHeader title="Sub-goals" count={rf.sub_goals.length} />
          <div className="mt-2 space-y-2">
            {rf.sub_goals.map((g) => (
              <GoalRow key={g.goal_id} goal={g} />
            ))}
          </div>
        </section>
      )}

      {rf.cost_terms.length > 0 && (
        <section>
          <SectionHeader
            title="Cost terms"
            count={rf.cost_terms.length}
            subtitle="weighted negatively in R(s,a,s')"
          />
          <div className="mt-2 space-y-2">
            {rf.cost_terms.map((g) => (
              <GoalRow key={g.goal_id} goal={g} />
            ))}
          </div>
        </section>
      )}

      <FooterLink
        href={`/app/space/${props.spaceId}/goals`}
        label="See all goals"
      />
    </div>
  );
}

function GoalRow(props: { goal: GoalTerm }) {
  const g = props.goal;
  if (!g.goal_id) {
    return (
      <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200">
        No reward goal defined yet. The simulator can't optimize without a target.
      </div>
    );
  }
  const gap = g.target_value - g.baseline_value;
  const progressPct =
    gap === 0
      ? 100
      : Math.max(
          0,
          Math.min(100, ((g.current_value - g.baseline_value) / gap) * 100),
        );

  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-100">{g.metric_name}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            <span>
              {g.baseline_value} → {g.target_value}{" "}
              {g.metric_unit && <span>{g.metric_unit}</span>}
            </span>
            <span>weight {g.weight.toFixed(2)}</span>
            <span>{g.direction.replace("_", " ")}</span>
            {g.deadline && (
              <span>by {new Date(g.deadline).toLocaleDateString()}</span>
            )}
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            current
          </div>
          <div className="tabular-nums text-slate-200">
            {Number.isFinite(g.current_value)
              ? g.current_value.toFixed(2)
              : "—"}
          </div>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full bg-amber-500 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <RationaleBlock rationale={g.rationale} />
    </article>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Discount drawer
// ────────────────────────────────────────────────────────────────────────

function DiscountDrawerBody(props: { env: EnvironmentDefinition }) {
  const df = props.env.discount_factor;
  const halfLife = Number.isFinite(df.effective_half_life_weeks)
    ? `${df.effective_half_life_weeks} weeks`
    : "no decay (γ = 1)";

  // Show how reward weight decays over the next 24 weeks.
  const points: Array<{ week: number; weight: number }> = [];
  for (let w = 0; w <= 24; w += 2) {
    points.push({ week: w, weight: Math.pow(df.per_week, w) });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          Discount per week
        </div>
        <div className="mt-1 text-4xl font-light text-slate-100">
          {df.per_week.toFixed(3)}
        </div>
        <div className="mt-2 text-sm text-slate-400">
          Half-life: <span className="text-slate-200">{halfLife}</span>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {df.is_user_set
            ? "User-set value."
            : "Default (no explicit setting found on primary goal). Lands as schema dep #6: improvement_goals.discount_per_week."}
        </div>
      </div>

      <section>
        <SectionHeader
          title="Reward decay over horizon"
          subtitle="how much a future gain is worth right now"
        />
        <div className="mt-3 space-y-1">
          {points.map((p) => {
            const pct = p.weight * 100;
            return (
              <div key={p.week} className="flex items-center gap-3 text-xs">
                <span className="w-12 shrink-0 text-slate-500">
                  w{p.week}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-pink-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right tabular-nums text-slate-400">
                  {pct.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="text-xs text-slate-400">
        <p>
          The discount factor controls how much the reward function values
          near-term gains over distant ones. A γ of {df.per_week.toFixed(3)}{" "}
          per week means a gain N weeks from now is worth (γ^N) of the same
          gain today. Lower γ favors fast-acting interventions; higher γ is
          patient and willing to wait for compounding effects.
        </p>
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Initial state drawer
// ────────────────────────────────────────────────────────────────────────

function InitialStateDrawerBody(props: { env: EnvironmentDefinition }) {
  const isd = props.env.initial_state_distribution;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          Persona
        </div>
        <div className="mt-0.5 text-base text-slate-100">
          {isd.subject_name}
        </div>
        {isd.subject_id && (
          <div className="mt-1 font-mono text-[10px] text-slate-600">
            {isd.subject_id}
          </div>
        )}
      </div>

      <section>
        <SectionHeader
          title="Conditions"
          count={isd.conditions.length}
          subtitle={
            isd.applied_modulators.length > 0
              ? `${isd.applied_modulators.length} of ${isd.conditions.length} have modulators`
              : "none yet calibrated against literature"
          }
        />
        <div className="mt-2 space-y-2">
          {isd.conditions.map((c) => {
            const calibrated = isd.applied_modulators.some(
              (m) => m.condition_key === c.key,
            );
            return (
              <article
                key={c.key}
                className="rounded-lg border border-slate-800 bg-slate-900/40 p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-100">{c.key}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      = {String(c.value)}
                      {c.unit && <span className="ml-1">{c.unit}</span>}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px]",
                      calibrated
                        ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
                        : "border-amber-700/40 bg-amber-950/30 text-amber-300",
                    )}
                  >
                    {calibrated ? "calibrated" : "uncalibrated"}
                  </span>
                </div>
                <RationaleBlock rationale={c.rationale} />
              </article>
            );
          })}
          {isd.conditions.length === 0 && (
            <div className="text-xs italic text-slate-600">
              No conditions defined for this subject. Predictions use
              uncalibrated population averages.
            </div>
          )}
        </div>
      </section>

      {isd.applied_modulators.length > 0 && (
        <section>
          <SectionHeader
            title="Applied modulators"
            count={isd.applied_modulators.length}
            subtitle="literature-derived effect-size multipliers"
          />
          <div className="mt-2 space-y-2">
            {isd.applied_modulators.map((m, i) => (
              <article
                key={i}
                className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs"
              >
                <div className="text-slate-200">
                  {m.condition_key} → {m.target_edge_label}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  multiplier: ×{m.multiplier_p10.toFixed(2)} /{" "}
                  ×{m.multiplier_p50.toFixed(2)} /{" "}
                  ×{m.multiplier_p90.toFixed(2)}{" "}
                  <span className="text-slate-600">(p10/p50/p90)</span>
                </div>
                {m.source_evidence_ids.length > 0 && (
                  <div className="mt-1 text-[10px] text-slate-600">
                    {m.source_evidence_ids.length} evidence rows
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {isd.baselines.length > 0 && (
        <section>
          <SectionHeader
            title="Measured baselines"
            count={isd.baselines.length}
          />
          <div className="mt-2 space-y-2">
            {isd.baselines.map((b) => (
              <article
                key={b.entity_id}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-200">{b.entity_name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {new Date(b.recorded_at).toLocaleString()}
                    {b.is_inferred && (
                      <span className="ml-2 text-amber-400">inferred</span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="tabular-nums text-slate-200">
                    {b.value.toFixed(2)}
                  </div>
                  {b.unit && (
                    <div className="text-[10px] text-slate-500">{b.unit}</div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Reusable building blocks
// ────────────────────────────────────────────────────────────────────────

function SummaryRow(props: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {props.items.map((item) => (
        <div
          key={item.label}
          className="rounded-md border border-slate-800 bg-slate-900/30 px-3 py-2"
        >
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            {item.label}
          </div>
          <div className="mt-0.5 truncate text-sm tabular-nums text-slate-100">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionHeader(props: {
  title: string;
  count?: number;
  subtitle?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-slate-300">
          {props.title}
        </h3>
        {props.count !== undefined && (
          <span className="text-xs tabular-nums text-slate-500">
            ({props.count})
          </span>
        )}
      </div>
      {props.subtitle && (
        <div className="mt-0.5 text-[11px] text-slate-500">
          {props.subtitle}
        </div>
      )}
    </div>
  );
}

function RationaleBlock(props: { rationale: VariableRationale }) {
  const r = props.rationale;
  return (
    <div className="mt-2 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span>
          source:{" "}
          <span className="text-slate-300">
            {r.source.replace("_", " ")}
          </span>
        </span>
        {r.evidence_ids.length > 0 && (
          <span className="font-mono">
            {r.evidence_ids.length} ev id{r.evidence_ids.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {r.source_quote && (
        <blockquote className="mt-1 border-l-2 border-slate-700 pl-2 italic text-slate-400">
          "{r.source_quote}"
        </blockquote>
      )}
      <p className="mt-0.5 text-slate-500">{r.explanation}</p>
    </div>
  );
}

function FooterLink(props: { href: string; label: string }) {
  return (
    <Link
      href={props.href}
      className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-700 hover:text-slate-100"
    >
      {props.label}
      <ExternalLink size={12} />
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function groupBy<T, K>(items: ReadonlyArray<T>, key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const existing = out.get(k);
    if (existing) existing.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function fmt(n: number | null): string {
  return n === null ? "?" : Math.round(n).toString();
}
