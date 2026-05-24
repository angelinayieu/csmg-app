"use client";

// IntakeProposalView — client orchestrator for /app/intake-proposal/[runId]
// (C1 MVP).
//
// Renders the proposal page: polls /api/spaces/[id]/kg-plans?status=open
// for the proposed plan that the bootstrap's after() block triggered via
// /api/pipeline/propose-plan. Once the plan lands (~10-30s on first
// load), shows the plan content + an Approve CTA that fires the existing
// approve endpoint and routes to the whiteboard.
//
// MVP scope: one pane (the KG plan from kg_generation_plans), polished
// visual, two CTAs (Run this plan / Skip). C2-C4 will extend this to
// the four-pane layout (goal frame, KG plan, lab setup, agentic stack).
//
// Polling strategy: 1.5s interval, max 60 attempts (90s window). When
// the plan doesn't land in that window we surface a "Plan didn't arrive
// yet — go to whiteboard" affordance so the user is never stuck.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Beaker,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Cpu,
  Gamepad2,
  Layers,
  Loader2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Workflow,
} from "lucide-react";
import type { KgGenerationPlan } from "@/types/kg-generation-plan";
import type { LabSetupForecast } from "@/lib/intake-proposal/lab-setup-forecast";
import type {
  AgenticStackForecast,
  AgenticStackPhase,
} from "@/lib/intake-proposal/agentic-stack-forecast";

const MECH_ICONS = {
  Beaker,
  TrendingUp,
  ShieldCheck,
  Activity,
  AlertTriangle,
  Gamepad2,
  Sparkles,
} as const;

interface Props {
  runId: string;
  spaceId: string;
}

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 60; // 90s total

export function IntakeProposalView({ runId, spaceId }: Props) {
  const router = useRouter();
  const [plan, setPlan] = useState<KgGenerationPlan | null>(null);
  const [labSetup, setLabSetup] = useState<LabSetupForecast | null>(null);
  const [agenticStack, setAgenticStack] = useState<AgenticStackForecast | null>(
    null,
  );
  const [pollAttempts, setPollAttempts] = useState(0);
  const [pollExhausted, setPollExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [skipping, setSkipping] = useState(false);

  // Poll the combined intake-proposal endpoint. The propose-plan job
  // runs async via after() from the bootstrap; the plan may not exist
  // for the first ~10s. We poll until plan + forecasts land or we
  // exhaust attempts.
  useEffect(() => {
    if (plan || pollExhausted) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled || plan) return;
      attempts++;
      setPollAttempts(attempts);
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/intake-proposal`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          plan: KgGenerationPlan | null;
          lab_setup: LabSetupForecast | null;
          agentic_stack: AgenticStackForecast | null;
        };
        if (cancelled) return;
        if (json.plan) {
          setPlan(json.plan);
          setLabSetup(json.lab_setup);
          setAgenticStack(json.agentic_stack);
          return;
        }
      } catch (e) {
        // Keep polling — transient errors are common during the
        // ~10s window while propose-plan is generating.
        if (attempts >= POLL_MAX_ATTEMPTS) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      if (attempts >= POLL_MAX_ATTEMPTS) {
        setPollExhausted(true);
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [spaceId, plan, pollExhausted]);

  // After the clarifying-questions / four-pane proposal review, the
  // user continues onto the Synthesis Lab (/triple-lab) — the new
  // universal entry surface. Name kept as goToWhiteboard for minimal
  // call-site blast radius; the destination is what matters.
  const goToWhiteboard = useCallback(() => {
    router.push(`/app/space/${spaceId}/triple-lab?run=${runId}`);
  }, [router, runId, spaceId]);

  const handleApprove = useCallback(async () => {
    if (!plan || approving) return;
    setApproving(true);
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/kg-plans/${encodeURIComponent(
          plan.id,
        )}/approve`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      // Approve fires decompose downstream; navigate the user to the
      // whiteboard where they'll watch entities stream in.
      goToWhiteboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setApproving(false);
    }
  }, [plan, approving, spaceId, goToWhiteboard]);

  const handleSkip = useCallback(() => {
    if (skipping) return;
    setSkipping(true);
    goToWhiteboard();
  }, [skipping, goToWhiteboard]);

  const elapsedSec = Math.round((pollAttempts * POLL_INTERVAL_MS) / 1000);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
          <Sparkles className="h-3 w-3" />
          Intake proposal
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          {plan ? "Review what we're about to build" : "Composing your proposal"}
        </h1>
        <p className="text-[13px] text-gray-500">
          {plan
            ? "We've drafted a knowledge-graph plan from your prompt. Review it, then run to start the analysis pipeline."
            : "We're analyzing your prompt and drafting a plan tailored to your situation. This usually takes 10-30 seconds."}
        </p>
      </header>

      {/* Loading state */}
      {!plan && !pollExhausted && (
        <ProposalLoadingPane elapsedSec={elapsedSec} />
      )}

      {/* Polling exhausted — escape hatch */}
      {pollExhausted && !plan && (
        <ProposalExhaustedPane
          error={error}
          onSkip={handleSkip}
          skipping={skipping}
        />
      )}

      {/* Plan loaded — review pane */}
      {plan && (
        <>
          <PlanReviewPane plan={plan} />
          {labSetup && <LabSetupPane forecast={labSetup} />}
          {agenticStack && <AgenticStackPane forecast={agenticStack} />}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-600" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-red-700">
                  Couldn&apos;t complete the action
                </p>
                <p className="mt-0.5 text-[11px] text-red-600">{error}</p>
              </div>
            </div>
          )}
          <ProposalActionBar
            onApprove={handleApprove}
            onSkip={handleSkip}
            approving={approving}
            skipping={skipping}
          />
        </>
      )}
    </main>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function ProposalLoadingPane({ elapsedSec }: { elapsedSec: number }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
      <div className="relative">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        <Sparkles className="absolute inset-0 m-auto h-3 w-3 text-indigo-300" />
      </div>
      <div className="space-y-1">
        <p className="text-[14px] font-medium text-gray-700">
          Generating your proposal…
        </p>
        <p className="text-[11px] text-gray-400">
          {elapsedSec > 0 ? `${elapsedSec}s elapsed` : "Just a moment"} ·
          typically 10-30s
        </p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-2 pt-2">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-indigo-200" />
      <div className="h-2 flex-1 animate-pulse rounded-full bg-gray-100" />
    </div>
  );
}

function ProposalExhaustedPane({
  error,
  onSkip,
  skipping,
}: {
  error: string | null;
  onSkip: () => void;
  skipping: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50/50 px-6 py-8">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-amber-900">
            The proposal is taking longer than expected
          </p>
          <p className="mt-1 text-[12px] text-amber-800">
            {error
              ? `Last error: ${error}`
              : "We couldn't fetch the proposal in 90 seconds. You can go straight to the whiteboard and review the plan there once it lands, or refresh this page to try again."}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSkip}
        disabled={skipping}
        className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
      >
        {skipping ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowRight className="h-3.5 w-3.5" />
        )}
        Continue to whiteboard
      </button>
    </div>
  );
}

function PlanReviewPane({ plan }: { plan: KgGenerationPlan }) {
  const scope = plan.scope_and_objectives;
  const layers = plan.layer_ontology_proposal?.layers ?? [];
  const ontologySource = plan.layer_ontology_proposal?.ontology_source;
  const skeleton = plan.conceptual_skeleton;
  const clusters = skeleton?.anticipated_clusters ?? [];
  const research = plan.research_plan;
  const primaryObjective =
    scope?.goal_parsed?.primary_objective ?? scope?.goal_verbatim ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* Goal frame — what the LLM understood from your prompt */}
      <PaneCard
        icon={<Target className="h-3.5 w-3.5" />}
        accent="#6366F1"
        title="Goal frame"
        subtitle={`${plan.mode} mode`}
      >
        {primaryObjective && (
          <p className="text-[13px] font-medium text-gray-900">
            {primaryObjective}
          </p>
        )}
        {scope?.goal_parsed?.target_outcomes &&
          scope.goal_parsed.target_outcomes.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">
                Target outcomes
              </p>
              <ul className="space-y-1">
                {scope.goal_parsed.target_outcomes.slice(0, 4).map((c, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[11.5px] text-gray-700"
                  >
                    <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-400" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        {scope?.success_criteria && scope.success_criteria.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">
              Success criteria
            </p>
            <ul className="space-y-1">
              {scope.success_criteria.slice(0, 4).map((c, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-[11.5px] text-gray-700"
                >
                  <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-400" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PaneCard>

      {/* Layer ontology */}
      {layers.length > 0 && (
        <PaneCard
          icon={<Layers className="h-3.5 w-3.5" />}
          accent="#10B981"
          title="Knowledge graph plan"
          subtitle={`${layers.length} layer${layers.length === 1 ? "" : "s"}${
            ontologySource ? ` · ${ontologySource}` : ""
          }`}
        >
          <div className="space-y-1.5">
            {layers.slice(0, 8).map((layer) => (
              <div
                key={`${layer.ordinal}-${layer.slug}`}
                className="flex items-center gap-2"
              >
                <div
                  aria-hidden
                  className="h-3 w-1 flex-shrink-0 rounded"
                  style={{ background: layer.color }}
                />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-700">
                  {layer.label}
                </span>
                {layer.typical_node_kinds &&
                  layer.typical_node_kinds.length > 0 && (
                    <span className="truncate text-[10px] text-gray-400">
                      {layer.typical_node_kinds.slice(0, 3).join(" · ")}
                    </span>
                  )}
              </div>
            ))}
          </div>
        </PaneCard>
      )}

      {/* Conceptual skeleton */}
      {clusters.length > 0 && (
        <PaneCard
          icon={<Workflow className="h-3.5 w-3.5" />}
          accent="#D97706"
          title="Conceptual skeleton"
          subtitle={
            skeleton
              ? `${clusters.length} cluster${
                  clusters.length === 1 ? "" : "s"
                } · ~${skeleton.estimated_total_nodes ?? 0} nodes`
              : `${clusters.length} clusters`
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {clusters.slice(0, 6).map((cluster, i) => (
              <div
                key={i}
                className="rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2"
              >
                <p className="text-[11.5px] font-semibold text-gray-800">
                  {cluster.label}
                </p>
                {cluster.expected_node_kinds &&
                  cluster.expected_node_kinds.length > 0 && (
                    <p className="mt-0.5 line-clamp-2 text-[10.5px] text-gray-500">
                      {cluster.expected_node_kinds.slice(0, 4).join(" · ")}
                    </p>
                  )}
                {cluster.expected_node_count > 0 && (
                  <p className="mt-1 text-[9.5px] uppercase tracking-wider text-gray-400">
                    ~{cluster.expected_node_count} expected nodes
                  </p>
                )}
              </div>
            ))}
          </div>
        </PaneCard>
      )}

      {/* Research plan */}
      {research && (research.papers.length > 0 || research.coverage_gaps.length > 0) && (
        <PaneCard
          icon={<BookOpen className="h-3.5 w-3.5" />}
          accent="#8B5CF6"
          title="Research plan"
          subtitle={`${research.papers.length} paper${
            research.papers.length === 1 ? "" : "s"
          } · ${research.coverage_gaps.length} gap${
            research.coverage_gaps.length === 1 ? "" : "s"
          }`}
        >
          {research.extraction_order_rationale && (
            <p className="text-[11.5px] leading-snug text-gray-600">
              {research.extraction_order_rationale}
            </p>
          )}
          {research.papers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {research.papers.slice(0, 6).map((p, i) => (
                <span
                  key={i}
                  className="truncate rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700"
                  style={{ maxWidth: 220 }}
                  title={p.title}
                >
                  {p.title}
                </span>
              ))}
              {research.papers.length > 6 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                  +{research.papers.length - 6}
                </span>
              )}
            </div>
          )}
        </PaneCard>
      )}
    </div>
  );
}

function LabSetupPane({ forecast }: { forecast: LabSetupForecast }) {
  const appCountText =
    forecast.expected_app_count_min === forecast.expected_app_count_max
      ? `~${forecast.expected_app_count_min}`
      : `${forecast.expected_app_count_min}–${forecast.expected_app_count_max}`;

  const subtitle = [
    `${forecast.mechanism_cards.length} surface${
      forecast.mechanism_cards.length === 1 ? "" : "s"
    }`,
    `${forecast.axis_cards.length} axis${
      forecast.axis_cards.length === 1 ? "" : "es"
    }`,
    forecast.filtered_by_template ? "template-tuned" : "all kinds",
  ].join(" · ");

  return (
    <PaneCard
      icon={<Cpu className="h-3.5 w-3.5" />}
      accent="#0EA5E9"
      title="Lab setup"
      subtitle={subtitle}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {forecast.mechanism_cards.map((card) => {
          const Icon = MECH_ICONS[card.icon];
          return (
            <div
              key={card.kind}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded"
                  style={{
                    background: `color-mix(in srgb, ${card.accent} 14%, transparent)`,
                    color: card.accent,
                  }}
                >
                  {Icon ? <Icon className="h-3 w-3" /> : null}
                </span>
                <p className="text-[11.5px] font-semibold text-gray-900">
                  {card.title}
                </p>
              </div>
              <p className="mt-1 text-[10.5px] leading-snug text-gray-600">
                {card.one_liner}
              </p>
              <p className="mt-1 text-[10px] italic leading-snug text-gray-500">
                {card.capability}
              </p>
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5 pt-1">
        <p className="text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">
          Probability-space axes the lab will populate
        </p>
        <div className="flex flex-wrap gap-1.5">
          {forecast.axis_cards.map((axis) => (
            <span
              key={axis.slug}
              className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700"
              title={axis.description}
            >
              <CircleDot className="h-2.5 w-2.5" />
              {axis.label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 px-3 py-2">
        <ForecastStat
          value={appCountText}
          label="apps will materialize"
          hint="auto-generated when strategy synthesis finishes"
        />
        <ForecastStat
          value={String(forecast.paper_count)}
          label={`paper${forecast.paper_count === 1 ? "" : "s"} to ingest`}
          hint="evidence base for the calibration baseline"
        />
        <ForecastStat
          value={String(forecast.coverage_gap_count)}
          label={`coverage gap${
            forecast.coverage_gap_count === 1 ? "" : "s"
          } flagged`}
          hint="areas where you may want to add more sources"
        />
      </div>
    </PaneCard>
  );
}

function ForecastStat({
  value,
  label,
  hint,
}: {
  value: string;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-0.5" title={hint}>
      <span className="text-[16px] font-semibold tabular-nums text-gray-900">
        {value}
      </span>
      <span className="text-[10px] leading-tight text-gray-500">{label}</span>
    </div>
  );
}

function AgenticStackPane({
  forecast,
}: {
  forecast: AgenticStackForecast;
}) {
  return (
    <PaneCard
      icon={<Bot className="h-3.5 w-3.5" />}
      accent="#10B981"
      title="Agentic stack"
      subtitle={`${forecast.active_in_run_count}/${forecast.total_agents} agents will fire · depth=${forecast.resolved_depth}`}
    >
      <div className="space-y-3">
        {forecast.phases.map((phase) => (
          <PhaseBlock key={phase.key} phase={phase} />
        ))}
      </div>
    </PaneCard>
  );
}

function PhaseBlock({ phase }: { phase: AgenticStackPhase }) {
  if (phase.agents.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-3 w-1 flex-shrink-0 rounded"
          style={{ background: phase.accent }}
        />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-700">
          {phase.title}
        </p>
        <p className="text-[9.5px] text-gray-400">
          {phase.agents.filter((a) => a.active_in_this_run).length}/
          {phase.agents.length} active
        </p>
      </div>
      <p className="mt-0.5 text-[10.5px] leading-snug text-gray-500">
        {phase.description}
      </p>
      <ul className="mt-2 space-y-1.5">
        {phase.agents.map((agent) => (
          <li
            key={agent.id}
            className={`flex items-start gap-2 rounded border px-2 py-1.5 ${
              agent.active_in_this_run
                ? "border-emerald-200 bg-white"
                : "border-gray-200 bg-white opacity-50"
            }`}
          >
            <CheckCircle2
              className={`mt-0.5 h-3 w-3 flex-shrink-0 ${
                agent.active_in_this_run
                  ? "text-emerald-500"
                  : "text-gray-300"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-gray-800">
                {agent.title}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-gray-600">
                {agent.responsibility}
              </p>
              <p className="mt-0.5 text-[9.5px] italic text-gray-400">
                {agent.runs_when}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaneCard({
  icon,
  accent,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <header
        className="flex items-center gap-2 rounded-t-2xl border-b border-gray-100 px-5 py-3"
        style={{ background: `color-mix(in srgb, ${accent} 4%, white)` }}
      >
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-md"
          style={{
            background: `color-mix(in srgb, ${accent} 12%, transparent)`,
            color: accent,
          }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-gray-900">{title}</h2>
          <p className="text-[10.5px] uppercase tracking-wider text-gray-400">
            {subtitle}
          </p>
        </div>
      </header>
      <div className="space-y-2.5 px-5 py-4">{children}</div>
    </section>
  );
}

function ProposalActionBar({
  onApprove,
  onSkip,
  approving,
  skipping,
}: {
  onApprove: () => void;
  onSkip: () => void;
  approving: boolean;
  skipping: boolean;
}) {
  return (
    <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur">
      <button
        type="button"
        onClick={onSkip}
        disabled={skipping || approving}
        className="text-[12px] font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
      >
        Skip review
      </button>
      <button
        type="button"
        onClick={onApprove}
        disabled={approving || skipping}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
      >
        {approving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        Run this plan
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
