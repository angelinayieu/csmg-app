"use client";

// ── Asset folder Insights tab registry (Phase A1.8 · U3) ──
//
// Each folder (asset class) can supply its own "Insights" tab renderer
// that reads from the unified `/api/spaces/[id]/insights-summary`
// endpoint. The registry is sparse — classes without a renderer yet
// fall through to a placeholder so the tab always renders something
// informative.
//
// Every renderer follows the same contract:
//   (props: AssetInsightsProps) => JSX.Element
//
// Fetching happens once per dock-open at the dock level (one request
// per folder press); each renderer gets the already-fetched payload.

import { useEffect, useState } from "react";
import {
  Sparkles,
  Loader2,
  RotateCw,
  HelpCircle,
  Network,
  AlertTriangle,
  ShieldAlert,
  Focus,
} from "lucide-react";
import type { AssetClass } from "./types";
import type { InsightsSummaryResponse } from "@/app/api/spaces/[id]/insights-summary/route";
import type {
  RichLeveragePoint,
  RichFeedbackLoop,
  RichOpenQuestion,
  RichDiscoveredConnection,
  RichContradiction,
  RichRiskPoint,
  RichScenario,
} from "@/types/synthesis";

export interface AssetInsightsProps {
  spaceId: string;
  /** Pre-fetched, shared across all Insights tabs for one dock-open. */
  summary: InsightsSummaryResponse | null;
  /** True while `summary` is being fetched — renderers can show skeletons. */
  loading: boolean;
  error: string | null;
}

/**
 * Hook that fetches the insights summary on mount and re-fetches when
 * the spaceId changes. Used by the drawer to share one fetch across
 * every Insights tab in one dock session.
 */
export function useInsightsSummary(spaceId: string | null | undefined) {
  const [summary, setSummary] = useState<InsightsSummaryResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/spaces/${encodeURIComponent(spaceId)}/insights-summary`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load insights (${res.status})`);
        return (await res.json()) as InsightsSummaryResponse;
      })
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load insights",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  return { summary, loading, error };
}

// ── Entity insights ─────────────────────────────────────────────────
//
// What the old `/leverage` page showed at the top: ranked leverage
// points with primary action. Preserves full rigor — reads the exact
// same `synthesis_data.leverage_points` the old page rendered, just
// projected into the folder-scoped dock instead of a standalone route.

function EntityInsightsView({ summary, loading, error }: AssetInsightsProps) {
  if (loading) return <InsightsSkeleton label="leverage" />;
  if (error) return <InsightsError error={error} />;
  if (!summary || summary.synthesized_at === null) {
    return (
      <InsightsEmpty hint="Run synthesis on this space to unlock entity insights." />
    );
  }

  const top = summary.leverage_points.slice(0, 3);
  if (top.length === 0) {
    return (
      <InsightsEmpty hint="No leverage points yet — synthesis found none in the current graph." />
    );
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-1.5">
      <InsightsSectionLabel icon={<Sparkles className="h-3 w-3" />}>
        Top leverage points
      </InsightsSectionLabel>
      {top.map((pt, idx) => (
        <LeveragePointCard key={pt.entity_id} point={pt} rank={idx + 1} />
      ))}
    </div>
  );
}

function LeveragePointCard({
  point,
  rank,
}: {
  point: RichLeveragePoint;
  rank: number;
}) {
  return (
    <div
      className="flex gap-2 rounded-lg border border-gray-200/70 bg-white/80 p-2"
      title={point.summary}
    >
      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 font-mono text-[9px] font-bold text-amber-700">
        {rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-semibold text-gray-900">
          {point.entity_name ?? point.entity_id}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[10.5px] text-gray-600">
          {point.summary}
        </div>
        {point.action?.primary && (
          <div className="mt-1 line-clamp-1 text-[10px] font-medium text-amber-700">
            → {point.action.primary}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reaction insights ────────────────────────────────────────────────
//
// Reactions are the user-facing form of the system's feedback loops —
// so the Reactions folder Insights tab surfaces the same
// `synthesis_data.feedback_loops` data the `/loops` page consumed.

function ReactionInsightsView({ summary, loading, error }: AssetInsightsProps) {
  if (loading) return <InsightsSkeleton label="feedback loops" />;
  if (error) return <InsightsError error={error} />;
  if (!summary || summary.synthesized_at === null) {
    return <InsightsEmpty hint="Run synthesis to detect feedback loops." />;
  }

  const top = summary.feedback_loops.slice(0, 4);
  if (top.length === 0) {
    return (
      <InsightsEmpty hint="No feedback loops found in the current graph." />
    );
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-1.5">
      <InsightsSectionLabel icon={<RotateCw className="h-3 w-3" />}>
        Feedback loops
      </InsightsSectionLabel>
      {top.map((loop, idx) => (
        <FeedbackLoopCard key={`${loop.name}-${idx}`} loop={loop} />
      ))}
    </div>
  );
}

function FeedbackLoopCard({ loop }: { loop: RichFeedbackLoop }) {
  const accent = loop.type === "positive" ? "#16a34a" : "#dc2626";
  const typeLabel = loop.type === "positive" ? "Reinforcing" : "Balancing";
  return (
    <div
      className="flex gap-2 rounded-lg border border-gray-200/70 bg-white/80 p-2"
      title={loop.explanation}
    >
      <div
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
        style={{ background: `${accent}15`, color: accent }}
      >
        <RotateCw className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <div className="truncate text-[11.5px] font-semibold text-gray-900">
            {loop.name}
          </div>
          <span
            className="flex-shrink-0 rounded px-1 py-0 font-mono text-[8.5px] font-bold uppercase tracking-wider"
            style={{ color: accent, background: `${accent}14` }}
          >
            {typeLabel}
          </span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[10.5px] text-gray-600">
          {loop.explanation}
        </div>
        {loop.steps.length > 0 && (
          <div className="mt-1 text-[10px] text-gray-500">
            {loop.steps.length} step{loop.steps.length === 1 ? "" : "s"} ·
            {" "}intervention at step {loop.intervention_at + 1}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Claim insights ──────────────────────────────────────────────────
//
// Claims are epistemic statements under evaluation — open questions
// are their pre-answered form. The Claims folder surfaces
// `synthesis_data.open_questions` as the primary insights lens.

function ClaimInsightsView({ summary, loading, error }: AssetInsightsProps) {
  if (loading) return <InsightsSkeleton label="open questions" />;
  if (error) return <InsightsError error={error} />;
  if (!summary || summary.synthesized_at === null) {
    return <InsightsEmpty hint="Run synthesis to surface open questions." />;
  }

  // Sort by priority (critical > high > medium); questions without
  // priority fall to the end but still render.
  const PRIORITY_ORDER: Record<string, number> = {
    critical: 3,
    high: 2,
    medium: 1,
  };
  const sorted = [...summary.open_questions].sort(
    (a, b) =>
      (PRIORITY_ORDER[b.priority ?? ""] ?? 0) -
      (PRIORITY_ORDER[a.priority ?? ""] ?? 0),
  );
  const top = sorted.slice(0, 4);
  if (top.length === 0) {
    return <InsightsEmpty hint="No open questions right now — synthesis didn't surface any." />;
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-1.5">
      <InsightsSectionLabel icon={<HelpCircle className="h-3 w-3" />}>
        Open questions
      </InsightsSectionLabel>
      {top.map((q, idx) => (
        <OpenQuestionCard key={`oq-${idx}`} question={q} />
      ))}
    </div>
  );
}

function OpenQuestionCard({ question }: { question: RichOpenQuestion }) {
  const priority = question.priority ?? null;
  const accent =
    priority === "critical"
      ? "#dc2626"
      : priority === "high"
        ? "#d97706"
        : priority === "medium"
          ? "#0891b2"
          : "#64748b";
  return (
    <div
      className="flex gap-2 rounded-lg border border-gray-200/70 bg-white/80 p-2"
      title={question.why_it_matters}
    >
      <div
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
        style={{ background: `${accent}15`, color: accent }}
      >
        <HelpCircle className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[11.5px] font-semibold text-gray-900">
          {question.question}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[10.5px] text-gray-600">
          {question.why_it_matters}
        </div>
        {priority && (
          <div
            className="mt-1 font-mono text-[9px] font-bold uppercase tracking-wider"
            style={{ color: accent }}
          >
            {priority}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bridge insights ─────────────────────────────────────────────────
//
// Bridges are cross-space connections. Synthesis surfaces
// `discovered_connections` which are the raw AI-proposed bridges
// before user review. This folder's Insights tab shows those so a
// user can see what the system thinks bridges to the space.

function BridgeInsightsView({ summary, loading, error }: AssetInsightsProps) {
  if (loading) return <InsightsSkeleton label="discovered connections" />;
  if (error) return <InsightsError error={error} />;
  if (!summary || summary.synthesized_at === null) {
    return <InsightsEmpty hint="Run synthesis to surface discovered connections." />;
  }

  const top = summary.discovered_connections.slice(0, 5);
  if (top.length === 0) {
    return <InsightsEmpty hint="No new connections discovered in the current pass." />;
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-1.5">
      <InsightsSectionLabel icon={<Network className="h-3 w-3" />}>
        Discovered connections
      </InsightsSectionLabel>
      {top.map((c, idx) => (
        <DiscoveredConnectionCard key={`dc-${idx}`} connection={c} />
      ))}
    </div>
  );
}

function DiscoveredConnectionCard({
  connection,
}: {
  connection: RichDiscoveredConnection;
}) {
  const accent =
    connection.strength === "strong"
      ? "#0891b2"
      : connection.strength === "moderate"
        ? "#64748b"
        : "#94a3b8";
  return (
    <div
      className="rounded-lg border border-gray-200/70 bg-white/80 p-2"
      title={connection.reasoning}
    >
      <div className="flex items-center gap-1 text-[10.5px] text-gray-700">
        <span className="font-mono text-[10px] text-gray-500">
          {connection.source_entity_id.slice(0, 6)}
        </span>
        <Network className="h-2.5 w-2.5 text-gray-400" />
        <span className="font-mono text-[10px] text-gray-500">
          {connection.target_entity_id.slice(0, 6)}
        </span>
        <span
          className="ml-auto font-mono text-[9px] font-bold uppercase tracking-wider"
          style={{ color: accent }}
        >
          {connection.strength}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-[10.5px] text-gray-600">
        {connection.reasoning}
      </div>
    </div>
  );
}

// ── Axiom insights ──────────────────────────────────────────────────
//
// Axioms are load-bearing assumptions; when they're wrong the whole
// analysis shifts. Contradictions are the surfaced "axiom under
// pressure" signal — so the Axioms folder's Insights tab renders
// `synthesis_data.contradictions` sorted by severity.

function AxiomInsightsView({ summary, loading, error }: AssetInsightsProps) {
  if (loading) return <InsightsSkeleton label="contradictions" />;
  if (error) return <InsightsError error={error} />;
  if (!summary || summary.synthesized_at === null) {
    return <InsightsEmpty hint="Run synthesis to surface contradictions." />;
  }

  const SEVERITY_ORDER: Record<string, number> = {
    critical: 3,
    moderate: 2,
    minor: 1,
  };
  const sorted = [...summary.contradictions].sort(
    (a, b) =>
      (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0),
  );
  const top = sorted.slice(0, 4);
  if (top.length === 0) {
    return <InsightsEmpty hint="No contradictions detected in the current synthesis." />;
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-1.5">
      <InsightsSectionLabel icon={<AlertTriangle className="h-3 w-3" />}>
        Contradictions
      </InsightsSectionLabel>
      {top.map((c, idx) => (
        <ContradictionCard key={`contra-${idx}`} contradiction={c} />
      ))}
    </div>
  );
}

function ContradictionCard({
  contradiction,
}: {
  contradiction: RichContradiction;
}) {
  const accent =
    contradiction.severity === "critical"
      ? "#dc2626"
      : contradiction.severity === "moderate"
        ? "#d97706"
        : "#64748b";
  return (
    <div
      className="flex gap-2 rounded-lg border border-gray-200/70 bg-white/80 p-2"
      title={contradiction.description}
    >
      <div
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
        style={{ background: `${accent}15`, color: accent }}
      >
        <AlertTriangle className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[11px] font-medium text-gray-900">
          <span className="text-gray-500">If </span>
          {contradiction.assumption_text}
          <span className="text-gray-500"> then </span>
          {contradiction.conclusion_text}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[10.5px] text-gray-600">
          {contradiction.description}
        </div>
        <div
          className="mt-1 font-mono text-[9px] font-bold uppercase tracking-wider"
          style={{ color: accent }}
        >
          {contradiction.severity}
        </div>
      </div>
    </div>
  );
}

// ── Intelligence Signal insights ────────────────────────────────────
//
// Signals are the real-time risk flags. `synthesis_data.risk_points`
// is the synthesized bird's-eye view — ranked by blast_radius — that
// this folder surfaces so users can see the risk landscape alongside
// individual signals.

function SignalInsightsView({ summary, loading, error }: AssetInsightsProps) {
  if (loading) return <InsightsSkeleton label="risk points" />;
  if (error) return <InsightsError error={error} />;
  if (!summary || summary.synthesized_at === null) {
    return <InsightsEmpty hint="Run synthesis to surface risk points." />;
  }

  const top = [...summary.risk_points]
    .sort((a, b) => (b.blast_radius ?? 0) - (a.blast_radius ?? 0))
    .slice(0, 4);
  if (top.length === 0) {
    return <InsightsEmpty hint="No synthesized risk points yet." />;
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-1.5">
      <InsightsSectionLabel icon={<ShieldAlert className="h-3 w-3" />}>
        Risk points
      </InsightsSectionLabel>
      {top.map((r, idx) => (
        <RiskPointCard key={r.entity_id} risk={r} rank={idx + 1} />
      ))}
    </div>
  );
}

function RiskPointCard({
  risk,
  rank,
}: {
  risk: RichRiskPoint;
  rank: number;
}) {
  return (
    <div
      className="flex gap-2 rounded-lg border border-gray-200/70 bg-white/80 p-2"
      title={risk.summary}
    >
      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-50 font-mono text-[9px] font-bold text-red-600">
        {rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <div className="truncate text-[11.5px] font-semibold text-gray-900">
            {risk.entity_name ?? risk.entity_id}
          </div>
          <span
            className="flex-shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider text-red-600"
            title="Blast radius"
          >
            ⌀{risk.blast_radius}
          </span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[10.5px] text-gray-600">
          {risk.summary}
        </div>
        {risk.mitigation?.primary && (
          <div className="mt-1 line-clamp-1 text-[10px] font-medium text-red-700">
            → {risk.mitigation.primary}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Convergent Point insights ───────────────────────────────────────
//
// Convergent points represent scenarios where multiple causal chains
// meet at an outcome. `synthesis_data.scenarios` is the projection
// layer — "if X then Y with probability Z" — that this folder
// surfaces.

function ConvergentInsightsView({
  summary,
  loading,
  error,
}: AssetInsightsProps) {
  if (loading) return <InsightsSkeleton label="scenarios" />;
  if (error) return <InsightsError error={error} />;
  if (!summary || summary.synthesized_at === null) {
    return <InsightsEmpty hint="Run synthesis to surface scenarios." />;
  }

  const PROB_ORDER: Record<string, number> = {
    likely: 3,
    possible: 2,
    unlikely: 1,
  };
  const sorted = [...summary.scenarios].sort(
    (a, b) => (PROB_ORDER[b.probability] ?? 0) - (PROB_ORDER[a.probability] ?? 0),
  );
  const top = sorted.slice(0, 4);
  if (top.length === 0) {
    return <InsightsEmpty hint="No scenarios projected in the current synthesis." />;
  }

  return (
    <div className="flex flex-col gap-2 px-2 py-1.5">
      <InsightsSectionLabel icon={<Focus className="h-3 w-3" />}>
        Scenarios
      </InsightsSectionLabel>
      {top.map((s, idx) => (
        <ScenarioCard key={`sc-${idx}`} scenario={s} />
      ))}
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: RichScenario }) {
  const accent =
    scenario.probability === "likely"
      ? "#16a34a"
      : scenario.probability === "possible"
        ? "#d97706"
        : "#94a3b8";
  return (
    <div
      className="rounded-lg border border-gray-200/70 bg-white/80 p-2"
      title={scenario.conditions}
    >
      <div className="flex items-baseline gap-1.5">
        <div className="truncate text-[11.5px] font-semibold text-gray-900">
          {scenario.name}
        </div>
        <span
          className="ml-auto flex-shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider"
          style={{ color: accent }}
        >
          {scenario.probability}
        </span>
      </div>
      <div className="mt-0.5 line-clamp-2 text-[10.5px] text-gray-600">
        {scenario.conditions}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400">
          {scenario.outcome_label}
        </span>
        <span
          className="text-[11px] font-semibold"
          style={{ color: accent }}
        >
          {scenario.outcome_value}
        </span>
      </div>
    </div>
  );
}

// ── Shared placeholders ─────────────────────────────────────────────

function InsightsSectionLabel({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 px-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-gray-400">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function InsightsSkeleton({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-[11px] text-gray-400">
      <Loader2 className="h-3 w-3 animate-spin" />
      Loading {label}…
    </div>
  );
}

function InsightsError({ error }: { error: string }) {
  return (
    <div className="px-4 py-6 text-center text-[11px] text-red-500">
      {error}
    </div>
  );
}

function InsightsEmpty({ hint }: { hint: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="text-[11px] text-gray-400">{hint}</div>
    </div>
  );
}

/**
 * Default "coming soon" placeholder — used for folders that haven't
 * shipped an Insights renderer yet. Kept informative so it doesn't
 * feel broken during the rollout.
 */
export function DefaultInsightsPlaceholder({
  className,
}: {
  className: string;
}) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="text-[11px] font-semibold text-gray-500">
        Insights for {className} coming soon
      </div>
      <div className="mt-1 text-[10.5px] text-gray-400">
        This folder&apos;s Insights tab is still being wired. Leverage,
        scenarios, and synthesis data will surface here once rolled out.
      </div>
    </div>
  );
}

// ── Registry ────────────────────────────────────────────────────────

/**
 * Sparse map of AssetClass → renderer. Missing entries render
 * `DefaultInsightsPlaceholder`. Adding a new class's insights = one
 * line here pointing at a new renderer function above.
 */
export const INSIGHTS_RENDERERS: Partial<
  Record<AssetClass, React.FC<AssetInsightsProps>>
> = {
  entity: EntityInsightsView,
  reaction: ReactionInsightsView,
  claim: ClaimInsightsView,
  bridge: BridgeInsightsView,
  axiom: AxiomInsightsView,
  "intelligence-signal": SignalInsightsView,
  "convergent-point": ConvergentInsightsView,
};
