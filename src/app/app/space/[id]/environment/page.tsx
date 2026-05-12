"use client";

// ── Environment Definition page ──
// Route: /app/space/[id]/environment
//
// Renders the EnvironmentDefinition for a space — the formal MDP
// description (state, action, transition, reward, discount, initial
// state) plus boundary + confidence breakdown. Sits between the
// situation card (which describes the situation) and the lab (which
// simulates it).
//
// The page is read-only in this initial cut — six summary cards +
// the system boundary chip + a confidence breakdown with callouts
// + the environment hash for drift detection. Per-card expand
// drawers (with full member lists + per-row evidence trails) and
// the override edit affordances ship in subsequent phases.
//
// Data: fetches /api/spaces/[id]/environment which calls the
// aggregator at lib/environment/aggregate-environment-definition.

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Hash,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { EnvironmentDefinition } from "@/types/environment-definition";
import {
  EnvironmentDrawer,
  type DrawerKey,
} from "@/components/environment/environment-drawer";

// ────────────────────────────────────────────────────────────────────────
// Card metadata — drives the six structural cards in canonical order.
// Glyphs match the room cascade pattern (room-layout.ts) so the
// environment page reads visually consistent with the canvas rooms.
// ────────────────────────────────────────────────────────────────────────

type CardKey =
  | "state"
  | "action"
  | "transition"
  | "reward"
  | "discount"
  | "initial_state";

interface CardMeta {
  key: CardKey;
  glyph: string;
  title: string;
  subtitle: string;
  accent: string;
}

const CARDS: ReadonlyArray<CardMeta> = [
  {
    key: "state",
    glyph: "①",
    title: "State space S",
    subtitle: "What can change about your situation",
    accent: "#0891B2",
  },
  {
    key: "action",
    glyph: "②",
    title: "Action space A",
    subtitle: "What you can manipulate",
    accent: "#10B981",
  },
  {
    key: "transition",
    glyph: "③",
    title: "Transition T(s'|s,a)",
    subtitle: "How actions move state",
    accent: "#7C3AED",
  },
  {
    key: "reward",
    glyph: "④",
    title: "Reward R(s,a,s')",
    subtitle: "What success looks like",
    accent: "#D97706",
  },
  {
    key: "discount",
    glyph: "⑤",
    title: "Discount γ",
    subtitle: "Patience over time",
    accent: "#EC4899",
  },
  {
    key: "initial_state",
    glyph: "⑥",
    title: "Initial state P(s₀)",
    subtitle: "Where you start",
    accent: "#475569",
  },
];

// ────────────────────────────────────────────────────────────────────────

export default function EnvironmentPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const subjectParam = searchParams.get("subject");

  const [env, setEnv] = useState<EnvironmentDefinition | null>(null);
  const [loadState, setLoadState] = useState<
    | { kind: "loading" }
    | { kind: "ok" }
    | { kind: "error"; reason: string; status: number }
  >({ kind: "loading" });
  const [openDrawer, setOpenDrawer] = useState<DrawerKey | null>(null);

  const fetchEnv = useMemo(
    () => async () => {
      setLoadState({ kind: "loading" });
      try {
        const url = new URL(
          `/api/spaces/${params.id}/environment`,
          window.location.origin,
        );
        if (subjectParam) url.searchParams.set("subject", subjectParam);
        const res = await fetch(url.toString());
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setLoadState({
            kind: "error",
            reason: body.error ?? "unknown",
            status: res.status,
          });
          return;
        }
        const data = (await res.json()) as EnvironmentDefinition;
        setEnv(data);
        setLoadState({ kind: "ok" });
      } catch (err) {
        console.error("[EnvironmentPage] fetch failed", err);
        setLoadState({
          kind: "error",
          reason: "fetch_failed",
          status: 0,
        });
      }
    },
    [params.id, subjectParam],
  );

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header
        spaceId={params.id}
        env={env}
        loadState={loadState}
        onRefresh={fetchEnv}
      />
      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        {loadState.kind === "loading" && <LoadingState />}
        {loadState.kind === "error" && <ErrorState state={loadState} />}
        {loadState.kind === "ok" && env && (
          <EnvironmentBody env={env} onOpenDrawer={setOpenDrawer} />
        )}
      </main>
      <EnvironmentDrawer
        drawerKey={openDrawer}
        env={env}
        spaceId={params.id}
        onClose={() => setOpenDrawer(null)}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Header (sticky, with back button + persona switcher hook + refresh)
// ────────────────────────────────────────────────────────────────────────

function Header(props: {
  spaceId: string;
  env: EnvironmentDefinition | null;
  loadState: { kind: "loading" | "ok" | "error" };
  onRefresh: () => void;
}) {
  const { spaceId, env, loadState, onRefresh } = props;
  const domainLabel = env?.boundary.domain_label ?? "—";
  const subjectName =
    env?.initial_state_distribution.subject_name ?? "default";
  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/app/space/${spaceId}/whiteboard`}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-slate-400 transition hover:bg-slate-900 hover:text-slate-100"
          >
            <ArrowLeft size={16} />
            Back
          </Link>
          <div className="ml-2">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              Environment
            </div>
            <div className="text-sm font-medium text-slate-200">
              {domainLabel}
              <span className="mx-2 text-slate-600">×</span>
              {subjectName}
            </div>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-700 hover:text-slate-100 disabled:opacity-50"
          disabled={loadState.kind === "loading"}
        >
          {loadState.kind === "loading" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Refresh
        </button>
      </div>
    </header>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Loading + error states
// ────────────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-slate-500">
      <Loader2 size={32} className="animate-spin" />
      <div className="mt-4 text-sm">Aggregating environment…</div>
    </div>
  );
}

function ErrorState(props: { state: { reason: string; status: number } }) {
  const { reason, status } = props.state;
  const messages: Record<string, string> = {
    space_not_found: "This space could not be found.",
    no_kg_generation_plan:
      "This space hasn't generated a knowledge graph plan yet. Run the intake pipeline first.",
    no_entities:
      "This space has no entities yet. Run decompose or instantiate a template first.",
    subject_not_in_space:
      "The requested subject doesn't belong to this space.",
    fetch_failed:
      "The environment endpoint didn't respond. Check the network tab.",
    unknown: "An unknown error occurred.",
  };
  const message = messages[reason] ?? messages.unknown;
  return (
    <div className="mx-auto max-w-md rounded-lg border border-amber-900/40 bg-amber-950/20 px-6 py-8 text-center">
      <AlertTriangle size={24} className="mx-auto text-amber-500" />
      <div className="mt-3 text-sm text-amber-200">{message}</div>
      <div className="mt-2 font-mono text-xs text-amber-700">
        {reason} ({status})
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Body — boundary chip, confidence, MDP diagram, six cards, hash
// ────────────────────────────────────────────────────────────────────────

function EnvironmentBody(props: {
  env: EnvironmentDefinition;
  onOpenDrawer: (key: DrawerKey) => void;
}) {
  const { env, onOpenDrawer } = props;
  return (
    <div className="space-y-6">
      <BoundaryChip env={env} />
      <ConfidenceBlock env={env} />
      <MdpDiagram env={env} />
      <CardGrid env={env} onOpenDrawer={onOpenDrawer} />
      <HashFooter env={env} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Boundary chip — the "what world is the simulator modeling for me?"
// summary at the top.
// ────────────────────────────────────────────────────────────────────────

function BoundaryChip(props: { env: EnvironmentDefinition }) {
  const { boundary } = props.env;
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 px-5 py-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">
        System boundary
      </div>
      <div className="mt-2 text-base text-slate-100">
        {boundary.primary_objective || boundary.goal_verbatim || "—"}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
        <span>
          Domain:{" "}
          <span className="text-slate-200">{boundary.domain_label}</span>{" "}
          <span className="text-slate-600">
            ({(boundary.domain_confidence * 100).toFixed(0)}% conf)
          </span>
        </span>
        {boundary.decision_horizon_weeks !== null && (
          <span>
            Horizon:{" "}
            <span className="text-slate-200">
              {boundary.decision_horizon_weeks} weeks
            </span>
          </span>
        )}
        {boundary.success_criteria.length > 0 && (
          <span>
            Success criteria:{" "}
            <span className="text-slate-200">
              {boundary.success_criteria.length}
            </span>
          </span>
        )}
        {boundary.out_of_scope.length > 0 && (
          <span>
            Out of scope:{" "}
            <span className="text-slate-200">
              {boundary.out_of_scope.length}
            </span>
          </span>
        )}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Confidence block — big number + 6 component bars + callouts.
// ────────────────────────────────────────────────────────────────────────

function ConfidenceBlock(props: { env: EnvironmentDefinition }) {
  const { confidence, confidence_breakdown: cb } = props.env;
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.7
      ? "text-emerald-400"
      : confidence >= 0.4
        ? "text-amber-400"
        : "text-red-400";

  const components: Array<{ key: string; label: string; value: number }> = [
    { key: "boundary", label: "Boundary", value: cb.boundary_confidence },
    { key: "state", label: "State coverage", value: cb.state_coverage },
    { key: "action", label: "Action calibration", value: cb.action_calibration },
    {
      key: "transition",
      label: "Transition coverage",
      value: cb.transition_coverage,
    },
    { key: "reward", label: "Reward clarity", value: cb.reward_clarity },
    {
      key: "initial",
      label: "Initial state calibration",
      value: cb.initial_state_calibration,
    },
  ];

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 px-5 py-5">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          Environment confidence
        </div>
        <div className={cn("text-3xl font-light", color)}>
          {pct}
          <span className="text-base text-slate-500">%</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2.5 md:grid-cols-3">
        {components.map((c) => (
          <ConfidenceBar key={c.key} label={c.label} value={c.value} />
        ))}
      </div>

      {cb.callouts.length > 0 && (
        <div className="mt-5 space-y-2">
          {cb.callouts.map((text, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200"
            >
              <AlertTriangle
                size={14}
                className="mt-0.5 shrink-0 text-amber-500"
              />
              <span>{text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ConfidenceBar(props: { label: string; value: number }) {
  const pct = Math.round(props.value * 100);
  const color =
    props.value >= 0.7
      ? "bg-emerald-500"
      : props.value >= 0.4
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-32 shrink-0 text-slate-400">{props.label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div
          className={cn("h-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right tabular-nums text-slate-400">{pct}%</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// MDP diagram — abstract s_t → a_t → s_{t+1} → r_t flow with counts.
// ────────────────────────────────────────────────────────────────────────

function MdpDiagram(props: { env: EnvironmentDefinition }) {
  const { env } = props;
  const stateCount = env.state_space.variables.length;
  const actionCount = env.action_space.actions.length;
  const edgeCount = env.transition_dynamics.edge_count;
  const goalCount =
    1 +
    env.reward_function.sub_goals.length +
    env.reward_function.cost_terms.length;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/30 px-5 py-5">
      <div className="text-xs uppercase tracking-wider text-slate-500">
        MDP shape
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <DiagramNode label="state s_t" count={`${stateCount} vars`} />
        <DiagramArrow label="action a_t" count={`${actionCount}`} />
        <DiagramNode label="state s_{t+1}" count={`${stateCount} vars`} />
        <DiagramArrow label="reward r_t" count={`${goalCount} terms`} />
        <DiagramNode label="goal" count="" terminal />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>{env.state_space.observable_count} observable</span>
        <span>·</span>
        <span>{env.state_space.latent_count} latent</span>
        <span>·</span>
        <span>{edgeCount} causal edges</span>
        <span>·</span>
        <span>γ = {env.discount_factor.per_week.toFixed(2)} per week</span>
      </div>
    </section>
  );
}

function DiagramNode(props: {
  label: string;
  count: string;
  terminal?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-center",
        props.terminal
          ? "border-amber-700/40 bg-amber-950/20"
          : "border-slate-700 bg-slate-900",
      )}
    >
      <div
        className={cn(
          "font-mono text-xs",
          props.terminal ? "text-amber-300" : "text-slate-300",
        )}
      >
        {props.label}
      </div>
      {props.count && (
        <div className="mt-0.5 text-[10px] text-slate-500">{props.count}</div>
      )}
    </div>
  );
}

function DiagramArrow(props: { label: string; count: string }) {
  return (
    <div className="flex flex-col items-center px-1 text-slate-600">
      <div className="font-mono text-[10px] text-slate-500">{props.label}</div>
      <div className="text-2xl leading-none">→</div>
      <div className="text-[10px] text-slate-500">{props.count}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// The six MDP cards.
// ────────────────────────────────────────────────────────────────────────

function CardGrid(props: {
  env: EnvironmentDefinition;
  onOpenDrawer: (key: DrawerKey) => void;
}) {
  const { env, onOpenDrawer } = props;
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {CARDS.map((meta) => (
        <McpCard
          key={meta.key}
          meta={meta}
          env={env}
          onOpen={() => onOpenDrawer(meta.key)}
        />
      ))}
    </section>
  );
}

function McpCard(props: {
  meta: CardMeta;
  env: EnvironmentDefinition;
  onOpen: () => void;
}) {
  const { meta, env, onOpen } = props;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-lg border border-slate-800 bg-slate-900/40 p-5 text-left transition hover:border-slate-700 hover:bg-slate-900/60 focus:border-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="text-xl"
            style={{ color: meta.accent }}
            aria-hidden
          >
            {meta.glyph}
          </span>
          <h3 className="text-sm font-medium text-slate-100">{meta.title}</h3>
        </div>
        <ChevronRight
          size={14}
          className="text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-400"
        />
      </header>
      <p className="mt-1 text-xs text-slate-500">{meta.subtitle}</p>
      <div className="mt-4 flex-1">
        <CardBody cardKey={meta.key} env={env} />
      </div>
    </button>
  );
}

function CardBody(props: { cardKey: CardKey; env: EnvironmentDefinition }) {
  const { cardKey, env } = props;
  switch (cardKey) {
    case "state":
      return <StateCardBody env={env} />;
    case "action":
      return <ActionCardBody env={env} />;
    case "transition":
      return <TransitionCardBody env={env} />;
    case "reward":
      return <RewardCardBody env={env} />;
    case "discount":
      return <DiscountCardBody env={env} />;
    case "initial_state":
      return <InitialStateCardBody env={env} />;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Card body renderers — small, focused, all read-only in this cut.
// Each shows: 2-3 headline numbers + a short sample list. Click-to-
// expand drawer ships in the next phase.
// ────────────────────────────────────────────────────────────────────────

function StateCardBody(props: { env: EnvironmentDefinition }) {
  const ss = props.env.state_space;
  const sample = ss.variables.slice(0, 4);
  return (
    <div className="space-y-3">
      <Stat
        rows={[
          { label: "observable", value: ss.observable_count.toString() },
          { label: "latent", value: ss.latent_count.toString() },
          { label: "via proxy", value: ss.proxy_count.toString() },
        ]}
      />
      <SampleList
        items={sample.map((v) => v.name)}
        more={ss.variables.length - sample.length}
      />
    </div>
  );
}

function ActionCardBody(props: { env: EnvironmentDefinition }) {
  const as = props.env.action_space;
  const sample = as.actions.slice(0, 4);
  const active = as.actions.filter((a) => a.currently_active).length;
  return (
    <div className="space-y-3">
      <Stat
        rows={[
          { label: "actions", value: as.actions.length.toString() },
          { label: "search dims", value: as.total_dimension.toString() },
          { label: "currently active", value: active.toString() },
        ]}
      />
      <SampleList
        items={sample.map((a) => a.name)}
        more={as.actions.length - sample.length}
      />
    </div>
  );
}

function TransitionCardBody(props: { env: EnvironmentDefinition }) {
  const td = props.env.transition_dynamics;
  return (
    <div className="space-y-3">
      <Stat
        rows={[
          { label: "edges", value: td.edge_count.toString() },
          {
            label: "avg confidence",
            value: td.avg_confidence.toFixed(2),
          },
          {
            label: "temporal coverage",
            value: `${Math.round(td.temporal_coverage * 100)}%`,
          },
        ]}
      />
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <StatusPill
          label={`${td.by_status.confirmed} confirmed`}
          tone="good"
        />
        <StatusPill label={`${td.by_status.mixed} mixed`} tone="mid" />
        <StatusPill label={`${td.by_status.sparse} sparse`} tone="low" />
      </div>
    </div>
  );
}

function RewardCardBody(props: { env: EnvironmentDefinition }) {
  const rf = props.env.reward_function;
  const primaryGap =
    rf.primary_goal.target_value - rf.primary_goal.baseline_value;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          Primary
        </div>
        <div className="mt-0.5 text-sm text-slate-100">
          {rf.primary_goal.metric_name || "—"}
        </div>
        <div className="text-xs text-slate-500">
          {rf.primary_goal.baseline_value} → {rf.primary_goal.target_value}{" "}
          {rf.primary_goal.metric_unit}{" "}
          <span
            className={cn(
              "ml-1 font-medium",
              primaryGap >= 0 ? "text-emerald-400" : "text-red-400",
            )}
          >
            (Δ{primaryGap >= 0 ? "+" : ""}
            {primaryGap.toFixed(2)})
          </span>
        </div>
      </div>
      <Stat
        rows={[
          { label: "sub-goals", value: rf.sub_goals.length.toString() },
          { label: "cost terms", value: rf.cost_terms.length.toString() },
          {
            label: "weights",
            value: rf.weights_normalized ? "normalized" : "uniform",
          },
        ]}
      />
    </div>
  );
}

function DiscountCardBody(props: { env: EnvironmentDefinition }) {
  const df = props.env.discount_factor;
  const halfLife = Number.isFinite(df.effective_half_life_weeks)
    ? `${df.effective_half_life_weeks} weeks`
    : "no decay";
  return (
    <div className="space-y-3">
      <div>
        <div className="text-3xl font-light text-slate-100">
          {df.per_week.toFixed(3)}
          <span className="ml-1 text-xs text-slate-500">/week</span>
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          half-life: {halfLife}
        </div>
      </div>
      <div className="text-xs text-slate-400">
        {df.is_user_set ? (
          <span>User-set</span>
        ) : (
          <span className="rounded-sm bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">
            default
          </span>
        )}
      </div>
    </div>
  );
}

function InitialStateCardBody(props: { env: EnvironmentDefinition }) {
  const isd = props.env.initial_state_distribution;
  const totalConditions = isd.conditions.length;
  const calibrated = isd.applied_modulators.length;
  const baselines = isd.baselines.length;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          Persona
        </div>
        <div className="mt-0.5 text-sm text-slate-100">
          {isd.subject_name || "default"}
        </div>
      </div>
      <Stat
        rows={[
          { label: "conditions", value: totalConditions.toString() },
          {
            label: "calibrated",
            value: `${calibrated}/${totalConditions}`,
          },
          { label: "measured baselines", value: baselines.toString() },
        ]}
      />
      {isd.uncalibrated_conditions.length > 0 && (
        <div className="rounded-md border border-amber-900/40 bg-amber-950/20 px-2 py-1.5 text-[11px] text-amber-200">
          {isd.uncalibrated_conditions.length} uncalibrated:{" "}
          <span className="font-mono text-amber-100">
            {isd.uncalibrated_conditions.slice(0, 3).join(", ")}
            {isd.uncalibrated_conditions.length > 3 && "…"}
          </span>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Reusable sub-components
// ────────────────────────────────────────────────────────────────────────

function Stat(props: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-xs">
      {props.rows.map((r) => (
        <div key={r.label}>
          <dt className="text-[10px] uppercase tracking-wider text-slate-500">
            {r.label}
          </dt>
          <dd className="mt-0.5 tabular-nums text-slate-200">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SampleList(props: { items: string[]; more: number }) {
  if (props.items.length === 0) {
    return <div className="text-xs italic text-slate-600">empty</div>;
  }
  return (
    <ul className="space-y-1 text-xs text-slate-400">
      {props.items.map((item, i) => (
        <li key={i} className="truncate">
          ▸ {item}
        </li>
      ))}
      {props.more > 0 && (
        <li className="text-slate-600">+{props.more} more</li>
      )}
    </ul>
  );
}

function StatusPill(props: {
  label: string;
  tone: "good" | "mid" | "low";
}) {
  const cls =
    props.tone === "good"
      ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
      : props.tone === "mid"
        ? "border-amber-700/40 bg-amber-950/30 text-amber-300"
        : "border-red-700/40 bg-red-950/30 text-red-300";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5",
        cls,
      )}
    >
      {props.label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Footer — environment hash for drift detection / debug
// ────────────────────────────────────────────────────────────────────────

function HashFooter(props: { env: EnvironmentDefinition }) {
  const short = props.env.environment_hash.slice(0, 12);
  return (
    <footer className="flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-500">
      <div className="flex items-center gap-1.5 font-mono">
        <Hash size={12} />
        {short}…
      </div>
      <div>
        Computed at{" "}
        {new Date(props.env.computed_at).toLocaleTimeString()}
      </div>
    </footer>
  );
}
